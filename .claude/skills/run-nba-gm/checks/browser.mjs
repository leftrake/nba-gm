// Browser checks for the live game viewer: headless Chromium (Playwright,
// this skill's own dependency) against a dev server serving this checkout,
// each check in a fresh browser context with its own localStorage.
//
// Every state comes from scripts/build-state.mjs (states.mjs); nothing is
// simmed in the browser beyond the one day or game each check watches.
//
// How these read the viewer:
//   - Through the DOM, with page.evaluate — never locator.innerText(), which
//     waits out its whole timeout for a card that isn't coming.
//   - The game the viewer is showing comes from LiveGame's own props (found
//     through React's fiber on the overlay), so expected values — where the
//     breaks fall, the next basket, who's on the floor — are computed from
//     exactly what's on screen, with the same liveFrames.js the viewer runs.
//   - Waits have deadlines (waitFor), never loop counts: a game runs about
//     25 minutes at 1x and 3 at 8x, and machines differ.
//
// Don't call driver.mjs's dismissOverlay() or gotoNav() while the viewer is
// open: the viewer is a .ui-modal-overlay too, and dismissOverlay would click
// its buttons.

import { chromium } from 'playwright';
import { loadState, dismissOverlay, gotoNav } from '../driver.mjs';
import {
  periodBreaks, placeHighlights, buildFrames, liveBox, lineupChange, flowLine, ballHolders,
} from '../../../../src/components/liveFrames.js';
import { CheckFailure, assert, waitFor, sleep } from './harness.mjs';

export async function launch({ headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed });
  return { browser, consoleErrors: [], close: () => browser.close() };
}

// ---- Pages ----------------------------------------------------------------------

// Every check watches at 8x unless it says otherwise.
const DEFAULT_PREFS = { speed: 8 };

// A check in its own browser context. `opts.prefs` become the viewer's saved
// preferences (the `nba-gm-live` key) before the app's first script runs —
// once per tab, so loadState's reload keeps whatever the check changes.
// Console errors fail the check that caused them.
async function withPage(handle, name, opts, fn) {
  const context = await handle.browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
  await context.addInitScript((prefs) => {
    try {
      if (!sessionStorage.getItem('__checkPrefs')) {
        localStorage.setItem('nba-gm-live', JSON.stringify(prefs));
        sessionStorage.setItem('__checkPrefs', '1');
      }
    } catch { /* about:blank has no storage */ }
  }, { ...DEFAULT_PREFS, ...opts.prefs });
  if (opts.fakeAudio) await context.addInitScript(fakeAudio);
  const page = await context.newPage();
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const limit = opts.timeout ?? 120_000;
  let timer;
  try {
    const detail = await Promise.race([
      fn(page),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new CheckFailure(`gave up after ${limit / 1000}s`)), limit); }),
    ]);
    if (errors.length) throw new CheckFailure(`console errors:\n  ${errors.join('\n  ')}`);
    return detail;
  } finally {
    clearTimeout(timer);
    handle.consoleErrors.push(...errors.map((text) => ({ check: name, text })));
    await context.close().catch(() => {});
  }
}

// Web Audio, replaced with a recorder: every sound the viewer makes is
// synthesized from a few distinctive parts (see liveSound.js), so the part
// tells which sound it was, and the play counter says which play it was for.
function fakeAudio() {
  const log = [];
  window.__sounds = log;
  const SIGNATURE = { 'highpass 3000': 'swish', 'osc 540': 'rim', 'osc 150': 'block', 'lowpass 1800': 'buzzer', 'bandpass 900': 'crowd' };
  const note = (part) => {
    const what = SIGNATURE[part];
    if (!what) return;
    const count = document.querySelector('.live-modal .live-count')?.textContent.match(/^(\d+)/);
    log.push({ what, idx: count ? Number(count[1]) : null });
  };
  const param = (onSet) => ({
    v: 0,
    get value() { return this.v; },
    set value(x) { this.v = x; onSet?.(x); },
    setValueAtTime(x) { onSet?.(x); return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
  });
  class Node { connect(n) { return n; } disconnect() {} start() {} stop() {} }
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = new Node(); }
    resume() { return Promise.resolve(); }
    createGain() { const n = new Node(); n.gain = param(); return n; }
    createOscillator() { const n = new Node(); n.type = 'sine'; n.frequency = param((x) => note(`osc ${x}`)); return n; }
    createBiquadFilter() { const n = new Node(); n.type = 'lowpass'; n.Q = param(); n.frequency = param((x) => note(`${n.type} ${x}`)); return n; }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return new Node(); }
  }
  window.AudioContext = Ctx;
  window.webkitAudioContext = Ctx;
}

// ---- Reading the viewer ---------------------------------------------------------

// Everything a check asks about the viewer, from the DOM, in one round trip.
function readViewerInPage() {
  const m = document.querySelector('.live-modal');
  if (!m) return null;
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const count = text(m.querySelector('.live-count'))?.match(/(\d+) \/ (\d+)/);
  const fouls = (side) => {
    const f = m.querySelector(`.live-team--${side} .live-fouls`);
    return f ? { n: Number(f.firstElementChild.textContent.match(/\d+/)[0]), bonus: !!f.querySelector('.live-bonus') } : null;
  };
  const card = m.querySelector('.live-card:not(.live-help)');
  const bar = [...(m.querySelector('.live-bar')?.querySelectorAll(':scope > button') ?? [])].map(text);
  const range = m.querySelector('.live-timeline input[type="range"]');
  const poss = m.querySelector('.live-poss.is-on');
  return {
    idx: count ? Number(count[1]) : null,
    total: count ? Number(count[2]) : null,
    away: Number(text(m.querySelector('.live-team--away .live-score'))),
    home: Number(text(m.querySelector('.live-team--home .live-score'))),
    q: text(m.querySelector('.live-clock-q')),
    t: text(m.querySelector('.live-clock-t')),
    final: !!m.querySelector('.live-clock-final'),
    fouls: { away: fouls('away'), home: fouls('home') },
    poss: poss ? (poss.closest('.live-team--away') ? 'away' : 'home') : null,
    card: card?.getAttribute('aria-label') ?? null,
    help: !!m.querySelector('.live-help'),
    paused: bar.includes('▶ Play'),
    playing: bar.includes('❙❙ Pause'),
    finish: bar.find((b) => b === 'Continue' || b === 'Close') ?? null,
    speed: text(m.querySelector('.live-speeds .ui-btn--primary')),
    view: text(m.querySelector('.live-views [aria-pressed="true"]')),
    range: range ? { value: Number(range.value), max: Number(range.max), valuetext: range.getAttribute('aria-valuetext') } : null,
    periods: [...m.querySelectorAll('.live-linescore .live-period')].map((b) => ({ q: text(b.querySelector('.live-period-q')), score: text(b.querySelector('.live-period-score')) })),
    sound: m.querySelector('.live-tools button[aria-label^="Sound"]')?.getAttribute('aria-label') ?? null,
    condensed: m.querySelector('.live-toggle input')?.checked ?? null,
  };
}
const viewer = (page) => page.evaluate(readViewerInPage);

// The card on screen (tip-off, break or final), laid out as data.
function readCardInPage() {
  const card = document.querySelector('.live-modal .live-card:not(.live-help)');
  if (!card) return null;
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  return {
    label: card.getAttribute('aria-label'),
    kicker: text(card.querySelector('.live-card-kicker')),
    title: text(card.querySelector('.live-card-title')),
    center: [...card.querySelectorAll('.live-card-center')].map(text),
    big: [...card.querySelectorAll('.live-card-big')].map((e) => Number(e.textContent)),
    sides: [...card.querySelectorAll('.live-card-side')].map((s) => ({
      team: text(s.querySelector('.live-card-teamname')),
      record: text(s.querySelector('.live-card-team .live-card-muted')),
      label: text(s.querySelector('.live-card-label')),
      lines: [...s.querySelectorAll('li')].map((li) => [...li.children].map(text)),
      leader: text(s.querySelector(':scope > div:not(.live-card-label):not(.live-card-team):not(.live-card-out)')),
      out: text(s.querySelector('.live-card-out')),
    })),
    notes: [...card.querySelectorAll('.live-card-notes li')].map(text),
    buttons: [...card.querySelectorAll('button')].map(text),
  };
}
const readCard = (page) => page.evaluate(readCardInPage);

// The game the viewer is showing, from LiveGame's props: React keeps each
// DOM node's fiber under a `__reactFiber$…` key, and the overlay is the
// root of LiveGame's tree, so its fiber's parent is LiveGame itself.
function viewerGameInPage() {
  const el = document.querySelector('.live-overlay');
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  let f = key ? el[key] : null;
  while (f && !(f.memoizedProps?.game && f.memoizedProps?.home && f.memoizedProps?.away)) f = f.return;
  if (!f) return null;
  const { game, home, away, ctx } = f.memoizedProps;
  const team = (t) => ({
    id: t.id, city: t.city, name: t.name,
    roster: t.roster.map((p) => ({ id: p.id, name: p.name, pos: p.pos, jerseyNumber: p.jerseyNumber, injury: !!p.injury })),
  });
  return JSON.parse(JSON.stringify({ game, home: team(home), away: team(away), ctx: ctx ?? null }));
}
async function viewerGame(page) {
  const g = await page.evaluate(viewerGameInPage);
  assert(g?.game?.playByPlay?.length, 'could not read the watched game from LiveGame\'s props');
  return g;
}

// The save as the app last wrote it: a fingerprint (to tell whether anything
// was committed) and the parts the checks compare against.
function saveInPage() {
  const raw = localStorage.getItem('nba-gm-save') ?? '';
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
  const lg = JSON.parse(raw);
  const team = (t) => ({
    id: t.id, city: t.city, name: t.name, wins: t.wins, losses: t.losses,
    roster: t.roster.map((p) => ({ id: p.id, name: p.name, injury: !!p.injury, gp: p.stats?.gp ?? 0, pts: p.stats?.pts ?? 0 })),
  });
  return {
    hash: `${raw.length}:${(h >>> 0).toString(16)}`,
    dayIndex: lg.dayIndex, phase: lg.phase, season: lg.season, userTeamId: lg.userTeamId,
    teams: Object.fromEntries(lg.teams.map((t) => [t.id, team(t)])),
    today: (lg.resultsByDay?.[lg.dayIndex - 1] ?? []).map((r) => ({ home: r.home, away: r.away, homePts: r.homePts, awayPts: r.awayPts })),
    playoffs: lg.playoffs ? { series: [...(lg.playoffs.East ?? []), ...(lg.playoffs.West ?? [])].map((m) => ({ high: m.high, low: m.low, games: (m.games ?? []).map((g) => [g.home, g.homePts, g.away, g.awayPts]) })) } : null,
    playIn: lg.playIn ? { stage: lg.playIn.stage, East: lg.playIn.East.gameA, West: lg.playIn.West.gameA } : null,
    cup: lg.cup?.bracket ? { round: lg.cup.bracket.round, East: lg.cup.bracket.East } : null,
    allStar: lg.allStar ? { season: lg.allStar.season, game: lg.allStar.game ? { homePts: lg.allStar.game.homePts, awayPts: lg.allStar.game.awayPts } : null } : null,
  };
}
const readSave = (page) => page.evaluate(saveInPage);
const saveHash = async (page) => (await readSave(page)).hash;

