/* =====================================================================
   WEAPONS — alternative firing modes & projectile behaviors
   =====================================================================
   Houses the things that don't quite fit a "spawn one ball, watch it
   bounce" model:

     LASER     — raycasted beam that reveals progressively over time
                 and applies damage at most once per target
     CLUSTER   — bullets that explode into shrapnel on contact
     MISSILE   — slow, homing projectile (steered each frame)
     HIJACK    — bullets that flip an opposing ball to your team
     POISON    — bullets that apply a damage-over-time stack on hit
     BANANA    — rapid-fire; leaves a deflecting peel on death
     SHRAPNEL  — small short-lived bullets spawned by cluster explosions

   Reads from:  CONFIG, RED, BLUE, arenaWalls, barriers, turrets, fx,
                balls, shakeAmount, sound* functions, statusEl, winner,
                running, timeSec, World, engine, Bodies, Body
   Writes:      lasers (global array), shakeAmount, fx, balls/turret hp,
                ball.team / ball.color (hijack), ball.poisonStacks etc.
   ===================================================================== */

// Active laser beams. Each entry:
//   {
//     team:           RED|BLUE,
//     segments:       [{x1,y1,x2,y2,startDist,endDist}, ...],
//     totalLen:       sum of segment lengths
//     hits:           [{body, kind, dist, damageApplied:false}, ...]
//                       (sorted by dist; damage applied as beam reaches each)
//     revealedLen:    px revealed so far (animated)
//     beamSpeed:      px/sec reveal speed
//     fadeStart:      timeSec when beam was fully revealed (-1 until then)
//     life:           seconds beam lingers AFTER fully revealed
//     width:          visual + collision thickness
//   }
let lasers = [];


/* =====================================================================
   2D RAY UTILITIES (used by laser raycaster)
   ===================================================================== */

// Ray vs axis-aligned rectangle. Returns { t, nx, ny } if hit, null otherwise.
function rayHitRect(ox, oy, dx, dy, cx, cy, w, h) {
  const minX = cx - w / 2, maxX = cx + w / 2;
  const minY = cy - h / 2, maxY = cy + h / 2;

  let tMin = -Infinity, tMax = Infinity;

  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const tx1 = (minX - ox) / dx;
    const tx2 = (maxX - ox) / dx;
    tMin = Math.max(tMin, Math.min(tx1, tx2));
    tMax = Math.min(tMax, Math.max(tx1, tx2));
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const ty1 = (minY - oy) / dy;
    const ty2 = (maxY - oy) / dy;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));
  }

  if (tMin > tMax || tMax < 0.001) return null;
  const t = tMin > 0.001 ? tMin : null;
  if (t === null) return null;

  // Determine entry-face normal
  const hitX = ox + dx * t;
  const hitY = oy + dy * t;
  let nx = 0, ny = 0;
  const dLeft   = Math.abs(hitX - minX);
  const dRight  = Math.abs(hitX - maxX);
  const dTop    = Math.abs(hitY - minY);
  const dBottom = Math.abs(hitY - maxY);
  const dMin = Math.min(dLeft, dRight, dTop, dBottom);
  if      (dMin === dLeft)   nx = -1;
  else if (dMin === dRight)  nx =  1;
  else if (dMin === dTop)    ny = -1;
  else                        ny =  1;

  return { t, nx, ny };
}

// Reflect (dx,dy) off normal (nx,ny)
function reflectVector(dx, dy, nx, ny) {
  const dot = dx * nx + dy * ny;
  return [dx - 2 * dot * nx, dy - 2 * dot * ny];
}

