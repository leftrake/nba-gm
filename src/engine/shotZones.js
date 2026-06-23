// Real shot-chart zones — subdividing the 3 shot types (inside/mid/three)
// the sim already picks via wIns/wMid/wThree into the actual court
// locations a shot chart shows. `fgAdj` is a make% offset layered on top
// of sim.js's existing, already-tuned type-level formulas; each type's
// zones are weighted (shareOfType) so the average `fgAdj` across them is
// ~0 — these spread realistic variance around the type's mean rather than
// moving the mean itself, so adding zones doesn't reopen the type-level
// shooting calibration.
export const ZONES = [
  { id: 'rim',      type: 'ins',   shareOfType: 0.78, fgAdj:  0.030, label: 'Restricted Area' },
  { id: 'paint',    type: 'ins',   shareOfType: 0.22, fgAdj: -0.1064, label: 'Paint' },
  { id: 'midBase',  type: 'mid',   shareOfType: 0.35, fgAdj:  0.010, label: 'Baseline Mid-Range' },
  { id: 'midElbow', type: 'mid',   shareOfType: 0.30, fgAdj:  0.000, label: 'Elbow' },
  { id: 'midTop',   type: 'mid',   shareOfType: 0.35, fgAdj: -0.012, label: 'Free-Throw Line' },
  { id: 'corner3',  type: 'three', shareOfType: 0.23, fgAdj:  0.018, label: 'Corner Three' },
  { id: 'wing3',    type: 'three', shareOfType: 0.37, fgAdj:  0.000, label: 'Wing Three' },
  { id: 'top3',     type: 'three', shareOfType: 0.40, fgAdj: -0.014, label: 'Above the Break' },
];

export const ZONE_IDS = ZONES.map((z) => z.id);

// Flat Fgm/Fga column names for every zone, in ZONES order — used to extend
// emptyStats()/BOX_COLS so a shot's location rolls up the same way every
// other counting stat does (flat scalars, no nested objects).
export const ZONE_STAT_COLS = ZONES.flatMap((z) => [`${z.id}Fgm`, `${z.id}Fga`]);

// Deterministic per-shot nonce — same pattern sim.js's shotDesc() already
// uses for flavor-text variety: a hash of (playerId, attempt count), never
// the seeded game RNG, so picking a zone can't perturb existing seeded-sim
// results (scores, box lines) and gives each player a stable, personal
// shot-location signature instead of a uniform reroll every shot.
export function shotHash(playerId, fga) {
  return (((playerId * 48271) ^ (fga * 16807)) >>> 0);
}

// Picks a zone for the given shot type, weighted by shareOfType.
export function pickZone(hash, type) {
  const candidates = ZONES.filter((z) => z.type === type);
  let roll = (hash % 10000) / 10000;
  for (const z of candidates) {
    if (roll < z.shareOfType) return z;
    roll -= z.shareOfType;
  }
  return candidates[candidates.length - 1];
}

export function zoneById(id) {
  return ZONES.find((z) => z.id === id);
}
