// Smoke-check every sidebar screen for console errors after a short sim.
import { chromium } from 'playwright';
import { startNewGame, simWeeks, gotoNav } from './driver.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await startNewGame(page, /Celtics/);
await simWeeks(page, 2);

const labels = await page.locator('.app-sidebar button').allTextContents();
console.log('nav buttons:', JSON.stringify(labels));
for (const label of labels) {
  const before = errors.length;
  try {
    await gotoNav(page, label.trim());
  } catch (e) {
    errors.push(`nav "${label}" failed: ${e.message.split('\n')[0]}`);
  }
  if (errors.length > before) console.log(`errors on "${label}":`, errors.slice(before));
}

await browser.close();
if (errors.length) { console.log('CONSOLE ERRORS:', errors.length); process.exit(1); }
console.log('All screens clean.');
