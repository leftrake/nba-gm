import React, { useMemo, useState } from 'react';
import { getTeam, standings, makeRoundMatchups } from '../engine/league.js';
import { TeamLink, NewsText } from './shared.jsx';
import SeriesModal from './SeriesModal.jsx';

export const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

// How many matchups exist per conference in each round, used to build TBD
// placeholders for rounds the bracket hasn't reached yet.
const ROUND_COUNTS = [4, 2, 1];

// The series for a given conference/round: the live arrays for the round
// currently being played, the archived copy from `po.completed` for rounds
// already finished, or a row of TBD placeholders for rounds not yet reached.
function getRoundSeries(po, conf, round) {
  if (round === po.round && round < 3) return po[conf] || [];
  if (round < po.round) {
    return (po.completed || []).filter((c) => c.conf === conf && c.round === round).map((c) => c.series);
  }
  return Array.from({ length: ROUND_COUNTS[round] }, () => ({ high: null, low: null, highWins: 0, lowWins: 0, winner: null, games: [] }));
}

// "4-2" for a decided series, "1-0" for one in progress, "TBD" if the
// matchup hasn't been determined yet.
function seriesScoreLabel(m) {
  if (!m || m.high == null) return 'TBD';
  return `${m.highWins}-${m.lowWins}`;
}

