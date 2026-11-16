# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-player NBA franchise-management game (React 18 + Vite SPA). 30 real NBA teams with generated fictional players; the user GMs one team across multiple seasons. No backend — the entire game state lives in the browser.

## Commands

```
npm run dev          # start dev server (http://localhost:5173)
npm run build        # production build to dist/
npm run preview      # serve the production build
npm test             # consolidated sanity suite: sims 4 seasons headless and
                     # checks economy, demographics, stats, minutes, injuries,
                     # morale, draft picks, free agency, and backstories
                     # (scripts/test-suite.mjs [seasons] [seed])
npm run test:stats   # focused stats check: sims 5 seasons headless, verifies
                     # league stat distributions plus an in-game fatigue
                     # experiment (scripts/stats-sanity.mjs [seasons] [seed])
```

There is no unit-test framework and no linter configured. These two headless
sim scripts are the regression checks — run them after touching `sim.js`,
player development/aging/stamina in `players.js`, draft-class generation,
rotation logic in `lineup.js`, or roster generation: the league's stat
distributions are an equilibrium of all of those.

Skip `npm test` / `npm run test:stats` for UI-only changes, display logic,
new screens, and cosmetic updates — only run them when a change touches
`src/engine/` (sim, player generation, ratings, development, salaries,
fatigue).

`scripts/` also has a few targeted, non-npm-wired headless checks for
specific systems — run the relevant one directly with `node` when touching
that area: `test-extensions.mjs` (contract extensions), `test-midseason-fa.mjs`
(in-season free agency), `verify-economy.mjs` (payroll equilibrium),
`sim-talent-pipeline.mjs` (long-run age/talent drift over 10 seasons),
`test-buyout-market.mjs` (buyout market).

`scripts/build-state.mjs` is not a check but a state builder: it sims a
league headlessly to any point (`--to days:N | games:N | phase:NAME |
seasons:N`) and writes the result as a save file. Use it instead of simming
through the UI — a state that takes minutes to reach in headless Chromium
builds here in well under a second, and
`.claude/skills/run-nba-gm/driver.mjs`'s `loadState()` injects the result so
the app opens directly on it.

These regression scripts are written for the current equilibrium, not
infallible ground truth — a failure can mean either a real bug or a test
band that's calibrated a little tight for a rare-but-legitimate outcome
(e.g. an emergent elite player, or a team's strategy label flipping faster
than its existing contracts can unwind). Reproduce across a few seeds before
concluding which it is; don't assume the check is always right just because
it's red.

## Architecture

The hard split is **engine vs. UI**:

