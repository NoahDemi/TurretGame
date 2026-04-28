/* =====================================================================
   SOUND SYSTEM — Web Audio API (no external files)
   =====================================================================
   Four sounds:
     - redHit:    high click for red ball hitting walls/barriers
     - blueHit:   low click for blue ball hitting walls/barriers
     - clash:     noisy burst when opposite-team balls annihilate
     - turretHit: big thump/boom when a turret takes damage

   All tunable in SOUND_CONFIG below. Master volume controls everything.
   Audio must be initialized by a user gesture (Start button does it).
   ===================================================================== */

const SOUND_CONFIG = {
  masterVolume: 0.35,

  redHit:    { freq: 880, type: 'triangle', duration: 0.08, volume: 0.5 },
  blueHit:   { freq: 330, type: 'triangle', duration: 0.09, volume: 0.5 },
  clash:     { freq: 180,                    duration: 0.28, volume: 0.9 },
  turretHit: { freq: 90,                     duration: 0.45, volume: 1.0 },
  // Sci-fi laser zap: high pitch sweeping down with a square-wave bite
  laser:     { freqStart: 1500, freqEnd: 220, duration: 0.42, volume: 0.7 },

  // Sharp rifle crack — short, bright, with click on top
  sniper:    { freq: 2400, duration: 0.18, volume: 0.85 },

  // Whoosh on missile launch + low boom on impact
  missileLaunch:  { freqStart: 60,  freqEnd: 140, duration: 0.55, volume: 0.55 },
  missileExplode: { freq: 70,                    duration: 0.55, volume: 1.0 },

  // Small pop for shrapnel pieces
  shrapnel:  { freq: 600, duration: 0.10, volume: 0.4 },

  // Bubbly drip for poison
  poison:    { freqStart: 380, freqEnd: 90,  duration: 0.22, volume: 0.55 },

  // Electric zap for hijack conversion
  hijack:    { freqStart: 220, freqEnd: 1400, duration: 0.18, volume: 0.65 },

  // Minimum gap between repeated sounds (ms) to prevent audio storm
  minInterval: 25,
};

let audioCtx = null;
let soundMuted = false;
let lastSoundAt = {};
let soundBus = null;

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    soundBus = audioCtx.createGain();
    soundBus.connect(audioCtx.destination);
  } catch (e) {
    console.warn('Web Audio not supported', e);
  }
}

function playTone(key, opts) {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt[key] && t - lastSoundAt[key] < SOUND_CONFIG.minInterval) return;
  lastSoundAt[key] = t;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = opts.type || 'sine';
  // Slight pitch variance so repeated hits don't sound identical
  const pitchJitter = 1 + (Math.random() - 0.5) * 0.08;
  osc.frequency.setValueAtTime(opts.freq * pitchJitter, now);
  // Pitch drop for a percussive feel
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freq * 0.5), now + opts.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(opts.volume * SOUND_CONFIG.masterVolume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
  osc.connect(gain).connect(soundBus);
  osc.start(now);
  osc.stop(now + opts.duration + 0.02);
}

