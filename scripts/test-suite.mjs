// Consolidated sanity suite: sims full seasons headlessly (all 30 teams
// AI-run, engine code only — no React) and verifies the league stays
// NBA-shaped in four areas, season over season. Run with `npm test`.
// Exits non-zero on any failure.
//
//   node scripts/test-suite.mjs [seasons] [seed]
//
// Checks, per season:
//   Economy      — average team payroll lands near the salary cap
//   Demographics — league age distribution holds steady, young stars keep
//                  emerging, and the top 20 players average under 29
//   Stats        — top scorer 28-34 ppg, league scoring 110-115 per game,
//                  leader boards NBA-shaped, no league-wide ratings creep
//   Minutes      — minutes leaders around 36-38 mpg, nobody sustains 40+,
//                  low-stamina bigs play less than high-stamina guards
//   Injuries     — each team logs roughly 5-15 injury stretches a season,
//                  the rate holds steady season over season, no team ever
//                  has more than half its roster out at once, and
//                  season-ending injuries stay rare league-wide
//
// scripts/stats-sanity.mjs (`npm run test:stats`) remains the focused
// stats/fatigue check, including the forced-44-minutes experiment.

import {
  createLeague, simDay, simPlayoffGame, advanceOffseason, simFreeAgencyDay, payroll,
} from '../src/engine/league.js';
import { simDraftToUser, finishDraft } from '../src/engine/draft.js';
import { overall } from '../src/engine/players.js';
import { SALARY_CAP } from '../src/data/teams.js';

const SEASONS = Number(process.argv[2]) || 3;
const SEED = Number(process.argv[3]) || 20260611;
const MIN_GP = 50; // qualifying bar for per-game leader stats

let failures = 0;
function check(label, value, lo, hi) {
  const ok = value >= lo && value <= hi;
  if (!ok) failures += 1;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}: ${value.toFixed(2)}  (want ${+lo.toFixed(2)}-${+hi.toFixed(2)})`);
}

const perGame = (p, k) => p.stats[k] / p.stats.gp;
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);

const league = createLeague('LAL', SEED);
// Headless: no user team, every front office is AI-run
league.userTeamId = null;
for (const t of league.teams) delete t.lineup;

const allPlayers = () => league.teams.flatMap((t) => t.roster);
const baselineOvr = mean(allPlayers().map(overall));
const baselineAge = mean(allPlayers().map((p) => p.age));
console.log(`Seed ${SEED} — ${SEASONS} season(s), opening mean overall ${baselineOvr.toFixed(2)}, mean age ${baselineAge.toFixed(2)}`);

let firstSeasonInjuryRate = null;

for (let s = 0; s < SEASONS; s++) {
  let totalPts = 0;
  let teamGames = 0;
  // injury tracking: a "stretch" is one injury event (player goes from
  // healthy to injured), detected by diffing day over day
  let injuryEvents = 0;
  let seasonEnders = 0;
  let maxInjuredShare = 0;
  let prevInjured = new Set();
  while (league.phase === 'regular') {
    for (const r of simDay(league)) {
      totalPts += r.homePts + r.awayPts;
      teamGames += 2;
    }
    const nowInjured = new Set();
    for (const t of league.teams) {
      let out = 0;
      for (const p of t.roster) {
        if (!p.injury) continue;
        out += 1;
        nowInjured.add(p.id);
        if (!prevInjured.has(p.id)) {
          injuryEvents += 1;
          if (p.injury.tier === 'season') seasonEnders += 1;
        }
      }
      maxInjuredShare = Math.max(maxInjuredShare, out / t.roster.length);
    }
    prevInjured = nowInjured;
  }
  const injuryRate = injuryEvents / league.teams.length;
  if (firstSeasonInjuryRate === null) firstSeasonInjuryRate = injuryRate;

  const players = allPlayers();
  const qualified = players.filter((p) => p.stats.gp >= MIN_GP);
  const by = (k) => [...qualified].sort((a, b) => perGame(b, k) - perGame(a, k));

  console.log(`\nSeason ${league.season}`);

  console.log('  Economy');
  const payrolls = league.teams.map((t) => payroll(t) / 1e6);
  const capM = SALARY_CAP / 1e6;
  check('avg team payroll ($M)', mean(payrolls), capM * 0.85, capM * 1.1);
  check('lowest team payroll ($M)', Math.min(...payrolls), capM * 0.5, capM * 1.1);

  console.log('  Demographics');
  const top20 = [...players].sort((a, b) => overall(b) - overall(a)).slice(0, 20);
  const youngStars = players.filter((p) => p.age <= 25 && overall(p) >= 80).length;
  check('league mean age', mean(players.map((p) => p.age)), 24, 27.5);
  check('mean age drift from opening day', mean(players.map((p) => p.age)) - baselineAge, -1.5, 1.5);
  check('top-20 players avg age', mean(top20.map((p) => p.age)), 21, 29);
  check('young stars (age <= 25, ovr >= 80)', youngStars, 1, 40);

  console.log('  Stats');
  const scorers = by('pts');
  check('top scorer ppg', perGame(scorers[0], 'pts'), 28, 34);
  check('players over 28 ppg', scorers.filter((p) => perGame(p, 'pts') > 28).length, 0, 9);
  check('league team ppg', totalPts / teamGames, 110, 115);
  check('top rebounder rpg', perGame(by('reb')[0], 'reb'), 11, 14.5);
  check('top assister apg', perGame(by('ast')[0], 'ast'), 9.5, 12.5);
  check('mean overall drift from opening day', mean(players.map(overall)) - baselineOvr, -2, 2);

  console.log('  Minutes');
  // starter-caliber only, so the stamina cap (not bench roles) drives the gap
  const rotation = players.filter((p) => p.stats.gp >= 40 && overall(p) >= 65);
  const bigs = rotation.filter((p) => p.pos === 'C' && p.stamina <= 55);
  const guards = rotation.filter((p) => (p.pos === 'PG' || p.pos === 'SG') && p.stamina >= 75);
  check('minutes leader mpg (~36-38)', perGame(by('min')[0], 'min'), 35, 38.5);
  check('players at 40+ mpg', qualified.filter((p) => perGame(p, 'min') >= 40).length, 0, 0);
  check('high-stamina guard mpg edge over low-stamina bigs', mean(guards.map((p) => perGame(p, 'min'))) - mean(bigs.map((p) => perGame(p, 'min'))), 1.5, 30);

  console.log('  Injuries');
  check('avg injury stretches per team', injuryRate, 5, 15);
  check('injury rate drift vs first season', injuryRate - firstSeasonInjuryRate, -4, 4);
  check('max share of one roster injured at once', maxInjuredShare, 0, 0.5);
  check('season-ending injuries league-wide', seasonEnders, 0, 12);

  // play out the rest of the league year
  let guard = 0;
  while (league.phase === 'playoffs' && guard++ < 500) simPlayoffGame(league);
  advanceOffseason(league);
  simDraftToUser(league); // no user team, so this runs the whole draft
  finishDraft(league);
  guard = 0;
  while (league.phase === 'freeagency' && guard++ < 50) simFreeAgencyDay(league);
  if (league.phase !== 'regular') throw new Error(`stuck in phase ${league.phase}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
