// Headless stats sanity check: sims full seasons (all 30 teams AI-run) and
// verifies the league's stat distribution stays NBA-shaped season over
// season. Run with `npm run test:stats`. Exits non-zero on any failure.
//
//   node scripts/stats-sanity.mjs [seasons] [seed]
//
// Checks, per season:
//   - top scorer averages 28-34 ppg
//   - only a handful of players exceed 28 ppg (median ~3-4; <=7 allows the
//     occasional star-rich year, like the real NBA's 2022-23)
//   - league scoring sits near 110-115 team points per game
//   - top rebounder lands near 12-14 rpg, top assister near 10-11 apg
//   - league-wide mean overall rating doesn't drift across seasons
//     (within +/-2 points of opening day; the bug this guards against
//     drifted +4 in five seasons and kept climbing)

import {
  createLeague, simDay, simPlayoffGame, advanceOffseason, simFreeAgencyDay,
} from '../src/engine/league.js';
import { simDraftToUser, finishDraft } from '../src/engine/draft.js';
import { overall } from '../src/engine/players.js';

const SEASONS = Number(process.argv[2]) || 5;
const SEED = Number(process.argv[3]) || 20260611;
const MIN_GP = 50; // qualifying bar for per-game leader stats

const league = createLeague('LAL', SEED);
// Headless: no user team, every front office is AI-run
league.userTeamId = null;
for (const t of league.teams) delete t.lineup;

const perGame = (p, k) => p.stats[k] / p.stats.gp;

function leagueMeanOverall(lg) {
  const all = lg.teams.flatMap((t) => t.roster);
  return all.reduce((s, p) => s + overall(p), 0) / all.length;
}

function seasonReport(lg, totalPts, teamGames) {
  const qualified = lg.teams
    .flatMap((t) => t.roster)
    .filter((p) => p.stats.gp >= MIN_GP);
  const by = (k) => [...qualified].sort((a, b) => perGame(b, k) - perGame(a, k));
  const scorers = by('pts');
  return {
    topPpg: perGame(scorers[0], 'pts'),
    topScorer: scorers[0].name,
    over28: scorers.filter((p) => perGame(p, 'pts') > 28).length,
    teamPpg: totalPts / teamGames,
    topRpg: perGame(by('reb')[0], 'reb'),
    topApg: perGame(by('ast')[0], 'ast'),
    top5Ppg: scorers.slice(0, 5).map((p) => perGame(p, 'pts').toFixed(1)).join(', '),
  };
}

let failures = 0;
function check(season, label, value, lo, hi) {
  const ok = value >= lo && value <= hi;
  if (!ok) failures += 1;
  const v = typeof value === 'number' ? value.toFixed(2) : value;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${v}  (want ${lo}-${hi})`);
}

const baselineOvr = leagueMeanOverall(league);
console.log(`Seed ${SEED} — opening mean overall ${baselineOvr.toFixed(2)}\n`);

for (let s = 0; s < SEASONS; s++) {
  const startOvr = leagueMeanOverall(league);
  let totalPts = 0;
  let teamGames = 0;

  while (league.phase === 'regular') {
    for (const r of simDay(league)) {
      totalPts += r.homePts + r.awayPts;
      teamGames += 2;
    }
  }
  const r = seasonReport(league, totalPts, teamGames);

  console.log(`Season ${league.season} (mean ovr at tip-off ${startOvr.toFixed(2)})`);
  console.log(`  top 5 scorers: ${r.top5Ppg} ppg (leader: ${r.topScorer})`);
  check(league.season, 'top scorer ppg', r.topPpg, 28, 34);
  check(league.season, 'players over 28 ppg', r.over28, 0, 7);
  check(league.season, 'league team ppg', r.teamPpg, 110, 115);
  check(league.season, 'top rebounder rpg', r.topRpg, 11.5, 14.5);
  check(league.season, 'top assister apg', r.topApg, 9.5, 11.5);
  check(league.season, 'mean overall drift', startOvr - baselineOvr, -2, 2);
  console.log('');

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

console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
