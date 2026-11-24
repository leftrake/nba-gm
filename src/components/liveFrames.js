// Turns a game's play-by-play into frames a court can be drawn from.
//
// Plain JS on purpose — no React — so headless checks can import the exact
// code the viewer runs and measure it, instead of re-implementing it in a
// test and hoping the two agree.
//
// Frames are in full-court coordinates: x -25..25 across, y 0..94 from the
// bottom baseline. Each team attacks one basket and they switch at halftime,
// so a change of possession is a run to the other end rather than the whole
// floor rearranging in place — which, drawn on a single half court, put 63%
// of player moves on a change of possession over 8ft in a fraction of a
// second.

import {
  assignSpots, offenseFormation, defenseFormation, positionMatchups, clearSpace, reboundSpot,
  freeThrowFormation, OFFENSIVE_SPOTS as SPOTS,
} from '../engine/courtPositions.js';
import { BOX_COLS } from '../engine/sim.js';

export const COURT_LEN = 94;
const RIM = { x: 0, y: 5.25 };
const FT_SPOT = { x: 0, y: 19 };   // 15ft from a backboard that sits 4ft in from the baseline
const BRING_UP = { x: 0, y: 26 };  // where a possession starts when nobody has set up yet

export const periodIdx = (q) => (q?.startsWith('Q') ? +q[1] - 1 : q === 'OT' ? 4 : 3 + parseInt(q, 10) || 0);
const clockSec = (t) => {
  const m = /^(\d+):(\d+)$/.exec(t || '');
  return m ? +m[1] * 60 + +m[2] : 0;
};

// Teams switch ends at halftime; overtime keeps the second-half ends.
export const attacksTop = (side, per) => (side === 'home') === (per < 2);

// Half-court coordinates (the space the sim emits shots in: origin at the
// attacked rim, y out from its baseline) to the full court. The top basket
// is the bottom one turned 180°, so one set of half-court geometry serves
// both ends.
export const toWorld = (pt, top) => (top ? { x: -pt.x, y: COURT_LEN - pt.y } : { x: pt.x, y: pt.y });

// Deterministic per play, for the cosmetic things that need to vary.
const playHash = (p) =>
  ((((p.n ?? 0) + 1) * 2654435761) ^ Math.round((p.sec ?? 0) * 100) ^ ((p.p ?? 0) * 40503)) >>> 0;

// `pt` moved `d` feet further from the rim, along the line from it.
const fartherOut = (pt, d) => {
  const len = Math.hypot(pt.x - RIM.x, pt.y - RIM.y) || 1;
  return { x: pt.x + ((pt.x - RIM.x) / len) * d, y: pt.y + ((pt.y - RIM.y) / len) * d };
};

// Somewhere in the lane, for a shooting foul whose attempt the sim never
// placed: two shots and no location reads as a drive.
const driveSpot = (h) => ({ x: (h & 1 ? 1 : -1) * (2 + ((h >>> 1) % 4)), y: 6 + ((h >>> 3) % 5) });

// Who the play pits against whom: the defender contesting a shot, the
// blocker and the man he blocked, the fouler and the man he fouled. Every
// shot names its contest defender (`d`, which the sim makes the blocker on a
// blocked shot and the fouler on an and-one), so this is never a guess.
function confrontation(p, onOff, onDef) {
  if (p.k === 'shot' && onDef(p.d) && onOff(p.p)) return { actor: p.d, target: p.p, act: 'contest' };
  if (p.k === 'blk' && onDef(p.p) && onOff(p.v)) return { actor: p.p, target: p.v, act: 'block' };
  if (p.k === 'foul' && onDef(p.p)) return { actor: p.p, target: onOff(p.v) ? p.v : null, act: 'foul' };
  return null;
}

// When the ball gets to each point of a route nobody choreographed: time
// shared out by distance, so it keeps a steady pace, with time in the air
// counting extra — or a short jumper's arc is over before it's seen.
function timeRoute(route) {
  const legs = route.slice(1).map((w, i) => {
    const a = route[i];
    return Math.hypot(w.x - a.x, w.y - a.y) + ((w.h || a.h) ? 4 : 0) + 0.01;
  });
  const total = legs.reduce((s, d) => s + d, 0);
  let acc = 0;
  return route.map((w, i) => ({ ...w, t: i === 0 ? 0 : Math.min(1, (acc += legs[i - 1]) / total) }));
}

// ---- Acting out the set ---------------------------------------------------------
//
// The sim records how a possession ended — who shot from where, who assisted,
// who turned it over or was fouled — but not the play that got there, and a
// possession drawn as everyone sliding straight into the shot looked like a
// ball being shot, not like basketball. So the court acts one out, made up
// the way the floor positions are (courtPositions.js): the ball brought up
// the floor, moved for a beat or two, and worked to the man who ends the
// possession by the route the result implies — an assist is the last pass,
// to a shooter arriving at his spot; an unassisted shot is a player creating
// his own; a post-up is a big fed on the block. None of it is simulated,
// nothing but the court reads it, and it's fixed per play (playHash), never
// the game's rng.
//
// A set is the first play of a possession — the sim's later plays in one
// come within 2.5 seconds of the game clock, too quick to have one — and it
// runs in fractions of the play's time on screen: up the floor first, then
// the actions (more of them the longer the possession took on the game
// clock), then the moment itself, and for a shot its flight takes the rest.
// Everyone is exactly where the play's frame has them at the moment.

