// Headless checks for mid-season free agency: minimum-only prorated deals,
// roster-spot and fringe-only restrictions, AI pickups, and immediate
// availability. Run with: node scripts/test-midseason-fa.mjs [seed]
import {
  createLeague, simDay, getTeam, signMidSeasonFA, midSeasonSignable, proratedMinSalary,
} from '../src/engine/league.js';
import { overall, generatePlayer } from '../src/engine/players.js';
import { MIN_SALARY, ROSTER_MAX } from '../src/data/teams.js';

const seed = Number(process.argv[2]) || 42;
const league = createLeague('BOS', seed);
const user = getTeam(league, 'BOS');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// day 0: full proration
check('day-0 prorated minimum equals the full minimum', proratedMinSalary(league) === MIN_SALARY, `${proratedMinSalary(league)}`);

// sim half a season
while (league.dayIndex < 90) simDay(league);

const prorated = proratedMinSalary(league);
check('mid-season minimum is prorated below the full minimum', prorated < MIN_SALARY && prorated > 0, `${(prorated / 1e6).toFixed(2)}M at day ${league.dayIndex}`);

// star refusal (while a roster spot is still open, so the fringe rule —
// not the roster cap — is what rejects him): plant a 68+ player if the
// pool has none
const star = league.freeAgents.find((p) => !midSeasonSignable(p)) ?? (() => {
  const s = generatePlayer(() => 0.5, { base: 80, age: 28 });
  s.contract = null;
  league.freeAgents.unshift(s);
  return s;
})();
const starRes = signMidSeasonFA(league, 'BOS', star.id);
check('non-fringe player refuses a mid-season minimum', starRes.ok === false && overall(star) >= 68 && /holding out/.test(starRes.error), starRes.error);

// user signing (roster starts at 14, so a spot is open)
const target = league.freeAgents.find((p) => midSeasonSignable(p));
const before = user.roster.length;
const res = signMidSeasonFA(league, 'BOS', target.id);
check('user mid-season signing succeeds with an open spot', res.ok === true, res.error);
check('signed player is on the roster immediately', user.roster.some((p) => p.id === target.id) && user.roster.length === before + 1);
check('deal is a 1-year prorated minimum', target.contract.years === 1 && target.contract.salary === prorated, `${(target.contract.salary / 1e6).toFixed(2)}M x ${target.contract.years}yr`);
check('signing was reported in the news', league.news.some((n) => n.text.includes(target.name)));

// next game still sims fine with the new player aboard
const dayBefore = league.dayIndex;
simDay(league);
check('league sims the next day with the new signee', league.dayIndex === dayBefore + 1);

// roster-full rejection
while (user.roster.length < ROSTER_MAX) {
  const next = league.freeAgents.find((p) => midSeasonSignable(p));
  if (!signMidSeasonFA(league, 'BOS', next.id).ok) break;
}
const fullRes = signMidSeasonFA(league, 'BOS', league.freeAgents.find((p) => midSeasonSignable(p)).id);
check('signing refused at 15 players', user.roster.length === ROSTER_MAX && fullRes.ok === false, fullRes.error);

// wrong phase rejection + AI activity across a full season
while (league.phase === 'regular') simDay(league);
const offRes = signMidSeasonFA(league, 'BOS', league.freeAgents[0]?.id);
check('signing refused outside the regular season', offRes.ok === false, offRes.error);

const aiSignings = league.news.filter((n) => n.text.includes('rest-of-season minimum')).length;
console.log(`rest-of-season signings reported in news this season: ${aiSignings}`);
check('AI teams made mid-season signings', aiSignings > user.roster.length - before, `${aiSignings} total (user made ${user.roster.length - before})`);
check('AI rosters never exceeded 15', league.teams.every((t) => t.roster.length <= ROSTER_MAX));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
