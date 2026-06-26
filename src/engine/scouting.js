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
//
// Difficulty setting (league.settings.difficulty.scoutingFog):
//   'off'    — fog disabled; all true ratings visible, nothing hidden
//   'normal' — default behavior above
//   'heavy'  — uncertainty multiplied by 1.5; wider fog windows

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

// p.scout.draftPoints is keyed per scouting team ({ [teamId]: pts }) so one
// team's missions never reveal a prospect to another team's view. Saves from
// before this was per-team may still have a bare number — read as-is so old
// progress isn't wiped, even though it was (bugged) shared across all teams.
export function getDraftPoints(p, teamId) {
  const dp = p.scout?.draftPoints;
  if (typeof dp === 'number') return dp;
  if (dp == null) return (p.scout?.watched ?? 0) * 33;
  return dp[teamId] ?? 0;
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
// teamId is the viewing team — for a draft prospect, only that team's own
// scouting missions count toward revealing them.
// Pass league.settings as `settings` from UI callers to respect the fog toggle.
export function isHidden(p, teamId, proGames = 0, settings) {
  if (settings?.difficulty?.scoutingFog === 'off') return false;
  if (isDraftProspect(p)) {
    return getDraftPoints(p, teamId) === 0;
  }
  if (totalCareerMinutes(p) > 0) return false;
  // Rookie with no prior draft scouting and no film yet
  const priorPts = p.scout?.priorDraftPoints ?? 0;
  const totalFilm = proGames + priorPts / 5;
  return totalFilm === 0;
}

// Uncertainty (half-width of the fog window). Callers should check isHidden
// first; this returns 0 for fully-known players. teamId is the viewing team.
// Pass league.settings as `settings` from UI callers to respect the fog setting.
export function scoutUncertainty(p, teamId, proGames = 0, settings) {
  if (settings?.difficulty?.scoutingFog === 'off') return 0;
  const fogMult = settings?.difficulty?.scoutingFog === 'heavy' ? 1.5 : 1;
  if (isDraftProspect(p)) {
    const pts = getDraftPoints(p, teamId);
    const u = 15 - (Math.min(pts, 100) / 100) * 13;
    return Math.round(clamp(u * fogMult, 2, 20));
  }
  // Pro track
  const base = proBaseUncertainty(totalCareerMinutes(p));
  const effectiveBase = base === Infinity ? 10 : base;
  const priorPts = p.scout?.priorDraftPoints ?? 0;
  const totalFilm = proGames + priorPts / 5;
  const filmReduction = Math.min(totalFilm / 20, 1) * 0.5;
  return Math.round(clamp(effectiveBase * (1 - filmReduction) * fogMult, 0, 15));
}

// Builds the displayed [lo, hi] range. The true value can sit anywhere within
// it — the seeded noise decides where, so it's stable within a season but
// genuinely unpredictable to the user.
export function scoutRange(p, trueValue, season, key, teamId, proGames = 0, settings) {
  const width = 2 * scoutUncertainty(p, teamId, proGames, settings);
  const below = Math.round(noise01(p.id, season, key) * width);
  return [
    Math.max(25, trueValue - below),
    Math.min(99, trueValue - below + width),
  ];
}

export function scoutedOverallRange(p, season, teamId, proGames = 0, settings) {
  return scoutRange(p, overall(p), season, 'ovr', teamId, proGames, settings);
}

// Midpoint of the displayed range — used for sort order. The midpoint itself
// has noise proportional to uncertainty, so sort order is genuinely unreliable
// at wide fog and becomes accurate as fog narrows.
export function scoutedOverall(p, season, teamId, proGames = 0, settings) {
  const [lo, hi] = scoutedOverallRange(p, season, teamId, proGames, settings);
  return (lo + hi) / 2;
}

const GRADES = [[92, 'A+'], [86, 'A'], [80, 'B+'], [74, 'B'], [68, 'C+'], [60, 'C'], [-Infinity, 'D']];

export function scoutedPotential(p, season, fogged, teamId, proGames = 0, settings) {
  let v = p.potential;
  if (fogged) v += Math.round((noise01(p.id, season, 'pot') - 0.5) * scoutUncertainty(p, teamId, proGames, settings) * 1.5);
  return clamp(v, 25, 99);
}

export function potentialGrade(v) {
  return GRADES.find(([min]) => v >= min)[1];
}
