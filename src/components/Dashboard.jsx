import React from 'react';
import { getTeam, standings, payroll } from '../engine/league.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { overall } from '../engine/players.js';
import { Ovr, money, perGame } from './shared.jsx';

export default function Dashboard({ league, lastResults }) {
  const team = getTeam(league, league.userTeamId);
  const confStandings = standings(league, team.conf);
  const seed = confStandings.findIndex((t) => t.id === team.id) + 1;
  const pay = payroll(team);
  const topPlayers = [...team.roster].sort((a, b) => overall(b) - overall(a)).slice(0, 5);

  return (
    <div>
      <div className="grid2">
        <div className="panel">
          <h2>Team Overview</h2>
          <p>Record: <b>{team.wins}-{team.losses}</b> · Seed: <b>#{seed}</b> in the {team.conf}</p>
          <p style={{ marginTop: 8 }}>Payroll: <b>{money(pay)}</b> / Cap {money(SALARY_CAP)} {pay > LUXURY_TAX && <span className="tag" style={{ color: 'var(--red)' }}>LUXURY TAX</span>}</p>
          <div className="cap-bar"><div className={pay > SALARY_CAP ? 'over' : ''} style={{ width: `${Math.min(100, (pay / LUXURY_TAX) * 100)}%` }} /></div>
          <h3 style={{ marginTop: 14 }}>Top Players</h3>
          <table>
            <tbody>
              {topPlayers.map((p) => (
                <tr key={p.id}>
                  <td><Ovr p={p} /></td>
                  <td>{p.name}</td>
                  <td>{p.pos}</td>
                  <td className="num">{perGame(p.stats, 'pts')} ppg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Latest Scores</h2>
          {lastResults.length === 0 && <p style={{ color: 'var(--muted)' }}>Sim a day to see scores.</p>}
          {lastResults.map((r, i) => (
            <div className="result-row" key={i}>
              <span className={r.awayPts > r.homePts ? 'winner' : ''}>{r.away} {r.awayPts}</span>
              <span style={{ color: 'var(--muted)' }}>@</span>
              <span className={r.homePts > r.awayPts ? 'winner' : ''}>{r.home} {r.homePts}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>News</h2>
        {league.news.slice(0, 12).map((n, i) => (
          <div className="news-item" key={i}>{n.text}</div>
        ))}
      </div>

      {league.history.length > 0 && (
        <div className="panel">
          <h2>History</h2>
          <table>
            <thead><tr><th>Season</th><th>Champion</th><th>Your Record</th></tr></thead>
            <tbody>
              {[...league.history].reverse().map((h) => (
                <tr key={h.season}>
                  <td>{h.season}</td>
                  <td>{h.champion ? `${getTeam(league, h.champion).city} ${getTeam(league, h.champion).name}` : '–'}</td>
                  <td>{h.userRecord}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
