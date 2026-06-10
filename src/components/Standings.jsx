import React from 'react';
import { standings } from '../engine/league.js';
import { TeamLink } from './shared.jsx';

function ConfTable({ league, conf, openTeam }) {
  const rows = standings(league, conf);
  return (
    <div className="panel">
      <h2>{conf}ern Conference</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th></tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.id} style={t.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
              <td>{i + 1}{i === 7 ? ' —' : ''}</td>
              <td><TeamLink team={t} openTeam={openTeam} /></td>
              <td className="num">{t.wins}</td>
              <td className="num">{t.losses}</td>
              <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Standings({ league, openTeam }) {
  return (
    <div className="grid2">
      <ConfTable league={league} conf="East" openTeam={openTeam} />
      <ConfTable league={league} conf="West" openTeam={openTeam} />
    </div>
  );
}