const PASS_T = 0.06;         // a pass in the air
const FINAL_T = 0.13;        // the last move into the moment: the assist, or the shooter's own
const MOMENT = { shot: 0.66, other: 0.86 };
const SUB_IN = { x: 26.5, y: 47 };   // world: the scorer's table, where a sub comes on from

// A point `d` feet out from the rim, on the line to `from` — where a drive gets to.
const toward = (from, d) => {
  const len = Math.hypot(from.x - RIM.x, from.y - RIM.y) || 1;
  return { x: +(RIM.x + ((from.x - RIM.x) / len) * d).toFixed(2), y: +(RIM.y + ((from.y - RIM.y) / len) * d).toFixed(2) };
};

// The opening tip: the centers in the circle, everyone else around it on
// their own side of half court — in attacked-end coordinates, where the team
// that wins it defends the far basket, so their half is y > 47.
function tipLayout(offP, defP) {
  const jumper = (ps) => (ps.find((x) => x.pos === 'C') ?? ps.find((x) => x.pos === 'PF') ?? ps[0]).id;
  const oj = jumper(offP);
  const dj = jumper(defP);
  const around = [{ x: -9, y: 5 }, { x: 9, y: 5 }, { x: -5, y: 13 }, { x: 5, y: 13 }];
  const at = { [oj]: { x: 0, y: 48.6 }, [dj]: { x: 0, y: 45.4 } };
  offP.filter((x) => x.id !== oj).forEach((x, i) => { at[x.id] = { x: around[i % 4].x, y: 47 + around[i % 4].y }; });
  defP.filter((x) => x.id !== dj).forEach((x, i) => { at[x.id] = { x: around[i % 4].x, y: 47 - around[i % 4].y }; });
  return at;
}