// One matchup as a broadcast-style card: team rows with seed, logo, series
// score, and win/loss dots. Clicking opens the game-by-game series modal.
// Renders a TBD placeholder if the matchup hasn't been determined yet.
function BracketCard({ league, m, openTeam, openSeries, roundName, seeds }) {
  if (m.high == null) {
    return (
      <div className="bracket-card placeholder-card">
        <div className="bracket-team tbd">TBD</div>
        <div className="bracket-team tbd">TBD</div>
      </div>
    );
  }
  const high = getTeam(league, m.high);
  const low = getTeam(league, m.low);
  const completed = !!m.winner;
  const clickable = (m.games || []).length > 0;
  const teamRow = (team, wins, isWinner) => (
    <div key={team.id}>
      <div className={`bracket-team${isWinner ? ' winner' : ''}`}>
        <span className="seed-num">({seeds.get(team.id)})</span>
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

// One round's column of matchups, with its title. Has a fixed height so its
// cards line up with the connector lines feeding into/out of it.
function BracketColumn({ league, round, series, current, openTeam, openSeries, seeds }) {
  return (
    <div className={`bracket-round${current ? ' current' : ''}`}>
      <div className="bracket-round-title">{ROUND_NAMES[round]}</div>
      <div className="bracket-round-body">
        {series.map((m, i) => (
          <BracketCard key={i} league={league} m={m} openTeam={openTeam} openSeries={openSeries} roundName={ROUND_NAMES[round]} seeds={seeds} />
        ))}
      </div>
    </div>
  );
}

// The connecting lines between two adjacent rounds: `sourceCount` matchups
// on one side converge in groups (of `sourceCount / labels.length`) toward
// `labels.length` matchups on the other side. Each group gets an elbow
// connector with the resulting series score on it. `flip` mirrors the whole
// thing so the "many" side ends up on the right (used on the East side of
// the bracket, which reads right-to-left toward the Finals).
function BracketConnector({ sourceCount, labels, flip }) {
  const groupSize = sourceCount / labels.length;
  return (
    <div className={`bracket-connector${flip ? ' flip' : ''}`}>
      {labels.map((label, g) => {
        const midY = ((g + 0.5) / labels.length) * 100;
        if (groupSize === 1) {
          return (
            <React.Fragment key={g}>
              <div className="conn-line" style={{ top: `${midY}%`, left: 0, width: '100%' }} />
              <div className="conn-label" style={{ top: `${midY}%`, left: '50%' }}>{label}</div>
            </React.Fragment>
          );
        }
        const topY = ((g * groupSize + 0.5) / sourceCount) * 100;
        const botY = ((g * groupSize + groupSize - 0.5) / sourceCount) * 100;
        return (
          <React.Fragment key={g}>
            <div className="conn-line" style={{ top: `${topY}%`, left: 0, width: '50%' }} />
            <div className="conn-line" style={{ top: `${botY}%`, left: 0, width: '50%' }} />
            <div className="conn-vline" style={{ left: '50%', top: `${topY}%`, height: `${botY - topY}%` }} />
            <div className="conn-line" style={{ top: `${midY}%`, left: '50%', width: '50%' }} />
            <div className="conn-label" style={{ top: `${midY}%`, left: '50%' }}>{label}</div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// One conference's side of the bracket: First Round, Conf Semis, Conf Finals
// plus the connectors between them. `flip` (East) mirrors the column order
// so the Conference Finals sits nearest the center, and mirrors the
// connectors so they still point inward.
function ConferenceSide({ league, po, conf, openTeam, openSeries, seeds, flip }) {
  const r0 = getRoundSeries(po, conf, 0);
  const r1 = getRoundSeries(po, conf, 1);
  const r2 = getRoundSeries(po, conf, 2);
  const columns = [
    <BracketColumn key="r0" league={league} round={0} series={r0} current={po.round === 0} openTeam={openTeam} openSeries={openSeries} seeds={seeds} />,
    <BracketConnector key="c01" sourceCount={4} labels={r1.map(seriesScoreLabel)} flip={flip} />,
    <BracketColumn key="r1" league={league} round={1} series={r1} current={po.round === 1} openTeam={openTeam} openSeries={openSeries} seeds={seeds} />,
    <BracketConnector key="c12" sourceCount={2} labels={r2.map(seriesScoreLabel)} flip={flip} />,
    <BracketColumn key="r2" league={league} round={2} series={r2} current={po.round === 2} openTeam={openTeam} openSeries={openSeries} seeds={seeds} />,
  ];
  return <div className="bracket-side">{flip ? columns.slice().reverse() : columns}</div>;
}

// The bracket grid itself: West side, Finals (with champion banner if
// decided), East side, and the connectors between them. Shared by the live
// playoff bracket and the pre-playoffs projected bracket.
function BracketGrid({ league, po, openTeam, openSeries, seeds }) {
  const finalsLabel = seriesScoreLabel(po.finals);
  return (
    <div className="bracket-wrap">
      <div className="full-bracket">
        <div className="bracket-conf-group">
          <div className="bracket-conf-label">West</div>
          <ConferenceSide league={league} po={po} conf="West" openTeam={openTeam} openSeries={openSeries} seeds={seeds} />
        </div>
        <BracketConnector sourceCount={1} labels={[finalsLabel]} />
        <div className="bracket-center">
          <div className={`bracket-round${po.round === 3 ? ' current' : ''}`}>
            <div className="bracket-round-title">{ROUND_NAMES[3]}</div>
            <div className="bracket-round-body">
              {po.finals ? (
                <BracketCard league={league} m={po.finals} openTeam={openTeam} openSeries={openSeries} roundName={ROUND_NAMES[3]} seeds={seeds} />
              ) : (
                <BracketCard league={league} m={{ high: null }} openTeam={openTeam} openSeries={openSeries} roundName={ROUND_NAMES[3]} seeds={seeds} />
              )}
            </div>
          </div>
          {po.champion && (
            <div className="champion-banner-inline" style={{ '--team-color': getTeam(league, po.champion).color }}>
              🏆 <TeamLink team={getTeam(league, po.champion)} openTeam={openTeam} />
              <div>NBA Champions</div>
            </div>
          )}
        </div>
        <BracketConnector sourceCount={1} labels={[finalsLabel]} flip />
        <div className="bracket-conf-group">
          <div className="bracket-conf-label">East</div>
          <ConferenceSide league={league} po={po} conf="East" openTeam={openTeam} openSeries={openSeries} seeds={seeds} flip />
        </div>
      </div>
    </div>
  );
}

export default function Playoffs({ league, openTeam, openPlayer, openGame }) {
  const po = league.playoffs;
  const [seriesView, setSeriesView] = useState(null); // { m, roundName }

  // Seed numbers (1-8) come from each conference's regular-season standings.
  // Once the playoffs start these are locked in; before that, they're
  // recomputed from the current standings for the projected bracket below.
  const seeds = useMemo(() => {
    const map = new Map();
    for (const conf of ['East', 'West']) {
      standings(league, conf).slice(0, 8).forEach((t, i) => map.set(t.id, i + 1));
    }
    return map;
  }, [league, po]);

  if (!po) {
    // Project the first-round matchups from the current standings; later
    // rounds and the Finals are still TBD.
    const projected = {
      round: 0,
      East: makeRoundMatchups(standings(league, 'East').slice(0, 8).map((t) => t.id)),
      West: makeRoundMatchups(standings(league, 'West').slice(0, 8).map((t) => t.id)),
      finals: null,
      champion: null,
      completed: [],
    };
    return (
      <div>
        <div className="panel">
          <h2>Projected Playoff Bracket</h2>
          <p style={{ color: 'var(--muted)' }}>The playoffs haven't started yet. Here's how the bracket would look if the regular season ended today, based on the current standings — it will keep shifting as teams win and lose.</p>
        </div>
        <div className="panel">
          <BracketGrid league={league} po={projected} openTeam={openTeam} openSeries={() => {}} seeds={seeds} />
        </div>
      </div>
    );
  }
  const roundName = ROUND_NAMES[po.round] || '';
  const openSeries = (m, rn) => setSeriesView({ m, roundName: rn });

  return (
    <div>
      {!po.champion && (
        <div className="panel">
          <h2>Current Round: {roundName}</h2>
          <p style={{ color: 'var(--muted)' }}>"Sim Next Playoff Game" plays one game in every active series; "Sim Playoff Round" fast-forwards the round. Click a series for game-by-game results and stat leaders.</p>
        </div>
      )}
      <div className="panel">
        <BracketGrid league={league} po={po} openTeam={openTeam} openSeries={openSeries} seeds={seeds} />
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
