// Headless checks for contract extensions: AI mid-season behavior, the
// user offer flow (accept / reject / better-offer rule / counters), and
// offseason rollover (extended players never reach free agency).
// Run with: node scripts/test-extensions.mjs [seed]
import {
  createLeague, simDay, simPlayoffRound, advanceOffseason, getTeam, payroll,
  offerExtension, extensionDemand, extensionEligible, askingPrice,
} from '../src/engine/league.js';
import { overall } from '../src/engine/players.js';

const seed = Number(process.argv[2]) || 42;
const league = createLeague('BOS', seed);
const M = (n) => `$${(n / 1e6).toFixed(1)}M`;
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// --- user flow guards before the season ---
const user = getTeam(league, 'BOS');
const ineligible = user.roster.find((p) => p.contract.years > 1);
check('ineligible player (years > 1) is refused', offerExtension(league, 'BOS', ineligible.id, 30e6, 3).ok === false);

// --- sim past all AI review days (40–99) ---
while (league.dayIndex < 110) simDay(league);

const aiPlayers = league.teams.filter((t) => t.id !== 'BOS').flatMap((t) => t.roster);
const extended = aiPlayers.filter((p) => p.extension);
const flagged = aiPlayers.filter((p) => p.extTalksFailed);
const eligibleStill = aiPlayers.filter((p) => extensionEligible(p) && !p.extTalksFailed);
console.log(`AI mid-season: ${extended.length} extended, ${flagged.length} passed on, ${eligibleStill.length} undecided (refusals/tax/age)`);
check('AI teams extended players mid-season', extended.length >= 30, `${extended.length}`);
const extQuality = aiPlayers.filter((p) => p.extension && overall(p) >= 70).length;
const flaggedQuality = flagged.filter((p) => overall(p) >= 70).length;
check('quality players mostly extended', extQuality >= flaggedQuality * 2, `${extQuality} extended vs ${flaggedQuality} passed on`);
check('no user player auto-extended', user.roster.every((p) => !p.extension && !p.extTalksFailed));
check('extension news appeared', league.news.some((n) => n.text.includes('extension')));

// --- user offer flow mid-season ---
const target = user.roster.find((p) =>
  extensionEligible(p) && overall(p) >= 55 && extensionDemand(league, 'BOS', p, 3) !== null);
if (!target) {
  console.log('NOTE: no negotiable expiring player on user roster this seed; skipping offer-flow checks');
} else {
  const demand = extensionDemand(league, 'BOS', target, 3);
  console.log(`target: ${target.name} (ovr ${overall(target)}), asking ${M(askingPrice(target))}, demand(3yr) ${M(demand)}`);

  const low = offerExtension(league, 'BOS', target.id, demand * 0.5, 3);
  check('lowball rejected', low.ok && low.decision === 'reject', low.reason);
  const repeat = offerExtension(league, 'BOS', target.id, demand * 0.5, 3);
  check('equal offer refused outright (better-offer rule)', repeat.ok === false, repeat.error);
  const near = offerExtension(league, 'BOS', target.id, demand * 0.9, 3);
  check('near-miss draws a counter', near.ok && near.decision === 'counter' && near.counter, near.reason);
  if (near.counter) {
    const acc = offerExtension(league, 'BOS', target.id, near.counter.salary, near.counter.years);
    check('accepting the counter signs the extension', acc.ok && acc.decision === 'accept', acc.reason);
    check('extension stored on player', !!target.extension && target.extension.salary >= near.counter.salary);
  }
  const again = offerExtension(league, 'BOS', target.id, demand, 3);
  check('extended player cannot be extended again', again.ok === false, again.error);
}

// --- offseason rollover ---
const snapshot = league.teams.flatMap((t) => t.roster)
  .filter((p) => p.extension && p.contract.years === 1)
  .map((p) => ({ id: p.id, salary: p.extension.salary, years: p.extension.years }));
while (league.phase === 'regular') simDay(league);
while (league.phase === 'playoffs') simPlayoffRound(league);
advanceOffseason(league);

const everyone = new Map(league.teams.flatMap((t) => t.roster).map((p) => [p.id, p]));
let rolled = 0, gone = 0, wrong = 0;
for (const s of snapshot) {
  const p = everyone.get(s.id);
  if (!p) {
    // a player can be waived or retire before an extension activates — it
    // simply never kicks in, which isn't a rollover failure
    const fa = league.freeAgents.find((x) => x.id === s.id);
    if (!fa || !fa.contract) { gone++; continue; }
    wrong++;
    continue;
  }
  if (p.contract && p.contract.salary === s.salary && p.contract.years === s.years && !p.extension) rolled++;
  else wrong++;
}
check('every extension rolled into the new contract (or voided by waiver/retirement)', wrong === 0, `${rolled}/${snapshot.length} rolled, ${gone} voided`);
const flaggedLeft = league.teams.flatMap((t) => t.roster).filter((p) => p.extTalksFailed).length;
check('extTalksFailed flags cleared in offseason', flaggedLeft === 0, `${flaggedLeft} remain`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
