import React, { useState } from 'react';
import { getTeam, dateForDay, teamPlayoffStatus } from '../engine/league.js';
import { fmtDate, TeamLink, TeamBadge } from './shared.jsx';
import { ROUND_NAMES } from './Playoffs.jsx';
import { Section } from './ui/index.js';

// Every playoff game the user's team has played this postseason, oldest
// first, across whatever rounds are archived in `po.completed` plus the
// team's current series.
function userPlayoffGames(league, me) {
  const po = league.playoffs;
  if (!po) return [];
  const seriesList = [];
  for (const { round, series } of po.completed || []) {
    if (series.high === me || series.low === me) seriesList.push({ round, series });
  }
  for (const conf of ['East', 'West']) {
    for (const m of po[conf] || []) if (m.high === me || m.low === me) seriesList.push({ round: po.round, series: m });
  }
  if (po.finals && (po.finals.high === me || po.finals.low === me)) seriesList.push({ round: 3, series: po.finals });
  const games = [];
  for (const { round, series } of seriesList) {
    (series.games || []).forEach((g, i) => games.push({ round, gameNo: i + 1, g }));
  }
  return games;
}

export default function Schedule({ league, openTeam, openGame }) {
  const me = league.userTeamId;
  const lastDay = league.schedule.length - 1;
  const [selDay, setSelDay] = useState(() => Math.min(league.dayIndex, lastDay));
  const day = Math.min(selDay, lastDay);

  // stored results carry either a full box (user games) or top-performer
  // lines (other games); either way there's a game page to open
  const viewable = (r) => r.homeBox || r.homeStars;

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

  const playoffGames = userPlayoffGames(league, me).reverse();
  const playoffStatus = league.playoffs ? teamPlayoffStatus(league, me) : null;

  // results from saves predating the possession sim have no stored box score
  const ScoreCells = ({ g, r, di }) => {
    if (!r) return <td className="num" colSpan={2}>–</td>;
    const myPts = g.home === me ? r.homePts : r.awayPts;
    const oppPts = g.home === me ? r.awayPts : r.homePts;
    const won = myPts > oppPts;
    const score = `${myPts}-${oppPts}`;
    return (
      <>
        <td><span className={`ui-badge ${won ? 'ui-badge--success' : 'ui-badge--danger'}`}>{won ? 'W' : 'L'}</span></td>
        <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>
          {viewable(r)
            ? <a className="team-link" title="View game" onClick={() => openGame(r, fmtDate(dateForDay(league, di)))}>{score}</a>
            : score}
        </td>
      </>
    );
  };

  return (
    <div className="grid2">
      <div>
        <Section title="Upcoming Games" spacing="sm">
          {upcoming.length === 0 && !playoffStatus && <p style={{ color: 'var(--muted)' }}>Regular season complete.</p>}
          {upcoming.length === 0 && playoffStatus && (
            playoffStatus.champion ? (
              <p style={{ color: 'var(--muted)' }}>🏆 NBA Champions — the season is over.</p>
            ) : playoffStatus.series ? (
              <p style={{ color: 'var(--muted)' }}>
                {ROUND_NAMES[playoffStatus.round]} vs{' '}
                <TeamLink team={getTeam(league, playoffStatus.series.high === me ? playoffStatus.series.low : playoffStatus.series.high)} openTeam={openTeam} />
                {' '}— series {playoffStatus.series.high === me ? playoffStatus.series.highWins : playoffStatus.series.lowWins}-{playoffStatus.series.high === me ? playoffStatus.series.lowWins : playoffStatus.series.highWins}
                {playoffStatus.eliminated && ' (eliminated)'}
              </p>
            ) : (
              <p style={{ color: 'var(--muted)' }}>Awaiting the next playoff round.</p>
            )
          )}
          {upcoming.length > 0 && (
            <div className="ui-table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="ui-table zebra">
                <thead><tr><th>Date</th><th>Opponent</th><th className="num">Opp Record</th></tr></thead>
                <tbody>
                  {upcoming.map(({ di, g }) => {
                    const opp = oppOf(g);
                    return (
                      <tr key={di} className={di === league.dayIndex ? 'today' : ''}>
                        <td>{fmtDate(dateForDay(league, di))}</td>
                        <td>{g.home === me ? 'vs' : '@'} <TeamBadge team={opp} size="small" /> <TeamLink team={opp} openTeam={openTeam} /></td>
                        <td className="num">{opp.wins}-{opp.losses}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Past Results" spacing="sm">
          {past.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
          {past.length > 0 && (
            <div className="ui-table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="ui-table zebra">
                <thead><tr><th>Date</th><th>Opponent</th><th>W/L</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {past.map(({ di, g, r }) => {
                    const opp = oppOf(g);
                    return (
                      <tr key={di}>
                        <td>{fmtDate(dateForDay(league, di))}</td>
                        <td>{g.home === me ? 'vs' : '@'} <TeamBadge team={opp} size="small" /> <TeamLink team={opp} openTeam={openTeam} /></td>
                        <ScoreCells g={g} r={r} di={di} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {playoffGames.length > 0 && (
          <Section title="Playoff Games" spacing="sm">
            <div className="ui-table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="ui-table zebra">
                <thead><tr><th>Round</th><th>Opponent</th><th>W/L</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {playoffGames.map(({ round, gameNo, g }) => {
                    const opp = getTeam(league, g.home === me ? g.away : g.home);
                    const myPts = g.home === me ? g.homePts : g.awayPts;
                    const oppPts = g.home === me ? g.awayPts : g.homePts;
                    const won = myPts > oppPts;
                    const title = `${ROUND_NAMES[round]} · Game ${gameNo}`;
                    return (
                      <tr key={`${round}-${gameNo}`}>
                        <td>{title}</td>
                        <td>{g.home === me ? 'vs' : '@'} <TeamBadge team={opp} size="small" /> <TeamLink team={opp} openTeam={openTeam} /></td>
                        <td><span className={`ui-badge ${won ? 'ui-badge--success' : 'ui-badge--danger'}`}>{won ? 'W' : 'L'}</span></td>
                        <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>
                          <a className="team-link" title="View game" onClick={() => openGame(g, title)}>{myPts}-{oppPts}</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>

      <Section
        title="Around the League"
        action={
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button className="ui-btn ui-btn--sm ui-btn--secondary" disabled={day === 0} onClick={() => setSelDay(day - 1)}>◀</button>
            <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => setSelDay(Math.min(league.dayIndex, lastDay))}>Today</button>
            <button className="ui-btn ui-btn--sm ui-btn--secondary" disabled={day === lastDay} onClick={() => setSelDay(day + 1)}>▶</button>
          </div>
        }
        spacing="sm"
      >
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)' }}>
          {fmtDate(dateForDay(league, day))} · Day {day + 1}/{league.schedule.length}
          {day === league.dayIndex && <span className="tag" style={{ marginLeft: 8, color: 'var(--accent)' }}>TODAY</span>}
        </p>
        {league.schedule[day].map((g, i) => {
          const r = resultFor(day, g);
          const mine = g.home === me || g.away === me;
          return (
            <div className="result-row" key={i} style={mine ? { background: 'var(--surface-2)' } : {}}>
              {r ? (
                <>
                  <span className={r.awayPts > r.homePts ? 'winner' : ''}>
                    <TeamBadge team={getTeam(league, g.away)} size="small" /> <TeamLink team={getTeam(league, g.away)} openTeam={openTeam}>{g.away}</TeamLink> {r.awayPts}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>@</span>
                  <span className={r.homePts > r.awayPts ? 'winner' : ''}>
                    <TeamBadge team={getTeam(league, g.home)} size="small" /> <TeamLink team={getTeam(league, g.home)} openTeam={openTeam}>{g.home}</TeamLink> {r.homePts}
                  </span>
                  {viewable(r) && (
                    <a className="team-link" style={{ color: 'var(--muted)', fontSize: 12 }}
                       onClick={() => openGame(r, fmtDate(dateForDay(league, day)))}>
                      view ▸
                    </a>
                  )}
                </>
              ) : (
                <>
                  <span><TeamBadge team={getTeam(league, g.away)} size="small" /> <TeamLink team={getTeam(league, g.away)} openTeam={openTeam}>{g.away}</TeamLink></span>
                  <span style={{ color: 'var(--muted)' }}>@</span>
                  <span><TeamBadge team={getTeam(league, g.home)} size="small" /> <TeamLink team={getTeam(league, g.home)} openTeam={openTeam}>{g.home}</TeamLink></span>
                </>
              )}
            </div>
          );
        })}
      </Section>
    </div>
  );
}
