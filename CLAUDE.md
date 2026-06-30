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
`sim-talent-pipeline.mjs` (long-run age/talent drift over 10 seasons).

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
    and play-by-play event generation.
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
  - `colorUtils.js` — WCAG contrast-safety helpers for team-color UI.
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
function in `league.js` or `draft.js` (`advanceOffseason` walks the
`offseason/*` sub-phases in order and calls `initDraft`; `finishDraft` opens
`offseason/freeagency`). RNG for each sim step is derived from `league.seed`
plus phase-specific offsets, so a league is reproducible from its seed.

## Notes

- `BACKLOG.md` is the live running list of quality-of-life ideas, known
  rough edges, and unscheduled feature ideas by area — check it for context
  before starting open-ended "what should I work on" tasks, and remove an
  item from it once implemented (delete, don't mark done — git history
  keeps the record).
- `README.md` is player-facing (how to play), not a roadmap.
