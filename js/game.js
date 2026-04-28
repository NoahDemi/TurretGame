/* =====================================================================
   GAME ENGINE — world construction, physics, collisions, step loop
   =====================================================================
   Reads from:  CONFIG, SCENARIO, SCENARIOS, TURRET_TYPES, RED, BLUE,
                CAT_* categories, sound* functions, asciiToBarriers,
                fireLaser, updateLasers, spawnShrapnel, spawnSlimePuddles,
                steerMissile, hijackBall, applyPoison, tickPoison
   Writes:      engine, balls, barriers, powerups, fx, turrets, timeSec,
                nextPowerupAt, winner, running, speedMul, shakeAmount,
                redTypeId, blueTypeId, arenaWalls, lasers
   ===================================================================== */

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

// --- Game state (globals shared with rendering/main/weapons) ----------
let engine;
let balls    = [];
let barriers = [];
let powerups = [];
let fx       = [];
let turrets  = [];
let arenaWalls = [];                 // outer arena walls (used by laser raycaster)
let timeSec  = 0;
let nextPowerupAt = 0;
let winner      = null;
let running     = false;
let introUntil  = 0;   // performance.now() timestamp while intro overlay is shown
let rafId;
let lastFrame = 0;
let speedMul  = 1;
let shakeAmount = 0;

// Which turret types are selected for each team (main.js updates these)
let redTypeId  = DEFAULT_RED_TYPE;
let blueTypeId = DEFAULT_BLUE_TYPE;


/* ---- UTILITIES ------------------------------------------------------- */
function now()                { return performance.now(); }
function rand(a, b)           { return a + Math.random() * (b - a); }
function clamp(v, a, b)       { return Math.max(a, Math.min(b, v)); }
function choice(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }


/* ---- WORLD CONSTRUCTION --------------------------------------------- */
function buildWorld() {
  engine = Engine.create();
  engine.gravity.y = 0;
  balls      = [];
  barriers   = [];
  powerups   = [];
  fx         = [];
  turrets    = [];
  arenaWalls = [];
  lasers     = [];   // from weapons.js
  timeSec    = 0;
  nextPowerupAt = CONFIG.powerupSpawnEvery;
  winner = null;
  shakeAmount = 0;

  const W = CONFIG.width, H = CONFIG.height;
  const wallOpts = {
    isStatic: true, restitution: 1, friction: 0,
    collisionFilter: { category: CAT_WALL, mask: CAT_RED_BALL | CAT_BLUE_BALL },
  };

  const addWall = (x, y, w, h) => {
    const body = Bodies.rectangle(x, y, w, h, wallOpts);
    body.isWall = true;
    body.w = w; body.h = h;     // raycaster reads these
    arenaWalls.push(body);
    World.add(engine.world, body);
  };
  // Outer arena walls
  addWall(-10,  H / 2, 20, H);
  addWall(W + 10, H / 2, 20, H);
  addWall(W / 2, -10, W, 20);
  addWall(W / 2, H + 10, W, 20);

  // Barriers from scenario (ASCII grid -> specs).
  // Pass the full scenario so per-scenario `legend` overrides can apply.
  const specs = asciiToBarriers(SCENARIO);
  specs.forEach(s => createBarrier(s));

  // Two turrets — using player-selected types
  const redType  = TURRET_TYPES[redTypeId]  || TURRET_TYPES[DEFAULT_RED_TYPE];
  const blueType = TURRET_TYPES[blueTypeId] || TURRET_TYPES[DEFAULT_BLUE_TYPE];
  turrets.push(createTurret(RED,  redType,  W / 2, 60,     1));  // red at top, fires DOWN
  turrets.push(createTurret(BLUE, blueType, W / 2, H - 60, -1)); // blue at bottom, fires UP

  // Collision handler
  Events.on(engine, 'collisionStart', e => {
    e.pairs.forEach(pair => handleCollision(pair.bodyA, pair.bodyB));
  });
}


