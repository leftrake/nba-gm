// Where the other nine players are standing.
//
// READ THIS FIRST: unlike everything else the sim emits, none of this is
// simulated. The possession loop models who shoots, from where, against what
// level of defense — it never models off-ball movement, so there is no true
// answer to "where was the weakside forward standing". This module invents a
// plausible one.
//
// It is here rather than in a component because it is pure court geometry
// with no React in it, next to shotZones.js which owns the same coordinate
// space: half-court feet, origin at the centre of the rim, x -25..25
// (negative = offense's left), y 0..47 toward half court. Nothing in the sim
// reads it, and nothing in it feeds a rating, a probability or a box score.
//
// Everything is deterministic given the same inputs, so a replayed game puts
// the same players in the same places rather than reshuffling on each frame.

const RIM_Y = 5.25;

// Standard half-court spacing: the places NBA offenses actually stand.
const SPOTS = {
  cornerL:  { x: -22, y: 3 },
  cornerR:  { x: 22, y: 3 },
  wingL:    { x: -20, y: 18 },
  wingR:    { x: 20, y: 18 },
  slotL:    { x: -11, y: 25 },
  slotR:    { x: 11, y: 25 },
  top:      { x: 0, y: 28 },
  blockL:   { x: -6, y: 5 },
  blockR:   { x: 6, y: 5 },
  highPost: { x: 0, y: 16 },
};

// Spot preference by listed position — guards up top and on the wings, bigs
// inside. Each list is a fallback chain for when a spot is already taken.
const PREF = {
  PG: ['top', 'slotL', 'slotR', 'wingL', 'wingR', 'cornerL'],
  SG: ['wingR', 'slotR', 'cornerR', 'top', 'wingL', 'cornerL'],
  SF: ['wingL', 'slotL', 'cornerL', 'wingR', 'top', 'cornerR'],
  PF: ['blockL', 'highPost', 'cornerL', 'blockR', 'slotL', 'wingL'],
  C:  ['blockR', 'blockL', 'highPost', 'cornerR', 'slotR', 'wingR'],
};
const FALLBACK = ['top', 'wingL', 'wingR', 'cornerL', 'cornerR', 'slotL', 'slotR', 'highPost', 'blockL', 'blockR'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Offensive shape around the ball.
//
// `five`: [{ id, pos }] — the offense on the floor.
// `ball`: { x, y } — where the action is (a shot's coordinates, say).
// `handlerId`: whoever has it; he stands at the ball, everyone else spaces.
// Returns { [id]: { x, y } }.
export function offenseFormation(five, ball, handlerId) {
  const out = {};
  const taken = new Set();
  const others = [];
  for (const p of five) {
    if (p.id === handlerId) out[p.id] = { x: ball.x, y: ball.y };
    else others.push(p);
  }
  // Bigs claim their spots first — they have the fewest viable ones.
  const order = [...others].sort((a, b) => (PREF[b.pos] ? 1 : 0) - (PREF[a.pos] ? 1 : 0)
    || ['C', 'PF', 'SF', 'SG', 'PG'].indexOf(a.pos) - ['C', 'PF', 'SF', 'SG', 'PG'].indexOf(b.pos));
  for (const p of order) {
    const prefs = [...(PREF[p.pos] ?? []), ...FALLBACK];
    // Skip spots already taken, and any spot the ball is sitting on — the
    // handler is there, nobody should be standing on top of him.
    const pick = prefs.find((s) => !taken.has(s) && dist(SPOTS[s], ball) > 6)
      ?? prefs.find((s) => !taken.has(s))
      ?? FALLBACK.find((s) => !taken.has(s));
    taken.add(pick);
    out[p.id] = { ...SPOTS[pick] };
  }
  return out;
}

// Defensive shape: each defender sits between his man and the rim, tighter on
// the ball and sagging off a man far from it.
//
// `matchups`: { [defenderId]: offensivePlayerId }. A sensible default is to
// pair by position; the shot's own `d` field names the on-ball defender.
export function defenseFormation(offense, matchups, ball, onBallDefenderId) {
  const rim = { x: 0, y: RIM_Y };
  const out = {};
  for (const [defId, manId] of Object.entries(matchups)) {
    const man = offense[manId];
    if (!man) continue;
    const onBall = defId === String(onBallDefenderId);
    // A fixed gap in feet, not a fraction of the distance to the rim: scaling
    // collapses to zero for a man standing under the basket, which drops the
    // defender exactly on top of him.
    const gap = onBall ? 2.5 : Math.min(6, 3 + dist(man, ball) / 8);
    const toRim = dist(man, rim);
    if (toRim > gap + 0.5) {
      // Normal case: step into the gap between his man and the basket.
      const k = gap / toRim;
      out[defId] = {
        x: +(man.x + (rim.x - man.x) * k).toFixed(2),
        y: +(man.y + (rim.y - man.y) * k).toFixed(2),
      };
    } else {
      // His man is already at the rim — there's no room in front, so body up
      // beside him instead, square to the basket.
      const ang = Math.atan2(man.y - rim.y, man.x - rim.x) + Math.PI / 2;
      out[defId] = {
        x: +Math.max(-24, Math.min(24, man.x + Math.cos(ang) * gap)).toFixed(2),
        y: +Math.max(0, man.y + Math.sin(ang) * gap).toFixed(2),
      };
    }
  }
  return out;
}

// Pair defenders to offensive players by listed position — the default
// matchup when nothing better is known.
export function positionMatchups(defenders, attackers) {
  const slot = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
  const left = [...attackers];
  const out = {};
  for (const d of [...defenders].sort((a, b) => (slot[a.pos] ?? 2) - (slot[b.pos] ?? 2))) {
    let bestI = 0;
    let best = Infinity;
    left.forEach((a, i) => {
      const gap = Math.abs((slot[a.pos] ?? 2) - (slot[d.pos] ?? 2));
      if (gap < best) { best = gap; bestI = i; }
    });
    if (left.length) out[d.id] = left.splice(bestI, 1)[0].id;
  }
  return out;
}

export { SPOTS as OFFENSIVE_SPOTS };
