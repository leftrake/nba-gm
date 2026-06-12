import { rand, randInt, pick, gauss, clamp } from './rng.js';
import { MIN_SALARY, MAX_SALARY } from '../data/teams.js';

const FIRST_NAMES = [
  'Jalen', 'Marcus', 'DeAndre', 'Tyrese', 'Cade', 'Darius', 'Malik', 'Jaylen', 'Zion', 'Trey',
  'Anthony', 'Devin', 'Isaiah', 'Jordan', 'Kevin', 'Chris', 'Mike', 'Aaron', 'Brandon', 'Cameron',
  'Damian', 'Elijah', 'Franz', 'Gary', 'Hassan', 'Ivan', 'Jamal', 'Keon', 'Lonnie', 'Miles',
  'Nikola', 'Omari', 'Paolo', 'Quentin', 'Rashad', 'Scottie', 'Terrence', 'Victor', 'Wendell', 'Xavier',
  'Zach', 'Andre', 'Bol', 'Caleb', 'Dejounte', 'Evan', 'Fred', 'Goga', 'Herb', 'Immanuel',
  'Josh', 'Kyle', 'Luka', 'Markelle', 'Nassir', 'Obi', 'Precious', 'Quinn', 'RJ', 'Saddiq',
  'Talen', 'Usman', 'Vince', 'Wesley', 'Yuta', 'Ziaire', 'Amir', 'Bones', 'Cole', 'Day\'Ron',
  'Emoni', 'Jaden', 'Keegan', 'Lamar', 'Moses', 'Nigel', 'Ousmane', 'Patrick', 'Reggie', 'Shai',
];

const LAST_NAMES = [
  'Williams', 'Johnson', 'Smith', 'Brown', 'Jones', 'Davis', 'Carter', 'Mitchell', 'Turner', 'Brooks',
  'Anderson', 'Bridges', 'Coleman', 'Diallo', 'Edwards', 'Fontaine', 'Green', 'Harris', 'Ingram', 'Jackson',
  'Knox', 'Lewis', 'Murray', 'Nwora', 'Okafor', 'Porter', 'Quickley', 'Robinson', 'Sengun', 'Thompson',
  'Vassell', 'Washington', 'Young', 'Allen', 'Banchero', 'Cunningham', 'Dosunmu', 'Eubanks', 'Fox', 'Gilgeous',
  'Hayes', 'Ivey', 'Jovic', 'Kispert', 'Livers', 'Mathurin', 'Nesmith', 'Okoro', 'Primo', 'Reaves',
  'Sharpe', 'Tate', 'Umude', 'Vincent', 'Wagner', 'Yabusele', 'Ziegler', 'Adebayo', 'Barnes', 'Castle',
  'Duarte', 'Eason', 'Filipowski', 'Garland', 'Holmgren', 'Iverson', 'Jaquez', 'Kessler', 'Lively', 'Maxey',
  'Nembhard', 'Oubre', 'Podziemski', 'Reed', 'Suggs', 'Topic', 'Ware', 'Watson', 'Wembanyama', 'Sochan',
];

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Nationality distribution, loosely matching the real NBA (~3/4 American).
// Americans come out of a college program; internationals played in their
// home country before coming over.
const COUNTRIES = [
  { name: 'USA', flag: '🇺🇸', w: 300 },
  { name: 'Canada', flag: '🇨🇦', w: 18 },
  { name: 'France', flag: '🇫🇷', w: 14 },
  { name: 'Australia', flag: '🇦🇺', w: 8 },
  { name: 'Germany', flag: '🇩🇪', w: 8 },
  { name: 'Serbia', flag: '🇷🇸', w: 6 },
  { name: 'Spain', flag: '🇪🇸', w: 5 },
  { name: 'Slovenia', flag: '🇸🇮', w: 4 },
  { name: 'Greece', flag: '🇬🇷', w: 4 },
  { name: 'Croatia', flag: '🇭🇷', w: 4 },
  { name: 'Lithuania', flag: '🇱🇹', w: 4 },
  { name: 'Turkey', flag: '🇹🇷', w: 3 },
  { name: 'Italy', flag: '🇮🇹', w: 3 },
  { name: 'Nigeria', flag: '🇳🇬', w: 3 },
  { name: 'Cameroon', flag: '🇨🇲', w: 2 },
  { name: 'Senegal', flag: '🇸🇳', w: 2 },
  { name: 'Bahamas', flag: '🇧🇸', w: 2 },
  { name: 'Dominican Republic', flag: '🇩🇴', w: 2 },
  { name: 'Japan', flag: '🇯🇵', w: 2 },
  { name: 'Latvia', flag: '🇱🇻', w: 2 },
  { name: 'Finland', flag: '🇫🇮', w: 2 },
  { name: 'Georgia', flag: '🇬🇪', w: 2 },
  { name: 'Brazil', flag: '🇧🇷', w: 2 },
  { name: 'Argentina', flag: '🇦🇷', w: 2 },
  { name: 'United Kingdom', flag: '🇬🇧', w: 2 },
];
const COUNTRY_W = COUNTRIES.reduce((s, c) => s + c.w, 0);

