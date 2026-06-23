import React from 'react';
import { ZONES } from '../engine/shotZones.js';

// Rough schematic half-court layout for the 8 tracked zones — not
// court-accurate geometry, just a readable fan-out from the rim (low y)
// to the three-point arc (high y / far x) so volume+efficiency reads at a
// glance. Zones without a real left/right split in the data (rim, paint,
// midTop, top3) get one centered shape; the rest get a mirrored pair
// showing the same aggregate value on both sides.
const SHAPES = {
  rim:      [{ type: 'circle', cx: 150, cy: 40, r: 24 }],
  paint:    [{ type: 'rect', x: 105, y: 64, w: 90, h: 55 }],
  midBase:  [{ type: 'rect', x: 45, y: 35, w: 65, h: 55 }, { type: 'rect', x: 190, y: 35, w: 65, h: 55 }],
  midElbow: [{ type: 'rect', x: 60, y: 110, w: 65, h: 65 }, { type: 'rect', x: 175, y: 110, w: 65, h: 65 }],
  midTop:   [{ type: 'rect', x: 115, y: 175, w: 70, h: 35 }],
  corner3:  [{ type: 'rect', x: 0, y: 15, w: 45, h: 50 }, { type: 'rect', x: 255, y: 15, w: 45, h: 50 }],
  wing3:    [{ type: 'rect', x: 0, y: 90, w: 70, h: 80 }, { type: 'rect', x: 230, y: 90, w: 70, h: 80 }],
  top3:     [{ type: 'rect', x: 90, y: 210, w: 120, h: 35 }],
};

// Roughly the type-level baseline make% the sim's formulas average out to
// (see sim.js's playShots) — used only to color a zone relative to "about
// what you'd expect there" rather than on one absolute scale, since a
// great 3PT zone and a great rim zone sit at very different raw percentages.
const TYPE_BASELINE = { ins: 0.54, mid: 0.41, three: 0.35 };

function zoneColor(pct, expected) {
  if (pct == null) return 'var(--border)';
  const diff = pct - expected;
  if (diff >= 0.08) return 'var(--color-elite)';
  if (diff >= 0.03) return 'var(--color-success)';
  if (diff >= -0.03) return 'var(--color-info)';
  if (diff >= -0.08) return 'var(--text-muted)';
  return 'var(--color-danger)';
}

// `stats` is any flat stats-shaped object carrying the zone Fgm/Fga
// columns — a season `p.stats` or a decoded box-score line both work.
export default function ShotChart({ stats }) {
  const totalFga = ZONES.reduce((s, z) => s + (stats[`${z.id}Fga`] || 0), 0);
  if (totalFga === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No shot data yet.</div>;
  }
  return (
    <div>
      <svg viewBox="0 0 300 250" style={{ width: '100%', maxWidth: 360, display: 'block', margin: '0 auto' }}>
        <rect x="0" y="0" width="300" height="250" fill="none" stroke="var(--border)" strokeWidth="1.5" />
        <path d="M 20 15 A 130 130 0 0 0 280 15" fill="none" stroke="var(--border)" strokeWidth="1" strokeDasharray="3,3" />
        <rect x="105" y="0" width="90" height="115" fill="none" stroke="var(--border)" strokeWidth="1" />
        <circle cx="150" cy="15" r="3" fill="var(--text-muted)" />
        {ZONES.map((z) => {
          const fgm = stats[`${z.id}Fgm`] || 0;
          const fga = stats[`${z.id}Fga`] || 0;
          const pct = fga > 0 ? fgm / fga : null;
          const expected = TYPE_BASELINE[z.type] + z.fgAdj;
          const color = zoneColor(pct, expected);
          const opacity = fga === 0 ? 0.15 : Math.min(0.9, 0.35 + fga / Math.max(totalFga, 1) * 2);
          return SHAPES[z.id].map((shape, i) => (
            <g key={`${z.id}-${i}`}>
              {shape.type === 'circle'
                ? <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={color} opacity={opacity} stroke="var(--border)" strokeWidth="0.5" />
                : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill={color} opacity={opacity} stroke="var(--border)" strokeWidth="0.5" />}
              {fga > 0 && i === 0 && (
                <text
                  x={shape.type === 'circle' ? shape.cx : shape.x + shape.w / 2}
                  y={(shape.type === 'circle' ? shape.cy : shape.y + shape.h / 2) + 4}
                  textAnchor="middle" fontSize="10" fill="var(--text-primary)"
                >
                  {Math.round(pct * 100)}%
                </text>
              )}
            </g>
          ));
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', justifyContent: 'center', marginTop: 'var(--sp-2)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        {ZONES.map((z) => {
          const fgm = stats[`${z.id}Fgm`] || 0;
          const fga = stats[`${z.id}Fga`] || 0;
          if (fga === 0) return null;
          return <span key={z.id}>{z.label}: {fgm}/{fga} ({Math.round((fgm / fga) * 100)}%)</span>;
        })}
      </div>
    </div>
  );
}