// The set, in attacked-end coordinates throughout (y runs on past half court
// to 94, the far baseline). `start` is where everyone is when the play's time
// begins and `ball0` where the ball is; `finalAt` and `finishAt` are where
// the frame has everyone, and the ball, at the moment. Returns each player's
// route and the ball's, as [{ x, y, t }] (the ball's points also carry h,
// held and — while held — by).
function actOut(c) {
  const {
    offP, defP, spots, matchups, start, ball0, finalAt, finishAt, finisher, assister,
    carrier, tip, gap, hash, isShot, blocked,
  } = c;
  const posOf = new Map([...offP, ...defP].map((x) => [x.id, x.pos]));
  const offIds = offP.map((x) => x.id);
  const big = (id) => posOf.get(id) === 'C' || posOf.get(id) === 'PF';
  const pg = offIds.find((id) => posOf.get(id) === 'PG') ?? offIds.find((id) => !big(id)) ?? offIds[0];
  const side = hash & 1 ? 1 : -1;
  const bit = (n) => (hash >>> n) & 1;
  const actions = gap >= 12.5 ? 2 : gap >= 7 ? 1 : 0;
  const moment = isShot ? MOMENT.shot : MOMENT.other;
  const tAdv = actions === 0 ? 0.4 : actions === 1 ? 0.3 : 0.24;

  // Everyone around the ball: the offense spaced off whoever has it, the
  // defense on their men (courtPositions.js). `extra` places anyone the
  // play needs somewhere else — a screener.
  const formation = (ball, by, extra = null) => {
    const O = { ...offenseFormation(offP, ball, by, clearSpace(spots, offP, ball, by)), ...extra };
    const onBall = Object.keys(matchups).find((d) => String(matchups[d]) === String(by));
    return { ...O, ...defenseFormation(O, matchups, ball, onBall) };
  };
  const beats = [];
  const last = { ...start };
  let by = null;
  let at = ball0;
  const beat = (t, pos, ball, who) => {
    beats.push({ t, at: pos, ball, by: who });
    Object.assign(last, pos);
    at = ball;
    by = who;
  };
  // He holds it where he stands, then lets it go: a pass leaves late.
  const hold = (t) => beat(t, { [by]: last[by] ?? at }, last[by] ?? at, by);

  // Up the floor: whoever has it pushes it, a big outlets it to the point
  // guard, and after a score it comes in from under the far basket. On the
  // opening tip, it's tapped back to the guard.
  if (tip) {
    const to = { x: side * 5, y: 51 };
    beat(0.07, { [pg]: to }, to, pg);
  } else if (carrier != null && last[carrier]) {
    by = carrier;
    at = last[carrier];
    if (big(carrier) && carrier !== pg && at.y > 55) {
      const outlet = { x: side * 17, y: Math.min(80, at.y - 8) };
      hold(0.04);
      beat(0.12, { [pg]: outlet }, outlet, pg);
    }
  } else {
    const inb = offIds.find((id) => posOf.get(id) === 'C' && id !== pg)
      ?? offIds.find((id) => big(id) && id !== pg) ?? offIds.find((id) => id !== pg);
    const out = { x: side * 3.5, y: COURT_LEN + 1.2 };
    const recv = { x: side * 10, y: 80 };
    beat(0.06, { [inb]: out }, out, inb);
    beat(0.14, { [pg]: recv }, recv, pg);
  }
  // ...and into the set: the guard to the top, a wing who pushed it to his
  // own spot; everyone else to theirs, the defense back on their men.
  const entry = by !== pg && SPOTS[spots[by]] && !big(by) ? { ...SPOTS[spots[by]] } : { ...SPOTS.top };
  beat(tAdv, formation(entry, by), entry, by);

  // The actions, by the route the result implies.
  const s = finisher;
  const a = assister != null && assister !== s ? assister : null;
  const inside = Math.hypot(finishAt.x - RIM.x, finishAt.y - RIM.y) < 10;
  const others = (...ex) => offIds.filter((id) => !ex.includes(id));
  // The roll man who finishes, or any other big to set it.
  const screener = (h) => (isShot && inside && big(s) && s !== h ? s : others(h, s, a).find(big) ?? null);
  const steps = [];
  if (a != null) {
    if (by === a) {
      if (actions >= 2) steps.push({ k: 'probe' });
      if (actions >= 1) {
        const sc = screener(a);
        steps.push(sc != null && (bit(2) || sc === s) ? { k: 'pnr', sc } : { k: 'drive' });
      }
    } else if (actions >= 2) {
      const x = others(by, a, s)[(hash >>> 3) % 2];
      if (bit(4) && x != null) steps.push({ k: 'pass', to: x }, { k: 'pass', to: a });
      else steps.push({ k: 'pass', to: a }, { k: 'drive' });
    } else {
      steps.push({ k: 'pass', to: a });
    }
  } else if (by === s) {
    if (actions >= 2) steps.push({ k: 'probe' });
    if (actions >= 1) {
      const sc = screener(s);
      steps.push(sc != null && bit(2) ? { k: 'pnr', sc } : { k: 'drive' });
    }
  } else {
    const post = isShot && inside && big(s);
    if (actions >= 2 && !post) {
      const x = others(by, s)[(hash >>> 3) % 3];
      if (x != null) steps.push({ k: 'pass', to: x });
    }
    steps.push({ k: post ? 'post' : 'pass', to: s });
  }

  const tFinal = moment - FINAL_T;
  const dt = steps.length ? Math.max(0, tFinal - tAdv) / steps.length : 0;
  steps.forEach((st, n) => {
    const t0 = tAdv + dt * n;
    const t1 = t0 + dt;
    if (st.k === 'pass' || st.k === 'post') {
      // Caught where he stands — or, fed in the post, on the block on the
      // side he'll finish.
      const catchAt = st.k === 'post'
        ? { x: (Math.sign(finishAt.x) || side) * 6.5, y: 7.5 }
        : formation(at, by)[st.to];
      hold(t1 - PASS_T);
      beat(t1, formation(catchAt, st.to), catchAt, st.to);
    } else if (st.k === 'drive') {
      const d = toward(at, 9.5 + ((hash >>> 6) % 3));
      beat(t1, formation(d, by), d, by);
    } else if (st.k === 'probe') {
      const p = { x: -(Math.sign(at.x) || side) * 12, y: 24 };
      beat(t1, formation(p, by), p, by);
    } else {
      // Pick and roll: a screen beside the ball, the handler off it toward
      // the middle, the screener down the lane.
      const len = Math.hypot(RIM.x - at.x, RIM.y - at.y) || 1;
      const ux = (RIM.x - at.x) / len;
      const uy = (RIM.y - at.y) / len;
      let px = -uy;
      let py = ux;
      if ((Math.abs(at.x) > 3 ? -Math.sign(at.x) : side) !== Math.sign(px || side)) { px = -px; py = -py; }
      const screenAt = { x: +(at.x + px * 3.2 + ux * 1.8).toFixed(2), y: +(at.y + py * 3.2 + uy * 1.8).toFixed(2) };
      beat(t0 + dt * 0.45, formation(at, by, { [st.sc]: screenAt }), at, by);
      const off = { x: +(at.x + px * 8 + ux * 4).toFixed(2), y: +(at.y + py * 8 + uy * 4).toFixed(2) };
      beat(t1, formation(off, by, { [st.sc]: toward(screenAt, 5.5) }), off, by);
    }
  });

  // The moment: the assist to the shooter arriving at his spot, or the man
  // with it into his own move — and everyone where the frame has them.
  if (by !== s) hold(moment - PASS_T);
  beat(moment, { ...finalAt }, finishAt, s);

  const ids = [...offP, ...defP].map((x) => x.id);
  const paths = {};
  for (const id of ids) {
    const pts = [{ ...(start[id] ?? finalAt[id]), t: 0 }];
    for (const b of beats) {
      if (!b.at[id]) continue;
      const pt = { x: b.at[id].x, y: b.at[id].y, t: b.t };
      if (pts[pts.length - 1].t >= b.t) pts.pop();   // two beats at once: the later one stands
      pts.push(pt);
    }
    pts.push({ ...finalAt[id], t: 1 });
    paths[id] = pts;
  }
  const route = [{ x: ball0.x, y: ball0.y, h: ball0.h ?? 0, held: !!ball0.held, t: 0 }];
  for (const b of beats) {
    if (route[route.length - 1].t >= b.t) route.pop();
    route.push({ x: b.ball.x, y: b.ball.y, h: 0, held: true, by: b.by, t: b.t });
  }
  if (isShot && blocked) {
    route.push({ ...fartherOut(finishAt, 3), h: 0.35, held: false, t: 1 });
  } else if (isShot) {
    const range = Math.hypot(finishAt.x - RIM.x, finishAt.y - RIM.y);
    route.push({
      x: (finishAt.x + RIM.x) / 2, y: (finishAt.y + RIM.y) / 2, h: Math.min(1, 0.35 + range / 32), held: false,
      t: moment + (1 - moment) * 0.5,
    });
    route.push({ ...RIM, h: 0, held: false, t: 1 });
  } else {
    route.push({ ...finishAt, h: 0, held: true, by: s, t: 1 });
  }
  return { paths, route, panT: tAdv, playT: moment };
}

