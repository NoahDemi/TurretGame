/* =====================================================================
   RENDERING — all canvas drawing functions
   =====================================================================
   Reads from globals:  canvas, ctx, balls, barriers, powerups, turrets,
                        fx, lasers, winner, shakeAmount, timeSec,
                        SCENARIO, CONFIG, IMAGE_CACHE, TURRET_TYPES
   Writes to:           ctx, shakeAmount (decays it), IMAGE_CACHE

   To give a turret type a unique BODY DESIGN, add a function to the
   TURRET_DESIGNS registry below keyed by the type's `design` field. The
   function receives (ctx, t, w, h) with the canvas already translated to
   the turret's center; just draw relative to the origin.
   ===================================================================== */


/* ---- IMAGE PRELOAD CACHE -------------------------------------------- */
// Lazy-loaded Image objects keyed by full URL. If you set imageUrl /
// bulletImageUrl on a turret type, we load it here on first reference
// and use it once it's ready.
const IMAGE_CACHE = {};
function getImage(relUrl) {
  if (!relUrl) return null;
  const url = (relUrl.startsWith('http') || relUrl.startsWith('/'))
    ? relUrl
    : (CONFIG.assetsBasePath || '') + relUrl;
  let entry = IMAGE_CACHE[url];
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, broken: false };
    img.onload  = () => { entry.ready = true; };
    img.onerror = () => { entry.broken = true; };
    img.src = url;
    IMAGE_CACHE[url] = entry;
  }
  return (entry.ready && !entry.broken) ? entry.img : null;
}


/* ---- COLOR LOOKUP HELPERS ------------------------------------------- */
// Resolve a ball's owning-turret color scheme. Each ball's `team` may
// have flipped (e.g. via Hijack), in which case we should reflect the
// new owner's turret type colors. Falls back to team color if the team
// has no live turret of any matching type (e.g. all dead).
function bulletColors(b) {
  if (!b) return { primary: '#fff', secondary: '#fff', accent: '#fff' };
  // Orbit orbs each carry their own individual color
  if (b.orbitColor) return { primary: b.orbitColor, secondary: b.orbitColor, accent: b.orbitColor };
  // Prefer the type assigned at creation if available
  if (b.ownerType && b.ownerType.colors) return turretColors(b.ownerType);
  // Otherwise try the live turret on this team
  const owner = (typeof turrets !== 'undefined')
    ? turrets.find(t => t.team === b.team)
    : null;
  if (owner) return turretColors(owner);
  // Final fallback: team color or grey
  if (b.team && b.team.color) {
    return { primary: b.team.color, secondary: b.team.color, accent: b.team.color };
  }
  return { primary: '#cccccc', secondary: '#888888', accent: '#cccccc' };
}


