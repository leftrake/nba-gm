import React, { useState } from 'react';
import { LEADER_CATS, LEADER_MIN_GP, leaderMinGp, statLeaders, liveAwardRaces, pg } from '../engine/awards.js';
import { PlayerLink } from './PlayerDisplay.jsx';
import { TeamLink, TeamBadge } from './TeamDisplay.jsx';
import { Tabs } from './ui/Tabs.jsx';

function LeaderTable({ league, statKey, label, unit, openPlayer, openTeam, openStats }) {
  const rows = statLeaders(league, statKey);
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>{label}</h2>
        <button
          className="btn small secondary"
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
          onClick={() => openStats(statKey)}
        >
          See full stats →
        </button>
      </div>
      {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>Player</th><th>Team</th><th className="num">{unit}</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.p.id} style={r.team.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
                <td>{i + 1}</td>
                <td><PlayerLink p={r.p} openPlayer={openPlayer} /></td>
                <td><TeamBadge team={r.team} size="small" /> <TeamLink team={r.team} openTeam={openTeam}>{r.team.name}</TeamLink></td>
                <td className="num">{r.value.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const RACE_DEFS = [
  { key: 'mvp', label: 'MVP Race' },
  { key: 'dpoy', label: 'DPOY Race' },
  { key: 'roy', label: 'Rookie of the Year' },
  { key: 'sixth', label: 'Sixth Man' },
  { key: 'mip', label: 'Most Improved' },
];

function movementArrow(playerId, prevIds) {
  if (!prevIds || prevIds.length === 0) return null;
  const prev = prevIds.indexOf(playerId);
  if (prev === -1) return <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}> new</span>;
  return null; // rank within current list is the position, prev list is a different set
}

function RaceArrow({ rank, prevIds, playerId }) {
  if (!prevIds) return null;
  const prevRank = prevIds.indexOf(playerId);
  if (prevRank === -1) return <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)', marginLeft: 3 }}>new</span>;
  const diff = prevRank - rank; // positive = moved up
  if (diff > 0) return <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)', marginLeft: 3 }}>▲{diff}</span>;
  if (diff < 0) return <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-xs)', marginLeft: 3 }}>▼{Math.abs(diff)}</span>;
  return null;
}

function AwardRaceTable({ label, candidates, prevIds, openPlayer, openTeam }) {
  if (candidates.length === 0) return null;
  return (
    <div className="panel">
      <h2 style={{ marginBottom: 8 }}>{label}</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Player</th><th>Team</th><th className="num">PPG</th><th className="num">RPG</th><th className="num">APG</th></tr>
        </thead>
        <tbody>
          {candidates.map(({ p, team }, i) => (
            <tr key={p.id} style={team.id === (candidates[0]?.team?.id ?? '') ? {} : {}}>
              <td style={{ whiteSpace: 'nowrap' }}>
                {i + 1}
                <RaceArrow rank={i} prevIds={prevIds} playerId={p.id} />
              </td>
              <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
              <td><TeamBadge team={team} size="small" /> <TeamLink team={team} openTeam={openTeam}>{team.name}</TeamLink></td>
              <td className="num">{pg(p.stats, 'pts').toFixed(1)}</td>
              <td className="num">{pg(p.stats, 'reb').toFixed(1)}</td>
              <td className="num">{pg(p.stats, 'ast').toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AwardRaces({ league, openPlayer, openTeam }) {
  const races = liveAwardRaces(league);
  const prev = league.prevAwardRaces ?? {};
  const hasAny = Object.values(races).some((r) => r.length > 0);
  if (!hasAny) {
    return <p style={{ color: 'var(--muted)' }}>Award races will populate once enough games have been played.</p>;
  }
  return (
    <div className="grid2">
      {RACE_DEFS.map(({ key, label }) => (
        <AwardRaceTable
          key={key}
          label={label}
          candidates={races[key]}
          prevIds={prev[key] ?? null}
          openPlayer={openPlayer}
          openTeam={openTeam}
        />
      ))}
    </div>
  );
}

const LEADERS_TABS = [
  { key: 'races', label: 'Award Races' },
  { key: 'stats', label: 'Stat Leaders' },
];

export default function Leaders({ league, openPlayer, openTeam, openStats }) {
  const [tab, setTab] = useState('races');
  const minGp = leaderMinGp(league);
  return (
    <div>
      <Tabs tabs={LEADERS_TABS} activeTab={tab} onTabChange={setTab} />
      {tab === 'races' && (
        <AwardRaces league={league} openPlayer={openPlayer} openTeam={openTeam} />
      )}
      {tab === 'stats' && (
        <>
          <p style={{ color: 'var(--muted)', marginBottom: 12 }}>
            Per-game leaders, minimum {LEADER_MIN_GP} games played
            {minGp < LEADER_MIN_GP ? ` (scaled to ${minGp} this early in the season)` : ''}.
          </p>
          <div className="grid2">
            {LEADER_CATS.map(([key, label, unit]) => (
              <LeaderTable
                key={key}
                league={league}
                statKey={key}
                label={label}
                unit={unit}
                openPlayer={openPlayer}
                openTeam={openTeam}
                openStats={openStats}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