export function buildFrames(plays, lineups, home, away) {
  const sideOf = new Map();
  const posOf = new Map();
  for (const p of home.roster) { sideOf.set(p.id, 'home'); posOf.set(p.id, p.pos); }
  for (const p of away.roster) { sideOf.set(p.id, 'away'); posOf.set(p.id, p.pos); }

  // Which team had the ball on each possession. There's no explicit field for
  // it — and `side` can't stand in, since a steal, a block or a foul is
  // credited to the defense. But every possession contains a shot, a
  // turnover or a free throw, and those always belong to the offense. (Free
  // throws matter: 8.6% of possessions are nothing but a foul and a trip to
  // the line, and keying off the foul handed those to the wrong team.)
  const offenseOf = new Map();
  for (const p of plays) {
    if (p.n == null || offenseOf.has(p.n)) continue;
    if (p.k === 'shot' || p.k === 'tov' || p.k === 'ft') offenseOf.set(p.n, sideOf.get(p.p));
  }

  const marks = [...(lineups ?? [])]
    .map((ln) => ({ per: periodIdx(ln.q), sec: clockSec(ln.t), home: ln.home, away: ln.away }))
    .sort((a, b) => a.per - b.per || b.sec - a.sec);

  const frames = [];
  let li = 0;
  let spots = null;        // offensive spot assignment, held for a possession
  let spotsKey = '';
  let matchups = null;     // defender -> man, held for a possession; switches stick
  let matchKey = '';
  let prevSec = null;
  let prevQ = null;
  let prevN = null;
  let action = BRING_UP;   // where the play is — half-court coords of the end being attacked
  let holder = null;       // who has the ball, either team
  let lastShot = null;     // half-court coords of the last attempt, for where its miss comes down
  let shot = null;         // the marker left on the floor, world coords
  let ballEnd = null;      // where the ball finished the previous play, world coords
  let placed = {};         // where everyone finished the previous play, world coords

  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    const per = periodIdx(p.q);
    while (li + 1 < marks.length
      && (marks[li + 1].per < per || (marks[li + 1].per === per && marks[li + 1].sec >= (p.sec ?? 0)))) li++;
    const mark = marks[li];

    const offSide = offenseOf.get(p.n) ?? (p.side === 'home' ? 'home' : 'away');
    const defSide = offSide === 'home' ? 'away' : 'home';
    const top = attacksTop(offSide, per);
    const W = (pt) => toWorld(pt, top);
    const offIds = (offSide === 'home' ? mark?.home : mark?.away) ?? [];
    const defIds = (defSide === 'home' ? mark?.home : mark?.away) ?? [];
    const onOff = (id) => id != null && offIds.includes(id);
    const onDef = (id) => id != null && defIds.includes(id);
    const offP = offIds.map((id) => ({ id, pos: posOf.get(id) ?? 'SF' }));
    const defP = defIds.map((id) => ({ id, pos: posOf.get(id) ?? 'SF' }));
    const hash = playHash(p);

    // Game seconds since the previous play — what playback is paced on. A new
    // period restarts the clock, so it gets a nominal beat instead.
    const newPeriod = p.q !== prevQ;
    const gap = newPeriod || prevSec == null ? 3 : Math.max(0, prevSec - (p.sec ?? prevSec));

    const newPossession = p.n !== prevN;
    let carrier = null;    // who already has it for the new offense: a defensive rebound, a steal
    if (newPossession) {
      // The new offense sets up out front. Whoever won the ball carries it
      // there; otherwise a guard brings it up.
      action = BRING_UP;
      lastShot = null;
      shot = null;
      if (onOff(holder)) carrier = holder; else holder = null;
    }

    // Who stands where (assignSpots) and who's on whom, held for the
    // possession. The defender in the play is on the man he's playing
    // against: matching by position alone left the contest defender 11ft
    // from the shooter on average — 58% of the time someone else was the man
    // in his face — and put the blocker 10ft and the fouler 14ft from their
    // men. So he switches onto him (below), whoever had that man picks up his
    // old one, and the switch holds for the rest of the possession rather
    // than undoing itself next play.
    const key = `${p.n}|${offIds.join(',')}`;
    if (key !== spotsKey) { spots = assignSpots(offP); spotsKey = key; }
    const mKey = `${p.n}|${offIds.join(',')}|${defIds.join(',')}`;
    if (mKey !== matchKey) { matchups = positionMatchups(defP, offP); matchKey = mKey; }

    // A set to act out (actOut): the shot, turnover or foul that ends a
    // possession's build-up.
    const setPlay = newPossession && (p.k === 'shot' || p.k === 'tov' || p.k === 'foul')
      && offIds.length === 5 && defIds.length === 5;

    // Where the play happens and who ends up with the ball. A foul or a block
    // leaves both where they were.
    const blocked = p.k === 'shot' && !p.m && plays[i + 1]?.k === 'blk';
    let relocated = false;   // a shooting foul moved the play to the shooter
    switch (p.k) {
      case 'shot':
        action = { x: p.x, y: p.y };
        lastShot = action;
        holder = p.p;
        shot = { ...W(action), made: !!p.m };
        break;
      case 'ft':
        action = FT_SPOT;
        lastShot = FT_SPOT;
        holder = p.p;
        shot = null;
        break;
      case 'reb':
        action = lastShot ? reboundSpot(lastShot.x, lastShot.y, hash) : { x: 0, y: 8 };
        holder = p.p;
        break;
      case 'tov':   // he loses it where he had it
      case 'stl':   // and the defense takes it right there
        holder = p.p;
        shot = null;
        break;
      case 'foul': {
        // A shooting foul puts the ball in the shooter's hands where he went
        // up: the attempt's own spot when the sim logged one (a fouled miss is
        // never a shot play), else a drive into the lane. An and-one is
        // already there — the make just before it. Any other foul leaves the
        // ball alone.
        const prev = plays[i - 1];
        const andOne = prev?.k === 'shot' && prev.m && prev.p === p.v;
        if (p.sf && onOff(p.v) && !andOne) {
          action = p.x != null ? { x: p.x, y: p.y } : driveSpot(hash);
          lastShot = action;
          holder = p.v;
          shot = null;
          relocated = true;
        }
        break;
      }
      default:
        break;
    }
    // A turnover or a common foul at the end of a set happens where the set
    // leaves the man it's on — at his spot, or on a drive from it — not out
    // at half court where every possession starts.
    if (setPlay && !relocated && (p.k === 'tov' || p.k === 'foul')) {
      const who = p.k === 'tov' ? p.p : p.v;
      if (onOff(who)) {
        const spot = SPOTS[spots[who]] ?? BRING_UP;
        action = (hash >>> 5) % 3 === 0 ? toward(spot, 10) : { x: spot.x, y: spot.y };
        holder = who;
      }
    }

    // Someone on the offense is on the ball unless the defense has it.
    const offAtBall = onDef(holder) ? null
      : onOff(holder) ? holder
        : (offIds.find((id) => posOf.get(id) === 'PG') ?? offIds[0]);

    // Clear space around someone holding the ball in a set — but not around a
    // loose ball: players crowd a rebound, and running away from one (half of
    // all the clear-outs, before this) looks exactly backwards.
    if (p.k !== 'reb' && p.k !== 'blk') spots = clearSpace(spots, offP, action, offAtBall);
    const before = matchups;   // who was on whom as the play began, for the set leading into it
    const face = confrontation(p, onOff, onDef);
    if (face?.target != null && String(matchups[face.actor]) !== String(face.target)) {
      const had = Object.keys(matchups).find((d) => String(matchups[d]) === String(face.target));
      const old = matchups[face.actor];
      matchups = { ...matchups, [face.actor]: face.target };
      if (had != null && old != null) matchups[had] = old;
    }
    // Free throws line up on the lane; anything else forms around the ball.
    let O;
    let D;
    if (p.k === 'ft' && onOff(p.p)) {
      ({ O, D } = freeThrowFormation(offP, defP, p.p));
    } else {
      O = offenseFormation(offP, action, offAtBall, spots);
      D = defenseFormation(O, matchups, action, face?.target != null ? face.actor : null, onDef(holder) ? holder : null);
    }

    const players = [
      ...offIds.filter((id) => O[id]).map((id) => ({ id, ...W(O[id]), side: offSide, off: true })),
      ...defIds.filter((id) => D[id]).map((id) => ({ id, ...W(D[id]), side: defSide, off: false })),
    ];

    // Where everyone and the ball start this play: where the last one left
    // them. A sub who's just come on starts at the scorer's table.
    const startAt = (id) => placed[id] ?? SUB_IN;
    const at = (pt, h = 0, held = false) => ({ ...W(pt), h, held });
    const tip = i === 0 || (newPeriod && per >= 4);
    let paths;
    let route;
    let panT = 1;
    let playT = 1;
    const finisher = offAtBall ?? holder;
    const acted = setPlay && onOff(finisher);
    if (acted) {
      // Acted out in attacked-end coordinates, then back to the world's.
      const startC = {};
      for (const pl of players) startC[pl.id] = toWorld(startAt(pl.id), top);
      if (tip) Object.assign(startC, tipLayout(offP, defP));
      const ball0 = tip ? { x: 0, y: 47, h: 0.9, held: false }
        : ballEnd ? { ...toWorld(ballEnd, top), h: ballEnd.h ?? 0, held: !!ballEnd.held } : { ...action, h: 0, held: true };
      const finalAt = {};
      for (const id of offIds) if (O[id]) finalAt[id] = O[id];
      for (const id of defIds) if (D[id]) finalAt[id] = D[id];
      const plan = actOut({
        offP, defP, spots, matchups: before, start: startC, ball0, finalAt,
        finishAt: action, finisher, assister: p.k === 'shot' && onOff(p.a) ? p.a : null,
        carrier, tip, gap, hash, isShot: p.k === 'shot', blocked,
      });
      paths = {};
      for (const [id, pts] of Object.entries(plan.paths)) paths[id] = pts.map((q) => ({ ...W(q), t: q.t }));
      route = plan.route.map((q) => ({ ...q, ...W(q) }));
      panT = plan.panT;
      playT = plan.playT;
    } else {
      // Straight from where everyone was to where the play has them.
      paths = {};
      for (const pl of players) {
        const from = i === 0 ? { x: pl.x, y: pl.y } : startAt(pl.id);
        paths[pl.id] = [{ ...from, t: 0 }, { x: pl.x, y: pl.y, t: 1 }];
      }
      // The ball's route this play, world coords. `h` is height (0 on the
      // floor, 1 at the top of a long arc); `held` means it's in someone's
      // hands.
      const start = ballEnd ? { x: ballEnd.x, y: ballEnd.y, h: ballEnd.h ?? 0, held: !!ballEnd.held } : at(action, 0, true);
      let r;
      if (p.k === 'shot' || p.k === 'ft') {
        // The pass that set it up, when the sim credits one: 80% of makes.
        const pass = p.k === 'shot' && onOff(p.a) && O[p.a] ? [at(O[p.a], 0, true)] : [];
        const release = at(action, 0, true);
        if (blocked) {
          r = [start, ...pass, release, at(fartherOut(action, 3), 0.35)];   // swatted at the release
        } else {
          const range = Math.hypot(action.x - RIM.x, action.y - RIM.y);
          const apex = at({ x: (action.x + RIM.x) / 2, y: (action.y + RIM.y) / 2 }, Math.min(1, 0.35 + range / 32));
          r = [start, ...pass, release, apex, at(RIM)];
        }
      } else if (p.k === 'reb') {
        const land = at(action, 0, true);
        r = [start, { x: (start.x + land.x) / 2, y: (start.y + land.y) / 2, h: 0.3, held: false }, land];
      } else if (p.k === 'tov' || p.k === 'stl' || newPossession || relocated) {
        r = [start, at(action, 0, true)];
      } else {
        r = [start, start];
      }
      route = timeRoute(r);
    }
    ballEnd = route[route.length - 1];
    placed = Object.fromEntries(players.map((pl) => [pl.id, { x: pl.x, y: pl.y }]));

    prevQ = p.q;
    prevSec = p.sec ?? prevSec;
    prevN = p.n;

    frames.push({
      offSide, defSide, attackTop: top, newPossession,
      players,
      holderId: onDef(holder) ? holder : offAtBall,
      // The defender in the play, who he's on (null for a loose-ball foul)
      // and what he's doing: 'contest' | 'block' | 'foul'.
      actorId: face?.actor ?? null,
      targetId: face?.target ?? null,
      act: face?.act ?? null,
      // How everyone gets to `players`, and the ball to where it ends up:
      // [{ x, y, t }], t the share of the play's time on screen. A set (see
      // actOut) is acted out beat by beat and its moment — the shot going up,
      // the whistle — comes at `playT`; anything else is a straight move.
      // Upright, the camera follows the ball up the floor over `panT`.
      paths,
      ballPath: route,
      set: acted,
      playT,
      panT,
      shot,
      blocked,   // a miss that never reached the rim — no clank to show
      gap,
    });
  }
  return frames;
}

