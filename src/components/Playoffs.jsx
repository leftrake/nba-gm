import React from 'react';
import { getTeam } from '../engine/league.js';
import { TeamLink, NewsText } from './shared.jsx';

function Series({ league, m, openTeam }) {
  if (!m) return null;
  const high = getTeam(league, m.high);
  const low = getTeam(league, m.low);
  return (
    <div className="result-row">
      <span className={m.winner === m.high ? 'winner' : ''}>
        <TeamLink team={high} openTeam={openTeam}>{high.name}</TeamLink> {m.highWins}
      </span>
      <span style={{ color: 'var(--muted)' }}>vs</span>
      <span className={m.winner === m.low ? 'winner' : ''}>
        <TeamLink team={low} openTeam={openTeam}>{low.name}</TeamLink> {m.lowWins}
      </span>
    </div>
  );
}

export default function Playoffs({ league, openTeam }) {
  const po = league.playoffs;
  if (!po) {
    return (
      <div className="panel center">
        <p style={{ color: 'var(--muted)' }}>The playoffs haven't started yet. Finish the regular season first.</p>
      </div>
    );
  }
  const roundName = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'][po.round] || '';

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
          <p style={{ color: 'var(--muted)' }}>Use "Sim Playoff Round" above to play it out.</p>
        </div>
      )}
      <div className="grid2">
        <div className="panel">
          <h2>East</h2>
          {po.East.map((m, i) => <Series key={i} league={league} m={m} openTeam={openTeam} />)}
        </div>
        <div className="panel">
          <h2>West</h2>
          {po.West.map((m, i) => <Series key={i} league={league} m={m} openTeam={openTeam} />)}
        </div>
      </div>
      {po.finals && (
        <div className="panel">
          <h2>NBA Finals</h2>
          <Series league={league} m={po.finals} openTeam={openTeam} />
        </div>
      )}
      {po.log.length > 0 && (
        <div className="panel">
          <h2>Series Results</h2>
          {po.log.map((l, i) => <div className="news-item" key={i}><NewsText text={l} openTeam={openTeam} /></div>)}
        </div>
      )}
    </div>
  );
}
