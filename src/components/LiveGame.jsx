import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamBadge } from './TeamDisplay.jsx';
import { safeAccent, courtKit } from '../engine/colorUtils.js';
import {
  buildFrames, placeHighlights, periodBreaks, liveBox, pregame, teamFoulsByPlay, floorOrder,
} from './liveFrames.js';
import ArenaCourt, { KitSwatch, JerseyDot } from './ArenaCourt.jsx';
import { TipOffCard, BreakCard, FinalCard, HighlightBanner } from './LiveCards.jsx';
import { BoxTable } from './BoxScore.jsx';
import { useLivePrefs, getLivePrefs, setLivePrefs, LIVE_SPEEDS } from './livePrefs.js';
import { playSound, primeSound } from './liveSound.js';

// Watch a game unfold play by play.
//
// The game is already over by the time this mounts — simGame plays the whole
// thing synchronously and hands back the finished play-by-play (~400 plays).
// So this is a replay, not a live simulation, and nothing in the engine has
// to change for it. The seeded rng means the result was fixed the moment the
// day was simmed either way.
//
// What keeps it from being a spoiler is the mutate-then-commit model: the
// caller sims the day (which mutates the league in place) but does NOT
// commit, so React — and therefore every other screen — still shows the
// pre-game league. onFinish() is what finally reveals it.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Playback is paced on the game clock — real gaps between plays run from
// under a second to fifteen, and a flat beat per play reads as a slideshow —
// but with a floor for each kind of play, so every one stays on screen long
// enough to follow: a shot has to fly, a free throw has its routine.
//
// On the clock alone (45ms a game second, as it was) half of all plays were
// over in under 140ms, some shots in 70, and a whole game in two minutes:
// too fast to watch. This puts a game at about eight minutes at 1x, every
// shot on screen for at least a second, and 4x at about the old pace.
const MS_PER_GAME_SEC = 90;
const MAX_PLAY_MS = 2400;   // a dead-ball stretch shouldn't stall
const FLOOR_MS = { shot: 1100, ft: 950, reb: 650, blk: 650, stl: 700, tov: 700, foul: 800 };
const FLOOR_DEFAULT_MS = 500;
const WINDOW = 60;          // plays kept on screen; the full log is in the box score after
const SPEEDS = LIVE_SPEEDS;

// A beat after a result lands, before the next play starts moving: long
// enough to watch a basket drop and the score change, and to register a
// miss or the end of a trip to the line.
const dwellMs = (p, next) => (
  p?.k === 'shot' ? (p.m ? 700 : 250)
    : p?.k === 'ft' && next?.k !== 'ft' ? 350
      : 0
);

// The beats around the play. Tip-off waits for you, but not forever; a break
// card is a breath, shorter at higher speeds; a highlight banner rides along
// without stopping play.
const TIPOFF_MS = 4500;
const BREAK_MS = 3000;
const BANNER_MS = 2600;

// The keyboard, as the help card lists it.
const SHORTCUTS = [
  ['Space', 'Play / pause — or go on past a card'],
  ['← →', 'Back / forward a play'],
  ['N', 'Next basket'],
  ['R', 'Instant replay: the last possession again'],
  ['1 2 3', '1x · 2x · 4x'],
  ['C B P', 'Court · box score · play-by-play'],
  ['M', 'Sound on / off'],
  ['Enter', 'Go on past a card; close at the final'],
  ['Esc', 'Close at the final'],
  ['?', 'This list'],
];

// The ten on the floor, beside the court: [key, label, wide, value]. The
// columns marked wide only show when the panel has room (a container query).
const FLOOR_COLS = [
  ['pts', 'PTS', false, (l) => l.pts],
  ['reb', 'REB', false, (l) => l.reb],
  ['ast', 'AST', false, (l) => l.ast],
  ['stl', 'STL', true, (l) => l.stl],
  ['blk', 'BLK', true, (l) => l.blk],
  ['tov', 'TO', true, (l) => l.tov],
  ['fg', 'FG', false, (l) => `${l.fgm}-${l.fga}`],
  ['tp', '3P', true, (l) => `${l.tpm}-${l.tpa}`],
  ['ft', 'FT', true, (l) => `${l.ftm}-${l.fta}`],
  ['pf', 'PF', false, (l) => l.pf],
  ['pm', '+/-', true, (l) => (l.pm > 0 ? `+${l.pm}` : l.pm)],
];
// Someone who's yet to do anything has no line in the live box.
const BLANK_FLOOR_LINE = {
  pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, pf: 0, pm: 0,
};
// Plays in the ticker beside the court; it shows as many as fit.
const TICKER_PLAYS = 40;

