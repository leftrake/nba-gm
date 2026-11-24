import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { courtKit } from '../engine/colorUtils.js';
import { motionReduced } from './livePrefs.js';
import { ballHolders } from './liveFrames.js';

// The court. Frames arrive in full-court feet (liveFrames.js): x -25..25
// across, y 0..94 from the bottom baseline, each team attacking one basket.
//
// Two ways to show it, by the room there is (LiveGame decides):
//   - Upright, one end at a time — the scale a half court gets on a phone —
//     with a camera that pans to the other end when the ball changes hands,
//     the way a broadcast follows play up the floor.
//   - The whole floor on its side, baskets left and right, like a TV wide
//     shot: on a computer's wide window it fits at about the same scale as
//     one end upright, so both ends show at once and nothing has to pan.
//
// It used to be a single half court with both teams attacking the same
// basket, which made every change of possession the whole floor rearranging
// in place. With two ends, it's a run.
//
// Real NBA geometry: 16ft lane 19ft deep, 6ft free-throw circle, 4ft
// restricted arc, 23.75ft three above the break breaking to 22ft in the
// corners.

const W = 50;        // court width, feet
const HALF = 47;     // baseline to half court
const LEN = 94;
const RIM_Y = 5.25;
const ARC = 23.75;
const CORNER_X = 22;
const LANE_W = 16;
const LANE_D = 19;
const PAD = 1.5;     // margin round the lines, feet

// The picture's shape each way, margin included — LiveGame sizes the court
// from these.
export const COURT_SHAPE = {
  half: { w: W + 2 * PAD, h: HALF + 2 * PAD },
  full: { w: LEN + 2 * PAD, h: W + 2 * PAD },
};

// One end's markings, drawn in half-court SVG units (baseline at y=47).
const sx = (x) => x + W / 2;
const sy = (y) => HALF - y;
// Full-court feet -> SVG. Upright: x to 0..50, y flipped so the bottom
// baseline (y=0) is at the bottom of the picture. On its side, that picture
// turned a quarter clockwise: the bottom basket on the left, the top one on
// the right. A turn, not a mirror, so a shot from the right of the lane is
// still on the shooter's right.
const PROJECT = {
  half: (x, y) => [x + W / 2, LEN - y],
  full: (x, y) => [y, x + W / 2],
};

// Where the corner three meets the arc: 22ft out, on a 23.75ft radius.
const CORNER_Y = RIM_Y + Math.sqrt(ARC * ARC - CORNER_X * CORNER_X);

// The ball sits beside whoever holds it, not on him — drawn last, it would
// otherwise cover his number.
const BESIDE = { x: 1.15, y: -0.95 };

function EndMarkings() {
  const rimX = sx(0);
  const rimY = sy(RIM_Y);
  return (
    <g fill="none" stroke="var(--court-line)" strokeWidth="0.22">
      <rect x={sx(-W / 2)} y={sy(HALF)} width={W} height={HALF} fill="var(--court-floor)" />
      {/* lane + free-throw circle */}
      <rect x={sx(-LANE_W / 2)} y={sy(LANE_D)} width={LANE_W} height={LANE_D} fill="var(--court-paint)" />
      <path d={`M ${sx(-6)} ${sy(LANE_D)} A 6 6 0 0 1 ${sx(6)} ${sy(LANE_D)}`} />
      <path d={`M ${sx(-6)} ${sy(LANE_D)} A 6 6 0 0 0 ${sx(6)} ${sy(LANE_D)}`} strokeDasharray="1 1" />
      {/* restricted area — sweep 1 so it opens toward half court, not the baseline */}
      <path d={`M ${sx(-4)} ${rimY} A 4 4 0 0 1 ${sx(4)} ${rimY}`} />
      {/* backboard + rim */}
      <line x1={sx(-3)} y1={sy(4)} x2={sx(3)} y2={sy(4)} strokeWidth="0.35" />
      <circle cx={rimX} cy={rimY} r="0.75" strokeWidth="0.3" />
      {/* three-point line: corners straight, then the arc */}
      <line x1={sx(-CORNER_X)} y1={sy(0)} x2={sx(-CORNER_X)} y2={sy(CORNER_Y)} />
      <line x1={sx(CORNER_X)} y1={sy(0)} x2={sx(CORNER_X)} y2={sy(CORNER_Y)} />
      <path d={`M ${sx(-CORNER_X)} ${sy(CORNER_Y)} A ${ARC} ${ARC} 0 0 1 ${sx(CORNER_X)} ${sy(CORNER_Y)}`} />
      {/* half court — each end draws its own half of the centre circle */}
      <line x1={sx(-W / 2)} y1={sy(HALF)} x2={sx(W / 2)} y2={sy(HALF)} />
      <path d={`M ${sx(-6)} ${sy(HALF)} A 6 6 0 0 0 ${sx(6)} ${sy(HALF)}`} />
    </g>
  );
}

