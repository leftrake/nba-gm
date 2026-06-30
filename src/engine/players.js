import { rand, randInt, pick, gauss, clamp } from './rng.js';
import { MIN_SALARY, MAX_SALARY } from '../data/teams.js';
import { initMorale } from './morale.js';
import { NATIONALITIES, NATIONALITY_W } from './names.js';
import { assignBackstory, durabilityAdjust, adjustGrowthDelta, adjustRatingDelta } from './backstory.js';
import { ZONE_STAT_COLS } from './shotZones.js';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Realistic positional overlap: the secondary positions a player could
// plausibly slide to, in roughly ascending order of how far they are from
// the primary spot.
const SECONDARY_OPTIONS = {
  PG: ['SG'],
  SG: ['PG', 'SF'],
  SF: ['SG', 'PF'],
  PF: ['SF', 'C'],
  C: ['PF'],
};

// How well a player's rating profile suits playing a given secondary
// position — used both to pick among multiple candidates and to weight the
// odds of having a secondary position at all (a more "versatile" profile is
// more likely to carry one).
function pos2Score(p, pos2) {
  const r = p.ratings;
  switch (pos2) {
    case 'PG': return r.passing;
    case 'SG': return (r.threePoint + r.passing) / 2;
    case 'SF': return (r.threePoint + r.perimeterDefense) / 2;
    case 'PF': return (r.defensiveRebounding + r.closeShot) / 2;
    case 'C': return (r.defensiveRebounding + r.closeShot) / 2;
    default: return 50;
  }
}

const COLLEGES = [
  'Duke', 'Kentucky', 'Kansas', 'North Carolina', 'UCLA', 'Gonzaga', 'Arizona', 'UConn', 'Villanova',
  'Michigan State', 'Texas', 'Arkansas', 'Baylor', 'Houston', 'Purdue', 'Alabama', 'Auburn', 'Tennessee',
  'Indiana', 'Ohio State', 'Memphis', 'USC', 'Oregon', 'Florida', 'Syracuse', 'Michigan', 'Louisville',
  'Virginia', 'Illinois', 'Wake Forest', 'Creighton', 'Marquette', 'Iowa', 'Stanford', 'Georgetown', 'Wisconsin',
];

export function pickCountry(rng) {
  let roll = rng() * NATIONALITY_W;
  return NATIONALITIES.find((c) => (roll -= c.w) < 0) ?? NATIONALITIES[0];
}

// Sets nationality, pre-NBA origin (`from`: college for Americans, home
// country for internationals), and a flavor birthplace city. Also used to
// backfill saves that predate these fields. `country`, if given, is reused
// instead of being re-rolled (so name and origin come from the same pool).
export function assignOrigin(p, rng = rand, country = pickCountry(rng)) {
  p.nationality = country.name;
  p.from = country.name === 'USA' ? pick(COLLEGES, rng) : country.name;
  p.birthplace = pick(country.cities, rng);
}

export function flagFor(nationality) {
  return NATIONALITIES.find((c) => c.name === nationality)?.flag ?? '';
}

// Roughly 60% of players carry a secondary position; the odds tilt up for a
// rating profile that fits one of the candidate spots well (a more
// "versatile" player) and down for one that doesn't. Returns null for about
// 40% of players, and for centers/point guards more often than not when
// their lone candidate spot doesn't suit them.
export function assignPos2(p, rng = rand) {
  const candidates = SECONDARY_OPTIONS[p.pos];
  if (!candidates) return null;
  const scores = candidates.map((pos2) => ({ pos2, score: pos2Score(p, pos2) }));
  const ovr = overall(p);
  const best = Math.max(...scores.map((s) => s.score));
  const chance = clamp(0.45 + (best - ovr) / 50, 0.15, 0.85);
  if (rng() >= chance) return null;
  if (scores.length === 1) return scores[0].pos2;
  const total = scores.reduce((s, x) => s + Math.max(x.score, 1), 0);
  let roll = rng() * total;
  for (const x of scores) {
    roll -= Math.max(x.score, 1);
    if (roll < 0) return x.pos2;
  }
  return scores[scores.length - 1].pos2;
}

// "PG", or "PG/SG" if the player has a secondary position — for display.
export function posLabel(p) {
  return p.pos2 ? `${p.pos}/${p.pos2}` : p.pos;
}

