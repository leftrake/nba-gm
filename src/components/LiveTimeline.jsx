import React, { useId, useMemo, useRef, useState } from 'react';
import { KitSwatch } from './ArenaCourt.jsx';
import { flowLine } from './liveFrames.js';

// The viewer's timeline, video-player style, with the game's flow drawn along
// it: the margin after every play, the away side's leads above the line and
// the home side's below (the line score's order, away over home), each in the
// jersey it wears on the court — home white, away in color (courtKit), since
// two teams' own colors can't be trusted to differ.
//
// Drawn only as far as the game has been watched, on a scale set only by the
// leads so far: a line running on past where you are, or a scale sized for a
// 25-point lead still to come, would give the game away. The timeline itself
// stops at the end of regulation until overtime is reached (LiveGame).
//
// The range input is still the control — dragging, clicking, the keyboard —
// laid over the graph with its track cleared and its thumb a playhead, so the
// graph is the track. The graph is inset by half the thumb's width either
// side, which puts play `v` directly under the thumb at value `v`.

const THUMB = 14;   // px — the playhead's width (styles.css draws it)

export default function LiveTimeline({ idx, max, plays, scoreAt, periods, home, away, kits, onSeek, valuetext }) {
  const upto = Math.min(idx, max);
  const span = Math.max(1, max);
  const gid = `live-flow-${useId().replace(/:/g, '')}`;

  // A step line — the margin only changes when someone scores — on a scale
  // from the plays watched so far (liveFrames.js).
  const { d: line, scale } = useMemo(() => flowLine(scoreAt, upto), [scoreAt, upto]);

  // Hovering reads off the score at any moment already watched — never one
  // still to come.
  const [hover, setHover] = useState(null);
  const flowRef = useRef(null);
  const graphRef = useRef(null);
  const onMove = (e) => {
    const g = graphRef.current?.getBoundingClientRect();
    const f = flowRef.current?.getBoundingClientRect();
    if (!g?.width || !f) return;
    const v = Math.round(Math.min(1, Math.max(0, (e.clientX - g.left) / g.width)) * span);
    setHover(v <= upto ? { v, x: g.left - f.left + (v / span) * g.width, w: f.width } : null);
  };
  const tip = hover && (() => {
    const s = hover.v > 0 ? scoreAt[hover.v - 1] : { away: 0, home: 0 };
    const p = plays[hover.v - 1];
    return { s, when: p ? `${p.q} ${p.t}` : 'Tip-off', left: Math.min(Math.max(hover.x, 72), hover.w - 72) };
  })();
  const ticks = periods.filter((pd) => pd.at > 0 && pd.at < span);

  return (
    <div className="live-timeline">
      {/* The legend: who's above the line and who's below. */}
      <div className="live-flow-key" aria-hidden="true">
        <span><KitSwatch kit={kits.away} size={9} />{away.id}</span>
        <span><KitSwatch kit={kits.home} size={9} />{home.id}</span>
      </div>
      <div className="live-flow-main">
        <div
          className="live-flow" ref={flowRef}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}
        >
          <svg
            className="live-flow-graph" ref={graphRef} aria-hidden="true"
            viewBox={`0 ${-scale} ${span} ${2 * scale}`} preserveAspectRatio="none"
            style={{ left: THUMB / 2, width: `calc(100% - ${THUMB}px)` }}
          >
            <defs>
              {/* One color above the tie line, the other below. */}
              <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1={-scale} x2="0" y2={scale}>
                <stop offset="0.5" stopColor={kits.away.fill} />
                <stop offset="0.5" stopColor={kits.home.fill} />
              </linearGradient>
            </defs>
            {ticks.map((pd) => (
              <line key={pd.q} className="live-flow-grid" x1={pd.at} x2={pd.at} y1={-scale} y2={scale} vectorEffect="non-scaling-stroke" />
            ))}
            {upto > 0 && (
              <>
                <path d={`${line}V0Z`} fill={`url(#${gid})`} className="live-flow-area" />
                <path d={line} fill="none" stroke={`url(#${gid})`} className="live-flow-line" vectorEffect="non-scaling-stroke" />
              </>
            )}
            <line className="live-flow-zero" x1="0" x2={span} y1="0" y2="0" vectorEffect="non-scaling-stroke" />
          </svg>
          <input
            type="range" min={0} max={span} step={1} value={upto}
            onChange={(e) => onSeek(+e.target.value)}
            aria-label="Game timeline" aria-valuetext={valuetext}
          />
          {tip && (
            <>
              <div className="live-flow-cross" style={{ left: hover.x }} aria-hidden="true" />
              <div className="live-flow-tip" style={{ left: tip.left }} aria-hidden="true">
                <strong>{away.id} {tip.s.away}–{tip.s.home} {home.id}</strong>
                <span>{tip.when}</span>
              </div>
            </>
          )}
        </div>
        <div className="live-timeline-ticks" aria-hidden="true" style={{ left: THUMB / 2, right: THUMB / 2 }}>
          {ticks.map((pd) => (
            <span key={pd.q} style={{ left: `${(pd.at / span) * 100}%` }}>{pd.q}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
