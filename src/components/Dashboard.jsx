import React from 'react';
import { getTeam, standings, payroll, deadMoneyTotal, dateForDay } from '../engine/league.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { overall } from '../engine/players.js';
import { starLines } from '../engine/sim.js';
import { Ovr, money, perGame, fmtDate, TeamLink, NewsText, PlayerLink } from './shared.jsx';
import { asLines, usePlayerIndex } from './BoxScore.jsx';

// League-wide injury report: every player currently out, the user's team
// first, then alphabetical by team.
function InjuryReport({ league, openTeam, openPlayer }) {
  const sortKey = (e) => (e.team.id === league.userTeamId ? '' : `${e.team.city} ${e.team.name}`);
  const injured = league.teams
    .flatMap((team) => team.roster.filter((p) => p.injury).map((p) => ({ team, p })))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return (
    <div className="panel">
      <h2>League Injury Report</h2>
      {injured.length === 0 && <p style={{ color: 'var(--muted)' }}>A clean bill of health — nobody is injured right now.</p>}
      {injured.length > 0 && (
        <table>
          <thead>
            <tr><th>Team</th><th>Player</th><th>Pos</th><th>Injury</th><th className="num">Out</th></tr>
          </thead>
          <tbody>
            {injured.map(({ team, p }) => {
              const severe = p.injury.tier === 'season' || p.injury.tier === 'significant';
              return (
                <tr key={p.id} style={team.id === league.userTeamId ? { background: 'var(--panel2)' } : undefined}>
                  <td><TeamLink team={team} openTeam={openTeam}>{team.name}</TeamLink></td>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  <td>{p.pos}</td>
                  <td style={severe ? { color: 'var(--red)' } : undefined}>🩹 {p.injury.type}</td>
                  <td className="num" style={severe ? { color: 'var(--red)' } : undefined}>
                    {p.injury.tier === 'season' ? 'Season' : `${p.injury.gamesLeft} gm`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The user's most recent game as a rich result card: score, the team's top
// three performers, and a link to the full game page.
function FeaturedGame({ league, fg, openTeam, openPlayer, openGame }) {
  const byId = usePlayerIndex(league);
  const me = league.userTeamId;
  const won = fg.home === me ? fg.homePts > fg.awayPts : fg.awayPts > fg.homePts;
  const myBox = fg.home === me ? fg.homeBox : fg.awayBox;
  const stars = myBox ? starLines(asLines(myBox), 3) : [];
  const title = fmtDate(dateForDay(league, fg.day));
  return (
    <div className="panel" style={{ borderLeft: `4px solid ${won ? 'var(--green)' : 'var(--red)'}` }}>
      <h2>Your Last Game · {title}</h2>
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
      {stars.map((l) => {
        const p = byId.get(l.playerId);
        return (
          <div key={l.playerId} className="result-row">
            <span>★ {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'}</span>
            <span>
              <b>{l.pts}</b> PTS · {l.reb} REB · {l.ast} AST
              <span style={{ color: 'var(--muted)' }}> · {l.fgm}-{l.fga} FG</span>
            </span>
          </div>
        );
      })}
      <p style={{ marginTop: 10 }}>
        <a className="team-link" style={{ color: 'var(--accent)' }} onClick={() => openGame(fg, title)}>
          Full box score &amp; game flow ▸
        </a>
      </p>
    </div>
  );
}

export default function Dashboard({ league, lastResults, featuredGame, openTeam, openPlayer, openGame }) {
  const team = getTeam(league, league.userTeamId);
  const confStandings = standings(league, team.conf);
  const seed = confStandings.findIndex((t) => t.id === team.id) + 1;
  const pay = payroll(team);
  const dead = deadMoneyTotal(team);
  const topPlayers = [...team.roster].sort((a, b) => overall(b) - overall(a)).slice(0, 5);

  // lastResults all come from the most recently simmed day
  const lastDay = Math.max(0, league.dayIndex - 1);

  return (
    <div>
      {featuredGame && (
        <FeaturedGame league={league} fg={featuredGame} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} />
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
              <a className="team-link" style={{ color: 'var(--muted)', fontSize: 12 }}
                 onClick={() => openGame(r, fmtDate(dateForDay(league, lastDay)))}>
                view ▸
              </a>
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

      <InjuryReport league={league} openTeam={openTeam} openPlayer={openPlayer} />

      {league.history.length > 0 && (
        <div className="panel">
          <h2>History</h2>
          <table>
            <thead><tr><th>Season</th><th>Champion</th><th>MVP</th><th>Your Record</th></tr></thead>
            <tbody>
              {[...league.history].reverse().map((h) => (
                <tr key={h.season}>
                  <td>{h.season}</td>
                  <td>{h.champion ? <TeamLink team={getTeam(league, h.champion)} openTeam={openTeam} /> : '–'}</td>
                  <td>{h.awards?.mvp?.name ?? '–'}</td>
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