/* ---- TURRET ---------------------------------------------------------- */
function createTurret(team, type, x, y, aimDir) {
  const isRed = team === RED;
  const body = Bodies.rectangle(x, y, type.turretWidth, type.turretHeight, {
    isStatic: true,
    isSensor: true,
    collisionFilter: {
      category: isRed ? CAT_RED_TURRET : CAT_BLUE_TURRET,
      mask: isRed ? CAT_BLUE_BALL : CAT_RED_BALL,
    },
  });
  body.isTurret = true;
  body.team = team;
  World.add(engine.world, body);

  return {
    team, type, x, y, body,
    aimDir,
    hp: type.hp,
    maxHp: type.hp,
    vx: (isRed ? 1 : -1) * type.moveSpeed,
    aimPhase: Math.random() * Math.PI * 2,
    aimAngle: aimDir * Math.PI / 2,
    nextFire: now() + 600 + Math.random() * 400,
    fireMult: 1,
    fireMultUntil: 0,
    multiShotLeft: 0,
    shieldBarrier: null,    // active shield power-up barrier (if any)
    poisonStacks: [],       // active poison DoT stacks
    poisonNextTick: null,
    slimeDamagedAt: -Infinity,
    slimeSlowUntil: 0,
    hijackedGlowUntil: 0,
  };
}


/* ---- BARRIER (destructible OR indestructible wall, per-team) -------- */
function createBarrier(spec) {
  const { x, y, w, h } = spec;
  const team = spec.team || 'neutral';
  const isDestructible = typeof spec.hp === 'number';
  const hp = isDestructible ? spec.hp : null;

  let category, mask;
  if (team === 'red') {
    category = CAT_RED_BARRIER;
    mask = CAT_BLUE_BALL;
  } else if (team === 'blue') {
    category = CAT_BLUE_BARRIER;
    mask = CAT_RED_BALL;
  } else {
    category = CAT_NEUTRAL_BARRIER;
    mask = CAT_RED_BALL | CAT_BLUE_BALL;
  }

  const body = Bodies.rectangle(x, y, w, h, {
    isStatic: true, restitution: 1, friction: 0,
    collisionFilter: { category, mask },
  });
  body.isBarrier    = true;
  body.team         = team;
  body.destructible = isDestructible;
  body.hp           = hp;
  body.maxHp        = hp;
  body.w = w; body.h = h;
  // Neutral barriers get a random vibrant color for visual variety
  const NEUTRAL_PALETTE = [
    '#8e44ad','#2980b9','#16a085','#d35400','#c0392b',
    '#e91e63','#00bcd4','#ff9800','#27ae60','#ff5722',
    '#673ab7','#0097a7','#e65100','#2e7d32','#ad1457',
  ];
  body.color = spec.color || (team === 'neutral'
    ? NEUTRAL_PALETTE[Math.floor(Math.random() * NEUTRAL_PALETTE.length)]
    : null);
  body.tracksTurret = spec.tracksTurret || null;
  body.trackOffsetY = spec.trackOffsetY || 0;
  // Shields are spawned via power-up; mark them so they don't drop
  // fresh power-ups when broken (avoiding infinite-shield loops).
  body.isShield     = !!spec.isShield;

  barriers.push(body);
  World.add(engine.world, body);
  return body;
}


