import React from 'react';
import { standings } from '../engine/league.js';
import { TeamLink } from './shared.jsx';

// Games back from the leader of the group: ((leadW - W) + (L - leadL)) / 2
function gamesBack(leader, t) {
  const gb = (leader.wins - t.wins + (t.losses - leader.losses)) / 2;
  return gb <= 0 ? '–' : gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1);
}

function ConfTable({ league, conf, openTeam }) {
  const rows = standings(league, conf);
  return (
    <div className="panel">
      <h2>{conf}ern Conference</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th><th className="num">GB</th></tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.id} style={t.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
              <td>{i + 1}{i === 7 ? ' —' : ''}</td>
              <td><TeamLink team={t} openTeam={openTeam} /></td>
              <td className="num">{t.wins}</td>
              <td className="num">{t.losses}</td>
              <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
              <td className="num">{gamesBack(rows[0], t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeagueTable({ league, openTeam }) {
  const rows = standings(league);
  return (
    <div className="panel">
      <h2>League</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th>Conf</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th><th className="num">GB</th></tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.id} style={t.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
              <td>{i + 1}</td>
              <td><TeamLink team={t} openTeam={openTeam} /></td>
              <td>{t.conf}</td>
              <td className="num">{t.wins}</td>
              <td className="num">{t.losses}</td>
              <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
              <td className="num">{gamesBack(rows[0], t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Standings({ league, openTeam }) {
  return (
    <div>
      <div className="grid2">
        <ConfTable league={league} conf="East" openTeam={openTeam} />
        <ConfTable league={league} conf="West" openTeam={openTeam} />
      </div>
      <LeagueTable league={league} openTeam={openTeam} />
    </div>
  );
}
