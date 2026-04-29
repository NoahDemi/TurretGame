/* =====================================================================
   TURRET TYPES — per-turret stat presets
   =====================================================================
   Each turret in the arena is assigned a type from this registry.
   The player picks Red's type and Blue's type independently from
   dropdowns in the UI, so you can set up asymmetric matchups.

   HOW TO ADD A NEW TURRET TYPE:
   1. Add a new entry to TURRET_TYPES with a unique key.
   2. It will auto-appear in both the Red and Blue dropdowns.
   3. (Optional) add a matching draw function in TURRET_DESIGNS in
      rendering.js if you want a unique body shape.

   FIELD REFERENCE — common to all turret types:
     id              Internal id (must match key)
     name            Display name shown in the dropdown
     description     Short blurb for future tooltip / UI
     weaponType      'ball'|'laser'|'sniper'|'cluster'|'missile'|'hijack'|
                     'poison'|'slime'
     design          Key into TURRET_DESIGNS (rendering.js). Falls back to
                     'standard' if missing.
     colors          { primary, secondary, accent? } per-type theme colors.
                     Used for trails, projectiles, muzzle, win screen, FX.
                     Replaces the generic team red/blue palette for visuals.
                     The team distinction (collision/AI) still applies.
     imageUrl        Optional: path under CONFIG.assetsBasePath to a turret
                     sprite. If set, sprite replaces vector body.
     bulletImageUrl  Optional: path to bullet sprite. If set, replaces
                     vector projectile.
     hp              Starting and max hit points
     moveSpeed       Base px/frame side-to-side movement
     fireCooldown    ms between shots (lower = faster fire)
     fireCooldownVar Random variance added to cooldown (ms)
     ballSpeed       Initial px/frame ball velocity (ball weapons)
     ballDamage      Damage per ball hit on an enemy turret
     ballRadius      Visual + physics ball size (px)
     barrelLength    Distance from turret center projectiles spawn (px)
     aimOscRange     Radians — how far the barrel wobbles
     aimOscSpeed     Radians/frame — how fast the barrel wobbles
     turretWidth     Visual width of the turret body (px)
     turretHeight    Visual height of the turret body (px)
     ballMaxBounces  Bounces off walls/indestructible barriers before
                     the ball dies. Use Infinity for unlimited.
                     (HP-barrier hits explode the ball — not a bounce.)
     bulletPower     Ball-vs-ball HP. On collision each ball loses HP equal
                     to opposing ball's power. <=0 dies. Default 1.

   WEAPON-SPECIFIC FIELDS:
     LASER:    laserDamage, laserBounces, laserLifetime, laserWidth
     CLUSTER:  shrapnelCount, shrapnelSpeed, shrapnelLifetime, shrapnelDamage
     MISSILE:  homingStrength (0-1), missileTurnRate (rad/frame)
     POISON:   poisonDamage, poisonStacksApplied (per direct hit)
     SLIME:    slimePuddleCount, slimePuddleRadius, slimePuddleHp,
               slimePuddleLifetime, slimePuddleSpread
   ===================================================================== */

