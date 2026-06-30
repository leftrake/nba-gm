import React from 'react';
import { PlayerLink } from './PlayerDisplay.jsx';

// Report row arrays come from ratingRow() in engine/players.js:
// [overall, ...HISTORY_KEYS (14 ratings), stamina]
const ATTR_LABELS = ['CS', 'Mid', '3PT', 'FT', 'Pass', 'BH', 'PerD', 'IntD', 'Stl', 'Blk', 'OReb', 'DReb', 'Spd', 'Str', 'Sta'];

const BREAKOUT = 4; // overall gain that counts as a breakout leap
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
//
// When onContinue is provided this renders as the second offseason phase's
// full-screen gate; otherwise (the "Dev Report" nav tab, available after the
// phase has passed) it renders as a plain panel.
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

  const entries = [...report.entries].sort((a, b) => b.now[0] - a.now[0]);

  const breakouts = entries.filter((e) => !e.retired && (e.now[0] - e.old[0]) >= BREAKOUT);
  const declines = entries.filter((e) => !e.retired && (e.now[0] - e.old[0]) <= COLLAPSE);
  const retirements = entries.filter((e) => e.retired && e.farewell);

  const content = (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2>Development Report — {report.season} Offseason</h2>
      </div>
      <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
        How every player on your roster developed over the summer, sorted by final overall.{' '}
        <span style={{ color: '#d2a8ff' }}>🚀 breakout leap</span> ·{' '}
        <span style={{ color: 'var(--red)' }}>📉 steep decline</span>
      </p>

      {breakouts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>🚀 Breakout Leaps</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {breakouts.map((e) => {
              const p = live.get(e.id);
              const d = e.now[0] - e.old[0];
              return (
                <div key={e.id} className="panel" style={{ boxShadow: 'inset 0 0 0 1px #d2a8ff' }}>
                  <div style={{ fontWeight: 600 }}>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : e.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{e.pos} · Age {e.age}</div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: 'var(--muted)' }}>{e.old[0]} →</span>{' '}
                    <b style={{ fontSize: 18 }}>{e.now[0]}</b>{' '}
                    <span style={{ color: 'var(--green)' }}>(+{d})</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {declines.length > 0 && (
        <div className="panel" style={{ boxShadow: 'inset 3px 0 0 var(--red)', marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>📉 Steep Declines</h3>
          {declines.map((e) => {
            const p = live.get(e.id);
            const d = e.now[0] - e.old[0];
            return (
              <div key={e.id}>
                {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : e.name}{' '}
                <span style={{ color: 'var(--muted)' }}>{e.old[0]} →</span> <b>{e.now[0]}</b>{' '}
                <span style={{ color: 'var(--red)' }}>({d})</span>
              </div>
            );
          })}
        </div>
      )}

      {retirements.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Retirements</h3>
          {retirements.map((e) => (
            <p key={e.id} style={{ margin: '4px 0' }}>{e.farewell}</p>
          ))}
        </div>
      )}

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
    </>
  );

  if (!onContinue) {
    return <div className="panel">{content}</div>;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card wide offseason-gate">
        {content}
        <div className="controls" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn" onClick={onContinue}>Continue</button>
        </div>
      </div>
    </div>
  );
}
