import React, { useEffect } from 'react';
import { getTeam } from '../engine/league.js';
import { PlayerLink } from './PlayerDisplay.jsx';
import { TeamLink, TeamBadge } from './TeamDisplay.jsx';
import { asLines, usePlayerIndex } from './BoxScore.jsx';

// Per-player totals across every stored box in the series, best scorers
// first. Series from saves predating playoff box scores produce no rows.
function seriesLeaders(series) {
  const totals = new Map();
  for (const g of series.games || []) {
    for (const [teamId, box] of [[g.home, g.homeBox], [g.away, g.awayBox]]) {
      if (!box) continue;
      for (const l of asLines(box)) {
        if (!l.min) continue;
        const t = totals.get(l.playerId) || { playerId: l.playerId, teamId, gp: 0, pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0 };
        t.gp += 1; t.pts += l.pts; t.reb += l.reb; t.ast += l.ast; t.fgm += l.fgm; t.fga += l.fga;
        totals.set(l.playerId, t);
      }
    }
  }
  return [...totals.values()].sort((a, b) => b.pts / b.gp - a.pts / a.gp).slice(0, 8);
}

// One playoff series: every game played so far (each linking to its game
// page) plus stat leaders across the series.
export default function SeriesModal({ league, series, roundName, onClose, openGame, openTeam, openPlayer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byId = usePlayerIndex(league);
  const high = getTeam(league, series.high);
  const low = getTeam(league, series.low);
  const games = series.games || [];
  const leaders = seriesLeaders(series);
  const per = (t, k) => (t[k] / t.gp).toFixed(1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>
            {roundName}:{' '}
            <span className={series.winner === series.high ? 'winner' : ''}><TeamBadge team={high} size="small" /> {high.name} {series.highWins}</span>
            {' – '}
            <span className={series.winner === series.low ? 'winner' : ''}>{series.lowWins} {low.name} <TeamBadge team={low} size="small" /></span>
            {series.winner && <span className="tag" style={{ marginLeft: 8, color: 'var(--green)' }}>
              <TeamBadge team={getTeam(league, series.winner)} size="small" /> {getTeam(league, series.winner).name} win
            </span>}
          </h2>
          <button className="btn small secondary" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
        </div>

        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <h3>Games</h3>
            {games.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
            {games.map((g, i) => {
              const open = () => openGame(g, `${roundName} · Game ${i + 1}`);
              return (
                <div className="result-row" key={i}>
                  <span style={{ color: 'var(--muted)' }}>G{i + 1}</span>
                  <span className={g.awayPts > g.homePts ? 'winner' : ''}>
                    <TeamBadge team={getTeam(league, g.away)} size="small" /> {getTeam(league, g.away).name} {g.awayPts}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>@</span>
                  <span className={g.homePts > g.awayPts ? 'winner' : ''}>
                    <TeamBadge team={getTeam(league, g.home)} size="small" /> {getTeam(league, g.home).name} {g.homePts}
                  </span>
                  {g.homeBox
                    ? <a className="team-link" style={{ color: 'var(--accent)', fontSize: 12 }} onClick={open}>view ▸</a>
                    : <span style={{ fontSize: 12 }} />}
                </div>
              );
            })}
          </div>
          <div>
            <h3>Series Leaders</h3>
            {leaders.length === 0 && <p style={{ color: 'var(--muted)' }}>No box scores stored for this series.</p>}
            {leaders.length > 0 && (
              <table>
                <thead>
                  <tr><th>Player</th><th>Team</th><th className="num">GP</th><th className="num">PPG</th><th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th></tr>
                </thead>
                <tbody>
                  {leaders.map((t) => {
                    const p = byId.get(t.playerId);
                    return (
                      <tr key={t.playerId}>
                        <td>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'}</td>
                        <td><TeamBadge team={getTeam(league, t.teamId)} size="small" /> <TeamLink team={getTeam(league, t.teamId)} openTeam={openTeam}>{t.teamId}</TeamLink></td>
                        <td className="num">{t.gp}</td>
                        <td className="num"><b>{per(t, 'pts')}</b></td>
                        <td className="num">{per(t, 'reb')}</td>
                        <td className="num">{per(t, 'ast')}</td>
                        <td className="num">{t.fga ? ((t.fgm / t.fga) * 100).toFixed(1) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