// Per-position generation bias across all 14 ratings — a one-time
// generation-time nudge toward each position's typical skill profile (not a
// persistent weighting; overall() has its own position-dependent table
// below). Each row is shifted by a uniform constant so its weighted sum
// under that position's own POSITION_OVR_WEIGHTS (below) is ~0 — keeping
// league-wide OVR/salary equilibrium position-neutral. Anti-position mods
// are large enough to create real attribute gaps: a base-80 PG lands in the
// 50s for block/rebounding without a rebounder sub-archetype to lift them.
const ARCHETYPES = {
  // Scoring/passing attrs stay close to original values to keep league-wide
  // PPG/APG equilibrium. Anti-position attrs (block/rebounding for guards;
  // 3P/passing/speed for bigs) are large negatives — a base-80 PG lands in
  // the 50s for block/rebounding. Speed absorbs the OVR compensation so
  // attacking stats don't inflate.
  PG: { closeShot: -5, midRange: -1, threePoint: 0, freeThrow: 0, passing: 8, ballHandling: 3, perimeterDefense: 0, interiorDefense: -20, steal: 1, block: -20, offensiveRebounding: -20, defensiveRebounding: -20, speed: 11, strength: -9 },
  SG: { closeShot: -2, midRange: 1, threePoint: 2, freeThrow: 1, passing: 2, ballHandling: 4, perimeterDefense: 2, interiorDefense: -14, steal: 3, block: -14, offensiveRebounding: -14, defensiveRebounding: -14, speed: 8, strength: -8 },
  SF: { closeShot: 1, midRange: 1, threePoint: 1, freeThrow: 0, passing: 1, ballHandling: -1, perimeterDefense: 1, interiorDefense: -6, steal: 0, block: -6, offensiveRebounding: -6, defensiveRebounding: -5, speed: 8, strength: 2 },
  PF: { closeShot: 2, midRange: -2, threePoint: -15, freeThrow: -4, passing: -8, ballHandling: -14, perimeterDefense: -3, interiorDefense: 3, steal: -2, block: 3, offensiveRebounding: 5, defensiveRebounding: 6, speed: -8, strength: 5 },
  C:  { closeShot: 2, midRange: -12, threePoint: -22, freeThrow: -16, passing: -16, ballHandling: -22, perimeterDefense: -12, interiorDefense: 3, steal: -12, block: 5, offensiveRebounding: 5, defensiveRebounding: 6, speed: -18, strength: 3 },
};

// Within-position specialization. Each player draws one sub-archetype that
// shifts specific attributes ±10-22 points on top of the position baseline.
// Weights are probabilities (sum to 1). Trade-offs are intentional: a
// rebounder PG pays in shooting; a stretch C pays in rim protection. The
// base + arch + sub combination determines a player's profile, while
// gauss(0, 7) noise still produces rare outliers within any archetype.
const SUB_ARCHETYPES = {
  // Scoring/passing positive boosts are intentionally small (+3-6) so the
  // position arch equilibrium drives league PPG/APG, not sub-archetypes.
  // Differentiation is primarily expressed through what players DON'T do
  // well (larger negative penalties); gauss(0, 7) noise still lets any
  // archetype produce outlier seasons.
  PG: [
    { label: 'scorer',    w: 0.22, mods: { closeShot: 5, midRange: 3, threePoint: 2, passing: -12, ballHandling: -6, perimeterDefense: -5 } },
    { label: 'playmaker', w: 0.28, mods: { closeShot: -10, midRange: -8, threePoint: -6, perimeterDefense: 4, steal: 3 } },
    { label: 'shooter',   w: 0.20, mods: { threePoint: 6, midRange: 3, freeThrow: 4, closeShot: -4, passing: -6, ballHandling: -3, perimeterDefense: -3 } },
    { label: 'two_way',   w: 0.20, mods: { perimeterDefense: 12, steal: 10, closeShot: -8, midRange: -5, threePoint: -5, ballHandling: -3 } },
    { label: 'rebounder', w: 0.10, mods: { defensiveRebounding: 12, offensiveRebounding: 8, block: 8, closeShot: -14, threePoint: -12, midRange: -8 } },
  ],
  SG: [
    { label: 'scorer',     w: 0.28, mods: { closeShot: 4, midRange: 3, threePoint: 2, passing: -7, ballHandling: -5, perimeterDefense: -5 } },
    { label: 'shooter',    w: 0.28, mods: { threePoint: 6, midRange: 4, freeThrow: 4, closeShot: -4, passing: -6, perimeterDefense: -6 } },
    { label: 'two_way',    w: 0.22, mods: { perimeterDefense: 14, steal: 10, closeShot: -6, midRange: -5, threePoint: -7, ballHandling: -3 } },
    { label: 'playmaking', w: 0.22, mods: { threePoint: -4, midRange: -3, closeShot: -2, perimeterDefense: 4, steal: 3 } },
  ],
  SF: [
    { label: 'scorer',        w: 0.28, mods: { closeShot: 4, midRange: 3, threePoint: 3, passing: -5, perimeterDefense: -7, interiorDefense: -5, defensiveRebounding: -4 } },
    { label: '3d_wing',       w: 0.25, mods: { threePoint: 6, perimeterDefense: 12, closeShot: -8, interiorDefense: -5, defensiveRebounding: -5, passing: -3 } },
    { label: 'wing_defender', w: 0.22, mods: { perimeterDefense: 16, steal: 10, defensiveRebounding: 10, closeShot: -12, threePoint: -10 } },
    { label: 'versatile',     w: 0.25, mods: { passing: 4, defensiveRebounding: 4, threePoint: 3, steal: 3, block: -5, offensiveRebounding: -5, strength: -5 } },
  ],
  PF: [
    { label: 'stretch', w: 0.28, mods: { threePoint: 10, midRange: 5, perimeterDefense: 3, ballHandling: 3, defensiveRebounding: -8, offensiveRebounding: -6, block: -6 } },
    { label: 'power',   w: 0.28, mods: { defensiveRebounding: 8, offensiveRebounding: 6, block: 6, interiorDefense: 5, closeShot: -6, threePoint: -12, midRange: -6, speed: -4, ballHandling: -4, strength: -4 } },
    { label: 'scoring', w: 0.25, mods: { closeShot: 5, midRange: 4, passing: 3, defensiveRebounding: -8, interiorDefense: -5, block: -5 } },
    { label: 'two_way', w: 0.19, mods: { perimeterDefense: 12, steal: 8, passing: 4, block: 4, threePoint: -8, midRange: -5, ballHandling: -8, closeShot: -5 } },
  ],
  C: [
    { label: 'defensive', w: 0.32, mods: { block: 14, interiorDefense: 12, defensiveRebounding: 10, offensiveRebounding: 6, closeShot: -8, passing: -6, threePoint: -10 } },
    { label: 'scoring',   w: 0.28, mods: { closeShot: 5, passing: 5, offensiveRebounding: 5, block: -12, defensiveRebounding: -8, threePoint: -4 } },
    { label: 'stretch',   w: 0.22, mods: { threePoint: 12, midRange: 8, block: -18, interiorDefense: -12, defensiveRebounding: -12, offensiveRebounding: -10 } },
    { label: 'versatile', w: 0.18, mods: { closeShot: 6, passing: 8, threePoint: 5, block: 6, defensiveRebounding: 6, offensiveRebounding: 4 } },
  ],
};

