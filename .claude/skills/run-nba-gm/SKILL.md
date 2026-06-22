---
name: run-nba-gm
description: Start the dev server and drive the NBA GM SPA in headless Chromium to verify a UI change — pick a team, sim games, navigate screens, screenshot. Use when asked to run the app, take a screenshot, or verify a UI/frontend change actually renders.
---

Drives the app via a small Playwright script in this directory (`driver.mjs`) — there's no `chromium-cli` in this environment, so this is the harness. All paths below are relative to this directory.

## Prerequisites

Node (already required by the main project). No system packages needed. Playwright's Chromium binary may already be cached at `~/Library/Caches/ms-playwright` (macOS) or `~/.cache/ms-playwright` (Linux) — if not, `npx playwright install chromium` once.

## Setup

One-time per machine — installs this driver's own `playwright` dependency, isolated from the main project's `package.json` (this repo intentionally has no test framework configured — see root `CLAUDE.md`):

```bash
cd .claude/skills/run-nba-gm
npm install
```

## Run (agent path)

Start the app's dev server from the repo root first:

```bash
npm run dev > /tmp/nba-gm-dev.log 2>&1 &
until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
```

Then drive it:

```bash
cd .claude/skills/run-nba-gm
node driver.mjs [TeamNameRegex] [weeksToSim]
# e.g. node driver.mjs Celtics 3
```

This starts a new game, skips the onboarding walkthrough, sims N weeks (default 2), then visits Dashboard → Roster → Roster's Stats tab → a player card, screenshotting each stop. Exits non-zero and prints any browser console errors it saw along the way.

Screenshots → `/tmp/nba-gm-shots/01-dashboard.png`, `02-after-sim.png`, `03-roster.png`, `04-playercard.png` (override the directory with `NBA_GM_SHOTS=...`).

For anything beyond this one path — a different screen, a specific interaction — import the helpers instead of re-deriving them:

```js
import { chromium } from 'playwright';
import { startNewGame, simWeeks, gotoNav, gotoTab } from './driver.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
await startNewGame(page);          // team-picker -> Start -> skip tutorial
await simWeeks(page, 1);
await gotoNav(page, 'Standings');  // sidebar screens
await gotoTab(page, 'Team Stats'); // in-page tab bars (Stats screen, Roster, etc.)
await page.screenshot({ path: '/tmp/whatever.png' });
await browser.close();
```

Stop the dev server when done: `pkill -f vite`.

## Test

No automated assertions here by design — this is a visual/console-error smoke driver, not a test suite. Look at the screenshots and check the script's exit code / printed console errors. For actual regression testing of game logic, use the repo's headless sim scripts instead (`npm test`, `npm run test:stats`, etc. — see root `CLAUDE.md`).

## Gotchas

- **Modals block every click mid-sim.** Tutorial walkthrough, coach-talk, milestone alert, call-up prompt, and injury alert modals all pop up unpredictably while simming. None share a CSS class, so `dismissOverlay()` falls back to clicking the modal's *last* button when no known label matches — that's deliberately the no-op/secondary choice in every alert modal in `src/components/shared.jsx`.
- **"Sim Week" disables mid-animation**, taking roughly 1-2s of real time per week; `simWeeks()` polls `isEnabled()` rather than a fixed sleep, since the wait varies with how many alerts fire that week.
- **Same label, two different elements.** The sidebar nav and an in-page tab bar (e.g. Roster) can both have a button named "Stats" — Roster's tabs are plain `button.ui-tab` elements (not the shared `<Tabs>` component's `.ui-tabs` wrapper), so locators must be scoped accordingly (`gotoNav` vs `gotoTab`).
- **`chromium-cli` isn't installed in this environment** — that's why this skill carries its own Playwright driver instead of the usual recipe.
