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
        action = lastShot ? reboundSpot(lastShot.x, lastShot.y, playHash(p)) : { x: 0, y: 8 };
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
          action = p.x != null ? { x: p.x, y: p.y } : driveSpot(playHash(p));
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
    // The defender in the play is on the man he's playing against. Matching
    // by position alone left the contest defender 11ft from the shooter on
    // average — 58% of the time someone else was the man in his face — and
    // put the blocker 10ft and the fouler 14ft from their men. So he switches
    // onto him, whoever had that man picks up his old one, and the switch
    // holds for the rest of the possession rather than undoing itself next
    // play.
    const mKey = `${p.n}|${offIds.join(',')}|${defIds.join(',')}`;
    if (mKey !== matchKey) { matchups = positionMatchups(defP, offP); matchKey = mKey; }
    const face = confrontation(p, onOff, onDef);
    if (face?.target != null && String(matchups[face.actor]) !== String(face.target)) {
      const had = Object.keys(matchups).find((d) => String(matchups[d]) === String(face.target));
      const old = matchups[face.actor];
      matchups = { ...matchups, [face.actor]: face.target };
      if (had != null && old != null) matchups[had] = old;
    }
    const D = defenseFormation(O, matchups, action, face?.target != null ? face.actor : null, onDef(holder) ? holder : null);

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
    } else if (p.k === 'tov' || p.k === 'stl' || newPossession || relocated) {
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
      // The defender in the play, who he's on (null for a loose-ball foul)
      // and what he's doing: 'contest' | 'block' | 'foul'.
      actorId: face?.actor ?? null,
      targetId: face?.target ?? null,
      act: face?.act ?? null,
      ballPath: path,
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