const playMs = (play, gapSec, speed) =>
  Math.max(FLOOR_MS[play?.k] ?? FLOOR_DEFAULT_MS, Math.min(MAX_PLAY_MS, (gapSec ?? 4) * MS_PER_GAME_SEC))
    / Math.max(speed, 0.25);

// Frames — who's where, who has it, the ball's route — come from liveFrames.js,
// kept free of React so headless checks can run the same code.

// `ctx` says what kind of game this is, for the cards around it — see
// watchGame.js. Left out, it's tonight's regular-season game.
export default function LiveGame({ game, home, away, onFinish, ctx = null }) {
  const plays = game?.playByPlay ?? [];
  const [idx, setIdx] = useState(0);     // plays revealed so far — ticker, score, clock
  // The play the court is acting out, and over how long. It runs one play
  // ahead of `idx`: during the wait before a play the players move into it and
  // the ball makes its way there, and the play is revealed as it lands. Moving
  // on reveal instead left the screen frozen through every gap and crammed the
  // motion into the time after — so the run between possessions (the longest
  // gaps) spilled into the next few plays, and free throws went up mid-pan.
  const [stage, setStage] = useState({ k: 0, ms: 320 });
  // Speed starts where you last left it (livePrefs.js); 0 = paused.
  const [speed, setSpeed] = useState(() => getLivePrefs().speed);
  const [card, setCard] = useState(null);     // tip-off / break card holding play
  const [banner, setBanner] = useState(null); // a highlight riding along with play
  const [help, setHelp] = useState(false);    // the keyboard card
  const speedRef = useRef(speed);
  const prefs = useLivePrefs();
  const prefsRef = useRef(prefs);             // the loop reads this, not a stale closure
  prefsRef.current = prefs;
  // Playback position lives in a ref, not just state: the loop and "skip to
  // final" both move it, and a loop counting on its own local would overwrite
  // a skip on its very next tick.
  const posRef = useRef(0);
  const feedRef = useRef(null);
  const holdRef = useRef(null);      // ends the current tip-off/break hold early
  const bannerTimer = useRef(null);
  const finishedRef = useRef(false);     // onFinish is idempotent — close and skip both route here

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish?.();
  };

  // A pause in playback that a button can cut short. Infinity holds until
  // one does (pausing at every break, if that's the setting).
  const hold = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); holdRef.current = null; resolve(); };
    const timer = Number.isFinite(ms) ? setTimeout(done, ms) : null;
    holdRef.current = done;
  });
  const endHold = () => holdRef.current?.();

  // Running score after each play: plays only carry a score when someone
  // scored, so carry the last one forward. Precomputed once rather than
  // scanning backwards on every tick.
  const scoreAt = useMemo(() => {
    let last = { home: 0, away: 0 };
    return plays.map((p) => (p.score ? (last = p.score) : last));
  }, [plays]);

  const periodOrder = useMemo(() => [...new Set(plays.map((p) => p.q).filter(Boolean))], [plays]);

  const [view, setView] = useState('court'); // 'court' | 'box' | 'feed'
  const frames = useMemo(
    () => buildFrames(plays, game?.lineups, home, away),
    [plays, game, home, away],
  );
  // Read inside the playback loop, which must not restart when frames change.
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const rosterById = useMemo(() => {
    const m = new Map();
    for (const p of [...home.roster, ...away.roster]) m.set(p.id, p);
    return m;
  }, [home, away]);

  // The sim's own highlights, placed on the plays they belong to, and the
  // breaks between periods — see liveFrames.js.
  const highlights = useMemo(() => placeHighlights(plays, game?.events), [plays, game]);
  const breaks = useMemo(() => periodBreaks(plays), [plays]);
  const breakAt = useMemo(() => new Map(breaks.map((b) => [b.i, b])), [breaks]);
  const breakAtRef = useRef(breakAt);
  breakAtRef.current = breakAt;
  const pre = useMemo(() => pregame(game, home, away, ctx?.pregame), [game, home, away, ctx]);
  const fouls = useMemo(() => teamFoulsByPlay(plays), [plays]);
  // The live box: the app's own box-score table, fed lines rebuilt from the
  // plays so far. It looks players up through a league; these two rosters are
  // all it needs, and handing it the real league — already simmed past
  // tonight — would only invite a spoiler.
  const boxLeague = useMemo(() => ({ teams: [home, away], freeAgents: [] }), [home, away]);
  const order = useMemo(
    () => ({ home: floorOrder(game?.lineups, 'home'), away: floorOrder(game?.lineups, 'away') }),
    [game],
  );

  // What a condensed game stops to show: baskets, the sim's highlights, and
  // the last play of each period (so the breaks still come). Everything in
  // between lands at once.
  const keyPlays = useMemo(() => {
    const keys = new Set();
    plays.forEach((p, i) => { if (p.k === 'shot' && p.m) keys.add(i); });
    for (const i of highlights.byPlay.keys()) keys.add(i);
    for (const b of breaks) keys.add(b.i);
    return keys;
  }, [plays, highlights, breaks]);
  const keyRef = useRef(keyPlays);
  keyRef.current = keyPlays;

  // Playback loop. Mirrors Calendar's animatedSimTo: a local counter drives
  // the async loop so no tick reads a stale closure, and the cleanup flag
  // stops it if this unmounts mid-game.
  //
  // It runs for as long as the viewer is open, not only until the last play:
  // the position can be moved under it — the timeline, a jump, an instant
  // replay, rewinding from the final — and wherever it lands, play carries
  // on from there.
  useEffect(() => {
    if (!plays.length) return undefined;
    let cancelled = false;
    // Wait `ms` of playing time. The clock stops while paused — so a pause
    // freezes the game where it is instead of letting the play in flight land
    // — and the wait gives up the moment the position moves (a seek).
    const playFor = async (ms, at) => {
      let left = ms;
      while (left > 0) {
        if (cancelled || posRef.current !== at) return false;
        const tick = Math.min(left, 50);
        await delay(tick);
        if (speedRef.current !== 0) left -= tick;
      }
      return !cancelled && posRef.current === at;
    };
    (async () => {
      // The matchup first: until "Tip off", or a few seconds.
      if (posRef.current === 0) {
        setCard({ kind: 'tipoff' });
        await hold(TIPOFF_MS);
        if (cancelled) return;
        setCard(null);
      }
      while (!cancelled) {
        const s = speedRef.current;
        const k = posRef.current;
        if (s === 0 || k >= plays.length) { await delay(120); continue; } // paused, or at the final
        // Condensed: everything up to the next play worth showing lands at
        // once, and only that one is acted out.
        if (prefsRef.current.condensed && !keyRef.current.has(k)) {
          let j = k;
          while (j < plays.length && !keyRef.current.has(j)) j++;
          posRef.current = j;
          setIdx(j);
          setStage({ k: Math.max(0, Math.min(plays.length - 1, j - 1)), ms: 200 });
          await delay(220 / s); // a beat, so the jump reads as a cut
          continue;
        }
        // The wait before a play is that play's own share of the game clock,
        // and the court spends it acting the play out; motion gets 90% so it
        // has landed by the reveal.
        const wait = playMs(plays[k], framesRef.current[k]?.gap, s);
        setStage({ k, ms: wait * 0.9 });
        if (!(await playFor(wait, k))) { if (cancelled) return; continue; } // moved: carry on from there
        posRef.current = k + 1;
        setIdx(k + 1);
        // Let it land before the next play starts moving.
        const dwell = dwellMs(plays[k], plays[k + 1]) / Math.max(1, speedRef.current);
        if (dwell && !(await playFor(dwell, k + 1))) { if (cancelled) return; continue; }
        // End of a period: a beat before the next one starts — or, if that's
        // the setting, a stop until Continue.
        const brk = breakAtRef.current.get(k);
        if (brk && !brk.final) {
          setCard({ kind: 'break', brk });
          await hold(prefsRef.current.pauseAtBreaks ? Infinity : Math.max(900, BREAK_MS / Math.max(1, speedRef.current)));
          if (cancelled) return;
          if (posRef.current !== k + 1) continue;
          setCard(null);
        }
      }
    })();
    return () => { cancelled = true; endHold(); };
  }, [plays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sound for the play just revealed, when it's on — only in sequence: a jump
  // reveals plays in a lump, and a lump of swishes is just noise.
  const heardRef = useRef(0);
  useEffect(() => {
    const prev = heardRef.current;
    heardRef.current = idx;
    if (!prefsRef.current.sound || idx !== prev + 1) return;
    const i = idx - 1;
    const p = plays[i];
    if (p.k === 'shot' || p.k === 'ft') {
      if (p.m) playSound('swish');
      else if (!framesRef.current[i]?.blocked) playSound('rim');
    } else if (p.k === 'blk') playSound('block');
    if (breakAtRef.current.has(i)) playSound('buzzer');
    if (highlights.byPlay.get(i)?.some((e) => e.k === 'run' || e.k === 'clutch')) playSound('crowd');
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // The keyboard. One listener for the viewer's lifetime, calling whatever
  // the latest render set up (below the early return, where it can see
  // everything it needs).
  const keysRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => keysRef.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Focus moves into the viewer when it opens, as a dialog's should — left on
  // the button that opened it (now behind the viewer), Space would press
  // that button again instead of pausing the game.
  const modalRef = useRef(null);
  useEffect(() => { modalRef.current?.focus(); }, []);

  // A highlight rides along for a couple of seconds without stopping play.
  // Its timer isn't tied to `idx`: the next play usually lands well before
  // the banner should go.
  useEffect(() => {
    const evs = highlights.byPlay.get(idx - 1);
    if (!evs?.length) return;
    clearTimeout(bannerTimer.current);
    setBanner({ key: idx - 1, events: evs });
    bannerTimer.current = setTimeout(() => setBanner(null), Math.max(1200, BANNER_MS / Math.max(1, speedRef.current)));
  }, [idx, highlights]);
  useEffect(() => () => clearTimeout(bannerTimer.current), []);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [idx]);

  // Leaving without finishing would strand the day un-revealed.
  useEffect(() => finish, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The court for the play just shown. Positions off the ball are derived
  // rather than simulated — see courtPositions.js. (Above the early return:
  // a hook below one runs on some renders and not others.)
  const court = useMemo(() => {
    const f = frames[Math.min(stage.k, frames.length - 1)];
    if (!f?.players?.length) return null;
    return {
      ...f,
      // Made or missed is the play's result: it waits for the reveal.
      shot: frames[idx - 1]?.shot ?? null,
    };
  }, [frames, stage.k, idx]);

  // The box as of the last play revealed — built only while it's on screen.
  const liveLines = useMemo(() => {
    if (view !== 'box') return null;
    const box = liveBox(plays, idx, { frames, lineups: game?.lineups });
    // Whole minutes, like the box score: a clock that's run 2:40 shows 2.
    const side = (s) => order[s].filter((id) => box.has(id))
      .map((id) => ({ ...box.get(id), min: Math.floor(box.get(id).min + 1e-9) }));
    return { home: side('home'), away: side('away') };
  }, [view, plays, idx, frames, game, order]);
  // The lines beside the court: everyone's numbers as of the last play
  // revealed, for the ten on the floor. +/- needs the frames; minutes would
  // need the lineups, and aren't shown.
  const floorBox = useMemo(
    () => (view === 'court' ? liveBox(plays, idx, { frames }) : null),
    [view, plays, idx, frames],
  );
  // Injuries reach the box score as they happen, not before.
  const hurtSoFar = useMemo(() => {
    if (view !== 'box') return [];
    const seen = new Set();
    for (const [i, evs] of highlights.byPlay) if (i < idx) for (const e of evs) if (e.k === 'injury') seen.add(e.p);
    const over = idx >= plays.length;
    return (game?.injuryReport ?? []).filter((e) => over || seen.has(e.playerId));
  }, [view, highlights, idx, plays, game]);

  if (!plays.length) return null;

  const done = idx >= plays.length;
  const cur = plays[Math.max(0, idx - 1)];
  const score = idx > 0 ? scoreAt[idx - 1] : { home: 0, away: 0 };
  const shown = plays.slice(Math.max(0, idx - WINDOW), idx);
  const curPeriodIdx = idx > 0 ? periodOrder.indexOf(cur.q) : 0;

  const setSpeedBoth = (s) => { speedRef.current = s; setSpeed(s); };
  // A speed you pick is the one the next game starts at.
  const chooseSpeed = (s) => { setSpeedBoth(s); setLivePrefs({ speed: s }); };
  const togglePause = () => setSpeedBoth(speed === 0 ? 1 : 0);

  // Move playback to just before play `i`: everything before it revealed,
  // the court on the last of those, any card holding play let go. The loop
  // carries on from there — or stays paused.
  const seekTo = (i, ms = 250) => {
    const t = Math.max(0, Math.min(plays.length, i));
    posRef.current = t;
    endHold();
    setCard(null);
    setIdx(t);
    setStage({ k: Math.max(0, Math.min(plays.length - 1, t - 1)), ms });
  };
  const skipToEnd = () => seekTo(plays.length, 320);
  // A play at a time, paused, slow enough to see what happened.
  const step = (d) => { setSpeedBoth(0); seekTo(posRef.current + d, 600); };
  const nextBasket = () => {
    for (let i = posRef.current; i < plays.length; i++) {
      if ((plays[i].k === 'shot' || plays[i].k === 'ft') && plays[i].m) {
        seekTo(i);
        if (speedRef.current === 0) setSpeedBoth(1);
        return;
      }
    }
  };
  // Instant replay: back to the start of the possession just shown, at 1x.
  const replay = () => {
    const last = posRef.current - 1;
    if (last < 0) return;
    let j = last;
    while (j > 0 && plays[j - 1].n === plays[last].n) j--;
    seekTo(j);
    setSpeedBoth(1);
  };
  const toggleSound = () => {
    const on = !prefs.sound;
    if (on) primeSound(); // inside the click, so the browser lets audio start
    setLivePrefs({ sound: on });
  };

  // Where each period starts, for the line score and the timeline. Overtime
  // only appears once it's reached — shown from tip-off, an OT column or
  // tick would give the ending away.
  const periodStart = (i) => (i === 0 ? 0 : (breaks[i - 1]?.i ?? plays.length - 1) + 1);
  const shownPeriods = periodOrder.map((q, i) => ({ q, i, at: periodStart(i) }))
    .filter((pd) => pd.i < 4 || idx >= pd.at || done);
  // The timeline likewise stops at the end of regulation until then.
  const regEnd = breaks.find((b) => b.per === 3 && !b.final);
  const timelineMax = regEnd && idx < regEnd.i + 1 ? regEnd.i + 1 : plays.length;
  const lastTwo = plays.findIndex((p) => p.q === 'Q4' && (p.sec ?? Infinity) <= 120);

  keysRef.current = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (tag === 'BUTTON' && e.key === 'Enter') return; // a focused button's own Enter
    const k = e.key;
    let handled = true;
    if (k === ' ') { if (card) endHold(); else if (!done) togglePause(); }
    else if (k === 'ArrowRight') step(1);
    else if (k === 'ArrowLeft') step(-1);
    else if (k === 'n' || k === 'N') nextBasket();
    else if (k === 'r' || k === 'R') replay();
    else if (k === '1' || k === '2' || k === '3') chooseSpeed(SPEEDS[+k - 1]);
    else if (k === 'c' || k === 'C') setView('court');
    else if (k === 'b' || k === 'B') setView('box');
    else if (k === 'p' || k === 'P') setView('feed');
    else if (k === 'm' || k === 'M') toggleSound();
    else if (k === 'Enter') { if (card) endHold(); else if (done) finish(); else handled = false; }
    else if (k === 'Escape') { if (help) setHelp(false); else if (done || ctx?.replay) finish(); else handled = false; }
    else if (k === '?') setHelp((h) => !h);
    else handled = false;
    if (handled) e.preventDefault();
  };

  const homeColor = safeAccent(home.color);
  const awayColor = safeAccent(away.color);
  const leader = score.home === score.away ? null : score.home > score.away ? 'home' : 'away';
  // Team fouls this period, and who's in the bonus: the side whose opponent
  // has reached the limit, so any common foul against it is shot.
  const tf = idx > 0 ? fouls[idx - 1] : { home: 0, away: 0, bonusAt: 5 };
  const foulLine = (s) => !done && (
    <div className="live-fouls">
      <span>Fouls {tf[s]}</span>
      {tf[s === 'home' ? 'away' : 'home'] >= tf.bonusAt && (
        <span className="live-bonus" title="In the bonus: common fouls against them go to the line">Bonus</span>
      )}
    </div>
  );
  const onFloor = new Set((frames[Math.max(0, idx - 1)]?.players ?? []).map((x) => x.id));
  const teamFor = (side) => (side === 'home' ? home : away);
  // Home in white, away in colour, as on the court (courtKit).
  const kitFor = (side) => courtKit(teamFor(side).color, side === 'home');
  // A side's five as the court shows them, in the order they took the floor
  // (floorOrder) so the list doesn't reshuffle with every basket.
  const floorIds = (side) => {
    const rank = (id) => { const r = order[side].indexOf(id); return r < 0 ? Infinity : r; };
    return (court?.players ?? []).filter((x) => x.side === side).map((x) => x.id).sort((a, b) => rank(a) - rank(b));
  };
  // The scoreboard's badge carries the jersey the team wears on the court —
  // the legend the court needs, without a line of its own under it.
  const badge = (side) => (
    <span className="live-badge" title={`${teamFor(side).name}: ${side === 'home' ? 'white' : 'team colors'} on the court`}>
      <TeamBadge team={teamFor(side)} />
      <span className="live-kit"><KitSwatch kit={kitFor(side)} size={14} /></span>
    </span>
  );
  // Possession, scorebug-style: a ball beside the score of the team that has it.
  const poss = !done && court ? court.offSide : null;
  const possDot = (side) => (
    <span
      className={`live-poss${poss === side ? ' is-on' : ''}`}
      role={poss === side ? 'img' : undefined}
      aria-label={poss === side ? `${teamFor(side).name} ball` : undefined}
      title={poss === side ? `${teamFor(side).name} have the ball` : undefined}
    />
  );
  const sideOfPlayer = (id) => (home.roster.some((p) => p.id === id) ? 'home' : 'away');
  const nameOf = (id) => rosterById.get(id)?.name ?? '';

  // The play just revealed, if it was a shot landing: a make gets its swish
  // and points, a miss a glance off the rim — unless it was blocked, and
  // never reached the rim at all.
  const last = plays[idx - 1];
  const lastFrame = frames[idx - 1];
  const moment = last && lastFrame && (last.k === 'shot' || last.k === 'ft') && !(lastFrame.blocked)
    ? {
      key: idx - 1,
      made: !!last.m,
      pts: last.k === 'ft' ? 1 : last.pts,
      top: lastFrame.attackTop,
      color: safeAccent(teamFor(lastFrame.offSide).color),
    }
    : null;

  // Break card: the period's score and who's leading each side so far.
  const breakCard = card?.kind === 'break' && (() => {
    const { i, per, q } = card.brk;
    const box = liveBox(plays, i + 1);
    const lead = (side) => {
      let best = null;
      for (const [id, l] of box) {
        if (sideOfPlayer(id) !== side) continue;
        if (!best || l.pts > best.pts) best = { name: nameOf(id), ...l };
      }
      return best;
    };
    const s = scoreAt[i];
    // Only the final break goes untitled here (the final card has it), so a
    // break at the end of the 4th means a tie and more basketball.
    const title = per === 1 ? 'Halftime' : per === 3 ? 'End of regulation' : `End of ${q}`;
    return {
      title,
      score: s,
      period: { home: game.homeQtrs?.[per] ?? 0, away: game.awayQtrs?.[per] ?? 0 },
      leaders: { home: lead('home'), away: lead('away') },
      notes: (highlights.periodNotes.get(per) ?? []).map((e) => e.text),
    };
  })();

  // Final card: the whole box score is fair game now.
  const finalTop = (side) => (side === 'home' ? game.homeBox : game.awayBox)
    .map((l) => ({ id: l.playerId, name: nameOf(l.playerId), pts: l.pts, reb: l.reb, ast: l.ast }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3);

  const tdBase = { padding: '3px 6px', verticalAlign: 'top', fontSize: 13 };

  return (
    // Opaque, not the usual translucent scrim. simDay has already mutated the
    // league in place, so although nothing is committed or saved, any render
    // triggered while this is open would re-read those mutated team objects
    // and show tonight's result behind the viewer. Covering the app entirely
    // is what keeps the game unspoiled until Continue.
    <div className="ui-modal-overlay live-overlay" style={{ background: 'var(--surface-0)' }}>
      <div className="ui-modal ui-modal--wide live-modal" role="dialog" aria-modal="true" ref={modalRef} tabIndex={-1}>

        {/* Scoreboard. Each score is keyed by its value, so a basket remounts it
            and the pop plays. */}
        <div className="live-scoreboard">
          <div className="live-team live-team--away">
            {badge('away')}
            <div className="live-team-text">
              <div className="live-city">{away.city}</div>
              <div className="live-name">{away.name}</div>
              {foulLine('away')}
            </div>
            {possDot('away')}
            <div
              key={`a${score.away}`}
              className={`live-score${score.away > 0 ? ' live-score--pop' : ''}`}
              style={{ color: leader === 'away' ? awayColor : 'var(--text-primary)' }}
            >
              {score.away}
            </div>
          </div>

          <div className="live-clock">
            {done ? (
              <span className="live-clock-final">FINAL</span>
            ) : (
              <>
                <span className="live-clock-q">{idx > 0 ? cur.q : 'Q1'}</span>
                <span className="live-clock-t">{idx > 0 ? cur.t : '12:00'}</span>
              </>
            )}
          </div>

          <div className="live-team live-team--home">
            <div
              key={`h${score.home}`}
              className={`live-score${score.home > 0 ? ' live-score--pop' : ''}`}
              style={{ color: leader === 'home' ? homeColor : 'var(--text-primary)' }}
            >
              {score.home}
            </div>
            {possDot('home')}
            <div className="live-team-text">
              <div className="live-city">{home.city}</div>
              <div className="live-name">{home.name}</div>
              {foulLine('home')}
            </div>
            {badge('home')}
          </div>

          {/* Line score — a quarter fills in once play moves past it, and each
              one jumps to its start. Under the clock on a computer, a row of
              its own on a phone (CSS). */}
          {periodOrder.length > 0 && (
            <div className="live-linescore">
              {shownPeriods.map(({ q, i, at }) => (
                <button
                  key={q} type="button" className="live-period" onClick={() => seekTo(at)}
                  title={`Jump to the start of ${q}`}
                  style={{ opacity: i <= curPeriodIdx ? 1 : 0.3 }}
                >
                  <div className="live-period-q">{q}</div>
                  <div className="live-period-score">
                    {i < curPeriodIdx || done
                      ? `${game.awayQtrs?.[i] ?? '–'}–${game.homeQtrs?.[i] ?? '–'}`
                      : i === curPeriodIdx ? '·' : '–'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="live-stage">
          {/* Court */}
          {view === 'court' && court && (
            <div className="live-court-row">
              <div className="live-court">
                <ArenaCourt
                  players={court.players}
                  holderId={court.holderId}
                  actorId={court.actorId}
                  act={court.act}
                  // Held at its starting point until tip-off: the court is
                  // already staged on the opening play, and its flight would
                  // otherwise run (and finish) behind the tip-off card.
                  ballPath={card?.kind === 'tipoff' ? court.ballPath.slice(0, 1) : court.ballPath}
                  shot={court.shot}
                  attackTop={court.attackTop}
                  homeTeam={home}
                  awayTeam={away}
                  playerById={(id) => rosterById.get(id)}
                  moment={moment}
                  // The wait before the staged play: a long gap between
                  // possessions is the run up the floor.
                  moveMs={stage.ms}
                />
                {banner && !card && (
                  <HighlightBanner
                    key={banner.key}
                    events={banner.events}
                    color={safeAccent(teamFor(banner.events[0].side ?? (sideOfPlayer(banner.events[0].p)))?.color)}
                  />
                )}
              </div>
              {/* Beside the court: who the numbers on the floor are and how
                  they're doing, then the plays so far, so the court has a
                  caption. */}
              <div className="live-side">
                {floorBox && (
                  <table className="live-floor" aria-label="On the floor">
                    <thead>
                      <tr>
                        <th colSpan={2} className="live-floor-title">On the floor</th>
                        {FLOOR_COLS.map(([k, label, wide]) => (
                          <th key={k} className={wide ? 'is-wide' : undefined}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    {['away', 'home'].map((s) => (
                      <tbody key={s}>
                        <tr className="live-floor-team">
                          <th colSpan={2 + FLOOR_COLS.length}>
                            <KitSwatch kit={kitFor(s)} /> {teamFor(s).name}
                            {court.offSide === s && <span className="live-floor-ball">ball</span>}
                          </th>
                        </tr>
                        {floorIds(s).map((id) => {
                          const p = rosterById.get(id);
                          const l = floorBox.get(id);
                          return (
                            <tr key={id} className={id === court.holderId ? 'has-ball' : undefined}>
                              <td className="live-floor-num"><JerseyDot kit={kitFor(s)} number={p?.jerseyNumber ?? ''} /></td>
                              <td className="live-floor-name">
                                {p?.name ?? id}<span className="live-floor-pos">{p?.pos}</span>
                              </td>
                              {FLOOR_COLS.map(([k, , wide, show]) => (
                                <td
                                  key={k}
                                  className={wide ? 'is-wide' : undefined}
                                  {...(k === 'pf' && l?.pf >= 5 ? { style: { color: 'var(--color-warning)', fontWeight: 700 }, title: 'One foul from fouling out' } : {})}
                                >
                                  {show(l ?? BLANK_FLOOR_LINE)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    ))}
                  </table>
                )}
                <div className="live-ticker">
                  {plays.slice(Math.max(0, idx - TICKER_PLAYS), idx).reverse().map((e, i) => (
                    <div key={idx - i} className={`live-ticker-play${i === 0 ? ' is-latest' : ''}`}>
                      <span className="live-ticker-clock">{e.q} {e.t}</span>
                      {e.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Box score, live */}
          {view === 'box' && liveLines && (
            <div className="live-box">
              {[['away', away], ['home', home]].map(([s, team]) => (
                <div key={s} className="ui-table-wrap">
                  <BoxTable
                    league={boxLeague} teamId={team.id} pts={score[s]} box={liveLines[s]}
                    injuryReport={hurtSoFar} live={{ onFloor }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Feed */}
          {view === 'feed' && (
          <div ref={feedRef} style={{ overflowY: 'auto', flex: 1, minHeight: 240 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={idx - shown.length + i} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)' }}>
                    <td style={{ ...tdBase, width: '44%', textAlign: 'left' }}>{e.side === 'away' && e.text}</td>
                    <td style={{ ...tdBase, width: '12%', textAlign: 'center', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {e.q}{e.t ? ` ${e.t}` : ''}
                      {e.score && (
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 11, marginTop: 2 }}>
                          {e.score.away}–{e.score.home}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdBase, width: '44%', textAlign: 'right' }}>{e.side === 'home' && e.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {help && (
            <div className="live-card-scrim" onClick={() => setHelp(false)}>
              <div className="live-card live-help" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
                <div className="live-card-kicker">Keyboard</div>
                <dl className="live-help-list">
                  {SHORTCUTS.map(([keys, what]) => (
                    <React.Fragment key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></React.Fragment>
                  ))}
                </dl>
                <div className="live-card-actions">
                  <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => setHelp(false)}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* The beats around play: tip-off, breaks, the result. */}
          {(card?.kind === 'tipoff' || breakCard || done) && (
            <div className="live-card-scrim">
              {card?.kind === 'tipoff' && (
                <TipOffCard home={home} away={away} pre={pre} onStart={endHold} kicker={ctx?.kicker} subtitle={ctx?.subtitle} />
              )}
              {breakCard && <BreakCard home={home} away={away} {...breakCard} onContinue={endHold} />}
              {done && !card && (
                <FinalCard
                  home={home} away={away} score={score}
                  top={{ home: finalTop('home'), away: finalTop('away') }}
                  notes={highlights.post.map((e) => e.text.replace(/^🩹\s*/, ''))}
                  note={ctx?.finalNote}
                />
              )}
            </div>
          )}
        </div>

        {/* Transport, video-player style: play, speed, then the timeline —
            drag or click to move through the game, quarters marked — and
            skip. The range input carries the keyboard too (arrows, Home,
            End). On a phone the timeline takes a row of its own (CSS). */}
        <div className="live-bar">
          {done ? (
            <button className="ui-btn ui-btn--primary ui-btn--md" onClick={finish}>{ctx?.replay ? 'Close' : 'Continue'}</button>
          ) : (
            <>
              <button className="ui-btn ui-btn--secondary ui-btn--md live-play" onClick={togglePause}>
                {speed === 0 ? '▶ Play' : '❙❙ Pause'}
              </button>
              <div className="live-speeds">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`ui-btn ui-btn--md ${speed === s ? 'ui-btn--primary' : 'ui-btn--secondary'}`}
                    onClick={() => chooseSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="live-timeline">
            <input
              type="range" min={0} max={timelineMax} step={1} value={Math.min(idx, timelineMax)}
              onChange={(e) => seekTo(+e.target.value)}
              aria-label="Game timeline" aria-valuetext={idx > 0 ? `${cur.q} ${cur.t}` : 'Tip-off'}
            />
            <div className="live-timeline-ticks" aria-hidden="true">
              {shownPeriods.filter((pd) => pd.at > 0 && pd.at < timelineMax).map((pd) => (
                <span key={pd.q} style={{ left: `${(pd.at / timelineMax) * 100}%` }}>{pd.q}</span>
              ))}
            </div>
          </div>
          {!done && (
            <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={skipToEnd} title="Skip to final">
              {/* one child: the button spaces its children apart */}
              <span>Skip<span className="live-long"> to final</span> ▸▸</span>
            </button>
          )}
        </div>

        <div className="live-tools">
          <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={replay} disabled={idx === 0} title="Instant replay: the last possession again (R)">⟲ Replay</button>
          <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={nextBasket} disabled={done} title="Next basket (N)">Next basket ▸</button>
          {lastTwo > 0 && (
            <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => seekTo(lastTwo)} title="The last two minutes of regulation">Last 2:00</button>
          )}
          <label className="live-toggle" title="Only baskets and highlights; everything else lands at once">
            <input type="checkbox" checked={prefs.condensed} onChange={(e) => setLivePrefs({ condensed: e.target.checked })} />
            Condensed
          </label>
          <button
            className="ui-btn ui-btn--secondary ui-btn--sm" onClick={toggleSound} aria-pressed={prefs.sound}
            title={prefs.sound ? 'Sound on — turn off (M)' : 'Sound off — turn on (M)'} aria-label={prefs.sound ? 'Sound on' : 'Sound off'}
          >
            {prefs.sound ? 'Sound on' : 'Sound off'}
          </button>
          <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setHelp((h) => !h)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
          <div className="live-views">
            {[['court', 'Court'], ['box', 'Box score'], ['feed', 'Play-by-play']].map(([v, label]) => (
              <button
                key={v}
                aria-pressed={view === v}
                className={`ui-btn ui-btn--sm ${view === v ? 'ui-btn--primary' : 'ui-btn--secondary'}`}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="live-count">{idx} / {plays.length} plays</span>
        </div>
      </div>
    </div>
  );
}
