// Builds a league state headlessly and writes it as a save file.
//
//   node scripts/build-state.mjs --to games:58 --out /tmp/state.json
//
// The point: simming through the browser is ~1000x slower than simming in
// Node (a 45-day regular season is ~0.2s here, minutes of wall clock in
// headless Chromium, and every injury/milestone modal along the way is one
// more thing for the Playwright driver to trip over). So don't sim in the
// browser. Build the state here, then hand the browser a finished save and
// let it do the one thing only it can do — render.
//
// The output is exactly what the app keeps in localStorage under
// `nba-gm-save`, so `.claude/skills/run-nba-gm/driver.mjs`'s loadState()
// injects it directly and the app opens on that state.
//
// Options:
//   --team ID      user team (default LAL). Kept as the user team, unlike
//                  the all-AI regression scripts, so UI screens have a
//                  "my team" to render.
//   --seed N       rng seed (default 20260611); a seed+target is reproducible
//   --to TARGET    how far to sim (default games:58):
//                    days:N      N regular-season days
//                    games:N     until the games-played leader reaches N
//                    phase:NAME  until league.phase === NAME, e.g.
//                                cup, play-in, playoffs, offseason/draft,
//                                offseason/freeagency
//                    seasons:N   N complete league years, stopping at the
//                                start of the next regular season
//   --out FILE     where to write (default /tmp/nba-gm-state.json)
//   --quiet        suppress the summary line
//
// The phase walk below mirrors scripts/test-suite.mjs — same engine calls,
// same forced gates (awards -> play-in, cup -> regular) that the UI would
// otherwise present as a screen the user clicks through.

import { writeFileSync } from 'node:fs';
import {
  createLeague, simDay, simPlayoffGame, simPlayInGame, advanceOffseason,
  simFreeAgencyDay, startNewSeason,
} from '../src/engine/league.js';
import { simCupGame, cupComplete } from '../src/engine/cup.js';
import { simDraftToUser, finishDraft } from '../src/engine/draft.js';
import { initCombinePhase } from '../src/engine/scoutingTrips.js';
import { getNextPlayerId } from '../src/engine/players.js';

// ---- args ----
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const TEAM = arg('team', 'LAL');
const SEED = Number(arg('seed', 20260611));
const TARGET = arg('to', 'games:58');
const OUT = arg('out', '/tmp/nba-gm-state.json');
const QUIET = argv.includes('--quiet');

const [kind, rawValue] = TARGET.split(':');
const value = kind === 'phase' ? rawValue : Number(rawValue);
if (!['days', 'games', 'phase', 'seasons'].includes(kind) || (kind !== 'phase' && !Number.isFinite(value))) {
  console.error(`Bad --to "${TARGET}". Expected days:N, games:N, phase:NAME or seasons:N.`);
  process.exit(2);
}

// ---- helpers ----
const maxGp = (lg) => Math.max(0, ...lg.teams.flatMap((t) => t.roster.map((p) => p.stats?.gp ?? 0)));

// Plays one full league year, from wherever we are up to the next regular
// season. Mirrors test-suite.mjs's sequence.
function playLeagueYear(lg, stopEarly = () => false) {
  let guard = 0;
  while (lg.phase === 'regular' && !stopEarly()) { simDay(lg); if (guard++ > 400) break; }
  if (stopEarly()) return;

  // The mid-season NBA Cup interrupts the regular season — play it, resume.
  if (lg.phase === 'cup') {
    guard = 0;
    while (!cupComplete(lg) && guard++ < 20) simCupGame(lg);
    lg.phase = 'regular';
    guard = 0;
    while (lg.phase === 'regular' && !stopEarly()) { simDay(lg); if (guard++ > 400) break; }
    if (stopEarly()) return;
  }

  if (lg.phase === 'awards') lg.phase = 'play-in'; // skip the ceremony gate
  if (lg.phase === 'play-in') {
    guard = 0;
    while (lg.playIn && !lg.playIn.complete && guard++ < 20) simPlayInGame(lg);
    lg.phase = 'playoffs';
  }
  if (stopEarly()) return;

  guard = 0;
  while (lg.phase === 'playoffs' && guard++ < 500) simPlayoffGame(lg);
  if (stopEarly()) return;

  // Offseason. advanceOffseason() is a one-shot that does the summer's heavy
  // lifting (archive stats, develop, retire, initDraft) and lands on
  // development — calling it again re-runs the whole thing and bumps the
  // season. The sub-phase chain after that lives in the UI
  // (components/OffseasonHub.jsx), not the engine, so it is mirrored here.
  // Keep the two in step if that component's handlers change.
  // Generous guard: free agency is one simFreeAgencyDay() per pass.
  guard = 0;
  while (lg.phase.startsWith('offseason/') && guard++ < 120) {
    switch (lg.phase) {
      case 'offseason/finals-mvp':   advanceOffseason(lg); break;            // -> development
      case 'offseason/development':  lg.phase = 'offseason/coaching'; break;
      case 'offseason/coaching':     lg.phase = 'offseason/lottery'; break;  // keep the incumbent coach
      case 'offseason/lottery':      initCombinePhase(lg); lg.phase = 'offseason/combine'; break;
      case 'offseason/combine':      lg.phase = 'offseason/draft'; break;
      case 'offseason/draft':
        simDraftToUser(lg); // no user pick pending in a built state — runs it all
        finishDraft(lg);    // -> offseason/freeagency
        lg.nextPlayerId = getNextPlayerId(); // the draft generated players; resync the counter
        break;
      case 'offseason/freeagency': {
        // simFreeAgencyDay skips league.userTeamId — signing is the user's
        // job. Nobody is playing here, so without this the user team bleeds
        // roster spots every offseason (14 -> 9 -> …) until the sim can't
        // field a lineup. Hand that team to the AI for free agency only, so
        // the built state looks like a GM who made conventional moves.
        const uid = lg.userTeamId;
        lg.userTeamId = null;
        simFreeAgencyDay(lg);
        lg.userTeamId = uid;
        break; // -> preview when the FA days run out
      }
      case 'offseason/preview':      startNewSeason(lg); break;              // -> regular
      default:                       return;
    }
    if (stopEarly()) return;
  }
}

// ---- build ----
const league = createLeague(TEAM, SEED, {});

if (kind === 'days') {
  for (let i = 0; i < value && league.phase === 'regular'; i++) simDay(league);
} else if (kind === 'games') {
  playLeagueYear(league, () => maxGp(league) >= value);
} else if (kind === 'phase') {
  // Walk up to a few league years looking for the requested phase.
  for (let y = 0; y < 5 && league.phase !== value; y++) playLeagueYear(league, () => league.phase === value);
} else if (kind === 'seasons') {
  for (let y = 0; y < value; y++) playLeagueYear(league);
}

// The id counter lives in a module-level variable in players.js and is
// restored from league.nextPlayerId on load — see CLAUDE.md.
league.nextPlayerId = getNextPlayerId();

writeFileSync(OUT, JSON.stringify(league));

if (!QUIET) {
  const team = league.teams.find((t) => t.id === league.userTeamId);
  const bytes = JSON.stringify(league).length;
  console.log(
    `${OUT}  team=${team.id} season=${league.season} phase=${league.phase} ` +
    `record=${team.wins}-${team.losses} maxGp=${maxGp(league)} size=${(bytes / 1024 / 1024).toFixed(1)}MB`
  );
}