- `src/engine/` — pure game logic, no React imports, organized as flat modules
  rather than one monolith (besides the hub itself):
  - `league.js` — the hub. Owns the league object shape, the season loop
    (`simDay`, `simPlayoffGame`, `advanceOffseason`, `simFreeAgencyDay`,
    `startNewSeason`), free-agency signings, AI extension offers, and
    cap-projection helpers (`projectedPayroll`, `projectedPayrollLimit`).
  - `players.js` — player generation, `overall()`, development curve, salary
    formulas, and the global player-ID counter.
  - `sim.js` — single-game simulation (possession-by-possession), box scores,
    and play-by-play event generation. Each play carries both the display
    text and a structured form of it, flat on the play object, enough to
    render the game rather than only read it:
    - `k` — kind: shot / ft / reb / tov / stl / blk / foul
    - `p` — actor player id. Use ids, never names: names are not unique.
    - `n` — possession number, so plays group into possessions
    - `sec` — seconds left in the period, fractional. Strictly decreasing
      and unique per play, unlike the displayed `t`, where every play in a
      possession shares the possession's midpoint.
    - shots add `z` (zone), `x`/`y` (court feet, origin at the rim —
      `zoneCoords` in `shotZones.js`), `m` (made), `pts`, `a` (assister),
      `d` (the defender who contested — see below)
    - `o` on rebounds (offensive), `v` on fouls/blocks (the player fouled
      or blocked)
    - `sf` on shooting fouls (and-ones included). A fouled miss is never a
      shot play — it isn't an FGA — so its foul carries the attempt's `z`
      and `x`/`y` instead.

    `simGame` also returns `lineups`: the five a side, logged at each stint
    boundary (`min` = minutes credited) and again whenever
    `replaceFouledOut` changes it (`sub: 1`, no minutes), so it is exact at
    every play rather than approximate (~18 entries per game).

    `d` is attribution, not causation: the make probability uses the
    defense's *team* interior/perimeter averages, never one man's rating,
    so `pickDefender` names the most plausible defender for display rather
    than the number the sim used. When a defender does act on the shot, `d`
    is him: the blocker on a blocked shot, the fouler on an and-one.

    Team fouls in the play text (the T in `FOUL (P2.T4)`) are real: from a
    period's 5th team foul (4th in overtime) a common foul is shot, and
    before that a trip to the line is a shooting foul. Offensive fouls are
    personal fouls but not team ones, and are logged as turnovers (`f`).

    Highlight events (`events`) are structured the same way: each carries
    `k` — run / clutch / bigq / qend / ot / closing / leadchanges / big /
    tripdbl / injury — plus `n` (the possession) for in-game moments, `per`
    for period ones, and `side` or `p` where it applies. Place them by `n`,
    not by clock: in-game moments are stamped at the end of a possession
    *pair*, so clock placement shows "ties it at 111" after the other team's
    possession — a quarter of clutch banners would show a score that had
    already changed.

    Injury events carry a real clock. They're rolled after the game, from
    the finished box score, and the box line is left whole — so
    `injuryMoment` places the injury at the player's last appearance in the
    feed, the only moment consistent with everything he did. (It used to
    scale the box line down instead, which left his later plays in the feed
    and his points in the team score: box scores stopped adding up to the
    final.) Making him actually leave early means rolling inside the
    possession loop, which changes the RNG stream.

    Event, coordinate and lineup generation must never read the game RNG,
    so that adding to them can't perturb seeded sim results — see the note
    above `addPlay`. Verify by diffing seeded output before and after any
    change: pass an explicit rng (`simGame`'s default is `makeRng()`, which
    seeds from `Date.now()` and is not reproducible).
  - `lineup.js` — rotation/minutes assignment (`autoLineup`, an optimal
    bitmask DP) and lineup-quality warnings.
  - `trade.js` / `tradeOffers.js` — trade value, cap validation, AI
    accept/reject for user-initiated trades, and AI-to-user incoming offers.
  - `strategy.js` — per-team `contending`/`retooling`/`rebuilding` strategy
    assignment, and the AI-to-AI trade and salary-dump behaviors that lean on
    it.
  - `draft.js` / `draftPicks.js` / `fantasyDraft.js` — rookie draft class
    generation and draft-day logic, tradeable future picks (Stepien rule),
    and the alternate fantasy-draft game-start mode.
  - `extensions.js` — the three contract-extension windows (rookie, veteran,
    final-year), modeled on real NBA rules.
  - `scouting.js` / `scoutingTrips.js` — the human player's hidden-rating fog
    and the scouting-trip system that narrows it (AI always sees true OVR).
  - `injuries.js` — injury generation, severity tiers, recovery.
  - `morale.js` — per-player morale, trade demands, front-office turmoil.
  - `owner.js` — generated ownership personality, approval rating, season
    budget, and directives/interference events for the user team.
  - `coach.js` — generated head coaches and their effect on team math.
  - `allstar.js` — All-Star Weekend (voting, reserves, exhibition game).
  - `awards.js` — end-of-season league leaders and awards.
  - `legacy.js` — all-time record book, Hall of Fame, dynasties, cross-save
    GM legacy tracking.
  - `backstory.js` / `devTraits.js` — hidden player narratives (gems, busts)
    and potential-tier traits that bias development and asking price.
  - `capProjection.js` — pure multi-season payroll-projection helpers for the
    Cap/Future Payroll screen (distinct from `league.js`'s own
    `projectedPayroll`, which is the one-season-out version AI decisions use).
  - `names.js` — per-nationality name pools for player generation.
  - `courtPositions.js` — plausible floor positions for all ten players
    (offensive spacing, defensive shading, clearing space around the ball,
    where a miss comes down) in `shotZones.js`'s half-court coordinate
    space. Unlike everything else in `src/engine/`, this is **not
    simulated**: the sim never models off-ball movement, so these are
    invented for rendering. Nothing in it feeds a rating, probability or
    box score, and nothing in the sim reads it.
  - `colorUtils.js` — WCAG contrast-safety helpers for team-color UI, plus
    `courtKit` (home in white, away in color) for the live court, since
    team colors alone collide.
  - `save.js` — save-file version stamping and localStorage size guards.
  - `stats.js` — shared per-game/shooting-percentage math for stat displays.
  - `rng.js` — seeded mulberry32 RNG.