// What the defender in the play is doing, as a ring round him: in a
// shooter's face, blocking him, or fouling him.
const ACT_RING = {
  contest: { stroke: '#fff', width: 0.26, dash: null, opacity: 0.85 },
  block: { stroke: 'var(--color-danger)', width: 0.38, dash: null, opacity: 1 },
  foul: { stroke: 'var(--color-warning)', width: 0.3, dash: '0.55 0.4', opacity: 1 },
};

// Each leg of a run eased like a player getting going and pulling up — gently:
// a sharper curve peaks at nearly twice a leg's average speed, and a set's
// legs follow one another, so it read as lurching.
const RUN_EASE = 'cubic-bezier(.3,.1,.7,.9)';

// Moves an element along `route` ([{ X, Y, t }], screen units) over the
// play's time on screen, with the Web Animations API: a set is several legs
// (liveFrames' actOut), anything else one. Held (before tip-off), it waits at
// the start; with reduced motion it doesn't move at all — it's simply where
// the route ends. `ms` is read when a play starts, not a dependency: it only
// changes with a new play, and re-running on it would restart the old one.
function useRoute(ref, route, ms, hold) {
  const msRef = useRef(ms);
  msRef.current = ms;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.animate || !route || route.length < 2 || hold || motionReduced()) return undefined;
    const run = el.animate(
      route.map((q) => ({ transform: `translate(${q.X}px, ${q.Y}px)`, offset: q.t, easing: RUN_EASE })),
      { duration: Math.max(1, msRef.current), fill: 'forwards' },
    );
    return () => run.cancel();
  }, [route, hold]); // eslint-disable-line react-hooks/exhaustive-deps
}
const routeRest = (route, hold) => (hold ? route[0] : route[route.length - 1]);

// A player's rings — the ball-handler's, the defender's in the play — say
// who the play is about, so in a set they wait for it: up the floor and
// through the passes the ball is with someone else.
function useRingsAt(ref, at, ms, hold) {
  const msRef = useRef(ms);
  msRef.current = ms;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.animate || at == null || hold || motionReduced()) return undefined;
    const show = el.animate(
      [{ opacity: 0, offset: 0 }, { opacity: 0, offset: Math.max(0, at - 0.03) }, { opacity: 1, offset: at }],
      { duration: Math.max(1, msRef.current), fill: 'forwards' },
    );
    return () => show.cancel();
  }, [at, hold]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Player({ route, kit, number, name, ring, act, dimmed, ms, hold, ringsAt }) {
  const actRing = act && ACT_RING[act];
  const ref = useRef(null);
  const ringsRef = useRef(null);
  useRoute(ref, route, ms, hold);
  useRingsAt(ringsRef, (ring || actRing) ? ringsAt : null, ms, hold);
  const rest = routeRest(route, hold);
  return (
    <g
      ref={ref}
      style={{
        transform: `translate(${rest.X}px, ${rest.Y}px)`,
        opacity: dimmed && !actRing ? 0.55 : 1,
      }}
    >
      <g ref={ringsRef}>
        {ring && <circle r="1.95" fill="none" stroke="var(--court-ball)" strokeWidth="0.3" opacity="0.9" />}
        {actRing && (
          <circle
            className={`court-act court-act--${act}`} r="1.75" fill="none"
            stroke={actRing.stroke} strokeWidth={actRing.width} strokeDasharray={actRing.dash ?? undefined} opacity={actRing.opacity}
          />
        )}
      </g>
      {/* 1.3ft radius, not a true ~2ft shoulder width: defenders legitimately
          stand 3ft off their man, and at real scale the two discs merge. */}
      <circle r="1.3" fill={kit.fill} stroke={kit.ring} strokeWidth={kit.ringWidth} />
      <text
        y="0.45" textAnchor="middle" fill={kit.text}
        style={{ fontSize: 1.35, fontWeight: 700, pointerEvents: 'none' }}
      >
        {number}
      </text>
      <title>{name}</title>
    </g>
  );
}

