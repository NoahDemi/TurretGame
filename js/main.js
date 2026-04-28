/* =====================================================================
   MAIN — UI wiring + boot
   =====================================================================
   Grabs DOM references, populates dropdowns from data files, wires up
   buttons, and kicks off the render loop.
   ===================================================================== */

// --- DOM references (used by rendering.js via globals) ----------------
const canvas   = document.getElementById('stage');
canvas.width   = CONFIG.width;
canvas.height  = CONFIG.height;
const ctx      = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const pageTitleEl      = document.getElementById('pageTitle');
const scenarioSelect   = document.getElementById('scenarioSelect');
const redTurretSelect  = document.getElementById('redTurretSelect');
const blueTurretSelect = document.getElementById('blueTurretSelect');
const muteBtn          = document.getElementById('muteBtn');

const gridText         = document.getElementById('gridText');
const gridApplyBtn     = document.getElementById('gridApplyBtn');
const gridRevertBtn    = document.getElementById('gridRevertBtn');
const gridCopyBtn      = document.getElementById('gridCopyBtn');
const gridEditorStatus = document.getElementById('gridEditorStatus');

// Holds an in-memory grid override per scenario index. If non-null, the
// current SCENARIO uses this grid instead of the original.
const SCENARIO_GRID_OVERRIDES = new Map();


/* ---- POPULATE DROPDOWNS --------------------------------------------- */

// Scenario dropdown
SCENARIOS.forEach((s, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = s.name;
  scenarioSelect.appendChild(opt);
});
const randomOpt = document.createElement('option');
randomOpt.value = 'random';
randomOpt.textContent = '-- Random --';
scenarioSelect.appendChild(randomOpt);

// Default to Open Arena instead of Classic Crossfire
scenarioSelect.value = '1';

// Turret dropdowns (one for each team)
function populateTurretDropdown(select, defaultId) {
  Object.values(TURRET_TYPES)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(tt => {
      const opt = document.createElement('option');
      opt.value = tt.id;
      opt.textContent = tt.name;
      if (tt.id === defaultId) opt.selected = true;
      select.appendChild(opt);
    });
}
populateTurretDropdown(redTurretSelect,  DEFAULT_RED_TYPE);
populateTurretDropdown(blueTurretSelect, DEFAULT_BLUE_TYPE);


/* ---- SELECTION HANDLERS --------------------------------------------- */

function applyScenarioSelection() {
  const v = scenarioSelect.value;
  if (v === 'random') {
    SCENARIO = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  } else {
    SCENARIO = SCENARIOS[parseInt(v, 10)] || SCENARIOS[0];
  }
  // Apply any in-memory grid override the user has saved for this scenario
  applyGridOverride();
  refreshGridEditor();
}

function getScenarioKey() {
  // Use the scenario's array index as its key, or the name if not in array
  const idx = SCENARIOS.indexOf(SCENARIO);
  return idx >= 0 ? 'idx:' + idx : 'name:' + SCENARIO.name;
}

function applyGridOverride() {
  if (!SCENARIO) return;
  const key = getScenarioKey();
  if (SCENARIO_GRID_OVERRIDES.has(key)) {
    SCENARIO.grid = SCENARIO_GRID_OVERRIDES.get(key).slice();
  }
}

function applyTurretSelections() {
  redTypeId  = redTurretSelect.value  || DEFAULT_RED_TYPE;
  blueTypeId = blueTurretSelect.value || DEFAULT_BLUE_TYPE;
}

function currentMatchupLabel() {
  const r = TURRET_TYPES[redTypeId]  ? TURRET_TYPES[redTypeId].name  : redTypeId;
  const b = TURRET_TYPES[blueTypeId] ? TURRET_TYPES[blueTypeId].name : blueTypeId;
  const label = r + ' vs ' + b;
  if (pageTitleEl) pageTitleEl.textContent = 'Turret Battle — ' + label;
  return SCENARIO.name + ' — ' + label;
}

function rebuildFromSelections(label) {
  applyScenarioSelection();
  applyTurretSelections();
  running = false;
  buildWorld();
  statusEl.textContent = label || currentMatchupLabel();
  statusEl.style.color = '#eaeaea';
}

scenarioSelect.onchange   = () => rebuildFromSelections();
redTurretSelect.onchange  = () => rebuildFromSelections();
blueTurretSelect.onchange = () => rebuildFromSelections();


/* ---- BUTTON HANDLERS ------------------------------------------------ */

function startBattle() {
  initAudio();
  applyScenarioSelection();
  applyTurretSelections();
  buildWorld();
  beginRecording();  // no-op if no pending stream
  running     = false;
  introUntil  = performance.now() + 2400;
  statusEl.textContent = currentMatchupLabel() + ' — GET READY...';
  statusEl.style.color = '#eaeaea';
  lastFrame   = 0;
  setTimeout(() => {
    introUntil = 0;
    running    = true;
    statusEl.textContent = currentMatchupLabel() + ' — battle in progress...';
  }, 2400);
}

