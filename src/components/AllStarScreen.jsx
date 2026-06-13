import React from 'react';
import { getTeam } from '../engine/league.js';
import { getPlayerById } from '../engine/allstar.js';
import { PlayerLink, TeamLink } from './shared.jsx';

function PlayerRow({ league, playerId, teamId, openPlayer, openTeam, extra }) {
  const found = getPlayerById(league, playerId);
  if (!found) return null;
  return (
    <div className="result-row">
      <span>
        <PlayerLink p={found.player} openPlayer={openPlayer} /> · <TeamLink team={getTeam(league, teamId)} openTeam={openTeam}>{teamId}</TeamLink>
      </span>
      {extra != null && <span className="num">{extra}</span>}
    </div>
  );
}

function RosterPanel({ league, conf, roster, openPlayer, openTeam }) {
  return (
    <div className="panel">
      <h2>{conf} Conference</h2>
      <h3>Starters</h3>
      {roster.starters.map((r) => (
        <PlayerRow key={r.playerId} league={league} playerId={r.playerId} teamId={r.teamId} openPlayer={openPlayer} openTeam={openTeam} />
      ))}
      <h3>Reserves</h3>
      {roster.reserves.map((r) => (
        <PlayerRow key={r.playerId} league={league} playerId={r.playerId} teamId={r.teamId} openPlayer={openPlayer} openTeam={openTeam} />
      ))}
    </div>
  );
}

export default function AllStarScreen({ league, openPlayer, openTeam, onContinue }) {
  const as = league.allStar;
  if (!as) return null;
  const { game, rosters, honors } = as;
  const mvp = game.mvp ? getPlayerById(league, game.mvp.playerId) : null;

  return (
    <div>
      <div className="panel">
        <h2>All-Star Weekend · {as.season}</h2>
        <p style={{ color: 'var(--muted)' }}>
          Fans have voted in the All-Star starters and reserves. The league pauses for All-Star Friday
          (Skills Challenge & 3-Point Contest) before the All-Star Game on Sunday.
        </p>
      </div>

      <div className="grid2">
        <RosterPanel league={league} conf="East" roster={rosters.East} openPlayer={openPlayer} openTeam={openTeam} />
        <RosterPanel league={league} conf="West" roster={rosters.West} openPlayer={openPlayer} openTeam={openTeam} />
      </div>

      <div className="panel">
        <h2>All-Star Game</h2>
        <h3 style={{ fontSize: 22 }}>
          <span style={{ color: game.winner === 'East' ? 'var(--green)' : 'var(--text)' }}>East {game.East.pts}</span>
          {' – '}
          <span style={{ color: game.winner === 'West' ? 'var(--green)' : 'var(--text)' }}>West {game.West.pts}</span>
        </h3>
        {mvp && (
          <p>
            <strong>All-Star Game MVP:</strong> <PlayerLink p={mvp.player} openPlayer={openPlayer} /> · <TeamLink team={mvp.team} openTeam={openTeam} />{' '}
            ({game.mvp.pts} pts, {game.mvp.reb} reb, {game.mvp.ast} ast)
          </p>
        )}
      </div>

      <div className="panel">
        <h2>First-Half Honors</h2>
        {honors.map((cat) => (
          <div key={cat.key} style={{ marginBottom: 12 }}>
            <h3>{cat.label} Leaders</h3>
            {cat.leaders.map((l, i) => {
              const found = getPlayerById(league, l.playerId);
              if (!found) return null;
              return (
                <div className="result-row" key={l.playerId}>
                  <span>{i + 1}. <PlayerLink p={found.player} openPlayer={openPlayer} /> · <TeamLink team={getTeam(league, l.teamId)} openTeam={openTeam}>{l.teamId}</TeamLink></span>
                  <span className="num">{l.value.toFixed(1)} {cat.unit}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="controls">
        <button className="btn" onClick={onContinue}>Continue to Calendar</button>
      </div>
    </div>
  );
}
