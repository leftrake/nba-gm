import React, { useState } from 'react';
import { getTeam, payroll, releasePlayer, standings, dateForDay } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { Ovr, money, perGame, fgPct, fmtDate, TeamLink, PlayerLink } from './shared.jsx';

export default function Roster({ league, commit, teamId, openTeam, openPlayer }) {
  const [sortKey, setSortKey] = useState('ovr');
  const team = getTeam(league, teamId);
  const isUser = teamId === league.userTeamId;
  const pay = payroll(team);
  const seed = standings(league, team.conf).findIndex((t) => t.id === team.id) + 1;

  const games = [];
  league.schedule.forEach((dayGames, di) => {
    const g = dayGames.find((x) => x.home === team.id || x.away === team.id);
    if (g) {
      const r = (league.resultsByDay?.[di] || []).find((x) => x.home === g.home && x.away === g.away);
      games.push({ di, g, r });
    }
  });
  const recent = games.filter((x) => x.di < league.dayIndex).slice(-5).reverse();
  const upcoming = games.filter((x) => x.di >= league.dayIndex).slice(0, 5);
  const oppOf = (g) => getTeam(league, g.home === team.id ? g.away : g.home);

  const sorted = [...team.roster].sort((a, b) => {
    if (sortKey === 'ovr') return overall(b) - overall(a);
    if (sortKey === 'age') return a.age - b.age;
    if (sortKey === 'salary') return (b.contract?.salary || 0) - (a.contract?.salary || 0);
    if (sortKey === 'pts') return (b.stats.gp ? b.stats.pts / b.stats.gp : 0) - (a.stats.gp ? a.stats.pts / a.stats.gp : 0);
    return 0;
  });

  return (
    <div>
      <div className="panel" style={{ borderLeft: `4px solid ${team.color}` }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>{team.city} {team.name} {isUser && <span className="tag">YOUR TEAM</span>}</h2>
          <select value={teamId} onChange={(e) => openTeam(e.target.value)}>
            {league.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.city} {t.name}</option>
            ))}
          </select>
        </div>
        <p>Record: <b>{team.wins}-{team.losses}</b> · Seed: <b>#{seed}</b> in the {team.conf}</p>
        <p style={{ marginTop: 8 }}>
          Payroll: <b>{money(pay)}</b> / Cap {money(SALARY_CAP)}
          {pay > LUXURY_TAX && <span className="tag" style={{ color: 'var(--red)', marginLeft: 8 }}>LUXURY TAX</span>}
        </p>
        <div className="cap-bar"><div className={pay > SALARY_CAP ? 'over' : ''} style={{ width: `${Math.min(100, (pay / LUXURY_TAX) * 100)}%` }} /></div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>Recent Results</h2>
          {recent.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
          {recent.map(({ di, g, r }) => {
            const opp = oppOf(g);
            const home = g.home === team.id;
            const myPts = r ? (home ? r.homePts : r.awayPts) : null;
            const oppPts = r ? (home ? r.awayPts : r.homePts) : null;
            return (
              <div className="result-row" key={di}>
                <span style={{ color: 'var(--muted)' }}>{fmtDate(dateForDay(league, di))}</span>
                <span>{home ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam}>{opp.name}</TeamLink></span>
                {r ? (
                  <span>
                    <b style={{ color: myPts > oppPts ? 'var(--green)' : 'var(--red)' }}>{myPts > oppPts ? 'W' : 'L'}</b>
                    {' '}{myPts}-{oppPts}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>–</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="panel">
          <h2>Upcoming Games</h2>
          {upcoming.length === 0 && <p style={{ color: 'var(--muted)' }}>Regular season complete.</p>}
          {upcoming.map(({ di, g }) => {
            const opp = oppOf(g);
            return (
              <div className="result-row" key={di}>
                <span style={{ color: 'var(--muted)' }}>{fmtDate(dateForDay(league, di))}</span>
                <span>{g.home === team.id ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam}>{opp.name}</TeamLink></span>
                <span className="num" style={{ color: 'var(--muted)' }}>{opp.wins}-{opp.losses}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>Roster</h2>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="ovr">Sort: Overall</option>
            <option value="age">Sort: Age</option>
            <option value="salary">Sort: Salary</option>
            <option value="pts">Sort: PPG</option>
          </select>
          <span className="meta" style={{ color: 'var(--muted)' }}>{team.roster.length} players</span>
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
                <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
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
    </div>
  );
}
