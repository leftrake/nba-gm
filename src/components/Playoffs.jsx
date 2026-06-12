import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { TeamLink, NewsText } from './shared.jsx';
import SeriesModal from './SeriesModal.jsx';

const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

function Series({ league, m, roundName, openTeam, openSeries, openGame }) {
  if (!m) return null;
  const high = getTeam(league, m.high);
  const low = getTeam(league, m.low);
  const games = m.games || [];
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '5px 0' }}>
      <div className="result-row" style={{ border: 'none', padding: 0 }}>
        <span className={m.winner === m.high ? 'winner' : ''}>
          <TeamLink team={high} openTeam={openTeam}>{high.name}</TeamLink> {m.highWins}
        </span>
        <span style={{ color: 'var(--muted)' }}>vs</span>
        <span className={m.winner === m.low ? 'winner' : ''}>
          <TeamLink team={low} openTeam={openTeam}>{low.name}</TeamLink> {m.lowWins}
        </span>
        {games.length > 0 && (
          <a className="team-link" style={{ color: 'var(--accent)', fontSize: 12 }}
             onClick={() => openSeries(m, roundName)}>
            series ▸
          </a>
        )}
      </div>
      {games.length > 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
          {games.map((g, i) => {
            const label = `G${i + 1}: ${g.away} ${g.awayPts} @ ${g.home} ${g.homePts}`;
            return (
              <span key={i}>
                {i > 0 && ' · '}
                {g.homeBox
                  ? <a className="team-link" onClick={() => openGame(g, `${roundName} · Game ${i + 1}`)}>{label}</a>
                  : label}
              </span>
            );
          })}
        </div>
      )}
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
  // finished rounds (saved by advanceRound), most recent first
  const completed = [...(po.completed || [])].reverse();

  return (
    <div>
      {po.champion && (
        <div className="panel center">
          <h2 style={{ fontSize: 22 }}>🏆 <TeamLink team={getTeam(league, po.champion)} openTeam={openTeam} /> — NBA Champions</h2>
        </div>
      )}
      {!po.champion && (
        <div className="panel">
          <h2>Current Round: {roundName}</h2>
          <p style={{ color: 'var(--muted)' }}>"Sim Next Playoff Game" plays one game in every active series; "Sim Playoff Round" fast-forwards the round. Click a series for game-by-game results and stat leaders.</p>
        </div>
      )}
      {po.finals && (
        <div className="panel">
          <h2>NBA Finals</h2>
          <Series league={league} m={po.finals} roundName={ROUND_NAMES[3]} openTeam={openTeam} openSeries={openSeries} openGame={openGame} />
        </div>
      )}
      {po.round < 3 && (
        <div className="grid2">
          <div className="panel">
            <h2>East</h2>
            {po.East.map((m, i) => <Series key={i} league={league} m={m} roundName={roundName} openTeam={openTeam} openSeries={openSeries} openGame={openGame} />)}
          </div>
          <div className="panel">
            <h2>West</h2>
            {po.West.map((m, i) => <Series key={i} league={league} m={m} roundName={roundName} openTeam={openTeam} openSeries={openSeries} openGame={openGame} />)}
          </div>
        </div>
      )}
      {completed.length > 0 && (
        <div className="panel">
          <h2>Earlier Rounds</h2>
          {completed.map(({ round, conf, series }, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 170 }}>
                {conf} · {ROUND_NAMES[round]}
              </span>
              <div style={{ flex: 1 }}>
                <Series league={league} m={series} roundName={ROUND_NAMES[round]} openTeam={openTeam} openSeries={openSeries} openGame={openGame} />
              </div>
            </div>
          ))}
        </div>
      )}
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