// The ball's route on screen, from the frame's (liveFrames): beside whoever
// holds it, in screen terms (up and to the right) whichever way the court is
// turned.
function screenBall(route, project) {
  return route.map((w) => {
    const [X, Y] = project(w.x, w.y);
    return { ...w, X: X + (w.held ? BESIDE.x : 0), Y: Y + (w.held ? BESIDE.y : 0) };
  });
}

// How high the ball is through the play, for drawing — from directly
// overhead height can only show as size. In the hand it's at waist height;
// dribbled — on the move, or in place while he sizes it up — it drops to the
// floor and back a few times a second; passed, it lifts a little; shot, it
// goes up the arc the route gives it. A look after a catch is too short to
// dribble through.
const HAND = 0.1;
const BOUNCE_MS = 230;
const DRIBBLE_IN_PLACE_MS = 420;
function heights(route, ms) {
  const out = [];
  route.forEach((w, i) => {
    const h = w.held ? HAND : (w.h || 0);
    const prev = route[i - 1];
    if (prev && prev.held && w.held) {
      const span = w.t - prev.t;
      const dist = Math.hypot(w.x - prev.x, w.y - prev.y);
      if (prev.by === w.by && (dist > 3 || span * ms > DRIBBLE_IN_PLACE_MS)) {
        // Dribbled: down to the floor and back up, all the way.
        const n = Math.max(1, Math.round((span * ms) / BOUNCE_MS));
        for (let k = 0; k < n; k++) {
          out.push({ h: 0, t: prev.t + (span * (k + 0.5)) / n });
          if (k < n - 1) out.push({ h: HAND, t: prev.t + (span * (k + 1)) / n });
        }
      } else if (prev.by !== w.by) {
        out.push({ h: HAND + 0.12, t: prev.t + span / 2 });   // a pass, a little above the hands
      }
    }
    out.push({ h, t: w.t });
  });
  return out;
}

// The ball along its route, with the Web Animations API. Where it moves with
// someone — dribbled up the floor, carried on a drive — it moves as he does;
// passed or shot it flies straight. Its height is a separate animation, of
// its size and its shadow's slide out from under it, so a dribble can bounce
// while the ball moves with the man.
function Ball({ route, ms, hold }) {
  const posRef = useRef(null);
  const sizeRef = useRef(null);
  const shadowRef = useRef(null);
  const msRef = useRef(ms);
  msRef.current = ms;
  useLayoutEffect(() => {
    if (!route || route.length < 2 || hold || !posRef.current?.animate || motionReduced()) return undefined;
    const opts = { duration: Math.max(1, msRef.current), fill: 'forwards' };
    const moves = posRef.current.animate(route.map((w, i) => {
      const next = route[i + 1];
      const carried = next && w.held && next.held && w.by != null && w.by === next.by;
      return { transform: `translate(${w.X}px, ${w.Y}px)`, offset: w.t, easing: carried ? RUN_EASE : 'linear' };
    }), opts);
    const hs = heights(route, msRef.current);
    const size = sizeRef.current.animate(hs.map((q) => ({ transform: `scale(${1 + q.h * 0.9})`, offset: q.t })), opts);
    const shadow = shadowRef.current.animate(hs.map((q) => ({
      transform: `translate(${q.h * 1.6}px, ${q.h * 1.6}px)`, opacity: 0.35 - q.h * 0.15, offset: q.t,
    })), opts);
    return () => { moves.cancel(); size.cancel(); shadow.cancel(); };
  }, [route, hold]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resting place, for anywhere the animation isn't running.
  const rest = route?.length ? routeRest(route, hold) : { X: 0, Y: 0, h: 0 };
  const h = rest.held ? HAND : (rest.h || 0);
  return (
    <g ref={posRef} style={{ transform: `translate(${rest.X}px, ${rest.Y}px)` }}>
      <ellipse
        ref={shadowRef} rx="0.6" ry="0.4" fill="#000"
        style={{ transform: `translate(${h * 1.6}px, ${h * 1.6}px)`, opacity: 0.35 - h * 0.15 }}
      />
      <circle
        ref={sizeRef} r="0.62" fill="var(--court-ball)" stroke="rgba(0,0,0,.5)" strokeWidth="0.12"
        style={{ transform: `scale(${1 + h * 0.9})` }}
      />
    </g>
  );
}

// Name tags. Hover tooltips can't be read while the game is playing, so the
// two players the play is about — whoever has the ball, and the defender on
// him — carry their names.
export const surname = (name = '') => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '';
};