/* ---- BALL ------------------------------------------------------------ */
// Generic ball factory used by all "ball-shaped" weapon types.
// Set body.kind to one of: 'standard'|'sniper'|'cluster'|'missile'|
// 'hijack'|'poison'|'shrapnel'.
function createBall(turret, angle) {
  const isRed = turret.team === RED;
  const type = turret.type;
  const x = turret.x + Math.cos(angle) * type.barrelLength;
  const y = turret.y + Math.sin(angle) * type.barrelLength;

  const enemyBarrier = isRed ? CAT_BLUE_BARRIER : CAT_RED_BARRIER;
  const enemyBall    = isRed ? CAT_BLUE_BALL    : CAT_RED_BALL;
  const enemyTurret  = isRed ? CAT_BLUE_TURRET  : CAT_RED_TURRET;

  const body = Bodies.circle(x, y, type.ballRadius, {
    restitution: 1, friction: 0, frictionAir: 0, density: 0.001,
    collisionFilter: {
      category: isRed ? CAT_RED_BALL : CAT_BLUE_BALL,
      mask: CAT_WALL | CAT_NEUTRAL_BARRIER | enemyBarrier |
            CAT_POWERUP | enemyBall | enemyTurret,
    },
  });
  body.isBall      = true;
  body.team        = turret.team;
  body.damage      = type.ballDamage;
  body.r           = type.ballRadius;
  body.born        = timeSec;
  body.lifetime    = CONFIG.ballLifetime;
  body.trail       = [];
  body.bounces     = 0;
  body.maxBounces  = (type.ballMaxBounces != null)
                       ? type.ballMaxBounces
                       : CONFIG.defaultBallMaxBounces;
  body.bulletPower = type.bulletPower != null ? type.bulletPower : 1;
  body.hp          = body.bulletPower;     // ball-vs-ball HP
  body.kind        = type.weaponType || 'standard';

  // Per-weapon attachments
  if (body.kind === 'cluster') {
    body.cluster = {
      count:    type.shrapnelCount || 6,
      speed:    type.shrapnelSpeed || 5,
      damage:   type.shrapnelDamage || 3,
      radius:   type.shrapnelRadius || 4,
      lifetime: type.shrapnelLifetime || 1.5,
      maxBounces: type.shrapnelMaxBounces || 1,
    };
  }
  if (body.kind === 'missile') {
    body.missileTurnRate = type.missileTurnRate || 0.05;
    body.lifetime        = type.missileLifetime || 12;
    body.facing          = angle;
  }
  if (body.kind === 'poison') {
    body.poisonType = {
      damage:         type.poisonDamage || 1,
      stacksApplied:  type.poisonStacksApplied || 1,
    };
  }
  if (body.kind === 'sniper') {
    body.facing = angle;
  }
  if (body.kind === 'slime') {
    body.slime = {
      count:    type.slimePuddleCount    || 6,
      radius:   type.slimePuddleRadius   || 10,
      hp:       type.slimePuddleHp       || 3,
      lifetime: type.slimePuddleLifetime || 8,
      spread:   type.slimePuddleSpread   || 40,
    };
  }
  if (body.kind === 'brainrot') {
    const BRAINROT_COLORS = ['#ff006e','#fb5607','#ffbe0b','#8338ec','#3a86ff','#06d6a0','#ff4d6d','#f72585'];
    body.brainrotDigit = Math.random() < 0.5 ? '6' : '7';
    body.brainrotColor = BRAINROT_COLORS[Math.floor(Math.random() * BRAINROT_COLORS.length)];
  }
  if (body.kind === 'orbit') {
    body.orbitAngularSpeed = type.orbitAngularSpeed || 0.12;
    body.orbitRadius       = type.orbitRadius       || 30;
    body.forwardVx         = Math.cos(angle) * type.ballSpeed;
    body.forwardVy         = Math.sin(angle) * type.ballSpeed;
    body.orbitPhase0       = 0;  // set to 0 or π by fire()
    body.orbitFrame        = 0;  // exact frame counter — no drift
    body.orbitSpawnX       = x;
    body.orbitSpawnY       = y;
  }

  Body.setVelocity(body, {
    x: Math.cos(angle) * type.ballSpeed,
    y: Math.sin(angle) * type.ballSpeed,
  });
  // Stamp owner type so renderer can pick the per-type color even after
  // the ball outlives its turret or gets hijacked.
  body.ownerType = turret.type;

  balls.push(body);
  World.add(engine.world, body);
  const muzzleColor = (turret.type.colors && turret.type.colors.primary)
                        ? turret.type.colors.primary
                        : turret.team.color;
  fx.push({ type: 'muzzle', x, y, born: now(), life: 180, color: muzzleColor });

  // Per-weapon launch sound (laser uses fireLaser path; not handled here)
  switch (body.kind) {
    case 'sniper':  soundSniper(); break;
    case 'missile': soundMissileLaunch(); break;
    case 'poison':  soundPoison(); break;
    case 'hijack':  soundHijack(); break;
    case 'slime':   soundPoison(); break;
    case 'orbit':      soundHijack(); break;
    case 'brainrot':   soundBrainrotShoot(); break;
    case 'looksmaxx':  soundLooksmaxx(); break;
    default:
      if (isRed) soundRedHit(); else soundBlueHit();
      break;
  }
}


/* ---- POWER-UP -------------------------------------------------------- */
function createPowerup(puType, x, y) {
  if (x == null) x = rand(100, CONFIG.width - 100);
  if (y == null) y = rand(CONFIG.height * 0.3, CONFIG.height * 0.7);
  const body = Bodies.circle(x, y, CONFIG.powerupRadius, {
    isStatic: true, isSensor: true,
    collisionFilter: {
      category: CAT_POWERUP,
      mask: CAT_RED_BALL | CAT_BLUE_BALL,
    },
  });
  body.isPowerup = true;
  body.puType = puType;
  powerups.push(body);
  World.add(engine.world, body);
}

