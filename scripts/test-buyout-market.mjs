// Headless checks for the post-trade-deadline buyout market: waiving a vet
// after the deadline tags him as buyout-eligible, signMidSeasonFA accepts
// him regardless of rating, and AI contenders/rebuilders act on it over the
// rest of the season. Run with: node scripts/test-buyout-market.mjs [seed]
import {
  createLeague, simDay, getTeam, releasePlayer, signMidSeasonFA, buyoutEligible,
  proratedMinSalary, TRADE_DEADLINE_DAY,
} from '../src/engine/league.js';
import { simCupGame, cupComplete } from '../src/engine/cup.js';
import { maybeAiBuyoutRelease } from '../src/engine/strategy.js';
import { overall, generatePlayer } from '../src/engine/players.js';
import { ROSTER_MIN, ROSTER_MAX } from '../src/data/teams.js';

const seed = Number(process.argv[2]) || 42;
const league = createLeague('BOS', seed);
const user = getTeam(league, 'BOS');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// pre-deadline waive: plain cut, not a buyout
const before = league.dayIndex;
check('pre-deadline', league.dayIndex <= TRADE_DEADLINE_DAY, `day ${league.dayIndex}`);
const earlyCut = user.roster[user.roster.length - 1];
releasePlayer(league, 'BOS', earlyCut.id);
check('pre-deadline waive is not tagged as a buyout', !buyoutEligible(earlyCut), `waivedDuringSeason=${earlyCut.waivedDuringSeason}`);

// sim past the trade deadline
while (league.dayIndex <= TRADE_DEADLINE_DAY) simDay(league);
check('past the trade deadline', league.dayIndex > TRADE_DEADLINE_DAY, `day ${league.dayIndex}`);

// post-deadline waive of a good player: tagged as a buyout, signable for the
// minimum despite being well above the 68-OVR fringe cutoff
const star = generatePlayer(() => 0.5, { base: 80, age: 30 });
star.contract = { salary: 8_000_000, years: 1 };
user.roster.push(star);
releasePlayer(league, 'BOS', star.id);
check('post-deadline waive is tagged as a buyout', buyoutEligible(star), `waivedDuringSeason=${star.waivedDuringSeason}`);
check('buyout news mentions the agreement', league.news.some((n) => n.text.includes('agree to a buyout')));

const prorated = proratedMinSalary(league);
const res = signMidSeasonFA(league, 'BOS', star.id);
check('a high-OVR buyout vet can be signed for the minimum', res.ok === true && overall(star) >= 68, res.error || '');
check('buyout signing is a 1-year prorated minimum', star.contract?.years === 1 && star.contract?.salary === prorated, `${((star.contract?.salary ?? 0) / 1e6).toFixed(2)}M`);
check('buyout signing reported in the news', league.news.some((n) => n.text.includes('bought-out') && n.text.includes(star.name)));

// plant a disgruntled star on a rebuilding team and call the AI release pass
// directly with a forced rng so the probabilistic gate always opens — this
// isolates the release logic from the daily morale-rescind dynamics that'd
// otherwise make a full-season run flaky
const rebuilder = league.teams.find((t) => t.id !== 'BOS' && t.strategy === 'rebuilding');
check('found a rebuilding AI team', !!rebuilder);
if (rebuilder) {
  const demandStar = generatePlayer(() => 0.5, { base: 78, age: 29 });
  demandStar.contract = { salary: 12_000_000, years: 1 };
  demandStar.tradeDemand = true;
  demandStar.tradeDemandTeam = rebuilder.id;
  if (rebuilder.roster.length >= ROSTER_MAX) rebuilder.roster.pop(); // make room without exceeding the cap
  rebuilder.roster.push(demandStar);

  maybeAiBuyoutRelease(league, () => 0); // always clears the 0.03 probability gate
  const stillThere = rebuilder.roster.some((p) => p.id === demandStar.id);
  check('disgruntled star on a rebuilding team gets bought out post-deadline', !stillThere, `stillOnRoster=${stillThere}`);
  check('the release clears his trade demand', demandStar.tradeDemand === false);
  check('the release tags him as buyout-eligible', buyoutEligible(demandStar));
}

// sim the rest of the season — pure regression check that nothing here
// pushes a roster out of bounds
while (league.phase === 'regular') {
  simDay(league);
  check('AI rosters stay within roster bounds', league.teams.every((t) => t.roster.length >= ROSTER_MIN - 1 && t.roster.length <= ROSTER_MAX));
}
if (league.phase === 'cup') {
  let g = 0; while (!cupComplete(league) && g++ < 10) simCupGame(league);
  league.phase = 'regular';
  while (league.phase === 'regular') {
    simDay(league);
    check('AI rosters stay within roster bounds', league.teams.every((t) => t.roster.length >= ROSTER_MIN - 1 && t.roster.length <= ROSTER_MAX));
  }
}

const buyoutNews = league.news.filter((n) => n.text.includes('agree to a buyout') || n.text.includes('bought-out')).length;
console.log(`buyout-related news items this season: ${buyoutNews}`);
check('the buyout market produced at least one signing or release', buyoutNews > 0);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
