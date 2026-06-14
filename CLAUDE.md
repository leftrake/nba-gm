# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-player NBA franchise-management game (React 18 + Vite SPA). 30 real NBA teams with generated fictional players; the user GMs one team across multiple seasons. No backend — the entire game state lives in the browser.

## Commands

```
npm run dev          # start dev server (http://localhost:5173)
npm run build        # production build to dist/
npm run preview      # serve the production build
npm test             # consolidated sanity suite: sims 3 seasons headless and
                     # checks economy, demographics, stats, and minutes
                     # (scripts/test-suite.mjs [seasons] [seed])
npm run test:stats   # focused stats check: sims 5 seasons headless, verifies
                     # league stat distributions plus an in-game fatigue
                     # experiment (scripts/stats-sanity.mjs)
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

## Architecture

The hard split is **engine vs. UI**:

- `src/engine/` — pure game logic, no React imports. `league.js` is the hub: it owns the league object shape, the season loop (`simDay`, `simPlayoffRound`, `advanceOffseason`, `simFreeAgencyDay`, `startNewSeason`), and free-agency/roster moves. It pulls from `players.js` (generation, `overall()`, development curve, salary formulas), `sim.js` (single-game sim + box scores), `trade.js` (trade value, cap validation, AI accept/reject), and `rng.js` (seeded mulberry32).
- `src/components/` — React screens, one per nav tab, switched by `App.jsx`.
- `src/data/teams.js` — the 30 teams plus cap constants (`SALARY_CAP`, `MIN_SALARY`, roster limits). Engine code imports cap numbers from here rather than hardcoding them.

### State model — mutate then commit

Engine functions **mutate the league object in place**. `App.jsx` holds the league in React state and passes a `commit()` callback down to components; after calling engine functions, components call `commit()`, which shallow-copies the top-level league object to force a re-render and trigger the localStorage save effect. New engine features should follow this pattern (mutate, return any per-call results, let the caller commit) rather than returning new immutable state.

### Persistence constraint

The whole league object is serialized to localStorage (`nba-gm-save` key) via `JSON.stringify` and restored with `JSON.parse` on load. Anything added to league/team/player state must be JSON-serializable — no class instances, functions, Maps/Sets, or Dates. Note that player IDs come from a module-level counter in `players.js` that is *not* restored when a save loads, so don't assume freshly generated IDs are unique against a loaded save.

### Game flow

`league.phase` is a state machine: `regular` → `playoffs` → `offseason` → `draft` → `freeagency` → back to `regular`. Each phase has its own sim button in `App.jsx` and its own advance function in `league.js` (the draft lives in `engine/draft.js`; `advanceOffseason` calls `initDraft`, and `finishDraft` opens free agency). RNG for each sim step is derived from `league.seed` plus phase-specific offsets, so a league is reproducible from its seed.

## Notes

- `README.md` lists v2 ideas (draft, lineups, injuries, extensions, pick trading, box scores) — the intended direction for new features.
- `SETUP-GUIDE.md` is a beginner's Git/GitHub walkthrough for the project owner, not developer docs.