const TURRET_TYPES = {

  STANDARD: {
    id: 'STANDARD',
    name: 'Gunner',
    description: 'Balanced all-rounder. Good for baseline matchups.',
    weaponType: 'ball',
    design:    'standard',
    colors: { primary: '#fa2424', secondary: '#ffd166' },  // orange / amber
    hp:              50,
    moveSpeed:       1.6,
    fireCooldown:    620,
    fireCooldownVar: 150,
    ballSpeed:       8.2,
    ballDamage:      7,
    ballRadius:      11,
    ballMaxBounces:  6,
    bulletPower:     1,
    barrelLength:    22,
    aimOscRange:     0.55,
    aimOscSpeed:     0.028,
    turretWidth:     72,
    turretHeight:    28,
  },

  SNIPER: {
    id: 'SNIPER',
    name: 'Sniper',
    description: 'High-power bullets. Long cooldown. Survives crossfire.',
    weaponType: 'sniper',
    design:    'sniper',
    colors: { primary: '#e17af8', secondary: '#585256' },  // forest / lime
    hp:              65,
    moveSpeed:       1.0,
    fireCooldown:    1800,
    fireCooldownVar: 200,
    ballSpeed:       18.0,
    ballDamage:      15,
    ballRadius:      6,
    ballMaxBounces:  3,
    bulletPower:     10,
    barrelLength:    32,
    aimOscRange:     0.45,
    aimOscSpeed:     0.012,
    turretWidth:     78,
    turretHeight:    26,
  },

  CLUSTER: {
    id: 'CLUSTER',
    name: 'Cluster',
    description: 'Cluster shots. On collision, explode into 6 shrapnel pieces.',
    weaponType: 'cluster',
    design:    'cluster',
    colors: { primary: '#e67e22', secondary: '#fdc94e' },  // burnt orange / yellow
    hp:              55,
    moveSpeed:       1.6,
    fireCooldown:    750,
    fireCooldownVar: 150,
    ballSpeed:       6.5,
    ballDamage:      4,
    ballRadius:      9,
    ballMaxBounces:  2,
    bulletPower:     1,
    barrelLength:    22,
    aimOscRange:     0.55,
    aimOscSpeed:     0.030,
    turretWidth:     74,
    turretHeight:    30,
    shrapnelCount:    6,
    shrapnelSpeed:    5.5,
    shrapnelRadius:   4,
    shrapnelLifetime: 1.1,
    shrapnelDamage:   3,
    shrapnelMaxBounces: 1,
  },

  MISSILE: {
    id: 'MISSILE',
    name: 'Missile',
    description: 'Slow homing missile. Low HP, big damage. Can be shot down.',
    weaponType: 'missile',
    design:    'missile',
    colors: { primary: '#bdc3c7', secondary: '#7f8c8d' },  // steel / gunmetal
    hp:              60,
    moveSpeed:       0.8,
    fireCooldown:    1500,
    fireCooldownVar: 250,
    ballSpeed:       5.0,
    ballDamage:      10,
    ballRadius:      7,
    ballMaxBounces:  0,
    bulletPower:     1,
    barrelLength:    28,
    aimOscRange:     0.20,
    aimOscSpeed:     0.012,
    turretWidth:     86,
    turretHeight:    32,
    missileTurnRate:    0.05,
    missileLifetime:   12,
  },

  LASER: {
    id: 'LASER',
    name: 'Laser',
    description: 'Slow beam that bounces off walls and burns through bullets.',
    weaponType: 'laser',
    design:    'laser',
    colors: { primary: '#00e5ff', secondary: '#ffffff' },  // cyan / white
    hp:              45,
    moveSpeed:       1.0,
    fireCooldown:    4000,
    fireCooldownVar: 200,
    barrelLength:    28,
    aimOscRange:     0.30,
    aimOscSpeed:     0.018,
    turretWidth:     84,
    turretHeight:    30,
    ballRadius:      6,
    ballSpeed:       0,
    ballDamage:      0,
    ballMaxBounces:  0,
    bulletPower:     1,
    laserDamage:     16,
    laserBounces:    6,
    laserLifetime:   0.55,
    laserWidth:      4,
  },

  HIJACK: {
    id: 'HIJACK',
    name: 'Hijack',
    description: 'Bullets convert any opposing bullet they touch to your team.',
    weaponType: 'hijack',
    design:    'hijack',
    colors: { primary: '#9b59b6', secondary: '#ff66f9' },  // purple / magenta
    hp:              60,
    moveSpeed:       1.6,
    fireCooldown:    900,
    fireCooldownVar: 150,
    ballSpeed:       7.5,
    ballDamage:      4,
    ballRadius:      10,
    ballMaxBounces:  4,
    bulletPower:     1,
    barrelLength:    24,
    aimOscRange:     0.50,
    aimOscSpeed:     0.025,
    turretWidth:     76,
    turretHeight:    30,
  },

  POISON: {
    id: 'POISON',
    name: 'Poison',
    description: 'Low direct damage. Each hit applies a stack of poison DoT.',
    weaponType: 'poison',
    design:    'poison',
    colors: { primary: '#7cfc00', secondary: '#1e7d1e' },  // toxic green / dark
    hp:              55,
    moveSpeed:       1.5,
    fireCooldown:    700,
    fireCooldownVar: 100,
    ballSpeed:       7.0,
    ballDamage:      2,
    ballRadius:      9,
    ballMaxBounces:  3,
    bulletPower:     1,
    barrelLength:    22,
    aimOscRange:     0.55,
    aimOscSpeed:     0.028,
    turretWidth:     74,
    turretHeight:    30,
    poisonDamage:        1,
    poisonStacksApplied: 1,
  },

  SLIME: {
    id: 'SLIME',
    name: 'Acid Slime',
    description:
      'Slow heavy glob. On contact, splits into stationary slime puddles ' +
      'that block enemy fire. Big damage if a glob actually lands.',
    weaponType: 'slime',
    design:    'slime',
    colors: { primary: '#2ecc71', secondary: '#0e8a4f' },  // bright slime / deep
    hp:              70,           // tankier — short range, high defense
    moveSpeed:       0.9,
    fireCooldown:    1650,
    fireCooldownVar: 250,
    ballSpeed:       3.2,          // very slow
    ballDamage:      20,           // big damage if it actually lands
    ballRadius:      13,           // big glob
    ballMaxBounces:  1,            // explodes after first wall bounce too
    bulletPower:     4,            // hard to shoot down with normal bullets
    barrelLength:    30,
    aimOscRange:     0.35,
    aimOscSpeed:     0.016,
    turretWidth:     82,
    turretHeight:    34,
    // Slime-specific
    slimePuddleCount:    4,        // # of stationary blobs spawned on impact
    slimePuddleRadius:  10,
    slimePuddleHp:       3,        // each puddle absorbs 3 enemy bullets
    slimePuddleLifetime: 7,        // seconds before puddle dries up
    slimePuddleSpread:  75,        // px radius the puddles scatter to
  },

  ORBIT: {
    id: 'ORBIT',
    name: 'Orbit',
    description: 'Fires twin orbs (purple + orange) that arc apart in opposite spirals — unpredictable and hard to intercept.',
    weaponType: 'orbit',
    design:    'orbit',
    colors: { primary: '#9b59b6', secondary: '#e67e22' },
    hp:              65,
    moveSpeed:       1.2,
    fireCooldown:    1100,
    fireCooldownVar: 150,
    ballSpeed:        9.0,
    ballDamage:       8,
    ballRadius:        9,
    ballMaxBounces:    3,
    bulletPower:       2,
    barrelLength:     26,
    aimOscRange:      0.45,
    aimOscSpeed:      0.022,
    turretWidth:      76,
    turretHeight:     30,
    orbitAngularSpeed:  0.12,   // rad/frame — one oscillation every ~52 frames
    orbitRadius:        30,     // px — lateral amplitude of the circle
  },

  LOOKSMAXX: {
    id: 'LOOKSMAXX',
    name: 'Mogging',
    description: 'Fires massive mewing heads. Slow, powerful, and utterly menacing.',
    weaponType: 'looksmaxx',
    design:    'looksmaxx',
    colors: { primary: '#0e40f6', secondary: '#7a4a2a' },  // tan skin / dark brown
    // imageUrl / bulletImageUrl intentionally omitted:
    // drawing file:// images into the canvas taints it, blocking captureStream().
    // The sigma-face vector design (drawSigmaFace) is used instead.
    hp:              65,
    moveSpeed:       0.9,
    fireCooldown:    1450,
    fireCooldownVar: 180,
    ballSpeed:        5.2,
    ballDamage:       24,
    ballRadius:       36,   // ~10% smaller than before
    ballMaxBounces:    4,
    bulletPower:       4,
    barrelLength:     85,
    aimOscRange:      0.40,
    aimOscSpeed:      0.014,
    turretWidth:      90,
    turretHeight:     90,
  },

  BRAINROT: {
    id: 'BRAINROT',
    name: '67 Brainrot',
    description: 'Fires spinning 6s and 7s. On impact they explode into a confetti burst. Very slay.',
    weaponType: 'brainrot',
    design:    'brainrot',
    colors: { primary: '#ff006e', secondary: '#ffbe0b' },
    hp:              67,
    moveSpeed:       1.7,
    fireCooldown:    560,
    fireCooldownVar: 160,
    ballSpeed:       5.0,
    ballDamage:       6,
    ballRadius:      13,
    ballMaxBounces:   6,
    bulletPower:      1,
    barrelLength:    24,
    aimOscRange:     0.55,
    aimOscSpeed:     0.030,
    turretWidth:     72,
    turretHeight:    28,
  },

  BANANA: {
    id: 'BANANA',
    name: 'Banana',
    description: 'Rapid-fire bananas. Each one leaves a slippery peel on death that deflects any bullet ~90° sideways.',
    weaponType: 'banana',
    design:    'banana',
    colors: { primary: '#f1c40f', secondary: '#e67e22' },
    hp:              45,
    moveSpeed:       2.0,
    fireCooldown:    480,
    fireCooldownVar:  60,
    ballSpeed:        4.5,
    ballDamage:        6,
    ballRadius:        7,
    ballMaxBounces:    3,
    bulletPower:       1,
    barrelLength:     22,
    aimOscRange:      0.50,
    aimOscSpeed:      0.032,
    turretWidth:      70,
    turretHeight:     28,
    bananaPeelLifetime: 9,
  },

};

// Default pick for each side on first boot
const DEFAULT_RED_TYPE  = 'STANDARD';
const DEFAULT_BLUE_TYPE = 'STANDARD';

// ---------------------------------------------------------------------
// Helper: resolve a turret type's colors with sensible fallbacks.
// Falls back to team color if no per-type colors exist (back-compat).
// Always returns an object with at least .primary and .secondary.
// ---------------------------------------------------------------------
function turretColors(typeOrTurret) {
  const type = typeOrTurret && typeOrTurret.type ? typeOrTurret.type : typeOrTurret;
  if (type && type.colors && type.colors.primary) {
    return {
      primary:   type.colors.primary,
      secondary: type.colors.secondary || type.colors.primary,
      accent:    type.colors.accent    || type.colors.secondary || type.colors.primary,
    };
  }
  // Back-compat: synthesize from team color if turret was passed
  const t = typeOrTurret && typeOrTurret.team;
  if (t && t.color) {
    return { primary: t.color, secondary: t.color, accent: t.color };
  }
  return { primary: '#cccccc', secondary: '#888888', accent: '#cccccc' };
}
