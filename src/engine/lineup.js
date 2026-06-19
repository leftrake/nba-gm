import { overall, supportedMinutes } from './players.js';
import { clamp } from './rng.js';

// Lineups: each team can carry `team.lineup`, shaped
//   { starters: { PG: { id, min }, SG: ..., SF: ..., PF: ..., C: ... },
//     bench: [{ id, min }, ...] }   // rotation order, 0 min = out of rotation
// Plain objects + player ids only, so it survives JSON save/load. The user's
// team stores one and edits it on the Roster screen; AI teams get a fresh
// autoLineup() every game (so trades and development self-correct).

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const POS_INDEX = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };

export const TOTAL_MINUTES = 240; // 5 spots x 48 minutes

// Out-of-position value multiplier by distance from natural position:
// full value at the natural spot, a small penalty one spot over
// (SG at SF), steepening to a big one across the floor (PG at C).
const FIT = [1, 0.95, 0.85, 0.72, 0.6];
export function posFit(naturalPos, slotPos) {
  return FIT[Math.abs(POS_INDEX[naturalPos] - POS_INDEX[slotPos])];
}

// A player's fit at a slot, accounting for his secondary position: pos2 is
// treated as a second natural position (full value at that slot), not just
// an adjacent one, so the better of the two fits wins.
export function playerFit(p, slotPos) {
  let fit = posFit(p.pos, slotPos);
  if (p.pos2) fit = Math.max(fit, posFit(p.pos2, slotPos));
  return fit;
}

export function isInjured(p) {
  return !!p.injury;
}

const STARTER_WEIGHTS = [40, 35, 33, 31, 29];
const BENCH_WEIGHTS = [25, 21, 17, 13, 9];

// Minutes ceiling a sensible rotation respects: a couple past what stamina
// supports is tolerable; beyond that the sim punishes it badly.
export function minutesCap(p) {
  return Math.round(clamp(supportedMinutes(p) + 3, 12, 48));
}

// Optimal assignment of pool players to the 5 starter slots, maximizing
// total fit-adjusted value (overall * playerFit), via bitmask DP over which
// slots are filled. A simple greedy "assign the single best remaining pair"
// can lock in a pairing that forecloses a better global arrangement — e.g.
// a wing parked at center because a near-tied specialist grabbed the wing's
// better-fit slot one step earlier, when swapping both would've scored
// higher overall. With only 5 slots (32 masks) exact DP is cheap enough to
// run every game for every AI team.
function bestStarterAssignment(pool) {
  const nSlots = POSITIONS.length;
  const fullMask = (1 << nSlots) - 1;
  let dp = new Array(fullMask + 1).fill(null);
  dp[0] = { value: 0, assign: new Array(nSlots).fill(null) };
  for (const p of pool) {
    const next = dp.slice();
    for (let mask = 0; mask <= fullMask; mask++) {
      const cur = dp[mask];
      if (!cur) continue;
      for (let s = 0; s < nSlots; s++) {
        if (mask & (1 << s)) continue;
        const v = cur.value + overall(p) * playerFit(p, POSITIONS[s]);
        const newMask = mask | (1 << s);
        if (!next[newMask] || v > next[newMask].value) {
          const assign = cur.assign.slice();
          assign[s] = p;
          next[newMask] = { value: v, assign };
        }
      }
    }
    dp = next;
  }
  // Pick the most-filled reachable mask (ties broken by value); a roster
  // with fewer than 5 healthy players can't reach fullMask.
  let bestMask = 0;
  for (let mask = 1; mask <= fullMask; mask++) {
    if (!dp[mask]) continue;
    const bits = bitCount(mask);
    const bestBits = bitCount(bestMask);
    if (bits > bestBits || (bits === bestBits && dp[mask].value > (dp[bestMask]?.value ?? -Infinity))) {
      bestMask = mask;
    }
  }
  return dp[bestMask].assign;
}

function bitCount(mask) {
  let c = 0;
  for (let m = mask; m; m >>= 1) c += m & 1;
  return c;
}

// Best lineup for a roster: starters optimally assigned across slots
// (fit-adjusted), bench ordered by overall, minutes scaled to exactly
// TOTAL_MINUTES.
export function autoLineup(roster) {
  const pool = roster.filter((p) => !isInjured(p));
  const starters = Object.fromEntries(POSITIONS.map((pos) => [pos, { id: null, min: 0 }]));
  const used = new Set();
  const assign = bestStarterAssignment(pool);
  POSITIONS.forEach((pos, s) => {
    const p = assign[s];
    if (p) { starters[pos].id = p.id; used.add(p.id); }
  });

  const starterEntries = POSITIONS
    .filter((pos) => starters[pos].id != null)
    .map((pos) => ({ pos, p: pool.find((x) => x.id === starters[pos].id) }))
    .sort((a, b) => overall(b.p) - overall(a.p))
    .map((e, i) => ({ ...e, w: STARTER_WEIGHTS[i] }));
  const benchEntries = pool
    .filter((p) => !used.has(p.id))
    .sort((a, b) => overall(b) - overall(a))
    .map((p, i) => ({ p, w: BENCH_WEIGHTS[i] ?? 0 }));

  // Scale weights so minutes land on exactly TOTAL_MINUTES, while keeping
  // everyone at or under his stamina cap. Worn-down players (low condition)
  // also get their share trimmed, so AI rotations rest tired legs — this
  // runs fresh every game for AI teams.
  const weighted = [...starterEntries, ...benchEntries].filter((e) => e.w > 0);
  for (const e of weighted) {
    e.cap = minutesCap(e.p);
    e.w *= 0.6 + 0.4 * ((e.p.condition ?? 100) / 100);
  }
  const wSum = weighted.reduce((s, e) => s + e.w, 0);
  let total = 0;
  for (const e of weighted) {
    e.min = Math.min(e.cap, Math.round((e.w / wSum) * TOTAL_MINUTES));
    total += e.min;
  }
  let drift = TOTAL_MINUTES - total;
  for (let i = 0; drift !== 0 && i < 1000; i++) {
    const e = weighted[i % weighted.length];
    // respect stamina caps while any headroom is left; a short or exhausted
    // roster may have no choice but to blow past them
    const cap = i < weighted.length * 20 ? e.cap : 48;
    if (drift > 0 && e.min < cap) { e.min++; drift--; }
    else if (drift < 0 && e.min > 1) { e.min--; drift++; }
  }

  for (const e of starterEntries) starters[e.pos].min = e.min ?? 0;
  const bench = benchEntries.map((e) => ({ id: e.p.id, min: e.min ?? 0 }));
  // injured players still show up in the bench list, just unplayable
  for (const p of roster) if (isInjured(p)) bench.push({ id: p.id, min: 0 });
  return { starters, bench };
}