function pickSubArchetype(pos, rng) {
  const subs = SUB_ARCHETYPES[pos];
  if (!subs) return null;
  let r = rng();
  let cum = 0;
  for (const sub of subs) {
    cum += sub.w;
    if (r < cum) return sub;
  }
  return subs[subs.length - 1];
}

// overall() weights by position (each row sums to 1.0). Built from a
// category-total table (how much Shooting/Playmaking/Defense/Rebounding/
// Physical matter for that position) times an internal split (how a
// category's total divides among its own attributes) — see the ratings
// system plan for the derivation. Centers barely count shooting/passing;
// point guards barely count interior defense/post strength. Read off
// p.pos only, never pos2, matching how ARCHETYPES above also only biases
// off primary position.
const POSITION_OVR_WEIGHTS = {
  PG: { closeShot: 0.136, midRange: 0.068, threePoint: 0.1156, freeThrow: 0.0204, passing: 0.1408, ballHandling: 0.0792, perimeterDefense: 0.072, interiorDefense: 0.024, steal: 0.048, block: 0.016, offensiveRebounding: 0.0228, defensiveRebounding: 0.0372, speed: 0.165, strength: 0.055 },
  SG: { closeShot: 0.152, midRange: 0.076, threePoint: 0.1292, freeThrow: 0.0228, passing: 0.0896, ballHandling: 0.0504, perimeterDefense: 0.081, interiorDefense: 0.027, steal: 0.045, block: 0.027, offensiveRebounding: 0.0304, defensiveRebounding: 0.0496, speed: 0.143, strength: 0.077 },
  SF: { closeShot: 0.12, midRange: 0.06, threePoint: 0.102, freeThrow: 0.018, passing: 0.0896, ballHandling: 0.0504, perimeterDefense: 0.07, interiorDefense: 0.06, steal: 0.04, block: 0.03, offensiveRebounding: 0.0532, defensiveRebounding: 0.0868, speed: 0.11, strength: 0.11 },
  PF: { closeShot: 0.088, midRange: 0.044, threePoint: 0.0748, freeThrow: 0.0132, passing: 0.0512, ballHandling: 0.0288, perimeterDefense: 0.048, interiorDefense: 0.108, steal: 0.024, block: 0.06, offensiveRebounding: 0.0988, defensiveRebounding: 0.1612, speed: 0.06, strength: 0.14 },
  C: { closeShot: 0.056, midRange: 0.028, threePoint: 0.0476, freeThrow: 0.0084, passing: 0.032, ballHandling: 0.018, perimeterDefense: 0.028, interiorDefense: 0.154, steal: 0.014, block: 0.084, offensiveRebounding: 0.133, defensiveRebounding: 0.217, speed: 0.027, strength: 0.153 },
};

// Stamina runs on its own track, outside p.ratings, so the potential
// ceiling never caps it and overall() never counts it. Guards carry the
// biggest tanks, centers the smallest, and everyone's shrinks with age.
const STAMINA_BASE = { PG: 74, SG: 71, SF: 67, PF: 62, C: 57 };

