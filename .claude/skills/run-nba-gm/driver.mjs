#!/usr/bin/env node
// Drives the NBA GM SPA in headless Chromium for UI smoke-testing.
// See SKILL.md in this directory for setup and the full writeup.
// Talks to whatever dev server is already running at BASE_URL — does not
// start one itself.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE_URL = process.env.NBA_GM_URL || 'http://localhost:5173/nba-gm/';
const SHOT_DIR = process.env.NBA_GM_SHOTS || '/tmp/nba-gm-shots';

// Modals that can pop up mid-sim and block clicks: tutorial walkthrough,
// coach-talk, milestone alert, call-up prompt, injury alert. None of them
// share a CSS class, so fall back to the modal's *last* button — that's
// deliberately the no-op/secondary choice in every alert modal in
// src/components/shared.jsx — when no known label matches.
export async function dismissOverlay(page) {
  for (let i = 0; i < 8; i++) {
    const overlay = page.locator('.ui-modal-overlay, .walkthrough-overlay, .tour-tooltip');
    if (!(await overlay.count())) return;
    const known = page.locator(
      'button:has-text("Got It"), button:has-text("Close"), button:has-text("OK"), button:has-text("Nice!"), ' +
      'button:has-text("Dismiss"), button:has-text("Let the coach handle it"), button:has-text("Leave him down"), .ui-modal-close'
    ).first();
    if (await known.count()) {
      await known.click({ timeout: 2000 }).catch(() => {});
    } else {
      const lastBtn = overlay.locator('button').last();
      if (await lastBtn.count()) await lastBtn.click({ timeout: 2000 }).catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(300);
  }
}

// Lands on the team-picker, starts a new game, and kills the onboarding
// walkthrough so it doesn't block later clicks.
export async function startNewGame(page, teamNameRegex = /Lakers/) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: teamNameRegex }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(1000);
  const skip = page.getByText('Skip tutorial');
  if (await skip.count()) await skip.click();
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
