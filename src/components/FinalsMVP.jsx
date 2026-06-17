import React from 'react';
import { getTeam } from '../engine/league.js';
import { PlayerLink, TeamLink, Confetti } from './shared.jsx';

// First offseason phase: the champion is crowned, the Finals MVP revealed,
// and a quick game-by-game recap of the series. league.finalsMVP and
// league.playoffs are both set the moment the championship-clinching game
// ends (see league.js), before advanceOffseason runs.
export default function FinalsMVP({ league, openPlayer, openTeam, onContinue }) {
  const po = league.playoffs;
  const finals = po?.finals;
  const champ = po?.champion ? getTeam(league, po.champion) : null;
  const mvp = league.finalsMVP;
  const mvpTeam = mvp ? getTeam(league, mvp.teamId) : null;
  const mvpPlayer = mvp ? mvpTeam?.roster.find((p) => p.id === mvp.playerId) : null;
  const isUserChamp = !!champ && champ.id === league.userTeamId;
  const isUserMVP = !!mvp && mvp.teamId === league.userTeamId;

  return (
    <div className="modal-overlay">
      <div
        className="modal-card wide offseason-gate"
        style={isUserChamp ? { borderColor: 'var(--team-color-safe)', boxShadow: '0 0 0 1px var(--team-color-safe)', position: 'relative', overflow: 'hidden' } : { position: 'relative', overflow: 'hidden' }}
      >
        {isUserChamp && <Confetti />}

        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 64 }}>🏆</div>
          {champ ? (
            <>
              <h1 className="display-font" style={{ fontSize: 36, margin: '8px 0 4px' }}>
                {champ.city} {champ.name}
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: 18 }}>
                {league.season} NBA Champions · {champ.wins}-{champ.losses}
              </p>
            </>
          ) : (
            <h1 className="display-font" style={{ fontSize: 28 }}>A New Champion is Crowned</h1>
          )}
        </div>

        {mvp && (
          <div
            className="panel"
            style={{
              margin: '0 0 16px', textAlign: 'center',
              ...(isUserMVP ? { boxShadow: 'inset 0 0 0 2px var(--team-color-safe)', background: 'var(--team-color-soft)' } : {}),
            }}
          >
            <h2 style={{ marginBottom: 4 }}>Finals MVP{isUserMVP ? ' 🌟' : ''}</h2>
            <h3 style={{ fontSize: 24, marginBottom: 4 }}>
              {mvpPlayer ? <PlayerLink p={mvpPlayer} openPlayer={openPlayer} /> : mvp.name}
              {mvpTeam && <> · <TeamLink team={mvpTeam} openTeam={openTeam}>{mvpTeam.id}</TeamLink></>}
            </h3>
            <p style={{ color: 'var(--muted)' }}>
              {mvp.ppg} ppg · {mvp.rpg} rpg · {mvp.apg} apg across {mvp.gp} Finals game{mvp.gp === 1 ? '' : 's'}
            </p>
          </div>
        )}

        {finals?.games?.length > 0 && (
          <div className="panel">
            <h3>Series Recap</h3>
            {finals.games.map((g, i) => {
              const home = getTeam(league, g.home);
              const away = getTeam(league, g.away);
              return (
                <div className="result-row" key={i}>
                  <span>
                    Game {i + 1}: <TeamLink team={home} openTeam={openTeam}>{home.id}</TeamLink> {g.homePts}
                    {' – '}
                    {g.awayPts} <TeamLink team={away} openTeam={openTeam}>{away.id}</TeamLink>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="controls" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn" onClick={onContinue}>Continue</button>
        </div>
      </div>
    </div>
  );
}