document.getElementById('startBtn').onclick = startBattle;

document.getElementById('resetBtn').onclick = () => {
  rebuildFromSelections();
};

document.querySelectorAll('button.speed').forEach(b => {
  b.onclick = () => {
    speedMul = parseInt(b.dataset.speed, 10);
    document.querySelectorAll('button.speed').forEach(x => {
      x.classList.toggle('active', x === b);
    });
  };
});

/* ---- SCREEN RECORDING ----------------------------------------------- */
const recordBtn = document.getElementById('recordBtn');
let mediaRecorder    = null;
let recordChunks     = [];
let pendingStream    = null;
let pendingMime      = '';
let pendingExt       = 'webm';
let _displayCapture  = null;   // kept alive so audio track doesn't die early

function _resetRecordBtn() {
  recordBtn.innerHTML = '&#9210; Record';
  recordBtn.classList.remove('recording');
}

recordBtn.onclick = () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  } else {
    armRecording();
  }
};

async function armRecording() {
  initAudio();

  // Start with a canvas-only video stream (always available, no permissions).
  // captureStream throws SecurityError if the canvas was tainted by a
  // cross-origin image drawn via file:// — catch and bail gracefully.
  let canvasTrack;
  try {
    canvasTrack = canvas.captureStream(60).getVideoTracks()[0];
  } catch (e) {
    alert('Canvas is tainted by a local image and cannot be recorded.\nRefresh the page before recording, or run the game from a local server.');
    return;
  }
  let stream = new MediaStream([canvasTrack]);

  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 60 } },
      audio: true,
      preferCurrentTab: true,
    });

    const audioTracks = display.getAudioTracks();

    if (audioTracks.length > 0) {
      // Keep the display stream alive — stopping its video tracks can
      // immediately end the audio tracks too (same capture session).
      // We'll stop everything in onstop instead.
      _displayCapture = display;
      stream = new MediaStream([
        canvas.captureStream(60).getVideoTracks()[0],
        ...audioTracks,
      ]);
      // If the user clicks "Stop sharing" in the browser bar, end gracefully
      audioTracks[0].onended = () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
        else { pendingStream = null; _resetRecordBtn(); }
      };
    } else {
      // User didn't share audio — stop display (no audio to keep alive)
      display.getTracks().forEach(t => t.stop());
    }
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
    // getDisplayMedia unavailable — proceed with video-only canvas stream
  }

  pendingMime = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find(t => MediaRecorder.isTypeSupported(t)) || '';
  pendingExt    = pendingMime.startsWith('video/mp4') ? 'mp4' : 'webm';
  pendingStream = stream;

  startBattle();
}

function beginRecording() {
  if (!pendingStream) return;
  const stream   = pendingStream;
  const mime     = pendingMime;
  const ext      = pendingExt;
  pendingStream  = null;

  recordChunks  = [];
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});

  mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) recordChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    // Now it's safe to stop the display capture
    if (_displayCapture) {
      _displayCapture.getTracks().forEach(t => t.stop());
      _displayCapture = null;
    }
    const blob = new Blob(recordChunks, { type: mime || 'video/webm' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const d    = new Date();
    const pad  = n => String(n).padStart(2, '0');
    a.download = 'turret-battle_' +
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    _resetRecordBtn();
    mediaRecorder = null;
  };

  mediaRecorder.start();
  recordBtn.innerHTML = '&#9209; Stop & Save';
}


muteBtn.onclick = () => {
  soundMuted = !soundMuted;
  muteBtn.innerHTML = soundMuted ? '&#128263; Muted' : '&#128266; Sound';
  muteBtn.classList.toggle('muted', soundMuted);
};


/* ---- GRID EDITOR ---------------------------------------------------- */

function setEditorStatus(msg, kind) {
  if (!gridEditorStatus) return;
  gridEditorStatus.textContent = msg || '';
  gridEditorStatus.className = 'grid-editor-status' + (kind ? ' ' + kind : '');
  if (msg) {
    clearTimeout(setEditorStatus._t);
    setEditorStatus._t = setTimeout(() => {
      gridEditorStatus.textContent = '';
      gridEditorStatus.className = 'grid-editor-status';
    }, 2200);
  }
}

// Render the active SCENARIO's grid into the textarea (uses override if set,
// otherwise the live SCENARIO.grid).
function refreshGridEditor() {
  if (!gridText) return;
  const key = getScenarioKey();
  const lines = SCENARIO_GRID_OVERRIDES.has(key)
    ? SCENARIO_GRID_OVERRIDES.get(key)
    : (SCENARIO.grid || []);
  gridText.value = lines.join('\n');
}

