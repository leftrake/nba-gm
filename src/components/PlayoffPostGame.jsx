import React from 'react';
import { getTeam, seriesHomeTeam } from '../engine/league.js';
import { TeamLink } from './shared.jsx';
import { BoxTable, LineScore, TopPerformers, GameFlow } from './BoxScore.jsx';
import { ROUND_NAMES } from './Playoffs.jsx';

// "Series tied 2–2, Game 5 in Boston" / "Celtics lead 3–2, Game 6 in Miami" /
// "Celtics win the series 4–2"
function seriesStatusText(league, m) {
  const w = Math.max(m.highWins, m.lowWins);
  const l = Math.min(m.highWins, m.lowWins);
  if (m.winner) return `${getTeam(league, m.winner).name} win the series ${w}–${l}`;
  const gamesDone = m.highWins + m.lowWins;
  const loc = `Game ${gamesDone + 1} in ${getTeam(league, seriesHomeTeam(m, gamesDone)).city}`;
  if (m.highWins === m.lowWins) return `Series tied ${w}–${l}, ${loc}`;
  const leader = getTeam(league, m.highWins > m.lowWins ? m.high : m.low);
  return `${leader.name} lead ${w}–${l}, ${loc}`;
}

// One line per game on the day's scoreboard: score plus where the series stands
function ScoreRow({ league, entry, openTeam, openGame }) {
  const { series: m, game: g, round } = entry;
  const gameNo = m.games.indexOf(g) + 1;
  const away = getTeam(league, g.away);
  const home = getTeam(league, g.home);
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
      <div className="result-row" style={{ border: 'none', padding: 0 }}>
        <span className={g.awayPts > g.homePts ? 'winner' : ''}>
          <TeamLink team={away} openTeam={openTeam}>{away.name}</TeamLink> {g.awayPts}
        </span>
        <span style={{ color: 'var(--muted)' }}>@</span>
        <span className={g.homePts > g.awayPts ? 'winner' : ''}>
          <TeamLink team={home} openTeam={openTeam}>{home.name}</TeamLink> {g.homePts}
        </span>
        <a className="team-link" style={{ color: 'var(--muted)', fontSize: 12 }}
           onClick={() => openGame(g, `${ROUND_NAMES[round]} · Game ${gameNo}`)}>
          view ▸
        </a>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{seriesStatusText(league, m)}</div>
    </div>
  );
}

// Lands here right after "Sim Next Playoff Game": the user's result in full
// (line score, top performers, both box scores, series status, game flow),
// or a compact scoreboard when their team didn't play. One click back to
// the bracket either way.
export default function PlayoffPostGame({ league, played, onBack, openTeam, openPlayer, openGame }) {
  const me = league.userTeamId;
  const mine = played.find((e) => e.game.home === me || e.game.away === me);
  const others = played.filter((e) => e !== mine);
  const roundName = ROUND_NAMES[played[0].round];
  const backBtn = <button className="btn secondary" style={{ marginLeft: 'auto' }} onClick={onBack}>Back to Bracket ▸</button>;

  if (!mine) {
    return (
      <div>
        <div className="panel">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{ marginBottom: 0 }}>Playoff Scoreboard · {roundName}</h2>
            {backBtn}
          </div>
          <p style={{ color: 'var(--muted)', margin: '8px 0' }}>Your team didn't play today. Around the league:</p>
          {others.map((e, i) => <ScoreRow key={i} league={league} entry={e} openTeam={openTeam} openGame={openGame} />)}
        </div>
      </div>
    );
  }

  const { series: m, game: g } = mine;
  const gameNo = m.games.indexOf(g) + 1;
  const away = getTeam(league, g.away);
  const home = getTeam(league, g.home);
  const won = g.home === me ? g.homePts > g.awayPts : g.awayPts > g.homePts;
  const champion = league.playoffs?.champion === m.winner ? m.winner : null;

  return (
    <div>
      {champion && (
        <div className="panel center">
          <h2 style={{ fontSize: 22 }}>🏆 <TeamLink team={getTeam(league, champion)} openTeam={openTeam} /> — NBA Champions</h2>
        </div>
      )}
      <div className="panel" style={{ borderLeft: `4px solid ${won ? 'var(--green)' : 'var(--red)'}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>{roundName} · Game {gameNo} · Final</h2>
          {backBtn}
        </div>
        <p style={{ fontSize: 20, margin: '10px 0 12px' }}>
          <span className={g.awayPts > g.homePts ? 'winner' : ''}>
            <TeamLink team={away} openTeam={openTeam} /> {g.awayPts}
          </span>
          <span style={{ color: 'var(--muted)' }}> @ </span>
          <span className={g.homePts > g.awayPts ? 'winner' : ''}>
            <TeamLink team={home} openTeam={openTeam} /> {g.homePts}
          </span>
          <b style={{ marginLeft: 10, color: won ? 'var(--green)' : 'var(--red)' }}>{won ? 'W' : 'L'}</b>
        </p>
        <p style={{ fontWeight: 700, marginBottom: 12 }}>{seriesStatusText(league, m)}</p>
        <LineScore league={league} game={g} />
        <TopPerformers league={league} game={g} openPlayer={openPlayer} />
        <div className="grid2">
          <BoxTable league={league} teamId={g.away} pts={g.awayPts} box={g.awayBox} openTeam={openTeam} openPlayer={openPlayer} injuryReport={g.injuryReport} />
          <BoxTable league={league} teamId={g.home} pts={g.homePts} box={g.homeBox} openTeam={openTeam} openPlayer={openPlayer} injuryReport={g.injuryReport} />
        </div>
        <details style={{ marginTop: 6 }}>
          <summary className="stories-toggle">Play-by-play</summary>
          <GameFlow events={g.events} />
        </details>
      </div>
      {others.length > 0 && (
        <div className="panel">
          <h2>Around the League</h2>
          {others.map((e, i) => <ScoreRow key={i} league={league} entry={e} openTeam={openTeam} openGame={openGame} />)}
        </div>
      )}
      <div className="controls">
        <button className="btn" onClick={onBack}>Back to Bracket ▸</button>
      </div>
    </div>
  );
}
