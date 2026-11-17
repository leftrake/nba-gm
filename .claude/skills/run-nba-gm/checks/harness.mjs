// The small amount of machinery the live-viewer checks share: running a list
// of checks and reporting them, collecting counterexamples, waiting on a
// deadline, building league states with scripts/build-state.mjs, and running
// a dev server from this checkout.
//
// No test framework on purpose (see the root CLAUDE.md): a check is a name
// and an async function that throws to fail and may return a short detail
// string for its PASS line.

import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const CHECKS_DIR = dirname(fileURLToPath(import.meta.url));
// checks/ -> run-nba-gm/ -> skills/ -> .claude/ -> the repo
export const REPO_ROOT = resolve(CHECKS_DIR, '../../../..');

// ---- Counterexamples ----------------------------------------------------------

// A check failing the way it's meant to: the message says what's wrong and
// is printed alone. Anything else thrown (a TypeError, say) is a bug in the
// check or the code under it, and gets its stack.
export class CheckFailure extends Error {}

// Collects every violation of an invariant but keeps only the first few, so
// a check over hundreds of games can say how many broke and show examples.
export class Violations {
  constructor(what, keep = 6) {
    this.what = what;
    this.keep = keep;
    this.count = 0;
    this.samples = [];
  }

  add(msg) {
    this.count += 1;
    if (this.samples.length < this.keep) this.samples.push(msg);
  }

  // Throws if anything was added — the check's failure message.
  assertNone() {
    if (!this.count) return;
    const more = this.count > this.samples.length ? `\n  … and ${this.count - this.samples.length} more` : '';
    throw new CheckFailure(`${this.count} ${this.what}:\n  - ${this.samples.join('\n  - ')}${more}`);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new CheckFailure(msg);
}

// ---- Waiting ------------------------------------------------------------------

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls `fn` until it returns something truthy, or throws `what` once the
// deadline passes. Every wait in the browser checks goes through here rather
// than a fixed number of loop passes: a game runs ~8 minutes at 1x and ~2 at
// 4x, and how long anything takes depends on the machine.
export async function waitFor(fn, { timeout = 10_000, interval = 100, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
    } catch (e) {
      last = undefined;
      if (Date.now() > deadline) throw new CheckFailure(`timed out after ${timeout}ms waiting for ${what} (last error: ${e.message.split('\n')[0]})`);
    }
    if (last) return last;
    if (Date.now() > deadline) throw new CheckFailure(`timed out after ${timeout}ms waiting for ${what}`);
    await sleep(interval);
  }
}

// ---- Running checks -----------------------------------------------------------

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

// Runs checks, `concurrency` at a time, printing a line as each finishes.
// A check is { name, run, serial? }: serial ones run afterwards, alone — for
// anything timing-sensitive that a busy CPU could throw off.
export async function runChecks(checks, { concurrency = 1, label = '' } = {}) {
  const results = [];
  const runOne = async (c) => {
    const t0 = Date.now();
    let res;
    try {
      const detail = await c.run();
      res = { name: c.name, ok: true, detail: detail ?? '', ms: Date.now() - t0 };
    } catch (e) {
      const error = e instanceof CheckFailure ? e.message
        : (e?.stack ?? String(e)).split('\n').slice(0, 6).join('\n');
      res = { name: c.name, ok: false, error, ms: Date.now() - t0 };
    }
    res.label = label;
    results.push(res);
    printResult(res);
    return res;
  };

  const parallel = checks.filter((c) => !c.serial);
  const serial = checks.filter((c) => c.serial);
  let next = 0;
  const worker = async () => {
    while (next < parallel.length) await runOne(parallel[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, parallel.length)) }, worker));
  for (const c of serial) await runOne(c);
  return results;
}

export function printResult(r) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  const head = `${tag}  ${r.label ? `[${r.label}] ` : ''}${r.name}`;
  if (r.ok) {
    console.log(`${head}${r.detail ? ` — ${r.detail}` : ''} (${fmtMs(r.ms)})`);
  } else {
    console.log(`${head} (${fmtMs(r.ms)})`);
    for (const line of String(r.error).split('\n')) console.log(`      ${line}`);
  }
}

// ---- League states --------------------------------------------------------------

// Builds a save with scripts/build-state.mjs — the same engine calls the app
// makes, minus the browser — and returns its path and parsed contents.
export async function buildState(dir, name, to, { team, seed } = {}) {
  const out = join(dir, `${name}.json`);
  const args = [join(REPO_ROOT, 'scripts/build-state.mjs'), '--to', to, '--out', out, '--quiet'];
  if (team) args.push('--team', team);
  if (seed != null) args.push('--seed', String(seed));
  await execFileP(process.execPath, args, { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
  return { file: out, league: JSON.parse(readFileSync(out, 'utf8')) };
}

export function writeState(file, league) {
  writeFileSync(file, JSON.stringify(league));
  return file;
}

// ---- Dev server -------------------------------------------------------------------

async function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

// Starts Vite from this checkout on a port of its own. Not 5173: another
// checkout's dev server may already be there, and checking that one would
// pass or fail on code that isn't this checkout's.
export async function startDevServer({ timeout = 60_000 } = {}) {
  const port = await freePort();
  const vite = join(REPO_ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}/nba-gm/`;
  const stop = () => { if (child.exitCode == null) child.kill('SIGTERM'); };
  try {
    await waitFor(async () => {
      if (child.exitCode != null) throw new Error(`vite exited (${child.exitCode}):\n${log}`);
      const res = await fetch(url).catch(() => null);
      return res?.ok;
    }, { timeout, interval: 250, what: `the dev server at ${url}` });
  } catch (e) {
    stop();
    throw new Error(`${e.message}\n${log}`);
  }
  return { url, stop, log: () => log };
}