// Parse the textarea into a clean grid array. Keeps row count up to
// CONFIG.gridRows, pads short rows with '.', truncates long rows.
function parseGridText(text) {
  if (typeof text !== 'string') return [];
  const raw = text.split(/\r?\n/);
  const rows = [];
  for (const line of raw) {
    // Strip whitespace per row for consistency with asciiToBarriers parser
    const stripped = line.replace(/\s/g, '');
    // Skip wholly empty lines that happen to fall outside meaningful content
    rows.push(stripped);
  }
  // Trim trailing fully-empty rows to avoid runaway growth
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

// Validate parsed grid: dimensions + recognized chars
function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    return { ok: false, msg: 'Grid is empty.' };
  }
  if (grid.length > CONFIG.gridRows) {
    return { ok: false, msg: 'Too many rows (' + grid.length + ' > ' + CONFIG.gridRows + ').' };
  }
  // Build allowed-char set: '.', and anything in default legend OR scenario legend
  const legend = SCENARIO && SCENARIO.legend ? SCENARIO.legend : null;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (row.length > CONFIG.gridCols) {
      return {
        ok: false,
        msg: 'Row ' + (r + 1) + ' has ' + row.length + ' cells (max ' + CONFIG.gridCols + ').',
      };
    }
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      if (legend && legend[ch]) continue;
      if (defaultLegendEntry(ch)) continue;
      return {
        ok: false,
        msg: 'Unknown character "' + ch + '" at row ' + (r + 1) + ', col ' + (c + 1) + '.',
      };
    }
  }
  return { ok: true };
}

function applyGridFromEditor() {
  const grid = parseGridText(gridText.value);
  const v = validateGrid(grid);
  if (!v.ok) {
    setEditorStatus(v.msg, 'error');
    return;
  }
  // Save override and apply to live scenario
  const key = getScenarioKey();
  SCENARIO_GRID_OVERRIDES.set(key, grid.slice());
  SCENARIO.grid = grid.slice();
  // Rebuild world with new grid
  running = false;
  buildWorld();
  statusEl.textContent = currentMatchupLabel();
  statusEl.style.color = '#eaeaea';
  setEditorStatus('Applied. World rebuilt.', 'ok');
}

function revertGridFromEditor() {
  const key = getScenarioKey();
  if (!SCENARIO_GRID_OVERRIDES.has(key)) {
    setEditorStatus('Nothing to revert.', 'ok');
    refreshGridEditor();
    return;
  }
  // Find the scenario index to pull pristine grid back from SCENARIOS source
  const idx = SCENARIOS.indexOf(SCENARIO);
  if (idx < 0) {
    setEditorStatus('Cannot find original (custom scenario?).', 'error');
    return;
  }
  // SCENARIOS array still holds the (mutated) live scenario, but the override
  // map remembers the user-edited copy. To get the original, we need to drop
  // the override and re-read SCENARIOS[idx].grid AS IT EXISTS NOW. Since we
  // mutated it on apply, restoring requires the source-file grid which we
  // capture once on boot (see ORIGINAL_GRIDS below).
  SCENARIO_GRID_OVERRIDES.delete(key);
  if (ORIGINAL_GRIDS[idx]) SCENARIO.grid = ORIGINAL_GRIDS[idx].slice();
  refreshGridEditor();
  running = false;
  buildWorld();
  statusEl.textContent = currentMatchupLabel();
  statusEl.style.color = '#eaeaea';
  setEditorStatus('Reverted to default.', 'ok');
}

async function copyGridFromEditor() {
  const text = gridText.value;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for non-secure-context / file:// browsers
      gridText.select();
      document.execCommand('copy');
      gridText.selectionStart = gridText.selectionEnd;
    }
    setEditorStatus('Copied to clipboard.', 'ok');
  } catch (e) {
    setEditorStatus('Copy failed: ' + (e && e.message || e), 'error');
  }
}

if (gridApplyBtn)  gridApplyBtn.onclick  = applyGridFromEditor;
if (gridRevertBtn) gridRevertBtn.onclick = revertGridFromEditor;
if (gridCopyBtn)   gridCopyBtn.onclick   = copyGridFromEditor;

// Capture pristine source-file grids ONCE so Revert can restore them even
// after mutations.
const ORIGINAL_GRIDS = SCENARIOS.map(s => (s.grid || []).slice());


/* ---- BOOT ----------------------------------------------------------- */
applyScenarioSelection();
applyTurretSelections();
buildWorld();
draw();
statusEl.textContent = currentMatchupLabel();
refreshGridEditor();
rafId = requestAnimationFrame(loop);