function playNoise(key, opts) {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt[key] && t - lastSoundAt[key] < SOUND_CONFIG.minInterval) return;
  lastSoundAt[key] = t;

  const now = audioCtx.currentTime;
  const bufSize = Math.floor(audioCtx.sampleRate * opts.duration);
  const buffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    const env = Math.pow(1 - i / bufSize, 1.8);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  // Low-pass to make it thumpy rather than hissy
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(opts.freq * 6, now);
  filter.frequency.exponentialRampToValueAtTime(opts.freq, now + opts.duration);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(opts.volume * SOUND_CONFIG.masterVolume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
  src.connect(filter).connect(gain).connect(soundBus);
  src.start(now);
  src.stop(now + opts.duration + 0.02);

  // Pitched tone layer on top for more heft (clash/turretHit)
  const osc = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(opts.freq * 2, now);
  osc.frequency.exponentialRampToValueAtTime(opts.freq * 0.5, now + opts.duration);
  oscGain.gain.setValueAtTime(opts.volume * SOUND_CONFIG.masterVolume * 0.6, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
  osc.connect(oscGain).connect(soundBus);
  osc.start(now);
  osc.stop(now + opts.duration + 0.02);
}

function soundRedHit()    { playTone('redHit',    SOUND_CONFIG.redHit); }
function soundBlueHit()   { playTone('blueHit',   SOUND_CONFIG.blueHit); }

// 64-note battle theme in A-minor pentatonic (A C D E G across 3 octaves).
// Structure: main theme (bars 1-4) → build (5-8) → theme return (9-12) →
//            bridge/peak (13-14) → resolution (15-16) → loops back.
// At ~2 events/sec the full theme takes ~30 s — long enough to feel like a song.
const BATTLE_THEME = [
  // Bars 1-2  Main theme: catchy rising motif
  330, 392, 440, 392,  330, 294, 261, 294,
  // Bars 3-4  Theme response: mirrors back down
  330, 392, 440, 330,  294, 261, 294, 330,
  // Bars 5-6  Build: climb toward upper register
  392, 440, 523, 440,  392, 330, 392, 440,
  // Bars 7-8  Peak 1: reach D5/E5 and fall back
  523, 587, 659, 587,  523, 440, 392, 330,
  // Bars 9-10 Theme return (A-section repeat — recognition moment)
  330, 392, 440, 392,  330, 294, 261, 294,
  // Bars 11-12 Variation: descend then rise again
  392, 330, 294, 261,  294, 330, 392, 440,
  // Bars 13-14 Bridge: highest energy, G5 climax
  440, 523, 587, 659,  784, 659, 587, 523,
  // Bars 15-16 Resolution: descend all the way home to A3
  440, 392, 330, 294,  261, 294, 330, 220,
];
let _noteIdx = 0;

// ── WINDCHIME CORE ───────────────────────────────────────────────────────────
// Metal pipe resonance: fundamental + inharmonic overtones at ~2.756× and
// ~5.404× (the actual ratios for a free-free metal bar). Multiple notes ringing
// simultaneously create the characteristic shimmer of a real windchime.
function playChime(freq, vol) {
  if (!audioCtx) return;
  const v   = (vol || 0.50) * SOUND_CONFIG.masterVolume;
  const now = audioCtx.currentTime;

  // Fundamental — longest ring (1.6 s)
  const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
  o1.type = 'sine'; o1.frequency.value = freq;
  g1.gain.setValueAtTime(0.0001, now);
  g1.gain.exponentialRampToValueAtTime(v,         now + 0.004);
  g1.gain.exponentialRampToValueAtTime(v * 0.15,  now + 0.35);
  g1.gain.exponentialRampToValueAtTime(0.0001,    now + 1.60);
  o1.connect(g1).connect(soundBus); o1.start(now); o1.stop(now + 1.65);

  // 1st overtone ~2.756× — medium ring (0.65 s), gives metallic colour
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o2.type = 'sine'; o2.frequency.value = freq * 2.756;
  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(v * 0.45,  now + 0.003);
  g2.gain.exponentialRampToValueAtTime(0.0001,    now + 0.65);
  o2.connect(g2).connect(soundBus); o2.start(now); o2.stop(now + 0.70);

  // 2nd overtone ~5.404× — bright click at attack only (0.18 s)
  const o3 = audioCtx.createOscillator(), g3 = audioCtx.createGain();
  o3.type = 'sine'; o3.frequency.value = freq * 5.404;
  g3.gain.setValueAtTime(0.0001, now);
  g3.gain.exponentialRampToValueAtTime(v * 0.18,  now + 0.002);
  g3.gain.exponentialRampToValueAtTime(0.0001,    now + 0.18);
  o3.connect(g3).connect(soundBus); o3.start(now); o3.stop(now + 0.20);
}

// Outer arena wall bounce — soft muted thud, no melody contribution.
function soundWallBounce() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['wallBounce'] && t - lastSoundAt['wallBounce'] < 30) return;
  lastSoundAt['wallBounce'] = t;

  const now     = audioCtx.currentTime;
  const bufSize = Math.floor(audioCtx.sampleRate * 0.05);
  const buf     = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data    = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 1.8);
  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'lowpass';
  filter.frequency.value = 600;   // muffled, not bright
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.18 * SOUND_CONFIG.masterVolume, now);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  src.connect(filter).connect(ng).connect(soundBus);
  src.start(now);
}

// Bounce off wall/barrier — steps through BATTLE_THEME, plays a chime.
// Throttle raised to 55 ms so long-decay notes don't overload the graph.
function soundBounce() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['bounce'] && t - lastSoundAt['bounce'] < 55) return;
  lastSoundAt['bounce'] = t;

  const base = BATTLE_THEME[_noteIdx];
  _noteIdx   = (_noteIdx + 1) % BATTLE_THEME.length;
  // Tiny organic detune ±1.5 %
  playChime(base * (1 + (Math.random() - 0.5) * 0.015), 0.50);
}

// Ball-vs-ball clash — short filtered noise tick, no melody contribution.
// Stays out of the way of the windchime barrier sounds.
function soundClash() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['clash'] && t - lastSoundAt['clash'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['clash'] = t;

  const now     = audioCtx.currentTime;
  const bufSize = Math.floor(audioCtx.sampleRate * 0.04);
  const buf     = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data    = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'highpass';
  filter.frequency.value = 1800;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.35 * SOUND_CONFIG.masterVolume, now);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  src.connect(filter).connect(ng).connect(soundBus);
  src.start(now);
}

