import React, { useState } from 'react';
import { getTeam, dateForDay } from '../engine/league.js';
import { fmtDate, TeamLink } from './shared.jsx';

export default function Schedule({ league, openTeam }) {
  const me = league.userTeamId;
  const lastDay = league.schedule.length - 1;
  const [selDay, setSelDay] = useState(() => Math.min(league.dayIndex, lastDay));
  const day = Math.min(selDay, lastDay);

  const resultFor = (di, g) =>
    (league.resultsByDay?.[di] || []).find((r) => r.home === g.home && r.away === g.away);

  const userGames = [];
  league.schedule.forEach((games, di) => {
    const g = games.find((x) => x.home === me || x.away === me);
    if (g) userGames.push({ di, g, r: resultFor(di, g) });
  });
  const past = userGames.filter((x) => x.di < league.dayIndex).reverse();
  const upcoming = userGames.filter((x) => x.di >= league.dayIndex);

  const oppOf = (g) => getTeam(league, g.home === me ? g.away : g.home);

  const ScoreCells = ({ g, r }) => {
    if (!r) return <td className="num" colSpan={2}>–</td>;
    const myPts = g.home === me ? r.homePts : r.awayPts;
    const oppPts = g.home === me ? r.awayPts : r.homePts;
    return (
      <>
        <td style={{ color: myPts > oppPts ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
          {myPts > oppPts ? 'W' : 'L'}
        </td>
        <td className="num">{myPts}-{oppPts}</td>
      </>
    );
  };

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h2>Upcoming Games</h2>
          {upcoming.length === 0 && <p style={{ color: 'var(--muted)' }}>Regular season complete.</p>}
          {upcoming.length > 0 && (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Date</th><th>Opponent</th><th className="num">Opp Record</th></tr></thead>
                <tbody>
                  {upcoming.map(({ di, g }) => {
                    const opp = oppOf(g);
                    return (
                      <tr key={di} className={di === league.dayIndex ? 'today' : ''}>
                        <td>{fmtDate(dateForDay(league, di))}</td>
                        <td>{g.home === me ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam} /></td>
                        <td className="num">{opp.wins}-{opp.losses}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Past Results</h2>
          {past.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
          {past.length > 0 && (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Date</th><th>Opponent</th><th>W/L</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {past.map(({ di, g, r }) => {
                    const opp = oppOf(g);
                    return (
                      <tr key={di}>
                        <td>{fmtDate(dateForDay(league, di))}</td>
                        <td>{g.home === me ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam} /></td>
                        <ScoreCells g={g} r={r} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Around the League</h2>
        <div className="controls">
          <button className="btn small secondary" disabled={day === 0} onClick={() => setSelDay(day - 1)}>◀ Prev</button>
          <button className="btn small secondary" onClick={() => setSelDay(Math.min(league.dayIndex, lastDay))}>Today</button>
          <button className="btn small secondary" disabled={day === lastDay} onClick={() => setSelDay(day + 1)}>Next ▶</button>
        </div>
        <h3>
          {fmtDate(dateForDay(league, day))} · Day {day + 1}/{league.schedule.length}
          {day === league.dayIndex && <span className="tag" style={{ marginLeft: 8, color: 'var(--accent)' }}>TODAY</span>}
        </h3>
        {league.schedule[day].map((g, i) => {
          const r = resultFor(day, g);
          const mine = g.home === me || g.away === me;
          return (
            <div className="result-row" key={i} style={mine ? { background: 'var(--panel2)' } : {}}>
              {r ? (
                <>
                  <span className={r.awayPts > r.homePts ? 'winner' : ''}>
                    <TeamLink team={getTeam(league, g.away)} openTeam={openTeam}>{g.away}</TeamLink> {r.awayPts}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>@</span>
                  <span className={r.homePts > r.awayPts ? 'winner' : ''}>
                    <TeamLink team={getTeam(league, g.home)} openTeam={openTeam}>{g.home}</TeamLink> {r.homePts}
                  </span>
                </>
              ) : (
                <>
                  <span><TeamLink team={getTeam(league, g.away)} openTeam={openTeam}>{g.away}</TeamLink></span>
                  <span style={{ color: 'var(--muted)' }}>@</span>
                  <span><TeamLink team={getTeam(league, g.home)} openTeam={openTeam}>{g.home}</TeamLink></span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