const COLLEGES = [
  'Duke', 'Kentucky', 'Kansas', 'North Carolina', 'UCLA', 'Gonzaga', 'Arizona', 'UConn', 'Villanova',
  'Michigan State', 'Texas', 'Arkansas', 'Baylor', 'Houston', 'Purdue', 'Alabama', 'Auburn', 'Tennessee',
  'Indiana', 'Ohio State', 'Memphis', 'USC', 'Oregon', 'Florida', 'Syracuse', 'Michigan', 'Louisville',
  'Virginia', 'Illinois', 'Wake Forest', 'Creighton', 'Marquette', 'Iowa', 'Stanford', 'Georgetown', 'Wisconsin',
];

function pickCountry(rng) {
  let roll = rng() * COUNTRY_W;
  return COUNTRIES.find((c) => (roll -= c.w) < 0) ?? COUNTRIES[0];
}

// Sets nationality and pre-NBA origin (`from`: college for Americans, home
// country for internationals). Also used to backfill saves that predate
// these fields.
export function assignOrigin(p, rng = rand) {
  const country = pickCountry(rng);
  p.nationality = country.name;
  p.from = country.name === 'USA' ? pick(COLLEGES, rng) : country.name;
}

export function flagFor(nationality) {
  return COUNTRIES.find((c) => c.name === nationality)?.flag ?? '';
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
  let st = gauss(STAMINA_BASE[pos] ?? 65, 18, rng);
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

// Minutes per game a player's stamina carries without degrading: ~38 for a
// 90-stamina iron man, ~27 for a 50-stamina plodder. Past this, his
// effective ratings drop in-game and his condition drains between games.
export function supportedMinutes(p) {
  return 14 + (p.stamina ?? 60) * 0.27;
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
    r.inside * 0.2 + r.mid * 0.13 + r.three * 0.15 +
    r.passing * 0.12 + r.rebounding * 0.13 + r.defense * 0.17 + r.athleticism * 0.1
  );
}

export function generatePlayer(rng = rand, opts = {}) {
  const pos = opts.pos || pick(POSITIONS, rng);
  const age = opts.age ?? randInt(19, 36, rng);
  const base = opts.base ?? clamp(gauss(58, 11, rng), 35, 88);
  const arch = ARCHETYPES[pos];

  const mk = (mod) => Math.round(clamp(base + mod + gauss(0, 7, rng), 25, 99));

  const p = {
    id: nextPlayerId++,
    name: `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`,
    pos,
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
    durability: generateDurability(rng),
    injury: null, // { type, tier, gamesLeft } while hurt — see engine/injuries.js
    potential: 0,
    contract: null,
    stats: emptyStats(),
    careerStats: [],
    awards: [], // { season, award } — filled by engine/awards.js
  };
  assignOrigin(p, rng);
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
    upside *= clamp((97 - ovr) / 35, 0, 1);
    p.potential = clamp(ovr + Math.max(0, Math.round(upside)), ovr, 99);
  }
  p.contract = opts.contract ?? generateContract(p, rng);
  return p;
}

export function emptyStats() {
  return { gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0 };
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
  return {
    salary: Math.max(MIN_SALARY, Math.round(salaryFor(ovr, p.age) * (0.85 + rng() * 0.3) / 100_000) * 100_000),
    years: randInt(1, 4, rng),
  };
}

// Yearly development. Growth is ceiling-driven: high-potential players under
// 25 close on their ceiling fast (3–6 overall a year, with occasional
// breakout leaps), modest ceilings inch along and plateau early. Decline is
// noticeable from 31 and steep after 33.
export function developPlayer(p, rng = rand) {
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
  for (const key of Object.keys(p.ratings)) {
    let d = delta + gauss(0, 1.2, rng);
    if (d > 0 && room <= 0) d = 0; // the ceiling is a ceiling
    p.ratings[key] = Math.round(clamp(p.ratings[key] + d, 25, 99));
  }
  ageStamina(p, rng);
  p.age += 1;
  p.exp = (p.exp ?? 0) + 1;
}
