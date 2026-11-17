#!/usr/bin/env node
// Regression suite for the live game viewer (LiveGame.jsx and the modules
// behind it): headless checks on the frames, live box, fouls, highlights and
// pre-game numbers it's built from, then browser checks on the viewer itself.
//
//   node .claude/skills/run-nba-gm/checks/run-all.mjs      (or: npm run test:live)
//
// Options:
//   --only headless|browser   run one half
//   --grep TEXT               only checks whose name contains TEXT
//   --jobs N                  browser checks at a time (default 3)
//   --url URL                 use a running dev server instead of starting one
//                             (it must be serving this checkout's code)
//   --headed                  show the browser
//   --keep                    keep the built states (their folder is printed)
//
// Builds every state it needs with scripts/build-state.mjs into a fresh temp
// folder, starts a Vite dev server from this checkout on a free port (not
// 5173, where another checkout's server may be running), prints PASS/FAIL
// per check and a summary, and exits non-zero if anything failed.
//
// The browser half needs this skill's Playwright: `npm install` in
// .claude/skills/run-nba-gm once (see SKILL.md).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStates } from './states.mjs';
import { runChecks, startDevServer } from './harness.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const only = opt('only');
const grep = opt('grep');
const jobs = Math.max(1, Number(opt('jobs', 3)) || 3);
if (only && !['headless', 'browser'].includes(only)) {
  console.error(`--only takes headless or browser, not "${only}"`);
  process.exit(2);
}
const pick = (checks) => (grep ? checks.filter((c) => c.name.toLowerCase().includes(grep.toLowerCase())) : checks);

const t0 = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'nba-gm-live-checks-'));
let server = null;
let browserHandle = null;
const cleanup = async () => {
  await browserHandle?.close().catch(() => {});
  server?.stop();
  if (!flag('keep')) rmSync(dir, { recursive: true, force: true });
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await cleanup(); process.exit(130); });
}

const results = [];
let consoleErrors = [];
let fatal = null;
try {
  console.log('Building league states with scripts/build-state.mjs…');
  const states = await buildStates(dir);
  console.log(`  ${Object.keys(states).length} states in ${((Date.now() - t0) / 1000).toFixed(1)}s${flag('keep') ? ` → ${dir}` : ''}\n`);

  if (only !== 'browser') {
    console.log('Headless checks');
    const { headlessChecks } = await import('./headless.mjs');
    results.push(...await runChecks(pick(headlessChecks(states)), { label: 'headless' }));
    console.log('');
  }

  if (only !== 'headless') {
    let url = opt('url', process.env.NBA_GM_URL || null);
    if (!url) {
      server = await startDevServer();
      url = server.url;
    }
    // driver.mjs reads this when it's first imported, below.
    process.env.NBA_GM_URL = url;
    console.log(`Browser checks against ${url}${server ? ' (started for this run)' : ''}`);
    const browser = await import('./browser.mjs').catch((e) => {
      if (/browser\.mjs/.test(e.message) && e.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('The browser checks (checks/browser.mjs) are not written yet — run with --only headless.');
      }
      if (/Cannot find (package|module) 'playwright'/.test(e.message)) {
        throw new Error('Playwright is not installed for the run-nba-gm skill: run `npm install` in .claude/skills/run-nba-gm (see SKILL.md).');
      }
      throw e;
    });
    browserHandle = await browser.launch({ headed: flag('headed') });
    const checks = pick(browser.browserChecks(states, browserHandle));
    results.push(...await runChecks(checks, { label: 'browser', concurrency: jobs }));
    consoleErrors = browserHandle.consoleErrors;
    console.log('');
  }
} catch (e) {
  fatal = e;
} finally {
  await cleanup();
}

// ---- Summary ----------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('──────── Summary ────────');
for (const label of ['headless', 'browser']) {
  const rs = results.filter((r) => r.label === label);
  if (rs.length) console.log(`${label}: ${rs.length - rs.filter((r) => !r.ok).length} passed, ${rs.filter((r) => !r.ok).length} failed`);
}
for (const r of failed) console.log(`  FAIL [${r.label}] ${r.name}`);
if (consoleErrors.length) {
  console.log(`Console errors (${consoleErrors.length}):`);
  for (const e of consoleErrors) console.log(`  [${e.check}] ${e.text}`);
} else if (results.some((r) => r.label === 'browser')) {
  console.log('Console errors: none');
}
if (fatal) {
  console.log(`\nThe suite could not finish: ${fatal.stack ?? fatal}`);
}
if (!results.length && !fatal) console.log(grep ? `No checks match "${grep}".` : 'No checks ran.');
console.log(`${failed.length || fatal ? 'FAILED' : 'PASSED'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length || fatal || (!results.length) ? 1 : 0);
