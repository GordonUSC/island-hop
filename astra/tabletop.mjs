// Local rules prototype only. No engine, persistence, clock, DOM or network effects.
export const RULES = Object.freeze({
  version: 'tabletop-press-v1', rerolls: 2,
  points: Object.freeze({none: 0, pair: 120, straight: 240, triple: 480})
});
function validDice(dice) {
  if (!Array.isArray(dice) || dice.length !== 3 ||
      dice.some(d => !Number.isInteger(d) || d < 1 || d > 6)) {
    throw new RangeError('Expected three dice with faces 1 through 6');
  }
}
export function evaluateDice(dice) {
  validDice(dice);
  const a = [...dice].sort((x, y) => x - y);
  const kind = a[0] === a[2] ? 'triple'
    : a[0] === a[1] || a[1] === a[2] ? 'pair'
    : a[1] === a[0] + 1 && a[2] === a[1] + 1 ? 'straight' : 'none';
  return {kind, points: RULES.points[kind]};
}
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function face(seed, round, roll, index) {
  // Counter addressing keeps held dice and cosmetic RNG from shifting other slots.
  // Rejection avoids mapping the final four uint32 values into extra 1..4 faces.
  for (let nonce = 0; ; nonce++) {
    const n = hash(JSON.stringify(['tabletop-press-v1', seed, round, roll, index, nonce]));
    if (n < 4294967292) return n % 6 + 1;
  }
}
export function createTable({seed, round = 0, runId}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isSafeInteger(round) || round < 0 ||
      typeof runId !== 'string' || !runId) throw new TypeError('Invalid seed, round or runId');
  return {version: RULES.version, seed, round, runId, revision: 0,
    phase: 'choosing', paused: false, roll: 0, rerolls: RULES.rerolls,
    dice: [0,1,2].map(i => face(seed, round, 0, i)), threshold: 0, banked: null};
}
export function bankPreview(state) {
  const result = evaluateDice(state.dice);
  const payout = result.points > state.threshold ? result.points : 0;
  return {...result, payout, requiredAbove: state.threshold,
    canPress: state.phase === 'choosing' && !state.paused &&
      state.rerolls > 0 && payout > 0 && result.kind !== 'triple'};
}
function validHold(held) {
  return Array.isArray(held) && held.length === 3 &&
    held.every(h => typeof h === 'boolean') && held.some(h => !h);
}
function rollAllowed(state, type, held) {
  if (state.phase !== 'choosing' || state.paused || state.rerolls < 1 ||
      !validHold(held)) return false;
  const p = bankPreview(state);
  return type === 'PRESS' ? p.canPress : type === 'ROLL' && p.payout === 0;
}
export function reduceTable(state, action) {
  if (!action || action.runId !== state.runId || action.revision !== state.revision ||
      state.phase !== 'choosing') return state;
  if (action.type === 'CANCEL') {
    return {...state, revision: state.revision + 1, phase: 'cancelled'};
  }
  if (action.type === 'PAUSE' || action.type === 'RESUME') {
    const paused = action.type === 'PAUSE';
    return paused === state.paused ? state : {...state, paused, revision: state.revision + 1};
  }
  if (state.paused) return state;
  if (action.type === 'BANK') {
    return {...state, revision: state.revision + 1, phase: 'banked',
      banked: bankPreview(state).payout};
  }
  if (!rollAllowed(state, action.type, action.held)) return state;
  const roll = state.roll + 1;
  const threshold = action.type === 'PRESS'
    ? Math.max(state.threshold, evaluateDice(state.dice).points) : state.threshold;
  return {...state, revision: state.revision + 1, roll, threshold,
    rerolls: state.rerolls - 1,
    dice: state.dice.map((d,i) => action.held[i] ? d : face(state.seed, state.round, roll, i))};
}
export function previewReroll(state, {type, held}) {
  if (!rollAllowed(state, type, held)) return null;
  const before = bankPreview(state);
  const threshold = type === 'PRESS' ? Math.max(state.threshold, before.points) : state.threshold;
  const counts = {};
  let total = 0, numerator = 0;
  function visit(dice, index) {
    if (index === 3) {
      const points = evaluateDice(dice).points;
      const payout = points > threshold ? points : 0;
      counts[payout] = (counts[payout] || 0) + 1;
      numerator += payout; total++; return;
    }
    if (held[index]) visit([...dice, state.dice[index]], index + 1);
    else for (let d = 1; d <= 6; d++) visit([...dice, d], index + 1);
  }
  visit([], 0);
  // Distribution over independent fair d6 outcomes, NOT a reveal of the seeded roll.
  return {bankAtRisk: before.payout, requiredAbove: threshold, outcomes: counts, total,
    expectedPayout: {numerator, denominator: total}, scope: 'next-roll-then-bank'};
}