export function generateStamina(pos, age, rng = rand) {
  let st = gauss(STAMINA_BASE[pos] ?? 65, 12, rng);
  if (age > 29) st -= (age - 29) * 1.4;
  return Math.round(clamp(st, 25, 99));
}

// Yearly stamina aging, applied alongside developPlayer's rating pass
// (called with the pre-increment age, like the ratings are).
function ageStamina(p, rng) {
  let d;
  if (p.age < 25) d = Math.max(0, gauss(0.5, 1.0, rng));
  else if (p.age <= 29) d = gauss(-0.3, 0.8, rng);
  else if (p.age <= 33) d = gauss(-1.6, 0.8, rng);
  else d = gauss(-2.6, 1.0, rng);
  p.stamina = Math.round(clamp((p.stamina ?? 60) + d, 25, 99));
}

// Minutes per game a player's stamina carries without degrading: ~46 for a
// 90-stamina iron man, ~34 for an average (60) starter, ~28 for a 45-stamina
// plodder. Past this, his effective ratings drop in-game and his condition
// drains between games.
export function supportedMinutes(p) {
  return 10 + (p.stamina ?? 60) * 0.4;
}

// Hidden durability tendency (25–99): injury odds scale off it (see
// engine/injuries.js). The number is never shown anywhere — scouts only
// leak a vague note when it's bad enough to flag.
export function generateDurability(rng = rand) {
  return Math.round(clamp(gauss(65, 18, rng), 25, 99));
}

// Physical size, generated like everything else above: position-biased
// Gaussian rolls. Height drives weight/wingspan so a position's "build"
// stays internally consistent rather than rolling independently.
const HEIGHT_BASE = { PG: 75, SG: 77, SF: 79, PF: 81, C: 83 }; // inches
const WEIGHT_POS_BULK = { PG: 0, SG: 12, SF: 28, PF: 33, C: 43 };
const WINGSPAN_POS_OFFSET = { PG: 1.5, SG: 2, SF: 2.5, PF: 3.5, C: 4.5 };
// Position-average wingspan, for sim.js to compare an individual player's
// length against — captures both "tall for position" and "long arms for
// height" in one number.
export const WINGSPAN_POS_AVG = Object.fromEntries(
  Object.keys(HEIGHT_BASE).map((pos) => [pos, HEIGHT_BASE[pos] + WINGSPAN_POS_OFFSET[pos]]),
);

export function generateHeight(pos, rng = rand) {
  return Math.round(clamp(gauss(HEIGHT_BASE[pos] ?? 78, 2.5, rng), 68, 90));
}

export function expectedWeight(pos, heightIn) {
  return heightIn * 2.5 + (WEIGHT_POS_BULK[pos] ?? 20);
}

export function generateWeight(pos, heightIn, rng = rand) {
  return Math.round(clamp(expectedWeight(pos, heightIn) + gauss(0, 10, rng), 150, 290));
}

export function generateWingspan(pos, heightIn, rng = rand) {
  return Math.round(clamp(heightIn + gauss(WINGSPAN_POS_OFFSET[pos] ?? 2.5, 2.5, rng), heightIn - 3, heightIn + 10));
}

// "6'7"" — for display only.
export function formatHeight(heightIn) {
  return `${Math.floor(heightIn / 12)}'${heightIn % 12}"`;
}

// Keeps jersey numbers unique across a team's active roster + two-way
// slots. Deterministic (lowest free number) so call sites never need to
// thread an rng through — call after any roster/twoWay mutation that adds
// a player (signings, trades, draft picks, two-way moves).
export function ensureUniqueJerseys(team) {
  const pool = [...team.roster, ...(team.twoWay || [])];
  const used = new Set();
  for (const p of pool) {
    if (p.jerseyNumber != null && !used.has(p.jerseyNumber)) { used.add(p.jerseyNumber); continue; }
    let n = 0;
    while (used.has(n) && n <= 99) n++;
    p.jerseyNumber = n;
    used.add(n);
  }
}

export function durabilityNote(p) {
  const d = p.durability ?? 65;
  if (d < 45) return 'major durability concerns';
  if (d < 55) return 'durability concerns';
  return null;
}

let nextPlayerId = 1;
export function resetPlayerIds(start = 1) { nextPlayerId = start; }
export function getNextPlayerId() { return nextPlayerId; }

// Yearly retirement roll, made after a player ages a season. Most careers
// end between 34 and 37; stars hang on a year or two longer, but almost
// nobody plays past 38 and 40 is a hard stop.
export function shouldRetire(p, rng = rand) {
  if (p.age < 33) return false;
  if (p.age >= 40) return true;
  const ovr = overall(p);
  const base = (p.age - 33) * 0.25;
  const quality = (ovr - 62) * 0.012; // stars get a discount, fringe guys a push
  return rng() < clamp(base - quality, 0.05, 0.97);
}

