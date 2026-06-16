import { clamp } from './rng.js';
import { overall } from './players.js';

// Scouting fog — human-player display layer only. AI always uses true OVR.
//
// Two tracks:
//   Draft track  — budget missions on future prospects. 0 pts → "?"; 1–100 pts
//                  → uncertainty ±15 down to ±2. True OVR sits at a seeded
//                  random position anywhere within the displayed range.
//   Pro track    — career-minutes-based baseline, film watching removes up to
//                  50% of that baseline. Rookies with no prior draft scouting
//                  show "?"; prior draftPoints convert to film days (1 per 5 pts)
//                  giving them a head start.
//
// Minutes breakpoints (pro track):
//   0 min          → "?" (no range)
//   1–500 min      → ±10
//   500–2 000 min  → ±7
//   2 000–5 000    → ±5
//   5 000–10 000   → ±3
//   10 000+        → ±1.5

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Returns a value in [0,1) deterministic for (playerId, season, key).
// Used to place the true OVR randomly within the fog window — it can land
// anywhere from the floor to the ceiling, so the midpoint is not a hint.
export function noise01(playerId, season, salt) {
  let h = (Math.imul(playerId, 374761393) + Math.imul(season, 668265263) + hashStr(salt)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Fog indicator color (used in Ovr badge and elsewhere).
// red = wide, yellow = medium, blue = somewhat tight, green = tight/exact.
export function fogColor(u) {
  return u >= 7 ? 'var(--red)' : u >= 4 ? '#d29922' : u >= 2 ? '#58a6ff' : 'var(--green)';
}

// A draft prospect is someone not yet in the NBA — no contract, no exp.
// Once a player signs (drafted or undrafted FA) they switch to the pro track.
export function isDraftProspect(p) {
  if (p.contract != null || (p.exp ?? 0) > 0) return false;
  return 'draftPoints' in (p.scout ?? {}) || p.draftYear == null;
}

// Total publicly observable minutes: completed seasons + current season in progress.
// Box scores are public, so this collapses OVR fog mid-season without any extra tracking.
function totalCareerMinutes(p) {
  const historical = (p.careerStats ?? []).reduce((s, row) => s + (row.min ?? 0), 0);
  return historical + (p.stats?.min ?? 0);
}

function proBaseUncertainty(careerMin) {
  if (careerMin === 0)     return Infinity; // "?" — no minutes yet
  if (careerMin < 500)     return 10;
  if (careerMin < 2_000)   return 7;
  if (careerMin < 5_000)   return 5;
  if (careerMin < 10_000)  return 3;
  return 1.5;
}

// Returns true when the player should show "?" instead of a range.
export function isHidden(p, proGames = 0) {
  if (isDraftProspect(p)) {
    const pts = p.scout?.draftPoints ?? (p.scout?.watched ?? 0) * 33;
    return pts === 0;
  }
  if (totalCareerMinutes(p) > 0) return false;
  // Rookie with no prior draft scouting and no film yet
  const priorPts = p.scout?.priorDraftPoints ?? 0;
  const totalFilm = proGames + priorPts / 5;
  return totalFilm === 0;
}

// Uncertainty (half-width of the fog window). Callers should check isHidden
// first; this returns 0 for fully-known players.
export function scoutUncertainty(p, proGames = 0) {
  if (isDraftProspect(p)) {
    const legacyPts = (p.scout?.watched ?? 0) * 33;
    const pts = p.scout?.draftPoints ?? legacyPts;
    const u = 15 - (Math.min(pts, 100) / 100) * 13;
    return Math.round(clamp(u, 2, 16));
  }
  // Pro track
  const base = proBaseUncertainty(totalCareerMinutes(p));
  const effectiveBase = base === Infinity ? 10 : base;
  const priorPts = p.scout?.priorDraftPoints ?? 0;
  const totalFilm = proGames + priorPts / 5;
  const filmReduction = Math.min(totalFilm / 20, 1) * 0.5;
  return Math.round(clamp(effectiveBase * (1 - filmReduction), 0, 10));
}

// Builds the displayed [lo, hi] range. The true value can sit anywhere within
// it — the seeded noise decides where, so it's stable within a season but
// genuinely unpredictable to the user.
export function scoutRange(p, trueValue, season, key, proGames = 0) {
  const width = 2 * scoutUncertainty(p, proGames);
  const below = Math.round(noise01(p.id, season, key) * width);
  return [
    Math.max(25, trueValue - below),
    Math.min(99, trueValue - below + width),
  ];
}

export function scoutedOverallRange(p, season, proGames = 0) {
  return scoutRange(p, overall(p), season, 'ovr', proGames);
}

// Midpoint of the displayed range — used for sort order. The midpoint itself
// has noise proportional to uncertainty, so sort order is genuinely unreliable
// at wide fog and becomes accurate as fog narrows.
export function scoutedOverall(p, season, proGames = 0) {
  const [lo, hi] = scoutedOverallRange(p, season, proGames);
  return (lo + hi) / 2;
}

const GRADES = [[92, 'A+'], [86, 'A'], [80, 'B+'], [74, 'B'], [68, 'C+'], [60, 'C'], [-Infinity, 'D']];

export function scoutedPotential(p, season, fogged, proGames = 0) {
  let v = p.potential;
  if (fogged) v += Math.round((noise01(p.id, season, 'pot') - 0.5) * scoutUncertainty(p, proGames) * 1.5);
  return clamp(v, 25, 99);
}

export function potentialGrade(v) {
  return GRADES.find(([min]) => v >= min)[1];
}