// Called when a destructible barrier is destroyed. Rolls
// CONFIG.barrierDropChance; if it hits, spawns a power-up at the
// barrier's position drawn from the scenario's powerupPool.
function maybeDropPowerup(barrier) {
  if (!CONFIG.powerupEnabled) return;
  if (barrier.isShield) return;     // shields don't drop power-ups
  if (Math.random() > CONFIG.barrierDropChance) return;
  const pool = SCENARIO.powerupPool;
  if (!pool || pool.length === 0) return;
  createPowerup(choice(pool), barrier.position.x, barrier.position.y);
}


/* =====================================================================
   COLLISION LOGIC
   ===================================================================== */
function handleCollision(a, b) {
  // Ball vs Ball -- opposite teams (filter guarantees team mismatch)
  if (a.isBall && b.isBall) {
    handleBallVsBall(a, b);
    return;
  }
  // Ball vs Turret
  if (a.isTurret && b.isBall) { damageTurret(a, b); return; }
  if (b.isTurret && a.isBall) { damageTurret(b, a); return; }
  // Ball vs Barrier (destructible or wall)
  if (a.isBarrier && b.isBall) { damageBarrier(a, b); return; }
  if (b.isBarrier && a.isBall) { damageBarrier(b, a); return; }
  // Ball vs outer arena Wall (counts as a bounce)
  if (a.isWall && b.isBall) { soundWallBounce(); bounceBall(b); return; }
  if (b.isWall && a.isBall) { soundWallBounce(); bounceBall(a); return; }
  // Ball vs Power-up
  if (a.isPowerup && b.isBall) { applyPowerup(a, b.team); return; }
  if (b.isPowerup && a.isBall) { applyPowerup(b, a.team); return; }
}

function playBallHit(ball) {
  soundBounce(ball);
}

// Two opposing balls have collided. Resolve based on bullet power.
//   Each ball loses HP equal to opposing ball's power.
//   <=0 HP -> dies (with explosion fx)
//
// Special weapon types intervene first:
//   HIJACK ball -> flips opposing ball to its team, dies itself
//   CLUSTER ball that dies -> spawns shrapnel
//   MISSILE -> just dies (low HP, no special)
function handleBallVsBall(a, b) {
  const pos = {
    x: (a.position.x + b.position.x) / 2,
    y: (a.position.y + b.position.y) / 2,
  };

  // Hijack handling
  if (a.kind === 'hijack' && b.kind !== 'hijack') {
    if (hijackBall(a, b)) {
      a.dead = true;
      fx.push({ type: 'explosion', x: pos.x, y: pos.y, born: now(), life: 240 });
      shakeAmount = Math.max(shakeAmount, 2);
      return;
    }
  }
  if (b.kind === 'hijack' && a.kind !== 'hijack') {
    if (hijackBall(b, a)) {
      b.dead = true;
      fx.push({ type: 'explosion', x: pos.x, y: pos.y, born: now(), life: 240 });
      shakeAmount = Math.max(shakeAmount, 2);
      return;
    }
  }

  // Standard HP-based resolution
  const aPow = a.bulletPower || 1;
  const bPow = b.bulletPower || 1;
  a.hp = (a.hp != null ? a.hp : aPow) - bPow;
  b.hp = (b.hp != null ? b.hp : bPow) - aPow;

  let anyDied = false;
  if (a.hp <= 0) { if (a.kind === 'cluster') spawnShrapnel(a); if (a.kind === 'slime') spawnSlimePuddles(a); if (a.kind === 'banana') spawnBananaPeel(a); a.dead = true; anyDied = true; }
  if (b.hp <= 0) { if (b.kind === 'cluster') spawnShrapnel(b); if (b.kind === 'slime') spawnSlimePuddles(b); if (b.kind === 'banana') spawnBananaPeel(b); b.dead = true; anyDied = true; }

  if (anyDied) {
    fx.push({ type: 'explosion', x: pos.x, y: pos.y, born: now(), life: 350 });
    soundClash();
    shakeAmount = Math.max(shakeAmount, 3);
  } else {
    // Both survived -- just a glancing impact spark
    fx.push({ type: 'spark', x: pos.x, y: pos.y, born: now(), life: 160 });
  }
}