// ---- Moments ---------------------------------------------------------------

const POST_GAME = new Set(['closing', 'leadchanges', 'big', 'tripdbl']);

// Where each of the sim's highlight events belongs. In-game moments (a run, a
// clutch basket) carry the possession they happened in, so each surfaces as
// soon as that possession's last play is revealed. An injury sits on the play
// it was placed at (injuryMoment, which copies that play's clock). Period
// notes go on that period's break card and post-game notes on the final one.
// End-of-quarter lines are dropped: the break cards are built from the data.
export function placeHighlights(plays, events) {
  const lastOfPossession = new Map();
  plays.forEach((p, i) => { if (p.n != null) lastOfPossession.set(p.n, i); });
  const byPlay = new Map();
  const periodNotes = new Map();
  const post = [];
  const add = (i, e) => { if (!byPlay.has(i)) byPlay.set(i, []); byPlay.get(i).push(e); };
  for (const e of events ?? []) {
    if (e.k === 'run' || e.k === 'clutch') {
      if (lastOfPossession.has(e.n)) add(lastOfPossession.get(e.n), e);
    } else if (e.k === 'injury') {
      let at = -1;
      if (e.sec != null) plays.forEach((p, i) => { if (p.q === e.q && p.sec >= e.sec - 1e-6) at = i; });
      if (at >= 0) add(at, e); else post.push(e);
    } else if (e.k === 'bigq' || e.k === 'ot') {
      if (!periodNotes.has(e.per)) periodNotes.set(e.per, []);
      periodNotes.get(e.per).push(e);
    } else if (POST_GAME.has(e.k)) {
      post.push(e);
    }
  }
  return { byPlay, periodNotes, post };
}