export function overall(p) {
  const r = p.ratings;
  const w = POSITION_OVR_WEIGHTS[p.pos] ?? POSITION_OVR_WEIGHTS.SF;
  let sum = 0;
  for (const key in w) sum += r[key] * w[key];
  return Math.round(sum);
}

export function generatePlayer(rng = rand, opts = {}) {
  const pos = opts.pos || pick(POSITIONS, rng);
  const age = opts.age ?? randInt(19, 36, rng);
  const base = opts.base ?? clamp(gauss(58, 11, rng), 35, 88);
  const arch = ARCHETYPES[pos];
  const sub = pickSubArchetype(pos, rng);
  const sm = sub ? sub.mods : {};

  const mk = (attr) => Math.round(clamp(base + arch[attr] + (sm[attr] ?? 0) + gauss(0, 7, rng), 25, 99));
  // Physical attributes (speed/strength) decline with age at generation
  // time too, same as the old single "athleticism" field used to — a
  // 35-year-old free agent shouldn't generate with a rookie's legs.
  const mkPhys = (attr) => Math.round(clamp(base + arch[attr] + (sm[attr] ?? 0) + gauss(0, 8, rng) - (age > 30 ? (age - 30) * 2 : 0), 25, 99));

  const id = opts._forcedId !== undefined ? opts._forcedId : nextPlayerId++;
  const country = pickCountry(rng);
  const backstory = assignBackstory(rng, country.name);
  const heightIn = opts.heightIn ?? generateHeight(pos, rng);
  const p = {
    id,
    name: `${pick(country.firstNames, rng)} ${pick(country.lastNames, rng)}`,
    pos,
    pos2: null,
    age,
    // NBA seasons completed; veterans entered the league at 19–22
    exp: opts.exp ?? Math.max(0, age - randInt(19, 22, rng)),
    subArchetype: sub ? sub.label : null,
    ratings: {
      closeShot: mk('closeShot'),
      midRange: mk('midRange'),
      threePoint: mk('threePoint'),
      freeThrow: mk('freeThrow'),
      passing: mk('passing'),
      ballHandling: mk('ballHandling'),
      perimeterDefense: mk('perimeterDefense'),
      interiorDefense: mk('interiorDefense'),
      steal: mk('steal'),
      block: mk('block'),
      offensiveRebounding: mk('offensiveRebounding'),
      defensiveRebounding: mk('defensiveRebounding'),
      speed: mkPhys('speed'),
      strength: mkPhys('strength'),
    },
    stamina: generateStamina(pos, age, rng),
    condition: 100, // game-day freshness, managed by the league's day loop
    durability: Math.round(clamp(generateDurability(rng) + durabilityAdjust(backstory), 25, 99)),
    heightIn,
    weightLbs: opts.weightLbs ?? generateWeight(pos, heightIn, rng),
    wingspanIn: opts.wingspanIn ?? generateWingspan(pos, heightIn, rng),
    jerseyNumber: opts.jerseyNumber ?? randInt(0, 99, rng), // provisional; de-duped on roster join, see ensureUniqueJerseys
    injury: null, // { type, tier, daysLeft } while hurt — see engine/injuries.js
    // Hidden personality archetype — see engine/backstory.js. `scout` tracks
    // pre-draft/pre-roster scouting investment (engine/scoutingTrips.js).
    backstory,
    backstoryRevealed: false,
    scout: { watched: 0 },
    morale: initMorale(id), // 0-100, see engine/morale.js
    moraleLowStreak: 0,
    tradeDemand: false,
    trainingFocus: null,
    potential: 0,
    contract: null,
    stats: emptyStats(),
    careerStats: [],
    playoffStats: emptyStats(),
    playoffCareerStats: [],
    gLeagueStats: emptyStats(), // production while on a two-way assignment — see engine/sim.js simGLeagueGame
    gLeagueCareerStats: [],
    qualitySeasons: 0, // count of seasons with 1000+ minutes — collapses dev-trait fog
    awards: [], // { season, award } — filled by engine/awards.js
    seasonStints: [], // { team, stats } — filled by engine/league.js on trades
    championships: 0, // count of titles won while on the roster — engine/legacy.js
    milestones: [],   // career milestone events — see engine/milestones.js
  };
  assignOrigin(p, rng, country);
  p.pos2 = assignPos2(p, rng);
  const ovr = overall(p);
  if (opts.potential != null) {
    p.potential = clamp(Math.round(opts.potential), ovr, 99);
  } else {
    // Youth upside: steep for teenagers, gone by the late 20s. A slice of
    // young players carry a late-bloomer star ceiling so fresh talent keeps
    // entering the league outside the draft too. Damped near the top of the
    // scale — a young player already rated in the 80s is close to a
    // finished product, so true superstar ceilings come from the draft.
    let upside = (26 - age) * 2.4 + gauss(0, 5, rng);
    if (age <= 23 && rng() < 0.1) upside += 7 + rng() * 11;
    // Damping only kicks in for prospects already in the superstar band
    // (90+); below that, a young player rated in the 80s can still grow
    // into a top-tier ceiling.
    upside *= clamp((99 - ovr) / 10, 0, 1);
    p.potential = clamp(ovr + Math.max(0, Math.round(upside)), ovr, 99);
  }
  p.devArc = assignDevArc(age, p.potential, rng);
  p.contract = opts.contract ?? generateContract(p, rng);
  return p;
}