function damageTurret(turretBody, ball) {
  const t = turrets.find(x => x.body === turretBody);
  if (!t) return;
  t.hp -= (ball.damage || 6);
  t.hp = Math.max(0, t.hp);
  t.hitFlashUntil = now() + 180;

  // Poison ball applies a stack instead of (in addition to) base damage
  if (ball.kind === 'poison') {
    applyPoison(t, ball);
  }

  if (ball.kind === 'cluster') spawnShrapnel(ball);
  if (ball.kind === 'slime')   spawnSlimePuddles(ball);
  if (ball.kind === 'banana')  spawnBananaPeel(ball);

  ball.dead = true;
  const hitColor = (ball.ownerType && ball.ownerType.colors && ball.ownerType.colors.primary)
                     ? ball.ownerType.colors.primary
                     : ball.team.color;
  fx.push({ type: 'hit', x: ball.position.x, y: ball.position.y,
            born: now(), life: 280, color: hitColor });
  soundTurretHit();
  shakeAmount = Math.max(shakeAmount, 6);
  if (t.hp <= 0) {
    t.hp = 0;
    t.dead = true;
    fx.push({ type: 'bigexplosion', x: t.x, y: t.y, born: now(), life: 1200 });
    soundTurretHit();
    shakeAmount = Math.max(shakeAmount, CONFIG.maxShake);
    winner = turrets.find(x => x !== t && !x.dead);
    running = false;
    if (winner && statusEl) {
      statusEl.textContent = winner.type.name + ' wins!';
      const wColors = turretColors(winner);
      statusEl.style.color = wColors.primary || winner.team.color;
    }
  }
}

function damageBarrier(barrier, ball) {
  fx.push({ type: 'spark', x: ball.position.x, y: ball.position.y,
            born: now(), life: 180 });
  playBallHit(ball);

  // Banana peel: deflect ball sideways, consume a peel HP, don't kill ball
  if (barrier.isBananaPeel) {
    const v    = ball.velocity;
    const dir  = Math.random() < 0.5 ? 1 : -1;
    const spd  = Math.sqrt(v.x * v.x + v.y * v.y);
    const ang  = Math.atan2(v.y, v.x) + dir * (Math.PI * 0.42 + Math.random() * Math.PI * 0.4);
    Body.setVelocity(ball, { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd });
    fx.push({ type: 'spark', x: ball.position.x, y: ball.position.y, born: now(), life: 300 });
    barrier.hp -= 1;
    if (barrier.hp <= 0) removeBarrier(barrier);
    return; // ball survives — just deflected
  }

  if (!barrier.destructible) {
    // Indestructible wall: bounce, no damage
    bounceBall(ball);
    return;
  }

  // Destructible HP barrier:
  // Matter.js has already applied the velocity reflection by the time this
  // handler runs, so the ball bounces physically unless we mark it dead.
  // Damage the barrier first, then decide ball fate based on bounce count.

  barrier.hp -= 1;
  if (barrier.hp <= 0) {
    fx.push({ type: 'explosion', x: barrier.position.x, y: barrier.position.y,
              born: now(), life: 400 });
    shakeAmount = Math.max(shakeAmount, 3);
    maybeDropPowerup(barrier);
    removeBarrier(barrier);
  }

  ball.bounces = (ball.bounces || 0) + 1;
  const cap = (ball.maxBounces != null) ? ball.maxBounces : CONFIG.defaultBallMaxBounces;

  if (ball.bounces >= cap) {
    // Used all bounces — dies on this hit
    if (ball.kind === 'cluster') spawnShrapnel(ball);
    if (ball.kind === 'slime')   spawnSlimePuddles(ball);
    if (ball.kind === 'banana')  spawnBananaPeel(ball);
    ball.dead = true;
    fx.push({ type: 'explosion', x: ball.position.x, y: ball.position.y,
              born: now(), life: 320 });
    shakeAmount = Math.max(shakeAmount, 2);
  }
  // else: ball still has bounces — physics already reversed velocity, it continues
}

// Centralised barrier removal.
function removeBarrier(barrier) {
  if (!barrier) return;
  for (const t of turrets) {
    if (t.shieldBarrier === barrier) t.shieldBarrier = null;
  }
  try { World.remove(engine.world, barrier); } catch (_) {}
  barriers = barriers.filter(x => x !== barrier);
}

