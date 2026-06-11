import { overall } from './players.js';

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

// There's no injury system yet; lineups already refuse injured players so
// one can hang an `injury` field on players without touching this code.
export function isInjured(p) {
  return !!p.injury;
}

const STARTER_WEIGHTS = [36, 34, 32, 30, 28];
const BENCH_WEIGHTS = [26, 22, 18, 14, 10];

// Best lineup for a roster: starters greedily assigned to the slot where
// they're worth the most (fit-adjusted), bench ordered by overall, minutes
// scaled to exactly TOTAL_MINUTES.
export function autoLineup(roster) {
  const pool = roster.filter((p) => !isInjured(p));
  const starters = Object.fromEntries(POSITIONS.map((pos) => [pos, { id: null, min: 0 }]));
  const used = new Set();
  for (let k = 0; k < POSITIONS.length; k++) {
    let best = null;
    for (const pos of POSITIONS) {
      if (starters[pos].id != null) continue;
      for (const p of pool) {
        if (used.has(p.id)) continue;
        const v = overall(p) * posFit(p.pos, pos);
        if (!best || v > best.v) best = { pos, p, v };
      }
    }
    if (!best) break;
    starters[best.pos].id = best.p.id;
    used.add(best.p.id);
  }

  const starterEntries = POSITIONS
    .filter((pos) => starters[pos].id != null)
    .map((pos) => ({ pos, p: pool.find((x) => x.id === starters[pos].id) }))
    .sort((a, b) => overall(b.p) - overall(a.p))
    .map((e, i) => ({ ...e, w: STARTER_WEIGHTS[i] }));
  const benchEntries = pool
    .filter((p) => !used.has(p.id))
    .sort((a, b) => overall(b) - overall(a))
    .map((p, i) => ({ p, w: BENCH_WEIGHTS[i] ?? 0 }));

  // Scale weights so minutes land on exactly TOTAL_MINUTES
  const weighted = [...starterEntries, ...benchEntries].filter((e) => e.w > 0);
  const wSum = weighted.reduce((s, e) => s + e.w, 0);
  let total = 0;
  for (const e of weighted) {
    e.min = Math.min(48, Math.round((e.w / wSum) * TOTAL_MINUTES));
    total += e.min;
  }
  let drift = TOTAL_MINUTES - total;
  for (let i = 0; drift !== 0 && i < 1000; i++) {
    const e = weighted[i % weighted.length];
    if (drift > 0 && e.min < 48) { e.min++; drift--; }
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
    if (isInjured(p)) errs.push(`${p.name} is injured and can't start at ${pos}.`);
    if (!(s.min >= 1 && s.min <= 48)) errs.push(`${p.name} must play 1–48 minutes as a starter.`);
    total += s.min;
  }
  for (const b of lineup.bench ?? []) {
    const p = byId.get(b.id);
    if (!p) continue; // departed player; contributes nothing
    counts.set(p.id, (counts.get(p.id) || 0) + 1);
    if (!(b.min >= 0 && b.min <= 48)) errs.push(`${p.name} must play 0–48 minutes.`);
    if (b.min > 0 && isInjured(p)) errs.push(`${p.name} is injured and can't be in the rotation.`);
    total += b.min;
  }
  for (const [id, n] of counts) {
    if (n > 1) errs.push(`${byId.get(id).name} appears in the lineup twice.`);
  }
  if (total !== TOTAL_MINUTES) errs.push(`Minutes total ${total} — they must total exactly ${TOTAL_MINUTES}.`);
  return errs;
}
