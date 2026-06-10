import React, { useState } from 'react';
import { getTeam, payroll, releasePlayer } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { SALARY_CAP } from '../data/teams.js';
import { Ovr, money, perGame, fgPct } from './shared.jsx';

export default function Roster({ league, commit }) {
  const [teamId, setTeamId] = useState(league.userTeamId);
  const [sortKey, setSortKey] = useState('ovr');
  const team = getTeam(league, teamId);
  const isUser = teamId === league.userTeamId;

  const sorted = [...team.roster].sort((a, b) => {
    if (sortKey === 'ovr') return overall(b) - overall(a);
    if (sortKey === 'age') return a.age - b.age;
    if (sortKey === 'salary') return (b.contract?.salary || 0) - (a.contract?.salary || 0);
    if (sortKey === 'pts') return (b.stats.gp ? b.stats.pts / b.stats.gp : 0) - (a.stats.gp ? a.stats.pts / a.stats.gp : 0);
    return 0;
  });

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {league.teams.map((t) => (
            <option key={t.id} value={t.id}>{t.city} {t.name}</option>
          ))}
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          <option value="ovr">Sort: Overall</option>
          <option value="age">Sort: Age</option>
          <option value="salary">Sort: Salary</option>
          <option value="pts">Sort: PPG</option>
        </select>
        <span className="meta" style={{ color: 'var(--muted)' }}>
          {team.roster.length} players · Payroll {money(payroll(team))} / {money(SALARY_CAP)}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th>
            <th className="num">PPG</th><th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th>
            <th className="num">Salary</th><th className="num">Yrs</th>
            {isUser && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id}>
              <td><Ovr p={p} /></td>
              <td style={{ color: 'var(--muted)' }}>{p.potential}</td>
              <td>{p.name}</td>
              <td>{p.pos}</td>
              <td className="num">{p.age}</td>
              <td className="num">{perGame(p.stats, 'pts')}</td>
              <td className="num">{perGame(p.stats, 'reb')}</td>
              <td className="num">{perGame(p.stats, 'ast')}</td>
              <td className="num">{fgPct(p.stats)}</td>
              <td className="num">{p.contract ? money(p.contract.salary) : '–'}</td>
              <td className="num">{p.contract?.years ?? '–'}</td>
              {isUser && (
                <td>
                  <button
                    className="btn danger small"
                    disabled={team.roster.length <= 8}
                    onClick={() => {
                      if (confirm(`Waive ${p.name}? They become a free agent (no cap relief in this version).`)) {
                        releasePlayer(league, teamId, p.id);
                        commit();
                      }
                    }}
                  >
                    Waive
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
