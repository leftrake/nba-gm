import React from 'react';
import { getTeam } from '../engine/league.js';
import { getPlayerById, simAllStarGame, userHasAllStar } from '../engine/allstar.js';
import { BoxTable, LineScore, TopPerformers, GameFlow } from './BoxScore.jsx';
import { PlayerLink } from './PlayerDisplay.jsx';
import { TeamLink } from './TeamDisplay.jsx';

function PlayerRow({ league, playerId, teamId, openPlayer, openTeam, extra }) {
  const found = getPlayerById(league, playerId);
  if (!found) return null;
  const isUser = teamId === league.userTeamId;
  return (
    <div className="result-row" style={isUser ? { background: 'var(--panel2)' } : {}}>
      <span>
        <PlayerLink p={found.player} openPlayer={openPlayer} /> · <TeamLink team={getTeam(league, teamId)} openTeam={openTeam}>{teamId}</TeamLink>
        {isUser && <span className="tag" style={{ marginLeft: 6, color: 'var(--accent)' }}>Your Player</span>}
      </span>
      {extra != null && <span className="num">{extra}</span>}
    </div>
  );
}

function RosterPanel({ league, conf, roster, openPlayer, openTeam }) {
  const hasUser = [...roster.starters, ...roster.reserves].some((r) => r.teamId === league.userTeamId);
  return (
    <div className="panel" style={hasUser ? { boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined}>
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

export default function AllStarScreen({ league, commit, openPlayer, openTeam, onContinue }) {
  const as = league.allStar;
  if (!as) return null;
  const { rosters, honors, game } = as;
  const hasUserAllStar = userHasAllStar(league);
  const mvp = game?.mvpPlayerId != null ? getPlayerById(league, game.mvpPlayerId) : null;

  const simulate = () => {
    simAllStarGame(league);
    commit();
  };

  return (
    <div>
      <div className="panel" style={hasUserAllStar ? { boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined}>
        <h2>🌟 All-Star Weekend · {as.season}</h2>
        <p style={{ color: 'var(--muted)' }}>
          Fans have voted in the All-Star starters and the coaches have picked the reserves. The league pauses for
          All-Star Friday (Skills Challenge & 3-Point Contest) before the All-Star Game.
        </p>
        {hasUserAllStar && !game && (
          <p style={{ color: 'var(--accent)', fontWeight: 600 }}>
            🎉 One of your players made the All-Star team!
          </p>
        )}
      </div>

      <div className="grid2">
        <RosterPanel league={league} conf="East" roster={rosters.East} openPlayer={openPlayer} openTeam={openTeam} />
        <RosterPanel league={league} conf="West" roster={rosters.West} openPlayer={openPlayer} openTeam={openTeam} />
      </div>

      <div className="panel">
        <h2>All-Star Game</h2>
        {!game ? (
          <>
            <p style={{ color: 'var(--muted)' }}>
              An exhibition-style game — relaxed defense, high scoring, fewer turnovers. The top performer takes
              home All-Star Game MVP.
            </p>
            <div className="controls">
              <button className="btn" onClick={simulate}>Simulate All-Star Game</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ fontSize: 22 }}>
              <span style={{ color: game.winner === 'East' ? 'var(--green)' : 'var(--text)' }}>East {game.homePts}</span>
              {' – '}
              <span style={{ color: game.winner === 'West' ? 'var(--green)' : 'var(--text)' }}>West {game.awayPts}</span>
            </h3>
            {mvp && (
              <p>
                <strong>🏆 All-Star Game MVP:</strong> <PlayerLink p={mvp.player} openPlayer={openPlayer} /> · <TeamLink team={mvp.team} openTeam={openTeam} />
              </p>
            )}
            <LineScore league={league} game={game} />
            <TopPerformers league={league} game={game} openPlayer={openPlayer} />
            <div className="grid2">
              <BoxTable league={league} teamId={game.home} pts={game.homePts} box={game.homeBox} openPlayer={openPlayer} />
              <BoxTable league={league} teamId={game.away} pts={game.awayPts} box={game.awayBox} openPlayer={openPlayer} />
            </div>
            <GameFlow events={game.events} />
          </>
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
              const isUser = l.teamId === league.userTeamId;
              return (
                <div className="result-row" key={l.playerId} style={isUser ? { background: 'var(--panel2)' } : {}}>
                  <span>{i + 1}. <PlayerLink p={found.player} openPlayer={openPlayer} /> · <TeamLink team={getTeam(league, l.teamId)} openTeam={openTeam}>{l.teamId}</TeamLink></span>
                  <span className="num">{l.value.toFixed(1)} {cat.unit}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="controls">
        <button className="btn" onClick={onContinue} disabled={!game}>
          {as.shown ? 'Back to Dashboard' : 'Continue to Calendar'}
        </button>
      </div>
    </div>
  );
}
