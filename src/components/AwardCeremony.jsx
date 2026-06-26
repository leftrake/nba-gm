import React from 'react';
import { getTeam } from '../engine/league.js';
import { PlayerLink, TeamLink, Confetti } from './shared.jsx';

// Award Ceremony: a full-screen slideshow shown once per season, right after
// the regular season ends and before the playoffs begin. league.seasonAwards
// is the snapshot computed by computeAwards() at that moment; each entry is
// { playerId, name, teamId, line }. Single-winner awards are skipped if no
// qualifying player was found; team awards are skipped if empty.
function findPlayer(league, entry) {
  const team = getTeam(league, entry.teamId);
  const player = team?.roster.find((p) => p.id === entry.playerId);
  return { player, team };
}

function SingleSlide({ league, icon, title, entry, openPlayer, openTeam }) {
  const { player, team } = findPlayer(league, entry);
  const isUser = entry.teamId === league.userTeamId;
  return (
    <div className="award-slide">
      <div className="award-icon">{icon}</div>
      <div className="award-title">{title}</div>
      <h1 className="display-font award-winner">
        {player ? <PlayerLink p={player} openPlayer={openPlayer} /> : entry.name}
      </h1>
      {team && (
        <div className="award-team">
          <TeamLink team={team} openTeam={openTeam}>{team.city} {team.name}</TeamLink>
        </div>
      )}
      <p className="award-line">{entry.line}</p>
      {isUser && <div className="award-yours">⭐ Your Player</div>}
    </div>
  );
}

function TeamSlide({ league, icon, title, entries, openPlayer, openTeam }) {
  const hasUser = entries.some((e) => e.teamId === league.userTeamId);
  return (
    <div className="award-slide">
      <div className="award-icon">{icon}</div>
      <div className="award-title">{title}</div>
      <div className="award-roster">
        {entries.map((entry) => {
          const { player, team } = findPlayer(league, entry);
          const isUser = entry.teamId === league.userTeamId;
          return (
            <div className={`award-roster-row${isUser ? ' yours' : ''}`} key={entry.playerId}>
              <span className="award-roster-name">
                {player ? <PlayerLink p={player} openPlayer={openPlayer} /> : entry.name}
              </span>
              {team && (
                <span className="award-roster-team">
                  <TeamLink team={team} openTeam={openTeam}>{team.id}</TeamLink>
                </span>
              )}
              <span className="award-roster-line">{entry.line}</span>
              {isUser && <span className="award-yours-tag">Yours</span>}
            </div>
          );
        })}
      </div>
      {hasUser && <div className="award-yours">⭐ Features your team</div>}
    </div>
  );
}

export default function AwardCeremony({ league, openPlayer, openTeam, onContinue }) {
  const awards = league.seasonAwards;
  const [index, setIndex] = React.useState(0);

  const slides = React.useMemo(() => {
    if (!awards) return [];
    const list = [];
    if (awards.mvp) list.push({ key: 'mvp', icon: '🏆', title: 'Most Valuable Player', entry: awards.mvp });
    if (awards.dpoy) list.push({ key: 'dpoy', icon: '🛡️', title: 'Defensive Player of the Year', entry: awards.dpoy });
    if (awards.roy) list.push({ key: 'roy', icon: '🌱', title: 'Rookie of the Year', entry: awards.roy });
    if (awards.sixth) list.push({ key: 'sixth', icon: '🔥', title: 'Sixth Man of the Year', entry: awards.sixth });
    if (awards.mip) list.push({ key: 'mip', icon: '📈', title: 'Most Improved Player', entry: awards.mip });
    const NBA_NAMES = ['First', 'Second', 'Third'];
    (awards.allNba || []).forEach((teamArr, i) => {
      if (teamArr.length) list.push({ key: `allnba${i}`, icon: '⭐', title: `All-NBA ${NBA_NAMES[i]} Team`, entries: teamArr });
    });
    const DEF_NAMES = ['First', 'Second'];
    (awards.allDef || []).forEach((teamArr, i) => {
      if (teamArr.length) list.push({ key: `alldef${i}`, icon: '🧱', title: `All-Defensive ${DEF_NAMES[i]} Team`, entries: teamArr });
    });
    return list;
  }, [awards]);

  if (!awards || slides.length === 0) {
    // Nothing to show (e.g. a save predating awards) — skip straight through.
    onContinue();
    return null;
  }

  const slide = slides[Math.min(index, slides.length - 1)];
  const isLast = index >= slides.length - 1;
  const isFirst = index === 0;
  const userIsFeatured = slide.entry
    ? slide.entry.teamId === league.userTeamId
    : slide.entries.some((e) => e.teamId === league.userTeamId);

  return (
    <div className="modal-overlay">
      <div className="modal-card wide offseason-gate award-ceremony" style={{ position: 'relative', overflow: 'hidden' }}>
        {userIsFeatured && <Confetti />}

        <div style={{ textAlign: 'center', padding: '8px 0 0' }}>
          <div className="award-step">{league.season} Awards · {index + 1} / {slides.length}</div>
        </div>

        {slide.entry ? (
          <SingleSlide league={league} icon={slide.icon} title={slide.title} entry={slide.entry} openPlayer={openPlayer} openTeam={openTeam} />
        ) : (
          <TeamSlide league={league} icon={slide.icon} title={slide.title} entries={slide.entries} openPlayer={openPlayer} openTeam={openTeam} />
        )}

        <div className="controls" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <button className="btn secondary" onClick={onContinue}>Skip</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn secondary" disabled={isFirst} onClick={() => setIndex((i) => Math.max(0, i - 1))}>← Previous</button>
            {isLast ? (
              <button className="btn" onClick={onContinue}>Continue to Playoffs</button>
            ) : (
              <button className="btn" onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}>Next →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