// A wall/indestructible-barrier hit. Increment bounce count and use
// per-ball maxBounces (set from the turret type).
function bounceBall(ball) {
  if (!ball || ball.dead) return;

  // Cluster balls explode after their max bounces
  ball.bounces = (ball.bounces || 0) + 1;
  const cap = (ball.maxBounces != null) ? ball.maxBounces : CONFIG.defaultBallMaxBounces;
  if (cap === Infinity) return;
  if (ball.bounces >= cap) {
    if (ball.kind === 'cluster') spawnShrapnel(ball);
    if (ball.kind === 'slime')   spawnSlimePuddles(ball);
    if (ball.kind === 'banana')  spawnBananaPeel(ball);
    ball.dead = true;
    fx.push({ type: 'explosion', x: ball.position.x, y: ball.position.y,
              born: now(), life: 260 });
  }
}

function applyPowerup(body, team) {
  const t = turrets.find(x => x.team === team);
  if (!t || t.dead) return;
  const type = body.puType;
  if (type === 'heal') {
    t.hp = Math.min(t.maxHp, t.hp + CONFIG.healAmount);
    fx.push({ type: 'heal', x: t.x, y: t.y, born: now(), life: 700 });
  } else if (type === 'rapid') {
    t.fireMult = CONFIG.rapidFireMult;
    t.fireMultUntil = timeSec + CONFIG.rapidFireDuration;
  } else if (type === 'multi') {
    t.multiShotLeft = CONFIG.multiShotCount;
  } else if (type === 'shield') {
    if (t.shieldBarrier) removeBarrier(t.shieldBarrier);
    const offY = t.aimDir > 0 ? CONFIG.shieldOffset : -CONFIG.shieldOffset;
    const shield = createBarrier({
      x: t.x,
      y: t.y + offY,
      w: CONFIG.shieldWidth,
      h: CONFIG.shieldHeight,
      hp: CONFIG.shieldHp,
      team: t.team.id,
      color: CONFIG.shieldColor,
      tracksTurret: t,
      trackOffsetY: offY,
      isShield: true,
    });
    t.shieldBarrier = shield;
  }
  fx.push({ type: 'pickupRing', x: body.position.x, y: body.position.y,
            born: now(), life: 500, color: team.color });
  World.remove(engine.world, body);
  powerups = powerups.filter(p => p !== body);
}


/* =====================================================================
   STEP (one physics tick)
   ===================================================================== */
