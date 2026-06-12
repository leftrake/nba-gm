// Talent-pipeline sanity check: sims 10 full seasons headless (all-AI) and
// verifies the league doesn't age out — the age distribution stays stable,
// the top 20 players by rating average under 29 years old, and every
// season at least a few of the top 20 are under 25.
//
// Run: node scripts/sim-talent-pipeline.mjs [seed]

import { TEAMS } from '../src/data/teams.js';
import { createLeague, simDay, simPlayoffRound, advanceOffseason, simFreeAgencyDay, getTeam } from '../src/engine/league.js';
import { simDraftToUser, finishDraft } from '../src/engine/draft.js';
import { overall } from '../src/engine/players.js';

const SEASONS = 10;
const seed = Number(process.argv[2]) || 20260611;

const league = createLeague(TEAMS[0].id, seed);
// Headless: no human team — every front office runs on AI logic.
delete getTeam(league, league.userTeamId).lineup;
league.userTeamId = '__sim__';

const failures = [];
const rows = [];
let firstAvgAge = null;

function measure() {
  const players = league.teams.flatMap((t) => t.roster);
  const avgAge = players.reduce((s, p) => s + p.age, 0) / players.length;
  const top20 = players
    .map((p) => ({ p, ovr: overall(p) }))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 20);
  const topAvgAge = top20.reduce((s, x) => s + x.p.age, 0) / top20.length;
  const topUnder25 = top20.filter((x) => x.p.age < 25).length;
  const buckets = [0, 0, 0, 0, 0]; // <23, 23–26, 27–30, 31–34, 35+
  for (const p of players) {
    buckets[p.age < 23 ? 0 : p.age < 27 ? 1 : p.age < 31 ? 2 : p.age < 35 ? 3 : 4]++;
  }
  const minRoster = Math.min(...league.teams.map((t) => t.roster.length));
  const best = top20[0];
  return { players: players.length, avgAge, topAvgAge, topUnder25, buckets, minRoster, best: `${best.p.name} ${best.ovr} ovr, age ${best.p.age}` };
}

for (let s = 0; s < SEASONS; s++) {
  let guard = 0;
  while (league.phase === 'regular' && guard++ < 400) simDay(league);

  const season = league.season;
  const m = measure(); // end of regular season, before offseason aging
  rows.push({ season, ...m });
  if (firstAvgAge === null) firstAvgAge = m.avgAge;

  if (m.topAvgAge >= 29) failures.push(`${season}: top-20 average age ${m.topAvgAge.toFixed(1)} (must stay under 29)`);
  if (m.topUnder25 < 2) failures.push(`${season}: only ${m.topUnder25} of the top 20 are under 25 (need at least 2)`);
  if (m.avgAge < 24 || m.avgAge > 29) failures.push(`${season}: league average age ${m.avgAge.toFixed(1)} outside [24, 29]`);
  if (Math.abs(m.avgAge - firstAvgAge) > 2) failures.push(`${season}: league average age drifted ${(m.avgAge - firstAvgAge).toFixed(1)} years from season 1 (limit ±2)`);
  if (m.minRoster < 10) failures.push(`${season}: a team finished the season with only ${m.minRoster} players`);

  guard = 0;
  while (league.phase === 'playoffs' && guard++ < 30) simPlayoffRound(league);
  advanceOffseason(league);
  simDraftToUser(league); // no human team on the clock, so this runs the whole draft
  finishDraft(league);
  guard = 0;
  while (league.phase === 'freeagency' && guard++ < 30) simFreeAgencyDay(league);
  if (league.phase !== 'regular') { failures.push(`${season}: stuck in phase '${league.phase}'`); break; }
}

console.log(`seed ${seed} — measured at the end of each regular season\n`);
console.log('season  players  avgAge  top20avg  top20<25  minRoster  <23 / 23-26 / 27-30 / 31-34 / 35+   best player');
for (const r of rows) {
  console.log(
    `${String(r.season).padEnd(8)}${String(r.players).padEnd(9)}${r.avgAge.toFixed(1).padEnd(8)}` +
    `${r.topAvgAge.toFixed(1).padEnd(10)}${String(r.topUnder25).padEnd(10)}${String(r.minRoster).padEnd(11)}` +
    `${r.buckets.map((b) => String(b).padStart(3)).join(' / ')}    ${r.best}`
  );
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nPASS: age distribution stable, top-20 stays young, new stars keep arriving.');
