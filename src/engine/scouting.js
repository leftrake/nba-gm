import { clamp } from './rng.js';
import { overall } from './players.js';

// Scouting fog. The engine always stores true ratings and potential; these
// helpers derive the fuzzy view the UI shows for players the GM can't see
// exactly (other teams, free agents). Everything is deterministic per
// (player, season, stat), so reports are stable across screens and renders
// but refresh — and tighten — each season as a player ages.

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function noise01(playerId, season, salt) {
  let h = (Math.imul(playerId, 374761393) + Math.imul(season, 668265263) + hashStr(salt)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Rookies are the biggest unknowns, veterans are a settled book. Falls back
// to age (entry around 19) for players from saves predating the exp field.
export function scoutUncertainty(p) {
  const exp = p.exp ?? Math.max(0, p.age - 19);
  return Math.round(clamp(6 - exp * 0.7, 1, 6));
}

// The true value always falls inside the range, but at a deterministic
// uniformly-random position within it — it can sit anywhere from one edge
// to the other, so the midpoint says nothing more than the range itself.
export function scoutRange(p, trueValue, season, key) {
  const width = 2 * scoutUncertainty(p);
  const below = Math.round(noise01(p.id, season, key) * width);
  return [
    Math.max(25, trueValue - below),
    Math.min(99, trueValue - below + width),
  ];
}

export function scoutedOverallRange(p, season) {
  return scoutRange(p, overall(p), season, 'ovr');
}

// Midpoint of the scouted range — fogged lists sort by this so that sort
// order doesn't leak true overalls.
export function scoutedOverall(p, season) {
  const [lo, hi] = scoutedOverallRange(p, season);
  return (lo + hi) / 2;
}

const GRADES = [[92, 'A+'], [86, 'A'], [80, 'B+'], [74, 'B'], [68, 'C+'], [60, 'C'], [-Infinity, 'D']];

// Potential as the scout sees it: the true number for own players, a fuzzed
// one for everyone else, with the fuzz shrinking as uncertainty does. The UI
// only ever turns this into a letter grade.
export function scoutedPotential(p, season, fogged) {
  let v = p.potential;
  if (fogged) v += Math.round((noise01(p.id, season, 'pot') - 0.5) * scoutUncertainty(p) * 1.5);
  return clamp(v, 25, 99);
}

export function potentialGrade(v) {
  return GRADES.find(([min]) => v >= min)[1];
}
