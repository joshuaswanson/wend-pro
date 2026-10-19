(function () {
  'use strict';

  const DIFFICULTIES = {
    easy: { rows: 4, cols: 4, count: [3, 4], len: [3, 5], blanks: [1, 3] },
    medium: { rows: 5, cols: 5, count: [4, 5], len: [4, 6], blanks: [1, 3] },
    hard: { rows: 6, cols: 6, count: [5, 6], len: [5, 8], blanks: [0, 2] },
  };

  const MIX_LANGS = ['en', 'fr', 'de'];
  const MIX_OVERRIDES = { medium: { count: [6, 6], len: [3, 5] } };

  const CURSES = {
    easy: { portals: 1, fog: 1, flipRate: 0.15 },
    medium: { portals: 2, fog: 2, flipRate: 0.18 },
    hard: { portals: 2, fog: 3, flipRate: 0.2 },
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (rng, list) => list[Math.floor(rng() * list.length)];

  function shuffle(rng, list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function gridNeighbors(cell, rows, cols) {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    const out = [];
    if (r > 0) out.push(cell - cols);
    if (r < rows - 1) out.push(cell + cols);
    if (c > 0) out.push(cell - 1);
    if (c < cols - 1) out.push(cell + 1);
    return out;
  }

  function isGridAdjacent(a, b, cols) {
    const dr = Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
    const dc = Math.abs((a % cols) - (b % cols));
    return dr + dc === 1;
  }

  function buildAdjacency(rows, cols, links) {
    const adj = [];
    for (let i = 0; i < rows * cols; i++) adj.push(gridNeighbors(i, rows, cols));
    for (const [a, b] of links) {
      adj[a].push(b);
      adj[b].push(a);
    }
    return adj;
  }

  function reverseRange(list, from, to) {
    while (from < to) {
      [list[from], list[to]] = [list[to], list[from]];
      from++;
      to--;
    }
  }

  // Backbite move for sampling Hamiltonian paths (Mansfield 2006).
  function backbite(path, adj, rng) {
    if (rng() < 0.5) path.reverse();
    const n = path.length;
    const v = pick(rng, adj[path[n - 1]]);
    if (v === path[n - 2]) return;
    reverseRange(path, path.indexOf(v) + 1, n - 1);
  }

  function randomHamiltonianPath(rows, cols, adj, rng) {
    const path = [];
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) path.push(r * cols + (r % 2 ? cols - 1 - i : i));
    }
    const steps = path.length * path.length * 2;
    for (let s = 0; s < steps; s++) backbite(path, adj, rng);
    return path;
  }

  function normalize(lang, raw) {
    let word = raw.trim();
    if (lang === 'fr') {
      word = word
        .replace(/œ/gi, 'oe')
        .replace(/æ/gi, 'ae')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
    } else {
      word = word.normalize('NFC');
    }
    word = word.toUpperCase();
    const allowed = lang === 'de' || lang === 'gsw' ? /^[A-ZÄÖÜ]+$/ : /^[A-Z]+$/;
    return allowed.test(word) ? word : null;
  }

  const banks = {};

  function wordSet(lang) {
    const set = new Set();
    for (const raw of window.WEND_WORDS[lang].split(/\s+/)) {
      const word = raw && normalize(lang, raw);
      if (word) set.add(word);
    }
    return set;
  }

  function bucketByLength(words) {
    const byLength = new Map();
    for (const word of words) {
      if (!byLength.has(word.length)) byLength.set(word.length, []);
      byLength.get(word.length).push(word);
    }
    return byLength;
  }

  function wordBank(lang) {
    if (!banks[lang]) banks[lang] = bucketByLength(wordSet(lang));
    return banks[lang];
  }

  // Words spelled the same in two mixed-mode languages are dropped so each word's language tag is unambiguous.
  function mixBank() {
    if (banks.mix) return banks.mix;
    const sets = Object.fromEntries(MIX_LANGS.map((l) => [l, wordSet(l)]));
    banks.mix = {};
    for (const lang of MIX_LANGS) {
      const others = MIX_LANGS.filter((l) => l !== lang);
      const unique = [...sets[lang]].filter((w) => others.every((o) => !sets[o].has(w)));
      banks.mix[lang] = bucketByLength(unique);
    }
    return banks.mix;
  }

  function splitLengths(rng, total, count, [lo, hi]) {
    let extra = total - count * lo;
    if (extra < 0 || extra > count * (hi - lo)) return null;
    const lengths = Array(count).fill(lo);
    while (extra > 0) {
      const i = Math.floor(rng() * count);
      if (lengths[i] < hi) {
        lengths[i]++;
        extra--;
      }
    }
    return lengths;
  }

  function pickWords(rng, lengths, langs, bankFor) {
    const used = new Set();
    const words = [];
    for (let i = 0; i < lengths.length; i++) {
      const pool = (bankFor(langs[i]).get(lengths[i]) || []).filter((w) => !used.has(w));
      if (!pool.length) return null;
      const word = pick(rng, pool);
      used.add(word);
      words.push(word);
    }
    return words;
  }

  function pickPortals(rng, rows, cols, count) {
    const links = [];
    const taken = new Set();
    for (let tries = 0; links.length < count && tries < 200; tries++) {
      const a = randInt(rng, 0, rows * cols - 1);
      const b = randInt(rng, 0, rows * cols - 1);
      if (taken.has(a) || taken.has(b)) continue;
      const dist = Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs((a % cols) - (b % cols));
      if (dist < 3) continue;
      links.push([a, b]);
      taken.add(a).add(b);
    }
    return links.length === count ? links : null;
  }

  function linksUsedInsideWords(path, segmentAt, links) {
    return links.every(([a, b]) => {
      const pa = path.indexOf(a);
      const pb = path.indexOf(b);
      return Math.abs(pa - pb) === 1 && segmentAt[pa] >= 0 && segmentAt[pa] === segmentAt[pb];
    });
  }

  function generatePuzzle({ lang, diff, seed, cursed = false }) {
    const mixed = lang === 'mix';
    const cfg = { ...DIFFICULTIES[diff], ...(mixed ? MIX_OVERRIDES[diff] : null) };
    const bankFor = mixed ? (l) => mixBank()[l] : () => wordBank(lang);
    const rng = mulberry32(seed);
    const { rows, cols } = cfg;
    const area = rows * cols;
    const curse = CURSES[diff];

    for (let attempt = 0; attempt < 1000; attempt++) {
      const blanks = randInt(rng, ...cfg.blanks);
      const total = area - blanks;
      const counts = [];
      for (let k = cfg.count[0]; k <= cfg.count[1]; k++) {
        if (mixed && k % MIX_LANGS.length) continue;
        if (k * cfg.len[0] <= total && total <= k * cfg.len[1]) counts.push(k);
      }
      if (!counts.length) continue;
      const k = pick(rng, counts);
      const lengths = splitLengths(rng, total, k, cfg.len);
      if (!lengths) continue;
      const langs = mixed
        ? shuffle(rng, Array.from({ length: k }, (_, i) => MIX_LANGS[i % MIX_LANGS.length]))
        : Array(k).fill(lang);
      const words = pickWords(rng, lengths, langs, bankFor);
      if (!words) continue;

      const gaps = Array(k + 1).fill(0);
      for (let b = 0; b < blanks; b++) gaps[randInt(rng, 0, k)]++;
      const segmentAt = [];
      gaps.forEach((gap, i) => {
        for (let g = 0; g < gap; g++) segmentAt.push(-1);
        if (i < k) for (let j = 0; j < lengths[i]; j++) segmentAt.push(i);
      });

      const links = cursed ? pickPortals(rng, rows, cols, curse.portals) : [];
      if (!links) continue;
      const adj = buildAdjacency(rows, cols, links);
      const path = randomHamiltonianPath(rows, cols, adj, rng);
      if (links.length) {
        let tries = 0;
        while (!linksUsedInsideWords(path, segmentAt, links) && tries++ < 400) {
          for (let s = 0; s < area; s++) backbite(path, adj, rng);
        }
        if (!linksUsedInsideWords(path, segmentAt, links)) continue;
      }

      const grid = Array(area).fill(null);
      const placed = [];
      let at = gaps[0];
      words.forEach((word, i) => {
        const cells = path.slice(at, at + word.length);
        cells.forEach((cell, j) => (grid[cell] = word[j]));
        placed.push({ word, lang: langs[i], path: cells });
        at += word.length + gaps[i + 1];
      });

      const puzzle = { lang, diff, seed, cursed, rows, cols, grid, adj, links, words: placed, fog: [], distort: {} };
      if (cursed) addVisualCurses(puzzle, curse, rng);
      return puzzle;
    }
    throw new Error(`Could not generate a ${diff} puzzle for ${lang}`);
  }

  function addVisualCurses(puzzle, curse, rng) {
    const portalCells = new Set(puzzle.links.flat());
    const letterCells = puzzle.grid.map((l, i) => (l ? i : -1)).filter((i) => i >= 0 && !portalCells.has(i));
    puzzle.fog = shuffle(rng, letterCells.slice()).slice(0, curse.fog);
    const fogged = new Set(puzzle.fog);
    for (const cell of letterCells) {
      if (fogged.has(cell) || rng() >= curse.flipRate) continue;
      puzzle.distort[cell] = rng() < 0.5 ? 'flip' : 'mirror';
    }
  }

  function tracePaths(word, grid, adj, free, prefix) {
    const results = [];
    const path = [];
    const used = new Uint8Array(grid.length);

    function extend(cell) {
      path.push(cell);
      used[cell] = 1;
      const k = path.length;
      if (k === word.length) {
        results.push(path.slice());
      } else {
        for (const next of adj[cell]) {
          if (!free[next] || used[next] || grid[next] !== word[k]) continue;
          if (prefix && k < prefix.length && prefix[k] !== next) continue;
          extend(next);
        }
      }
      path.pop();
      used[cell] = 0;
    }

    const starts = prefix && prefix.length ? [prefix[0]] : grid.map((_, i) => i);
    for (const s of starts) {
      if (free[s] && grid[s] === word[0]) extend(s);
    }
    return results;
  }

  // Assumes the free cells add up to exactly the total length of `words`,
  // so any placement of every word covers the board.
  function solve(puzzle, free, words, prefixes = {}) {
    if (!words.length) return {};
    let best = null;
    let bestWord = null;
    for (const word of words) {
      const options = tracePaths(word, puzzle.grid, puzzle.adj, free, prefixes[word]);
      if (!options.length) return null;
      if (!best || options.length < best.length) {
        best = options;
        bestWord = word;
      }
    }
    const rest = words.filter((w) => w !== bestWord);
    for (const option of best) {
      option.forEach((c) => (free[c] = 0));
      const placement = solve(puzzle, free, rest, prefixes);
      option.forEach((c) => (free[c] = 1));
      if (placement) {
        placement[bestWord] = option;
        return placement;
      }
    }
    return null;
  }

  window.WendEngine = { DIFFICULTIES, generatePuzzle, solve, isGridAdjacent, wordBank, mixBank };
})();
