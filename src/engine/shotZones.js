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

// ---- Court coordinates ----
//
// A zone says which region a shot came from; drawing it needs a point. These
// are half-court feet with the origin at the centre of the rim: x runs
// -25..25 (negative = the offense's left), y runs 0..47 toward half court.
// Real NBA geometry — 16ft lane, 23.75ft arc, 22ft in the corners.
//
// Derived from the same per-shot hash that chose the zone (never the game
// RNG), so a shot's location is stable: re-rendering a game puts every shot
// back exactly where it was, and a player keeps a consistent shot signature.
const RIM_Y = 5.25;          // rim centre sits 5.25ft from the baseline
const ARC = 23.75;           // 3pt arc radius above the break
const CORNER_X = 22;         // corner 3 is 22ft from the centre of the rim

// Two independent uniforms in [0,1) out of one 32-bit hash. Mixed rather
// than shifted: shotHash's magnitude rides on the player id, so the raw high
// bits aren't reliably populated and plain shifts collapse to a constant.
function uniforms(hash) {
  const a = Math.imul(hash ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const b = Math.imul(hash ^ 0xc2b2ae35, 0x27d4eb2f) >>> 0;
  return [(a >>> 8) / 16777216, (b >>> 8) / 16777216];
}

// Polar placement around the rim, used for the arcs.
function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: +(r * Math.cos(rad)).toFixed(2), y: +(RIM_Y + r * Math.sin(rad)).toFixed(2) };
}

export function zoneCoords(hash, zoneId) {
  const [u, v] = uniforms(hash);
  const sign = u < 0.5 ? -1 : 1;        // left or right of the rim
  const s = (u < 0.5 ? u : u - 0.5) * 2; // re-spread the side bit back to [0,1)
  switch (zoneId) {
    case 'rim':      return polar(0.5 + s * 3.5, 20 + v * 140);
    case 'paint':    return { x: +(sign * (1 + s * 7)).toFixed(2), y: +(RIM_Y + 1 + v * 12).toFixed(2) };
    case 'midBase':  return { x: +(sign * (9 + s * 12)).toFixed(2), y: +(v * 7).toFixed(2) };
    case 'midElbow': return { x: +(sign * (9 + s * 7)).toFixed(2), y: +(12 + v * 6).toFixed(2) };
    case 'midTop':   return { x: +(sign * s * 8).toFixed(2), y: +(16 + v * 5).toFixed(2) };
    case 'corner3':  return { x: +(sign * (CORNER_X + s * 2)).toFixed(2), y: +(v * 13).toFixed(2) };
    case 'wing3':    return polar(ARC + s * 1.5, 20 + v * 25 + (sign < 0 ? 115 : 0));
    case 'top3':     return polar(ARC + s * 2.5, 65 + v * 50);
    default:         return { x: 0, y: RIM_Y };
  }
}
