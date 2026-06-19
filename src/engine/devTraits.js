import { isDraftProspect, scoutUncertainty, noise01, getDraftPoints } from './scouting.js';

// ---- Trait tier definitions ----
// Bucketed from projected peak OVR (potential). Thresholds are tunable here.

export const TRAIT_TIERS = [
  { name: 'Generational', short: 'Gen',  min: 93, max: 99 },
  { name: 'Superstar',    short: 'SS',   min: 88, max: 92 },
  { name: 'Star',         short: 'Star', min: 82, max: 87 },
  { name: 'Starter',      short: 'Str',  min: 75, max: 81 },
  { name: 'Normal',       short: 'Norm', min: 0,  max: 74 },
];

export const TRAIT_COLORS = {
  Generational: '#d29922',    // gold
  Superstar:    '#d2a8ff',    // purple
  Star:         '#58a6ff',    // blue
  Starter:      'var(--green)',
  Normal:       'var(--muted)',
};

// ---- Uncertainty constants ----

// Pre-draft potential is harder to assess than current ability — wider fog.
export const PROSPECT_UNCERTAINTY_MULT = 1.3;

// If potentialUncertainty >= this, the band is too wide to be meaningful — show "?".
export const POT_HIDDEN_THRESHOLD = 10;

// Minimum minutes in a season for it to count as a qualifying season.
export const QUALITY_SEASON_MIN_MINUTES = 1000;

// Seasons-based uncertainty floors (seasons with 1000+ minutes).
// The tighter of scouting-driven and this floor is used.
export const SEASONS_UNCERTAINTY_FLOORS = [
  { minSeasons: 3, uncertainty: 1 },
  { minSeasons: 2, uncertainty: 3 },
  { minSeasons: 1, uncertainty: 6 },
  { minSeasons: 0, uncertainty: Infinity },
];

// Tiers that trigger a public news reveal when confirmed.
export const TRAIT_NEWS_REVEAL_TIERS = new Set(['Star', 'Superstar', 'Generational']);

// ---- Core functions ----

export function traitFromPotential(pot) {
  return TRAIT_TIERS.find((t) => pot >= t.min).name;
}

export function traitShort(name) {
  return TRAIT_TIERS.find((t) => t.name === name)?.short ?? name;
}

export function seasonsUncertainty(qualSeasons) {
  return SEASONS_UNCERTAINTY_FLOORS.find((f) => qualSeasons >= f.minSeasons).uncertainty;
}

// Potential uncertainty (half-width of the trait fog window).
// Draft prospects use (OVR formula) × PROSPECT_UNCERTAINTY_MULT.
// Pro players take the tighter of scouting-driven (minutes/film) and seasons-based floor.
// teamId is the viewing team — only matters for the draft-prospect branch.
export function potentialUncertainty(p, teamId, proGames = 0) {
  if (isDraftProspect(p)) {
    const pts = getDraftPoints(p, teamId);
    if (pts === 0) return Infinity;
    return (15 - (pts / 100) * 13) * PROSPECT_UNCERTAINTY_MULT;
  }
  const scoutU = scoutUncertainty(p, teamId, proGames);
  const sU = seasonsUncertainty(p.qualitySeasons ?? 0);
  return Math.min(scoutU, sU);
}

// Returns the trait band visible to the human GM, or null for "?".
// fogged=false (own players) → always returns the single true trait.
// fogged=true → derives band from potentialUncertainty + seeded noise.
// True trait can land anywhere in the band (same honesty rule as OVR range).
export function traitBand(p, season, teamId, proGames = 0, fogged = true) {
  if (!fogged) {
    const name = traitFromPotential(p.potential);
    return { lo: name, hi: name };
  }
  const u = potentialUncertainty(p, teamId, proGames);
  if (!isFinite(u) || u >= POT_HIDDEN_THRESHOLD) return null;
  const width = 2 * u;
  const below = Math.round(noise01(p.id, season, 'trait') * width);
  const loVal = Math.max(0, p.potential - below);
  const hiVal = Math.min(99, loVal + width);
  // All trait tiers whose range overlaps [loVal, hiVal]; TRAIT_TIERS is sorted high→low.
  const overlapping = TRAIT_TIERS.filter((t) => t.min <= hiVal && t.max >= loVal);
  return {
    lo: overlapping[overlapping.length - 1].name,  // lowest tier in window
    hi: overlapping[0].name,                        // highest tier in window
  };
}

// Numeric sort key for the potential column — the midpoint of the same window
// traitBand() displays, using the same seeded noise. Returns -Infinity for "?".
// Own players (fogged=false) sort by true potential directly.
export function traitSortValue(p, season, teamId, proGames = 0, fogged = true) {
  if (!fogged) return p.potential;
  const u = potentialUncertainty(p, teamId, proGames);
  if (!isFinite(u) || u >= POT_HIDDEN_THRESHOLD) return -Infinity;
  const width = 2 * u;
  const below = Math.round(noise01(p.id, season, 'trait') * width);
  const loVal = Math.max(0, p.potential - below);
  const hiVal = Math.min(99, loVal + width);
  return (loVal + hiVal) / 2;
}

// Recomputes qualifying seasons from careerStats (summing multi-stint seasons).
// Call at offseason to sync the counter; also used for backfilling old saves.
export function computeQualitySeasons(p) {
  const minsBySeason = {};
  for (const row of (p.careerStats ?? [])) {
    minsBySeason[row.season] = (minsBySeason[row.season] ?? 0) + (row.min ?? 0);
  }
  return Object.values(minsBySeason).filter((m) => m >= QUALITY_SEASON_MIN_MINUTES).length;
}