// Returns { t, nx, ny, body, kind } where kind ∈ 'wall'|'barrier'|'turret'
function raycastNearest(ox, oy, dx, dy, laserTeamId) {
  let nearest = null;
  const consider = (hit, body, kind) => {
    if (hit && (!nearest || hit.t < nearest.t)) {
      nearest = { t: hit.t, nx: hit.nx, ny: hit.ny, body, kind };
    }
  };

  for (const w of arenaWalls) {
    consider(rayHitRect(ox, oy, dx, dy, w.position.x, w.position.y, w.w, w.h),
             w, 'wall');
  }

  // Barriers: skip same-team (beams pass through their own team's cover)
  for (const b of barriers) {
    if (b.team === laserTeamId) continue;
    consider(rayHitRect(ox, oy, dx, dy, b.position.x, b.position.y, b.w, b.h),
             b, 'barrier');
  }

  // Enemy turrets — use a generously expanded hitbox.
  // The beam is computed at fire time but reveals over 1-2 s; the turret
  // moves during that window, so a tight hitbox causes visual misses.
  // Extra height also catches near-horizontal bounce segments.
  for (const t of turrets) {
    if (t.dead || t.team.id === laserTeamId) continue;
    const hw = Math.max(t.type.turretWidth  * 1.5, 100);
    const hh = Math.max(t.type.turretHeight * 3.0,  90);
    consider(rayHitRect(ox, oy, dx, dy, t.x, t.y, hw, hh), t, 'turret');
  }

  return nearest;
}


/* =====================================================================
   LASER  —  fire + step
   =====================================================================
   On fire we pre-compute the full bouncing polyline AND a list of hits
   with cumulative distance from the muzzle. Damage is NOT applied yet.

   Each step we advance `revealedLen` by beamSpeed*dt. When the beam
   passes a hit's distance, we apply that hit's damage exactly once.
   That guarantees a single laser shot deals at most laserDamage to any
   given target — no stacking from multiple bounces touching the same
   barrier or turret.
   ===================================================================== */
function fireLaser(turret, angle) {
  const type = turret.type;
  const segments = [];
  const hits = [];
  // We track which bodies have been queued to receive damage so the same
  // barrier/turret can't appear twice in the hit list (in case the beam
  // re-enters from another bounce).
  const damagedBodies = new Set();

  let curX = turret.x + Math.cos(angle) * type.barrelLength;
  let curY = turret.y + Math.sin(angle) * type.barrelLength;
  let dx = Math.cos(angle), dy = Math.sin(angle);
  let bouncesLeft = type.laserBounces;
  let totalLen = 0;
  let stoppedAtTurret = false;

  while (bouncesLeft >= 0 && totalLen < CONFIG.laserMaxLength) {
    const hit = raycastNearest(curX, curY, dx, dy, turret.team.id);

    if (!hit) {
      // No surface to hit — beam shoots off into the void. Add a long
      // final segment so it visually flies off.
      const longLen = 2000;
      segments.push({
        x1: curX, y1: curY,
        x2: curX + dx * longLen, y2: curY + dy * longLen,
        startDist: totalLen, endDist: totalLen + longLen,
      });
      totalLen += longLen;
      break;
    }

    const ex = curX + dx * hit.t;
    const ey = curY + dy * hit.t;
    segments.push({
      x1: curX, y1: curY, x2: ex, y2: ey,
      startDist: totalLen,
      endDist:   totalLen + hit.t,
    });
    totalLen += hit.t;

    // Queue damage at this hit's distance — applied later when beam reaches it
    if (!damagedBodies.has(hit.body)) {
      damagedBodies.add(hit.body);
      hits.push({
        body:  hit.body,
        kind:  hit.kind,
        dist:  totalLen,
        ex, ey,
        applied: false,
      });
    }

    if (hit.kind === 'turret') {
      stoppedAtTurret = true;
      break;
    }

    if (bouncesLeft <= 0) break;
    bouncesLeft--;

    // Reflect direction
    [dx, dy] = reflectVector(dx, dy, hit.nx, hit.ny);
    // Nudge origin off the surface to avoid re-hitting it
    curX = ex + dx * 0.5;
    curY = ey + dy * 0.5;
  }

  lasers.push({
    team:        turret.team,
    ownerType:   turret.type,    // for type-color lookup in rendering
    segments,
    hits,
    totalLen,
    revealedLen: 0,
    beamSpeed:   CONFIG.laserBeamSpeed,
    fadeStart:   -1,            // set when fully revealed
    life:        type.laserLifetime,
    width:       type.laserWidth,
    laserDamage: type.laserDamage,
    stoppedAtTurret,
    // Hijack support: when set, segments past hijackedAt.dist are drawn
    // with hijackedAt.team / hijackedAt.ownerType, and damage along that
    // portion is attributed to the new team.
    hijackedAt:  null,
  });


  const muzzleColor = (turret.type.colors && turret.type.colors.primary)
                       ? turret.type.colors.primary
                       : turret.team.color;
  fx.push({ type: 'muzzle',
            x: turret.x + Math.cos(angle) * type.barrelLength,
            y: turret.y + Math.sin(angle) * type.barrelLength,
            born: now(), life: 250, color: muzzleColor });
  soundLaser();
}

