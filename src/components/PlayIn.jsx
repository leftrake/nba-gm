import React from 'react';
import { getTeam } from '../engine/league.js';
import { safeAccent, textOnColor } from '../engine/colorUtils.js';
import { TeamLink } from './TeamDisplay.jsx';
import { Card } from './ui/Card.jsx';

function GameResult({ league, game, label, openTeam }) {
  if (!game) return null;
  const homeTeam = getTeam(league, game.home);
  const awayTeam = getTeam(league, game.away);
  const played = game.winner !== null;
  const homeWon = game.winner === game.home;

  const teamRow = (team, pts, isWinner) => (
    <div className={`bracket-team${isWinner ? ' winner' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-1) 0' }}>
      <span className="team-logo" style={{ '--logo-color': team.color, color: textOnColor(team.color), flexShrink: 0 }}>{team.id}</span>
      <TeamLink team={team} openTeam={openTeam}>{team.city} {team.name}</TeamLink>
      {played && <span className="score" style={{ marginLeft: 'auto', fontWeight: isWinner ? 700 : 400 }}>{pts}</span>}
    </div>
  );

  return (
    <div className="bracket-card" style={{ background: 'var(--panel2)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {teamRow(homeTeam, game.homePts, homeWon)}
      {teamRow(awayTeam, game.awayPts, !homeWon)}
      {!played && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-1)' }}>Not yet played</div>}
    </div>
  );
}

function SeedBadge({ league, teamId, seed, isUser }) {
  const team = getTeam(league, teamId);
  if (!team) return null;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
        padding: 'var(--sp-2) var(--sp-3)',
        background: isUser ? 'color-mix(in srgb, var(--accent) 15%, var(--panel2))' : 'var(--panel2)',
        border: isUser ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        marginBottom: 'var(--sp-2)',
      }}
    >
      <span style={{ fontWeight: 700, color: 'var(--text-muted)', minWidth: '1.5rem' }}>#{seed}</span>
      <span className="team-logo" style={{ '--logo-color': team.color, color: textOnColor(team.color) }}>{team.id}</span>
      <span style={{ color: 'var(--text-primary)' }}>{team.city} {team.name}</span>
      {isUser && <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>YOUR TEAM</span>}
    </div>
  );
}

function ConfPlayIn({ league, conf, openTeam }) {
  const pi = league.playIn?.[conf];
  if (!pi) return null;

  const userTeamId = league.userTeamId;
  const seventh = pi.seventh;
  const eighth = pi.eighth;

  return (
    <div>
      <h3 style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{conf}ern Conference</h3>

      <GameResult league={league} game={pi.gameA} label="7 vs. 8 seed — Winner gets the 7 seed" openTeam={openTeam} />
      <GameResult league={league} game={pi.gameB} label="9 vs. 10 seed — Loser eliminated" openTeam={openTeam} />
      {pi.gameC && (
        <GameResult league={league} game={pi.gameC} label="Last Chance — Winner earns the 8 seed" openTeam={openTeam} />
      )}

      {(seventh || eighth) && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Playoff Seeds Earned</div>
          {seventh && <SeedBadge league={league} teamId={seventh} seed={7} isUser={seventh === userTeamId} />}
          {eighth && <SeedBadge league={league} teamId={eighth} seed={8} isUser={eighth === userTeamId} />}
        </div>
      )}
    </div>
  );
}

export default function PlayIn({ league, openTeam }) {
  const pi = league.playIn;

  if (!pi) {
    return (
      <Card>
        <p style={{ color: 'var(--text-muted)' }}>Play-In Tournament data not available.</p>
      </Card>
    );
  }

  const stage = pi.stage;
  const stageLabel =
    stage === 0 ? 'Up Next: 7 vs. 8 games' :
    stage === 1 ? 'Up Next: 9 vs. 10 games' :
    stage === 2 ? 'Up Next: Last Chance games' :
    'Play-In Complete';

  const userTeamId = league.userTeamId;
  const userConf = league.teams.find((t) => t.id === userTeamId)?.conf;
  const userInPlayIn = pi[userConf]?.seeds?.slice(6).includes(userTeamId);
  const userSeed = pi[userConf]?.seeds?.indexOf(userTeamId);
  const seedNum = userSeed >= 0 ? userSeed + 1 : null;

  return (
    <div>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>Play-In Tournament</span>
        {pi.complete ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
            All play-in games are complete. The full 16-team playoff bracket is set.
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-2)' }}>
              Seeds 7–10 in each conference compete for the final two playoff spots.
              The 7 vs. 8 game winner earns the 7 seed outright. The 9 vs. 10 loser
              is eliminated; the survivors play a last-chance game for the 8 seed.
            </p>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--accent)' }}>{stageLabel}</div>
            {userInPlayIn && seedNum && (
              <div style={{ marginTop: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-3)', background: 'color-mix(in srgb, var(--accent) 10%, var(--panel2))', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 600 }}>
                Your team is in the play-in as the {seedNum} seed.
              </div>
            )}
          </>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        {['East', 'West'].map((conf) => (
          <Card key={conf}>
            <ConfPlayIn league={league} conf={conf} openTeam={openTeam} />
          </Card>
        ))}
      </div>
    </div>
  );
}
