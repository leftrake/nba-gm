import React, { useRef } from 'react';
import { standings } from '../engine/league.js';
import { TeamLink, TeamBadge } from './shared.jsx';

// Games back from the leader of the group: ((leadW - W) + (L - leadL)) / 2
function gamesBack(leader, t) {
  const gb = (leader.wins - t.wins + (t.losses - leader.losses)) / 2;
  return gb <= 0 ? '–' : gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1);
}

// Chronological W/L log for a team, read straight from the day-by-day
// results — works for any team, any point in the season.
function resultLog(league, teamId) {
  const out = [];
  for (const day of league.resultsByDay || []) {
    const r = day?.find((x) => x.home === teamId || x.away === teamId);
    if (!r) continue;
    out.push(r.home === teamId ? r.homePts > r.awayPts : r.awayPts > r.homePts);
  }
  return out;
}

// "7-3" over the last 10 games played.
function last10(log) {
  const last = log.slice(-10);
  if (last.length === 0) return '–';
  const wins = last.filter(Boolean).length;
  return `${wins}-${last.length - wins}`;
}

// "W3" / "L1" — the active streak at the end of the log.
function currentStreak(log) {
  if (log.length === 0) return '–';
  const kind = log[log.length - 1];
  let count = 0;
  for (let i = log.length - 1; i >= 0 && log[i] === kind; i--) count++;
  return `${kind ? 'W' : 'L'}${count}`;
}

// Rank-change arrow: green ▲ for moving up (lower index = better), red ▼
// for moving down, nothing if unranked before or unchanged.
function RankArrow({ prevRank, rank }) {
  if (prevRank == null || prevRank === rank) return null;
  return prevRank > rank
    ? <span style={{ color: 'var(--green)' }}> ▲{prevRank - rank}</span>
    : <span style={{ color: 'var(--red)' }}> ▼{rank - prevRank}</span>;
}

function ConfTable({ league, conf, openTeam, prevRanks }) {
  const rows = standings(league, conf);
  return (
    <div className="panel">
      <h2>{conf}ern Conference</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th><th className="num">GB</th><th className="num">L10</th><th className="num">Strk</th></tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const log = resultLog(league, t.id);
            return (
              <tr key={t.id} style={t.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
                <td>{i + 1}{i === 7 ? ' —' : ''}<RankArrow prevRank={prevRanks?.get(t.id)} rank={i} /></td>
                <td><TeamBadge team={t} size="small" /> <TeamLink team={t} openTeam={openTeam} /></td>
                <td className="num">{t.wins}</td>
                <td className="num">{t.losses}</td>
                <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
                <td className="num">{gamesBack(rows[0], t)}</td>
                <td className="num">{last10(log)}</td>
                <td className="num" style={{ color: currentStreak(log).startsWith('W') ? 'var(--green)' : currentStreak(log).startsWith('L') ? 'var(--red)' : undefined }}>
                  {currentStreak(log)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LeagueTable({ league, openTeam, prevRanks }) {
  const rows = standings(league);
  return (
    <div className="panel">
      <h2>League</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th>Conf</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th><th className="num">GB</th><th className="num">L10</th><th className="num">Strk</th></tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const log = resultLog(league, t.id);
            return (
              <tr key={t.id} style={t.id === league.userTeamId ? { background: 'var(--panel2)' } : {}}>
                <td>{i + 1}<RankArrow prevRank={prevRanks?.get(t.id)} rank={i} /></td>
                <td><TeamBadge team={t} size="small" /> <TeamLink team={t} openTeam={openTeam} /></td>
                <td>{t.conf}</td>
                <td className="num">{t.wins}</td>
                <td className="num">{t.losses}</td>
                <td className="num">{(t.wins + t.losses) ? (t.wins / (t.wins + t.losses)).toFixed(3) : '–'}</td>
                <td className="num">{gamesBack(rows[0], t)}</td>
                <td className="num">{last10(log)}</td>
                <td className="num" style={{ color: currentStreak(log).startsWith('W') ? 'var(--green)' : currentStreak(log).startsWith('L') ? 'var(--red)' : undefined }}>
                  {currentStreak(log)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// team id -> rank index (0-based) for a given set of standings rows.
function ranksFor(rows) {
  return new Map(rows.map((t, i) => [t.id, i]));
}

export default function Standings({ league, openTeam }) {
  const currentRanks = {
    East: ranksFor(standings(league, 'East')),
    West: ranksFor(standings(league, 'West')),
    League: ranksFor(standings(league)),
  };

  // Remember the ranks from the last time the day index changed, so arrows
  // reflect movement "since last sim" rather than resetting every render.
  const ranksRef = useRef({ dayIndex: league.dayIndex, ranks: currentRanks, prevRanks: null });
  if (ranksRef.current.dayIndex !== league.dayIndex) {
    ranksRef.current = { dayIndex: league.dayIndex, ranks: currentRanks, prevRanks: ranksRef.current.ranks };
  }
  const prevRanks = ranksRef.current.prevRanks;

  return (
    <div>
      <div className="grid2">
        <ConfTable league={league} conf="East" openTeam={openTeam} prevRanks={prevRanks?.East} />
        <ConfTable league={league} conf="West" openTeam={openTeam} prevRanks={prevRanks?.West} />
      </div>
      <LeagueTable league={league} openTeam={openTeam} prevRanks={prevRanks?.League} />
    </div>
  );
}