// Apply a queued laser hit's damage to its target. Called at most once
// per hit, when the beam reveal reaches that hit's distance.
function applyLaserHit(L, hit) {
  if (hit.applied) return;
  hit.applied = true;
  const damage = L.laserDamage;

  // Owner team at this point along the beam (after possible hijack)
  const teamHere = laserTeamAt(L, hit.dist);
  const ownerTypeHere = laserOwnerTypeAt(L, hit.dist);
  const fxColor = (ownerTypeHere && ownerTypeHere.colors && ownerTypeHere.colors.primary)
                    ? ownerTypeHere.colors.primary
                    : (teamHere && teamHere.color) || '#ffffff';

  if (hit.kind === 'turret') {
    const target = hit.body;
    if (target.dead) return;
    // Don't friendly-fire: if a hijack has flipped this portion of the
    // beam to the target's own team, skip the damage.
    if (target.team === teamHere) {
      fx.push({ type: 'spark', x: hit.ex, y: hit.ey, born: now(), life: 180 });
      return;
    }
    target.hp -= damage;
    target.hp = Math.max(0, target.hp);
    target.hitFlashUntil = now() + 220;
    fx.push({ type: 'hit', x: hit.ex, y: hit.ey, born: now(), life: 320,
              color: fxColor });
    soundTurretHit();
    shakeAmount = Math.max(shakeAmount, 8);
    if (target.hp <= 0) {
      target.dead = true;
      fx.push({ type: 'bigexplosion', x: target.x, y: target.y,
                born: now(), life: 1200 });
      soundTurretHit();
      shakeAmount = Math.max(shakeAmount, CONFIG.maxShake);
      winner = turrets.find(x => x !== target && !x.dead);
      running = false;
      if (winner && statusEl) {
        statusEl.textContent = winner.type.name + ' wins!';
        const wc = turretColors(winner);
        statusEl.style.color = wc.primary || winner.team.color;
      }
    }
  } else if (hit.kind === 'barrier' && hit.body.destructible) {
    hit.body.hp -= 1;
    fx.push({ type: 'spark', x: hit.ex, y: hit.ey, born: now(), life: 180 });
    if (hit.body.hp <= 0) {
      hit.body.dead = true;
      fx.push({ type: 'explosion', x: hit.ex, y: hit.ey, born: now(), life: 360 });
    }
  } else {
    // Wall or indestructible barrier — just a spark
    fx.push({ type: 'spark', x: hit.ex, y: hit.ey, born: now(), life: 180 });
  }
}


