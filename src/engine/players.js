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

const ARCHETYPES = {
  PG: { ins: -5, mid: 3, three: 5, pass: 10, reb: -8, def: 0 },
  SG: { ins: -2, mid: 4, three: 6, pass: 0, reb: -5, def: 0 },
  SF: { ins: 0, mid: 2, three: 2, pass: -2, reb: 0, def: 2 },
  PF: { ins: 4, mid: -2, three: -4, pass: -5, reb: 6, def: 2 },
  C: { ins: 8, mid: -5, three: -10, pass: -7, reb: 10, def: 4 },
};

let nextPlayerId = 1;
export function resetPlayerIds(start = 1) { nextPlayerId = start; }

export function ageModifier(age) {
  // Development curve: improve until ~26, plateau, decline after 30
  if (age <= 21) return 3.0;
  if (age <= 23) return 2.0;
  if (age <= 25) return 1.0;
  if (age <= 28) return 0.2;
  if (age <= 30) return -0.5;
  if (age <= 33) return -1.5;
  return -3.0;
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
    ratings: {
      inside: mk(arch.ins),
      mid: mk(arch.mid),
      three: mk(arch.three),
      passing: mk(arch.pass),
      rebounding: mk(arch.reb),
      defense: mk(arch.def),
      athleticism: Math.round(clamp(base + gauss(0, 8, rng) - (age > 30 ? (age - 30) * 2 : 0), 25, 99)),
    },
    potential: 0,
    contract: null,
    stats: emptyStats(),
    careerStats: [],
  };
  p.potential = clamp(overall(p) + Math.max(0, Math.round((27 - age) * 1.8 + gauss(0, 4, rng))), overall(p), 99);
  p.contract = opts.contract ?? generateContract(p, rng);
  return p;
}

export function emptyStats() {
  return { gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 };
}

export function salaryFor(ovr, age) {
  // Salary scales with overall; young players cheaper (rookie-scale-ish)
  const t = clamp((ovr - 40) / 45, 0, 1);
  let sal = MIN_SALARY + Math.pow(t, 2.2) * (MAX_SALARY - MIN_SALARY);
  if (age <= 23) sal *= 0.45;
  else if (age <= 25) sal *= 0.75;
  return Math.round(sal / 100_000) * 100_000;
}

export function generateContract(p, rng = rand) {
  const ovr = overall(p);
  return {
    salary: Math.max(MIN_SALARY, Math.round(salaryFor(ovr, p.age) * (0.85 + rng() * 0.3) / 100_000) * 100_000),
    years: randInt(1, 4, rng),
  };
}

export function developPlayer(p, rng = rand) {
  const mod = ageModifier(p.age);
  const ovr = overall(p);
  const room = p.potential - ovr;
  for (const key of Object.keys(p.ratings)) {
    let delta = mod + gauss(0, 1.5, rng);
    if (delta > 0 && room <= 0) delta = Math.min(delta, 0.5);
    p.ratings[key] = Math.round(clamp(p.ratings[key] + delta, 25, 99));
  }
  p.age += 1;
}
