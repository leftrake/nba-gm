#!/usr/bin/env node
// Drives the NBA GM SPA in headless Chromium for UI smoke-testing.
// See SKILL.md in this directory for setup and the full writeup.
// Talks to whatever dev server is already running at BASE_URL — does not
// start one itself.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE_URL = process.env.NBA_GM_URL || 'http://localhost:5173/nba-gm/';
const SHOT_DIR = process.env.NBA_GM_SHOTS || '/tmp/nba-gm-shots';

// Pre-marks the walkthrough and all known guide tooltips as done in
// localStorage so they never render and can't intercept pointer events.
// Call this once right after page.goto() and again after any navigation
// that might reset state (though in practice one call is enough).
export async function suppressOnboarding(page) {
  await page.evaluate(() => {
    localStorage.setItem('nba-gm-walkthrough-done', 'true');
    // Pre-mark every guide tooltip key the app currently uses so none
    // of the first-encounter popovers fire and block clicks.
    const keys = [
      'two_way', 'dead_money', 'roster_ext', 'cap_bar', 'scouting',
      'trade', 'morale', 'draft', 'free_agency', 'owner', 'coach',
      'allstar', 'awards', 'legacy', 'injuries', 'extensions',
    ];
    const seen = {};
    keys.forEach((k) => { seen[`tt_${k}`] = true; });
    localStorage.setItem('nba-gm-tooltips', JSON.stringify(seen));
  });
}

// Dismisses any overlay that can block clicks: walkthrough card, guide
// tooltip popovers, and the four blocking interrupt modals (injury alert,
// coach-talk, milestone, call-up prompt). Runs up to 10 passes so stacked
// modals all clear.
export async function dismissOverlay(page) {
  for (let i = 0; i < 10; i++) {
    // Walkthrough card ("Skip tour" / "Start Managing")
    const skipTour = page.locator('.walkthrough-skip, button:has-text("Skip tour"), button:has-text("Start Managing")').first();
    if (await skipTour.isVisible().catch(() => false)) {
      await skipTour.click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      continue;
    }

    // Guide tooltip close buttons
    const tooltipClose = page.locator('.guide-tooltip-close').first();
    if (await tooltipClose.isVisible().catch(() => false)) {
      await tooltipClose.click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }

    // Blocking interrupt modals (ui-modal-overlay)
    const overlay = page.locator('.ui-modal-overlay').first();
    if (!(await overlay.isVisible().catch(() => false))) return;
    const known = page.locator(
      'button:has-text("Got It"), button:has-text("Close"), button:has-text("OK"), button:has-text("Nice!"), ' +
      'button:has-text("Dismiss"), button:has-text("Let the coach handle it"), button:has-text("Leave him down"), .ui-modal-close'
    ).first();
    if (await known.isVisible().catch(() => false)) {
      await known.click({ timeout: 2000 }).catch(() => {});
    } else {
      const lastBtn = overlay.locator('button').last();
      if (await lastBtn.count()) await lastBtn.click({ timeout: 2000 }).catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(300);
  }
}

// Lands on the team-picker, starts a new game, and suppresses all
// onboarding so nothing blocks later clicks.
export async function startNewGame(page, teamNameRegex = /Lakers/) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  // Mark walkthrough/tooltips done before clicking Start so the app
  // never mounts them — much more reliable than racing to dismiss them.
  await suppressOnboarding(page);
  await page.getByRole('button', { name: teamNameRegex }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(1000);
  // Suppress again in case React re-read localStorage before our write landed.
  await suppressOnboarding(page);
  await dismissOverlay(page);
}

// Clicks "Sim Week" `n` times from the Dashboard. The button disables
// mid-animation (~1-2s real time per week, longer if an alert modal fires),
// so this polls isEnabled() instead of a fixed sleep.
export async function simWeeks(page, n = 1) {
  for (let i = 0; i < n; i++) {
    await dismissOverlay(page);
    const btn = page.getByRole('button', { name: 'Sim Week' });
    for (let j = 0; j < 15 && !(await btn.isEnabled()); j++) {
      await page.waitForTimeout(600);
      await dismissOverlay(page);
    }
    await btn.click();
    for (let j = 0; j < 15; j++) {
      await page.waitForTimeout(600);
      await dismissOverlay(page);
      if (await btn.isEnabled()) break;
    }
  }
}

// Sidebar nav (top-level screens). Scoped to .app-sidebar because some
// labels (e.g. "Stats") also appear on in-page tab bars — see gotoTab.
export async function gotoNav(page, label) {
  await dismissOverlay(page);
  await page.locator('.app-sidebar button', { hasText: label }).click();
  await page.waitForTimeout(400);
}

// In-page tab bars (Roster, Stats, etc.) render plain `button.ui-tab`
// elements, not the shared <Tabs> component's `.ui-tabs` wrapper.
export async function gotoTab(page, label) {
  await dismissOverlay(page);
  await page.locator('button.ui-tab', { hasText: label }).click();
  await page.waitForTimeout(300);
}

async function main() {
  const team = process.argv[2] || 'Lakers';
  const weeks = Number(process.argv[3] || 2);
  mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await startNewGame(page, new RegExp(team));
  await page.screenshot({ path: `${SHOT_DIR}/01-dashboard.png` });

  await simWeeks(page, weeks);
  await page.screenshot({ path: `${SHOT_DIR}/02-after-sim.png` });

  await gotoNav(page, 'Roster');
  await page.screenshot({ path: `${SHOT_DIR}/03-roster.png` });

  await gotoTab(page, 'Stats');
  await page.waitForTimeout(300);
  const firstRow = page.locator('table tbody tr.clickable').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/04-playercard.png` });
  }

  await browser.close();

  console.log(`Screenshots in ${SHOT_DIR}`);
  if (errors.length) {
    console.error('Console errors:', errors);
    process.exitCode = 1;
  } else {
    console.log('No console errors.');
  }
}

// Only auto-run when invoked directly (`node driver.mjs`), not when another
// script imports these helpers (per the "import the helpers" usage in
// SKILL.md) — otherwise importing this module silently launches a second,
// unwanted browser session.
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main();
}
