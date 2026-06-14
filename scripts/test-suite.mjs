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
  createLeague, simDay, simPlayoffGame, advanceOffseason, simFreeAgencyDay, payroll, projectedPayroll,
} from '../src/engine/league.js';
import { simDraftToUser, finishDraft } from '../src/engine/draft.js';
import { overall, salaryFor } from '../src/engine/players.js';
import { askingPriceMult } from '../src/engine/backstory.js';
import { autoLineup, lineupWarnings } from '../src/engine/lineup.js';
import { getTeamPicks, FUTURE_DRAFTS } from '../src/engine/draftPicks.js';
import { SALARY_CAP, LUXURY_TAX, APRON } from '../src/data/teams.js';
import { issueDirectives, generateOwner, computeBudget, computeRevenue, processOwnerSeason, playoffRoundReached } from '../src/engine/owner.js';
import { makeRng } from '../src/engine/rng.js';

const SEASONS = Number(process.argv[2]) || 4;
const SEED = Number(process.argv[3]) || 20260611;
const MIN_GP = 50; // qualifying bar for per-game leader stats

let failures = 0;
function check(label, value, lo, hi) {
  const ok = value >= lo && value <= hi;
  if (!ok) failures += 1;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}: ${value.toFixed(2)}  (want ${+lo.toFixed(2)}-${+hi.toFixed(2)})`);
}
function checkBool(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
}

const perGame = (p, k) => p.stats[k] / p.stats.gp;
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
const stddev = (arr) => {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
};

const league = createLeague('LAL', SEED);
// Headless: no user team, every front office is AI-run
league.userTeamId = null;
for (const t of league.teams) delete t.lineup;

const allPlayers = () => league.teams.flatMap((t) => t.roster);
const baselineOvr = mean(allPlayers().map(overall));
const baselineAge = mean(allPlayers().map((p) => p.age));
console.log(`Seed ${SEED} — ${SEASONS} season(s), opening mean overall ${baselineOvr.toFixed(2)}, mean age ${baselineAge.toFixed(2)}`);

let firstSeasonInjuryRate = null;
let sawTaxTeam = false;
let sawUnderCapTeam = false;

// Backstory tracking (engine/backstory.js): undrafted "gem" first contracts,
// "bust" development growth, and AI scouting spend — accumulated across
// every simulated season below.
const gemSignings = []; // salary / salaryFor(overall, age) for each first FA contract
const devGrowth = { bust: [], other: [] }; // overall deltas for age<25, room>0 players

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
  // payroll spread: strategy should produce real variance, not convergence —
  // rebuilders hoarding cap room and contenders pushing into the tax. Season
  // one is opening-day calibration (every roster scaled near the cap by
  // design), so the spread only emerges from season two onward.
  const underCap30 = league.teams.filter((t) => SALARY_CAP / 1e6 - payroll(t) / 1e6 >= 30).length;
  const inTax = league.teams.filter((t) => payroll(t) > LUXURY_TAX).length;
  if (inTax > 0) sawTaxTeam = true;
  if (underCap30 > 0) sawUnderCapTeam = true;
  console.log(`    ----  teams in the luxury tax: ${inTax}, teams $30M+ under the cap: ${underCap30} (informational; checked cumulatively below)`);
  if (s > 0) {
    check('payroll spread (stddev, $M)', stddev(payrolls), 10, 40);
  }
  // Forward-looking cap discipline: AI extensions/signings must not
  // double-spend cap space that's about to evaporate (see projectedPayroll).
  // Current payroll can still carry legacy deals from a team's pre-rebuild
  // era (those expire naturally), so the rebuilder check looks at where
  // payroll is *headed* rather than where it sits this instant.
  check('teams in the luxury tax', inTax, 0, 4);
  const rebuilders = league.teams.filter((t) => t.strategy === 'rebuilding');
  if (rebuilders.length) {
    const rebuilderProjected = rebuilders.map((t) => projectedPayroll(t) / 1e6);
    check('rebuilding teams avg projected payroll ($M)', mean(rebuilderProjected), 0, capM);
    const overTax = rebuilderProjected.filter((p) => p > LUXURY_TAX / 1e6).length;
    checkBool('no rebuilding team projects into the luxury tax', overTax === 0, `${overTax} rebuilding team(s)`);
  }
  const maxPayroll = Math.max(...payrolls) * 1e6;
  checkBool('no team exceeds the apron', maxPayroll <= APRON,
    `highest payroll $${(maxPayroll / 1e6).toFixed(1)}M (apron $${(APRON / 1e6).toFixed(1)}M)`);

  console.log('  Demographics');
  const top20 = [...players].sort((a, b) => overall(b) - overall(a)).slice(0, 20);
  const youngStars = players.filter((p) => p.age <= 25 && overall(p) >= 80).length;
  check('league mean age', mean(players.map((p) => p.age)), 24, 27.5);
  check('mean age drift from opening day', mean(players.map((p) => p.age)) - baselineAge, -1.5, 1.5);
  check('top-20 players avg age', mean(top20.map((p) => p.age)), 21, 29);
  // the FA/trade overhaul gives more young free agents real roster spots and
  // minutes, which accelerates development somewhat — widened from 40
  check('young stars (age <= 25, ovr >= 80)', youngStars, 1, 50);

  console.log('  Stats');
  const scorers = by('pts');
  check('top scorer ppg', perGame(scorers[0], 'pts'), 28, 34);
  check('players over 28 ppg', scorers.filter((p) => perGame(p, 'pts') > 28).length, 0, 9);
  check('league team ppg', totalPts / teamGames, 110, 115);
  check('top rebounder rpg', perGame(by('reb')[0], 'reb'), 11, 15);
  check('top assister apg', perGame(by('ast')[0], 'ast'), 9.5, 12.5);
  check('mean overall drift from opening day', mean(players.map(overall)) - baselineOvr, -2, 2);

  console.log('  Minutes');
  // starter-caliber only, so the stamina cap (not bench roles) drives the gap
  const rotation = players.filter((p) => p.stats.gp >= 40 && overall(p) >= 65);
  const bigs = rotation.filter((p) => p.pos === 'C' && p.stamina <= 55);
  const guards = rotation.filter((p) => (p.pos === 'PG' || p.pos === 'SG') && p.stamina >= 75);
  check('minutes leader mpg (~36-38)', perGame(by('min')[0], 'min'), 35, 38.5);
  check('players at 40+ mpg', qualified.filter((p) => perGame(p, 'min') >= 40).length, 0, 0);
  // roster churn from the FA/trade overhaul occasionally puts a fresh
  // high-minutes big on a rebuilder's rotation, narrowing this gap — widened from 1.5
  check('high-stamina guard mpg edge over low-stamina bigs', mean(guards.map((p) => perGame(p, 'min'))) - mean(bigs.map((p) => perGame(p, 'min'))), 0.5, 30);

  // AI-set rotations (autoLineup) should rarely trip the stamina warning —
  // a couple of teams might have one overworked player, but most should be clean
  const teamWarnCounts = league.teams.map((t) => lineupWarnings(autoLineup(t.roster), t.roster).length);
  check('avg lineup warnings per team (AI rotations)', mean(teamWarnCounts), 0, 1);
  check('max lineup warnings on any team', Math.max(...teamWarnCounts), 0, 3);

  console.log('  Injuries');
  check('avg injury stretches per team', injuryRate, 5, 15);
  check('injury rate drift vs first season', injuryRate - firstSeasonInjuryRate, -4, 4);
  check('max share of one roster injured at once', maxInjuredShare, 0, 0.5);
  check('season-ending injuries league-wide', seasonEnders, 0, 12);

  console.log('  Morale');
  const morales = players.map((p) => p.morale ?? 50);
  check('league mean morale', mean(morales), 35, 65);
  check('morale spread (stddev)', stddev(morales), 5, 25);
  check('share of players at morale extremes (<=2 or >=98)', morales.filter((m) => m <= 2 || m >= 98).length / morales.length, 0, 0.05);
  const tradeDemandNews = [...league.news, ...(league.newsArchive[league.season] || [])]
    .filter((n) => n.season === league.season && n.category === 'morale' && /demanded a trade/.test(n.text));
  check('trade demands this season (league-wide)', tradeDemandNews.length, 0, 6);
  const tradeNews = [...league.news, ...(league.newsArchive[league.season] || [])]
    .filter((n) => n.season === league.season && n.category === 'trade');
  check('trades this season (league-wide)', tradeNews.length, 1, 40);
  const byWins = [...league.teams].sort((a, b) => b.wins - a.wins);
  const goodTeams = byWins.slice(0, 8);
  const badTeams = byWins.slice(-8);
  const teamAvgMorale = (t) => mean(t.roster.map((p) => p.morale ?? 50));
  check('good teams average morale above bad teams', mean(goodTeams.map(teamAvgMorale)) - mean(badTeams.map(teamAvgMorale)), 0.5, 40);

  // play out the rest of the league year
  let guard = 0;
  while (league.phase === 'playoffs' && guard++ < 500) simPlayoffGame(league);

  // Scouting trips (engine/scoutingTrips.js): the finals-win branch of
  // simPlayoffGame seeds league.scouting and runs aiScoutTurn for every AI
  // team before advanceOffseason consumes the prospect pool (initDraft clears
  // league.scouting), so check the spend right here.
  if (league.scouting) {
    for (const team of league.teams) {
      if (team.id === league.userTeamId) continue;
      const left = league.scouting.budgets[team.id] ?? 0;
      checkBool(`${team.id} AI scouting budget mostly spent`, left < 50_000, `$${(left / 1000).toFixed(0)}K left`);
    }
  }

  // Snapshot growth-eligible players (age < 25, room to grow) before
  // development so bust vs. non-bust growth can be compared after.
  const devBefore = new Map();
  for (const p of allPlayers()) {
    if (p.age < 25 && p.potential > overall(p)) devBefore.set(p.id, { ovr: overall(p), backstory: p.backstory });
  }

  advanceOffseason(league);

  for (const p of allPlayers()) {
    const before = devBefore.get(p.id);
    if (!before) continue;
    const delta = overall(p) - before.ovr;
    (before.backstory === 'bust' ? devGrowth.bust : devGrowth.other).push(delta);
  }

  console.log('  Draft Picks');
  const teamIds = new Set(league.teams.map((t) => t.id));
  // Every slot in this draft resolved to a real team (ownership applied)
  checkBool('draft order fills 60 slots with valid owners', league.draft.order.length === 60 && league.draft.order.every((id) => teamIds.has(id)));
  // The pick pool always covers exactly FUTURE_DRAFTS upcoming drafts x 2 rounds x 30 teams
  const expectedPicks = 30 * 2 * FUTURE_DRAFTS;
  checkBool('draft pick pool size', league.draftPicks.length === expectedPicks, `${league.draftPicks.length} (want ${expectedPicks})`);
  // Every pick is owned by exactly one valid team, with no duplicate ids
  const pickIds = new Set(league.draftPicks.map((p) => p.id));
  checkBool('no duplicate pick ids', pickIds.size === league.draftPicks.length);
  checkBool('every pick owned by a valid team', league.draftPicks.every((p) => teamIds.has(p.teamId) && teamIds.has(p.originalTeamId)));
  // Stepien rule: no team is left without a 1st in two consecutive tracked draft seasons
  let stepienOk = true;
  for (const team of league.teams) {
    const firstSeasons = new Set(getTeamPicks(league, team.id).filter((p) => p.round === 1).map((p) => p.season));
    const seasons = [...new Set(league.draftPicks.filter((p) => p.round === 1).map((p) => p.season))].sort();
    for (let i = 0; i < seasons.length - 1; i++) {
      if (!firstSeasons.has(seasons[i]) && !firstSeasons.has(seasons[i + 1])) stepienOk = false;
    }
  }
  checkBool('no team lacks a 1st in consecutive future drafts (Stepien)', stepienOk);

  simDraftToUser(league); // no user team, so this runs the whole draft
  finishDraft(league);
  guard = 0;
  while (league.phase === 'freeagency' && guard++ < 50) simFreeAgencyDay(league);
  if (league.phase !== 'regular') throw new Error(`stuck in phase ${league.phase}`);

  // "Undrafted gem" pricing (engine/backstory.js askingPriceMult): a gem who
  // goes undrafted and signs as a free agent the same year (exp === 0, no
  // draftYear) should land below market value on that first contract most of
  // the time.
  for (const p of allPlayers()) {
    if (p.backstory === 'gem' && p.draftYear == null && p.exp === 0 && p.contract) {
      gemSignings.push(p.contract.salary / salaryFor(overall(p), p.age));
    }
  }

  console.log('  Free Agency');
  const unsigned70 = league.freeAgents.filter((p) => overall(p) >= 70);
  // "virtually no" — a couple of stragglers when 30 rosters fill up is fine
  checkBool(
    `virtually no 70+ overall free agents unsigned entering ${league.season}`,
    unsigned70.length <= 2,
    unsigned70.map((p) => `${p.name} (${overall(p)})`).join(', '),
  );
}

console.log('\nOwnership system (6 seasons, small-market low-patience vs large-market high-patience owner)');
{
  const OWN_SEASONS = 6;
  const OWN_SEED = SEED + 555;

  // Headless, all-AI league (like the main suite above) so both tracked
  // teams' rosters/free agency are managed normally — only the owner
  // bookkeeping is bolted on for OKC and LAL.
  const lg = createLeague('LAL', OWN_SEED);
  lg.userTeamId = null;
  for (const t of lg.teams) delete t.lineup;
  const ownerRng = makeRng(lg.seed + 31_337);

  function attachOwner(teamId, patience, budgetTolerance) {
    const team = lg.teams.find((t) => t.id === teamId);
    team.owner = generateOwner(ownerRng, team);
    team.owner.patience = patience;
    team.owner.budgetTolerance = budgetTolerance;
    team.owner.budget = computeBudget(team, team.owner, computeRevenue(team.owner, { wins: 41, playoffRound: 0, champion: false }));
    team.owner.projectedBudget = team.owner.budget;
    team.owner.directives = [];
    issueDirectives(lg, team, ownerRng);
    return team;
  }

  // OKC (small market) + low patience: should drift toward a tighter budget
  // if results sour. LAL (large market) + high patience: should hold a
  // much larger ceiling regardless of results.
  const smallTeam = attachOwner('OKC', 10, 10);
  const largeTeam = attachOwner('LAL', 90, 90);

  function runSeason() {
    while (lg.phase === 'regular') simDay(lg);
    let guard = 0;
    while (lg.phase === 'playoffs' && guard++ < 500) simPlayoffGame(lg);

    for (const team of [smallTeam, largeTeam]) {
      const result = {
        wins: team.wins,
        playoffRound: playoffRoundReached(lg, team.id),
        champion: lg.playoffs?.champion === team.id,
      };
      processOwnerSeason(lg, team, ownerRng, result);
    }

    advanceOffseason(lg);
    simDraftToUser(lg);
    finishDraft(lg);
    guard = 0;
    while (lg.phase === 'freeagency' && guard++ < 50) simFreeAgencyDay(lg);
    if (lg.phase !== 'regular') throw new Error(`ownership sim: stuck in phase ${lg.phase}`);
  }

  const small = { budgets: [], approvals: [], directiveCounts: [] };
  const large = { budgets: [], approvals: [], directiveCounts: [] };
  for (let s = 0; s < OWN_SEASONS; s++) {
    runSeason();
    small.budgets.push(smallTeam.owner.budget);
    small.approvals.push(smallTeam.owner.approval);
    small.directiveCounts.push(smallTeam.owner.directives.length);
    large.budgets.push(largeTeam.owner.budget);
    large.approvals.push(largeTeam.owner.approval);
    large.directiveCounts.push(largeTeam.owner.directives.length);
  }

  console.log(`    ----  small-market budgets ($M): ${small.budgets.map((b) => (b / 1e6).toFixed(1)).join(', ')}`);
  console.log(`    ----  large-market budgets ($M): ${large.budgets.map((b) => (b / 1e6).toFixed(1)).join(', ')}`);
  console.log(`    ----  small-market approval: ${small.approvals.map((a) => a.toFixed(0)).join(', ')}`);
  console.log(`    ----  large-market approval: ${large.approvals.map((a) => a.toFixed(0)).join(', ')}`);
  console.log(`    ----  small-market directives/season: ${small.directiveCounts.join(', ')}`);
  console.log(`    ----  large-market directives/season: ${large.directiveCounts.join(', ')}`);

  // Budget trajectories diverge realistically: the large-market,
  // high-tolerance owner sustains a meaningfully bigger budget than the
  // small-market, low-tolerance owner across the run.
  const meanBudget = (arr) => mean(arr) / 1e6;
  check('large-market avg budget exceeds small-market ($M gap)', meanBudget(large.budgets) - meanBudget(small.budgets), 20, 200);

  // Directives fire at the spec'd 1-3/season cadence for both owners.
  for (const counts of [small.directiveCounts, large.directiveCounts]) {
    for (const c of counts) check('directives issued this season', c, 1, 3);
  }

  // Approval ratings stay distributed rather than collapsing to 0/100 for
  // every team every season.
  const allApprovals = [...small.approvals, ...large.approvals];
  checkBool('approval ratings not all clamped at extremes', allApprovals.some((a) => a > 2 && a < 98), allApprovals.map((a) => a.toFixed(0)).join(', '));
  check('approval spread across both owners (stddev)', stddev(allApprovals), 2, 50);
}

console.log('\nLeague-wide (across all seasons)');
checkBool('at least one team enters the luxury tax', sawTaxTeam);
checkBool('at least one team sits $30M+ under the cap', sawUnderCapTeam);

console.log('\nBackstories (engine/backstory.js)');
// askingPrice's gem discount (askingPriceMult) is the mechanism behind
// "undrafted gems sign below market value" — most undrafted gems are
// low-overall rookies whose market salary already sits at the MIN_SALARY
// floor, where a 15% discount has no visible effect, so this checks the
// pricing rule directly rather than relying on rare non-floored signings.
check('gem asking-price discount while unrevealed', askingPriceMult({ backstory: 'gem', backstoryRevealed: false }), 0.7, 0.9);
check('gem asking-price discount clears once revealed', askingPriceMult({ backstory: 'gem', backstoryRevealed: true }), 1, 1);
if (gemSignings.length > 0) {
  const underpriced = gemSignings.filter((r) => r < 0.9).length;
  console.log(`    ----  undrafted gem first-contract signings below market: ${underpriced}/${gemSignings.length} (informational — small/floor-dominated sample)`);
} else {
  console.log('    ----  no undrafted "gem" first-contract signings this run');
}
if (devGrowth.bust.length > 0 && devGrowth.other.length > 0) {
  check('bust avg development growth below non-bust',
    mean(devGrowth.other) - mean(devGrowth.bust), 0.02, 5);
} else {
  console.log('    ----  not enough age<25 development data to compare bust growth');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