// The last play of each period: where the game pauses for a break card.
export function periodBreaks(plays) {
  const out = [];
  plays.forEach((p, i) => {
    const next = plays[i + 1];
    if (!next || next.q !== p.q) out.push({ i, per: periodIdx(p.q), q: p.q, final: !next });
  });
  return out;
}

// ---- Following the game ------------------------------------------------------

const blankLine = (id) => ({ ...Object.fromEntries(BOX_COLS.map((k) => [k, 0])), playerId: id });

// Where the game clock stands once `n` plays are in: the last one's period
// and time — or that period's end, when it was the last play before a break.
function clockAfter(plays, n) {
  if (n <= 0) return { per: 0, sec: 12 * 60 };
  const last = plays[n - 1];
  return { per: periodIdx(last.q), sec: plays[n]?.q !== last.q ? 0 : (last.sec ?? clockSec(last.t)) };
}

// Every box-score column for each player through the first `upto` plays,
// rebuilt from the plays alone — they add up exactly to the box score, so a
// live line needs nothing from the engine.
//
// Given the frames it keeps +/- as well, from who the court has on the floor
// for each basket; given the lineups, minutes — counted the way the box score
// counts them: a stint's minutes go to the five who started it, even one who
// fouls out partway. (Counting time on the floor instead left about three
// lines a game off the box score at the final whistle, by up to five
// minutes.) So once the last play is in, every line equals the real one,
// column for column.
export function liveBox(plays, upto = plays.length, { frames = null, lineups = null } = {}) {
  const end = Math.min(upto, plays.length);
  const box = new Map();
  const line = (id) => {
    let l = box.get(id);
    if (!l) { l = blankLine(id); box.set(id, l); }
    return l;
  };
  for (let i = 0; i < end; i++) {
    const p = plays[i];
    if (p.p == null) continue;
    let pts = 0;
    switch (p.k) {
      case 'shot': {
        const l = line(p.p);
        l.fga += 1;
        if (p.z) l[`${p.z}Fga`] += 1;
        if (p.pts === 3) l.tpa += 1;
        if (p.m) {
          l.fgm += 1;
          if (p.z) l[`${p.z}Fgm`] += 1;
          if (p.pts === 3) l.tpm += 1;
          pts = p.pts;
          if (p.a != null) line(p.a).ast += 1;
        }
        break;
      }
      case 'ft': {
        const l = line(p.p);
        l.fta += 1;
        if (p.m) { l.ftm += 1; pts = 1; }
        break;
      }
      case 'reb': {
        const l = line(p.p);
        l.reb += 1;
        if (p.o) l.oreb += 1; else l.dreb += 1;
        break;
      }
      case 'stl': line(p.p).stl += 1; break;
      case 'blk': line(p.p).blk += 1; break;
      // An offensive foul is logged as the turnover it is, and it's still a
      // personal foul.
      case 'tov': { const l = line(p.p); l.tov += 1; if (p.f) l.pf += 1; break; }
      case 'foul': line(p.p).pf += 1; break;
      default: break;
    }
    if (pts) {
      line(p.p).pts += pts;
      const on = frames?.[i]?.players;
      const scorer = on?.find((x) => x.id === p.p);
      if (scorer) for (const x of on) line(x.id).pm += x.side === scorer.side ? pts : -pts;
    }
  }
  if (lineups) {
    const now = end >= plays.length ? null : clockAfter(plays, end);   // null: game over
    for (const ln of lineups) {
      if (ln.sub) continue;   // a mid-stint swap credits no minutes
      const per = periodIdx(ln.q);
      const len = (ln.min ?? 0) * 60;
      const ran = !now || per < now.per ? len
        : per > now.per ? 0
          : Math.max(0, Math.min(len, clockSec(ln.t) - now.sec));
      if (ran > 0) for (const id of [...ln.home, ...ln.away]) line(id).min += ran / 60;
    }
  }
  return box;
}

