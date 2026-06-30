import React, { useRef, useState } from 'react';
import { standings } from '../engine/league.js';
import { TeamLink, TeamBadge } from './TeamDisplay.jsx';
import { Card } from './ui/Card.jsx';
import { Tabs } from './ui/Tabs.jsx';

function gamesBack(leader, t) {
  const gb = (leader.wins - t.wins + (t.losses - leader.losses)) / 2;
  return gb <= 0 ? '–' : gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1);
}

function resultLog(league, teamId) {
  const out = [];
  for (const day of league.resultsByDay || []) {
    const r = day?.find((x) => x.home === teamId || x.away === teamId);
    if (!r) continue;
    out.push(r.home === teamId ? r.homePts > r.awayPts : r.awayPts > r.homePts);
  }
  return out;
}

function last10(log) {
  const last = log.slice(-10);
  if (last.length === 0) return '–';
  const wins = last.filter(Boolean).length;
  return `${wins}-${last.length - wins}`;
}

function currentStreak(log) {
  if (log.length === 0) return '–';
  const kind = log[log.length - 1];
  let count = 0;
  for (let i = log.length - 1; i >= 0 && log[i] === kind; i--) count++;
  return `${kind ? 'W' : 'L'}${count}`;
}

function RankArrow({ prevRank, rank }) {
  if (prevRank == null || prevRank === rank) return null;
  return prevRank > rank
    ? <span style={{ color: 'var(--color-success)' }}> ▲{prevRank - rank}</span>
    : <span style={{ color: 'var(--color-danger)' }}> ▼{rank - prevRank}</span>;
}

function StreakBadge({ streak }) {
  if (streak === '–') return <span style={{ color: 'var(--text-muted)' }}>–</span>;
  const win = streak.startsWith('W');
  return (
    <span className={`ui-badge ${win ? 'ui-badge--success' : 'ui-badge--danger'}`} style={{ fontFamily: 'var(--font-tabular)' }}>
      {streak}
    </span>
  );
}

function ConfTableBody({ league, conf, openTeam, prevRanks, comfortable }) {
  const rows = standings(league, conf);
  return (
    <table className={`ui-table zebra${comfortable ? ' comfortable' : ''}`}>
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th>Team</th>
          <th className="num">W</th>
          <th className="num">L</th>
          <th className="num">Pct</th>
          <th className="num">GB</th>
          <th className="num">L10</th>
          <th className="num">Strk</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => {
          const log = resultLog(league, t.id);
          const streak = currentStreak(log);
          const isUser = t.id === league.userTeamId;
          return (
            <React.Fragment key={t.id}>
              <tr style={isUser ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
                <td style={{ color: 'var(--text-muted)' }}>
                  {i + 1}
                  <RankArrow prevRank={prevRanks?.get(t.id)} rank={i} />
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    <TeamBadge team={t} size="small" />
                    <TeamLink team={t} openTeam={openTeam} />
                  </span>
                </td>
                <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{t.wins}</td>
                <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{t.losses}</td>
                <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
                <td className="num">{gamesBack(rows[0], t)}</td>
                <td className="num">{last10(log)}</td>
                <td className="num"><StreakBadge streak={streak} /></td>
              </tr>
              {i === 7 && (
                <tr className="standings-cutoff-row">
                  <td colSpan={8}>
                    <div className="standings-cutoff-line">
                      <span className="standings-cutoff-label">Playoff Line</span>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function ConferenceView({ league, openTeam, prevRanks }) {
  return (
    <Card noPad>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <div style={{ padding: 'var(--sp-5) var(--sp-5) var(--sp-3)' }}>
            <span className="ui-section-title">Eastern Conference</span>
          </div>
          <div className="ui-table-wrap">
            <ConfTableBody league={league} conf="East" openTeam={openTeam} prevRanks={prevRanks?.East} comfortable />
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border)' }}>
          <div style={{ padding: 'var(--sp-5) var(--sp-5) var(--sp-3)' }}>
            <span className="ui-section-title">Western Conference</span>
          </div>
          <div className="ui-table-wrap">
            <ConfTableBody league={league} conf="West" openTeam={openTeam} prevRanks={prevRanks?.West} comfortable />
          </div>
        </div>
      </div>
    </Card>
  );
}

function LeagueTable({ league, openTeam, prevRanks }) {
  const rows = standings(league);
  return (
    <Card noPad>
      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)' }}>
        <span className="ui-section-title">All 30 Teams</span>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table zebra">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Team</th>
              <th>Conf</th>
              <th className="num">W</th>
              <th className="num">L</th>
              <th className="num">Pct</th>
              <th className="num">GB</th>
              <th className="num">L10</th>
              <th className="num">Strk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const log = resultLog(league, t.id);
              const streak = currentStreak(log);
              const isUser = t.id === league.userTeamId;
              return (
                <tr key={t.id} style={isUser ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {i + 1}
                    <RankArrow prevRank={prevRanks?.get(t.id)} rank={i} />
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                      <TeamBadge team={t} size="small" />
                      <TeamLink team={t} openTeam={openTeam} />
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{t.conf}</td>
                  <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{t.wins}</td>
                  <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{t.losses}</td>
                  <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
                  <td className="num">{gamesBack(rows[0], t)}</td>
                  <td className="num">{last10(log)}</td>
                  <td className="num"><StreakBadge streak={streak} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ranksFor(rows) {
  return new Map(rows.map((t, i) => [t.id, i]));
}

const VIEW_TABS = [
  { key: 'conference', label: 'Conference' },
  { key: 'league', label: 'League' },
];

export default function Standings({ league, openTeam }) {
  const [tab, setTab] = useState('conference');

  const currentRanks = {
    East: ranksFor(standings(league, 'East')),
    West: ranksFor(standings(league, 'West')),
    League: ranksFor(standings(league)),
  };

  const ranksRef = useRef({ dayIndex: league.dayIndex, ranks: currentRanks, prevRanks: null });
  if (ranksRef.current.dayIndex !== league.dayIndex) {
    ranksRef.current = { dayIndex: league.dayIndex, ranks: currentRanks, prevRanks: ranksRef.current.ranks };
  }
  const prevRanks = ranksRef.current.prevRanks;

  return (
    <div>
      <Tabs tabs={VIEW_TABS} activeTab={tab} onTabChange={setTab} />
      {tab === 'conference' && (
        <ConferenceView league={league} openTeam={openTeam} prevRanks={prevRanks} />
      )}
      {tab === 'league' && (
        <LeagueTable league={league} openTeam={openTeam} prevRanks={prevRanks?.League} />
      )}
    </div>
  );
}
