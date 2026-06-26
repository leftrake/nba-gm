import React, { useMemo, useState } from 'react';
import { getTeam, standings, makeRoundMatchups, teamPlayoffStatus } from '../engine/league.js';
import { safeAccent, textOnColor } from '../engine/colorUtils.js';
import { TeamLink, NewsText, GuideTooltip } from './shared.jsx';
import { Card } from './ui/Card.jsx';
import SeriesModal from './SeriesModal.jsx';

export const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

// If the user's team is in an active series where the opponent has 3 wins,
// tonight's game (or the next one simmed) eliminates them if they lose —
// covers everything from down 0-3 through a winner-take-all Game 7.
function eliminationContext(league) {
  const userId = league.userTeamId;
  if (!userId) return null;
  const status = teamPlayoffStatus(league, userId);
  if (!status?.active || !status.series) return null;
  const m = status.series;
  const isHigh = m.high === userId;
  const myWins = isHigh ? m.highWins : m.lowWins;
  const oppWins = isHigh ? m.lowWins : m.highWins;
  if (oppWins !== 3) return null;
  return { myWins, oppWins, oppId: isHigh ? m.low : m.high };
}

const ROUND_COUNTS = [4, 2, 1];

function getRoundSeries(po, conf, round) {
  if (round === po.round && round < 3) return po[conf] || [];
  if (round < po.round) {
    return (po.completed || []).filter((c) => c.conf === conf && c.round === round).map((c) => c.series);
  }
  // One round ahead: pre-populate slots where a series has already been decided
  if (round === po.round + 1 && round < 3) {
    const prev = po[conf] || [];
    return Array.from({ length: ROUND_COUNTS[round] }, (_, i) => {
      const w0 = prev[i * 2]?.winner ?? null;
      const w1 = prev[i * 2 + 1]?.winner ?? null;
      if (w0 === null && w1 === null) return { high: null, low: null, highWins: 0, lowWins: 0, winner: null, games: [] };
      return { high: w0, low: w1, highWins: 0, lowWins: 0, winner: null, games: [] };
    });
  }
  return Array.from({ length: ROUND_COUNTS[round] }, () => ({ high: null, low: null, highWins: 0, lowWins: 0, winner: null, games: [] }));
}

function seriesScoreLabel(m) {
  if (!m || m.high == null) return 'TBD';
  return `${m.highWins}-${m.lowWins}`;
}

function BracketCard({ league, m, openTeam, openSeries, roundName, seeds }) {
  if (m.high == null && m.low == null) {
    return (
      <div className="bracket-card placeholder-card">
        <div className="bracket-team tbd">TBD</div>
        <div className="bracket-team tbd">TBD</div>
      </div>
    );
  }
  const completed = !!m.winner;
  const clickable = (m.games || []).length > 0;
  const teamRow = (teamId, wins, isWinner) => {
    if (teamId == null) {
      return (
        <div key="tbd">
          <div className="bracket-team tbd">TBD</div>
          {clickable && (
            <div className="series-dots">
              {Array.from({ length: 4 }).map((_, i) => <span key={i} className="series-dot" />)}
            </div>
          )}
        </div>
      );
    }
    const team = getTeam(league, teamId);
    return (
      <div key={team.id}>
        <div className={`bracket-team${isWinner ? ' winner' : ''}`}>
          <span className="seed-num">({seeds.get(team.id)})</span>
          <span className="team-logo" style={{ '--logo-color': team.color, color: textOnColor(team.color) }}>{team.id}</span>
          <TeamLink team={team} openTeam={openTeam}>{team.name}</TeamLink>
          {clickable && <span className="score">{wins}</span>}
        </div>
        {clickable && (
          <div className="series-dots" style={{ color: safeAccent(team.color) }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className={`series-dot${i < wins ? ' filled' : ''}`} />
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <div
      className={`bracket-card${completed ? ' completed' : ''}`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={() => clickable && openSeries(m, roundName)}
    >
      {teamRow(m.high, m.highWins, m.winner === m.high)}
      {teamRow(m.low, m.lowWins, m.winner === m.low)}
    </div>
  );
}

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
            <div className="champion-banner-inline" style={{ '--team-color': getTeam(league, po.champion).color, '--team-color-safe': safeAccent(getTeam(league, po.champion).color), '--team-color-text': textOnColor(getTeam(league, po.champion).color) }}>
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
  const [seriesView, setSeriesView] = useState(null);

  const seeds = useMemo(() => {
    const map = new Map();
    for (const conf of ['East', 'West']) {
      standings(league, conf).slice(0, 6).forEach((t, i) => map.set(t.id, i + 1));
      const pi = league.playIn?.[conf];
      if (pi?.seventh) map.set(pi.seventh, 7);
      if (pi?.eighth) map.set(pi.eighth, 8);
      // Fallback for saves without play-in: fill from standings
      if (!pi?.seventh) {
        const s = standings(league, conf);
        if (s[6]) map.set(s[6].id, 7);
        if (s[7]) map.set(s[7].id, 8);
      }
    }
    return map;
  }, [league, po]);

  if (!po) {
    // If play-in is in progress, defer to the play-in screen instead of projecting
    if (league.phase === 'play-in' && league.playIn && !league.playIn.complete) {
      return (
        <div>
          <Card>
            <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>Play-In Tournament in Progress</span>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
              The playoff bracket will be set once the Play-In Tournament is complete. Check the Play-In tab to see the bracket and sim games.
            </p>
          </Card>
        </div>
      );
    }
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
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>Projected Playoff Bracket</span>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>The playoffs haven't started yet. Here's how the bracket would look if the regular season ended today — it will keep shifting as teams win and lose.</p>
        </Card>
        <Card noPad>
          <BracketGrid league={league} po={projected} openTeam={openTeam} openSeries={() => {}} seeds={seeds} />
        </Card>
      </div>
    );
  }

  const roundName = ROUND_NAMES[po.round] || '';
  const openSeries = (m, rn) => setSeriesView({ m, roundName: rn });
  const elim = !po.champion ? eliminationContext(league) : null;

  return (
    <div>
      {elim && (
        <Card style={{ marginBottom: 'var(--sp-4)', border: '1px solid var(--color-danger-line)', background: 'var(--color-danger-soft)' }}>
          <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)', color: 'var(--color-danger)' }}>⚠️ Win or Go Home</span>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
            {elim.myWins === 3
              ? "It's Game 7. Win tonight and you're moving on — lose, and the season's over."
              : `Down ${elim.myWins}-${elim.oppWins} to the ${getTeam(league, elim.oppId).city} ${getTeam(league, elim.oppId).name}. Lose tonight and the season's over.`}
          </p>
        </Card>
      )}
      {!po.champion && (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          <GuideTooltip
            tipKey="playoffs_entered"
            text="Best-of-7 series, home court goes to the higher seed. Rest and rotation matter more than ever — tired stars in the fourth quarter lose series."
            block
          >
            <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>Current Round: {roundName}</span>
          </GuideTooltip>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>"Sim Next Playoff Game" plays one game in every active series; "Sim Playoff Round" fast-forwards the round. Click a series for game-by-game results and stat leaders.</p>
        </Card>
      )}
      <Card noPad>
        <BracketGrid league={league} po={po} openTeam={openTeam} openSeries={openSeries} seeds={seeds} />
      </Card>
      {po.log.length > 0 && (
        <Card style={{ marginTop: 'var(--sp-4)' }}>
          <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-3)' }}>Series Results</span>
          {po.log.map((l, i) => <div className="news-item" key={i}><NewsText text={l} openTeam={openTeam} /></div>)}
        </Card>
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