export function emptyStats() {
  const s = { gp: 0, min: 0, pts: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, pm: 0 };
  for (const col of ZONE_STAT_COLS) s[col] = 0;
  return s;
}

// Floor for generated fringe talent (open free agency, roster replenishment,
// fantasy-draft pool tail): even a player who'll never be rotation-caliber
// represents real NBA/G-League-adjacent talent, not a replacement-level
// zero. Kept just under the SALARY_CURVE minimum-salary anchor below, so it
// doesn't redefine what "minimum salary" means — it just stops generation
// from dropping players far below it.
export const FRINGE_OVR_MEAN = 58;
export const FRINGE_OVR_SPREAD = 7;
export const FRINGE_OVR_FLOOR = 50;
export const FRINGE_OVR_CEIL = 72;

// Market salary by overall, linear between the tier breakpoints below:
// stars (85+) $40–50M, good starters (75–84) $25–35M, solid starters
// (65–74) $12–22M, rotation players (55–64) $5–10M, end of bench near the
// minimum. Calibrated so a typical 14-man roster lands near the $141M cap.
const SALARY_CURVE = [
  [48, MIN_SALARY],
  [55, 5_000_000],
  [64, 10_000_000],
  [65, 12_000_000],
  [74, 22_000_000],
  [75, 25_000_000],
  [84, 35_000_000],
  [85, 40_000_000],
  [92, MAX_SALARY],
];

export function salaryFor(ovr, age) {
  let sal = MAX_SALARY;
  if (ovr <= SALARY_CURVE[0][0]) {
    sal = MIN_SALARY;
  } else {
    for (let i = 1; i < SALARY_CURVE.length; i++) {
      const [o1, s1] = SALARY_CURVE[i - 1];
      const [o2, s2] = SALARY_CURVE[i];
      if (ovr <= o2) { sal = s1 + ((ovr - o1) / (o2 - o1)) * (s2 - s1); break; }
    }
  }
  // mild discount for very young players still building a market
  if (age <= 22) sal *= 0.75;
  else if (age <= 24) sal *= 0.9;
  return Math.max(MIN_SALARY, Math.round(sal / 100_000) * 100_000);
}

export function generateContract(p, rng = rand) {
  const ovr = overall(p);
  const years = ovr >= 80 ? randInt(3, 5, rng) : ovr >= 65 ? randInt(2, 3, rng) : randInt(1, 2, rng);
  return {
    salary: Math.max(MIN_SALARY, Math.round(salaryFor(ovr, p.age) * (0.85 + rng() * 0.3) / 100_000) * 100_000),
    years,
  };
}

// ---------- Progression history ----------
// One compact row per completed season, snapshotted right before that
// offseason's development pass, stored on the player as p.ratingHistory:
//   [season, overall, ...HISTORY_KEYS ratings, stamina]
// Rows are capped at the last HISTORY_SEASONS so long careers don't bloat
// the localStorage save. The array is created lazily, so players from old
// saves need no migration — their history simply starts now.
export const HISTORY_KEYS = [
  'closeShot', 'midRange', 'threePoint', 'freeThrow', 'passing', 'ballHandling',
  'perimeterDefense', 'interiorDefense', 'steal', 'block',
  'offensiveRebounding', 'defensiveRebounding', 'speed', 'strength',
];
export const HISTORY_SEASONS = 12;

// Current ratings in history-row order (without the leading season)
export function ratingRow(p) {
  return [overall(p), ...HISTORY_KEYS.map((k) => p.ratings[k]), p.stamina ?? 60];
}

export function snapshotRatings(p, season) {
  if (!p.ratingHistory) p.ratingHistory = [];
  p.ratingHistory.push([season, ...ratingRow(p)]);
  if (p.ratingHistory.length > HISTORY_SEASONS) {
    p.ratingHistory.splice(0, p.ratingHistory.length - HISTORY_SEASONS);
  }
}

// Logs a signed deal (new contract, re-sign, extension kicking in, etc.) to
// the player's contract history for the Player Profile screen. Capped at
// HISTORY_SEASONS like ratingHistory above — nothing derives totals from
// this, it's purely a display list, so trimming old entries is lossless
// except for the display itself.
export function recordContract(p, season, teamId, contract) {
  if (!contract) return;
  if (!p.contractHistory) p.contractHistory = [];
  p.contractHistory.push({ season, team: teamId, salary: contract.salary, years: contract.years });
  if (p.contractHistory.length > HISTORY_SEASONS) {
    p.contractHistory.splice(0, p.contractHistory.length - HISTORY_SEASONS);
  }
}