function step(dt) {
  timeSec += dt;

  // Turrets
  for (const t of turrets) {
    if (t.dead) continue;
    updateTurret(t, dt);
  }

  // Tick poison DoT on all turrets
  if (typeof tickPoison === 'function') tickPoison();

  // Slime puddle contact: slow + periodic damage to enemy turrets standing in slime
  for (const t of turrets) {
    if (t.dead) continue;
    const enemyTeamStr = t.team === RED ? 'blue' : 'red';
    let inSlime = false;
    for (const b of barriers) {
      if (!b.isSlimePuddle || b.dead) continue;
      if (b.team !== enemyTeamStr) continue;
      const dx = t.x - b.position.x;
      const dy = t.y - b.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < (t.type.turretWidth / 2) + b.slimeRadius) {
        inSlime = true;
        if (timeSec - t.slimeDamagedAt >= CONFIG.slimePuddleContactCooldown) {
          t.hp -= CONFIG.slimePuddleContactDamage;
          t.slimeDamagedAt = timeSec;
          fx.push({ type: 'spark', x: t.x, y: t.y, born: now(), life: 200 });
          if (t.hp <= 0) {
            t.dead = true;
            fx.push({ type: 'bigexplosion', x: t.x, y: t.y, born: now(), life: 1200 });
            soundTurretHit();
            shakeAmount = Math.max(shakeAmount, CONFIG.maxShake);
            winner = turrets.find(x => x !== t && !x.dead);
            running = false;
            if (winner && statusEl) {
              statusEl.textContent = winner.type.name + ' wins!';
              const wColors = turretColors(winner);
              statusEl.style.color = wColors.primary || winner.team.color;
            }
          }
        }
      }
    }
    if (inSlime) t.slimeSlowUntil = timeSec + CONFIG.slimePuddleSlowDuration;
  }

  // Reposition tracking barriers (e.g. shield power-up follows turret x)
  // and time-out slime puddles.
  for (const b of barriers) {
    if (b.tracksTurret && !b.tracksTurret.dead) {
      const tx = b.tracksTurret.x;
      const ty = b.tracksTurret.y + (b.trackOffsetY || 0);
      Body.setPosition(b, { x: tx, y: ty });
    }
    if (b.isSlimePuddle && !b.dead) {
      const age = timeSec - (b.slimeBornSec || 0);
      if (age >= (b.slimeLifetime || 0)) {
        b.dead = true;
        fx.push({ type: 'spark', x: b.position.x, y: b.position.y,
                  born: now(), life: 220 });
      }
    }
    if (b.isBananaPeel && !b.dead) {
      if (timeSec - (b.peelBornSec || 0) >= (b.peelLifetime || 9)) {
        b.dead = true;
        fx.push({ type: 'spark', x: b.position.x, y: b.position.y,
                  born: now(), life: 200 });
      }
    }
  }

  // Per-ball updates: lifetime, trail, missile homing
  for (const b of balls) {
    if (b.dead) continue;
    const life = b.lifetime != null ? b.lifetime : CONFIG.ballLifetime;
    if (timeSec - b.born > life) b.dead = true;
    if (b.trail) {
      b.trail.push({ x: b.position.x, y: b.position.y });
      if (b.trail.length > CONFIG.ballTrailLength) b.trail.shift();
    }
    if (b.kind === 'missile') {
      steerMissile(b);
    } else if (b.kind === 'orbit') {
      // Analytically compute position from a frame counter so the circle
      // is geometrically perfect with no drift.
      // Center travels forward; each orb is laterally offset by R·cos(θ)
      // where θ = phase0 + frame*ω.  The two orbs (phase 0 and π) are always
      // on exactly opposite sides of the centre line.
      b.orbitFrame = (b.orbitFrame || 0) + 1;
      const R   = b.orbitRadius || 30;
      const ω   = b.orbitAngularSpeed || 0.12;
      const θ   = (b.orbitPhase0 || 0) + b.orbitFrame * ω;
      const fvx = b.forwardVx || 0;
      const fvy = b.forwardVy || 0;

      // Centre position
      const cx = (b.orbitSpawnX || 0) + fvx * b.orbitFrame;
      const cy = (b.orbitSpawnY || 0) + fvy * b.orbitFrame;

      // Perpendicular unit vector (left-hand normal of forward direction)
      const spd  = Math.sqrt(fvx * fvx + fvy * fvy) || 1;
      const px   = -fvy / spd;
      const py   =  fvx / spd;

      const cosθ = Math.cos(θ);
      const sinθ = Math.sin(θ);
      Body.setPosition(b, { x: cx + px * R * cosθ, y: cy + py * R * cosθ });
      // Velocity = derivative of position (for collision detection)
      Body.setVelocity(b, {
        x: fvx - px * R * ω * sinθ,
        y: fvy - py * R * ω * sinθ,
      });
    } else if (b.kind === 'sniper' || b.kind === 'shrapnel') {
      const v = b.velocity;
      if (v.x !== 0 || v.y !== 0) b.facing = Math.atan2(v.y, v.x);
    } else if (b.kind === 'looksmaxx') {
      // -π/2 offset: image face points "up", so rotate so chin faces travel direction
      const v = b.velocity;
      if (v.x !== 0 || v.y !== 0) b.facing = Math.atan2(v.y, v.x) - Math.PI / 2;
    }
  }

  // Random power-up spawn (legacy, off by default)
  if (CONFIG.powerupEnabled && CONFIG.powerupRandomEnabled && !winner &&
      timeSec >= nextPowerupAt && powerups.length < 2) {
    const pool = SCENARIO.powerupPool;
    if (pool && pool.length) createPowerup(choice(pool));
    nextPowerupAt = timeSec + CONFIG.powerupSpawnEvery;
  }

  // Physics
  Engine.update(engine, 1000 / 60);

  // Update active laser beams
  if (typeof updateLasers === 'function') updateLasers();

  // Clean dead balls (cluster shrapnel may have already spawned via spawnShrapnel)
  balls = balls.filter(b => {
    if (b.dead) {
      // Missile death: dramatic multi-ring explosion
      if (b.kind === 'missile') {
        const sparks = [];
        const SPARK_COLORS = ['#ffffff','#ff6b35','#f39c12','#e74c3c','#ffd700','#ff8c00'];
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
          const spd = 90 + Math.random() * 110;
          sparks.push({ vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                        color: SPARK_COLORS[i % SPARK_COLORS.length] });
        }
        fx.push({ type: 'missileexplosion', x: b.position.x, y: b.position.y,
                  born: now(), life: 900, sparks });
        shakeAmount = Math.max(shakeAmount, 5);
        soundMissileExplode();
      }
      // Brainrot bullet death → confetti burst
      if (b.kind === 'brainrot') {
        const CC = ['#ff006e','#fb5607','#ffbe0b','#8338ec','#3a86ff','#06d6a0','#ff4d6d','#ffffff'];
        const pieces = [];
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          const spd = 55 + Math.random() * 110;
          pieces.push({ vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 35,
                        color: CC[i % CC.length],
                        spin: (Math.random() - 0.5) * Math.PI * 7,
                        w: 5 + Math.random() * 5, h: 2 + Math.random() * 2 });
        }
        fx.push({ type: 'confetti', x: b.position.x, y: b.position.y,
                  born: now(), life: 1100, pieces });
        soundBrainrotPop();
      }
      try { World.remove(engine.world, b); } catch (_) {}
      return false;
    }
    return true;
  });

  // Clean dead barriers (laser may have flagged them)
  const deadBarriers = barriers.filter(b => b.dead);
  for (const b of deadBarriers) {
    // Slime puddles never drop power-ups (would be loop-y for a defensive
    // class) and shouldn't be treated like normal HP-barriers.
    if (b.destructible && !b.isSlimePuddle) maybeDropPowerup(b);
    removeBarrier(b);
  }

  // Clean old fx
  const t = now();
  fx = fx.filter(f => t - f.born < f.life);
}