// ---- Driving the viewer ---------------------------------------------------------

async function waitForCard(page, label, { timeout = 20_000 } = {}) {
  return waitFor(async () => { const v = await viewer(page); return v?.card === label && v; }, { timeout, what: `the "${label}" card` });
}

async function waitForViewerClosed(page) {
  await waitFor(async () => !(await page.$('.live-overlay')), { timeout: 10_000, what: 'the viewer to close' });
}

// Regular season: the Calendar's Watch, beside Simulate Game.
async function openFromCalendar(page, file) {
  await loadState(page, file);
  const before = await readSave(page);
  await page.getByRole('button', { name: 'Watch ▶', exact: true }).click();
  await waitForCard(page, 'Tip-off');
  return before;
}

async function tipOff(page) {
  await page.getByRole('button', { name: 'Tip off ▶' }).click();
  await waitFor(async () => { const v = await viewer(page); return v && !v.card && v; }, { timeout: 5000, what: 'the tip-off card to go' });
}

async function pause(page) {
  const v = await viewer(page);
  if (v.playing) await page.locator('.live-bar .live-play').click();
  return waitFor(async () => { const s = await viewer(page); return s.paused && s; }, { timeout: 5000, what: 'the viewer to pause' });
}

async function play(page) {
  const v = await viewer(page);
  if (v.paused) await page.locator('.live-bar .live-play').click();
  return waitFor(async () => { const s = await viewer(page); return s.playing && s; }, { timeout: 5000, what: 'the viewer to play' });
}

