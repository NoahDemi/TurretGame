/* =====================================================================
   CONFIG — GLOBAL GAME MECHANICS
   =====================================================================
   This is the central knobs-and-dials file for the whole game.
   Tweak things here and everything downstream picks it up.

   NOT in this file:
     - Per-turret stats (hp, fire rate, ball size/speed/damage)
         --> edit  js/turret-types.js
     - Map / barrier layouts (ASCII grids)
         --> edit  js/scenarios.js
     - Sound design (frequencies, volumes)
         --> edit  js/sound.js
   ===================================================================== */

const CONFIG = {

  /* ---- CANVAS / VISUALS ----------------------------------------- */
  width:     540,             // canvas width in px (9:16 vertical format)
  height:    960,             // canvas height in px
  bgColor:   '#1c1c3a',       // arena background color
  wallColor: '#2a2a4a',       // outer arena walls


  /* ---- BALL PHYSICS (shared across all turret types) ------------ */
  ballLifetime:    9,         // seconds before a ball auto-despawns
  ballAimSpread:   0.08,      // radians of random aim noise per shot
  ballTrailLength: 14,        // how many past positions to draw as a trail
  ballTrailAlpha:  0.55,      // max opacity of the brightest trail segment
  defaultBallMaxBounces: 4,   // fallback bounce limit if a turret type doesn't
                              // specify its own .ballMaxBounces. HP-barrier hits
                              // are not bounces — the ball explodes on contact.


  /* ---- TURRET BEHAVIOR (shared) --------------------------------- */
  // Each turret's base stats come from TURRET_TYPES (see js/turret-types.js).
  // These are global modifiers that apply to every turret.
  turretDirectionChangeChance: 0.012, // per-frame chance of flipping side-to-side


  /* ---- BARRIERS ------------------------------------------------- */
  // Three teams of barriers exist:
  //   neutral - blocks both teams' shots (gray)
  //   red     - blocks blue shots only; red shots pass through (red tint)
  //   blue    - blocks red shots only; blue shots pass through (blue tint)
  //
  // Each can be DESTRUCTIBLE (has hp) or a permanent WALL (no hp).
  defaultBarrierHp: 5,                // fallback hp if not specified

  // Neutral
  neutralBarrierColor: '#6e6e8c',     // destructible neutral
  neutralWallColor:    '#3a3a54',     // indestructible neutral

  // Red team
  redBarrierColor: '#c2664a',         // destructible red
  redWallColor:    '#7a3a30',         // indestructible red

  // Blue team
  blueBarrierColor: '#3a7eb0',        // destructible blue
  blueWallColor:    '#28547a',        // indestructible blue


  /* ---- ASCII GRID (used to draw maps in scenarios.js) ----------- */
  // Grid covers the playable area between the two turrets.
  // Each cell is rendered as a single barrier of CELL x CELL pixels.
  gridCols:    12,            // 12 cols * 45px = 540 (full canvas width)
  gridRows:    16,            // 16 rows * 45px = 720 (with 120px buffers)
  gridCell:    45,            // px per cell (square)
  gridYOffset: 120,           // top of grid (gives red turret room above)


  /* ---- POWER-UPS ------------------------------------------------ */
  // Power-ups now spawn ONLY when a destructible barrier is destroyed.
  // Set powerupRandomEnabled=true to bring back the old timed spawns.
  powerupEnabled:        false,   // master toggle for power-ups
  powerupRandomEnabled:  false,   // legacy random timed spawns (off by default)
  powerupSpawnEvery:     7,       // seconds between random spawns (if enabled)
  barrierDropChance:     0.35,    // chance a destroyed barrier drops a power-up
  powerupRadius:         18,      // pickup circle radius
  healAmount:            25,      // +hp from Heal pickup
  rapidFireMult:         0.45,    // fire cooldown multiplier during Rapid buff
  rapidFireDuration:     5,       // seconds Rapid lasts
  multiShotCount:        3,       // how many shots are triplets after Multi pickup
  multiShotSpread:       0.35,    // radians between the three spread balls

  // SHIELD: spawns one purple barrier in front of the turret that
  // tracks the turret's x position. Blocks only the OPPOSITE team.
  shieldHp:        8,         // hits before shield breaks
  shieldOffset:    50,        // px in front of turret (away from arena edge)
  shieldWidth:     110,       // shield rectangle width
  shieldHeight:    14,        // shield rectangle height
  shieldColor:     '#9b59b6', // purple


  /* ---- LASER (used by LASER turret type) ------------------------ */
  // The laser is a single beam that grows from the turret over time so
  // you can SEE it sweep wall-to-wall. Damage is applied as the beam
  // reaches each surface and each target is hit at most ONCE per shot.
  laserBeamSpeed:      2200,  // px/sec — how fast the beam reveals
  laserCollisionWidth: 4,     // px around laser line that damages balls
  laserMaxLength:      4000,  // safety cap on total beam length (px)
  laserBulletDamage:   1,     // damage per frame the beam deals to bullets


  /* ---- POISON DOT (used by POISON turret type) ------------------ */
  // First hit deals a low base damage; the bullet then applies a poison
  // STACK that ticks for a fixed amount of damage every interval.
  poisonTickInterval: 0.5,    // seconds between poison ticks
  poisonStackDuration: 6,     // ticks before a stack expires (so 6 * 0.5s = 3s)


  /* ---- SLIME PUDDLE CONTACT (turret walks into enemy puddle) ------- */
  slimePuddleContactDamage:   2,    // hp lost per contact event
  slimePuddleContactCooldown: 0.6,  // seconds between damage ticks while in puddle
  slimePuddleSlowMult:        0.35, // movement multiplier while in slime
  slimePuddleSlowDuration:    0.5,  // seconds slow persists after leaving puddle


  /* ---- VISUAL FEEL ---------------------------------------------- */
  maxShake:           14,     // cap on camera shake (px)
  shakeDecay:         0.85,   // shake decays by this much per frame (0-1)


  /* ---- ASSETS / IMAGES (optional) ------------------------------- */
  // Each turret type can provide imageUrl / bulletImageUrl. Files are
  // pre-loaded at startup and rendered in place of vector graphics.
  // Drop assets into the assets/ folder and reference relative paths.
  assetsBasePath:    'assets/',


  /* ---- WATERMARK ------------------------------------------------ */
  watermarkEnabled: true,
  watermarkText:    '@SimulationGrid',
  watermarkColor:   'rgba(255,255,255,0.35)',
  watermarkSize:    14,         // px font size
  watermarkPos:     'bottom-right', // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center'

};


/* =====================================================================
   COLLISION CATEGORIES (bit flags — don't change unless you know why)
   ===================================================================== */
const CAT_WALL              = 0x0001;
const CAT_NEUTRAL_BARRIER   = 0x0002;
const CAT_RED_BALL          = 0x0004;
const CAT_BLUE_BALL         = 0x0008;
const CAT_RED_TURRET        = 0x0010;
const CAT_BLUE_TURRET       = 0x0020;
const CAT_POWERUP           = 0x0040;
const CAT_RED_BARRIER       = 0x0080;
const CAT_BLUE_BARRIER      = 0x0100;


/* =====================================================================
   TEAMS
   ===================================================================== */
const RED  = { id: 'red',  color: '#e74c3c', tint: '#ff6b5b' };
const BLUE = { id: 'blue', color: '#3498db', tint: '#5dade2' };