// Logs a team-change event (draft, trade, free-agent signing, waiver) to the
// player's career transaction log for the Player Profile screen. Unlike
// contractHistory/ratingHistory this is never trimmed — it's a handful of
// entries over a whole career, not one per season, so it's cheap to keep in
// full. `team` is the team the player lands on (or, for a waiver, the team
// that released him); `fromTeam` is set only for trades.
export function recordTransaction(p, { season, day = 0, type, team, fromTeam, text }) {
  if (!p.transactions) p.transactions = [];
  p.transactions.push({ season, day, type, team, fromTeam, text });
}

// "Similar to" — the closest matches across the league for a player's
// rating profile, by Euclidean distance over the seven core ratings plus a
// small age component (so a young high-upside player doesn't match a
// veteran with an identical current profile as closely).
export function similarPlayers(league, target, count = 5) {
  const rows = [];
  for (const team of league.teams) {
    for (const p of team.roster) {
      if (p.id === target.id) continue;
      let sum = 0;
      for (const k of HISTORY_KEYS) {
        const d = p.ratings[k] - target.ratings[k];
        sum += d * d;
      }
      sum += Math.pow((p.age - target.age) * 0.5, 2);
      rows.push({ p, team, dist: sum });
    }
  }
  return rows.sort((a, b) => a.dist - b.dist).slice(0, count);
}

// ---------- Development arcs ----------
// Assigned once at generation, stored as p.devArc. Shapes the growth curve
// and age breakpoints independent of backstory (the two stack). Standard arc
// preserves pre-existing behavior; old saves without the field default to it.
export const DEV_ARC_LABELS = {
  prodigy:    'Prodigy',
  earlyBloom: 'Early Bloomer',
  lateBloom:  'Late Bloomer',
  fadeResist: 'Slow Fade',
};

function assignDevArc(age, potential, rng) {
  if (age > 30) return 'standard';
  const r = rng();
  if (age <= 24) {
    // Prodigy only for high-ceiling young players
    if (potential >= 82 && r < 0.07) return 'prodigy';
    const r2 = potential >= 82 ? r - 0.07 : r;
    if (r2 < 0.18) return 'earlyBloom';
    if (r2 < 0.36) return 'lateBloom';
    if (r2 < 0.41) return 'fadeResist';
  } else {
    if (r < 0.12) return 'fadeResist';
  }
  return 'standard';
}

// Training focus: the user can assign one of these per player (p.trainingFocus)
// to weight that player's development roll toward a skill area, at the cost
// of slight regression in a neglected attribute.
export const TRAINING_FOCUS_OPTIONS = [
  { id: 'scoring', label: 'Scoring', boost: ['closeShot', 'midRange', 'threePoint', 'freeThrow'], neglect: 'perimeterDefense' },
  { id: 'playmaking', label: 'Playmaking', boost: ['passing', 'ballHandling'], neglect: 'defensiveRebounding' },
  { id: 'defense', label: 'Defense', boost: ['perimeterDefense', 'interiorDefense', 'steal', 'block'], neglect: 'threePoint' },
  { id: 'rebounding', label: 'Rebounding', boost: ['offensiveRebounding', 'defensiveRebounding'], neglect: 'threePoint' },
  { id: 'physical', label: 'Physical', boost: ['speed', 'strength'], neglect: 'passing' },
];