// Turret hit — deep bass gong (very low chime, long sustain).
// Acts as the tonal anchor below the high melody notes.
function soundTurretHit() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['turretHit'] && t - lastSoundAt['turretHit'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['turretHit'] = t;

  const now = audioCtx.currentTime;
  const v   = SOUND_CONFIG.masterVolume;

  // Low fundamental ~80 Hz — deep gong body (2 s ring)
  const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
  o1.type = 'sine'; o1.frequency.value = 80;
  g1.gain.setValueAtTime(0.0001, now);
  g1.gain.exponentialRampToValueAtTime(v,        now + 0.006);
  g1.gain.exponentialRampToValueAtTime(v * 0.10, now + 0.60);
  g1.gain.exponentialRampToValueAtTime(0.0001,   now + 2.00);
  o1.connect(g1).connect(soundBus); o1.start(now); o1.stop(now + 2.05);

  // Gong overtone ~2.756× = 220 Hz — the root A note, ties it to melody
  const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
  o2.type = 'sine'; o2.frequency.value = 220;
  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(v * 0.50, now + 0.005);
  g2.gain.exponentialRampToValueAtTime(0.0001,   now + 0.90);
  o2.connect(g2).connect(soundBus); o2.start(now); o2.stop(now + 0.95);

  // High shimmer ~440 Hz (A4) — bell-like brightness on impact
  const o3 = audioCtx.createOscillator(), g3 = audioCtx.createGain();
  o3.type = 'sine'; o3.frequency.value = 440;
  g3.gain.setValueAtTime(0.0001, now);
  g3.gain.exponentialRampToValueAtTime(v * 0.25, now + 0.003);
  g3.gain.exponentialRampToValueAtTime(0.0001,   now + 0.30);
  o3.connect(g3).connect(soundBus); o3.start(now); o3.stop(now + 0.35);
}
function soundShrapnel()  { playTone('shrapnel',  SOUND_CONFIG.shrapnel); }

// Sharp sniper crack: tone burst + noise click for the "snap" attack
function soundSniper() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['sniper'] && t - lastSoundAt['sniper'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['sniper'] = t;

  const cfg = SOUND_CONFIG.sniper;
  const now = audioCtx.currentTime;

  // Bright tone snap
  const osc = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(cfg.freq, now);
  osc.frequency.exponentialRampToValueAtTime(cfg.freq * 0.25, now + cfg.duration);
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.exponentialRampToValueAtTime(cfg.volume * SOUND_CONFIG.masterVolume * 0.7, now + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.duration);
  osc.connect(oscGain).connect(soundBus);
  osc.start(now);
  osc.stop(now + cfg.duration + 0.02);

  // Short noise click on top
  const bufSize = Math.floor(audioCtx.sampleRate * 0.04);
  const buffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1800;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = cfg.volume * SOUND_CONFIG.masterVolume * 0.6;
  src.connect(filter).connect(noiseGain).connect(soundBus);
  src.start(now);
  src.stop(now + 0.05);
}

// Missile launch: low whoosh that sweeps up slightly
function soundMissileLaunch() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['missileLaunch'] && t - lastSoundAt['missileLaunch'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['missileLaunch'] = t;

  const cfg = SOUND_CONFIG.missileLaunch;
  const now = audioCtx.currentTime;

  // Filtered noise whoosh
  const bufSize = Math.floor(audioCtx.sampleRate * cfg.duration);
  const buffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    const env = Math.sin((i / bufSize) * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cfg.freqStart * 6, now);
  filter.frequency.exponentialRampToValueAtTime(cfg.freqEnd * 8, now + cfg.duration);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(cfg.volume * SOUND_CONFIG.masterVolume, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.duration);
  src.connect(filter).connect(gain).connect(soundBus);
  src.start(now);
  src.stop(now + cfg.duration + 0.02);
}

// Missile explosion: heavy thump (uses noise generator)
function soundMissileExplode() { playNoise('missileExplode', SOUND_CONFIG.missileExplode); }

