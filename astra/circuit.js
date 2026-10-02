/** Optional shared-world score attack. The host owns geometry, input and rendering. */
const VALUES = Object.freeze({ star: 100, ring: 250, landing: 400 });
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;

export function createCircuit({ seed = 20261002, seconds = 90, players = 1 } = {}) {
  return { seed: seed >>> 0, duration: Math.max(10, Math.min(300, finite(seconds, 90))),
    players: players === 2 ? 2 : 1, status: 'ready', turn: 0, generation: 0,
    elapsed: 0, score: 0, combo: 0, maxCombo: 0, lastAt: -Infinity,
    targets: new Set(), results: [] };
}

/** Returns a token; every callback must supply it so old runs cannot score. */
export function beginTurn(c) {
  if (!['ready', 'between'].includes(c.status) || c.results.length >= c.players) return null;
  c.turn = c.results.length + 1; c.generation++; c.status = 'playing';
  c.elapsed = 0; c.score = 0; c.combo = 0; c.maxCombo = 0;
  c.lastAt = -Infinity; c.targets = new Set();
  return c.generation;
}

const active = (c, token) => c.status === 'playing' && token === c.generation;

/** Pass frame delta, not wall-clock age. Stop ticking whenever any overlay is open. */
export function tickCircuit(c, dt, token) {
  if (!active(c, token)) return null;
  c.elapsed = Math.min(c.duration, c.elapsed + Math.max(0, Math.min(.25, finite(dt, 0))));
  if (c.elapsed - c.lastAt > 6) c.combo = 0;
  if (c.elapsed >= c.duration - 1e-8) return finishTurn(c, token);
  return null;
}

/** Stable target IDs are once per turn, independent of collision frame count. */
export function collectCircuit(c, id, kind, token) {
  if (!active(c, token) || !Object.hasOwn(VALUES, kind) || typeof id !== 'string' || !id || c.targets.has(id)) return null;
  c.targets.add(id);
  c.combo = c.elapsed - c.lastAt <= 6 ? Math.min(5, c.combo + 1) : 1;
  c.lastAt = c.elapsed; c.maxCombo = Math.max(c.maxCombo, c.combo);
  const points = VALUES[kind] * c.combo; c.score += points;
  return { points, combo: c.combo, score: c.score, kind };
}

/** Missing a ring breaks the chain, but keeps points already earned. */
export function breakCircuitCombo(c, token) {
  if (!active(c, token)) return false;
  c.combo = 0; c.lastAt = -Infinity; return true;
}

export function pauseCircuit(c, token) {
  if (!active(c, token)) return false;
  c.status = 'paused'; return true;
}
export function resumeCircuit(c, token) {
  if (c.status !== 'paused' || token !== c.generation) return false;
  c.status = 'playing'; return true;
}

export function finishTurn(c, token) {
  if (token !== c.generation || !['playing', 'paused'].includes(c.status)) return null;
  const result = Object.freeze({ player: c.turn, score: c.score, maxCombo: c.maxCombo,
    targets: c.targets.size, elapsed: Math.min(c.duration, c.elapsed), seed: c.seed });
  c.results.push(result); c.status = c.results.length < c.players ? 'between' : 'complete';
  return result;
}
export function cancelCircuit(c) { c.generation++; c.status = 'cancelled'; }
export function circuitSummary(c) {
  const results = c.results.map(r => ({ ...r }));
  const high = Math.max(0, ...results.map(r => r.score));
  return { status: c.status, player: c.turn, score: c.score, combo: c.combo,
    secondsLeft: Math.max(0, Math.ceil(c.duration - c.elapsed)), seed: c.seed, results,
    winners: c.status === 'complete' ? results.filter(r => r.score === high).map(r => r.player) : [] };
}

/** A host can reset the same course for both local players with this generator. */
export function circuitRandom(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
