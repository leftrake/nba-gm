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
} from '../engine/courtPositions.js';

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
  let prevSec = null;
  let prevQ = null;
  let prevN = null;
  let action = BRING_UP;   // where the play is — half-court coords of the end being attacked
  let holder = null;       // who has the ball, either team
  let lastShot = null;     // half-court coords of the last attempt, for where its miss comes down
  let shot = null;         // the marker left on the floor, world coords
  let ballEnd = null;      // where the ball finished the previous play, world coords

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

    const newPossession = p.n !== prevN;
    if (newPossession) {
      // The new offense sets up out front. Whoever won the ball (a defensive
      // rebound or a steal) carries it there; otherwise a guard brings it up.
      action = BRING_UP;
      lastShot = null;
      shot = null;
      if (!onOff(holder)) holder = null;
    }

    // Where the play happens and who ends up with the ball. A foul or a block
    // leaves both where they were.
    const blocked = p.k === 'shot' && !p.m && plays[i + 1]?.k === 'blk';
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
        action = lastShot ? reboundSpot(lastShot.x, lastShot.y, playHash(p)) : { x: 0, y: 8 };
        holder = p.p;
        break;
      case 'tov':   // he loses it where he had it
      case 'stl':   // and the defense takes it right there
        holder = p.p;
        shot = null;
        break;
      default:
        break;
    }

    // Someone on the offense is on the ball unless the defense has it.
    const offAtBall = onDef(holder) ? null
      : onOff(holder) ? holder
        : (offIds.find((id) => posOf.get(id) === 'PG') ?? offIds[0]);

    const offP = offIds.map((id) => ({ id, pos: posOf.get(id) ?? 'SF' }));
    const defP = defIds.map((id) => ({ id, pos: posOf.get(id) ?? 'SF' }));
    const key = `${p.n}|${offIds.join(',')}`;
    if (key !== spotsKey) { spots = assignSpots(offP); spotsKey = key; }
    // Clear space around someone holding the ball in a set — but not around a
    // loose ball: players crowd a rebound, and running away from one (half of
    // all the clear-outs, before this) looks exactly backwards.
    if (p.k !== 'reb' && p.k !== 'blk') spots = clearSpace(spots, offP, action, offAtBall);
    const O = offenseFormation(offP, action, offAtBall, spots);
    const D = defenseFormation(O, positionMatchups(defP, offP), action, p.d, onDef(holder) ? holder : null);

    // The ball's route this play, world coords. `h` is height (0 on the floor,
    // 1 at the top of a long arc); `held` means it's in someone's hands.
    const at = (pt, h = 0, held = false) => ({ ...W(pt), h, held });
    const start = ballEnd ?? at(action, 0, true);
    let path;
    if (p.k === 'shot' || p.k === 'ft') {
      // The pass that set it up, when the sim credits one: 80% of makes.
      const pass = p.k === 'shot' && onOff(p.a) && O[p.a] ? [at(O[p.a], 0, true)] : [];
      const release = at(action, 0, true);
      if (blocked) {
        path = [start, ...pass, release, at(fartherOut(action, 3), 0.35)];   // swatted at the release
      } else {
        const range = Math.hypot(action.x - RIM.x, action.y - RIM.y);
        const apex = at({ x: (action.x + RIM.x) / 2, y: (action.y + RIM.y) / 2 }, Math.min(1, 0.35 + range / 32));
        path = [start, ...pass, release, apex, at(RIM)];
      }
    } else if (p.k === 'reb') {
      const land = at(action, 0, true);
      path = [start, { x: (start.x + land.x) / 2, y: (start.y + land.y) / 2, h: 0.3, held: false }, land];
    } else if (p.k === 'tov' || p.k === 'stl' || newPossession) {
      path = [start, at(action, 0, true)];
    } else {
      path = [start, start];
    }
    ballEnd = path[path.length - 1];

    const players = [
      ...offIds.filter((id) => O[id]).map((id) => ({ id, ...W(O[id]), side: offSide, off: true })),
      ...defIds.filter((id) => D[id]).map((id) => ({ id, ...W(D[id]), side: defSide, off: false })),
    ];

    // Game seconds since the previous play — what playback is paced on. A new
    // period restarts the clock, so it gets a nominal beat instead.
    const gap = p.q !== prevQ || prevSec == null ? 3 : Math.max(0, prevSec - (p.sec ?? prevSec));
    prevQ = p.q;
    prevSec = p.sec ?? prevSec;
    prevN = p.n;

    frames.push({
      offSide, defSide, attackTop: top, newPossession,
      players,
      holderId: onDef(holder) ? holder : offAtBall,
      ballPath: path,
      shot,
      gap,
    });
  }
  return frames;
}
