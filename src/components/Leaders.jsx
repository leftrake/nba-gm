import React from 'react';
import { LEADER_CATS, LEADER_MIN_GP, leaderMinGp, statLeaders } from '../engine/awards.js';
import { PlayerLink } from './PlayerDisplay.jsx';
import { TeamLink, TeamBadge } from './TeamDisplay.jsx';

function LeaderTable({ league, statKey, label, unit, openPlayer, openTeam, openStats }) {
  const rows = statLeaders(league, statKey);
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>{label}</h2>
        <button
          className="btn small secondary"
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
          onClick={() => openStats(statKey)}
        >
          See full stats →
        </button>
      </div>
      {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>Player</th><th>Team</th><th className="num">{unit}</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.p.id} style={r.team.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
                <td>{i + 1}</td>
                <td><PlayerLink p={r.p} openPlayer={openPlayer} /></td>
                <td><TeamBadge team={r.team} size="small" /> <TeamLink team={r.team} openTeam={openTeam}>{r.team.name}</TeamLink></td>
                <td className="num">{r.value.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Leaders({ league, openPlayer, openTeam, openStats }) {
  const minGp = leaderMinGp(league);
  return (
    <div>
      <p style={{ color: 'var(--muted)', marginBottom: 12 }}>
        Per-game leaders, minimum {LEADER_MIN_GP} games played
        {minGp < LEADER_MIN_GP ? ` (scaled to ${minGp} this early in the season)` : ''}.
      </p>
      <div className="grid2">
        {LEADER_CATS.map(([key, label, unit]) => (
          <LeaderTable
            key={key}
            league={league}
            statKey={key}
            label={label}
            unit={unit}
            openPlayer={openPlayer}
            openTeam={openTeam}
            openStats={openStats}
          />
        ))}
      </div>
    </div>
  );
}
