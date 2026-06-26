import React from 'react';
import { getTeam } from '../engine/league.js';
import { textOnColor } from '../engine/colorUtils.js';
import { TeamLink } from './shared.jsx';
import { Card } from './ui/Card.jsx';
import { CUP_GROUP_DAYS } from '../engine/cup.js';

function fmtW(w, l) {
  return `${w ?? 0}–${l ?? 0}`;
}

function TeamLogo({ team }) {
  if (!team) return null;
  return (
    <span className="team-logo" style={{ '--logo-color': team.color, color: textOnColor(team.color) }}>{team.id}</span>
  );
}

function CupGame({ league, game, label, openTeam }) {
  if (!game) return null;
  const homeTeam = getTeam(league, game.home);
  const awayTeam = getTeam(league, game.away);
  const played = !!game.winner;
  const homeWon = game.winner === game.home;

  const row = (team, pts, isWinner) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '2px 0' }}>
      <TeamLogo team={team} />
      <TeamLink team={team} openTeam={openTeam} style={{ flex: 1 }}>{team.city} {team.name}</TeamLink>
      {played && <span style={{ fontWeight: isWinner ? 700 : 400, minWidth: 28, textAlign: 'right' }}>{pts}</span>}
    </div>
  );

  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ background: 'var(--panel2)', borderRadius: 'var(--radius)', padding: 'var(--sp-2) var(--sp-3)' }}>
        {row(homeTeam, game.homePts, homeWon)}
        {row(awayTeam, game.awayPts, !homeWon)}
        {!played && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>TBD</div>}
      </div>
    </div>
  );
}

function GroupStandings({ league, openTeam }) {
  const CONFS = ['East', 'West'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
      {CONFS.map((conf) => {
        const sorted = league.teams
          .filter((t) => t.conf === conf)
          .sort((a, b) => (b.cupWins || 0) - (a.cupWins || 0) || (a.cupLosses || 0) - (b.cupLosses || 0) || b.wins - a.wins);
        const inBracket = new Set(league.cup?.bracket
          ? [...(league.cup.bracket.eastSeeds || []), ...(league.cup.bracket.westSeeds || [])]
          : []);
        return (
          <Card key={conf}>
            <div style={{ fontWeight: 600, marginBottom: 'var(--sp-2)', color: 'var(--text-secondary)' }}>{conf}ern Cup Standings</div>
            <table style={{ width: '100%', fontSize: 'var(--text-sm)', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                  <th style={{ textAlign: 'left', paddingBottom: 4 }}>Team</th>
                  <th style={{ textAlign: 'right', paddingBottom: 4 }}>W</th>
                  <th style={{ textAlign: 'right', paddingBottom: 4 }}>L</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((team, i) => {
                  const isUser = team.id === league.userTeamId;
                  const qualified = inBracket.has(team.id);
                  return (
                    <tr
                      key={team.id}
                      style={{
                        background: isUser ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                        borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      <td style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                        {i < 4 && <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 16 }}>{i + 1}.</span>}
                        {i >= 4 && <span style={{ fontSize: 10, color: 'transparent', minWidth: 16 }}>—</span>}
                        <TeamLogo team={team} />
                        <TeamLink team={team} openTeam={openTeam}>{team.city} {team.name}</TeamLink>
                        {qualified && <span style={{ fontSize: 10, color: 'var(--color-success)', fontWeight: 700, marginLeft: 4 }}>✓</span>}
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px 4px', fontWeight: (team.cupWins || 0) > 0 ? 600 : 400 }}>{team.cupWins || 0}</td>
                      <td style={{ textAlign: 'right', padding: '4px 0' }}>{team.cupLosses || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}

function Bracket({ league, openTeam }) {
  const cup = league.cup;
  const b = cup?.bracket;
  if (!b) return null;

  return (
    <Card style={{ marginBottom: 'var(--sp-4)' }}>
      <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-3)' }}>Cup Bracket</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>East</div>
          <CupGame league={league} game={b.East[0]} label="Quarterfinal" openTeam={openTeam} />
          <CupGame league={league} game={b.East[1]} label="Quarterfinal" openTeam={openTeam} />
        </div>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>West</div>
          <CupGame league={league} game={b.West[0]} label="Quarterfinal" openTeam={openTeam} />
          <CupGame league={league} game={b.West[1]} label="Quarterfinal" openTeam={openTeam} />
        </div>
      </div>

      {b.semis && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', margin: 'var(--sp-3) 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <CupGame league={league} game={b.semis[0]} label="East Semifinal" openTeam={openTeam} />
            <CupGame league={league} game={b.semis[1]} label="West Semifinal" openTeam={openTeam} />
          </div>
        </>
      )}

      {b.final && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', margin: 'var(--sp-3) 0' }} />
          <CupGame league={league} game={b.final} label="NBA Cup Final" openTeam={openTeam} />
        </>
      )}

      {cup.champion && (
        <div style={{ marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'color-mix(in srgb, var(--color-success) 10%, var(--panel2))', border: '1px solid var(--color-success-line, var(--color-success))', borderRadius: 'var(--radius)', textAlign: 'center', fontWeight: 700 }}>
          🏆 {getTeam(league, cup.champion).city} {getTeam(league, cup.champion).name} — {league.season} NBA Cup Champions
        </div>
      )}
    </Card>
  );
}

export default function NbaCup({ league, openTeam }) {
  const cup = league.cup;
  const dayIndex = league.dayIndex;
  const groupStageActive = dayIndex < CUP_GROUP_DAYS && !cup?.bracket;
  const groupStageComplete = dayIndex >= CUP_GROUP_DAYS || !!cup?.bracket;

  if (!cup || cup.season !== league.season) {
    return (
      <Card>
        <p style={{ color: 'var(--text-muted)' }}>NBA Cup data not available for this season.</p>
      </Card>
    );
  }

  const daysLeft = Math.max(0, CUP_GROUP_DAYS - dayIndex);

  return (
    <div>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>NBA Cup</span>
        {cup.champion ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
            {getTeam(league, cup.champion).city} {getTeam(league, cup.champion).name} won the {league.season} NBA Cup.
          </p>
        ) : groupStageActive ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
            Group stage in progress — division matchups count toward cup standings.
            The top 4 teams per conference advance to the knockout bracket in {daysLeft} game-day{daysLeft !== 1 ? 's' : ''}.
          </p>
        ) : groupStageComplete && !cup.bracket ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
            Group stage complete — bracket seeding in progress.
          </p>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
            Knockout bracket in progress. Sim cup games from the controls above.
          </p>
        )}
      </Card>

      <GroupStandings league={league} openTeam={openTeam} />
      <Bracket league={league} openTeam={openTeam} />

      {cup.log.length > 0 && (
        <Card>
          <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>History</span>
          {cup.log.map((l, i) => <div key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', padding: '2px 0' }}>{l}</div>)}
        </Card>
      )}
    </div>
  );
}
