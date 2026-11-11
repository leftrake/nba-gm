import React from 'react';
import { safeAccent } from '../engine/colorUtils.js';

// The court, drawn in the same coordinate space the sim emits shots in
// (shotZones.js): half-court feet, origin at the centre of the rim, x -25..25
// and y 0..47 from the baseline. Half court rather than full because that is
// what the data describes — the sim models a possession, never the transition
// between ends, so a full court would be ten players crowded into one half
// and an empty sheet beside them.
//
// Real NBA geometry: 16ft lane 19ft deep, 6ft free-throw circle, 4ft
// restricted arc, 23.75ft three above the break breaking to 22ft in the
// corners.

const W = 50;      // court width, feet
const H = 47;      // baseline to half court
const RIM_Y = 5.25;
const ARC = 23.75;
const CORNER_X = 22;
const LANE_W = 16;
const LANE_D = 19;

// Court feet -> SVG units. x shifts to 0..50; y flips so the baseline (y=0)
// sits at the bottom of the picture and half court is up top.
const sx = (x) => x + W / 2;
const sy = (y) => H - y;

// Where the corner three meets the arc: 22ft out, on a 23.75ft radius.
const CORNER_Y = RIM_Y + Math.sqrt(ARC * ARC - CORNER_X * CORNER_X);

function Markings() {
  const rimX = sx(0);
  const rimY = sy(RIM_Y);
  return (
    <g fill="none" stroke="var(--court-line)" strokeWidth="0.22">
      <rect x={sx(-W / 2)} y={sy(H)} width={W} height={H} fill="var(--court-floor)" />
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
      {/* half court */}
      <line x1={sx(-W / 2)} y1={sy(H)} x2={sx(W / 2)} y2={sy(H)} />
      <path d={`M ${sx(-6)} ${sy(H)} A 6 6 0 0 0 ${sx(6)} ${sy(H)}`} />
    </g>
  );
}

function Player({ at, color, textColor, number, name, ring, dimmed, ms }) {
  return (
    <g
      style={{
        transform: `translate(${sx(at.x)}px, ${sy(at.y)}px)`,
        transition: `transform ${ms}ms cubic-bezier(.4,0,.2,1)`,
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {ring && <circle r="1.95" fill="none" stroke="var(--court-ball)" strokeWidth="0.3" opacity="0.9" />}
      {/* 1.3ft radius, not a true ~2ft shoulder width: defenders legitimately
          stand 3ft off their man, and at real scale the two discs merge. */}
      <circle r="1.3" fill={color} stroke="rgba(0,0,0,.55)" strokeWidth="0.16" />
      <text
        y="0.45" textAnchor="middle" fill={textColor}
        style={{ fontSize: 1.35, fontWeight: 700, pointerEvents: 'none' }}
      >
        {number}
      </text>
      <title>{name}</title>
    </g>
  );
}

export default function ArenaCourt({
  offense, defense, ball, offenseTeam, defenseTeam, playerById, shot, handlerId, moveMs = 320,
}) {
  const offColor = safeAccent(offenseTeam.color);
  const defColor = safeAccent(defenseTeam.color);
  // Object.entries hands back string keys; player ids are numbers.
  const label = (id) => {
    const p = playerById(Number(id));
    return { number: p?.jerseyNumber ?? '', name: p ? `${p.name} · ${p.pos}` : String(id) };
  };

  return (
    <svg viewBox={`-1.5 -1.5 ${W + 3} ${H + 3}`} style={{ width: '100%', display: 'block' }}>
      <Markings />

      {/* the shot that just went up, left on the floor as a marker */}
      {shot && (
        <circle
          cx={sx(shot.x)} cy={sy(shot.y)} r="1"
          fill="none"
          stroke={shot.made ? 'var(--color-success)' : 'var(--color-danger)'}
          strokeWidth="0.3"
        />
      )}

      {Object.entries(defense).map(([id, at]) => (
        <Player key={`d${id}`} at={at} color={defColor} textColor="#fff" dimmed ms={moveMs} {...label(id)} />
      ))}
      {Object.entries(offense).map(([id, at]) => (
        <Player
          key={`o${id}`} at={at} color={offColor} textColor="#fff" ms={moveMs}
          ring={Number(id) === handlerId} {...label(id)}
        />
      ))}

      {/* Beside the handler, not on top of him — drawn last, it would otherwise
          sit squarely over his number. */}
      <circle
        cx={sx(ball.x) + 1.15} cy={sy(ball.y) - 0.95} r="0.62"
        fill="var(--court-ball)" stroke="rgba(0,0,0,.5)" strokeWidth="0.12"
        style={{ transition: `cx ${moveMs}ms cubic-bezier(.4,0,.2,1), cy ${moveMs}ms cubic-bezier(.4,0,.2,1)` }}
      />
    </svg>
  );
}