const TAG_GAP = 2.05;   // clears the 1.95ft ball-handler ring
const tagSize = (text, font) => ({ w: text.length * font * 0.58 + font * 1.1, h: font * 1.5 });
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// A disc against a box, as a circle — its bounding square calls a corner
// graze an overlap and pushes tags off their best side.
const covers = (box, x, y, r) => Math.hypot(
  x - Math.max(box.x0, Math.min(x, box.x1)),
  y - Math.max(box.y0, Math.min(y, box.y1)),
) < r;

// Where each tag goes: just off its player's disc, on whichever of four sides
// covers the least — never the ball, never the other tag, as few players as
// possible — and on screen. A fixed side doesn't hold up: the defender
// usually stands between his man and the rim, but at the rim he squares up
// beside him, and a blocked shot's loose ball lands right where the
// shooter's tag would go. Preferences only break ties: the ball handler's
// tag away from the basket (upright) or above him (on its side), the
// defender's away from the ball handler. `view` is what's on screen, in
// SVG units.
function placeTags(tags, players, ballAt, { project, view, up }) {
  const placed = [];
  for (const t of tags) {
    const [X, Y] = project(t.pl.x, t.pl.y);
    const other = tags.find((o) => o !== t);
    const awayUp = other ? project(other.pl.x, other.pl.y)[1] > Y : up;
    const sides = [
      { dx: 0, dy: awayUp ? -1 : 1 }, { dx: 0, dy: awayUp ? 1 : -1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    ];
    let best = null;
    sides.forEach((s, rank) => {
      let dx = s.dx * (TAG_GAP + t.w / 2);
      const dy = s.dy * (TAG_GAP + t.h / 2);
      // Slide along a sideline rather than off it.
      dx += Math.min(Math.max(0, view.x0 + 0.1 - (X + dx - t.w / 2)), view.x1 - 0.1 - (X + dx + t.w / 2));
      const box = { x0: X + dx - t.w / 2, x1: X + dx + t.w / 2, y0: Y + dy - t.h / 2, y1: Y + dy + t.h / 2 };
      let cost = rank;
      if (box.y0 < view.y0 || box.y1 > view.y1) cost += 1000;
      if (ballAt && covers(box, ballAt[0], ballAt[1], 0.8)) cost += 100;
      for (const p of placed) if (overlaps(box, p.box)) cost += 100;
      for (const pl of players) if (pl.id !== t.id && covers(box, ...project(pl.x, pl.y), 1.3)) cost += 10;
      if (!best || cost < best.cost) best = { cost, dx, dy, box };
    });
    placed.push({ ...t, ...best });
  }
  return placed;
}

// Shows an element only for `windows` of the play's time ([[from, to]], as
// shares of it), with the Web Animations API — a name tag, while its man
// has the ball. Held, or with reduced motion, it's simply as it is at the
// start or the end.
function useShownFor(ref, windows, ms, hold) {
  const msRef = useRef(ms);
  msRef.current = ms;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.animate || hold || motionReduced() || !windows?.length) return undefined;
    if (windows.length === 1 && windows[0][0] <= 0 && windows[0][1] >= 1) return undefined;   // throughout
    const kf = [];
    const add = (opacity, offset) => kf.push({ opacity, offset: Math.min(1, Math.max(kf.length ? kf[kf.length - 1].offset : 0, offset)) });
    add(windows[0][0] <= 0 ? 1 : 0, 0);
    for (const [a, b] of windows) {
      if (a > 0) { add(0, a - 0.012); add(1, a); }
      if (b < 1) { add(1, b); add(0, b + 0.012); }
    }
    add(windows[windows.length - 1][1] >= 1 ? 1 : 0, 1);
    const show = el.animate(kf, { duration: Math.max(1, msRef.current), fill: 'forwards' });
    return () => show.cancel();
  }, [windows, hold]); // eslint-disable-line react-hooks/exhaustive-deps
}
const shownAt = (windows, t) => windows.some(([a, b]) => a <= t + 1e-9 && t <= b + 1e-9);