// Team fouls in the period, as they stand after each play. Counted from the
// foul plays, which the sim keeps in step with its own count (the T in
// "FOUL (P2.T4)") and resets each period. An offensive foul is a personal
// foul but not a team one, as in the NBA — and the sim logs it as a
// turnover, so it never reaches this count. `bonusAt` is the sim's too: from
// the 5th team foul in a period (the 4th in overtime) a common foul sends
// the other side to the line.
export function teamFoulsByPlay(plays) {
  const out = [];
  let per = null;
  let f = { home: 0, away: 0 };
  for (const p of plays) {
    const pi = periodIdx(p.q);
    if (pi !== per) { per = pi; f = { home: 0, away: 0 }; }
    if (p.k === 'foul' && (p.side === 'home' || p.side === 'away')) f = { ...f, [p.side]: f[p.side] + 1 };
    out.push({ per, home: f.home, away: f.away, bonusAt: per >= 4 ? 4 : 5 });
  }
  return out;
}

// Who checked in and who went out between two frames, a team at a time —
// null if nobody did. The frames carry the ten on the floor at every play,
// from the sim's lineups (foul-outs included), so this is exact. Between
// consecutive frames it's one substitution; across a jump, everything that
// changed over it.
export function lineupChange(a, b) {
  if (!a || !b) return null;
  const out = {};
  for (const side of ['away', 'home']) {
    const before = a.players.filter((x) => x.side === side).map((x) => x.id);
    const now = b.players.filter((x) => x.side === side).map((x) => x.id);
    const ins = now.filter((id) => !before.includes(id));
    const outs = before.filter((id) => !now.includes(id));
    if (ins.length || outs.length) out[side] = { ins, outs };
  }
  return out.away || out.home ? out : null;
}

