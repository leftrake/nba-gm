import React from 'react';
import { getTeam, standings, payroll, deadMoneyTotal, dateForDay } from '../engine/league.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { overall } from '../engine/players.js';
import { Ovr, money, perGame, fmtDate, TeamLink, NewsText, PlayerLink } from './shared.jsx';

function BoxTable({ league, teamId, box, openTeam, openPlayer }) {
  const team = getTeam(league, teamId);
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  return (
    <div>
      <h3><TeamLink team={team} openTeam={openTeam} /></h3>
      <table>
        <thead>
          <tr>
            <th>Player</th><th className="num">MIN</th><th className="num">PTS</th><th className="num">REB</th>
            <th className="num">AST</th><th className="num">STL</th><th className="num">BLK</th>
            <th className="num">FG</th><th className="num">3P</th>
          </tr>
        </thead>
        <tbody>
          {[...box].sort((a, b) => b.pts - a.pts).map((line) => {
            const p = byId.get(line.playerId);
            return (
              <tr key={line.playerId}>
                <td>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'}</td>
                <td className="num">{line.min}</td>
                <td className="num"><b>{line.pts}</b></td>
                <td className="num">{line.reb}</td>
                <td className="num">{line.ast}</td>
                <td className="num">{line.stl}</td>
                <td className="num">{line.blk}</td>
                <td className="num">{line.fgm}-{line.fga}</td>
                <td className="num">{line.tpm}-{line.tpa}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard({ league, lastResults, featuredGame, openTeam, openPlayer }) {
  const team = getTeam(league, league.userTeamId);
  const confStandings = standings(league, team.conf);
  const seed = confStandings.findIndex((t) => t.id === team.id) + 1;
  const pay = payroll(team);
  const dead = deadMoneyTotal(team);
  const topPlayers = [...team.roster].sort((a, b) => overall(b) - overall(a)).slice(0, 5);

  const fg = featuredGame;
  const won = fg && (fg.home === team.id ? fg.homePts > fg.awayPts : fg.awayPts > fg.homePts);

  return (
    <div>
      {fg && (
        <div className="panel" style={{ borderLeft: `4px solid ${won ? 'var(--green)' : 'var(--red)'}` }}>
          <h2>Your Last Game · {fmtDate(dateForDay(league, fg.day))}</h2>
          <p style={{ fontSize: 18, marginBottom: 12 }}>
            <span className={fg.awayPts > fg.homePts ? 'winner' : ''}>
              <TeamLink team={getTeam(league, fg.away)} openTeam={openTeam} /> {fg.awayPts}
            </span>
            <span style={{ color: 'var(--muted)' }}> @ </span>
            <span className={fg.homePts > fg.awayPts ? 'winner' : ''}>
              <TeamLink team={getTeam(league, fg.home)} openTeam={openTeam} /> {fg.homePts}
            </span>
            <b style={{ marginLeft: 10, color: won ? 'var(--green)' : 'var(--red)' }}>{won ? 'W' : 'L'}</b>
          </p>
          {fg.homeBox && fg.awayBox && (
            <div className="grid2">
              <BoxTable league={league} teamId={fg.away} box={fg.awayBox} openTeam={openTeam} openPlayer={openPlayer} />
              <BoxTable league={league} teamId={fg.home} box={fg.homeBox} openTeam={openTeam} openPlayer={openPlayer} />
            </div>
          )}
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <h2>Team Overview</h2>
          <p>Record: <b>{team.wins}-{team.losses}</b> · Seed: <b>#{seed}</b> in the {team.conf}</p>
          <p style={{ marginTop: 8 }}>Payroll: <b>{money(pay)}</b> / Cap {money(SALARY_CAP)}{dead > 0 && <span style={{ color: 'var(--muted)' }}> (incl. {money(dead)} dead money)</span>} {pay > LUXURY_TAX && <span className="tag" style={{ color: 'var(--red)' }}>LUXURY TAX</span>}</p>
          <div className="cap-bar"><div className={pay > SALARY_CAP ? 'over' : ''} style={{ width: `${Math.min(100, (pay / LUXURY_TAX) * 100)}%` }} /></div>
          <h3 style={{ marginTop: 14 }}>Top Players</h3>
          <table>
            <tbody>
              {topPlayers.map((p) => (
                <tr key={p.id}>
                  <td><Ovr p={p} /></td>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
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
              <span className={r.awayPts > r.homePts ? 'winner' : ''}>
                <TeamLink team={getTeam(league, r.away)} openTeam={openTeam}>{r.away}</TeamLink> {r.awayPts}
              </span>
              <span style={{ color: 'var(--muted)' }}>@</span>
              <span className={r.homePts > r.awayPts ? 'winner' : ''}>
                <TeamLink team={getTeam(league, r.home)} openTeam={openTeam}>{r.home}</TeamLink> {r.homePts}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>News</h2>
        {league.news.slice(0, 12).map((n, i) => (
          <div className="news-item" key={i}><NewsText text={n.text} openTeam={openTeam} /></div>
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
                  <td>{h.champion ? <TeamLink team={getTeam(league, h.champion)} openTeam={openTeam} /> : '–'}</td>
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
