(function () {
  'use strict';

  const { generatePuzzle, solve, isGridAdjacent } = window.WendEngine;

  const LANGS = ['en', 'fr', 'de', 'gsw', 'mix'];
  const DIFFS = ['easy', 'medium', 'hard'];
  const LANG_TAGS = { en: 'EN', fr: 'FR', de: 'DE', gsw: 'ZH' };
  const PALETTE_SIZE = 8;
  const PREFS_KEY = 'wendpro.prefs';
  const STATS_KEY = 'wendpro.stats';
  const DOUBLE_TAP_MS = 350;
  const HINT_COOLDOWN_MS = 30000;
  const HIT_RADIUS = 0.42;

  const WIN_TITLES = ['Nicely wended.', 'Every letter home.', 'Clean sweep.', 'Board cleared.', 'Wend mastered.'];
  const CURSED_WIN_TITLES = ['The curse is lifted.', 'You escaped the void.', 'The portals close.', 'Exorcised.'];

  const el = {
    board: document.getElementById('board'),
    cells: document.getElementById('cells'),
    lines: document.getElementById('lines'),
    portalLayer: document.getElementById('portal-layer'),
    words: document.getElementById('words'),
    readout: document.getElementById('readout'),
    timer: document.getElementById('timer'),
    puzzleId: document.getElementById('puzzle-id'),
    share: document.getElementById('share-btn'),
    hint: document.getElementById('hint-btn'),
    hintLabel: document.getElementById('hint-label'),
    undo: document.getElementById('undo-btn'),
    reset: document.getElementById('reset-btn'),
    next: document.getElementById('new-btn'),
    diff: document.getElementById('diff-control'),
    lang: document.getElementById('lang-control'),
    cursed: document.getElementById('cursed-toggle'),
    win: document.getElementById('win-dialog'),
    winEyebrow: document.getElementById('win-eyebrow'),
    winTitle: document.getElementById('win-title'),
    winTime: document.getElementById('win-time'),
    winHints: document.getElementById('win-hints'),
    winBest: document.getElementById('win-best'),
    winSolved: document.getElementById('win-solved'),
    winWords: document.getElementById('win-words'),
    winNext: document.getElementById('win-next'),
    winClose: document.getElementById('win-close'),
    help: document.getElementById('help-dialog'),
    helpBtn: document.getElementById('help-btn'),
    helpClose: document.getElementById('help-close'),
    startBtn: document.getElementById('start-btn'),
  };

  let state = null;
  let tiles = [];
  let beams = [];
  let liveLinks = new Set();
  let messageTimer = 0;
  let lastFoundTap = { word: null, time: 0 };

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function parseHash() {
    const m = location.hash.match(/^#(en|fr|de|gsw|mix)-(easy|medium|hard)-(\d{1,7})(-cursed)?$/);
    return m ? { lang: m[1], diff: m[2], seed: Number(m[3]), cursed: Boolean(m[4]) } : null;
  }

  function hashFor({ lang, diff, seed, cursed }) {
    return `#${lang}-${diff}-${seed}${cursed ? '-cursed' : ''}`;
  }

  /* Puzzle lifecycle */

  function startPuzzle(options) {
    const puzzle = generatePuzzle(options);
    state = {
      puzzle,
      solution: Object.fromEntries(puzzle.words.map((w) => [w.word, w.path])),
      found: [],
      hints: {},
      hintsUsed: 0,
      hintCharged: 0,
      unfogged: new Set(),
      trail: [],
      dragging: false,
      moved: false,
      tapMode: false,
      portalStops: [],
      message: null,
      elapsed: 0,
      runningSince: null,
      started: false,
      solved: false,
    };
    history.replaceState(null, '', hashFor(options));
    writeJSON(PREFS_KEY, { lang: options.lang, diff: options.diff, cursed: options.cursed });
    document.body.classList.toggle('cursed', options.cursed);
    if (el.win.open) el.win.close();
    buildBoard();
    el.board.classList.add('locked');
    render();
  }

  function begin() {
    if (state.started) return;
    state.started = true;
    el.board.classList.remove('locked');
    resumeClock();
    render();
  }

  function newPuzzle(overrides = {}) {
    const { lang, diff, cursed } = state.puzzle;
    startPuzzle({ lang, diff, cursed, ...overrides, seed: randomSeed() });
  }

  const colorOf = (word) => state.puzzle.words.findIndex((w) => w.word === word) % PALETTE_SIZE;

  function tiltFor(cell) {
    const x = Math.sin(cell * 12.9898 + state.puzzle.seed * 78.233) * 43758.5453;
    return ((x - Math.floor(x)) * 8 - 4).toFixed(2);
  }

  function buildBoard() {
    const { rows, cols, grid, links, seed } = state.puzzle;
    el.board.classList.remove('celebrate');
    el.board.style.setProperty('--rows', rows);
    el.board.style.setProperty('--cols', cols);
    el.lines.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    el.cells.replaceChildren();

    const portalOf = new Map();
    links.forEach(([a, b], i) => portalOf.set(a, i).set(b, i));

    tiles = grid.map((letter, i) => {
      const slot = document.createElement('div');
      slot.className = letter ? 'slot' : 'slot blank';
      slot.style.setProperty('--i', (i % cols) + Math.floor(i / cols));
      el.cells.append(slot);
      if (!letter) return null;

      if (portalOf.has(i)) {
        slot.dataset.portal = portalOf.get(i);
        slot.append(buildPortal(i));
      }
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.style.setProperty('--tilt', `${tiltFor(i)}deg`);
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      tile.append(glyph);
      tile.addEventListener('animationend', (e) => {
        if (e.target === tile) tile.classList.remove('pop', 'bad', 'pulse');
        else tile.classList.remove('unveil');
      });
      slot.append(tile);
      return tile;
    });

    buildBeams();
    el.puzzleId.textContent = `No. ${String(seed).padStart(6, '0')}`;
    syncControls();
  }

  /* Portals */

  function spiralArm(offset, turns = 0.7, inner = 22, outer = 48, steps = 28) {
    let d = '';
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const r = inner + (outer - inner) * t;
      const a = offset + t * turns * 2 * Math.PI;
      d += `${s ? 'L' : 'M'}${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
    }
    return d;
  }

  const PORTAL_ARMS = [0, 1, 2, 3].map((k) => spiralArm((k * Math.PI) / 2));

  function buildPortal(cell) {
    const portal = document.createElement('div');
    portal.className = 'portal';
    const arms = (className) =>
      `<g class="${className}">${PORTAL_ARMS.map(
        (d, k) => `<path d="${d}" style="stroke:var(--p${k % 2 ? 'b' : 'a'})"/>`
      ).join('')}</g>`;
    portal.innerHTML = `<svg viewBox="-50 -50 100 100">
      <defs>
        <radialGradient id="portal-core-${cell}">
          <stop offset="0" style="stop-color:#05010d"/>
          <stop offset="0.34" style="stop-color:#05010d;stop-opacity:0.95"/>
          <stop offset="0.72" style="stop-color:var(--pa);stop-opacity:0.4"/>
          <stop offset="1" style="stop-color:var(--pb);stop-opacity:0"/>
        </radialGradient>
      </defs>
      <circle class="core" r="50" fill="url(#portal-core-${cell})"/>
      ${arms('arms arms-back')}
      ${arms('arms')}
      <g class="orbit"><circle cx="38" r="2.6"/><circle cx="-30" cy="17" r="1.8"/><circle cx="6" cy="-27" r="1.4"/></g>
    </svg>`;
    portal.addEventListener('animationend', (e) => {
      if (e.target === portal) portal.classList.remove('surge');
    });
    return portal;
  }

  // Sparks ride the beam between each pair of portals in both directions.
  function buildBeams() {
    const { rows, cols, links } = state.puzzle;
    el.portalLayer.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    el.portalLayer.innerHTML = links
      .map(([a, b], i) => {
        const d = curve(a, b);
        const [x1, y1] = center(a);
        const [x2, y2] = center(b);
        const sparks = [0, 1, 2, 3, 4, 5]
          .map((k) => {
            const points = k % 2 ? '1;0' : '0;1';
            return `<circle class="spark" r="${0.035 + (k % 3) * 0.01}"><animateMotion dur="2.4s" begin="${(-k * 0.4).toFixed(1)}s" repeatCount="indefinite" keyPoints="${points}" keyTimes="0;1" calcMode="linear" path="${d}"/></circle>`;
          })
          .join('');
        return `<g class="beam-group" data-link="${i}">
          <defs><linearGradient id="beam-${i}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
            <stop offset="0" style="stop-color:var(--portal${i}-a)"/><stop offset="1" style="stop-color:var(--portal${i}-b)"/>
          </linearGradient></defs>
          <path class="beam-glow" d="${d}" stroke="url(#beam-${i})"/>
          <path class="beam" d="${d}" stroke="url(#beam-${i})"/>
          ${sparks}
        </g>`;
      })
      .join('');
    beams = [...el.portalLayer.querySelectorAll('.beam-group')];
    liveLinks = new Set();
  }

  // A portal pair comes alive while a trail or a found word jumps through it.
  function renderPortals(owner) {
    const paths = state.found.map((f) => f.path).concat([state.trail]);
    const jumpsThrough = (a, b) =>
      paths.some((p) => p.some((c, k) => k > 0 && ((p[k - 1] === a && c === b) || (p[k - 1] === b && c === a))));
    state.puzzle.links.forEach(([a, b], i) => {
      const live = jumpsThrough(a, b);
      for (const cell of [a, b]) {
        const slot = tiles[cell].parentElement;
        slot.classList.toggle('claimed', owner[cell] >= 0 || state.trail.includes(cell));
        slot.classList.toggle('active', live);
        if (live && !liveLinks.has(i)) retrigger(slot.querySelector('.portal'), 'surge');
      }
      beams[i].classList.toggle('live', live);
      if (live) liveLinks.add(i);
      else liveLinks.delete(i);
    });
  }

  function syncControls() {
    const { lang, diff, cursed } = state.puzzle;
    for (const b of el.diff.querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.value === diff);
    for (const b of el.lang.querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.value === lang);
    el.cursed.checked = cursed;
    document.documentElement.lang = { en: 'en', fr: 'fr', de: 'de', gsw: 'gsw', mix: 'en' }[lang];
  }

  /* Derived board state */

  function ownerMap() {
    const owner = new Array(state.puzzle.grid.length).fill(-1);
    state.found.forEach((f, i) => f.path.forEach((c) => (owner[c] = i)));
    return owner;
  }

  const foundWords = () => new Set(state.found.map((f) => f.word));

  function unfoundWords() {
    const found = foundWords();
    return state.puzzle.words.map((w) => w.word).filter((w) => !found.has(w));
  }

  function hintedCells() {
    const map = new Map();
    for (const word of unfoundWords()) {
      const n = state.hints[word] || 0;
      state.solution[word].slice(0, n).forEach((cell, i) => map.set(cell, i + 1));
    }
    return map;
  }

  function isFogged(cell) {
    return state.puzzle.fog.includes(cell) && !state.unfogged.has(cell);
  }

  function unfog(cells) {
    const { rows, cols, fog } = state.puzzle;
    for (const cell of cells) {
      const r = Math.floor(cell / cols);
      const c = cell % cols;
      const around = [cell];
      if (r > 0) around.push(cell - cols);
      if (r < rows - 1) around.push(cell + cols);
      if (c > 0) around.push(cell - 1);
      if (c < cols - 1) around.push(cell + 1);
      for (const n of around) {
        if (fog.includes(n) && !state.unfogged.has(n)) {
          state.unfogged.add(n);
          tiles[n].classList.add('unveil');
        }
      }
    }
  }

  function freeMask() {
    const owner = ownerMap();
    return Uint8Array.from(state.puzzle.grid, (letter, i) => (letter && owner[i] < 0 ? 1 : 0));
  }

  const letterAt = (cell) => (isFogged(cell) ? '?' : state.puzzle.grid[cell]);

  /* Rendering */

  function render() {
    const owner = ownerMap();
    const hinted = hintedCells();
    const onTrail = new Set(state.trail);

    tiles.forEach((tile, i) => {
      if (!tile) return;
      const step = owner[i] < 0 && hinted.get(i);
      const fogged = isFogged(i);
      tile.firstChild.textContent = fogged ? '?' : state.puzzle.grid[i];
      tile.classList.toggle('found', owner[i] >= 0);
      tile.classList.toggle('trail', onTrail.has(i));
      tile.classList.toggle('hinted', Boolean(step));
      tile.classList.toggle('fog', fogged);
      if (step) tile.dataset.step = step;
      else delete tile.dataset.step;
    });

    renderArt(owner, hinted);
    renderPortals(owner);
    renderWords();
    renderReadout();

    el.undo.disabled = state.solved || !state.found.length;
    el.reset.disabled = state.solved || !state.found.length;
    renderHint();
  }

  // Game time left until the next hint, measured from the start or the last hint.
  const hintWait = () => Math.max(0, HINT_COOLDOWN_MS - (elapsedMs() - state.hintCharged));

  function renderHint() {
    const wait = hintWait();
    const cooling = state.started && !state.solved && wait > 0;
    if (el.hint.classList.contains('cooling') && !cooling && state.started && !state.solved) retrigger(el.hint, 'ready');
    el.hint.classList.toggle('cooling', cooling);
    el.hint.disabled = !state.started || state.solved || wait > 0;
    el.hint.style.setProperty('--charge', 1 - wait / HINT_COOLDOWN_MS);
    const seconds = Math.ceil(wait / 1000);
    el.hintLabel.textContent = cooling ? `${seconds}s` : 'Hint';
    el.hint.setAttribute('aria-label', cooling ? `Hint in ${seconds} seconds` : 'Hint');
  }

  /* Board drawing, in cell units: the SVG viewBox is one unit per cell */

  const DISC_RADIUS = 0.3;
  const HALO_RADIUS = 0.34;

  function center(cell) {
    const { cols } = state.puzzle;
    return [(cell % cols) + 0.5, Math.floor(cell / cols) + 0.5];
  }

  function curve(a, b) {
    const [x1, y1] = center(a);
    const [x2, y2] = center(b);
    const bend = 0.22;
    const cx = (x1 + x2) / 2 - (y2 - y1) * bend;
    const cy = (y1 + y2) / 2 + (x2 - x1) * bend;
    return `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
  }

  function cellRect(cell, fill, opacity = 1) {
    const { cols } = state.puzzle;
    return `<rect x="${cell % cols}" y="${Math.floor(cell / cols)}" width="1" height="1" style="fill:${fill}" opacity="${opacity}"/>`;
  }

  function gridLines() {
    const { rows, cols } = state.puzzle;
    let d = '';
    for (let c = 1; c < cols; c++) d += `M${c} 0V${rows}`;
    for (let r = 1; r < rows; r++) d += `M0 ${r}H${cols}`;
    return `<path class="grid-line" d="${d}"/>`;
  }

  // Thick rules wherever two neighbouring cells belong to different regions:
  // blank, unclaimed letters, or one found word each.
  function regionBorders(owner) {
    const { rows, cols, grid } = state.puzzle;
    const region = (i) => (grid[i] ? owner[i] : -2);
    let d = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (c < cols - 1 && region(i) !== region(i + 1)) d += `M${c + 1} ${r}V${r + 1}`;
        if (r < rows - 1 && region(i) !== region(i + cols)) d += `M${c} ${r + 1}H${c + 1}`;
      }
    }
    return d ? `<path class="region-line" d="${d}"/>` : '';
  }

  function chevron(a, b) {
    const [x1, y1] = center(a);
    const [x2, y2] = center(b);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const along = 0.035;
    const across = 0.065;
    const bx = mx - dx * along;
    const by = my - dy * along;
    return `<path class="chevron" d="M${bx - dy * across} ${by + dx * across}L${mx + dx * along} ${my + dy * along}L${bx + dy * across} ${by - dx * across}"/>`;
  }

  // The badge sits on the side of the start disc facing away from the word.
  function checkBadge(path, color) {
    const { cols } = state.puzzle;
    let [x, y] = center(path[0]);
    const [nx, ny] = center(path[1]);
    const dx = isGridAdjacent(path[0], path[1], cols) ? nx - x : 0;
    const dy = isGridAdjacent(path[0], path[1], cols) ? ny - y : -1;
    x += -dx * 0.26 + (dx === 0 ? 0.26 : 0);
    y += -dy * 0.26 + (dy === 0 ? -0.26 : 0);
    return (
      `<circle class="badge" cx="${x}" cy="${y}" r="0.12" style="stroke:${color}"/>` +
      `<path class="badge-tick" style="stroke:${color}" d="M${x - 0.05} ${y + 0.005}L${x - 0.012} ${y + 0.042}L${x + 0.055} ${y - 0.04}"/>`
    );
  }

  function capsule(path, color, found) {
    const { cols } = state.puzzle;
    const runs = [[path[0]]];
    const jumps = [];
    for (let i = 1; i < path.length; i++) {
      if (isGridAdjacent(path[i - 1], path[i], cols)) runs[runs.length - 1].push(path[i]);
      else {
        jumps.push([path[i - 1], path[i]]);
        runs.push([path[i]]);
      }
    }
    let out = runs
      .map((run) => {
        const pts = run.map((c) => center(c).join(' '));
        if (pts.length === 1) pts.push(pts[0]);
        return `<path class="capsule" style="stroke:${color}" d="M${pts.join('L')}"/>`;
      })
      .join('');
    out += jumps.map(([a, b]) => `<path class="jump" style="stroke:${color}" d="${curve(a, b)}"/>`).join('');
    for (let i = 1; i < path.length; i++) {
      if (isGridAdjacent(path[i - 1], path[i], cols)) out += chevron(path[i - 1], path[i]);
    }
    const [sx, sy] = center(path[0]);
    out += `<circle class="halo" cx="${sx}" cy="${sy}" r="${HALO_RADIUS}"/>`;
    out += `<circle cx="${sx}" cy="${sy}" r="${DISC_RADIUS}" style="fill:${color}"/>`;
    if (found && path.length > 1) out += checkBadge(path, color);
    return out;
  }

  function renderArt(owner, hinted) {
    const { grid } = state.puzzle;
    const parts = [];
    grid.forEach((letter, i) => {
      if (!letter) parts.push(cellRect(i, 'var(--blank)'));
      else if (owner[i] >= 0) parts.push(cellRect(i, `var(--c${state.found[owner[i]].color})`, 0.3));
      else if (isFogged(i)) parts.push(cellRect(i, 'var(--fog)', 0.3));
    });
    parts.push(gridLines(), regionBorders(owner));
    for (const [cell] of hinted) {
      const [x, y] = center(cell);
      if (!state.trail.includes(cell)) parts.push(`<circle class="hint-ring" cx="${x}" cy="${y}" r="${DISC_RADIUS}"/>`);
    }
    for (const f of state.found) parts.push(capsule(f.path, `var(--c${f.color})`, true));
    if (state.trail.length) parts.push(capsule(state.trail, 'var(--trail)', false));
    el.lines.innerHTML = parts.join('');
  }

  function renderWords() {
    const found = new Map(state.found.map((f) => [f.word, f]));
    const mixed = state.puzzle.lang === 'mix';
    const ordered = state.puzzle.words
      .map((w, i) => ({ ...w, color: i % PALETTE_SIZE }))
      .sort((a, b) => a.word.length - b.word.length);

    el.words.innerHTML = ordered
      .map(({ word, lang, color }) => {
        const isFound = found.has(word);
        const shown = isFound ? word.length : state.hints[word] || 0;
        const boxes = [...word]
          .map((ch, i) => `<span class="box${!isFound && i < shown ? ' shown' : ''}">${i < shown ? ch : ''}</span>`)
          .join('');
        const tag = mixed ? `<span class="lang-tag">${LANG_TAGS[lang]}</span>` : '';
        const tick = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6"/></svg>';
        return `<div class="word${isFound ? ' found' : ''}" style="--fill:var(--c${color})">${tag}${boxes}${tick}</div>`;
      })
      .join('');
  }

  function renderReadout() {
    if (state.trail.length) {
      el.readout.className = 'readout';
      el.readout.textContent = state.trail.map(letterAt).join('');
      return;
    }
    if (state.message) {
      el.readout.className = `readout ${state.message.kind}`;
      el.readout.textContent = state.message.text;
      return;
    }
    el.readout.className = 'readout idle';
    if (!state.started) {
      el.readout.textContent = 'Ready when you are';
      return;
    }
    if (state.solved) {
      el.readout.textContent = `Solved in ${formatTime(elapsedMs())}`;
      return;
    }
    const left = unfoundWords().length;
    const one = left === 1;
    el.readout.textContent = state.puzzle.cursed
      ? `${left} ${one ? 'word lurks' : 'words lurk'} in here`
      : `${left} ${one ? 'word' : 'words'} to find`;
  }

  function say(text, kind = 'info') {
    state.message = { text, kind };
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      state.message = null;
      renderReadout();
    }, 1700);
    renderReadout();
  }

  function retrigger(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  /* Clock */

  function elapsedMs() {
    return state.elapsed + (state.runningSince != null ? performance.now() - state.runningSince : 0);
  }

  function pauseClock() {
    state.elapsed = elapsedMs();
    state.runningSince = null;
  }

  function resumeClock() {
    if (state.started && !state.solved && state.runningSince == null) state.runningSince = performance.now();
  }

  setInterval(() => {
    if (!state) return;
    el.timer.textContent = formatTime(elapsedMs());
    renderHint();
  }, 250);

  document.addEventListener('visibilitychange', () => (document.hidden ? pauseClock() : resumeClock()));

  /* Moves */

  function clearTrail() {
    state.trail = [];
    state.tapMode = false;
  }

  function submitTrail() {
    const trail = state.trail;
    clearTrail();
    if (trail.length < 3) {
      render();
      return;
    }
    const word = trail.map((c) => state.puzzle.grid[c]).join('');
    const open = unfoundWords();
    if (!open.includes(word)) {
      reject(trail, foundWords().has(word) ? 'Already found' : state.puzzle.cursed ? 'The board hisses at you' : 'Not one of the hidden words');
      return;
    }
    const placement = placeOthers(word, trail);
    if (!placement) {
      reject(trail, 'Right word, wrong trail');
      return;
    }
    accept(word, trail, placement);
  }

  // Returns trail placements for every other unfound word that leave the board solvable, or null.
  function placeOthers(word, trail) {
    const others = unfoundWords().filter((w) => w !== word);
    const onTrail = new Set(trail);
    if (others.every((w) => state.solution[w].every((c) => !onTrail.has(c)))) {
      return Object.fromEntries(others.map((w) => [w, state.solution[w]]));
    }
    const free = freeMask();
    trail.forEach((c) => (free[c] = 0));
    const prefixes = {};
    for (const w of others) {
      if (state.hints[w]) prefixes[w] = state.solution[w].slice(0, state.hints[w]);
    }
    return solve(state.puzzle, free, others, prefixes) || solve(state.puzzle, free, others);
  }

  function accept(word, trail, placement) {
    for (const [w, path] of Object.entries(placement)) {
      const old = state.solution[w];
      const n = state.hints[w] || 0;
      if (n && path.slice(0, n).some((c, i) => c !== old[i])) delete state.hints[w];
      state.solution[w] = path;
    }
    state.solution[word] = trail;
    delete state.hints[word];
    state.found.push({ word, path: trail, color: colorOf(word) });
    unfog(trail);
    render();
    trail.forEach((c, k) => {
      tiles[c].style.setProperty('--k', k);
      retrigger(tiles[c], 'pop');
    });
    if (state.found.length === state.puzzle.words.length) finish();
    else say(word, 'good');
  }

  function reject(trail, message) {
    render();
    trail.forEach((c) => retrigger(tiles[c], 'bad'));
    retrigger(el.board, 'shake');
    say(message, 'bad');
  }

  function release(word) {
    state.found = state.found.filter((f) => f.word !== word);
    clearTrail();
    render();
  }

  function undo() {
    if (!state.started || state.solved || !state.found.length) return;
    state.found.pop();
    clearTrail();
    render();
  }

  function reset() {
    if (!state.started || state.solved || !state.found.length) return;
    state.found = [];
    clearTrail();
    render();
  }

  function giveHint() {
    if (!state.started || state.solved || hintWait() > 0) return;
    clearTrail();
    const open = unfoundWords().filter((w) => (state.hints[w] || 0) < w.length);
    if (!open.length) {
      say('Every letter is already revealed');
      render();
      return;
    }
    const started = open.filter((w) => state.hints[w]).sort((a, b) => state.hints[b] - state.hints[a]);
    const word = started[0] || open[Math.floor(Math.random() * open.length)];
    state.hints[word] = (state.hints[word] || 0) + 1;
    state.hintsUsed++;
    state.hintCharged = elapsedMs();
    const cell = state.solution[word][state.hints[word] - 1];
    if (isFogged(cell)) {
      state.unfogged.add(cell);
      tiles[cell].classList.add('unveil');
    }
    render();
    retrigger(tiles[cell], 'pulse');
  }

  /* Winning */

  function recordWin(ms) {
    const { lang, diff, cursed } = state.puzzle;
    const stats = readJSON(STATS_KEY, {});
    const key = `${lang}-${diff}${cursed ? '-cursed' : ''}`;
    const entry = stats[key] || { solved: 0, best: null };
    entry.solved++;
    const isBest = entry.best == null || ms < entry.best;
    if (isBest) entry.best = ms;
    stats[key] = entry;
    writeJSON(STATS_KEY, stats);
    return { ...entry, isBest };
  }

  function finish() {
    pauseClock();
    state.solved = true;
    const ms = elapsedMs();
    const record = recordWin(ms);
    render();
    retrigger(el.board, 'celebrate');

    const titles = state.puzzle.cursed ? CURSED_WIN_TITLES : WIN_TITLES;
    el.winEyebrow.textContent = record.isBest && record.solved > 1 ? 'New best time' : 'Solved';
    el.winTitle.textContent = titles[Math.floor(Math.random() * titles.length)];
    el.winTime.textContent = formatTime(ms);
    el.winHints.textContent = state.hintsUsed;
    el.winBest.textContent = formatTime(record.best);
    el.winSolved.textContent = record.solved;
    const mixed = state.puzzle.lang === 'mix';
    el.winWords.innerHTML = state.puzzle.words
      .map(
        (w, i) =>
          `<span style="--fill:var(--c${i % PALETTE_SIZE})">${w.word}${mixed ? `<small>${LANG_TAGS[w.lang]}</small>` : ''}</span>`
      )
      .join('');
    setTimeout(() => {
      if (state.solved && !el.win.open) el.win.showModal();
    }, 950);
  }

  /* Pointer input */

  function cellAt(e, strict) {
    const { rows, cols, grid } = state.puzzle;
    const rect = el.cells.getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * cols;
    const fy = ((e.clientY - rect.top) / rect.height) * rows;
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    if (strict) {
      const dx = fx - c - 0.5;
      const dy = fy - r - 0.5;
      if (dx * dx + dy * dy > HIT_RADIUS * HIT_RADIUS) return null;
    }
    const cell = r * cols + c;
    return grid[cell] ? cell : null;
  }

  const linked = (a, b) => state.puzzle.adj[a].includes(b);

  function portalTwin(cell) {
    for (const [a, b] of state.puzzle.links) {
      if (a === cell) return b;
      if (b === cell) return a;
    }
    return null;
  }

  function onPointerDown(e) {
    if (!state.started || state.solved || e.button > 0) return;
    const cell = cellAt(e, false);
    if (cell == null) return;
    e.preventDefault();
    resumeClock();

    const owner = ownerMap();
    if (owner[cell] >= 0) {
      const word = state.found[owner[cell]].word;
      const now = performance.now();
      if (lastFoundTap.word === word && now - lastFoundTap.time < DOUBLE_TAP_MS) {
        lastFoundTap = { word: null, time: 0 };
        release(word);
      } else {
        lastFoundTap = { word, time: now };
      }
      return;
    }

    const t = state.trail;
    if (state.tapMode && t.length) {
      const last = t[t.length - 1];
      const pos = t.indexOf(cell);
      if (cell === last && t.length > 1) {
        submitTrail();
        return;
      }
      if (pos >= 0) t.length = pos + 1;
      else if (linked(last, cell)) t.push(cell);
      else state.trail = [cell];
    } else {
      state.trail = [cell];
    }
    state.dragging = true;
    state.moved = false;
    state.portalStops = [];
    rememberPortalStop();
    try {
      el.board.setPointerCapture(e.pointerId);
    } catch {}
    render();
  }

  // A drag from a portal to its twin crosses other tiles, which extends or backtracks the trail on the way.
  // Each trail that ends on a portal is kept so reaching the twin can restore it.
  function rememberPortalStop() {
    const t = state.trail;
    if (portalTwin(t[t.length - 1]) != null) state.portalStops.push(t.slice());
  }

  function onPointerMove(e) {
    if (!state.dragging) return;
    const cell = cellAt(e, true);
    if (cell == null) return;
    const t = state.trail;
    const last = t[t.length - 1];
    if (cell === last) return;
    const free = ownerMap()[cell] < 0;
    if (t.length > 1 && cell === t[t.length - 2]) {
      t.pop();
    } else if (free && !t.includes(cell) && linked(last, cell)) {
      t.push(cell);
    } else {
      const stop = free && state.portalStops.findLast((s) => portalTwin(s[s.length - 1]) === cell && !s.includes(cell));
      if (!stop) return;
      state.trail = stop.concat(cell);
    }
    rememberPortalStop();
    state.moved = true;
    render();
  }

  function onPointerUp() {
    if (!state.dragging) return;
    state.dragging = false;
    if (state.moved && state.trail.length > 1) submitTrail();
    else state.tapMode = true;
  }

  el.board.addEventListener('pointerdown', onPointerDown);
  el.board.addEventListener('pointermove', onPointerMove);
  el.board.addEventListener('pointerup', onPointerUp);
  el.board.addEventListener('pointercancel', () => (state.dragging = false));

  document.addEventListener('pointerdown', (e) => {
    if (!state.trail.length || el.board.contains(e.target) || e.target.closest('button, dialog')) return;
    clearTrail();
    render();
  });

  /* Controls */

  el.diff.addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (value && value !== state.puzzle.diff) newPuzzle({ diff: value });
  });

  el.lang.addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (value && value !== state.puzzle.lang) newPuzzle({ lang: value });
  });

  el.cursed.addEventListener('change', () => newPuzzle({ cursed: el.cursed.checked }));

  el.startBtn.addEventListener('click', begin);
  el.hint.addEventListener('click', giveHint);
  el.undo.addEventListener('click', undo);
  el.reset.addEventListener('click', reset);
  el.next.addEventListener('click', () => newPuzzle());
  el.winNext.addEventListener('click', () => newPuzzle());
  el.winClose.addEventListener('click', () => el.win.close());
  el.helpBtn.addEventListener('click', () => el.help.showModal());
  el.helpClose.addEventListener('click', () => el.help.close());

  for (const dialog of [el.win, el.help]) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  el.share.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      say('Link copied');
    } catch {
      say('Copy the address bar to share');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (el.win.open || el.help.open || e.altKey) return;
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (!state.started && (key === 'enter' || key === ' ')) {
      e.preventDefault();
      begin();
    } else if (key === 'h') giveHint();
    else if (key === 'u') undo();
    else if (key === 'n') newPuzzle();
    else if (key === 'escape') {
      clearTrail();
      render();
    }
  });

  window.addEventListener('hashchange', () => {
    const h = parseHash();
    if (h && hashFor(h) !== hashFor(state.puzzle)) startPuzzle(h);
  });

  /* Boot */

  const prefs = readJSON(PREFS_KEY, {});
  startPuzzle(
    parseHash() || {
      lang: LANGS.includes(prefs.lang) ? prefs.lang : 'en',
      diff: DIFFS.includes(prefs.diff) ? prefs.diff : 'medium',
      cursed: Boolean(prefs.cursed),
      seed: randomSeed(),
    }
  );
})();