- `src/components/` — React screens, one per nav tab, switched by `App.jsx`.
  `src/components/ui/` is a small shared design-system layer (`Card`,
  `Button`, `Badge`, `Table`, `Modal`, etc. — see `StyleGuide.jsx` for a live
  catalog); prefer composing from there over ad hoc markup for new screens.
  Several shared helper modules live alongside the screens:
  - `PlayerDisplay.jsx` — player rating/status display components (`Ovr`, `Pot`,
    `Sta`, `Origin`, `Cond`, `Morale`, `InjuryTag`, `OvrArc`, `PlayerLink`).
  - `TeamDisplay.jsx` — team display components (`TeamBadge`, `TeamLink`,
    `StrategyTag`, `ApprovalMeter`, `Confetti`, `NewsText`, `turmoilLabel/Color`,
    `approvalColor`).
  - `GameAlerts.jsx` — the four blocking interrupt modals (`InjuryAlertModal`,
    `CoachTalkModal`, `MilestoneAlertModal`, `CallUpPromptModal`).
  - `formatters.js` — pure display-formatting utilities (`money`, `fmtDate`,
    `fmtPerGame`, `fmtFgPct`, color/label helpers). Distinct from
    `engine/stats.js`, which exports the same-named numeric computation
    versions (`perGame`, `fgPct`).
  - `liveFrames.js` — turns a game's play-by-play into the live viewer's
    frames: who's on the floor and where, who has the ball, its route each
    play, in full-court coordinates (teams switch ends at halftime), with
    the defender in each play switched onto the man he's contesting,
    blocking or fouling. Also places the sim's highlights on the plays they
    belong to, finds the period breaks, keeps team fouls, and builds the
    pre-game numbers with tonight taken back out (a watched game is already
    simmed into the league, so live records and averages would spoil it).
    `liveBox` rebuilds every box-score column from the plays — +/- from the
    frames, minutes from the lineups, credited the box score's way (a
    stint's minutes go to the five who started it) — so at the final
    whistle it equals the real box line for line. Plain JS rather than JSX
    so headless checks import the code the viewer actually runs;
    `LiveGame.jsx`, `ArenaCourt.jsx` (name tags included) and `LiveCards.jsx`
    (tip-off, break and final cards, highlight banners) render it, and the
    live box is `BoxScore.jsx`'s own `BoxTable` in its `live` mode.
  - `watchGame.js` — turns a game the app already has into what the viewer
    needs: whether it can be watched at all (structured plays and lineups),
    box lines decoded, and for a replay each side's roster as it took the
    floor that night (from the box score, wherever those players are now).
    Also the viewer's `ctx` for each kind of game — playoffs show the series
    instead of a record; a play-in game counts in the standings but not in
    stats; a Cup knockout counts in neither; the All-Star Game and replays
    show no record — since the pre-game card has to take tonight back out
    of only what tonight was put into. Every Watch follows the regular
    season's pattern: sim, open the viewer, and commit only when it closes.
    `simPlayInGame`, `simCupGame` and `simAllStarGame` hand back each game's
    full result as `full` for this; none of it goes into the save.

    `LiveGame.jsx`'s playback loop runs for as long as the viewer is open
    and follows one position (`posRef`), so the timeline, period jumps,
    Next basket, instant replay and rewinding from the final all just move
    that position and play carries on from it. Its waits count playing
    time only, so a pause freezes the game mid-play.
  - `livePrefs.js` — how the user likes to watch: starting speed, condensed
    games, pausing at breaks, sound, auto-watch (a sim never runs past one
    of the user's games), reduce motion. A browser preference under its own
    localStorage key, like the theme — not part of the save. `motionReduced()`
    is the check for motion driven from JS (the ball's flight); CSS honors
    the system setting and the `.reduce-motion` class on `<html>` itself.
  - `liveSound.js` — the viewer's sounds, synthesized with Web Audio (no
    audio files), off unless the user turns them on.
  - `onboarding.jsx` — walkthrough + first-encounter tooltip system
    (`GuideTooltip`, `isWalkthroughDone`, `resetTutorial`, etc.).
- `src/theme.js` — dark color themes + optional custom accent, stored as
  separate localStorage keys (a browser preference, not part of the save)
  and applied as CSS variables.
- `src/data/teams.js` — the 30 teams plus cap constants (`SALARY_CAP`,
  `MIN_SALARY`, roster limits). Engine code imports cap numbers from here
  rather than hardcoding them.

### State model — mutate then commit

Engine functions **mutate the league object in place**. `App.jsx` holds the league in React state and passes a `commit()` callback down to components; after calling engine functions, components call `commit()`, which shallow-copies the top-level league object to force a re-render and trigger the localStorage save effect. New engine features should follow this pattern (mutate, return any per-call results, let the caller commit) rather than returning new immutable state.

### Persistence constraint

The whole league object is serialized to localStorage (`nba-gm-save` key) via `JSON.stringify` and restored with `JSON.parse` on load. Anything added to league/team/player state must be JSON-serializable — no class instances, functions, Maps/Sets, or Dates.

Player IDs are assigned by a module-level counter in `players.js` (`nextPlayerId`) that **does not survive page reloads**. The counter is persisted as `league.nextPlayerId` and restored by `backfillPlayers` (`league.js`) on save load. Rules:

- Never call `resetPlayerIds()` with a hardcoded value or `1`. It must only be called from `backfillPlayers` (on load) and from draft initialization (`initDraft` in `draft.js`, `initFantasyDraft` in `fantasyDraft.js`) using `league.nextPlayerId`.
- Any code that calls `generatePlayer` in a batch must call `league.nextPlayerId = getNextPlayerId()` afterward so the counter stays in sync.
- This ensures every player generated across all seasons gets a globally unique ID and retired player snapshots are never shadowed by a live player with a colliding ID.

### Game flow

`league.phase` is a state machine with namespaced offseason sub-phases (each
is a distinct screen in `App.jsx`, not just a label):

```
regular → playoffs → awards
  → offseason/finals-mvp → offseason/development → offseason/coaching
  → offseason/lottery → offseason/draft → offseason/freeagency
  → offseason/preview → regular (next season)
```

There's also a standalone `fantasydraft` phase for the alternate
fantasy-draft game-start mode (a 15-round snake draft pooling every player
league-wide before the season ever begins), entered instead of the normal
flow at new-game creation.

Each phase has its own sim/advance button in `App.jsx` and its own advance
function in `league.js` or `draft.js`. Note that `advanceOffseason` is a
one-shot, not a walker: called from `offseason/finals-mvp` it does the whole
summer (archive stats, develop, retire, `initDraft`), bumps `league.season`
and lands on `offseason/development` — calling it again re-runs all of that
and advances another year. The chain from there
(`development → coaching → lottery → combine → draft`) lives in
`components/OffseasonHub.jsx`, not the engine, so anything driving the
offseason headlessly has to mirror that component (as
`scripts/build-state.mjs` does). `finishDraft` opens `offseason/freeagency`.
RNG for each sim step is derived from `league.seed` plus phase-specific
offsets, so a league is reproducible from its seed.

## Notes

- `BACKLOG.md` is the live running list of quality-of-life ideas, known
  rough edges, and unscheduled feature ideas by area — check it for context
  before starting open-ended "what should I work on" tasks, and remove an
  item from it once implemented (delete, don't mark done — git history
  keeps the record).
- `README.md` is player-facing (how to play), not a roadmap.
