import { rand, randInt, pick, gauss, clamp } from './rng.js';
import { MIN_SALARY, MAX_SALARY } from '../data/teams.js';
import { initMorale } from './morale.js';
import { NATIONALITIES, NATIONALITY_W } from './names.js';
import { assignBackstory, durabilityAdjust, adjustGrowthDelta, adjustRatingDelta } from './backstory.js';

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
    case 'SG': return (r.three + r.passing) / 2;
    case 'SF': return (r.three + r.defense) / 2;
    case 'PF': return (r.rebounding + r.inside) / 2;
    case 'C': return (r.rebounding + r.inside) / 2;
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

const ARCHETYPES = {
  PG: { ins: -5, mid: 3, three: 5, pass: 10, reb: -8, def: 0 },
  SG: { ins: -2, mid: 4, three: 6, pass: 0, reb: -5, def: 0 },
  SF: { ins: 0, mid: 2, three: 2, pass: -2, reb: 0, def: 2 },
  PF: { ins: 4, mid: -2, three: -4, pass: -5, reb: 6, def: 2 },
  C: { ins: 8, mid: -5, three: -10, pass: -7, reb: 10, def: 4 },
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

// Free-throw shooting, derived from shooting touch rather than stored as a
// rating, so it exists for every player including those in old saves.
export function ftRating(p) {
  const r = p.ratings;
  return Math.round(clamp(r.mid * 0.5 + r.three * 0.3 + r.passing * 0.2, 25, 99));
}

export function overall(p) {
  const r = p.ratings;
  return Math.round(
    r.inside * 0.2 + r.mid * 0.13 + r.three * 0.17 +
    r.passing * 0.14 + r.rebounding * 0.13 + r.defense * 0.13 + r.athleticism * 0.1
  );
}

export function generatePlayer(rng = rand, opts = {}) {
  const pos = opts.pos || pick(POSITIONS, rng);
  const age = opts.age ?? randInt(19, 36, rng);
  const base = opts.base ?? clamp(gauss(58, 11, rng), 35, 88);
  const arch = ARCHETYPES[pos];

  const mk = (mod) => Math.round(clamp(base + mod + gauss(0, 7, rng), 25, 99));

  const id = opts._forcedId !== undefined ? opts._forcedId : nextPlayerId++;
  const country = pickCountry(rng);
  const backstory = assignBackstory(rng);
  const p = {
    id,
    name: `${pick(country.firstNames, rng)} ${pick(country.lastNames, rng)}`,
    pos,
    pos2: null,
    age,
    // NBA seasons completed; veterans entered the league at 19–22
    exp: opts.exp ?? Math.max(0, age - randInt(19, 22, rng)),
    ratings: {
      inside: mk(arch.ins),
      mid: mk(arch.mid),
      three: mk(arch.three),
      passing: mk(arch.pass),
      rebounding: mk(arch.reb),
      defense: mk(arch.def),
      athleticism: Math.round(clamp(base + gauss(0, 8, rng) - (age > 30 ? (age - 30) * 2 : 0), 25, 99)),
    },
    stamina: generateStamina(pos, age, rng),
    condition: 100, // game-day freshness, managed by the league's day loop
    durability: Math.round(clamp(generateDurability(rng) + durabilityAdjust(backstory), 25, 99)),
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
    qualitySeasons: 0, // count of seasons with 1000+ minutes — collapses dev-trait fog
    awards: [], // { season, award } — filled by engine/awards.js
    seasonStints: [], // { team, stats } — filled by engine/league.js on trades
    championships: 0, // count of titles won while on the roster — engine/legacy.js
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
  p.contract = opts.contract ?? generateContract(p, rng);
  return p;
}

export function emptyStats() {
  return { gp: 0, min: 0, pts: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, pm: 0 };
}

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
export const HISTORY_KEYS = ['inside', 'mid', 'three', 'passing', 'rebounding', 'defense', 'athleticism'];
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

// Training focus: the user can assign one of these per player (p.trainingFocus)
// to weight that player's development roll toward a skill area, at the cost
// of slight regression in a neglected attribute.
export const TRAINING_FOCUS_OPTIONS = [
  { id: 'scoring', label: 'Scoring', boost: ['inside', 'mid', 'three'], neglect: 'defense' },
  { id: 'playmaking', label: 'Playmaking', boost: ['passing'], neglect: 'rebounding' },
  { id: 'defense', label: 'Defense', boost: ['defense'], neglect: 'three' },
  { id: 'rebounding', label: 'Rebounding', boost: ['rebounding'], neglect: 'three' },
  { id: 'athleticism', label: 'Athleticism', boost: ['athleticism'], neglect: 'passing' },
];

// Yearly development. Growth is ceiling-driven: high-potential players under
// 25 close on their ceiling fast (3–6 overall a year, with occasional
// breakout leaps), modest ceilings inch along and plateau early. Decline is
// noticeable from 31 and steep after 33.
export function developPlayer(p, rng = rand, coachBonus = 0) {
  // A development-focused coach nudges a young player's ceiling up (or down)
  // a little each offseason, rather than directly inflating this year's growth.
  if (coachBonus && p.age < 25) p.potential = clamp(p.potential + coachBonus, 25, 99);
  const ovr = overall(p);
  const room = p.potential - ovr;
  let delta;
  if (p.age < 25 && room > 0) {
    const speed = p.potential >= 85 ? 5.5 : p.potential >= 75 ? 4.0 : 1.8;
    delta = Math.max(0, gauss(speed, 1.5, rng)); // a bad year can mean no growth, but never guaranteed creep
    if (p.potential >= 78 && rng() < 0.15) delta += 3 + rng() * 3; // breakout season
    delta = Math.min(delta, room);
  } else if (p.age < 25) {
    delta = gauss(0, 0.6, rng); // hit his ceiling early — plateaued
  } else if (p.age <= 28) {
    // prime years hold steady: late bloomers inch up, finished products erode a touch
    delta = room > 0 ? clamp(gauss(0.4, 0.8, rng), 0, Math.min(room, 1.2)) : gauss(-0.4, 0.6, rng);
  } else if (p.age <= 30) {
    delta = gauss(-1.4, 0.7, rng);
  } else if (p.age <= 33) {
    delta = gauss(-2.8, 0.8, rng);
  } else {
    delta = gauss(-3.5 - (p.age - 34) * 0.6, 1.0, rng); // falling off the cliff
  }
  delta = adjustGrowthDelta(p, delta, room, rng);
  const focus = TRAINING_FOCUS_OPTIONS.find((f) => f.id === p.trainingFocus);
  for (const key of Object.keys(p.ratings)) {
    let d = delta + gauss(0, 1.2, rng);
    if (focus) {
      if (focus.boost.includes(key)) d += 0.8;
      else if (key === focus.neglect) d -= 0.5;
    }
    d = adjustRatingDelta(p, d, key, room, rng);
    if (d > 0 && room <= 0) d = 0; // the ceiling is a ceiling
    p.ratings[key] = Math.round(clamp(p.ratings[key] + d, 25, 99));
  }
  ageStamina(p, rng);
  p.age += 1;
  p.exp = (p.exp ?? 0) + 1;
}