/* ---- POINT-TO-SEGMENT DISTANCE (used by laser-vs-ball check) -------- */
function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const lenSq = sx * sx + sy * sy;
  if (lenSq < 1e-9) {
    const dx = px - x1, dy = py - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  let t = ((px - x1) * sx + (py - y1) * sy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * sx, cy = y1 + t * sy;
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Same as pointToSegmentDist but also returns the param t along the
// segment (0..1) of the closest point. Used to figure out how far along
// the beam the contact happened, so we can split the laser at that
// point when a Hijack ball touches it.
function pointToSegmentInfo(px, py, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const lenSq = sx * sx + sy * sy;
  if (lenSq < 1e-9) {
    const dx = px - x1, dy = py - y1;
    return { dist: Math.sqrt(dx * dx + dy * dy), t: 0 };
  }
  let t = ((px - x1) * sx + (py - y1) * sy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * sx, cy = y1 + t * sy;
  const dx = px - cx, dy = py - cy;
  return { dist: Math.sqrt(dx * dx + dy * dy), t };
}

// Resolve which team "owns" the laser at a given distance along it.
// Before any hijack, that's L.team. After a hijack at distance H, the
// portion at d >= H belongs to L.hijackedAt.team.
function laserTeamAt(L, d) {
  const hj = L.hijackedAt;
  if (hj && d >= hj.dist) return hj.team;
  return L.team;
}
function laserOwnerTypeAt(L, d) {
  const hj = L.hijackedAt;
  if (hj && d >= hj.dist) return hj.ownerType;
  return L.ownerType;
}


/* ---- LASER STEP (call every game step) ------------------------------ */
// 1) advance reveal length
// 2) apply any pending hits the beam has now reached
// 3) for revealed portion of beam: damage opposing balls within range
//    (damage = CONFIG.laserBulletDamage per frame; balls with bulletPower
//    > 1 take multiple frames to die — sniper bullets resist briefly)
// 4) cull beams that have fully faded
function updateLasers() {
  if (lasers.length === 0) return;
  // Approximate dt — we run at fixed 60 Hz physics
  const dt = 1 / 60;

  for (const L of lasers) {
    if (L.fadeStart < 0) {
      L.revealedLen += L.beamSpeed * dt;
      if (L.revealedLen >= L.totalLen) {
        L.revealedLen = L.totalLen;
        L.fadeStart = timeSec;
      }
    }
    // Apply damage to targets the beam has now reached
    for (const hit of L.hits) {
      if (!hit.applied && L.revealedLen >= hit.dist) {
        applyLaserHit(L, hit);
      }
    }

    // Damage opposing balls inside the revealed beam.
    // Also: a Hijack ball that touches an opposing beam re-colors the
    // beam from the touch point onward to the hijacker's team.
    const collisionRadius = L.width + CONFIG.laserCollisionWidth;
    for (const b of balls) {
      if (b.dead) continue;
      const r = b.r || 8;
      const threshold = r + collisionRadius;
      for (const seg of L.segments) {
        // Only consider portion of segment that's revealed
        if (seg.startDist >= L.revealedLen) break;
        let segEndDist = seg.endDist;
        let x2 = seg.x2, y2 = seg.y2;
        if (seg.endDist > L.revealedLen) {
          // Truncate this segment at the reveal frontier
          const t = (L.revealedLen - seg.startDist) / (seg.endDist - seg.startDist);
          x2 = seg.x1 + (seg.x2 - seg.x1) * t;
          y2 = seg.y1 + (seg.y2 - seg.y1) * t;
          segEndDist = L.revealedLen;
        }
        const info = pointToSegmentInfo(b.position.x, b.position.y,
                                        seg.x1, seg.y1, x2, y2);
        if (info.dist >= threshold) continue;

        // Distance along the whole beam where contact happened
        const segLen = segEndDist - seg.startDist;
        const distAtBall = seg.startDist + info.t * segLen;
        const beamTeamHere = laserTeamAt(L, distAtBall);

        // A Hijack ball that touches a beam owned by an opposing team
        // hijacks the beam from this point forward. The ball is consumed.
        if (b.kind === 'hijack' && b.team !== beamTeamHere) {
          // First hijack on this beam, OR a later hijack re-flipping past
          // an existing hijack point. We always set hijackedAt to the
          // closer-to-source contact (so the visible split is at the most
          // recent change). For simplicity we just overwrite.
          L.hijackedAt = {
            dist:      distAtBall,
            team:      b.team,
            ownerType: b.ownerType || (b.type ? b.type : null),
          };
          // Sparkle at the hijack point
          fx.push({ type: 'pickupRing',
                    x: b.position.x, y: b.position.y,
                    born: now(), life: 420,
                    color: (b.team && b.team.color) || '#ffffff' });
          // Consume the hijack ball
          b.dead = true;
          if (typeof soundHijack === 'function') soundHijack();
          break;
        }

        // Otherwise: only damage if the ball is on a team that opposes
        // the beam at this point.
        if (b.team === beamTeamHere) break;

        b.hp = (b.hp != null ? b.hp : (b.bulletPower || 1));
        b.hp -= CONFIG.laserBulletDamage;
        fx.push({ type: 'spark', x: b.position.x, y: b.position.y,
                  born: now(), life: 120 });
        if (b.hp <= 0) b.dead = true;
        break;
      }
    }
  }

  // Cull faded lasers
  lasers = lasers.filter(L => {
    if (L.fadeStart < 0) return true;
    return (timeSec - L.fadeStart) < L.life;
  });
}


/* =====================================================================
   CLUSTER  —  on-death shrapnel spray
   =====================================================================
   Called when a CLUSTER ball dies for any reason (hit a turret, hit
   another ball, bounced too many times, hit an HP barrier, etc).
   Spawns N shrapnel bullets in a circle around the death point.
   ===================================================================== */
function spawnShrapnel(ball) {
  const t = ball.cluster;
  if (!t) return;
  const count = t.count;
  const baseAngle = Math.random() * Math.PI * 2;
  const isRed = ball.team === RED;
  const enemyBarrier = isRed ? CAT_BLUE_BARRIER : CAT_RED_BARRIER;
  const enemyBall    = isRed ? CAT_BLUE_BALL    : CAT_RED_BALL;
  const enemyTurret  = isRed ? CAT_BLUE_TURRET  : CAT_RED_TURRET;

  for (let i = 0; i < count; i++) {
    const a = baseAngle + (i / count) * Math.PI * 2;
    const sx = ball.position.x + Math.cos(a) * (ball.r + 2);
    const sy = ball.position.y + Math.sin(a) * (ball.r + 2);
    const body = Bodies.circle(sx, sy, t.radius, {
      restitution: 1, friction: 0, frictionAir: 0, density: 0.001,
      collisionFilter: {
        category: isRed ? CAT_RED_BALL : CAT_BLUE_BALL,
        mask: CAT_WALL | CAT_NEUTRAL_BARRIER | enemyBarrier |
              CAT_POWERUP | enemyBall | enemyTurret,
      },
    });
    body.isBall   = true;
    body.team     = ball.team;
    body.damage   = t.damage;
    body.r        = t.radius;
    body.born     = timeSec;
    body.lifetime = t.lifetime;
    body.kind     = 'shrapnel';
    body.bulletPower  = 1;
    body.hp           = 1;
    body.bounces      = 0;
    body.maxBounces   = t.maxBounces;
    body.trail = [];
    Body.setVelocity(body, { x: Math.cos(a) * t.speed, y: Math.sin(a) * t.speed });
    balls.push(body);
    World.add(engine.world, body);
  }
  soundShrapnel();

  // Colorful burst FX — one spark per shrapnel in a bright rainbow palette
  const BURST_COLORS = ['#e67e22','#f1c40f','#e74c3c','#9b59b6','#2ecc71','#3498db','#ff6b9d','#ffffff'];
  const bsparks = [];
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (i / count) * Math.PI * 2;
    const spd = 60 + Math.random() * 80;
    bsparks.push({ vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                   color: BURST_COLORS[i % BURST_COLORS.length] });
  }
  fx.push({ type: 'clusterburst', x: ball.position.x, y: ball.position.y,
            born: now(), life: 600, sparks: bsparks });
}


/* =====================================================================
   SLIME  —  on-impact stationary puddle spawn
   =====================================================================
   Spawns N stationary slime puddles around the glob's death position.
   Each puddle is a destructible barrier on the SAME team as the glob,
   so own-team slime globs and bullets pass through (per the existing
   asymmetric per-team barrier filter), while enemy bullets collide.
   Puddles have HP (slimePuddleHp) and a lifetime (slimePuddleLifetime).
   ===================================================================== */
function spawnSlimePuddles(ball) {
  const s = ball.slime;
  if (!s) return;
  const isRed = ball.team === RED;
  const teamStr = isRed ? 'red' : (ball.team === BLUE ? 'blue' : 'neutral');
  const cx = ball.position.x;
  const cy = ball.position.y;
  // Same per-team filter rules as a regular barrier
  const category = isRed ? CAT_RED_BARRIER : CAT_BLUE_BARRIER;
  const mask     = isRed ? CAT_BLUE_BALL   : CAT_RED_BALL;

  for (let i = 0; i < s.count; i++) {
    const ang = (i / s.count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = (0.25 + Math.random() * 0.75) * s.spread;
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist;
    const r  = s.radius * (0.85 + Math.random() * 0.3);

    const body = Bodies.circle(px, py, r, {
      isStatic: true, restitution: 1, friction: 0,
      collisionFilter: { category, mask },
    });
    body.isBarrier     = true;
    body.team          = teamStr;
    body.destructible  = true;
    body.hp            = s.hp;
    body.maxHp         = s.hp;
    // Provide w/h for any code that reads barrier dimensions (renderer)
    body.w = r * 2; body.h = r * 2;
    body.color         = null;
    body.tracksTurret  = null;
    body.trackOffsetY  = 0;
    body.isShield      = false;
    body.isSlimePuddle = true;
    body.slimeRadius   = r;
    body.slimeBornSec  = timeSec;
    body.slimeLifetime = s.lifetime;
    body.ownerType     = ball.ownerType || null;

    barriers.push(body);
    World.add(engine.world, body);
  }
  const fxColor = (ball.ownerType && ball.ownerType.colors && ball.ownerType.colors.primary)
                    ? ball.ownerType.colors.primary
                    : '#2ecc71';
  fx.push({ type: 'hit', x: cx, y: cy, born: now(), life: 280, color: fxColor });
}


/* =====================================================================
   MISSILE  —  homing steering
   =====================================================================
   Every step, gently steer the missile's velocity toward the nearest
   enemy turret. Cap the turn rate so it can't snap-track instantly.
   ===================================================================== */
function steerMissile(ball) {
  // Find nearest enemy turret
  let target = null, bestDist = Infinity;
  for (const t of turrets) {
    if (t.dead) continue;
    if (t.team === ball.team) continue;
    const dx = t.x - ball.position.x;
    const dy = t.y - ball.position.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; target = t; }
  }
  if (!target) return;

  const px = ball.position.x;
  const py = ball.position.y;

  // Attraction: unit vector toward target
  const tdx = target.x - px;
  const tdy = target.y - py;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  let forceX = tdx / tlen;
  let forceY = tdy / tlen;

  // Repulsion: steer away from barriers that are close ahead.
  // Weight falls off quadratically so it's strong up close and fades
  // at the detection radius — in crowded maps it may still hit, but
  // it won't fly directly into an obvious obstacle.
  const AVOID_R   = 90;   // px from barrier edge
  const REPULSION = 2.2;
  for (const b of barriers) {
    // Only avoid solid barriers — skip sensors (slime puddles, banana peels)
    // so their forces don't overwhelm homing in packed arenas.
    if (b.dead || b.isSlimePuddle || b.isBananaPeel) continue;
    const dx = px - b.position.x;
    const dy = py - b.position.y;
    const centerDist = Math.sqrt(dx * dx + dy * dy) || 1;
    const edgeDist   = Math.max(1, centerDist - 22);
    if (edgeDist > AVOID_R) continue;
    const w = Math.pow(1 - edgeDist / AVOID_R, 2);
    forceX += (dx / centerDist) * w * REPULSION;
    forceY += (dy / centerDist) * w * REPULSION;
  }

  const desiredAngle = Math.atan2(forceY, forceX);

  const v = ball.velocity;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y) || 1;
  const currentAngle = Math.atan2(v.y, v.x);
  let delta = desiredAngle - currentAngle;
  while (delta >  Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const turnRate = ball.missileTurnRate || 0.05;
  const clamped = Math.max(-turnRate, Math.min(turnRate, delta));
  const newAngle = currentAngle + clamped;
  Body.setVelocity(ball, {
    x: Math.cos(newAngle) * speed,
    y: Math.sin(newAngle) * speed,
  });
  ball.facing = newAngle;
}


/* =====================================================================
   HIJACK  —  flip an opposing ball's team
   =====================================================================
   Called by game.js collision logic. Returns true if the conversion
   happened (caller should consume the hijack ball but NOT the target).
   ===================================================================== */
function hijackBall(hijackBall, target) {
  if (!target || target.dead) return false;
  if (target.team === hijackBall.team) return false;

  const newTeam = hijackBall.team;
  const newCat  = newTeam === RED ? CAT_RED_BALL : CAT_BLUE_BALL;
  const enemyBarrier = newTeam === RED ? CAT_BLUE_BARRIER : CAT_RED_BARRIER;
  const enemyBall    = newTeam === RED ? CAT_BLUE_BALL    : CAT_RED_BALL;
  const enemyTurret  = newTeam === RED ? CAT_BLUE_TURRET  : CAT_RED_TURRET;

  // Flag the original turret with a purple glow before we flip the team
  const originalTurret = turrets.find(t => !t.dead && t.team === target.team);
  if (originalTurret) originalTurret.hijackedGlowUntil = now() + 1800;

  target.team = newTeam;
  target.collisionFilter = {
    category: newCat,
    mask: CAT_WALL | CAT_NEUTRAL_BARRIER | enemyBarrier |
          CAT_POWERUP | enemyBall | enemyTurret,
  };
  // Update ownerType so the converted bullet renders in hijack colours
  target.ownerType = hijackBall.ownerType;
  // Visual sparkle on conversion
  fx.push({ type: 'pickupRing', x: target.position.x, y: target.position.y,
            born: now(), life: 400, color: newTeam.color });
  // Reset bullet HP so the converted ball is fresh
  target.hp = target.bulletPower || 1;
  return true;
}


/* =====================================================================
   POISON  —  apply / tick stacks on turrets
   =====================================================================
   Each stack is { ticksLeft }. Stacks tick at CONFIG.poisonTickInterval;
   each tick deals poisonDamage * stackCount to the turret.
   ===================================================================== */
function applyPoison(turret, ball) {
  const type = ball.poisonType || {};
  const stacks = type.stacksApplied || 1;
  const damage = type.damage || 1;
  if (!turret.poisonStacks) turret.poisonStacks = [];
  for (let i = 0; i < stacks; i++) {
    turret.poisonStacks.push({
      ticksLeft: CONFIG.poisonStackDuration,
      damage,
    });
  }
  turret.poisonNextTick = (turret.poisonNextTick != null && turret.poisonNextTick > timeSec)
    ? turret.poisonNextTick
    : timeSec + CONFIG.poisonTickInterval;
  // Visual hint: green glow over the turret
  fx.push({ type: 'pickupRing', x: turret.x, y: turret.y,
            born: now(), life: 350, color: '#3fff8a' });
}

function tickPoison() {
  for (const t of turrets) {
    if (t.dead) continue;
    if (!t.poisonStacks || t.poisonStacks.length === 0) continue;
    if (t.poisonNextTick == null || timeSec < t.poisonNextTick) continue;
    // Tick all stacks
    let total = 0;
    for (const s of t.poisonStacks) total += s.damage;
    t.hp -= total;
    t.hp = Math.max(0, t.hp);
    fx.push({ type: 'spark', x: t.x + (Math.random()-0.5)*30, y: t.y,
              born: now(), life: 180 });
    // Decrement durations and remove expired
    for (const s of t.poisonStacks) s.ticksLeft -= 1;
    t.poisonStacks = t.poisonStacks.filter(s => s.ticksLeft > 0);
    t.poisonNextTick = timeSec + CONFIG.poisonTickInterval;
    // Death check
    if (t.hp <= 0) {
      t.dead = true;
      fx.push({ type: 'bigexplosion', x: t.x, y: t.y, born: now(), life: 1200 });
      soundTurretHit();
      shakeAmount = Math.max(shakeAmount, CONFIG.maxShake);
      winner = turrets.find(x => x !== t && !x.dead);
      running = false;
      if (winner && statusEl) {
        statusEl.textContent = winner.type.name + ' wins!';
        const wc = turretColors(winner);
        statusEl.style.color = wc.primary || winner.team.color;
      }
    }
  }
}


/* =====================================================================
   BANANA PEEL  —  deflecting floor hazard spawned on banana death
   =====================================================================
   A neutral sensor barrier (isBananaPeel=true). Any ball that touches
   it is deflected ~90° sideways. The peel is consumed after 2 hits or
   expires after bananaPeelLifetime seconds.
   ===================================================================== */
function spawnBananaPeel(ball) {
  const angle = Math.random() * Math.PI;   // random flat orientation
  const pw = 28, ph = 9;
  const body = Bodies.rectangle(ball.position.x, ball.position.y, pw, ph, {
    isStatic: true,
    isSensor: true,   // no physics push — just triggers collision events
    collisionFilter: {
      category: CAT_NEUTRAL_BARRIER,
      mask: CAT_RED_BALL | CAT_BLUE_BALL,
    },
  });
  Body.setAngle(body, angle);
  body.isBarrier    = true;
  body.isBananaPeel = true;
  body.team         = 'neutral';
  body.destructible = true;
  body.hp           = 2;
  body.maxHp        = 2;
  body.w            = pw;
  body.h            = ph;
  body.color        = '#e8d040';
  body.tracksTurret = null;
  body.trackOffsetY = 0;
  body.isShield     = false;
  body.isSlimePuddle = false;
  body.peelBornSec  = timeSec;
  body.peelLifetime = (ball.ownerType && ball.ownerType.bananaPeelLifetime) || 9;

  barriers.push(body);
  World.add(engine.world, body);
}
