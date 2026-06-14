import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { TeamLink, NewsText } from './shared.jsx';
import SeriesModal from './SeriesModal.jsx';

export const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

// The series for a given conference/round: the live arrays for the round
// currently being played, or the archived copy from `po.completed` for
// rounds already finished.
function seriesForRound(po, conf, round) {
  if (round === po.round && round < 3) return po[conf] || [];
  return (po.completed || []).filter((c) => c.conf === conf && c.round === round).map((c) => c.series);
}

// One matchup as a broadcast-style card: team rows with logos, series score,
// and win/loss dots. Clicking opens the game-by-game series modal.
function BracketCard({ league, m, openTeam, openSeries, roundName }) {
  const high = getTeam(league, m.high);
  const low = getTeam(league, m.low);
  const completed = !!m.winner;
  const clickable = (m.games || []).length > 0;
  const teamRow = (team, wins, isWinner) => (
    <div key={team.id}>
      <div className={`bracket-team${isWinner ? ' winner' : ''}`}>
        <span className="team-logo" style={{ background: team.color }}>{team.id}</span>
        <TeamLink team={team} openTeam={openTeam}>{team.name}</TeamLink>
        <span className="score">{wins}</span>
      </div>
      <div className="series-dots" style={{ color: team.color }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className={`series-dot${i < wins ? ' filled' : ''}`} />
        ))}
      </div>
    </div>
  );
  return (
    <div
      className={`bracket-card${completed ? ' completed' : ''}`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={() => clickable && openSeries(m, roundName)}
    >
      {teamRow(high, m.highWins, m.winner === m.high)}
      {teamRow(low, m.lowWins, m.winner === m.low)}
    </div>
  );
}

// One conference's bracket: a horizontally-scrollable row of round columns,
// the active round visually distinct from completed ones.
function ConferenceBracket({ league, po, conf, openTeam, openSeries }) {
  const rounds = [0, 1, 2]
    .map((r) => ({ r, series: seriesForRound(po, conf, r) }))
    .filter(({ series }) => series.length > 0);
  if (rounds.length === 0) return null;
  return (
    <div className="bracket-wrap">
      <div className="bracket">
        {rounds.map(({ r, series }) => (
          <div key={r} className={`bracket-round${r === po.round ? ' current' : ''}`}>
            <div className="bracket-round-title">{ROUND_NAMES[r]}</div>
            {series.map((m, i) => (
              <BracketCard key={i} league={league} m={m} openTeam={openTeam} openSeries={openSeries} roundName={ROUND_NAMES[r]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Playoffs({ league, openTeam, openPlayer, openGame }) {
  const po = league.playoffs;
  const [seriesView, setSeriesView] = useState(null); // { m, roundName }
  if (!po) {
    return (
      <div className="panel center">
        <p style={{ color: 'var(--muted)' }}>The playoffs haven't started yet. Finish the regular season first.</p>
      </div>
    );
  }
  const roundName = ROUND_NAMES[po.round] || '';
  const openSeries = (m, rn) => setSeriesView({ m, roundName: rn });

  return (
    <div>
      {po.champion ? (
        <div className="panel champion-banner" style={{ '--team-color': getTeam(league, po.champion).color }}>
          <h2>🏆 <TeamLink team={getTeam(league, po.champion)} openTeam={openTeam} /> — NBA Champions</h2>
        </div>
      ) : (
        <div className="panel">
          <h2>Current Round: {roundName}</h2>
          <p style={{ color: 'var(--muted)' }}>"Sim Next Playoff Game" plays one game in every active series; "Sim Playoff Round" fast-forwards the round. Click a series for game-by-game results and stat leaders.</p>
        </div>
      )}
      {po.finals && (
        <div className="panel" style={{ '--team-color': getTeam(league, po.finals.high).color }}>
          <h2>NBA Finals</h2>
          <div style={{ maxWidth: 320 }}>
            <div className={`bracket-round${po.round === 3 ? ' current' : ''}`}>
              <BracketCard league={league} m={po.finals} openTeam={openTeam} openSeries={openSeries} roundName={ROUND_NAMES[3]} />
            </div>
          </div>
        </div>
      )}
      <div className="grid2">
        <div className="panel">
          <h2>East</h2>
          <ConferenceBracket league={league} po={po} conf="East" openTeam={openTeam} openSeries={openSeries} />
        </div>
        <div className="panel">
          <h2>West</h2>
          <ConferenceBracket league={league} po={po} conf="West" openTeam={openTeam} openSeries={openSeries} />
        </div>
      </div>
      {po.log.length > 0 && (
        <div className="panel">
          <h2>Series Results</h2>
          {po.log.map((l, i) => <div className="news-item" key={i}><NewsText text={l} openTeam={openTeam} /></div>)}
        </div>
      )}
      {seriesView && (
        <SeriesModal
          league={league}
          series={seriesView.m}
          roundName={seriesView.roundName}
          onClose={() => setSeriesView(null)}
          openGame={openGame}
          openTeam={openTeam}
          openPlayer={openPlayer}
        />
      )}
    </div>
  );
}