// The game's flow through the first `upto` plays: the margin (away minus
// home) as an SVG step path — x is the play count, y the margin flipped so an
// away lead is up — and a scale for it. Built from those plays alone, the
// scale included (the biggest lead so far, with room, in steps of 5, never
// under ±10): a scale sized for a lead still to come would give it away.
export function flowLine(scoreAt, upto) {
  let d = 'M0 0';
  let prev = 0;
  let big = 0;
  for (let v = 1; v <= upto; v++) {
    const s = scoreAt[v - 1];
    const m = s.away - s.home;
    if (m !== prev) { d += `H${v}V${-m}`; prev = m; }
    big = Math.max(big, Math.abs(m));
  }
  return { d: `${d}H${upto}`, scale: Math.max(10, Math.ceil((big + 2) / 5) * 5) };
}

// The order a side's players took the floor: the starting five, then everyone
// else as they first checked in. A live box in points order would reshuffle
// with every basket.
export function floorOrder(lineups, side) {
  const seen = [];
  for (const ln of lineups ?? []) for (const id of ln[side] ?? []) if (!seen.includes(id)) seen.push(id);
  return seen;
}

// What was true before tip-off. A watched game has already been simmed into
// the league — records, season stats and injuries can all include tonight —
// so the pre-game card takes tonight back out. Showing the live numbers would
// tell you who won (a record that's already moved) before the opening tip.
//
// Games don't all count the same way, so the caller says how this one does:
//   records         'subtract' — tonight is in the W-L (regular season, the
//                   play-in); 'asis' — it isn't (an NBA Cup knockout); false —
//                   no record to show (the playoffs, which show the series;
//                   the All-Star Game; a replay, whose pre-game record is gone)
//   tonightInStats  whether tonight's line is in season stats (regular season)
//   showOut         the injury list — not for a replay, whose injuries are
//                   today's, not that night's
export function pregame(game, home, away, { records = 'subtract', tonightInStats = true, showOut = true } = {}) {
  const homeWon = game.homePts > game.awayPts;
  const lines = new Map([...(game.homeBox ?? []), ...(game.awayBox ?? [])].map((l) => [l.playerId, l]));
  const hurtTonight = new Set((game.injuryReport ?? []).map((e) => e.playerId));
  const side = (team, won, key) => {
    const back = records === 'subtract' ? 1 : 0;
    const w = records ? (team.wins ?? 0) - (won ? back : 0) : null;
    const l = records ? (team.losses ?? 0) - (won ? 0 : back) : null;
    return {
      w,
      l,
      record: records ? `${w}–${l}` : null,
      starters: (game.lineups?.[0]?.[key] ?? []).map((id) => {
        const p = team.roster.find((x) => x.id === id);
        const line = lines.get(id);
        const played = tonightInStats && line && line.min > 0;
        const gp = (p?.stats?.gp ?? 0) - (played ? 1 : 0);
        const pts = (p?.stats?.pts ?? 0) - (played ? line.pts : 0);
        return { id, name: p?.name ?? '', pos: p?.pos ?? '', ppg: gp > 0 ? pts / gp : null };
      }),
      out: showOut ? team.roster.filter((p) => p.injury && !hurtTonight.has(p.id)).map((p) => p.name) : [],
    };
  };
  return { home: side(home, homeWon, 'home'), away: side(away, !homeWon, 'away') };
}
