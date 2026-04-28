/* =====================================================================
   SCENARIOS — maps drawn as ASCII grids
   =====================================================================
   Each scenario has a `grid` field: an array of strings, one per row.
   The parser converts it into actual barrier objects at game start.

   Grid is 12 cols x 16 rows (configurable in config.js -> gridCols/Rows).
   Each cell is a 45x45 px square.
   Top of grid sits at y=120 (60px below the red turret).
   Bottom at y=840 (60px above the blue turret).

   DEFAULT CHARACTER CHEAT SHEET:
     .   empty space
     #   neutral wall      (indestructible, dark gray, blocks both teams)
     1-9 neutral barrier   (destructible, gray; the digit is the HP)
     R   red wall          (indestructible; only blue shots collide)
     B   blue wall         (indestructible; only red shots collide)
     r   red barrier       (destructible; default HP; blocks blue)
     b   blue barrier      (destructible; default HP; blocks red)

   PER-SCENARIO LEGEND OVERRIDES:
     Each scenario can supply a `legend` object that overrides or adds
     character mappings for THAT map only. This is how you give team
     barriers custom HP. Each legend entry can have:
       team:   'neutral' | 'red' | 'blue'   (required)
       hp:     number                       (omit for indestructible)

     Example: a scenario where 'r' is red HP-3 and 'k' is red HP-8:
       legend: {
         r: { team: 'red',  hp: 3 },
         k: { team: 'red',  hp: 8 },
         B: { team: 'blue', hp: 6 },     // turn the B wall into HP barrier
       }
     Anything not in the legend falls back to the default cheat sheet.

   You can include spaces between characters for readability — the parser
   strips whitespace per row before mapping characters to cells. So:
       '. # . . 5 . R . . . # .'
   is identical to:
       '.#..5.R...#.'
   ===================================================================== */


// Default legend (matches cheat sheet above). Each entry returns
// { team, hp? }. Missing hp = indestructible wall.
function defaultLegendEntry(ch) {
  if (ch === '#')                   return { team: 'neutral' };
  if (ch >= '1' && ch <= '9')       return { team: 'neutral', hp: parseInt(ch, 10) };
  if (ch === 'R')                   return { team: 'red'  };
  if (ch === 'B')                   return { team: 'blue' };
  if (ch === 'r')                   return { team: 'red',  hp: CONFIG.defaultBarrierHp };
  if (ch === 'b')                   return { team: 'blue', hp: CONFIG.defaultBarrierHp };
  return null;
}

// Convert a grid (array of row strings) into an array of barrier specs.
// Pass the scenario directly so we can read scenario.legend (optional).
function asciiToBarriers(scenarioOrGrid) {
  // Accept either a scenario object or a raw grid array (legacy callers)
  let grid, legend;
  if (Array.isArray(scenarioOrGrid)) {
    grid = scenarioOrGrid;
    legend = null;
  } else if (scenarioOrGrid && scenarioOrGrid.grid) {
    grid = scenarioOrGrid.grid;
    legend = scenarioOrGrid.legend || null;
  } else {
    return [];
  }

  const out = [];
  const cell = CONFIG.gridCell;
  const yOff = CONFIG.gridYOffset;

  for (let row = 0; row < grid.length && row < CONFIG.gridRows; row++) {
    const raw = (grid[row] || '').replace(/\s/g, '');
    for (let col = 0; col < raw.length && col < CONFIG.gridCols; col++) {
      const ch = raw[col];
      if (ch === '.' || ch === '') continue;

      // Scenario legend wins; fall back to default
      const entry = (legend && legend[ch]) ? legend[ch] : defaultLegendEntry(ch);
      if (!entry) continue;       // unknown char -> ignore

      const x = col * cell + cell / 2;
      const y = yOff + row * cell + cell / 2;
      const spec = {
        x, y,
        w: cell, h: cell,
        team: entry.team || 'neutral',
      };
      if (typeof entry.hp === 'number') spec.hp = entry.hp;
      out.push(spec);
    }
  }
  return out;
}