// Yearly development. Growth is ceiling-driven: high-potential players under
// their arc's growthEnd close on their ceiling fast (3–6 OVR/yr, with
// occasional breakout leaps); decline is noticeable from the primeEnd and
// steep after the cliffStart. Dev arc shapes the curve; backstory stacks on
// top via adjustGrowthDelta / adjustRatingDelta.
export function developPlayer(p, rng = rand, coachBonus = 0, repBonus = 0) {
  // Gem reveal: once a hidden-gem prospect's OVR climbs past the fake scouted
  // ceiling, surface the true value — this is the "eureka" moment.
  if (p._truePotential != null && overall(p) >= p.potential) {
    p.potential = p._truePotential;
    delete p._truePotential;
  }

  // Helpers to read/write the effective development ceiling. For hidden gems
  // _truePotential is the real ceiling; p.potential stays at the scouted
  // (fake) value until the reveal above fires.
  const getPot = () => p._truePotential ?? p.potential;
  const setPot = (v) => {
    if (p._truePotential != null) p._truePotential = v;
    else p.potential = v;
  };

  if (coachBonus && p.age < 25) setPot(clamp(getPot() + coachBonus, 25, 99));
  // One-time ceiling re-evaluation after rookie season: busts trend down,
  // gems trend up. A negative bias on the default offsets the structural
  // upward skew from clamping a two-sided roll against a one-sided floor.
  if (p.exp === 1 && p.age < 26) {
    const driftMean = p.backstory === 'bust' ? -4.0 : p.backstory === 'gem' ? 1.5 : -2.8;
    const drift = gauss(driftMean, 2.5, rng);
    setPot(clamp(Math.round(getPot() + drift), Math.round(overall(p)), 99));
  }
  const ovr = overall(p);
  const pot = getPot();
  const room = pot - ovr;

  // --- Dev arc age thresholds ---
  const arc = p.devArc ?? 'standard';
  const growthEnd  = arc === 'earlyBloom' ? 22 : arc === 'lateBloom' ? 27 : 25;
  const primeEnd   = arc === 'lateBloom' || arc === 'fadeResist' ? 30 : 28;
  const declineEnd = arc === 'lateBloom' || arc === 'fadeResist' ? 32 : 30;
  const cliffStart = arc === 'lateBloom' ? 35 : arc === 'fadeResist' ? 36 : 33;
  const speedMult  = arc === 'prodigy' ? 1.7 : arc === 'earlyBloom' ? 1.3 : arc === 'lateBloom' ? 0.75 : 1.0;
  const breakChance = arc === 'prodigy' ? 0.25 : 0.15;
  const breakMinPot = arc === 'prodigy' ? 74 : 78;
  const cliffBase  = arc === 'fadeResist' ? -3.0 : -3.5;
  const cliffRate  = arc === 'fadeResist' ? 0.5 : 0.6;

  let delta;
  if (p.age < growthEnd && room > 0) {
    const baseSpeed = pot >= 85 ? 5.5 : pot >= 75 ? 4.0 : 1.8;
    delta = Math.max(0, gauss(baseSpeed * speedMult, 1.5, rng));
    if (pot >= breakMinPot && rng() < breakChance) delta += 3 + rng() * 3;
    delta += repBonus;
    delta = Math.min(delta, room);
  } else if (p.age < growthEnd) {
    delta = gauss(0, 0.6, rng); // hit ceiling early — plateaued
  } else if (p.age <= primeEnd) {
    // Late bloomers still have elevated growth right after their development window
    if (arc === 'lateBloom' && p.age <= 28 && room > 0) {
      delta = clamp(gauss(0.8, 0.9, rng), 0, Math.min(room, 2.0));
    } else {
      delta = room > 0 ? clamp(gauss(0.4, 0.8, rng), 0, Math.min(room, 1.2)) : gauss(-0.4, 0.6, rng);
    }
  } else if (p.age <= declineEnd) {
    delta = gauss(-1.4, 0.7, rng);
  } else if (p.age <= cliffStart) {
    delta = gauss(-2.8, 0.8, rng);
  } else {
    delta = gauss(cliffBase - (p.age - cliffStart - 1) * cliffRate, 1.0, rng);
  }
  delta = adjustGrowthDelta(p, delta, room, rng);

  // Pre-compute skill rankings for growth specialization (done once per season,
  // before any ratings change, so specialization is based on the current profile)
  const sortedKeys = Object.keys(p.ratings).sort((a, b) => p.ratings[b] - p.ratings[a]);
  const topRatingSet    = new Set(sortedKeys.slice(0, 3));
  const bottomRatingSet = new Set(sortedKeys.slice(-3));

  const focus = TRAINING_FOCUS_OPTIONS.find((f) => f.id === p.trainingFocus);
  for (const key of Object.keys(p.ratings)) {
    let d = delta + gauss(0, 1.2, rng);
    if (focus) {
      // Total boost across the focus's attributes stays ~0.8 regardless of
      // how many it covers — several of the new split categories have more
      // boosted members than the old 7-rating system did, and applying the
      // full 0.8 to each one (against a single -0.5 neglect) would give
      // every focus a much bigger net-positive growth bias than intended.
      if (focus.boost.includes(key)) d += 0.8 / focus.boost.length;
      else if (key === focus.neglect) d -= 0.5;
    }
    // Physical attributes (speed/strength) decay faster than skills after the prime —
    // a 34-year-old can still shoot and pass but has visibly lost a step.
    if ((key === 'speed' || key === 'strength') && p.age > 27) {
      d -= (p.age - 27) * 0.35;
    }
    // During growth, skills specialize: existing strengths compound faster,
    // weak spots lag — players become more distinct over time.
    if (delta > 0) {
      if (topRatingSet.has(key)) d += delta * 0.2;
      else if (bottomRatingSet.has(key)) d -= delta * 0.15;
    }
    d = adjustRatingDelta(p, d, key, room, rng);
    if (d > 0 && room <= 0) d = 0; // the ceiling is a ceiling
    p.ratings[key] = Math.round(clamp(p.ratings[key] + d, 25, 99));
  }
  ageStamina(p, rng);
  p.age += 1;
  p.exp = (p.exp ?? 0) + 1;
}