/* ---- BACKGROUND ------------------------------------------------------ */
function drawBackground() {
  const W = CONFIG.width, H = CONFIG.height;
  ctx.fillStyle = CONFIG.bgColor;
  ctx.fillRect(0, 0, W, H);
  // Grid lines aligned to the 45px game cell grid
  const cell = CONFIG.gridCell || 45;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // Faint centre line
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.setLineDash([6, 10]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}


/* ---- BARRIER COLOR LOOKUP ------------------------------------------- */
function barrierColor(b) {
  if (b.color) return b.color;
  if (b.team === 'red') {
    return b.destructible ? CONFIG.redBarrierColor : CONFIG.redWallColor;
  } else if (b.team === 'blue') {
    return b.destructible ? CONFIG.blueBarrierColor : CONFIG.blueWallColor;
  }
  return b.destructible ? CONFIG.neutralBarrierColor : CONFIG.neutralWallColor;
}


/* ---- BARRIERS (destructible + walls, per-team colors) --------------- */
function drawBarriers() {
  for (const b of barriers) {
    const p = b.position;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.angle);

    // Slime puddle: draw as a wobbly green blob with HP-tinted core
    if (b.isSlimePuddle) {
      const cs = (b.ownerType && b.ownerType.colors)
                   ? turretColors(b.ownerType)
                   : { primary: '#2ecc71', secondary: '#0e8a4f' };
      const r = b.slimeRadius || (b.w / 2);
      const lifeFrac = Math.max(0, 1 - (timeSec - (b.slimeBornSec || 0)) / (b.slimeLifetime || 1));
      ctx.globalAlpha = 0.85;
      // Wobbly outline
      ctx.fillStyle = cs.primary;
      ctx.beginPath();
      const points = 12;
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        const wob = 0.16 * r * Math.sin(timeSec * 4 + i * 1.4);
        const rr = r + wob;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      // Inner darker pool
      ctx.fillStyle = cs.secondary;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      // HP dot count (tiny)
      ctx.globalAlpha = lifeFrac * 0.9 + 0.1;
      ctx.fillStyle = '#ffffff';
      const dots = Math.max(0, b.hp);
      for (let i = 0; i < dots; i++) {
        const a = (i / Math.max(1, dots)) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      continue;
    }

    if (b.isBananaPeel) {
      const lifeFrac = Math.max(0.15, 1 - (timeSec - (b.peelBornSec || 0)) / (b.peelLifetime || 9));
      ctx.globalAlpha = 0.88 * lifeFrac;
      ctx.fillStyle   = '#e8d040';
      ctx.strokeStyle = '#9a7d0a';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.beginPath(); ctx.arc( 12, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-12, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      continue;
    }

    const fill = barrierColor(b);

    if (b.destructible) {
      const dmg = 1 - (b.hp / b.maxHp);
      ctx.fillStyle = fill;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);

      const fitSize = Math.min(b.h * 0.85, b.w * 0.55, 20);
      ctx.fillStyle = dmg > 0.5 ? '#ffefc0' : '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.font = 'bold ' + Math.max(10, Math.round(fitSize)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(String(b.hp), 0, 1);
      ctx.fillText(String(b.hp), 0, 1);

      if (dmg > 0.5) {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-b.w * 0.3, -b.h * 0.2); ctx.lineTo(-b.w * 0.1, b.h * 0.3);
        ctx.moveTo(b.w * 0.15, -b.h * 0.3); ctx.lineTo(b.w * 0.3, b.h * 0.1);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = fill;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      const step = 8;
      for (let i = -b.w; i < b.w + b.h; i += step) {
        ctx.beginPath();
        ctx.moveTo(-b.w / 2 + i, -b.h / 2);
        ctx.lineTo(-b.w / 2 + i - b.h, b.h / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }
}


/* =====================================================================
   BULLET RENDERING
   =====================================================================
   Dispatches to a per-kind drawer. Add new bullet kinds here.
   ===================================================================== */
function drawBalls() {
  for (const b of balls) {
    const p = b.position;
    const r = b.r || 8;

    // Per-bullet image override (turret type's bulletImageUrl)
    const bulletImg = getBulletImageFor(b);
    if (bulletImg) {
      const angle = b.facing != null ? b.facing : 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      const size = r * 4;
      ctx.drawImage(bulletImg, -size / 2, -size / 2, size, size);
      ctx.restore();
      continue;
    }

    drawBulletTrail(b);

    switch (b.kind) {
      case 'sniper':   drawSniperBullet(b);   break;
      case 'missile':  drawMissileBullet(b);  break;
      case 'cluster':  drawClusterBullet(b);  break;
      case 'hijack':   drawHijackBullet(b);   break;
      case 'poison':   drawPoisonBullet(b);   break;
      case 'shrapnel': drawShrapnelBullet(b); break;
      case 'slime':    drawSlimeBullet(b);    break;
      case 'orbit':    drawOrbitBall(b);      break;
      case 'banana':   drawBananaBall(b);     break;
      case 'brainrot':   drawBrainrotBall(b);   break;
      case 'looksmaxx':  drawLooksmaxxBall(b);  break;
      default:         drawStandardBullet(b); break;
    }
  }
}

function getBulletImageFor(b) {
  // Turret types can supply bulletImageUrl. Look up the turret of this team.
  const owner = turrets.find(t => t.team === b.team);
  if (!owner || !owner.type) return null;
  return getImage(owner.type.bulletImageUrl);
}

// Shared sigma face renderer — used by both the turret body and the bullet.
// Draws at origin; caller handles translate/rotate.
// jawOpen: px the lower jaw is displaced downward (0 = closed).
function drawSigmaFace(ctx, r, col, jawOpen) {
  const drk      = 'rgba(0,0,0,0.82)';
  const jawSplit = r * 0.10;  // y where face splits into upper/lower jaw

  // ── UPPER HEAD ────────────────────────────────────────────────────────
  ctx.fillStyle   = col;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth   = r * 0.10;
  ctx.beginPath();
  ctx.moveTo( 0,         -r * 0.96);
  ctx.lineTo( r * 0.72,  -r * 0.76);
  ctx.lineTo( r * 0.90,  -r * 0.04);
  ctx.lineTo( r * 0.62,   jawSplit);
  ctx.lineTo(-r * 0.62,   jawSplit);
  ctx.lineTo(-r * 0.90,  -r * 0.04);
  ctx.lineTo(-r * 0.72,  -r * 0.76);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Side shadow
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.beginPath();
  ctx.moveTo( r*0.08, -r*0.96); ctx.lineTo( r*0.72, -r*0.76);
  ctx.lineTo( r*0.90, -r*0.04); ctx.lineTo( r*0.62,  jawSplit);
  ctx.lineTo( r*0.08,  jawSplit); ctx.closePath(); ctx.fill();

  // ── BROWS ────────────────────────────────────────────────────────────
  ctx.strokeStyle = drk; ctx.lineWidth = r*0.17; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-r*0.68,-r*0.50); ctx.lineTo(-r*0.10,-r*0.34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( r*0.68,-r*0.50); ctx.lineTo( r*0.10,-r*0.34); ctx.stroke();
  ctx.lineWidth = r*0.10;
  ctx.beginPath(); ctx.moveTo(-r*0.10,-r*0.34); ctx.lineTo(0,-r*0.20); ctx.lineTo(r*0.10,-r*0.34); ctx.stroke();

  // ── EYES ─────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.88)';
  ctx.beginPath(); ctx.ellipse(-r*0.38,-r*0.14, r*0.20,r*0.12, 0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( r*0.38,-r*0.14, r*0.20,r*0.12, 0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.beginPath(); ctx.arc(-r*0.30,-r*0.19, r*0.05,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( r*0.46,-r*0.19, r*0.05,0,Math.PI*2); ctx.fill();

  // ── NOSE ─────────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = r*0.08;
  ctx.beginPath(); ctx.moveTo(r*0.09,r*0.05); ctx.lineTo(-r*0.09,r*0.23); ctx.lineTo(r*0.09,r*0.23); ctx.stroke();

  // ── MOUTH GAP (when jaw is open) ─────────────────────────────────────
  if (jawOpen > 0.5) {
    ctx.fillStyle = 'rgba(0,0,0,0.90)';
    ctx.fillRect(-r*0.54, jawSplit, r*1.08, jawOpen);
  }

  // ── LOWER JAW ────────────────────────────────────────────────────────
  ctx.fillStyle   = col;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth   = r * 0.10;
  ctx.beginPath();
  ctx.moveTo(-r*0.62,  jawSplit + jawOpen);
  ctx.lineTo( r*0.62,  jawSplit + jawOpen);
  ctx.lineTo( r*0.62,  r * 0.70);
  ctx.lineTo( 0,       r * 0.96);
  ctx.lineTo(-r*0.62,  r * 0.70);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Jaw shade
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.beginPath();
  ctx.moveTo( r*0.08, jawSplit+jawOpen); ctx.lineTo( r*0.62, jawSplit+jawOpen);
  ctx.lineTo( r*0.62, r*0.70);          ctx.lineTo( r*0.08, r*0.96);
  ctx.closePath(); ctx.fill();

  // ── TIGHT MOUTH LINE ─────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = r*0.10;
  ctx.beginPath(); ctx.moveTo(-r*0.26, jawSplit + jawOpen*0.5); ctx.lineTo(r*0.26, jawSplit + jawOpen*0.5); ctx.stroke();

  // ── JAW DEFINITION LINES ─────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = r*0.08;
  ctx.beginPath(); ctx.moveTo(-r*0.90,-r*0.04); ctx.lineTo(-r*0.62, r*0.70); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( r*0.90,-r*0.04); ctx.lineTo( r*0.62, r*0.70); ctx.stroke();

  ctx.lineCap = 'butt';
}

function drawLooksmaxxBall(b) {
  const p   = b.position;
  const v   = b.velocity;
  const ang = (v.x !== 0 || v.y !== 0) ? Math.atan2(v.y, v.x) - Math.PI / 2 : -Math.PI / 2;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  drawSigmaFace(ctx, b.r, bulletColors(b).primary, 0);
  ctx.restore();
}

function drawBrainrotBall(b) {
  const p    = b.position;
  const spin = timeSec * 6 + (b.born || 0) * 1.9;
  const col  = b.brainrotColor || '#ff006e';
  const digit = b.brainrotDigit || '6';
  const sz   = Math.round(b.r * 2.4);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(spin);
  ctx.shadowColor = col;
  ctx.shadowBlur  = 14;
  ctx.font        = `bold ${sz}px monospace`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  // Thick black outline for readability
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = sz * 0.18;
  ctx.strokeText(digit, 0, 0);
  ctx.fillStyle   = col;
  ctx.fillText(digit, 0, 0);
  ctx.shadowBlur  = 0;
  ctx.restore();
}

function drawOrbitBall(b) {
  const p = b.position;
  const color = b.orbitColor || bulletColors(b).primary;
  const glow  = color === '#9b59b6' ? '#d7bde2' : '#fad7a0';
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.shadowColor = color;
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = color;
  ctx.beginPath();
  ctx.arc(0, 0, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = glow;
  ctx.beginPath();
  ctx.arc(0, 0, b.r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBananaBall(b) {
  const p    = b.position;
  const spin = timeSec * 7 + (b.born || 0) * 3.1; // each ball has unique phase
  const r    = b.r;
  const len  = r * 2.1;
  const bulge = r * 1.0;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(spin);

  // Banana crescent: outer arc curves up, inner arc barely curves — classic side view
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.bezierCurveTo(-len * 0.4, -bulge,  len * 0.4, -bulge,  len, 0);  // outer curve
  ctx.bezierCurveTo( len * 0.4, -bulge * 0.25, -len * 0.4, -bulge * 0.25, -len, 0); // inner curve
  ctx.closePath();

  ctx.fillStyle   = '#f4d03f';
  ctx.strokeStyle = '#9a7d0a';
  ctx.lineWidth   = 1.5;
  ctx.fill();
  ctx.stroke();

  // Yellow highlight stripe along the inner ridge
  ctx.strokeStyle = '#fef9e7';
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(-len * 0.7, -bulge * 0.18);
  ctx.bezierCurveTo(-len * 0.2, -bulge * 0.55, len * 0.2, -bulge * 0.55, len * 0.7, -bulge * 0.18);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Brown tips
  ctx.fillStyle = '#5d4037';
  ctx.beginPath(); ctx.arc(-len, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( len, 0, 2.5, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawBulletTrail(b) {
  const r = b.r || 8;
  const col = bulletColors(b).primary;
  if (b.trail && b.trail.length > 1) {
    for (let i = 1; i < b.trail.length; i++) {
      const a = (i / b.trail.length);
      const alpha = a * CONFIG.ballTrailAlpha;
      const width = r * (0.3 + a * 0.9);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
      ctx.lineTo(b.trail[i].x, b.trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawStandardBullet(b) {
  const p = b.position;
  const r = b.r || 8;
  const col = bulletColors(b).primary;
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5);
  grad.addColorStop(0, col);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(p.x - r * 0.25, p.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

// Long, narrow bullet shape that points in the direction of motion
function drawSniperBullet(b) {
  const p = b.position;
  const r = b.r || 6;
  const angle = b.facing != null ? b.facing : Math.atan2(b.velocity.y, b.velocity.x);
  const len = r * 3.5;          // bullet body length
  const w = r * 1.2;            // body width

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);

  // Trail glow already drawn. Draw cartridge-style bullet:
  // Tail (flat back)
  ctx.fillStyle = '#5a3a2a';
  ctx.fillRect(-len * 0.55, -w / 2, len * 0.45, w);
  // Body (shiny)
  const grad = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
  grad.addColorStop(0, '#f3c87a');
  grad.addColorStop(0.5, '#caa15a');
  grad.addColorStop(1, '#8a6d3a');
  ctx.fillStyle = grad;
  ctx.fillRect(-len * 0.1, -w / 2, len * 0.5, w);
  // Tip (pointed)
  ctx.beginPath();
  ctx.moveTo(len * 0.4, -w / 2);
  ctx.lineTo(len * 0.55, 0);
  ctx.lineTo(len * 0.4, w / 2);
  ctx.closePath();
  ctx.fillStyle = '#3a2a1a';
  ctx.fill();
  // Type-colored hot trail
  ctx.strokeStyle = bulletColors(b).primary;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-len * 0.55, 0);
  ctx.lineTo(-len * 0.85, 0);
  ctx.stroke();
  ctx.restore();
}

// Slow rocket with flame trail
function drawMissileBullet(b) {
  const p = b.position;
  const r = b.r || 7;
  const angle = b.facing != null ? b.facing : Math.atan2(b.velocity.y, b.velocity.x);
  const len = r * 3;
  const w = r * 1.4;

  // Exhaust flame behind missile
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  const flameLen = len * 1.2 + Math.random() * 6;
  const flameGrad = ctx.createLinearGradient(-len, 0, -len - flameLen, 0);
  flameGrad.addColorStop(0, 'rgba(255,200,80,0.9)');
  flameGrad.addColorStop(0.6, 'rgba(255,80,30,0.6)');
  flameGrad.addColorStop(1, 'rgba(255,80,30,0)');
  ctx.fillStyle = flameGrad;
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, -w / 2);
  ctx.lineTo(-len * 0.5 - flameLen, 0);
  ctx.lineTo(-len * 0.5, w / 2);
  ctx.closePath();
  ctx.fill();

  // Body
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(-len * 0.5, -w / 2, len * 0.85, w);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-len * 0.5, -w / 2, len * 0.85, w);

  // Pointed nose (type color)
  const cm = bulletColors(b).primary;
  ctx.beginPath();
  ctx.moveTo(len * 0.35, -w / 2);
  ctx.lineTo(len * 0.6, 0);
  ctx.lineTo(len * 0.35, w / 2);
  ctx.closePath();
  ctx.fillStyle = cm;
  ctx.fill();
  ctx.stroke();

  // Fins
  ctx.fillStyle = cm;
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, -w / 2);
  ctx.lineTo(-len * 0.65, -w);
  ctx.lineTo(-len * 0.45, -w / 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, w / 2);
  ctx.lineTo(-len * 0.65, w);
  ctx.lineTo(-len * 0.45, w / 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Cluster: spiky core indicating it'll explode
function drawClusterBullet(b) {
  const p = b.position;
  const r = b.r || 9;
  const col = bulletColors(b).primary;
  // Glow
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5);
  grad.addColorStop(0, col);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Spiky body
  ctx.fillStyle = col;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const spikes = 8;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const rr = (i % 2 === 0) ? r * 1.2 : r * 0.7;
    const x = p.x + Math.cos(a) * rr;
    const y = p.y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Hijack: pulsing ring suggests "captures opposing balls"
function drawHijackBullet(b) {
  const p = b.position;
  const r = b.r || 10;
  const pulse = 1 + 0.15 * Math.sin(timeSec * 8);
  ctx.fillStyle = bulletColors(b).primary;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 1.4 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  // Central recursion symbol — small inverted ring
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2);
  ctx.stroke();
}

// Poison: type-colored core wrapped in green glow
function drawPoisonBullet(b) {
  const p = b.position;
  const r = b.r || 9;
  // Outer green glow
  const greenGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
  greenGrad.addColorStop(0, 'rgba(63,255,138,0.7)');
  greenGrad.addColorStop(1, 'rgba(63,255,138,0)');
  ctx.fillStyle = greenGrad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
  ctx.fill();
  // Type-colored core
  ctx.fillStyle = bulletColors(b).primary;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  // Bubbling green dot inside
  ctx.fillStyle = '#3fff8a';
  const wob = Math.sin(timeSec * 12) * r * 0.25;
  ctx.beginPath();
  ctx.arc(p.x + wob, p.y - wob, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function drawShrapnelBullet(b) {
  const p = b.position;
  const r = b.r || 4;
  ctx.fillStyle = bulletColors(b).primary;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Slime: big wobbling glob with darker blob highlights
function drawSlimeBullet(b) {
  const p = b.position;
  const r = b.r || 16;
  const cs = bulletColors(b);
  // Outer goo halo
  const grad = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, r * 1.7);
  grad.addColorStop(0, cs.primary);
  grad.addColorStop(0.7, cs.secondary);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  // Wobbly blob outline
  ctx.beginPath();
  const points = 14;
  const wob = 0.10 * r;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wave = wob * Math.sin(timeSec * 5 + i * 1.7);
    const rr = r + wave;
    const x = p.x + Math.cos(a) * rr;
    const y = p.y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Dark inner highlight
  ctx.fillStyle = cs.secondary;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(p.x + r * 0.18, p.y + r * 0.18, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Tiny shine
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(p.x - r * 0.4, p.y - r * 0.4, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}


/* ---- LASERS (multi-layer glow polyline) -----------------------------
   Lasers may be hijacked partway through. When `hijackedAt` is set,
   the portion from that distance forward is drawn in the hijacker's
   team-type color and the prior portion in the original color. We do
   this by drawing the path twice with two different distance windows
   (and matching color overrides).
------------------------------------------------------------------------- */
function drawLasers() {
  if (typeof lasers === 'undefined' || !lasers || lasers.length === 0) return;

  for (const L of lasers) {
    let fade = 1;
    if (L.fadeStart >= 0) {
      const age = (timeSec - L.fadeStart) / L.life;
      fade = Math.max(0, 1 - age);
    }
    if (fade <= 0) continue;

    const lastVisible = L.revealedLen;
    const w = L.width;

    // Resolve per-segment-portion colors
    const origColor = (L.ownerType && L.ownerType.colors && L.ownerType.colors.primary)
                         ? L.ownerType.colors.primary
                         : (L.team && L.team.color) || '#ffffff';
    const hj = L.hijackedAt;
    const hjColor = hj
      ? ((hj.ownerType && hj.ownerType.colors && hj.ownerType.colors.primary)
          ? hj.ownerType.colors.primary
          : (hj.team && hj.team.color) || '#ffffff')
      : null;

    // Builds a sub-path between [minD, maxD] along the polyline.
    const drawWindow = (minD, maxD) => {
      const cap = Math.min(maxD, lastVisible);
      if (cap <= minD) return;
      ctx.beginPath();
      for (const seg of L.segments) {
        if (seg.endDist <= minD) continue;
        if (seg.startDist >= cap) break;
        // Compute clipped endpoints within [minD, cap]
        const segLen = seg.endDist - seg.startDist;
        let t1 = 0, t2 = 1;
        if (seg.startDist < minD) t1 = (minD - seg.startDist) / segLen;
        if (seg.endDist   > cap)  t2 = (cap  - seg.startDist) / segLen;
        const x1 = seg.x1 + (seg.x2 - seg.x1) * t1;
        const y1 = seg.y1 + (seg.y2 - seg.y1) * t1;
        const x2 = seg.x1 + (seg.x2 - seg.x1) * t2;
        const y2 = seg.y1 + (seg.y2 - seg.y1) * t2;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    };

    const strokeWindow = (minD, maxD, color) => {
      ctx.lineCap = 'round';

      ctx.globalAlpha = 0.25 * fade;
      ctx.strokeStyle = color;
      ctx.lineWidth = w * 6;
      drawWindow(minD, maxD); ctx.stroke();

      ctx.globalAlpha = 0.55 * fade;
      ctx.lineWidth = w * 2.5;
      drawWindow(minD, maxD); ctx.stroke();

      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, w * 0.7);
      drawWindow(minD, maxD); ctx.stroke();
    };

    if (hj) {
      strokeWindow(0,        hj.dist,    origColor);
      strokeWindow(hj.dist,  L.totalLen, hjColor);
    } else {
      strokeWindow(0, L.totalLen, origColor);
    }

    ctx.globalAlpha = 1;
  }
}


/* =====================================================================
   TURRET DESIGNS
   =====================================================================
   Each design draws the body relative to (0,0) — caller has already
   translated the canvas to the turret's center. Don't draw the barrel
   (drawTurret handles that), just the chassis.

   To add a new design: just add a new key here matching the
   `design` field on the turret type.
   ===================================================================== */
const TURRET_DESIGNS = {

  // Plain rectangle with corner bolts
  standard(ctx, t, w, h) {
    ctx.fillStyle = t.dead ? '#333' : turretColors(t).primary;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (const dx of [-w / 2 + 7, w / 2 - 7]) {
      for (const dy of [-h / 2 + 5, h / 2 - 5]) {
        ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  },

  // Sleek wedge with a scope ring
  sniper(ctx, t, w, h) {
    ctx.fillStyle = t.dead ? '#333' : turretColors(t).primary;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    // Hexagonal silhouette
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2 - 8, -h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w / 2 - 8, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2 + 8, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Scope ring near front
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w * 0.18, 0, h * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  },

  // Wide chassis with rotating barrel cluster look
  cluster(ctx, t, w, h) {
    ctx.fillStyle = t.dead ? '#333' : turretColors(t).primary;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // Gear/rotor circle in the middle
    const rot = (timeSec * 4) % (Math.PI * 2);
    ctx.save();
    ctx.rotate(rot);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#666';
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i / 6) * Math.PI * 2);
      ctx.fillRect(h * 0.3, -1.5, h * 0.25, 3);
      ctx.restore();
    }
    ctx.restore();
  },

  // Stocky launcher with shoulder pads
  missile(ctx, t, w, h) {
    ctx.fillStyle = t.dead ? '#333' : turretColors(t).primary;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // Shoulder reinforcements
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(-w / 2, -h / 2, 6, h);
    ctx.fillRect(w / 2 - 6, -h / 2, 6, h);
    // Center missile rack hint
    ctx.fillStyle = '#ddd';
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(i * 8 - 2, -h * 0.25, 4, h * 0.5);
    }
  },

  // Sleek metallic body with glowing core lens
  laser(ctx, t, w, h) {
    // Metal body (darker than team color)
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#444');
    grad.addColorStop(0.5, '#888');
    grad.addColorStop(1, '#444');
    ctx.fillStyle = t.dead ? '#333' : grad;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    // Capsule-like rectangle
    ctx.beginPath();
    const rad = h / 2;
    ctx.moveTo(-w / 2 + rad, -h / 2);
    ctx.lineTo(w / 2 - rad, -h / 2);
    ctx.arc(w / 2 - rad, 0, rad, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-w / 2 + rad, h / 2);
    ctx.arc(-w / 2 + rad, 0, rad, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Glowing lens
    const pulse = 0.6 + 0.4 * Math.sin(timeSec * 6);
    const lens = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.4);
    lens.addColorStop(0, turretColors(t).primary);
    lens.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = pulse;
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  },

  // Tech aesthetic with circuit lines
  hijack(ctx, t, w, h) {
    ctx.fillStyle = t.dead ? '#333' : turretColors(t).primary;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // Circuit paths
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 8, 0);
    ctx.lineTo(-w / 4, 0); ctx.lineTo(-w / 4, -h / 3);
    ctx.lineTo(w / 4, -h / 3); ctx.lineTo(w / 4, 0);
    ctx.lineTo(w / 2 - 8, 0);
    ctx.stroke();
    // Tiny LEDs
    ctx.fillStyle = '#fff';
    [[-w / 2 + 8, 0], [w / 2 - 8, 0], [-w / 4, -h / 3], [w / 4, -h / 3]]
      .forEach(([x, y]) => {
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
      });
  },

  // Tank-style chassis with slime tank dome on top
  slime(ctx, t, w, h) {
    const cs = turretColors(t);
    ctx.fillStyle = t.dead ? '#333' : cs.secondary;
    ctx.strokeStyle = '#0a3a18';
    ctx.lineWidth = 3;
    // Rounded rect base
    const rad = Math.min(w, h) * 0.35;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + rad, -h / 2);
    ctx.lineTo(w / 2 - rad, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rad);
    ctx.lineTo(w / 2, h / 2 - rad);
    ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - rad, h / 2);
    ctx.lineTo(-w / 2 + rad, h / 2);
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rad);
    ctx.lineTo(-w / 2, -h / 2 + rad);
    ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rad, -h / 2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Glowing slime dome on top
    if (!t.dead) {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.5);
      grad.addColorStop(0, cs.primary);
      grad.addColorStop(1, cs.secondary);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cs.primary;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner dripping bubbles
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 3; i++) {
        const bx = (Math.sin(timeSec * 3 + i * 1.7) * w * 0.1);
        const by = (Math.cos(timeSec * 4 + i) * h * 0.12);
        ctx.beginPath();
        ctx.arc(bx, by, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  // Drum-shaped poison turret with sickly green tint
  poison(ctx, t, w, h) {
    // Body with green-tinted edge
    ctx.fillStyle = t.dead ? '#333' : turretColors(t).primary;
    ctx.strokeStyle = '#1a3f24';
    ctx.lineWidth = 3;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // Poison tank in center
    ctx.fillStyle = 'rgba(63,255,138,0.85)';
    ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6);
    ctx.strokeStyle = '#093';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6);
    // Bubbles
    for (let i = 0; i < 3; i++) {
      const bx = (Math.sin(timeSec * 4 + i) * w * 0.15);
      const by = (Math.cos(timeSec * 3 + i) * h * 0.12);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(bx, by, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // Hexagonal hub with two animated orb indicators on an orbit ring
  orbit(ctx, t, w, h) {
    const cs = turretColors(t);
    // Dark hex body
    ctx.fillStyle   = t.dead ? '#333' : '#1a1a2e';
    ctx.strokeStyle = cs.primary;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      i === 0 ? ctx.moveTo(Math.cos(a) * h * 0.5, Math.sin(a) * h * 0.5)
              : ctx.lineTo(Math.cos(a) * h * 0.5, Math.sin(a) * h * 0.5);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Orbit ring
    ctx.strokeStyle  = cs.secondary;
    ctx.lineWidth    = 1;
    ctx.globalAlpha  = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Animated purple + orange indicators
    const a = (timeSec * 3) % (Math.PI * 2);
    const r = h * 0.78;
    [[cs.primary, 0], [cs.secondary, Math.PI]].forEach(([col, offset]) => {
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(Math.cos(a + offset) * r, Math.sin(a + offset) * r, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  },

  // The turret IS the head — same face as the bullet, just bigger + animated jaw
  looksmaxx(ctx, t, w, h) {
    const cs      = turretColors(t);
    const col     = t.dead ? '#444' : cs.primary;
    const r       = Math.min(w, h) * 0.42;
    const jawOpen = t.dead ? 0 : Math.abs(Math.sin(timeSec * 7)) * r * 0.18;
    drawSigmaFace(ctx, r, col, jawOpen);
  },

  // Rainbow-striped chaotic body with "6" and "7" on it
  brainrot(ctx, t, w, h) {
    const STRIPE = ['#ff006e','#fb5607','#ffbe0b','#8338ec','#3a86ff','#06d6a0'];
    const sw = w / STRIPE.length;

    // Draw waving arms BEHIND the body so they stick out from the sides
    if (!t.dead) {
      const bobL =  Math.sin(timeSec * 9)          * 7;
      const bobR =  Math.sin(timeSec * 9 + Math.PI) * 7;
      const armLen = 18;
      ctx.lineCap = 'round';

      // Left arm
      ctx.save();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth   = 4;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -2);
      ctx.lineTo(-w / 2 - armLen, -2 + bobL);
      ctx.stroke();
      // Fist / hand circle
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-w / 2 - armLen, -2 + bobL, 6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('6', -w / 2 - armLen, -2 + bobL);
      ctx.restore();

      // Right arm
      ctx.save();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth   = 4;
      ctx.beginPath();
      ctx.moveTo(w / 2, -2);
      ctx.lineTo(w / 2 + armLen, -2 + bobR);
      ctx.stroke();
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(w / 2 + armLen, -2 + bobR, 6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('7', w / 2 + armLen, -2 + bobR);
      ctx.restore();
      ctx.lineCap = 'butt';
    }

    // Rainbow-striped body
    STRIPE.forEach((col, i) => {
      ctx.fillStyle = t.dead ? '#333' : col;
      ctx.fillRect(-w / 2 + i * sw, -h / 2, sw, h);
    });
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // Fat "67" dominating the body
    const fs = Math.round(h * 1.15);
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = fs * 0.18;
    ctx.strokeText('67', 0, 0);
    ctx.fillStyle   = '#fff';
    ctx.shadowColor = '#ffbe0b';
    ctx.shadowBlur  = 6;
    ctx.fillText('67', 0, 0);
    ctx.shadowBlur = 0;
  },

  // Bright yellow body with a banana arc symbol
  banana(ctx, t, w, h) {
    const cs = turretColors(t);
    ctx.fillStyle   = t.dead ? '#333' : cs.primary;
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // Banana arc
    ctx.strokeStyle = cs.secondary;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(0, h * 0.08, h * 0.44, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.lineCap = 'butt';
  },

};


/* ---- TURRET + HP BAR + TYPE LABEL ------------------------------------ */
function drawTurret(t) {
  const w = t.type.turretWidth;
  const h = t.type.turretHeight;
  ctx.save();
  ctx.translate(t.x, t.y);

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-w / 2, -h / 2 + 4, w, h);

  // Optional sprite override on the turret type
  const spriteImg = getImage(t.type.imageUrl);
  if (spriteImg) {
    // Draw image, scaled to type's footprint, rotated to aim direction.
    ctx.save();
    ctx.rotate(t.aimAngle - (t.aimDir * Math.PI / 2));
    const sw = w * 1.4, sh = h * 2.6;
    ctx.drawImage(spriteImg, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  } else {
    // Vector design (default)
    const designKey = t.type.design || 'standard';
    const design = TURRET_DESIGNS[designKey] || TURRET_DESIGNS.standard;
    design(ctx, t, w, h);
  }

  // Hit flash
  if (t.hitFlashUntil && now() < t.hitFlashUntil) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }

  // Hijack glow — pulsing purple overlay when one of this turret's bullets
  // was just converted by the opposing Hijack turret
  if (t.hijackedGlowUntil && now() < t.hijackedGlowUntil) {
    const fade  = (t.hijackedGlowUntil - now()) / 1800;
    const pulse = 0.45 + 0.25 * Math.sin(timeSec * 14);
    ctx.globalAlpha = fade * pulse;
    ctx.fillStyle   = '#9b59b6';
    ctx.fillRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
    ctx.globalAlpha = 1;
    // Purple border ring
    ctx.strokeStyle = `rgba(180,80,255,${fade * 0.9})`;
    ctx.lineWidth   = 2.5;
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  }

  // Poison status indicator: green tint + bubbles when poisoned
  if (t.poisonStacks && t.poisonStacks.length > 0) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#3fff8a';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 1;
  }

  // Barrel (rotates with aim angle) -- only for non-image turrets
  if (!spriteImg) {
    ctx.save();
    ctx.rotate(t.aimAngle - Math.PI / 2 * t.aimDir);
    const barrelVis = t.type.barrelLength * 0.92;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-4, t.aimDir > 0 ? 0 : -barrelVis, 8, barrelVis);
    ctx.strokeRect(-4, t.aimDir > 0 ? 0 : -barrelVis, 8, barrelVis);
    ctx.restore();
  }

  // Buff indicators
  const buffY = t.aimDir > 0 ? -h / 2 - 8 : h / 2 + 8;
  if (t.fireMult !== 1 && timeSec < t.fireMultUntil) {
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('RAPID', 0, buffY);
  }
  if (t.multiShotLeft > 0) {
    ctx.fillStyle = '#e67e22';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('x' + (1 + t.multiShotLeft),
      (t.fireMult !== 1 && timeSec < t.fireMultUntil) ? 30 : 0, buffY);
  }
  if (t.poisonStacks && t.poisonStacks.length > 0) {
    ctx.fillStyle = '#3fff8a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('POISON x' + t.poisonStacks.length, 0,
      buffY + (t.aimDir > 0 ? -12 : 12));
  }
  ctx.restore();

  // HP bar
  const barY = t.aimDir > 0 ? t.y - 38 : t.y + 38;
  const bw = 200, bh = 20;
  const bx = t.x - bw / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(bx - 2, barY - 2, bw + 4, bh + 4);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(bx, barY, bw, bh);
  const frac = Math.max(0, t.hp / t.maxHp);
  const hpColor = frac > 0.5 ? '#1ea055' : frac > 0.25 ? '#f1c40f' : '#e74c3c';
  ctx.fillStyle = hpColor;
  ctx.fillRect(bx, barY, bw * frac, bh);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, barY, bw, bh);

  // HP text (team + type + hp/max)
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 3;
  const label = t.type.name.toUpperCase() +
    ' ' + Math.max(0, Math.round(t.hp)) + '/' + t.maxHp;
  ctx.strokeText(label, t.x, barY + bh / 2);
  ctx.fillText(label, t.x, barY + bh / 2);
}


/* ---- POWER-UPS ------------------------------------------------------- */
function drawPowerups() {
  const t = timeSec;
  const colors = {
    heal:   '#2ecc71',
    rapid:  '#f1c40f',
    multi:  '#e67e22',
    shield: '#9b59b6',
  };
  const icons = { heal: '+', rapid: 'R', multi: 'x3', shield: 'S' };
  for (const p of powerups) {
    const c = colors[p.puType] || '#fff';
    const pulse = 1 + 0.1 * Math.sin(t * 5);
    ctx.beginPath();
    ctx.arc(p.position.x, p.position.y, CONFIG.powerupRadius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icons[p.puType] || '?', p.position.x, p.position.y + 1);
  }
}


/* ---- EFFECTS / PARTICLES --------------------------------------------- */
function drawFx() {
  const t = now();
  for (const f of fx) {
    const p = (t - f.born) / f.life;
    if (f.type === 'muzzle') {
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 10 * (1 - p * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.type === 'explosion' || f.type === 'bigexplosion') {
      const maxR = f.type === 'bigexplosion' ? 120 : 28;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, maxR * p, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(f.x, f.y, maxR * p * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.type === 'hit') {
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = f.color;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = 20 * p;
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (f.type === 'spark') {
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#fff';
      ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
      ctx.globalAlpha = 1;
    } else if (f.type === 'pickupRing') {
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 30 * (1 + p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.type === 'missileexplosion') {
      const elapsed = (t - f.born) / 1000;
      // Three expanding rings at different speeds and colors
      const rings = [
        { color: '#ffffff', maxR: 145, rate: 1.00, lw: 4 },
        { color: '#ff6b35', maxR: 105, rate: 0.72, lw: 5 },
        { color: '#f39c12', maxR:  70, rate: 0.50, lw: 6 },
      ];
      rings.forEach(r => {
        ctx.globalAlpha = Math.max(0, 1 - p / r.rate);
        ctx.strokeStyle = r.color;
        ctx.lineWidth   = r.lw;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r.maxR * Math.min(1, p / r.rate), 0, Math.PI * 2);
        ctx.stroke();
      });
      // Central flash
      ctx.globalAlpha = Math.max(0, 1 - p * 4);
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 32 * (1 - p), 0, Math.PI * 2);
      ctx.fill();
      // Flying debris sparks
      ctx.globalAlpha = Math.max(0, 1 - p * 1.4);
      (f.sparks || []).forEach(s => {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(f.x + s.vx * elapsed, f.y + s.vy * elapsed,
                Math.max(1, 4 * (1 - p)), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    } else if (f.type === 'clusterburst') {
      const elapsed = (t - f.born) / 1000;
      ctx.globalAlpha = Math.max(0, 1 - p);
      (f.sparks || []).forEach(s => {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(f.x + s.vx * elapsed, f.y + s.vy * elapsed,
                Math.max(1, 5 * (1 - p)), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    } else if (f.type === 'confetti') {
      const elapsed = (t - f.born) / 1000;
      const gravity = 260;
      (f.pieces || []).forEach(pc => {
        ctx.globalAlpha = Math.max(0, 1 - p * 1.15);
        ctx.save();
        ctx.translate(
          f.x + pc.vx * elapsed,
          f.y + pc.vy * elapsed + 0.5 * gravity * elapsed * elapsed,
        );
        ctx.rotate(pc.spin * elapsed);
        ctx.fillStyle = pc.color;
        ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
        ctx.restore();
      });
      ctx.globalAlpha = 1;
    } else if (f.type === 'heal') {
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#2ecc71';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+' + CONFIG.healAmount + ' HP', f.x, f.y - 40 * p);
      ctx.globalAlpha = 1;
    }
  }
}


/* ---- WATERMARK ------------------------------------------------------- */
function drawWatermark() {
  if (!CONFIG.watermarkEnabled) return;
  const W = CONFIG.width, H = CONFIG.height;
  const txt = CONFIG.watermarkText || 'SIMULATIONGRID'; // Defaulting to your new name
  const size = CONFIG.watermarkSize || 24; // Bumped size slightly for center placement
  
  ctx.font = 'bold ' + size + 'px monospace'; // Monospace looks more "tech/sim"
  ctx.fillStyle = CONFIG.watermarkColor || 'rgba(255,255,255,0.15)'; // Lower opacity for center
  
  // High-visibility shadow for YouTube compression
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;

  // Set alignment to center for both axes
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw in the exact middle
  ctx.fillText(txt, W / 2, H / 2);

  // Reset shadow so it doesn't affect other drawing functions
  ctx.shadowBlur = 0;
}


/* ---- INTRO OVERLAY ------------------------------------------------------- */
function drawIntroOverlay() {
  const W = CONFIG.width, H = CONFIG.height;

  const rType = (typeof redTypeId  !== 'undefined') && TURRET_TYPES[redTypeId];
  const bType = (typeof blueTypeId !== 'undefined') && TURRET_TYPES[blueTypeId];
  if (!rType || !bType) return;

  const rc = turretColors(rType);
  const bc = turretColors(bType);

  // Dark backdrop
  ctx.fillStyle = 'rgba(4,4,18,0.93)';
  ctx.fillRect(0, 0, W, H);

  const midX  = W / 2;
  const midY  = H / 2;
  const lx    = W * 0.24;   // left turret centre x
  const rx    = W * 0.76;   // right turret centre x
  const iconY = midY - 55;
  const nameY = midY + 45;

  // Helper: draw turret icon — uses the type's imageUrl if loaded, else vector design
  function drawIntroIcon(type, cx, cy, flipX) {
    const img = type.imageUrl ? getImage(type.imageUrl) : null;
    ctx.save();
    ctx.translate(cx, cy);
    if (img) {
      const sz = 110;
      ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
    } else {
      ctx.scale(flipX ? -2.5 : 2.5, 2.5);
      const fn = TURRET_DESIGNS[type.design] || TURRET_DESIGNS.standard;
      fn(ctx, type, type.turretWidth || 72, type.turretHeight || 28);
    }
    ctx.restore();
  }

  drawIntroIcon(rType, lx, iconY, false);
  drawIntroIcon(bType, rx, iconY, true);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Left name
  ctx.shadowColor = rc.primary;
  ctx.shadowBlur  = 18;
  ctx.font        = 'bold 38px -apple-system,"Segoe UI",sans-serif';
  ctx.fillStyle   = rc.primary;
  ctx.fillText(rType.name.toUpperCase(), lx, nameY);

  // Right name
  ctx.shadowColor = bc.primary;
  ctx.fillStyle   = bc.primary;
  ctx.fillText(bType.name.toUpperCase(), rx, nameY);

  // Vertical divider
  ctx.shadowBlur   = 0;
  ctx.strokeStyle  = 'rgba(255,255,255,0.18)';
  ctx.lineWidth    = 1;
  ctx.beginPath();
  ctx.moveTo(midX, midY - 130);
  ctx.lineTo(midX, midY + 100);
  ctx.stroke();

  // VS
  ctx.shadowColor = '#fff';
  ctx.shadowBlur  = 10;
  ctx.font        = 'bold 26px monospace';
  ctx.fillStyle   = '#ffffff';
  ctx.fillText('VS', midX, midY - 10);

  ctx.shadowBlur = 0;
}


/* ---- BORDER PATTERN ----------------------------------------------------- */
// Cache so we only rebuild the offscreen tile when the matchup changes.
let _borderPat = null, _borderPatKey = '';

function getBorderPattern() {
  const rType = (typeof redTypeId !== 'undefined') && TURRET_TYPES[redTypeId];
  const bType = (typeof blueTypeId !== 'undefined') && TURRET_TYPES[blueTypeId];
  const c1 = rType ? turretColors(rType).primary : '#e74c3c';
  const c2 = bType ? turretColors(bType).primary : '#3498db';
  const key = c1 + '|' + c2;
  if (_borderPatKey === key && _borderPat) return _borderPat;

  // 45-degree diagonal stripe tile — two corner triangles make a seamless band
  const sw = 9, T = sw * 2;
  const tile = document.createElement('canvas');
  tile.width = T; tile.height = T;
  const tc = tile.getContext('2d');
  tc.fillStyle = c1;
  tc.fillRect(0, 0, T, T);
  tc.fillStyle = c2;
  tc.beginPath(); tc.moveTo(0, 0); tc.lineTo(sw, 0); tc.lineTo(0, sw); tc.closePath(); tc.fill();
  tc.beginPath(); tc.moveTo(T, T); tc.lineTo(T - sw, T); tc.lineTo(T, T - sw); tc.closePath(); tc.fill();

  _borderPat    = ctx.createPattern(tile, 'repeat');
  _borderPatKey = key;
  return _borderPat;
}

function drawBorderFrame(padSide, padTop, scale) {
  const W = CONFIG.width, H = CONFIG.height;
  const gameH   = Math.round(H * scale);
  const gameBot = padTop + gameH;
  const pat     = getBorderPattern();

  ctx.fillStyle = pat;
  ctx.fillRect(0, 0,           padSide,            H);           // left
  ctx.fillRect(W - padSide, 0, padSide,            H);           // right
  ctx.fillRect(padSide, gameBot, W - padSide * 2,  H - gameBot); // bottom

  // Thin bright outline around the game area
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(padSide, padTop, Math.round(W * scale), gameH);
}


/* ---- MATCHUP TITLE BANNER -------------------------------------------- */
function drawMatchupBanner(bannerH) {
  const W = CONFIG.width;
  const rType = (typeof redTypeId !== 'undefined') && TURRET_TYPES[redTypeId];
  const bType = (typeof blueTypeId !== 'undefined') && TURRET_TYPES[blueTypeId];
  if (!rType || !bType) return;

  const rName   = rType.name.toUpperCase();
  const bName   = bType.name.toUpperCase();
  const rColor  = turretColors(rType).primary;
  const bColor  = turretColors(bType).primary;
  const cy      = bannerH / 2 + 30;
  const mid     = W / 2;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur   = 6;

  // "VS" in centre
  ctx.font      = 'bold 13px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'center';
  ctx.fillText('VS', mid, cy);

  // Left name (top turret type colour)
  ctx.font      = 'bold 23px -apple-system,"Segoe UI",sans-serif';
  ctx.fillStyle = rColor;
  ctx.textAlign = 'right';
  ctx.fillText(rName, mid - 20, cy);

  // Right name (bottom turret type colour)
  ctx.fillStyle = bColor;
  ctx.textAlign = 'left';
  ctx.fillText(bName, mid + 20, cy);

  // Subtle divider at banner bottom
  ctx.shadowBlur   = 0;
  ctx.strokeStyle  = 'rgba(255,255,255,0.10)';
  ctx.lineWidth    = 1;
  ctx.beginPath();
  ctx.moveTo(0, bannerH);
  ctx.lineTo(W, bannerH);
  ctx.stroke();

  ctx.restore();
}


/* ---- MAIN DRAW ENTRY POINT ------------------------------------------- */
function draw() {
  const W = CONFIG.width, H = CONFIG.height;

  // Frame layout — game content scaled to 90% and centred, leaving dark
  // borders on all sides (no transparent pixels = no checkered in recording).
  const SCALE    = 0.84;
  const PAD_TOP  = 106;                             // title strip height
  const PAD_SIDE = Math.round((W - W * SCALE) / 2.1); // ≈ 43 px each side

  // Solid background on the full canvas (covers every pixel including borders)
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, W, H);

  // Bright diagonal-stripe pattern in the side/bottom border areas
  drawBorderFrame(PAD_SIDE, PAD_TOP, SCALE);

  // Camera shake offsets
  let sx = 0, sy = 0;
  if (shakeAmount > 0.1) {
    sx = (Math.random() - 0.5) * shakeAmount * 2;
    sy = (Math.random() - 0.5) * shakeAmount * 2;
    shakeAmount *= CONFIG.shakeDecay;
  } else {
    shakeAmount = 0;
  }

  // Scale + inset all game content
  ctx.save();
  ctx.translate(PAD_SIDE + sx, PAD_TOP + sy);
  ctx.scale(SCALE, SCALE);

  drawBackground();
  drawBarriers();
  drawPowerups();
  drawBalls();
  drawLasers();
  for (const t of turrets) drawTurret(t);
  drawFx();
  drawWatermark();

  // Intro overlay — shown for ~2.4 s after Start is clicked
  if (typeof introUntil !== 'undefined' && introUntil > 0 && performance.now() < introUntil) {
    drawIntroOverlay();
  }

  if (winner) {
    const W = CONFIG.width, H = CONFIG.height;
    const cs = turretColors(winner);

    // 1. Darker, more dramatic overlay
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, W, H);

    // 2. Add a glow effect based on the winning turret type's primary color
    ctx.shadowBlur = 25;
    ctx.shadowColor = cs.primary;

    // Main Winner Text setup
    ctx.font = 'bold 35px "Segoe UI", Roboto, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 3. Thick "Sticker" Outline for high readability
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 7;
    const text = winner.type.name.toUpperCase() + ' TURRET WINS!';

    ctx.strokeText(text, W / 2, H / 2);
    ctx.fillStyle = cs.primary;
    ctx.fillText(text, W / 2, H / 2);

    // Reset shadow so it doesn't bleed into other UI
    ctx.shadowBlur = 0;
  }

  ctx.restore(); // end scale + inset transform

  // Matchup title drawn in full canvas coords (sits in the top padding strip)
  drawMatchupBanner(PAD_TOP);
}