// Moves the timeline as dragging it would. Paused, it lands exactly there;
// playing, play carries on from there at once, so only "about there" holds.
async function seek(page, i) {
  await page.evaluate((v) => {
    const el = document.querySelector('.live-timeline input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, i);
  return waitFor(async () => {
    const v = await viewer(page);
    return (v.paused ? v.idx === i : v.idx >= i && v.idx <= i + 3) && v;
  }, { timeout: 5000, what: `the timeline to move to play ${i}` });
}

async function skipToFinal(page) {
  await page.locator('.live-bar button[title="Skip to final"]').click();
  return waitForCard(page, 'Final', { timeout: 10_000 });
}

// The viewer's own keys, with focus on the viewer as when it opens — not on
// a button a check clicked (Space would press it) or the timeline (which
// takes arrows and Space itself).
async function press(page, key) {
  await page.evaluate(() => document.querySelector('.live-modal')?.focus());
  await page.keyboard.press(key);
}

// Logs every change of the play counter with what was on screen as it
// changed: the score and the court's make/miss moment.
function installRevealLog() {
  window.__reveals = [];
  const count = document.querySelector('.live-modal .live-count');
  const read = () => Number(count.textContent.match(/^(\d+)/)[1]);
  let prev = read();
  new MutationObserver(() => {
    const idx = read();
    if (idx === prev) return;
    const svg = document.querySelector('.live-court > svg');
    window.__reveals.push({
      idx, prev, t: performance.now(),
      away: Number(document.querySelector('.live-team--away .live-score')?.textContent),
      home: Number(document.querySelector('.live-team--home .live-score')?.textContent),
      swish: !!svg?.querySelector('.court-swish'),
      clank: !!svg?.querySelector('.court-clank'),
      points: svg?.querySelector('.court-points')?.textContent ?? null,
    });
    prev = idx;
  }).observe(count, { childList: true, characterData: true, subtree: true });
}
const reveals = (page) => page.evaluate(() => window.__reveals);
async function collectReveals(page, n, timeout) {
  await waitFor(async () => (await page.evaluate(() => window.__reveals.length)) >= n, { timeout, what: `${n} plays` });
  return reveals(page);
}

// ---- Game data, worked out with the viewer's own code -----------------------------

function scoresAfter(plays) {
  let last = { home: 0, away: 0 };
  return plays.map((p) => (p.score ? (last = p.score) : last));
}
const surname = (name = '') => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '';
};
const record = (t) => `${t.wins}–${t.losses}`;
// Full-court feet to the court's SVG units, each way it's drawn (ArenaCourt's
// PROJECT): upright, and on its side — the bottom basket left, a turn rather
// than a mirror.
const PROJECT = { half: (x, y) => [x + 25, 94 - y], full: (x, y) => [y, x + 25] };
// Where callouts go: away from the basket under attack (LiveGame's calloutSpot).
const calloutSpot = (view, attackTop) => (view === 'full' ? (attackTop ? 'left' : 'right') : (attackTop ? 'bottom' : 'top'));
const ppgText = (p) => (p && p.gp > 0 ? `${(p.pts / p.gp).toFixed(1)} ppg` : '—');
const clockSecs = (t) => { const m = /^(\d+):(\d+)$/.exec(t ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// What the tip-off card should say for one side, from the save before Watch
// (`saved`), the starting five, and how this game counts (`opts`, as the
// viewer's ctx.pregame).
function expectSide(saved, starters, opts = {}) {
  const o = { records: 'subtract', tonightInStats: true, showOut: true, ...opts };
  const byId = new Map(saved.roster.map((p) => [p.id, p]));
  return {
    team: saved.name,
    record: o.records ? record(saved) : null,
    starters: starters.map((id) => [byId.get(id)?.name, ppgText(byId.get(id))]),
  };
}

function checkTipoffSide(card, side, want, label) {
  assert(side.team === want.team, `${label}: tip-off card names ${side.team}, expected ${want.team}`);
  assert(side.record === want.record, `${label}: ${want.team} record on the tip-off card is ${side.record ?? 'not shown'}, expected ${want.record ?? 'none'}`);
  const got = side.lines.map(([who, ppg]) => [who, ppg]);
  for (let i = 0; i < want.starters.length; i++) {
    const [name, ppg] = want.starters[i];
    assert(got[i] && got[i][0].startsWith(name), `${label}: starter ${i + 1} for ${want.team} is "${got[i]?.[0]}", expected ${name}`);
    assert(got[i][1] === ppg, `${label}: ${name} shows ${got[i][1]} on the tip-off card, expected ${ppg} (tonight taken back out)`);
  }
  assert(got.length === want.starters.length, `${label}: ${got.length} starters listed for ${want.team}`);
}

// ---- The checks -------------------------------------------------------------------

export function browserChecks(states, handle) {
  const check = (name, opts, fn) => ({ name, serial: !!opts.serial, run: () => withPage(handle, name, opts, fn) });

  return [
    check('Watch opens on a tip-off card, and nothing is committed until Continue', {}, async (page) => {
      const before = await openFromCalendar(page, states.regular.file);
      const sidebar0 = await page.evaluate(() => document.querySelector('.sidebar-record')?.textContent);
      const g = await viewerGame(page);
      const home = before.teams[g.game.home];
      const away = before.teams[g.game.away];
      const card = await readCard(page);
      assert(card.kicker === 'Tip-off', `tip-off kicker "${card.kicker}"`);
      assert(card.title === `${away.name} at ${home.name}`, `tip-off title "${card.title}"`);
      checkTipoffSide(card, card.sides[0], expectSide(away, g.game.lineups[0].away), 'away');
      checkTipoffSide(card, card.sides[1], expectSide(home, g.game.lineups[0].home), 'home');
      // Out: hurt before tonight, still hurt, and not in tonight's box.
      for (const [i, team, vt, box] of [[0, away, g.away, g.game.awayBox], [1, home, g.home, g.game.homeBox]]) {
        const played = new Set(box.filter((l) => l.min > 0).map((l) => l.playerId));
        const hurtNow = new Set(vt.roster.filter((p) => p.injury).map((p) => p.id));
        const want = team.roster.filter((p) => p.injury && hurtNow.has(p.id) && !played.has(p.id)).map((p) => p.name);
        const got = card.sides[i].out?.replace(/^Out: /, '').split(', ') ?? [];
        assert(want.sort().join('|') === got.sort().join('|'), `${team.id} out list [${got}], expected [${want}]`);
      }
      assert(await saveHash(page) === before.hash, 'the save changed when Watch opened');

      await tipOff(page);
      await waitFor(async () => (await viewer(page)).idx >= 8, { timeout: 15_000, what: 'a few plays' });
      assert(await saveHash(page) === before.hash, 'the save changed while the game was being watched');
      await skipToFinal(page);
      assert(await saveHash(page) === before.hash, 'the save changed at the final whistle, before Continue');
      const behind = await page.evaluate(() => document.querySelector('.sidebar-record')?.textContent);
      assert(behind === sidebar0, `the sidebar record behind the viewer changed to ${behind} before Continue (was ${sidebar0})`);

      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      const after = await readSave(page);
      assert(after.hash !== before.hash, 'Continue did not commit the day');
      assert(after.dayIndex === before.dayIndex + 1, `after Continue the day is ${after.dayIndex}, expected ${before.dayIndex + 1}`);
      const r = after.today.find((x) => x.home === g.game.home && x.away === g.game.away);
      assert(r && r.homePts === g.game.homePts && r.awayPts === g.game.awayPts, `the saved result ${JSON.stringify(r)} is not the game watched (${g.game.awayPts}-${g.game.homePts})`);
      const me = before.userTeamId;
      const won = (g.game.home === me) === (g.game.homePts > g.game.awayPts);
      const t0 = before.teams[me];
      const t1 = after.teams[me];
      assert(t1.wins === t0.wins + (won ? 1 : 0) && t1.losses === t0.losses + (won ? 0 : 1), `user record went ${record(t0)} → ${record(t1)} on a ${won ? 'win' : 'loss'}`);
      return `${away.id}@${home.id}: save untouched through tip-off, play and the final; committed on Continue`;
    }),

    check('final card: the result, each side\'s top scorers, the post-game notes', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      await tipOff(page);
      const v = await skipToFinal(page);
      const card = await readCard(page);
      const { homePts, awayPts } = g.game;
      assert(v.final && v.away === awayPts && v.home === homePts, `scoreboard at the final: ${v.away}-${v.home}, FINAL ${v.final}; the result is ${awayPts}-${homePts}`);
      assert(card.big.join('-') === `${awayPts}-${homePts}`, `final card score ${card.big.join('-')}, expected ${awayPts}-${homePts}`);
      const winner = homePts > awayPts ? g.home : g.away;
      assert(card.center[0] === `${winner.city} ${winner.name} win`, `final card says "${card.center[0]}"`);
      for (const [i, team, box] of [[0, g.away, g.game.awayBox], [1, g.home, g.game.homeBox]]) {
        const top = [...box].sort((a, b) => b.pts - a.pts).slice(0, 3);
        const lines = card.sides[i].lines;
        assert(card.sides[i].label === team.name, `final card column ${i} is "${card.sides[i].label}"`);
        assert(lines.length === 3, `${team.id}: ${lines.length} top scorers on the final card`);
        lines.forEach(([, stat], k) => {
          const want = `${top[k].pts}p ${top[k].reb}r ${top[k].ast}a`;
          assert(stat === want, `${team.id} top scorer ${k + 1}: "${stat}", expected "${want}"`);
        });
      }
      const notes = placeHighlights(g.game.playByPlay, g.game.events).post.map((e) => e.text.replace(/^🩹\s*/, ''));
      assert(card.notes.join('|') === notes.join('|'), `final card notes [${card.notes}] vs [${notes}]`);
      assert(v.finish === 'Continue' && !v.playing && !v.paused, 'at the final the transport should offer only Continue');
      assert(v.idx === v.total, `play counter at the final: ${v.idx} / ${v.total}`);
      return `${g.away.id} ${awayPts}, ${g.home.id} ${homePts}; ${notes.length} post-game notes`;
    }),

    check('pacing: at 1x a possession plays out at half real time and every other play within a second or so; 8x is about eight times quicker', { serial: true, prefs: { speed: 1 }, timeout: 180_000 }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const frames = buildFrames(plays, g.game.lineups, g.home, g.away);
      // From one play landing to the next: the beat the first one lands with
      // (LiveGame's dwellMs), then the next one's time on screen. A set
      // (actOut) is timed in real seconds, and should take half of them, over
      // the 90% of its wait the court moves in.
      const dwell = (p, next) => (p?.k === 'shot' ? (p.m ? 0.7 : 0.25) : p?.k === 'ft' && next?.k !== 'ft' ? 0.35 : 0);
      const timed = (log, speed) => log.slice(1).flatMap((r, k) => {
        const prev = log[k];
        if (r.idx !== prev.idx + 1) return [];
        const i = r.idx - 1;
        const secs = (r.t - prev.t) / 1000 - dwell(plays[i - 1], plays[i]) / Math.max(1, speed);
        return [{ i, secs, set: frames[i].set, real: frames[i].realSec }];
      });
      await page.evaluate(installRevealLog);
      await tipOff(page);
      const slow = timed(await collectReveals(page, 14, 100_000), 1);
      await press(page, '4');
      await waitFor(async () => (await viewer(page)).speed === '8x', { timeout: 3000, what: '8x' });
      const from = (await reveals(page)).length + 1; // the first one at 8x may straddle the change
      const fast = timed((await collectReveals(page, from + 16, 30_000)).slice(from), 8);
      const sets1 = slow.filter((x) => x.set);
      const rest1 = slow.filter((x) => !x.set);
      assert(sets1.length >= 4 && rest1.length >= 3, `too few plays timed at 1x: ${sets1.length} sets, ${rest1.length} others`);
      const f = (xs) => xs.map((x) => x.toFixed(2)).join(' ');
      const shares = sets1.map((x) => x.secs / x.real);
      assert(shares.every((x) => x >= 0.45 && x <= 0.7), `a possession at 1x should take half its real time (over 90% of the wait, 0.56): ${f(shares)}`);
      assert(rest1.every((x) => x.secs >= 0.5 && x.secs <= 3.4), `other plays at 1x should take between half a second and three: ${f(rest1.map((x) => x.secs))}`);
      const sets8 = fast.filter((x) => x.set);
      assert(sets8.length >= 4, `too few possessions timed at 8x: ${sets8.length}`);
      const m1 = median(shares);
      const m8 = median(sets8.map((x) => x.secs / x.real));
      assert(m1 / m8 >= 6 && m1 / m8 <= 10, `8x should be about eight times quicker: a possession takes ${m1.toFixed(2)} of its real time at 1x, ${m8.toFixed(3)} at 8x`);
      return `a possession takes ${m1.toFixed(2)} of its real time at 1x (${sets1.map((x) => `${x.secs.toFixed(1)}s`).join(' ')}), ${m8.toFixed(3)} at 8x; other plays ${f(rest1.map((x) => x.secs))}s`;
    }),

    check('makes swish and misses clank — on the court and in the sound', { prefs: { speed: 8, sound: true }, fakeAudio: true }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const { byPlay } = placeHighlights(plays, g.game.events);
      const breaks = new Set(periodBreaks(plays).map((b) => b.i));
      await page.evaluate(installRevealLog);
      await tipOff(page);
      const log = await collectReveals(page, 70, 60_000);
      const sounds = await page.evaluate(() => window.__sounds);
      const n = { make: 0, miss: 0, blocked: 0 };
      for (const r of log) {
        if (r.idx !== r.prev + 1) continue;
        const i = r.idx - 1;
        const p = plays[i];
        const shot = p.k === 'shot' || p.k === 'ft';
        const blocked = p.k === 'shot' && !p.m && plays[i + 1]?.k === 'blk';
        const where = `play ${i} (${p.q} ${p.t} "${p.text}")`;
        if (shot && p.m) {
          n.make += 1;
          const pts = p.k === 'ft' ? 1 : p.pts;
          assert(r.swish && !r.clank && r.points === `+${pts}`, `${where}: a make should swish with +${pts}; court showed swish ${r.swish}, clank ${r.clank}, points ${r.points}`);
        } else if (shot && !blocked) {
          n.miss += 1;
          assert(r.clank && !r.swish && r.points == null, `${where}: a miss should clank; court showed swish ${r.swish}, clank ${r.clank}`);
        } else {
          if (blocked) n.blocked += 1;
          assert(!r.swish && !r.clank, `${where}: no swish or clank belongs here; court showed swish ${r.swish}, clank ${r.clank}`);
        }
        const want = new Set();
        if (shot && p.m) want.add('swish');
        else if (shot && !blocked) want.add('rim');
        if (p.k === 'blk') want.add('block');
        if (breaks.has(i)) want.add('buzzer');
        if (byPlay.get(i)?.some((e) => e.k === 'run' || e.k === 'clutch')) want.add('crowd');
        const heard = new Set(sounds.filter((s) => s.idx === r.idx).map((s) => s.what));
        assert([...want].sort().join() === [...heard].sort().join(), `${where}: heard [${[...heard]}], expected [${[...want]}]`);
      }
      assert(n.make >= 5 && n.miss >= 5, `too few shots watched to mean anything: ${n.make} makes, ${n.miss} misses`);
      return `${n.make} makes, ${n.miss} misses, ${n.blocked} blocked — each looked and sounded right`;
    }),

    check('break cards: end of Q1 and halftime, with the score, the period and each side\'s leader', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const score = scoresAfter(plays);
      const [q1, half] = periodBreaks(plays);
      const awayIds = new Set(g.game.awayBox.map((l) => l.playerId));
      await page.evaluate(installRevealLog);
      await tipOff(page);
      const out = [];
      for (const [brk, title, how] of [[q1, 'End of Q1', 'waits'], [half, 'Halftime', 'continue']]) {
        await pause(page);
        await seek(page, brk.i - 1);
        await play(page);
        const v = await waitForCard(page, title, { timeout: 15_000 });
        const card = await readCard(page);
        assert(card.label === title, `expected the ${title} card, read ${card.label}`);
        const s = score[brk.i];
        assert(v.idx === brk.i + 1, `${title}: card came up at play ${v.idx}, the period ends at ${brk.i + 1}`);
        assert(card.big.join('-') === `${s.away}-${s.home}` && v.away === s.away && v.home === s.home,
          `${title}: card ${card.big.join('-')}, scoreboard ${v.away}-${v.home}, expected ${s.away}-${s.home}`);
        const period = `This period: ${g.away.id} ${g.game.awayQtrs[brk.per]} · ${g.home.id} ${g.game.homeQtrs[brk.per]}`;
        assert(card.center[0] === period, `${title}: "${card.center[0]}", expected "${period}"`);
        const box = liveBox(plays, brk.i + 1);
        for (const [k, side] of [[0, 'away'], [1, 'home']]) {
          const pts = [...box].filter(([id]) => awayIds.has(id) === (side === 'away')).map(([, l]) => l.pts);
          const best = Math.max(...pts);
          assert(card.sides[k].leader?.includes(`${best} pts`), `${title}: ${side} leader "${card.sides[k].leader}", expected someone with ${best} pts`);
        }
        if (how === 'waits') {
          // At 4x a break is a breath — just under a second — then play goes
          // on by itself. The gap between the period's last play and the
          // next says the card held play meanwhile (4x plays are ~0.3s apart).
          await waitFor(async () => { const x = await viewer(page); return !x.card && x.idx > brk.i + 1; }, { timeout: 6000, what: `${title} card to move on by itself` });
          const log = await reveals(page);
          const at = log.findIndex((r) => r.idx === brk.i + 1);
          const next = log[at + 1];
          assert(at >= 0 && next, `${title}: the reveals around the break weren't logged`);
          const held = (next.t - log[at].t) / 1000;
          assert(held >= 0.85, `${title}: the next play came ${held.toFixed(2)}s after the break — the card didn't hold play`);
        } else {
          await page.getByRole('button', { name: 'Continue ▸' }).click();
          await waitFor(async () => !(await viewer(page)).card, { timeout: 1500, what: `Continue to close the ${title} card` });
        }
        out.push(`${title} at ${s.away}-${s.home}`);
      }
      return out.join(', ');
    }),

    // Both ways the court can be drawn: one end upright (1440x900 gives the
    // upright court a bigger scale than the whole floor would get), and the
    // whole floor on its side (1600x900).
    ...[['one end upright', {}, 'half'], ['the whole floor on its side', { viewport: { width: 1600, height: 900 } }, 'full']].map(([way, opts, want]) => check(`name tags on the ball handler and the defender in the play; the floor list beside the court — ${way}`, opts, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const drawn = await page.evaluate(() => document.querySelector('.live-court > svg')?.dataset.view);
      assert(drawn === want, `the court is drawn "${drawn}" at this size, expected "${want}"`);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const frames = buildFrames(plays, g.game.lineups, g.home, g.away);
      const name = new Map([...g.home.roster, ...g.away.roster].map((p) => [p.id, p.name]));
      const find = (pred) => plays.findIndex((p, i) => i > 10 && pred(p, frames[i]));
      const cases = [
        ['contest', find((p, f) => p.k === 'shot' && f.act === 'contest')],
        ['block', find((p, f) => p.k === 'blk' && f.act === 'block')],
        ['foul', find((p, f) => p.k === 'foul' && f.act === 'foul' && f.targetId != null)],
        ['no defender', find((p, f) => p.k === 'reb' && f.actorId == null && f.holderId != null)],
      ];
      await tipOff(page);
      await pause(page);
      const seen = [];
      for (const [kind, i] of cases) {
        if (i < 0) { assert(kind !== 'contest', 'no contested shot in the game'); continue; }
        await seek(page, i + 1); // the court acts out the last play revealed
        await sleep(450);        // tags fade in; players settle
        const f = frames[i];
        const court = await page.evaluate(() => {
          const svg = document.querySelector('.live-court > svg');
          const players = [...svg.querySelectorAll('g')].filter((x) => x.querySelector(':scope > title')).map((x) => ({
            name: x.querySelector(':scope > title').textContent.split(' · ')[0],
            at: x.style.transform,
            // The rings sit in a group of their own, which fades them in at the play's moment.
            holder: !!x.querySelector('circle[r="1.95"]'),
            act: x.querySelector('circle.court-act')?.getAttribute('class').match(/court-act--(\w+)/)?.[1] ?? null,
          }));
          // Only the tags showing: a set also has one on each man who had the
          // ball on the way, hidden once he's passed it on.
          const tags = [...svg.querySelectorAll('g.court-tag')]
            .filter((x) => Number(getComputedStyle(x.parentElement).opacity) > 0.5)
            .map((x) => ({ text: x.textContent.trim(), at: x.parentElement.parentElement.style.transform }));
          const floor = [...document.querySelectorAll('table.live-floor tbody')].map((tb) => [...tb.querySelectorAll('tr:not(.live-floor-team)')].map((tr) => ({
            name: tr.querySelector('.live-floor-name').firstChild.textContent, ball: tr.classList.contains('has-ball'), pts: Number(tr.cells[2].textContent),
          })));
          return { players, tags, floor };
        });
        const where = `${kind} at play ${i} (${plays[i].q} ${plays[i].t} "${plays[i].text}")`;
        // Whoever has the ball at the end — nobody, when it's loose — and the defender in the play.
        const hs = ballHolders(f.ballPath, f.holderId);
        const onBall = hs[hs.length - 1]?.id ?? null;
        const want = [onBall, f.actorId].filter((id) => id != null).map((id) => surname(name.get(id)));
        assert(court.players.length === 10, `${where}: ${court.players.length} players drawn`);
        assert(court.tags.map((t) => t.text).sort().join('|') === [...want].sort().join('|'), `${where}: tags [${court.tags.map((t) => t.text)}], expected [${want}]`);
        for (const [id, role] of [[onBall, 'holder'], [f.actorId, 'defender']]) {
          if (id == null) continue;
          const pl = court.players.find((x) => x.name === name.get(id));
          const tag = court.tags.find((t) => t.text === surname(name.get(id)));
          assert(pl, `${where}: ${role} ${name.get(id)} isn't on the court`);
          assert(tag.at === pl.at, `${where}: ${role}'s tag sits at ${tag.at}, he's at ${pl.at}`);
          if (role === 'holder') assert(pl.holder, `${where}: ${name.get(id)} has the ball but no ring`);
          else assert(pl.act === f.act, `${where}: ${name.get(id)} should wear the ${f.act} ring, wears ${pl.act}`);
        }
        // The list beside the court: the same ten, the ball-handler marked,
        // points as the live box has them at this moment.
        const box = liveBox(plays, i + 1, { frames });
        for (const [k, side] of [[0, 'away'], [1, 'home']]) {
          const ids = f.players.filter((x) => x.side === side).map((x) => x.id);
          const rows = court.floor[k];
          assert(rows.map((r) => r.name).sort().join('|') === ids.map((id) => name.get(id)).sort().join('|'), `${where}: ${side} floor list [${rows.map((r) => r.name)}]`);
          for (const r of rows) {
            const id = ids.find((x) => name.get(x) === r.name);
            assert(r.pts === (box.get(id)?.pts ?? 0), `${where}: floor list gives ${r.name} ${r.pts} pts, the live box ${box.get(id)?.pts ?? 0}`);
            assert(r.ball === (id === onBall), `${where}: ${r.name}'s ball marker is ${r.ball}`);
          }
        }
        seen.push(kind);
      }
      return seen.join(', ');
    })),

    check('a set names whoever has the ball as it goes round — never the shooter before it reaches him', { prefs: { speed: 1 } }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const frames = buildFrames(plays, g.game.lineups, g.home, g.away);
      const name = new Map([...g.home.roster, ...g.away.roster].map((p) => [p.id, p.name]));
      // A set ending in a shot by someone the ball takes a while to reach.
      const firstHold = (f) => f.ballPath.find((q) => q.held && q.by === f.holderId)?.t ?? 0;
      const k = frames.findIndex((f, i) => i > 10 && f.set && plays[i].k === 'shot' && firstHold(f) >= 0.45);
      assert(k > 0, 'no set in the game where the ball takes a while to reach the shooter');
      const f = frames[k];
      const shooter = surname(name.get(f.holderId));
      const read = () => page.evaluate(() => ({
        tags: [...document.querySelectorAll('.live-court svg g.court-tag')]
          .filter((x) => Number(getComputedStyle(x.parentElement).opacity) > 0.5).map((x) => x.textContent.trim()),
        listed: document.querySelector('.live-floor tr.has-ball .live-floor-name')?.firstChild.textContent ?? null,
        idx: Number(document.querySelector('.live-count').textContent.match(/^(\d+)/)[1]),
      }));
      await tipOff(page);
      await pause(page);
      await seek(page, k);   // the court on the play before; playing on stages this set
      await play(page);
      // Halfway to the shooter's first touch, frozen there.
      await sleep(f.realSec * 500 * firstHold(f) * 0.5);
      await pause(page);
      const early = await read();
      const where = `play ${k} (${plays[k].q} ${plays[k].t} "${plays[k].text}")`;
      assert(early.idx === k, `${where}: sampled at play ${early.idx}, not during the set`);
      assert(!early.tags.includes(shooter), `${where}: ${shooter}'s tag is up before the ball has reached him (tags: ${early.tags})`);
      assert(early.listed !== name.get(f.holderId), `${where}: the list marks ${early.listed} as having the ball before it has reached him`);
      assert(early.listed != null, `${where}: the list marks nobody with the ball mid-set`);
      // Once it lands, the shot is his: tag and mark.
      await play(page);
      await waitFor(async () => (await read()).idx >= k + 1, { timeout: 30_000, what: 'the shot to land' });
      await pause(page);
      await sleep(300);
      const after = await read();
      assert(after.tags.includes(shooter) || after.idx > k + 1, `${where}: after the shot ${shooter} carries no tag (tags: ${after.tags})`);
      return `${where}: mid-set the tag was on ${early.tags.join(', ') || 'nobody'} and the list on ${early.listed}; ${shooter} named once the ball got to him`;
    }),

    check('court view: the whole floor on its side on a wide window, one end upright on a narrower one, and back', { viewport: { width: 1600, height: 900 } }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const frames = buildFrames(plays, g.game.lineups, g.home, g.away);
      const name = new Map([...g.home.roster, ...g.away.roster].map((p) => [p.id, p.name]));
      await tipOff(page);
      await pause(page);
      const read = () => page.evaluate(() => {
        const svg = document.querySelector('.live-court > svg');
        const box = (el) => { const r = el?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } : null; };
        return {
          view: svg.dataset.view,
          viewBox: svg.getAttribute('viewBox'),
          cam: svg.firstElementChild.style.transform,
          players: [...svg.querySelectorAll('g')].filter((x) => x.querySelector(':scope > title')).map((x) => ({
            name: x.querySelector(':scope > title').textContent.split(' · ')[0],
            at: (x.style.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/) ?? []).slice(1).map(Number),
          })),
          svg: box(svg), side: box(document.querySelector('.live-side')), bar: box(document.querySelector('.live-bar')),
        };
      });
      // One play with the offense attacking each basket.
      const picks = [frames.findIndex((f, i) => i > 30 && f.attackTop), frames.findIndex((f, i) => i > 30 && !f.attackTop)];
      const at = async (view, size) => {
        const out = [];
        for (const i of picks) {
          await seek(page, i + 1); // the court acts out the last play revealed
          const c = await read();
          const f = frames[i];
          const where = `${size}, play ${i} (offense attacking the ${f.attackTop ? 'top' : 'bottom'} basket)`;
          assert(c.view === view, `${where}: drawn "${c.view}", expected "${view}"`);
          const [w, h] = view === 'full' ? [97, 53] : [53, 50];
          assert(c.viewBox === `-1.5 -1.5 ${w} ${h}`, `${where}: viewBox ${c.viewBox}`);
          assert(Math.abs(c.svg.w / c.svg.h - w / h) < 0.01, `${where}: drawn ${c.svg.w.toFixed(0)}x${c.svg.h.toFixed(0)}, not the ${w}:${h} court`);
          // The camera: never moves on its side; upright, on the end under attack.
          const camY = view === 'full' || f.attackTop ? 0 : 47;
          assert(c.cam === `translate(0px, ${-camY}px)`, `${where}: camera at ${c.cam}`);
          assert(c.players.length === 10, `${where}: ${c.players.length} players drawn`);
          for (const pl of f.players) {
            const d = c.players.find((x) => x.name === name.get(pl.id));
            const [X, Y] = PROJECT[view](pl.x, pl.y);
            assert(d && Math.abs(d.at[0] - X) < 0.01 && Math.abs(d.at[1] - Y) < 0.01, `${where}: ${name.get(pl.id)} drawn at ${d?.at}, expected ${X.toFixed(2)},${Y.toFixed(2)}`);
          }
          // Beside the list, above the controls.
          assert(c.svg.r <= c.side.l + 1 && c.svg.b <= c.bar.t + 1, `${where}: the court runs into ${c.svg.r > c.side.l + 1 ? 'the list beside it' : 'the controls'}`);
          out.push(c.svg.w);
        }
        return Math.round(out[0]);
      };
      const wide = await at('full', '1600x900');
      await page.setViewportSize({ width: 1100, height: 800 });
      await waitFor(() => page.evaluate(() => document.querySelector('.live-court > svg').dataset.view === 'half'), { timeout: 3000, what: 'the upright court at 1100x800' });
      const narrow = await at('half', '1100x800');
      await page.setViewportSize({ width: 1600, height: 900 });
      await waitFor(() => page.evaluate(() => document.querySelector('.live-court > svg').dataset.view === 'full'), { timeout: 3000, what: 'the floor on its side again at 1600x900' });
      await at('full', '1600x900 again');
      return `on its side ${wide}px wide at 1600x900, upright ${narrow}px at 1100x800, both baskets each way`;
    }),

    ...[['one end upright', {}], ['the whole floor on its side', { viewport: { width: 1600, height: 900 } }]].map(([way, opts]) => check(`substitutions: as the new five take the floor, a banner says who came in and who went out, off the play — ${way}`, opts, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const frames = buildFrames(plays, g.game.lineups, g.home, g.away);
      const byId = new Map([...g.home.roster, ...g.away.roster].map((p) => [p.id, p]));
      const team = { home: g.home, away: g.away };
      // The first substitution after the opening minutes.
      const k = frames.findIndex((f, i) => i > 20 && lineupChange(frames[i - 1], f));
      assert(k > 0, 'no substitution in the game to watch');
      const change = lineupChange(frames[k - 1], frames[k]);
      await tipOff(page);
      await pause(page);
      await seek(page, k - 1); // the court on play k-2; playing on stages k-1, then k — the new five
      await play(page);
      const seen = await waitFor(() => page.evaluate(() => {
        const cards = [...document.querySelectorAll('.live-sub')];
        if (!cards.length) return null;
        return {
          idx: Number(document.querySelector('.live-count').textContent.match(/^(\d+)/)[1]),
          view: document.querySelector('.live-court > svg').dataset.view,
          spot: [...document.querySelector('.live-subs').parentElement.classList].find((c) => c.startsWith('is-'))?.slice(3),
          cards: cards.map((c) => ({
            label: c.getAttribute('aria-label'),
            rows: Object.fromEntries([...c.querySelectorAll('.live-sub-row')].map((r) => [
              r.querySelector('.live-sub-tag').textContent,
              [...r.querySelectorAll('.live-sub-player')].map((p) => `${p.querySelector('svg text').textContent} ${p.lastChild.textContent}`),
            ])),
          })),
          court: [...document.querySelectorAll('.live-court > svg title')].map((t) => t.textContent.split(' · ')[0]),
          floorIn: [...document.querySelectorAll('.live-floor tr.is-in .live-floor-name')].map((td) => td.firstChild.textContent),
        };
      }), { timeout: 15_000, interval: 30, what: `the substitution before play ${k}` });
      await pause(page);
      const where = `substitution at play ${k} (${plays[k].q} ${plays[k].t})`;
      assert(seen.idx >= k, `${where}: the banner showed with ${seen.idx} plays in, before the new five were on`);
      const sides = ['away', 'home'].filter((s) => change[s]);
      assert(seen.cards.length === sides.length, `${where}: ${seen.cards.length} cards for ${sides.length} teams that changed`);
      const dot = (id) => `${byId.get(id)?.jerseyNumber} ${surname(byId.get(id)?.name)}`;
      sides.forEach((s, n) => {
        const c = seen.cards[n];
        assert(c.label === `${team[s].name} substitution`, `${where}: card ${n} is "${c.label}", expected the ${team[s].name}`);
        assert((c.rows.In ?? []).join('|') === change[s].ins.map(dot).join('|'), `${where}: ${team[s].name} in [${c.rows.In}], expected [${change[s].ins.map(dot)}]`);
        assert((c.rows.Out ?? []).join('|') === change[s].outs.map(dot).join('|'), `${where}: ${team[s].name} out [${c.rows.Out}], expected [${change[s].outs.map(dot)}]`);
      });
      // What the banner says is what the court shows: everyone in is on it, nobody out is.
      for (const s of sides) {
        for (const id of change[s].ins) assert(seen.court.includes(byId.get(id).name), `${where}: ${byId.get(id).name} came in but isn't on the court`);
        for (const id of change[s].outs) assert(!seen.court.includes(byId.get(id).name), `${where}: ${byId.get(id).name} went out but is still on the court`);
      }
      const ins = sides.flatMap((s) => change[s].ins).map((id) => byId.get(id).name);
      assert(seen.floorIn.sort().join('|') === ins.sort().join('|'), `${where}: the list marks [${seen.floorIn}] as just in, expected [${ins}]`);
      const spot = calloutSpot(seen.view, frames[k].attackTop);
      assert(seen.spot === spot, `${where}: the banner is at the ${seen.spot}, expected the ${spot} (away from the basket under attack)`);
      // A seek isn't a substitution: back to the start clears it, and jumping
      // across a change announces nothing.
      await seek(page, 3);
      assert(!(await page.$('.live-sub')), `${where}: the banner stayed up after seeking back`);
      await seek(page, k + 5);
      await sleep(300);
      assert(!(await page.$('.live-sub')), `${where}: seeking across it announced a substitution`);
      return `${sides.map((s) => `${team[s].id} ${change[s].ins.length} in/${change[s].outs.length} out`).join(', ')} at ${plays[k].q} ${plays[k].t}, at the ${seen.spot}`;
    })),

    check('timeline: the margin is drawn only as far as the game has been watched, and hovering reads the score then', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const score = scoresAfter(plays);
      const readFlow = () => page.evaluate(() => {
        const svg = document.querySelector('.live-flow-graph');
        const range = document.querySelector('.live-timeline input[type="range"]');
        const r = svg.getBoundingClientRect();
        return {
          viewBox: svg.getAttribute('viewBox'),
          d: svg.querySelector('.live-flow-line')?.getAttribute('d') ?? null,
          max: Number(range.max),
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          tip: document.querySelector('.live-flow-tip')?.textContent ?? null,
          key: [...document.querySelectorAll('.live-flow-key span')].map((s) => s.textContent),
        };
      });
      let f = await readFlow();
      assert(f.d === null, `at tip-off a margin line is already drawn: ${f.d}`);
      assert(f.key.join() === `${g.away.id},${g.home.id}`, `the graph's key reads ${f.key}, expected ${g.away.id} over ${g.home.id}`);
      await tipOff(page);
      await pause(page);
      const hover = async (v) => {
        await page.mouse.move(f.rect.left + (v / f.max) * f.rect.width, f.rect.top + f.rect.height / 2);
        await sleep(120);
        return (await readFlow()).tip;
      };
      const checked = [];
      for (const i of [40, 160, Math.floor(plays.length * 0.8)]) {
        await seek(page, i);
        f = await readFlow();
        const want = flowLine(score, i);
        assert(f.d === want.d, `after ${i} plays the line is ${f.d?.slice(-40)}, expected …${want.d.slice(-40)}`);
        assert(f.viewBox === `0 ${-want.scale} ${f.max} ${2 * want.scale}`, `after ${i} plays the graph spans ${f.viewBox}, expected ±${want.scale} over ${f.max} plays`);
        const v = Math.floor(i / 2);
        const s = score[v - 1];
        const tip = await hover(v);
        assert(tip === `${g.away.id} ${s.away}–${s.home} ${g.home.id}${plays[v - 1].q} ${plays[v - 1].t}`, `hovering play ${v} reads "${tip}"`);
        const ahead = await hover(Math.min(f.max, i + 15));
        assert(ahead === null, `hovering ahead of where the game is reads "${ahead}"`);
        await page.mouse.move(5, 5);
        checked.push(`${i} (±${want.scale})`);
      }
      // The keyboard gets what hovering does: the score at the timeline's spot.
      const v = await viewer(page);
      const last = plays[v.idx - 1];
      assert(v.range.valuetext === `${last.q} ${last.t}, ${g.away.name} ${v.away}, ${g.home.name} ${v.home}`, `the timeline's value text is "${v.range.valuetext}"`);
      await skipToFinal(page);
      f = await readFlow();
      assert(f.d === flowLine(score, plays.length).d, 'at the final the line doesn\'t run to the last play');
      return `after ${checked.join(', ')} plays and at the final; nothing read ahead of the game`;
    }),

    check('Box score view: totals equal the scoreboard; at the final every line equals the box score', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const readBoxes = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((wrap) => {
        const rows = [...wrap.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.replace('●', '').replace(/\s+/g, ' ').trim()));
        return {
          head: wrap.querySelector('h3')?.textContent.replace(/\s+/g, ' ').trim(),
          rows: rows.filter((r) => r[0] !== 'Total'),
          total: rows.find((r) => r[0] === 'Total'),
          on: wrap.querySelectorAll('.box-floor.is-on').length,
        };
      }), sel);
      const checkTotals = async (when) => {
        const v = await viewer(page);
        const boxes = await readBoxes('.live-box .ui-table-wrap');
        assert(boxes.length === 2, `${when}: ${boxes.length} box tables`);
        for (const [k, side] of [[0, 'away'], [1, 'home']]) {
          const b = boxes[k];
          const [pts, fg, tp, ft] = [Number(b.total[2]), b.total[12], b.total[13], b.total[14]].map((x) => (typeof x === 'string' ? x.split('-').map(Number) : x));
          assert(b.head.endsWith(`· ${v[side]}`) && pts === v[side], `${when}: ${side} box says ${b.head} / total ${pts}, the scoreboard ${v[side]}`);
          assert(pts === 2 * fg[0] + tp[0] + ft[0], `${when}: ${side} totals don't add up: ${pts} pts from FG ${fg}, 3P ${tp}, FT ${ft}`);
          if (!v.final) assert(b.on === 5, `${when}: ${b.on} ${side} players marked on the floor`);
        }
        return v;
      };
      await tipOff(page);
      await waitFor(async () => (await viewer(page)).idx >= 40, { timeout: 30_000, what: '40 plays' });
      await press(page, 'b');
      await waitFor(async () => (await viewer(page)).view === 'Box score', { timeout: 3000, what: 'the box score view' });
      await checkTotals('mid Q1, playing');
      await pause(page);
      await seek(page, Math.floor(g.game.playByPlay.length * 0.62));
      await checkTotals('Q3, paused');
      await skipToFinal(page);
      await checkTotals('the final');
      const live = await readBoxes('.live-box .ui-table-wrap');

      // The same game's box score, as the app shows it once it's committed.
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      await dismissOverlay(page);
      const row = page.locator('.result-row', { hasText: g.game.home }).filter({ hasText: g.game.away });
      await row.locator('a', { hasText: 'view ▸' }).click();
      await page.locator('.modal-card').waitFor({ timeout: 5000 });
      const real = [];
      for (const team of [g.away, g.home]) {
        await page.locator('.modal-card button.ui-tab', { hasText: team.name }).first().click();
        real.push((await readBoxes('.modal-card .ui-table-wrap'))[0]);
      }
      const COLS = ['MIN', 'PTS', 'REB', 'OREB', 'DREB', 'AST', 'STL', 'BLK', 'TO', 'PF', '+/-', 'FG', '3P', 'FT'];
      let lines = 0;
      for (const k of [0, 1]) {
        const byKey = new Map(real[k].rows.map((r) => [r[0], r]));
        assert(live[k].rows.length === real[k].rows.length, `${[g.away, g.home][k].id}: ${live[k].rows.length} live lines, ${real[k].rows.length} in the box score`);
        for (const r of live[k].rows) {
          const want = byKey.get(r[0]);
          assert(want, `${r[0]} is in the live box but not the box score`);
          COLS.forEach((c, j) => assert(r[j + 1] === want[j + 1], `${r[0]} ${c}: live ${r[j + 1]}, box score ${want[j + 1]}`));
          lines += 1;
        }
      }
      return `totals match mid-game, paused and at the final; ${lines} lines equal the box score, column for column`;
    }),

    check('team fouls and the Bonus tag follow every foul through a period', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      // The first period someone reaches the bonus in.
      const periods = [...new Set(plays.map((p) => p.q))];
      const target = periods.find((q) => ['home', 'away'].some((s) => plays.filter((p) => p.q === q && p.k === 'foul' && p.side === s).length >= (q.startsWith('Q') ? 5 : 4)));
      assert(target, 'nobody reached the bonus all game — pick another state');
      const start = plays.findIndex((p) => p.q === target);
      const end = plays.length - 1 - [...plays].reverse().findIndex((p) => p.q === target);
      const bonusAt = target.startsWith('Q') ? 5 : 4;
      await tipOff(page);
      await pause(page);
      let bonuses = 0;
      for (let idx = start + 1; idx <= Math.min(end + 2, plays.length - 1); idx++) {
        const v = await seek(page, idx);
        const per = plays[idx - 1].q;
        const count = (s) => plays.slice(0, idx).filter((p) => p.q === per && p.k === 'foul' && p.side === s).length;
        const want = { away: count('away'), home: count('home') };
        const at = `after play ${idx - 1} (${per} ${plays[idx - 1].t} "${plays[idx - 1].text}")`;
        for (const s of ['away', 'home']) {
          const other = s === 'away' ? 'home' : 'away';
          assert(v.fouls[s]?.n === want[s], `${at}: ${s} shows ${v.fouls[s]?.n} fouls, expected ${want[s]}`);
          const inBonus = want[other] >= (per.startsWith('Q') ? 5 : 4);
          assert(v.fouls[s].bonus === inBonus, `${at}: ${s} Bonus tag ${v.fouls[s].bonus}, expected ${inBonus} (${other} has ${want[other]} fouls)`);
          if (inBonus) bonuses += 1;
        }
      }
      assert(bonuses > 0, `${target}: the Bonus tag never had a reason to show`);
      return `${target}, play by play (${end - start + 1} plays): counts and the Bonus tag at ${bonusAt} right throughout, reset after`;
    }),

    check('timeline, line-score jumps, Last 2:00, and rewinding from the final', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const N = plays.length;
      const startOf = (q) => plays.findIndex((p) => p.q === q);
      await tipOff(page);
      await pause(page);

      // The timeline: a drag lands on the play, and says where it is and the
      // score then.
      const score = scoresAfter(plays);
      for (const i of [37, 150]) {
        const v = await seek(page, i);
        const p = plays[i - 1];
        const s = score[i - 1];
        assert(v.q === p.q && v.t === p.t, `timeline at ${i}: clock ${v.q} ${v.t}, expected ${p.q} ${p.t}`);
        assert(v.range.value === i && v.range.valuetext === `${p.q} ${p.t}, ${g.away.name} ${s.away}, ${g.home.name} ${s.home}`, `timeline at ${i}: range ${JSON.stringify(v.range)}`);
      }
      // The line score: Q3 jumps to just before Q3's first play, so the last
      // play shown is still Q2's — Q2 is current (·) until Q3 begins, and a
      // quarter shows its score once play has moved past it.
      const cells = (x) => Object.fromEntries(x.periods.map((p) => [p.q, p.score]));
      const qScore = (i) => `${g.game.awayQtrs[i]}–${g.game.homeQtrs[i]}`;
      await page.locator('.live-period[title="Jump to the start of Q3"]').click();
      let v = await waitFor(async () => { const x = await viewer(page); return x.idx === startOf('Q3') && x; }, { timeout: 3000, what: 'the Q3 jump' });
      let c = cells(v);
      assert(c.Q1 === qScore(0) && c.Q2 === '·' && c.Q3 === '–' && v.q === 'Q2', `at the Q3 jump the line score reads ${JSON.stringify(c)} with the clock at ${v.q} ${v.t}`);
      const ot = periods(plays).filter((q) => !q.startsWith('Q'));
      assert(Object.keys(c).join() === 'Q1,Q2,Q3,Q4', `before the end of regulation the line score shows ${Object.keys(c)}${ot.length ? ' (this game goes to overtime)' : ''}`);
      v = await seek(page, startOf('Q3') + 1);
      c = cells(v);
      assert(v.q === 'Q3' && c.Q2 === qScore(1) && c.Q3 === '·', `one play into Q3 the clock reads ${v.q} and the line score ${JSON.stringify(c)}`);
      // Last 2:00.
      const lastTwo = plays.findIndex((p) => p.q === 'Q4' && (p.sec ?? Infinity) <= 120);
      await page.getByRole('button', { name: 'Last 2:00' }).click();
      await waitFor(async () => (await viewer(page)).idx === lastTwo, { timeout: 3000, what: 'Last 2:00' });
      v = await seek(page, lastTwo + 1);
      assert(v.q === 'Q4' && clockSecs(v.t) <= 120, `after Last 2:00 the clock reads ${v.q} ${v.t}`);

      // Rewinding from the final: a step back, a period jump, an instant replay.
      await skipToFinal(page);
      await press(page, 'ArrowLeft');
      v = await waitFor(async () => { const x = await viewer(page); return x.idx === N - 1 && x; }, { timeout: 3000, what: 'a step back from the final' });
      assert(!v.card && v.paused && !v.final && !v.finish, `a step back from the final should leave the game paused one play short: ${JSON.stringify({ card: v.card, paused: v.paused, finish: v.finish })}`);
      await play(page);
      await waitForCard(page, 'Final', { timeout: 10_000 });
      await page.locator('.live-period[title="Jump to the start of Q1"]').click();
      v = await waitFor(async () => { const x = await viewer(page); return !x.card && x.idx <= 2 && x; }, { timeout: 3000, what: 'the jump back to Q1' });
      await waitFor(async () => (await viewer(page)).idx >= 4, { timeout: 10_000, what: 'play to carry on from Q1' });
      await skipToFinal(page);
      let j = N - 1;
      while (j > 0 && plays[j - 1].n === plays[N - 1].n) j--;
      await press(page, 'r');
      await waitFor(async () => { const x = await viewer(page); return x.idx >= j && x.idx < N && !x.card && x; }, { timeout: 3000, what: 'an instant replay of the last possession' });
      await waitForCard(page, 'Final', { timeout: 20_000 });
      return `timeline, Q3 jump, Last 2:00 (${plays[lastTwo].t}), and back from the final three ways`;
    }),

    check('keyboard: Space, ← →, N, R, 1 2 3, C B P, M, ?, Esc', {}, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('nba-gm-live') || '{}'));
      await press(page, 'Space');
      await waitFor(async () => !(await viewer(page)).card, { timeout: 3000, what: 'Space to tip off' });
      await waitFor(async () => (await viewer(page)).idx >= 3, { timeout: 10_000, what: 'a few plays' });
      // Space pauses and plays.
      await press(page, 'Space');
      let v = await waitFor(async () => { const x = await viewer(page); return x.paused && x; }, { timeout: 3000, what: 'Space to pause' });
      await sleep(700);
      assert((await viewer(page)).idx === v.idx, 'the game went on while paused');
      await press(page, 'Space');
      await waitFor(async () => { const x = await viewer(page); return x.playing && x.idx > v.idx; }, { timeout: 5000, what: 'Space to play again' });
      // Arrows step a play at a time, paused.
      await press(page, 'Space');
      v = await waitFor(async () => { const x = await viewer(page); return x.paused && x; }, { timeout: 3000, what: 'pause' });
      await press(page, 'ArrowRight');
      await waitFor(async () => (await viewer(page)).idx === v.idx + 1, { timeout: 3000, what: '→ a play forward' });
      await press(page, 'ArrowRight');
      await press(page, 'ArrowLeft');
      v = await waitFor(async () => { const x = await viewer(page); return x.idx === v.idx + 1 && x.paused && x; }, { timeout: 3000, what: '← a play back' });
      // N: to just before the next basket, playing at the speed the game was
      // watched at (8x here) — from a play that's no basket, and from one that
      // is (which is itself the next basket).
      const sc = scoresAfter(plays);
      const basket = (p) => (p.k === 'shot' || p.k === 'ft') && p.m;
      const nonBasket = plays.findIndex((p, i) => i > v.idx + 3 && !basket(p));
      const onBasket = plays.findIndex((p, i) => i > nonBasket + 3 && basket(p));
      for (const from of [nonBasket, onBasket]) {
        await pause(page);
        await seek(page, from);
        const nb = plays.findIndex((p, i) => i >= from && basket(p));
        await press(page, 'n');
        const at = await waitFor(async () => { const x = await viewer(page); return x.playing && x; }, { timeout: 3000, what: 'N to set play going' });
        assert(at.idx === nb && at.speed === '8x', `N from play ${from} went to ${at.idx} at ${at.speed}; the next basket is play ${nb} ("${plays[nb].text}"), at the 8x it was watched at`);
        const s = await waitFor(async () => { const x = await viewer(page); return x.idx === nb + 1 && x; }, { timeout: 8000, what: 'the basket to land' });
        assert(s.away === sc[nb].away && s.home === sc[nb].home, `after N's basket the scoreboard reads ${s.away}-${s.home}, expected ${sc[nb].away}-${sc[nb].home}`);
      }
      // R: back to the start of the possession just shown.
      await press(page, 'Space');
      v = await waitFor(async () => { const x = await viewer(page); return x.paused && x; }, { timeout: 3000, what: 'pause' });
      let j = v.idx - 1;
      while (j > 0 && plays[j - 1].n === plays[v.idx - 1].n) j--;
      await press(page, 'r');
      await waitFor(async () => { const x = await viewer(page); return x.idx >= j && x.idx <= j + 1 && x.playing; }, { timeout: 3000, what: `R to replay from play ${j}` });
      // Speeds, remembered for next time.
      for (const [key, sp] of [['2', 2], ['3', 4], ['4', 8], ['1', 1]]) {
        await press(page, key);
        await waitFor(async () => (await viewer(page)).speed === `${sp}x`, { timeout: 3000, what: `${key} for ${sp}x` });
        assert((await prefs()).speed === sp, `speed ${sp}x wasn't saved`);
      }
      // Views.
      for (const [key, label, sel] of [['b', 'Box score', '.live-box'], ['p', 'Play-by-play', '.live-stage > div > table'], ['c', 'Court', '.live-court-row']]) {
        await press(page, key);
        await waitFor(async () => (await viewer(page)).view === label && !!(await page.$(sel)), { timeout: 3000, what: `${key.toUpperCase()} for ${label}` });
      }
      // Sound.
      await press(page, 'm');
      await waitFor(async () => (await viewer(page)).sound === 'Sound on', { timeout: 3000, what: 'M to turn sound on' });
      assert((await prefs()).sound === true, 'sound on wasn\'t saved');
      await press(page, 'm');
      await waitFor(async () => (await viewer(page)).sound === 'Sound off', { timeout: 3000, what: 'M to turn sound off' });
      // Help.
      await press(page, '?');
      await waitFor(async () => (await viewer(page)).help, { timeout: 3000, what: '? to open the keyboard card' });
      await press(page, '?');
      await waitFor(async () => !(await viewer(page)).help, { timeout: 3000, what: '? to close it' });
      await press(page, '?');
      await press(page, 'Escape');
      await waitFor(async () => !(await viewer(page)).help, { timeout: 3000, what: 'Esc to close the keyboard card' });
      // Esc closes only at the final (this isn't a replay).
      await press(page, 'Escape');
      await sleep(300);
      assert(await page.$('.live-overlay'), 'Esc closed the viewer mid-game');
      await skipToFinal(page);
      await press(page, 'Escape');
      await waitForViewerClosed(page);
      return 'each key did its job';
    }),

    check('condensed: only baskets, highlights and period ends are played out', { prefs: { speed: 8, condensed: true } }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const plays = g.game.playByPlay;
      const key = new Set();
      plays.forEach((p, i) => { if (p.k === 'shot' && p.m) key.add(i); });
      for (const i of placeHighlights(plays, g.game.events).byPlay.keys()) key.add(i);
      for (const b of periodBreaks(plays)) key.add(b.i);
      await page.evaluate(installRevealLog);
      await tipOff(page);
      const log = await collectReveals(page, 30, 40_000);
      // A key play is acted out: the counter moves past it by one. Anything
      // else is skipped: the counter jumps over a run of non-key plays (one
      // or more) and stops just before the next key play.
      let acted = 0;
      let skipped = 0;
      for (const r of log) {
        if (key.has(r.prev)) {
          assert(r.idx === r.prev + 1, `key play ${r.prev} ("${plays[r.prev].text}") was jumped over (${r.prev}→${r.idx}) instead of played out`);
          acted += 1;
          continue;
        }
        assert(r.idx > r.prev, `the counter went back, ${r.prev}→${r.idx}`);
        for (let i = r.prev; i < r.idx; i++) assert(!key.has(i), `a jump ${r.prev}→${r.idx} skipped key play ${i} ("${plays[i].text}")`);
        assert(r.idx === plays.length || key.has(r.idx), `a jump ${r.prev}→${r.idx} stopped before play ${r.idx} ("${plays[r.idx]?.text}"), which is no basket, highlight or period end`);
        skipped += r.idx - r.prev;
      }
      assert(acted >= 8 && skipped > acted, `condensed played out ${acted} plays and skipped ${skipped}`);
      // The switch in the viewer turns it off on the spot, and remembers.
      await page.locator('.live-toggle input').uncheck();
      await waitFor(async () => (await viewer(page)).condensed === false, { timeout: 3000, what: 'Condensed off' });
      const n = (await reveals(page)).length + 1;
      const after = (await collectReveals(page, n + 8, 20_000)).slice(n);
      assert(after.every((r) => r.idx === r.prev + 1), `after Condensed went off plays still jumped: ${after.map((r) => `${r.prev}→${r.idx}`)}`);
      assert((await page.evaluate(() => JSON.parse(localStorage.getItem('nba-gm-live')).condensed)) === false, 'Condensed off wasn\'t saved');
      return `${acted} plays acted out, ${skipped} skipped past; normal again once switched off`;
    }),

    check('pause at breaks: the break card waits for Continue', { prefs: { speed: 8, pauseAtBreaks: true } }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const [q1] = periodBreaks(g.game.playByPlay);
      await tipOff(page);
      await pause(page);
      await seek(page, q1.i - 1);
      await play(page);
      await waitForCard(page, 'End of Q1', { timeout: 15_000 });
      await sleep(3500); // at 8x a break would otherwise be gone in under a second
      const v = await viewer(page);
      assert(v.card === 'End of Q1' && v.idx === q1.i + 1, `the break card didn't wait: card ${v.card}, play ${v.idx}`);
      await page.getByRole('button', { name: 'Continue ▸' }).click();
      await waitFor(async () => { const x = await viewer(page); return !x.card && x.idx > q1.i + 1; }, { timeout: 5000, what: 'play to resume after Continue' });
      return 'held for 3.5s at 8x, then went on at Continue';
    }),

    check('auto-watch: a sim stops at your next game and plays it in the viewer', { prefs: { speed: 8, autoWatch: true } }, async (page) => {
      await loadState(page, states.offday.file);
      const before = await readSave(page);
      const controls = await page.evaluate(() => {
        const c = document.querySelector('.controls[data-tour="sim-controls"]');
        return { buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()), text: c.textContent };
      });
      assert(!controls.buttons.includes('Watch ▶'), `with auto-watch on there's still a separate Watch button: ${controls.buttons}`);
      assert(controls.text.includes('Auto-watch is on: sims stop at your games.'), 'the auto-watch note is missing beside the sim buttons');
      // A sim of several days, which has to stop tomorrow, at the user's game.
      //
      // KNOWN ISSUE, why this isn't Sim Week: with auto-watch on, Sim Week
      // writes the watched game into the save before Continue. Its weekly
      // recap calls commit() and the game is simmed right after, before
      // React runs commit's updater — which then copies a league that
      // already has tonight in it (Calendar.jsx's simTo → animatedSimTo with
      // weeklyRecap, then watchTodaysGame). Sim to Next Event takes the same
      // path without the recap. Switch this to Sim Week once that's fixed.
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.getByRole('button', { name: 'Sim to Next Event' }).click();
        const opened = await waitFor(async () => {
          if (await page.$('.live-overlay')) return 'viewer';
          if (await page.$('.ui-modal-overlay:not(.live-overlay)')) return 'alert';
          return null;
        }, { timeout: 30_000, what: 'the viewer (or an alert that stops the sim)' });
        if (opened === 'viewer') break;
        await dismissOverlay(page); // an injury or the like cut the sim short: it comes first, then the game
      }
      await waitForCard(page, 'Tip-off');
      const g = await viewerGame(page);
      assert(g.game.home === before.userTeamId || g.game.away === before.userTeamId, `auto-watch opened ${g.game.away}@${g.game.home}, not a game of ${before.userTeamId}'s`);
      const mid = await readSave(page);
      assert(mid.dayIndex === before.dayIndex + 1, `while watching, the save is at day ${mid.dayIndex}; the sim should have stopped at ${before.dayIndex + 1}`);
      await tipOff(page);
      await skipToFinal(page);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      const after = await readSave(page);
      assert(after.dayIndex === before.dayIndex + 2, `after the game the save is at day ${after.dayIndex}, expected ${before.dayIndex + 2} — the sim ran past the game`);
      return `Sim to Next Event stopped after 1 day for ${g.game.away}@${g.game.home}`;
    }),

    check('Watch from the playoffs: round and game up top, the series on the final card', {}, async (page) => {
      await loadState(page, states.playoffs.file);
      const before = await readSave(page);
      await page.getByRole('button', { name: 'Watch ▶', exact: true }).click();
      await waitForCard(page, 'Tip-off');
      const g = await viewerGame(page);
      const card = await readCard(page);
      assert(card.kicker === 'First Round · Game 1', `kicker "${card.kicker}"`);
      assert(card.center.length === 0, `a series line before Game 1: "${card.center}"`);
      checkTipoffSide(card, card.sides[0], expectSide(before.teams[g.game.away], g.game.lineups[0].away, g.ctx.pregame), 'away');
      checkTipoffSide(card, card.sides[1], expectSide(before.teams[g.game.home], g.game.lineups[0].home, g.ctx.pregame), 'home');
      await tipOff(page);
      await skipToFinal(page);
      const fin = await readCard(page);
      const winner = g.game.homePts > g.game.awayPts ? g.home : g.away;
      assert(fin.center[0] === `${winner.name} lead the series 1–0`, `final card says "${fin.center[0]}"`);
      assert(await saveHash(page) === before.hash, 'the save changed before Continue');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      const after = await readSave(page);
      const m = after.playoffs.series.find((x) => [x.high, x.low].includes(before.userTeamId));
      assert(m.games.length === 1 && m.games[0].join() === [g.game.home, g.game.homePts, g.game.away, g.game.awayPts].join(), `the series in the save after Continue: ${JSON.stringify(m.games)}`);
      return `${fin.center[0]}; committed on Continue`;
    }),

    check('Watch from the play-in: records before tonight, committed on Continue', {}, async (page) => {
      await loadState(page, states.playin.file);
      const before = await readSave(page);
      await page.getByRole('button', { name: 'Watch ▶', exact: true }).click();
      await waitForCard(page, 'Tip-off');
      const g = await viewerGame(page);
      const card = await readCard(page);
      assert(card.kicker === 'Play-In · 7 vs. 8', `kicker "${card.kicker}"`);
      checkTipoffSide(card, card.sides[0], expectSide(before.teams[g.game.away], g.game.lineups[0].away, g.ctx.pregame), 'away');
      checkTipoffSide(card, card.sides[1], expectSide(before.teams[g.game.home], g.game.lineups[0].home, g.ctx.pregame), 'home');
      await tipOff(page);
      await skipToFinal(page);
      const winner = g.game.homePts > g.game.awayPts ? g.home : g.away;
      assert((await readCard(page)).center[0] === `${winner.city} ${winner.name} win`, 'final card note');
      assert(await saveHash(page) === before.hash, 'the save changed before Continue');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      const after = await readSave(page);
      assert(after.playIn.stage === 1 && after.playIn.East.winner === winner.id, `play-in after Continue: ${JSON.stringify(after.playIn.East)}`);
      return `${g.game.away}@${g.game.home} at ${card.sides[0].record} and ${card.sides[1].record}`;
    }),

    check('Watch from the NBA Cup: knockout records as they stand, committed on Continue', {}, async (page) => {
      await loadState(page, states.cup.file);
      const before = await readSave(page);
      await page.getByRole('button', { name: 'Watch ▶', exact: true }).click();
      await waitForCard(page, 'Tip-off');
      const g = await viewerGame(page);
      const card = await readCard(page);
      assert(card.kicker === 'NBA Cup · East Quarterfinal', `kicker "${card.kicker}"`);
      checkTipoffSide(card, card.sides[0], expectSide(before.teams[g.game.away], g.game.lineups[0].away, g.ctx.pregame), 'away');
      checkTipoffSide(card, card.sides[1], expectSide(before.teams[g.game.home], g.game.lineups[0].home, g.ctx.pregame), 'home');
      await tipOff(page);
      await skipToFinal(page);
      assert(await saveHash(page) === before.hash, 'the save changed before Continue');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      const after = await readSave(page);
      const mine = after.cup.East.find((x) => x.home === g.game.home && x.away === g.game.away);
      assert(mine?.winner && mine.homePts === g.game.homePts && mine.awayPts === g.game.awayPts, `Cup bracket after Continue: ${JSON.stringify(mine)}`);
      return `${g.game.away}@${g.game.home}`;
    }),

    check('Watch from the All-Star screen: an exhibition, no records, committed on Continue', {}, async (page) => {
      await loadState(page, states.allstar.file);
      // The next sim lands on All-Star Weekend.
      await page.locator('.controls[data-tour="sim-controls"] button').first().click();
      await waitFor(async () => {
        if (await page.$('.ui-modal-overlay')) await dismissOverlay(page);
        return page.evaluate(() => /All-Star Weekend/.test(document.querySelector('main')?.textContent ?? ''));
      }, { timeout: 30_000, what: 'the All-Star screen' });
      const before = await readSave(page);
      await page.getByRole('button', { name: 'Watch ▶', exact: true }).click();
      await waitForCard(page, 'Tip-off');
      const card = await readCard(page);
      assert(card.kicker === `All-Star Game · ${before.season}`, `kicker "${card.kicker}"`);
      assert(card.sides.every((s) => s.record == null && s.out == null), 'records or an injury list on an exhibition');
      assert(card.sides.every((s) => s.lines.length === 5), 'starting fives missing');
      await tipOff(page);
      const v = await skipToFinal(page);
      assert(await saveHash(page) === before.hash, 'the save changed before Continue');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitForViewerClosed(page);
      const after = await readSave(page);
      assert(after.allStar.game && after.allStar.game.homePts === v.home && after.allStar.game.awayPts === v.away, `All-Star result in the save ${JSON.stringify(after.allStar.game)}, watched ${v.away}-${v.home}`);
      const shown = await page.evaluate(() => [...document.querySelectorAll('h3')].map((h) => h.textContent).find((t) => /East \d+ – West \d+/.test(t)));
      assert(shown === `East ${v.home} – West ${v.away}`, `the All-Star screen shows "${shown}"`);
      return `Team West ${v.away}, Team East ${v.home}`;
    }),

    check('Watch replay from a box score: no records, Esc closes, nothing is saved', {}, async (page) => {
      await loadState(page, states.regular.file);
      const before = await readSave(page);
      const openReplay = async () => {
        await gotoNav(page, 'Schedule');
        await page.locator('a.team-link[title="View game"]').first().click();
        await page.getByRole('button', { name: 'Watch replay ▶' }).click();
        return waitForCard(page, 'Tip-off');
      };
      await openReplay();
      const g = await viewerGame(page);
      const card = await readCard(page);
      assert(card.kicker === 'Replay', `kicker "${card.kicker}"`);
      checkTipoffSide(card, card.sides[0], expectSide(before.teams[g.game.away], g.game.lineups[0].away, g.ctx.pregame), 'away');
      checkTipoffSide(card, card.sides[1], expectSide(before.teams[g.game.home], g.game.lineups[0].home, g.ctx.pregame), 'home');
      assert(card.sides.every((s) => s.out == null), 'an injury list on a replay');
      await tipOff(page);
      await waitFor(async () => (await viewer(page)).idx >= 5, { timeout: 10_000, what: 'a few plays' });
      await press(page, 'Escape');
      await waitForViewerClosed(page);
      await openReplay();
      await tipOff(page);
      const v = await skipToFinal(page);
      assert(v.finish === 'Close', `a replay's final offers "${v.finish}", expected Close`);
      await page.locator('.live-bar').getByRole('button', { name: 'Close', exact: true }).click();
      await waitForViewerClosed(page);
      assert(await saveHash(page) === before.hash, 'watching a replay changed the save');
      return `${g.game.away}@${g.game.home} (${g.game.awayPts}-${g.game.homePts})`;
    }),

    // Reduced motion, three ways: without it (so the measurements are known
    // to see motion when it's there), from the system setting, and from the
    // app's own preference.
    ...[
      ['reduced motion, control: without it, players run and the ball flies', {}, false],
      ['reduced motion from the system setting stops the players\' runs and the ball\'s flight', { reducedMotion: true }, true],
      ['reduced motion from the nba-gm-live preference stops the players\' runs and the ball\'s flight', { prefs: { speed: 8, reduceMotion: true } }, true],
    ].map(([name, opts, reduced]) => check(name, opts, async (page) => {
      await openFromCalendar(page, states.regular.file);
      await tipOff(page);
      const m = await page.evaluate(async () => {
        const svg = () => document.querySelector('.live-court > svg');
        let flights = 0;
        let runs = 0;
        let glide = 0;
        let rings = 0;
        let visibleRings = 0;
        const until = performance.now() + 4000;
        while (performance.now() < until) {
          const s = svg();
          if (s) {
            // The ball and the players move on the Web Animations API
            // (element.animate): plain Animations, not the CSS transitions
            // and keyframes. The ball is the group holding its circle; a
            // player, a group carrying his name as a <title>.
            const live = document.getAnimations().filter((a) => a.constructor === Animation && a.playState === 'running' && s.contains(a.effect?.target));
            const ball = s.querySelector('circle[r="0.62"]')?.parentElement;
            flights = Math.max(flights, live.filter((a) => ball?.contains(a.effect.target)).length);
            runs = Math.max(runs, live.filter((a) => a.effect.target.querySelector?.(':scope > title')).length);
            for (const g of s.querySelectorAll('g')) {
              if (!g.querySelector(':scope > title')) continue;
              glide = Math.max(glide, parseFloat(getComputedStyle(g).transitionDuration) || 0);
            }
            for (const r of s.querySelectorAll('.court-swish, .court-clank')) {
              rings += 1;
              if (getComputedStyle(r).display !== 'none') visibleRings += 1;
            }
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        return { flights, runs, glide, rings, visibleRings, htmlClass: document.documentElement.className };
      });
      if (!reduced) {
        assert(m.flights > 0, 'the ball never flew — the measurement can\'t see motion');
        assert(m.runs >= 5, `at most ${m.runs} players ran at once — the measurement can't see motion`);
        return `ball flights seen, up to ${m.runs} players running at once`;
      }
      assert(m.flights === 0, `the ball flew (${m.flights} running animations) with reduced motion on`);
      assert(m.runs === 0, `players still run (${m.runs} at once) with reduced motion on`);
      assert(m.glide <= 0.001, `players glide (transition ${m.glide}s) with reduced motion on`);
      assert(m.visibleRings === 0, `${m.visibleRings} swish/clank rings showed with reduced motion on`);
      if (opts.prefs?.reduceMotion) assert(/\breduce-motion\b/.test(m.htmlClass), '<html> lacks the reduce-motion class');
      return `no flights, no runs, ${m.rings ? 'rings hidden' : 'no rings'}`;
    })),

    check('a pause freezes a possession mid-set — every runner and the ball — and Play picks it up there', { prefs: { speed: 1 } }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      await tipOff(page);
      // A set well under way: most of the floor running at once.
      await page.waitForFunction(() => {
        const s = document.querySelector('.live-court > svg');
        return s && s.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.currentTime > 200).length >= 12;
      }, null, { timeout: 30_000, polling: 30 });
      const read = () => page.evaluate(() => {
        const s = document.querySelector('.live-court > svg');
        const at = (el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return `${m.e.toFixed(2)},${m.f.toFixed(2)}`; };
        const players = [...s.querySelectorAll('g')].filter((g) => g.querySelector(':scope > title')).map(at);
        return {
          pos: [...players, at(s.querySelector('circle[r="0.62"]').parentElement)].join(' '),
          running: s.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
          idx: Number(document.querySelector('.live-count').textContent.match(/^(\d+)/)[1]),
        };
      });
      const before = await read();
      await press(page, 'Space');
      await sleep(100);
      const a = await read();
      await sleep(900);
      const b = await read();
      assert(a.running === 0 && b.running === 0, `${a.running} animations still running after the pause`);
      assert(a.pos === b.pos, 'players or the ball moved while paused');
      assert(a.idx === b.idx, `the game went on while paused (${a.idx} → ${b.idx} plays)`);
      await press(page, 'Space');
      await sleep(250);
      const c = await read();
      assert(c.pos !== b.pos && c.running > 0, 'nothing moved after Play');
      return `${before.running} animations frozen for 0.9s, the same play carrying on after`;
    }),

    check('phone width (375px): no sideways scroll on any view or card', { viewport: { width: 375, height: 812 } }, async (page) => {
      await openFromCalendar(page, states.regular.file);
      const g = await viewerGame(page);
      const [q1] = periodBreaks(g.game.playByPlay);
      // The viewer's own content: anything wider than the screen that isn't
      // inside something that scrolls sideways on its own (a box score table
      // may), and the overlay scrolling sideways itself. Not the document's
      // width: that's the app behind the overlay, whose dashboard is a little
      // wider than a phone on its own (the sidebar's nav buttons) — a layout
      // issue of the app's, not the viewer's, and covered by the overlay.
      const overflow = () => page.evaluate(() => {
        const W = window.innerWidth;
        const bad = [];
        const ov = document.querySelector('.live-overlay');
        if (ov.scrollWidth > ov.clientWidth + 1) bad.push(`the viewer scrolls sideways (${ov.scrollWidth}px in ${ov.clientWidth}px)`);
        const scrolls = (el) => {
          for (let e = el.parentElement; e && !e.classList.contains('live-modal'); e = e.parentElement) {
            const ox = getComputedStyle(e).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
          }
          return false;
        };
        for (const el of document.querySelectorAll('.live-modal *')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > W + 1 || r.left < -1) && !scrolls(el)) {
            bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} spans ${Math.round(r.left)}–${Math.round(r.right)}px`);
          }
        }
        return bad.slice(0, 5);
      });
      const at = async (what) => { const bad = await overflow(); assert(!bad.length, `${what}: ${bad.join('; ')}`); };
      await at('tip-off card');
      await tipOff(page);
      await waitFor(async () => (await viewer(page)).idx >= 5, { timeout: 10_000, what: 'a few plays' });
      await at('court');
      for (const [key, label] of [['b', 'box score'], ['p', 'play-by-play'], ['c', 'court again']]) {
        await press(page, key);
        await sleep(300);
        await at(label);
      }
      await pause(page);
      await seek(page, q1.i - 1);
      await play(page);
      await waitForCard(page, 'End of Q1', { timeout: 15_000 });
      await at('break card');
      await skipToFinal(page);
      await at('final card');
      return 'tip-off, court, box score, play-by-play, break and final all fit';
    }),
  ];
}

const periods = (plays) => [...new Set(plays.map((p) => p.q))];
