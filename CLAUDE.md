# TurretGame

2D physics-based turret battle game in vanilla HTML/JS. Output is short
clips for YouTube Shorts (Noah / @SimulationGrid). Two turrets fight
inside an arena until one dies; viewers watch them duel.

## Quick Run

Open `index.html` directly in a browser — no build step, no dev server,
no bundler. The game must keep working from `file://`. Don't introduce
ES modules, npm dependencies at runtime, or anything that requires a
server.

## Tech Stack

- Matter.js v0.19.0 (loaded via CDN `<script>`) — physics engine
- HTML5 Canvas 2D — all rendering
- Web Audio API — all sounds are synthesized (oscillators + buffer
  noise); no audio files
- Plain `<script>` tags in fixed load order — no ES modules

## File Layout

```
index.html              — page shell, canvas, UI panel, grid editor
css/styles.css          — styles for UI panel + grid editor
js/config.js            — CONFIG constants, RED/BLUE teams, CAT_* bit flags
js/sound.js             — synthesized sound effects + 64-note battle theme
js/turret-types.js      — turret type registry + turretColors() helper
js/scenarios.js         — arena layouts (grids of barriers)
js/rendering.js         — all drawing (turrets, bullets, lasers, FX)
js/weapons.js           — fireLaser, spawnShrapnel, spawnSlimePuddles,
                          spawnBananaPeel, steerMissile, tickPoison
js/game.js              — Engine, collision events, step(), createBall
js/main.js              — boot, scenario picker, grid editor, recording
```

Script load order matters; it's set in `index.html` and matches the
list above. `config.js` must load first.

## Core Conventions

### Teams

```js
const RED  = { id: 'red',  color: '#e74c3c', tint: '#ff6b5b' };
const BLUE = { id: 'blue', color: '#3498db', tint: '#5dade2' };
```

Defined in `config.js`. The UI and winner screen avoid "Red/Blue"
language — use the turret type name instead (e.g. "Gunner wins!").

### Collision Categories (bit flags)

```
CAT_WALL              0x0001
CAT_NEUTRAL_BARRIER   0x0002
CAT_RED_BALL          0x0004
CAT_BLUE_BALL         0x0008
CAT_RED_TURRET        0x0010
CAT_BLUE_TURRET       0x0020
CAT_POWERUP           0x0040
CAT_RED_BARRIER       0x0080
CAT_BLUE_BARRIER      0x0100
```

Per-team barriers are filtered asymmetrically: a ball's mask EXCLUDES
its own team's barrier category, so own-team balls pass through own-team
barriers (Slime puddles, Banana peels use neutral `CAT_NEUTRAL_BARRIER`
so they affect everyone).

### Per-Type Color Theming

Each turret type carries `colors: { primary, secondary }`. Use the
helpers — never raw `t.team.color`:

```js
turretColors(typeOrTurret)  // → { primary, secondary, accent }
bulletColors(b)             // resolves via b.ownerType, falls back to team
```

Every ball gets `body.ownerType = turret.type` at creation so the
renderer resolves type colors even after a hijack flips `ball.team`.
Special cases: Orbit orbs carry `b.orbitColor` (purple/orange per orb),
which `bulletColors()` checks first.

### Weapon `kind` values

```
'standard'   Gunner default ball
'sniper'     Fast high-power rifle shot
'cluster'    Explodes into shrapnel on death
'missile'    Homing; big explosion on death
'hijack'     Flips opposing ball to own team
'poison'     Applies DoT stack on hit
'shrapnel'   Cluster sub-projectile
'slime'      Spawns puddles on death
'orbit'      Two-orb pair circling each other (see Orbit mechanics)
'banana'     Leaves a peel barrier on death
'brainrot'   Spinning "6"/"7" digit; confetti on death
'looksmaxx'  Large sigma face; uses drawSigmaFace() shared helper
```

Lasers are not balls — they live in `lasers[]` as polyline records.

### Turret type IDs

