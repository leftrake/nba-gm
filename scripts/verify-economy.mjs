// Economy verification harness: sims 3 full seasons headless, twice.
//   Run A — all-AI league: is the natural economy stable (avg payroll
//           within ~5% of the cap, stars retained, FA cleared in round 1)?
//   Run B — greedy user: can the user sign more than one quality starter
//           per offseason without first clearing salary?
// Run with: node scripts/verify-economy.mjs [seed]
import {
  createLeague, simDay, simPlayoffRound, simPlayInGame, advanceOffseason, simFreeAgencyDay, startNewSeason,
  payroll, getTeam, signFreeAgent, makeOffer, offerDemand, preferredYears,
} from '../src/engine/league.js';
import { simCupGame, cupComplete } from '../src/engine/cup.js';
import { onTheClock, makeDraftPick, simDraftToUser, finishDraft } from '../src/engine/draft.js';
import { overall, salaryFor } from '../src/engine/players.js';
import { autoLineup } from '../src/engine/lineup.js';
import { SALARY_CAP, MIN_SALARY } from '../src/data/teams.js';

const seed = Number(process.argv[2]) || 12345;
const M = (n) => `$${(n / 1e6).toFixed(1)}M`;
const QUALITY = 70; // "quality starter" threshold

function payrollReport(league, label) {
  const pays = league.teams.map((t) => payroll(t));
  const avg = pays.reduce((s, x) => s + x, 0) / pays.length;
  const within10 = pays.filter((p) => Math.abs(p - SALARY_CAP) <= 10_000_000).length;
  const over = pays.filter((p) => p > SALARY_CAP).length;
  const pct = ((avg / SALARY_CAP - 1) * 100).toFixed(1);
  const all = league.teams.flatMap((t) => t.roster);
  const n70 = all.filter((p) => overall(p) >= QUALITY).length;
  console.log(`${label}: avg ${M(avg)} (${pct}% vs cap), min ${M(Math.min(...pays))}, max ${M(Math.max(...pays))}, within $10M: ${within10}/30, over cap: ${over}, 70+ players: ${n70}`);
  return avg;
}

const qualityFAs = (league) => league.freeAgents.filter((p) => overall(p) >= QUALITY).length;

function runDraft(league) {
  while (onTheClock(league)) {
    if (onTheClock(league) === league.userTeamId) {
      const best = league.draft.prospects.reduce((a, b) =>
        overall(b) + b.potential > overall(a) + a.potential ? b : a);
      makeDraftPick(league, best.id);
    } else {
      simDraftToUser(league);
    }
  }
  finishDraft(league);
}

function simRegularAndPlayoffs(league) {
  while (league.phase === 'regular') simDay(league);
  if (league.phase === 'cup') {
    let g = 0; while (!cupComplete(league) && g++ < 10) simCupGame(league);
    league.phase = 'regular';
    while (league.phase === 'regular') simDay(league);
  }
  if (league.phase === 'awards') league.phase = 'play-in';
  if (league.phase === 'play-in') {
    let g = 0; while (league.playIn && !league.playIn.complete && g++ < 10) simPlayInGame(league);
    league.phase = 'playoffs';
  }
  while (league.phase === 'playoffs') simPlayoffRound(league);
}

// snapshot ids of quality starters whose contracts are about to expire
function expiringQuality(league) {
  const ids = new Set();
  for (const t of league.teams) {
    for (const p of t.roster) {
      if (p.contract?.years === 1 && overall(p) >= QUALITY) ids.add(p.id);
    }
  }
  return ids;
}

console.log('--- salaryFor spot checks (age 27) ---');
for (const ovr of [50, 55, 60, 65, 70, 75, 80, 85, 88, 92]) {
  console.log(`  ovr ${ovr}: ${M(salaryFor(ovr, 27))}`);
}