/* =====================================================================
   SCENARIO LIBRARY
   =====================================================================
   To add a new map: copy any scenario, change the name + grid, and it
   will appear automatically in the dropdown. The grid uses the cheat
   sheet above. Power-up pool can be any subset of:
     'heal' | 'rapid' | 'multi' | 'shield'
   ===================================================================== */

const SCENARIOS = [

  {
    // Refreshed: symmetric HP barriers only — no indestructibles.
    // 4-HP corner guards, 5-HP midfield pairs, 6-HP center duo.
    name: 'Classic Crossfire',
    description: 'Symmetric HP cover that erodes as the fight heats up.',
    grid: [
      '. . . . . . . . . . . .',  //  0
      '. . . . . . . . . . . .',  //  1
      '. . . . . . . . . . . .',  //  2
      '. . 4 . . . . . . 4 . .',  //  3  corner guards
      '. . . . . . . . . . . .',  //  4
      '. . . 5 . 6 6 . 5 . . .',  //  5  mid-upper shield row
      '. . . . . . . . . . . .',  //  6
      '. . . . . . . . . . . .',  //  7  center gap
      '. . . . . . . . . . . .',  //  8  center gap
      '. . . 5 . 6 6 . 5 . . .',  //  9  mid-lower shield row
      '. . . . . . . . . . . .',  // 10
      '. . 4 . . . . . . 4 . .',  // 11  corner guards
      '. . . . . . . . . . . .',  // 12
      '. . . . . . . . . . . .',  // 13
      '. . . . . . . . . . . .',  // 14
      '. . . . . . . . . . . .',  // 15
    ],
    powerupPool: ['heal', 'rapid', 'multi', 'shield'],
  },

  {
    // Lightly updated: swapped the two indestructible center pillars
    // for breakable HP-5 blocks + low-HP side flankers.
    name: 'Open Arena',
    description: 'Nearly naked duel — a small breakable center island.',
    grid: [
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . 3 . . . . . . 3 . .',  //  6  low-HP side flankers
      '. . . . . 5 5 . . . . .',  //  7  center island
      '. . . . . 5 5 . . . . .',  //  8
      '. . 3 . . . . . . 3 . .',  //  9  low-HP side flankers
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
      '. . . . . . . . . . . .',
    ],
    powerupPool: ['heal', 'rapid', 'multi', 'shield'],
  },

  {
    // Each side has a fortified HP bunker close to their turret.
    // Middle is open — the game starts with cover that gradually erodes.
    name: 'Bunkers',
    description: 'Fortified starting positions that slowly crumble under fire.',
    grid: [
      '. . . . . . . . . . . .',  //  0
      '. . 5 5 . . . . 5 5 . .',  //  1  red front bunker
      '. . 5 . . . . . . 5 . .',  //  2  red bunker wings
      '. . . . . . . . . . . .',  //  3
      '. . . . . . . . . . . .',  //  4
      '. . . . . 5 5 . . . . .',  //  5  center upper pair
      '. . . . . . . . . . . .',  //  6
      '. . . . . . . . . . . .',  //  7  open mid
      '. . . . . . . . . . . .',  //  8  open mid
      '. . . . . 5 5 . . . . .',  //  9  center lower pair
      '. . . . . . . . . . . .',  // 10
      '. . . . . . . . . . . .',  // 11
      '. . 5 . . . . . . 5 . .',  // 12  blue bunker wings
      '. . 5 5 . . . . 5 5 . .',  // 13  blue front bunker
      '. . . . . . . . . . . .',  // 14
      '. . . . . . . . . . . .',  // 15
    ],
    powerupPool: ['heal', 'rapid', 'multi', 'shield'],
  },

  {
    // Evenly-spaced diamond-ish scatter of HP-3 to HP-5 barriers.
    // Lots of ricochet angles; barriers peel away as shots accumulate.
    name: 'Diamond Network',
    description: 'Scattered diamond-pattern HP cover — rich ricochet territory.',
    grid: [
      '. . . . . . . . . . . .',  //  0
      '. . . . . . . . . . . .',  //  1
      '. . . 4 . . . . 4 . . .',  //  2  outer diamond points
      '. . . . . . . . . . . .',  //  3
      '. . . . 3 . . 3 . . . .',  //  4  inner upper
      '. . 4 . . . . . . 4 . .',  //  5  side guards
      '. . . . . 5 5 . . . . .',  //  6  center upper
      '. . . . . . . . . . . .',  //  7
      '. . . . . . . . . . . .',  //  8
      '. . . . . 5 5 . . . . .',  //  9  center lower
      '. . 4 . . . . . . 4 . .',  // 10  side guards
      '. . . . 3 . . 3 . . . .',  // 11  inner lower
      '. . . . . . . . . . . .',  // 12
      '. . . 4 . . . . 4 . . .',  // 13  outer diamond points
      '. . . . . . . . . . . .',  // 14
      '. . . . . . . . . . . .',  // 15
    ],
    powerupPool: ['heal', 'rapid', 'multi', 'shield'],
  },

  {
    // Two columns of HP barriers flanking the center lane.
    // HP decreases toward the center (7→5→4) so the path opens up mid-fight.
    name: 'The Channel',
    description: 'Flanking columns of graduated HP — the lane opens as they erode.',
    grid: [
      '. . . . . . . . . . . .',  //  0
      '. . . . . . . . . . . .',  //  1
      '. . . . 7 . . 7 . . . .',  //  2  hard top flankers
      '. . . . . . . . . . . .',  //  3
      '. . . . 5 . . 5 . . . .',  //  4  medium flankers
      '. . . . . . . . . . . .',  //  5
      '. . . . 4 . . 4 . . . .',  //  6  softer approaching center
      '. . . . . . . . . . . .',  //  7  center gap — open
      '. . . . . . . . . . . .',  //  8  center gap — open
      '. . . . 4 . . 4 . . . .',  //  9
      '. . . . . . . . . . . .',  // 10
      '. . . . 5 . . 5 . . . .',  // 11
      '. . . . . . . . . . . .',  // 12
      '. . . . 7 . . 7 . . . .',  // 13  hard bottom flankers
      '. . . . . . . . . . . .',  // 14
      '. . . . . . . . . . . .',  // 15
    ],
    powerupPool: ['heal', 'rapid', 'multi', 'shield'],
  },

  {
    // Dense but systematic scatter — inspired by Chaos Box but
    // all destructible. The arena gradually clears as the fight progresses.
    name: 'Scatter',
    description: 'Dense HP-3 to HP-5 scatter — chaos that clears itself.',
    grid: [
      '. . . . . . . . . . . .',  //  0
      '. . 3 . . . . . . 3 . .',  //  1
      '. . . . 4 . . 4 . . . .',  //  2
      '. 3 . . . . . . . . 3 .',  //  3
      '. . . . . 5 5 . . . . .',  //  4  center upper anchor
      '. . 4 . . . . . . 4 . .',  //  5
      '. . . 3 . . . . 3 . . .',  //  6
      '. . . . . . . . . . . .',  //  7  center gap
      '. . . . . . . . . . . .',  //  8  center gap
      '. . . 3 . . . . 3 . . .',  //  9
      '. . 4 . . . . . . 4 . .',  // 10
      '. . . . . 5 5 . . . . .',  // 11  center lower anchor
      '. 3 . . . . . . . . 3 .',  // 12
      '. . . . 4 . . 4 . . . .',  // 13
      '. . 3 . . . . . . 3 . .',  // 14
      '. . . . . . . . . . . .',  // 15
    ],
    powerupPool: ['heal', 'rapid', 'multi', 'shield'],
  },

];

// Currently-selected scenario (dropdown controls this)
let SCENARIO = SCENARIOS[0];