```
STANDARD   → Gunner          SNIPER     → Sniper
CLUSTER    → Cluster         MISSILE    → Missile
LASER      → Laser           HIJACK     → Hijack
POISON     → Poison          SLIME      → Acid Slime
ORBIT      → Orbit           BANANA     → Banana
BRAINROT   → 67 Brainrot     LOOKSMAXX  → Looksmaxxing
```

The `STANDARD` key is preserved (display name changed to "Gunner") so
saved scenarios still resolve.

## Special Mechanics

### HP Barrier Bouncing

Balls now **bounce off destructible HP barriers** instead of always
dying on contact. In `damageBarrier()`:

1. Barrier loses 1 HP (removed if HP ≤ 0).
2. Ball's `bounces` counter increments.
3. If `bounces >= maxBounces` → ball dies (triggering special deaths).
4. Otherwise → ball continues; Matter.js already reversed velocity.

This means a Gunner ball with `ballMaxBounces: 6` can deflect off up
to 6 HP barriers before expiring.

### Lasers

Built once at fire time as a list of `segments` (bounce points computed
via raycasting). The beam reveals over time via `revealedLen`. Damage
is queued in `hits[]` and applied as the reveal frontier reaches each
hit's `dist`.

### Hijack vs Laser (split beam)

When a Hijack ball touches a beam owned by the opposing team:
```js
L.hijackedAt = { dist, team, ownerType };
```
`laserTeamAt(L, d)` / `laserOwnerTypeAt(L, d)` resolve the owner at
any point. `applyLaserHit` skips friendly-fire for the hijacked portion.

### Acid Slime Puddles

A Slime ball spawns N stationary puddles on death. Puddles use the
firing team's `CAT_*_BARRIER` so own-team balls pass through. Enemy
balls hit and damage them. Puddles also **slow enemy turrets** that
walk over them (`slimePuddleSlowMult`) and deal contact damage at a
rate of `slimePuddleContactCooldown` seconds. Puddles expire after
`slimePuddleLifetime` seconds.

### Orbit Orbs

`fire()` spawns two balls for each shot. Each stores:
- `orbitPhase0` — 0 for purple orb, π for orange orb
- `orbitFrame` — frame counter (increments each step)
- `orbitSpawnX/Y` — birth position
- `forwardVx/Vy` — fixed forward velocity

Each frame in `step()`, position is computed analytically:
```
centre = spawnPos + forwardVel * orbitFrame
theta  = orbitPhase0 + orbitFrame * orbitAngularSpeed
pos    = centre + perpendicular * orbitRadius * cos(theta)
```
The two orbs at phase 0 and π are always on opposite sides of the
centre line — they trace a perfect helix with no drift.

### Banana Peels

`spawnBananaPeel(ball)` in `weapons.js` creates an `isSensor:true`
neutral barrier. When any ball touches it, `damageBarrier` detects
`barrier.isBananaPeel`, deflects the ball ~80–110° sideways without
killing it, and decrements peel HP. Peels expire after `peelLifetime`
seconds (checked in the `step()` barrier loop via `b.peelBornSec`).

### 67 Brainrot Confetti

When a `'brainrot'` ball dies (any cause), the dead-ball cleanup loop
in `step()` pushes a `'confetti'` FX record with 20 pre-calculated
particle vectors. `drawFx()` renders each particle with gravity
(`0.5 * gravity * elapsed²`) and rotation.

### Looksmaxxing Sigma Face

Both the turret body and the bullet call the shared helper:
```js
drawSigmaFace(ctx, r, col, jawOpen)
```
- Turret: `r = min(w,h)*0.5`, `jawOpen = abs(sin(timeSec*7)) * r*0.18`
- Bullet: `jawOpen = 0`, rotated to face direction of travel

### Intro Overlay / Recording

On Start Battle:
1. `introUntil = performance.now() + 2400` — triggers `drawIntroOverlay()`
2. `beginRecording()` — starts MediaRecorder if armed
3. After 2.4 s — `running = true`, game begins

Recording flow: click **Record** → `armRecording()` (getDisplayMedia
dialog) → click **Start Battle** → `beginRecording()` fires. The intro
screen is captured. Prefers MP4/H.264 and falls back to WebM.

### Sound: Battle Theme