// ---------------- Run A: all-AI league ----------------
console.log('\n================ RUN A: all-AI league ================');
{
  const league = createLeague('CHI', seed);
  league.userTeamId = '___'; // no team is the user; all 30 behave as AI
  payrollReport(league, 'payrolls at creation');

  const avgs = [];
  for (let s = 0; s < 3; s++) {
    simRegularAndPlayoffs(league);
    const expIds = expiringQuality(league);
    advanceOffseason(league);
    const onRosters = new Set(league.teams.flatMap((t) => t.roster.map((p) => p.id)));
    const resigned = [...expIds].filter((id) => onRosters.has(id)).length;
    const hitMarket = league.freeAgents.filter((p) => expIds.has(p.id)).length;
    runDraft(league);

    console.log(`\n--- ${league.season} offseason ---`);
    console.log(`expiring quality starters (${QUALITY}+): ${expIds.size} — re-signed ${resigned}, reached FA ${hitMarket}, retired ${expIds.size - resigned - hitMarket}`);
    console.log(`quality FAs at open: ${qualityFAs(league)}`);
    simFreeAgencyDay(league);
    console.log(`quality FAs after round 1: ${qualityFAs(league)}`);
    while (league.phase === 'offseason/freeagency') simFreeAgencyDay(league);
    startNewSeason(league);
    console.log(`quality FAs after all 5 rounds: ${qualityFAs(league)} (pool size ${league.freeAgents.length})`);
    avgs.push(payrollReport(league, `payrolls entering ${league.season}`));
  }
  const ok = avgs.every((a) => Math.abs(a / SALARY_CAP - 1) <= 0.05);
  console.log(`\nRUN A verdict — avg payroll within 5% of cap all 3 seasons: ${ok ? 'PASS' : 'FAIL'}`);
}

// ---------------- Run B: greedy user ----------------
console.log('\n================ RUN B: greedy user (CHI) ================');
{
  const league = createLeague('CHI', seed + 1);
  const user = () => getTeam(league, 'CHI');

  for (let s = 0; s < 3; s++) {
    simRegularAndPlayoffs(league);
    // Engaged-GM emulation: extend our own expiring keepers at market rate
    // (the engine leaves user re-signs to the user), so the roster stays
    // intact and near the cap — no salary is ever cleared.
    let extended = 0;
    for (const p of user().roster) {
      if (p.contract?.years !== 1 || p.age > 36 || overall(p) < 55) continue;
      const salary = Math.min(salaryFor(overall(p), p.age), SALARY_CAP); // market rate
      if (payroll(user()) - p.contract.salary + salary > 172_000_000) continue; // tax line
      p.contract = { salary, years: preferredYears(p) + 1 }; // +1: offseason decrements
      extended++;
    }
    advanceOffseason(league);
    runDraft(league);

    const room0 = SALARY_CAP - payroll(user());
    console.log(`\n--- ${league.season} offseason --- user room at FA open: ${M(room0)} (extended ${extended} own players, cleared no salary)`);

    // Greedy: every round, before the AI moves, chase every 70+ free agent
    // we can pay for at their demand — no salary clearing allowed.
    let signedQuality = 0;
    while (league.phase === 'offseason/freeagency') {
      for (const p of [...league.freeAgents]) {
        if (overall(p) < QUALITY) continue;
        if (user().roster.length >= 15) break;
        const years = preferredYears(p);
        const demand = offerDemand(league, 'CHI', p, years);
        if (demand === null) continue;
        const room = SALARY_CAP - payroll(user());
        if (demand > room && demand > MIN_SALARY) continue;
        const res = makeOffer(league, 'CHI', p.id, demand, years);
        if (res.ok && res.decision === 'accept') {
          signedQuality++;
          console.log(`  user signs ${p.name} (ovr ${overall(p)}) for ${M(demand)} x ${years}yr`);
        }
      }
      simFreeAgencyDay(league);
    }
    startNewSeason(league);
    console.log(`quality starters signed without clearing salary: ${signedQuality} ${signedQuality <= 1 ? 'PASS' : 'FAIL'}`);

    // fill out the roster with minimum guys, redo the lineup
    while (user().roster.length < 13 && league.freeAgents.length) {
      signFreeAgent(league, 'CHI', league.freeAgents[league.freeAgents.length - 1].id);
    }
    user().lineup = autoLineup(user().roster);
  }
}
