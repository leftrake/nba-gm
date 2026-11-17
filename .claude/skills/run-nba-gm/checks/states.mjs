// Every league state the live-viewer checks start from, built fresh with
// scripts/build-state.mjs into a directory the caller owns (nothing here
// relies on a file surviving in /tmp).
//
// build-state stops where it's told and no further, so a few states need a
// nudge in the JSON afterwards:
//   - it can't stop *in* the play-in (the awards gate is skipped in one
//     step), so that one is built to `awards` and set to 'play-in' here;
//   - the user's team only plays in a bracket it made, so for the playoffs,
//     play-in and Cup the user's team is switched to one that did. (The app
//     backfills an owner for a user team that lacks one on load.)

import { buildState, writeState } from './harness.mjs';

const teamPlays = (lg, day, id) => (lg.schedule[day] ?? []).some((g) => g.home === id || g.away === id);

// The first of `candidates` (build-state --to targets) whose state passes
// `ok`, or an error saying none did.
async function firstThat(dir, name, candidates, ok, why) {
  for (const to of candidates) {
    const s = await buildState(dir, name, to);
    if (ok(s.league)) return { ...s, to };
  }
  throw new Error(`state "${name}": none of ${candidates.join(', ')} gave ${why}`);
}

export async function buildStates(dir) {
  const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `days:${from + i}`);
  const [regular, offday, month, playoffs, awards, cup, allstar] = await Promise.all([
    // Most browser checks: a regular-season day the user's team plays, with
    // its last couple of games still carrying play-by-play (for replays).
    firstThat(dir, 'regular', days(20, 30), (lg) => teamPlays(lg, lg.dayIndex, lg.userTeamId), 'a game for the user today'),
    // Auto-watch: no game today, one tomorrow — so a sim has a day to run
    // before it has to stop.
    firstThat(dir, 'offday', days(20, 34),
      (lg) => !teamPlays(lg, lg.dayIndex, lg.userTeamId) && teamPlays(lg, lg.dayIndex + 1, lg.userTeamId),
      'an off day for the user followed by a game'),
    // The headless month starts a few days in, so records and averages are
    // already something to take tonight back out of.
    buildState(dir, 'month', 'days:5'),
    buildState(dir, 'playoffs', 'phase:playoffs'),
    buildState(dir, 'awards', 'phase:awards'),
    buildState(dir, 'cup', 'phase:cup'),
    // All-Star rosters are named on day 116, and the game waits for the user.
    firstThat(dir, 'allstar', ['games:57', 'games:58', 'games:60'],
      (lg) => lg.phase === 'regular' && lg.allStar?.season === lg.season && !lg.allStar.game && lg.allStar.rosters,
      'an unplayed All-Star Game'),
  ]);

  // Playoffs: the user's team is the East's top seed, in its first-round series.
  {
    const lg = playoffs.league;
    lg.userTeamId = lg.playoffs.East[0].high;
    writeState(playoffs.file, lg);
  }

  // Play-in: stop in it, with the user's team hosting the East's 7-vs-8 game.
  const playin = { file: awards.file.replace(/awards\.json$/, 'playin.json'), league: structuredClone(awards.league) };
  {
    const lg = playin.league;
    if (lg.phase !== 'awards' || !lg.playIn) throw new Error(`state "playin": expected awards with a play-in bracket, got ${lg.phase}`);
    lg.phase = 'play-in';
    lg.userTeamId = lg.playIn.East.gameA.home;
    writeState(playin.file, lg);
  }

  // Cup: the user's team in the first East quarterfinal.
  {
    const lg = cup.league;
    if (lg.phase !== 'cup' || !lg.cup?.bracket) throw new Error(`state "cup": expected the Cup knockouts, got ${lg.phase}`);
    lg.userTeamId = lg.cup.bracket.East[0].home;
    writeState(cup.file, lg);
  }

  return { regular, offday, month, playoffs, playin, awards, cup, allstar };
}