Bounces and clashes share a 64-note composed melody (`BATTLE_THEME` in
`sound.js`, index `_noteIdx`). Structure: main theme → build → theme
return → bridge → resolution (AABA × 2). Every bounce advances the
index and plays the corresponding note (triangle wave + faint echo).
Clashes play the same note as a square-wave rimshot accent. Turret hits
play a sine-pitch-drop kick drum (110→28 Hz) as the rhythmic anchor.

## Canvas Layout

Canvas is 540×960 (9:16, ideal for Shorts). Game content is scaled to
84% and inset, leaving room for:
- **Top (76 px)**: matchup title banner (`drawMatchupBanner`)
- **Sides (~43 px each)**: diagonal stripe pattern in the two turret
  type colors (`drawBorderFrame`, pattern cached in `_borderPat`)
- **Bottom (~78 px)**: stripe pattern

The border pattern and banner are drawn OUTSIDE the `ctx.save/scale`
block; game content (turrets, balls, FX) is drawn inside it.

## Power-ups

Power-ups are **disabled** (`CONFIG.powerupEnabled = false`). The
infrastructure remains in `game.js` / `config.js` so they can be
re-enabled. Do not add `maybeDropPowerup` calls to new barrier types.

## Scenarios

Six maps, all using destructible HP barriers only (no indestructible
walls). Designed for 30–60 second battles:

```
Classic Crossfire   Symmetric 4-6 HP guards + midfield shields
Open Arena          Near-empty, small breakable centre island
Bunkers             Fortified starting positions + centre pairs
Diamond Network     Scattered 3-5 HP diamond-pattern cover
The Channel         Graduated-HP flanking columns (7→4→7)
Scatter             Dense 3-5 HP scatter, clears during the fight
```

Default on load: **Open Arena** (index 1, set in `main.js`).

## Gotchas

- **Don't add ES modules.** Plain `<script>` global scope is required
  for `file://`.
- **`teams.js` does not exist** — RED and BLUE live in `config.js`.
- **Bullet `team` can flip mid-flight** (hijack). Prefer `b.ownerType`
  for coloring.
- **Lasers bypass the ball collision system** — damage via
  `updateLasers()` / `applyLaserHit()` only.
- **Orbit balls use `Body.setPosition` each frame** — their velocity is
  set analytically. Wall collision bounce-counting still fires via
  Matter.js `collisionStart`, but the position override means orbs
  don't physically deflect off walls; they die at max bounces.
- **Collision events** fire on `'collisionStart'`; both `bodyA` and
  `bodyB` are checked since Matter doesn't guarantee order.
- **`drawSigmaFace`** must be defined before `TURRET_DESIGNS` in
  `rendering.js` since the looksmaxx design calls it at render time.
- **`_noteIdx`** is the shared melody counter in `sound.js`. Both
  `soundBounce` and `soundClash` advance it — don't add a separate
  counter for new sound events; use this one to stay in key.

## Dev Commands

```bash
# Syntax check all JS files
cd js && for f in *.js; do node --check "$f"; done

# Open the game (mac)
open ../index.html
```

No test suite — verification is parse-checking + manual play-through.

## Style

- Comment intent and non-obvious physics tricks; skip narrating trivial code.
- Prefer adding to existing functions over introducing new files.
- Keep helpers next to their first caller unless shared cross-file.
- Match existing brace/spacing style (no Prettier).

## Adding a New Turret Type — Checklist

1. Add an entry to `TURRET_TYPES` in `js/turret-types.js` with `id`,
   `name`, `weaponType`, `design`, `colors`, and stat block.
2. If it has a new bullet `kind`, add a draw function in
   `js/rendering.js` and a `case` in the `drawBalls` dispatch.
3. Add a draw function entry in `TURRET_DESIGNS` for the body.
4. If it needs a custom launch sound, create a `sound<Name>()` in
   `js/sound.js` and route it in `createBall`'s sound switch.
5. If on-death behavior is special, hook it into all death paths in
   `game.js`: `damageTurret`, `damageBarrier`, `bounceBall`,
   `handleBallVsBall`, and the dead-ball cleanup loop in `step()`.
6. Update `CLAUDE.md`.