function updateTurret(t, dt) {
  const W = CONFIG.width;
  // Side-to-side movement (slime puddle contact slows the turret)
  const slimeSlow = timeSec < t.slimeSlowUntil ? CONFIG.slimePuddleSlowMult : 1;
  t.x += t.vx * slimeSlow;
  const minX = 50, maxX = W - 50;
  if (t.x < minX) { t.x = minX; t.vx = Math.abs(t.vx); }
  if (t.x > maxX) { t.x = maxX; t.vx = -Math.abs(t.vx); }
  if (Math.random() < CONFIG.turretDirectionChangeChance) {
    t.vx = -t.vx * rand(0.8, 1.2);
    const speedCap = t.type.moveSpeed * 1.8;
    t.vx = clamp(t.vx, -speedCap, speedCap);
  }
  Body.setPosition(t.body, { x: t.x, y: t.y });

  // Barrel aim (oscillating)
  t.aimPhase += t.type.aimOscSpeed;
  const center = t.aimDir * Math.PI / 2;
  t.aimAngle = center + Math.sin(t.aimPhase) * t.type.aimOscRange;

  // Rapid-fire expiry
  if (t.fireMult !== 1 && timeSec >= t.fireMultUntil) t.fireMult = 1;

  // Fire?
  if (now() >= t.nextFire) {
    fire(t);
    const cd = t.type.fireCooldown * t.fireMult +
               (Math.random() * t.type.fireCooldownVar);
    t.nextFire = now() + cd;
  }
}


function fire(t) {
  if (t.type.weaponType === 'laser') {
    const a = t.aimAngle + (Math.random() - 0.5) * CONFIG.ballAimSpread * 0.5;
    fireLaser(t, a);
    return;
  }

  // Orbit fires a purple + orange orb pair with opposite initial curve directions
  if (t.type.weaponType === 'orbit') {
    const a = t.aimAngle + (Math.random() - 0.5) * CONFIG.ballAimSpread;
    const ORBIT_COLORS = ['#9b59b6', '#e67e22'];
    for (let i = 0; i < 2; i++) {
      createBall(t, a);
      const b = balls[balls.length - 1];
      b.orbitPhase0 = i * Math.PI;  // 0 and π → always on opposite sides
      b.orbitColor  = ORBIT_COLORS[i];
    }
    return;
  }

  if (t.multiShotLeft > 0) {
    t.multiShotLeft--;
    const spread = CONFIG.multiShotSpread;
    for (let i = -1; i <= 1; i++) {
      const a = t.aimAngle + i * spread +
                (Math.random() - 0.5) * CONFIG.ballAimSpread;
      createBall(t, a);
    }
  } else {
    const a = t.aimAngle + (Math.random() - 0.5) * CONFIG.ballAimSpread;
    createBall(t, a);
  }
}


/* =====================================================================
   MAIN LOOP
   ===================================================================== */
function loop(t) {
  if (!lastFrame) lastFrame = t;
  const dt = Math.min(0.05, (t - lastFrame) / 1000);
  lastFrame = t;
  if (running) {
    for (let i = 0; i < speedMul; i++) step(dt);
  }
  draw();
  rafId = requestAnimationFrame(loop);
}
