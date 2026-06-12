import React from 'react';
import { PlayerLink } from './shared.jsx';

// Report row arrays come from ratingRow() in engine/players.js:
// [overall, inside, mid, three, passing, rebounding, defense, athleticism, stamina]
const ATTR_LABELS = ['Ins', 'Mid', '3PT', 'Pass', 'Reb', 'Def', 'Ath', 'Sta'];

const BREAKOUT = 5; // overall gain that counts as a breakout leap
const COLLAPSE = -5; // overall loss that counts as a steep decline

function Delta({ d }) {
  if (!d) return <span style={{ color: 'var(--muted)' }}>·</span>;
  return (
    <span style={{ color: d > 0 ? 'var(--green)' : 'var(--red)' }}>
      {d > 0 ? '▲' : '▼'}{Math.abs(d)}
    </span>
  );
}

// The user team's offseason development results (league.devReport), built by
// advanceOffseason: every player who was on the roster when development ran,
// including those who then retired or hit free agency.
export default function DevelopmentReport({ league, openPlayer, onContinue }) {
  const report = league.devReport;
  if (!report?.entries?.length) {
    return (
      <div className="panel">
        <h2>Development Report</h2>
        <p style={{ color: 'var(--muted)' }}>No development report yet — advance through an offseason first.</p>
      </div>
    );
  }

  // players still in the league, for linking to their card
  const live = new Map();
  for (const t of league.teams) for (const p of t.roster) live.set(p.id, p);
  for (const p of league.freeAgents) live.set(p.id, p);

  const entries = [...report.entries].sort(
    (a, b) => (b.now[0] - b.old[0]) - (a.now[0] - a.old[0])
  );

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2>Development Report — {report.season} Offseason</h2>
        {onContinue && (
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={onContinue}>Continue →</button>
        )}
      </div>
      <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
        How every player on your roster developed over the summer, biggest gains first.{' '}
        <span style={{ color: '#d2a8ff' }}>🚀 breakout leap</span> ·{' '}
        <span style={{ color: 'var(--red)' }}>📉 steep decline</span>
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Player</th><th>Pos</th><th className="num">Age</th>
              <th className="num">Overall</th><th></th>
              {ATTR_LABELS.map((l) => <th className="num" key={l}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const d = e.now[0] - e.old[0];
              const highlight = d >= BREAKOUT
                ? { boxShadow: 'inset 3px 0 0 #d2a8ff', background: 'var(--panel2)' }
                : d <= COLLAPSE
                  ? { boxShadow: 'inset 3px 0 0 var(--red)', background: 'var(--panel2)' }
                  : undefined;
              const p = live.get(e.id);
              return (
                <tr key={e.id} style={highlight}>
                  <td>
                    {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : e.name}
                    {d >= BREAKOUT && ' 🚀'}
                    {d <= COLLAPSE && ' 📉'}
                    {e.retired && <span className="tag" style={{ marginLeft: 6 }}>retired</span>}
                  </td>
                  <td>{e.pos}</td>
                  <td className="num">{e.age}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--muted)' }}>{e.old[0]} →</span> <b>{e.now[0]}</b>
                  </td>
                  <td className="num"><Delta d={d} /></td>
                  {ATTR_LABELS.map((l, i) => (
                    <td className="num" key={l}><Delta d={e.now[i + 1] - e.old[i + 1]} /></td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