// Reconcile a stored lineup with the current roster: blank starter slots
// whose player left (trade/waive), drop departed bench entries, and append
// new arrivals to the end of the bench at 0 minutes. Pure — returns a copy.
export function normalizeLineup(lineup, roster) {
  const ids = new Set(roster.map((p) => p.id));
  const seen = new Set();
  const starters = {};
  for (const pos of POSITIONS) {
    const s = lineup?.starters?.[pos];
    const ok = s && s.id != null && ids.has(s.id) && !seen.has(s.id);
    starters[pos] = { id: ok ? s.id : null, min: s?.min ?? 0 };
    if (ok) seen.add(s.id);
  }
  const bench = [];
  for (const b of lineup?.bench ?? []) {
    if (b.id != null && ids.has(b.id) && !seen.has(b.id)) {
      bench.push({ id: b.id, min: b.min ?? 0 });
      seen.add(b.id);
    }
  }
  for (const p of roster) if (!seen.has(p.id)) bench.push({ id: p.id, min: 0 });
  return { starters, bench };
}

// Everything wrong with a lineup, as user-facing strings. Empty array =
// legal to play. The sim falls back to autoLineup when this is non-empty.
// Injuries are deliberately NOT errors: an injured player in the lineup
// still validates (his minutes count toward the 240), the game just sits
// him and redistributes (see getRotation in sim.js) — lineupWarnings is
// what tells the user about it.
export function lineupErrors(lineup, roster) {
  if (!lineup) return ['No lineup set.'];
  const errs = [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const counts = new Map();
  let total = 0;

  for (const pos of POSITIONS) {
    const s = lineup.starters?.[pos];
    const p = s?.id != null ? byId.get(s.id) : null;
    if (!p) { errs.push(`The ${pos} slot is empty.`); continue; }
    counts.set(p.id, (counts.get(p.id) || 0) + 1);
    if (!(s.min >= 1 && s.min <= 48)) errs.push(`${p.name} must play 1–48 minutes as a starter.`);
    total += s.min;
  }
  for (const b of lineup.bench ?? []) {
    const p = byId.get(b.id);
    if (!p) continue; // departed player; contributes nothing
    counts.set(p.id, (counts.get(p.id) || 0) + 1);
    if (!(b.min >= 0 && b.min <= 48)) errs.push(`${p.name} must play 0–48 minutes.`);
    total += b.min;
  }
  for (const [id, n] of counts) {
    if (n > 1) errs.push(`${byId.get(id).name} appears in the lineup twice.`);
  }
  if (total !== TOTAL_MINUTES) errs.push(`Minutes total ${total} — they must total exactly ${TOTAL_MINUTES}.`);
  return errs;
}

// Soft problems with a legal lineup, as user-facing strings: the game will
// play it, but the fatigue sim will punish it. Distinct from lineupErrors —
// these never force a fallback to autoLineup.
export function lineupWarnings(lineup, roster) {
  if (!lineup) return [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const warns = [];
  const entries = [
    ...POSITIONS.map((pos) => lineup.starters?.[pos]),
    ...(lineup.bench ?? []),
  ];
  for (const e of entries) {
    const p = e?.id != null ? byId.get(e.id) : null;
    if (!p || !(e.min > 0)) continue;
    if (isInjured(p)) {
      const left = p.injury.tier === 'season' ? 'out for the season' : `${p.injury.daysLeft} day${p.injury.daysLeft === 1 ? '' : 's'} left`;
      warns.push(`${p.name} is injured (${p.injury.type}, ${left}) — his minutes will be covered by healthy players until he returns.`);
      continue; // no point also nagging about his stamina
    }
    const sup = Math.round(supportedMinutes(p));
    if (e.min > sup + 2) {
      warns.push(`${p.name} is set for ${e.min} min, but his stamina (${p.stamina ?? '?'}) supports ~${sup} — expect his efficiency to fade late in games.`);
    }
    if ((p.condition ?? 100) < 60) {
      warns.push(`${p.name} is worn down (${Math.round(p.condition)}% condition) — trim his minutes until he recovers.`);
    }
  }
  return warns;
}