// A tag runs with its player, along the same route, and shows while it's
// his turn: `windows` of the play's time.
function NameTag({ route, kit, text, w, h, dx, dy, font, ms, hold, windows }) {
  const ease = 'cubic-bezier(.4,0,.2,1)';
  const ref = useRef(null);
  const showRef = useRef(null);
  useRoute(ref, route, ms, hold);
  useShownFor(showRef, windows, ms, hold);
  const rest = routeRest(route, hold);
  return (
    <g ref={ref} style={{ transform: `translate(${rest.X}px, ${rest.Y}px)`, pointerEvents: 'none' }}>
      <g ref={showRef} className="court-tag-shown" style={{ opacity: shownAt(windows, hold ? 0 : 1) ? 1 : 0 }}>
        <g className="court-tag" style={{ transform: `translate(${dx}px, ${dy}px)`, transition: `transform 180ms ${ease}` }}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={kit.fill} stroke={kit.ring} strokeWidth={Math.max(0.12, kit.ringWidth * 0.7)} />
          <text y={font * 0.36} textAnchor="middle" fill={kit.text} style={{ fontSize: font, fontWeight: 700 }}>{text}</text>
        </g>
      </g>
    </g>
  );
}

// A player's disc off the court, number and all — the list beside the court
// draws each one exactly as the court does, so a number on the floor finds
// its name at a glance.
export function JerseyDot({ kit, number, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="-1.6 -1.6 3.2 3.2" style={{ display: 'block' }} aria-hidden="true">
      <circle r="1.3" fill={kit.fill} stroke={kit.ring} strokeWidth={kit.ringWidth} />
      <text y="0.45" textAnchor="middle" fill={kit.text} style={{ fontSize: 1.35, fontWeight: 700 }}>{number}</text>
    </svg>
  );
}

// Exported so the scoreboard and the list beside the court show the same jerseys.
export function KitSwatch({ kit, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="-1.6 -1.6 3.2 3.2" style={{ verticalAlign: '-2px' }}>
      <circle r="1.3" fill={kit.fill} stroke={kit.ring} strokeWidth={Math.max(kit.ringWidth, 0.3)} />
    </svg>
  );
}