// Poison drip: short downward burble — sine sweeps down with vibrato
function soundPoison() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['poison'] && t - lastSoundAt['poison'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['poison'] = t;

  const cfg = SOUND_CONFIG.poison;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(cfg.freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(cfg.freqEnd, now + cfg.duration);

  // Vibrato LFO for the gurgle effect
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 18;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 30;
  lfo.connect(lfoGain).connect(osc.frequency);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(cfg.volume * SOUND_CONFIG.masterVolume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.duration);

  osc.connect(gain).connect(soundBus);
  osc.start(now);
  lfo.start(now);
  osc.stop(now + cfg.duration + 0.02);
  lfo.stop(now + cfg.duration + 0.02);
}

// Hijack zap: rising electric buzz
function soundHijack() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['hijack'] && t - lastSoundAt['hijack'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['hijack'] = t;

  const cfg = SOUND_CONFIG.hijack;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(cfg.freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(cfg.freqEnd, now + cfg.duration);

  // Buzz modulation
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 80;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 200;
  lfo.connect(lfoGain).connect(osc.frequency);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(cfg.volume * SOUND_CONFIG.masterVolume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.duration);

  osc.connect(gain).connect(soundBus);
  osc.start(now);
  lfo.start(now);
  osc.stop(now + cfg.duration + 0.02);
  lfo.stop(now + cfg.duration + 0.02);
}

// Laser zap: dual oscillator (square + slightly-detuned sawtooth) sweeping
// from a bright high pitch down to a low boom over the duration. Classic
// sci-fi pew with a touch of grit.
function soundLaser() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['laser'] && t - lastSoundAt['laser'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['laser'] = t;

  const cfg = SOUND_CONFIG.laser;
  const start = audioCtx.currentTime;
  const end = start + cfg.duration;

  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.0001, start);
  masterGain.gain.exponentialRampToValueAtTime(cfg.volume * SOUND_CONFIG.masterVolume, start + 0.01);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, end);
  masterGain.connect(soundBus);

  // Primary: square wave, big sweep
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'square';
  osc1.frequency.setValueAtTime(cfg.freqStart, start);
  osc1.frequency.exponentialRampToValueAtTime(cfg.freqEnd, end);
  const g1 = audioCtx.createGain();
  g1.gain.value = 0.45;
  osc1.connect(g1).connect(masterGain);
  osc1.start(start);
  osc1.stop(end + 0.02);

  // Secondary: detuned sawtooth a fifth above for harmonic shimmer
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(cfg.freqStart * 1.5, start);
  osc2.frequency.exponentialRampToValueAtTime(cfg.freqEnd * 1.5, end);
  osc2.detune.value = 12;
  const g2 = audioCtx.createGain();
  g2.gain.value = 0.25;
  osc2.connect(g2).connect(masterGain);
  osc2.start(start);
  osc2.stop(end + 0.02);
}

// Looksmaxxing shoot — deep heavy bass WHOMP
function soundLooksmaxx() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['looksmaxx'] && t - lastSoundAt['looksmaxx'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['looksmaxx'] = t;

  const now = audioCtx.currentTime;

  // Primary: sine sweep from mid to sub-bass
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(190, now);
  osc.frequency.exponentialRampToValueAtTime(52, now + 0.38);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.9 * SOUND_CONFIG.masterVolume, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  osc.connect(gain).connect(soundBus);
  osc.start(now); osc.stop(now + 0.44);

  // Sub layer: triangle sub-bass thump
  const osc2  = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(85, now);
  osc2.frequency.exponentialRampToValueAtTime(38, now + 0.32);
  gain2.gain.setValueAtTime(0.75 * SOUND_CONFIG.masterVolume, now);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
  osc2.connect(gain2).connect(soundBus);
  osc2.start(now); osc2.stop(now + 0.38);
}

// 67 Brainrot shoot — cartoony ascending whoop (300 → 1600 → 900 Hz)
function soundBrainrotShoot() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['brainrotShoot'] && t - lastSoundAt['brainrotShoot'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['brainrotShoot'] = t;

  const now = audioCtx.currentTime;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(1600, now + 0.07);
  osc.frequency.exponentialRampToValueAtTime(900,  now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.65 * SOUND_CONFIG.masterVolume, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
  osc.connect(gain).connect(soundBus);
  osc.start(now);
  osc.stop(now + 0.22);
}

// 67 Brainrot pop — comic noise burst + downward pitch boing on bullet death
function soundBrainrotPop() {
  if (soundMuted || !audioCtx) return;
  const t = performance.now();
  if (lastSoundAt['brainrotPop'] && t - lastSoundAt['brainrotPop'] < SOUND_CONFIG.minInterval) return;
  lastSoundAt['brainrotPop'] = t;

  const now = audioCtx.currentTime;

  // Short noise pop
  const bufSize = Math.floor(audioCtx.sampleRate * 0.07);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 1.4);
  const src  = audioCtx.createBufferSource();
  src.buffer = buf;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.9 * SOUND_CONFIG.masterVolume, now);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  src.connect(ng).connect(soundBus);
  src.start(now);

  // Boing tone: high → low pitch drop
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(160, now + 0.18);
  gain.gain.setValueAtTime(0.55 * SOUND_CONFIG.masterVolume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
  osc.connect(gain).connect(soundBus);
  osc.start(now);
  osc.stop(now + 0.22);
}
