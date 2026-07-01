import React, { useRef, useState } from 'react';
import { standings, computePowerRankings, playoffPicture } from '../engine/league.js';
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

// ── Power Rankings ───────────────────────────────────────────────────────────
function powerNarrative(rank, prevRank, recentWins, last10Games) {
  const form = last10Games > 0 ? `${recentWins}-${last10Games - recentWins} last ${last10Games}` : null;
  if (prevRank == null) return form ?? '';
  const diff = prevRank - rank;
  if (diff > 0) return `Rose ${diff} — ${form ?? ''}`;
  if (diff < 0) return `Fell ${Math.abs(diff)} — ${form ?? ''}`;
  return form ?? 'Holding steady';
}

function PowerRankings({ league, openTeam }) {
  const current = computePowerRankings(league);
  const prevOrder = league.prevPowerRankings ?? [];
  const prevRankMap = new Map(prevOrder.map((id, i) => [id, i + 1]));

  return (
    <Card noPad>
      <div style={{ padding: 'var(--sp-5) var(--sp-5) var(--sp-3)' }}>
        <span className="ui-section-title">Power Rankings</span>
        <span style={{ marginLeft: 'var(--sp-3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          Updated weekly · win%, recent form, roster strength
        </span>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table zebra">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>Team</th>
              <th className="num">W</th>
              <th className="num">L</th>
              <th className="num">Pct</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {current.map(({ teamId, rank, winPct, recentWins, last10Games }) => {
              const team = league.teams.find((t) => t.id === teamId);
              if (!team) return null;
              const prevRank = prevRankMap.get(teamId) ?? null;
              const diff = prevRank != null ? prevRank - rank : 0;
              const isUser = team.id === league.userTeamId;
              return (
                <tr key={teamId} style={isUser ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
                  <td style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>
                    {rank}
                    {diff > 0 && <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)', marginLeft: 2 }}> ▲{diff}</span>}
                    {diff < 0 && <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-xs)', marginLeft: 2 }}> ▼{Math.abs(diff)}</span>}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                      <TeamBadge team={team} size="small" />
                      <TeamLink team={team} openTeam={openTeam} />
                    </span>
                  </td>
                  <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{team.wins}</td>
                  <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{team.losses}</td>
                  <td className="num">{(team.wins + team.losses) ? winPct.toFixed(3) : '–'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    {powerNarrative(rank, prevRank, recentWins, last10Games)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Playoff Picture ──────────────────────────────────────────────────────────
const STATUS_LABEL = {
  clinched: 'Clinched',
  playoff: 'Playoff',
  'playin-clinched': 'Play-In',
  playin: 'Play-In',
  out: 'Out',
  eliminated: 'Eliminated',
};
const STATUS_VARIANT = {
  clinched: 'success',
  playoff: 'success',
  'playin-clinched': 'warning',
  playin: 'warning',
  out: 'danger',
  eliminated: 'danger',
};

function PlayoffPictureConf({ league, conf, openTeam }) {
  const rows = playoffPicture(league, conf);
  return (
    <div>
      <div style={{ padding: 'var(--sp-5) var(--sp-5) var(--sp-3)' }}>
        <span className="ui-section-title">{conf}ern Conference</span>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table zebra">
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th>Team</th>
              <th className="num">W</th>
              <th className="num">L</th>
              <th className="num">GB</th>
              <th>Status</th>
              <th className="num" style={{ whiteSpace: 'nowrap' }}>Magic #</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, seed, status, magicNumber, elimNumber }, i) => {
              const isUser = team.id === league.userTeamId;
              const leader = rows[0].team;
              const gb = ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2;
              const gbStr = gb <= 0 ? '–' : gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1);
              return (
                <React.Fragment key={team.id}>
                  {i === 6 && (
                    <tr className="standings-cutoff-row">
                      <td colSpan={7}><div className="standings-cutoff-line"><span className="standings-cutoff-label">Playoff Line</span></div></td>
                    </tr>
                  )}
                  {i === 10 && (
                    <tr className="standings-cutoff-row">
                      <td colSpan={7}><div className="standings-cutoff-line"><span className="standings-cutoff-label">Play-In Line</span></div></td>
                    </tr>
                  )}
                  <tr style={isUser ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
                    <td style={{ color: 'var(--text-muted)' }}>{seed}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                        <TeamBadge team={team} size="small" />
                        <TeamLink team={team} openTeam={openTeam} />
                      </span>
                    </td>
                    <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{team.wins}</td>
                    <td className="num" style={{ fontFamily: 'var(--font-tabular)', fontWeight: 'var(--weight-bold)' }}>{team.losses}</td>
                    <td className="num">{gbStr}</td>
                    <td>
                      <span className={`ui-badge ui-badge--${STATUS_VARIANT[status]}`} style={{ fontSize: 'var(--text-xs)' }}>
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="num" style={{ fontFamily: 'var(--font-tabular)', color: 'var(--text-muted)' }}>
                      {status === 'clinched' || status === 'playin-clinched' ? '✓' :
                       status === 'eliminated' ? '✕' :
                       magicNumber != null ? magicNumber :
                       elimNumber != null ? `E${elimNumber}` : '–'}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayoffPictureView({ league, openTeam }) {
  return (
    <Card noPad>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <PlayoffPictureConf league={league} conf="East" openTeam={openTeam} />
        <div style={{ borderLeft: '1px solid var(--border)' }}>
          <PlayoffPictureConf league={league} conf="West" openTeam={openTeam} />
        </div>
      </div>
      <div style={{ padding: 'var(--sp-3) var(--sp-5)', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
        Magic # = wins + opponent losses needed to clinch · E# = elimination number · ✓ = clinched · ✕ = eliminated
      </div>
    </Card>
  );
}

const VIEW_TABS = [
  { key: 'conference', label: 'Conference' },
  { key: 'league', label: 'League' },
  { key: 'picture', label: 'Playoff Picture' },
  { key: 'power', label: 'Power Rankings' },
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

  const tabs = league.phase === 'regular'
    ? VIEW_TABS
    : VIEW_TABS.filter((t) => t.key !== 'picture');

  return (
    <div>
      <Tabs tabs={tabs} activeTab={tab} onTabChange={setTab} />
      {tab === 'conference' && (
        <ConferenceView league={league} openTeam={openTeam} prevRanks={prevRanks} />
      )}
      {tab === 'league' && (
        <LeagueTable league={league} openTeam={openTeam} prevRanks={prevRanks?.League} />
      )}
      {tab === 'picture' && league.phase === 'regular' && (
        <PlayoffPictureView league={league} openTeam={openTeam} />
      )}
      {tab === 'power' && (
        <PowerRankings league={league} openTeam={openTeam} />
      )}
    </div>
  );
}