// `paths` and `ballPath` are the frame's routes (liveFrames' buildFrames):
// how everyone, and the ball, get to where the play has them, over `moveMs`.
// `playT` is when the play itself happens in a set — the rings wait for it —
// and `panT` how much of the time the camera takes to follow the ball up the
// floor, upright. `hold` keeps everything at its start (behind the tip-off
// card); `paused` freezes whatever is moving where it is.
export default function ArenaCourt({
  players, paths = null, holderId, actorId = null, act = null, ballPath, shot, attackTop, homeTeam, awayTeam,
  playerById, moment, moveMs = 320, view = 'half', playT = null, panT = 1, hold = false, paused = false,
}) {
  const full = view === 'full';
  const project = PROJECT[full ? 'full' : 'half'];
  const shape = COURT_SHAPE[full ? 'full' : 'half'];
  // The routes on screen. Kept while the frame and the view are, so a render
  // for anything else (the clock, the score) doesn't restart a run.
  const routes = useMemo(() => {
    const out = {};
    for (const pl of players) {
      const pts = paths?.[pl.id] ?? [{ x: pl.x, y: pl.y, t: 1 }];
      out[pl.id] = pts.map((q) => { const [X, Y] = project(q.x, q.y); return { X, Y, t: q.t }; });
    }
    return out;
  }, [paths, players, project]);
  const ballRoute = useMemo(() => (ballPath?.length ? screenBall(ballPath, project) : null), [ballPath, project]);
  // Who has the ball when (liveFrames' ballHolders): per player, the
  // stretches of the play's time he has it, and who has it at the end.
  const holds = useMemo(() => {
    const hs = ballPath?.length ? ballHolders(ballPath, holderId) : [];
    const byId = new Map();
    hs.forEach((h, i) => {
      if (h.id == null) return;
      if (!byId.has(h.id)) byId.set(h.id, []);
      byId.get(h.id).push([h.t, hs[i + 1]?.t ?? 1]);
    });
    return { byId, end: hs.length ? hs[hs.length - 1].id : holderId };
  }, [ballPath, holderId]);
  const defenderWindow = useMemo(() => [[playT ?? 0, 1]], [playT]);
  // Home in white, away in colour — see courtKit for why colours alone won't do.
  const kits = { home: courtKit(homeTeam.color, true), away: courtKit(awayTeam.color, false) };
  const label = (id) => {
    const p = playerById(id);
    return { number: p?.jerseyNumber ?? '', name: p ? `${p.name} · ${p.pos}` : String(id) };
  };
  const ease = 'cubic-bezier(.4,0,.2,1)';

  // Tags are sized in court feet, so they shrink with the court: measure it
  // and keep the text at 11px or more on screen (a phone's court is a third
  // the width of a desktop's).
  const svgRef = useRef(null);
  const [pxPerFt, setPxPerFt] = useState(12);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const measure = () => { const w = el.getBoundingClientRect().width; if (w > 0) setPxPerFt(w / shape.w); };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [shape.w]);
  // A pause freezes the court mid-play — the runs, the ball, the camera —
  // and play picks it up from there. (The playback loop's clock stops with
  // it.) Only what was moving is frozen: a step taken while paused still
  // plays out.
  const frozen = useRef([]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg?.getAnimations) return;
    if (paused) {
      frozen.current = svg.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
      frozen.current.forEach((a) => a.pause());
    } else {
      frozen.current.forEach((a) => { if (a.playState === 'paused') a.play(); });
      frozen.current = [];
    }
  }, [paused]);

  const tagFont = Math.max(1.15, 11 / pxPerFt);
  const restAt = ballRoute ? [ballRoute[ballRoute.length - 1].X, ballRoute[ballRoute.length - 1].Y] : null;
  // What's on screen, in SVG units: upright, the end the camera is on.
  const camY = full || attackTop ? 0 : HALF;
  const onScreen = { x0: -PAD, x1: shape.w - PAD, y0: camY - PAD, y1: camY + shape.h - PAD };
  // The play's two tags where they end up: on whoever has the ball at the
  // end (nobody, for a loose ball) and on the defender in the play...
  const finalTags = placeTags(
    [holds.end, actorId]
      .map((id, i) => ({ id, role: i ? 'd' : 'h', pl: players.find((x) => x.id === id) }))
      .filter((t) => t.id != null && t.pl)
      .map((t) => ({ ...t, text: surname(playerById(t.id)?.name), ...tagSize(surname(playerById(t.id)?.name), tagFont) })),
    // Upright, up the screen is away from the basket when attacking the
    // bottom end; on its side, a lone tag goes above its man.
    players, restAt, { project, view: onScreen, up: full || !attackTop },
  );
  // ...and before that, one on each man while he has it — above him, unless
  // he's the one it ends with — so a set never names its shooter before the
  // ball has found him. The defender's waits for the play itself.
  const tags = [];
  for (const [id, windows] of holds.byId) {
    const pl = players.find((x) => x.id === id);
    if (!pl) continue;
    const placed = finalTags.find((t) => t.role === 'h' && t.id === id);
    const text = surname(playerById(id)?.name);
    const size = tagSize(text, tagFont);
    tags.push({ id, role: 'h', pl, text, ...size, dx: placed?.dx ?? 0, dy: placed?.dy ?? -(TAG_GAP + size.h / 2), windows });
  }
  const dTag = finalTags.find((t) => t.role === 'd');
  if (dTag) tags.push({ ...dTag, windows: defenderWindow });
  const rim = project(0, moment?.top ? LEN - RIM_Y : RIM_Y);

  return (
    <svg
      ref={svgRef} viewBox={`${-PAD} ${-PAD} ${shape.w} ${shape.h}`} style={{ width: '100%', display: 'block' }}
      data-view={full ? 'full' : 'half'}
    >
      {/* The camera, upright: the bottom half sits 47 units down the world,
          so showing it means sliding everything up by that much. On its side
          the whole floor is in the picture and the camera never moves. */}
      <g style={{ transform: `translate(0px, ${-camY}px)`, transition: full ? 'none' : `transform ${Math.max(1, panT * moveMs)}ms ${ease}` }}>
        {/* Both ends from one set of geometry: the top end is the bottom one
            turned 180°. On its side, the whole upright floor turned a quarter
            — the lines have no text to keep upright, unlike everything below. */}
        <g transform={full ? `translate(${LEN} 0) rotate(90)` : undefined}>
          <g transform={`translate(0 ${HALF})`}><EndMarkings /></g>
          <g transform={`rotate(180 ${W / 2} ${HALF}) translate(0 ${HALF})`}><EndMarkings /></g>
        </g>

        {/* the shot that just went up, left on the floor as a marker */}
        {shot && (
          <circle
            cx={project(shot.x, shot.y)[0]} cy={project(shot.x, shot.y)[1]} r="1"
            fill="none"
            stroke={shot.made ? 'var(--color-success)' : 'var(--color-danger)'}
            strokeWidth="0.3"
          />
        )}

        {/* One list keyed by player, in a fixed order. Keyed by side instead, a
            player whose team just won the ball would be unmounted and remounted
            — and appear at the other end without running there. */}
        {[...players].sort((a, b) => a.id - b.id).map((pl) => (
          <Player
            key={pl.id} route={routes[pl.id]} kit={kits[pl.side]} dimmed={!pl.off} ms={moveMs} hold={hold}
            ring={pl.id === holds.end} act={pl.id === actorId ? act : null} ringsAt={playT} {...label(pl.id)}
          />
        ))}

        {/* Above every disc, so no one stands on a name. Keyed by who and why:
            a tag that stays with its player moves with him, a new one fades in. */}
        {tags.map((t) => (
          <NameTag
            key={`${t.role}${t.id}`} route={routes[t.id]} kit={kits[t.pl.side]} text={t.text}
            w={t.w} h={t.h} dx={t.dx} dy={t.dy} font={tagFont} ms={moveMs} hold={hold} windows={t.windows}
          />
        ))}

        {/* The moment a shot lands: a swish and the points on a make, a glance
            off the iron on a miss. Keyed by play, so each one replays; drawn
            under the ball so the ball stays on top. */}
        {moment && (
          <g key={moment.key} transform={`translate(${rim[0]} ${rim[1]})`}>
            {moment.made ? (
              <>
                <circle className="court-swish" r="1.2" fill="none" stroke={moment.color} strokeWidth="0.35" />
                <text
                  className="court-points" y="-2.6" textAnchor="middle" fill={moment.color}
                  style={{ fontSize: 2.4, fontWeight: 800, pointerEvents: 'none' }}
                >
                  +{moment.pts}
                </text>
              </>
            ) : (
              <circle className="court-clank" r="0.9" fill="none" stroke="var(--court-line)" strokeWidth="0.25" />
            )}
          </g>
        )}

        <Ball route={ballRoute} ms={moveMs} hold={hold} />
      </g>
    </svg>
  );
}
