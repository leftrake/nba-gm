import React, { useState } from 'react';
import { leaderMinGp, LEADER_MIN_GP } from '../engine/awards.js';
import {
  perGame, fgPct, tpPct, ftPct, tsPct, possessions,
  teamStatTotals, pointsAllowed, allPlayerStatRows, leaderRows,
} from '../engine/stats.js';
import { PlayerLink, TeamLink } from './shared.jsx';

const PCT_COLS = new Set(['fgPct', 'tpPct', 'ftPct', 'tsPct']);

const PLAYER_COLS = [
  ['pts', 'PTS'], ['reb', 'REB'], ['oreb', 'OREB'], ['dreb', 'DREB'], ['ast', 'AST'],
  ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TOV'], ['pf', 'PF'], ['min', 'MIN'], ['pm', '+/-'],
  ['fgPct', 'FG%'], ['tpPct', '3P%'], ['ftPct', 'FT%'], ['tsPct', 'TS%'],
];

// Sport-appropriate icons for stat column headers and leader categories.
const STAT_ICONS = {
  pts: '🏀', reb: '🔁', oreb: '🔁', dreb: '🔁', ast: '🤝', stl: '🥷', blk: '🚫',
  tov: '🔄', pf: '🟨', min: '⏱', pm: '⚖️', fgPct: '🎯', tpPct: '🏹', ftPct: '🆓', tsPct: '🔥',
};

function colValue(s, key, perGameMode) {
  if (key === 'fgPct') return fgPct(s) * 100;
  if (key === 'tpPct') return tpPct(s) * 100;
  if (key === 'ftPct') return ftPct(s) * 100;
  if (key === 'tsPct') return tsPct(s) * 100;
  return perGameMode ? perGame(s, key) : (s[key] || 0);
}

function fmtCol(v, key, perGameMode) {
  if (PCT_COLS.has(key) || perGameMode) {
    const r = Math.round(v * 10) / 10;
    // r === 0 also catches -0 (e.g. a team with net-zero +/-), which would
    // otherwise render as "-0.0".
    return (r === 0 ? 0 : r).toFixed(1);
  }
  return (Math.round(v) || 0).toLocaleString();
}

// Clickable column header: descending on first click, ascending on a
// second click of the same column. The active column is highlighted.
function SortTh({ label, sortKey, sortState, onSort, className, icon }) {
  const [activeKey, dir] = sortState;
  const active = activeKey === sortKey;
  return (
    <th className={className} onClick={() => onSort(sortKey)} style={{ cursor: 'pointer', color: active ? 'var(--team-color)' : undefined }}>
      {icon ? `${icon} ` : ''}{label}{active ? (dir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  );
}

function useSort(initialKey) {
  const [state, setState] = useState([initialKey, 'desc']);
  const onSort = (key) => {
    setState(([k, dir]) => (k === key ? [key, dir === 'desc' ? 'asc' : 'desc'] : [key, 'desc']));
  };
  return [state, onSort];
}

function PlayerStatsTab({ league, openPlayer, openTeam, initialSort }) {
  const [teamFilter, setTeamFilter] = useState('all');
  const [minGp, setMinGp] = useState(10);
  const [perGameMode, setPerGameMode] = useState(true);
  const [sortState, onSort] = useSort(initialSort || 'pts');
  const [sortKey, sortDir] = sortState;

  let rows = allPlayerStatRows(league, Math.max(0, Number(minGp) || 0));
  if (teamFilter !== 'all') rows = rows.filter((r) => r.team.id === teamFilter);
  rows = [...rows].sort((a, b) => {
    const av = colValue(a.stats, sortKey, perGameMode);
    const bv = colValue(b.stats, sortKey, perGameMode);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  return (
    <div className="panel">
      <div className="controls" style={{ marginBottom: 12 }}>
        <label>
          Team:{' '}
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="all">All Teams</option>
            {[...league.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.city} {t.name}</option>
            ))}
          </select>
        </label>
        <label>
          Min GP:{' '}
          <input type="number" min={0} style={{ width: 56 }} value={minGp}
            onChange={(e) => setMinGp(e.target.value)} />
        </label>
        <button className={`btn small ${perGameMode ? '' : 'secondary'}`} onClick={() => setPerGameMode(true)}>Per Game</button>
        <button className={`btn small ${!perGameMode ? '' : 'secondary'}`} onClick={() => setPerGameMode(false)}>Totals</button>
      </div>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No players meet this filter yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Player</th><th>Team</th><th className="num">GP</th>
                {PLAYER_COLS.map(([key, label]) => (
                  <SortTh key={key} label={label} sortKey={key} sortState={sortState} onSort={onSort} className="num" icon={STAT_ICONS[key]} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, team, stats }) => (
                <tr key={p.id} style={team.id === league.userTeamId ? { background: 'var(--panel2)', boxShadow: 'inset 3px 0 0 var(--team-color)' } : {}}>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  <td><TeamLink team={team} openTeam={openTeam}>{team.id}</TeamLink></td>
                  <td className="num">{stats.gp}</td>
                  {PLAYER_COLS.map(([key]) => (
                    <td className="num" key={key}>{fmtCol(colValue(stats, key, perGameMode), key, perGameMode)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TEAM_COLS = [
  ['ppg', 'PPG'], ['pace', 'PACE'], ['ortg', 'ORTG'], ['drtg', 'DRTG'], ['astTov', 'AST/TOV'],
];

function TeamStatsTab({ league, openTeam }) {
  const [sortState, onSort] = useSort('ppg');
  const [sortKey, sortDir] = sortState;

  const rows = league.teams.map((team) => {
    const totals = teamStatTotals(team);
    const gp = totals.gp || 1;
    const poss = possessions(totals);
    const allowed = pointsAllowed(league, team.id);
    return {
      team,
      gp: totals.gp,
      ppg: totals.pts / gp,
      pace: poss / gp,
      ortg: poss ? (totals.pts / poss) * 100 : 0,
      drtg: poss ? (allowed / poss) * 100 : 0,
      astTov: totals.tov ? totals.ast / totals.tov : 0,
    };
  });
  const sorted = [...rows].sort((a, b) => sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]);

  return (
    <div className="panel">
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Team</th><th className="num">GP</th>
              {TEAM_COLS.map(([key, label]) => (
                <SortTh key={key} label={label} sortKey={key} sortState={sortState} onSort={onSort} className="num" />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team.id} style={r.team.id === league.userTeamId ? { background: 'var(--panel2)', boxShadow: 'inset 3px 0 0 var(--team-color)' } : {}}>
                <td><TeamLink team={r.team} openTeam={openTeam} /></td>
                <td className="num">{r.gp}</td>
                <td className="num">{r.ppg.toFixed(1)}</td>
                <td className="num">{r.pace.toFixed(1)}</td>
                <td className="num">{r.ortg.toFixed(1)}</td>
                <td className="num">{r.drtg.toFixed(1)}</td>
                <td className="num">{r.astTov.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LEADER_CATS = [
  ['Points', 'PPG', (s) => perGame(s, 'pts'), STAT_ICONS.pts],
  ['Rebounds', 'RPG', (s) => perGame(s, 'reb'), STAT_ICONS.reb],
  ['Assists', 'APG', (s) => perGame(s, 'ast'), STAT_ICONS.ast],
  ['Steals', 'SPG', (s) => perGame(s, 'stl'), STAT_ICONS.stl],
  ['Blocks', 'BPG', (s) => perGame(s, 'blk'), STAT_ICONS.blk],
  ['Field Goal %', 'FG%', (s) => fgPct(s) * 100, STAT_ICONS.fgPct],
  ['3-Point %', '3P%', (s) => tpPct(s) * 100, STAT_ICONS.tpPct],
  ['True Shooting %', 'TS%', (s) => tsPct(s) * 100, STAT_ICONS.tsPct],
];

// Top-3 podium for a leader category: gold/silver/bronze steps with the
// first-place player raised in the center.
function Podium({ rows, unit, openPlayer, openTeam, league }) {
  if (rows.length < 3) return null;
  const steps = ['first', 'second', 'third'];
  return (
    <div className="podium">
      {rows.slice(0, 3).map((r, i) => (
        <div className={`podium-step ${steps[i]}`} key={r.p.id} style={r.team.id === league.userTeamId ? { boxShadow: 'inset 0 0 0 1px var(--team-color)' } : undefined}>
          <div className="podium-rank">{i + 1}</div>
          <div className="podium-value">{r.value.toFixed(1)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{unit}</div>
          <div style={{ marginTop: 6 }}><PlayerLink p={r.p} openPlayer={openPlayer} /></div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}><TeamLink team={r.team} openTeam={openTeam}>{r.team.id}</TeamLink></div>
        </div>
      ))}
    </div>
  );
}

function LeagueLeadersTab({ league, openPlayer, openTeam }) {
  const minGp = leaderMinGp(league);
  return (
    <div>
      <p style={{ color: 'var(--muted)', marginBottom: 12 }}>
        Minimum {LEADER_MIN_GP} games played
        {minGp < LEADER_MIN_GP ? ` (scaled to ${minGp} this early in the season)` : ''}.
      </p>
      <div className="grid2">
        {LEADER_CATS.map(([label, unit, valueFn, icon]) => {
          const rows = leaderRows(league, minGp, valueFn);
          return (
            <div className="panel" key={label}>
              <h2>{icon} {label}</h2>
              {rows.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No qualifying players yet.</p>
              ) : (
                <>
                  <Podium rows={rows} unit={unit} openPlayer={openPlayer} openTeam={openTeam} league={league} />
                  <table>
                    <thead>
                      <tr><th>#</th><th>Player</th><th>Team</th><th className="num">{unit}</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.p.id} style={r.team.id === league.userTeamId ? { background: 'var(--panel2)', boxShadow: 'inset 3px 0 0 var(--team-color)' } : {}}>
                          <td>{i + 1}</td>
                          <td><PlayerLink p={r.p} openPlayer={openPlayer} /></td>
                          <td><TeamLink team={r.team} openTeam={openTeam}>{r.team.id}</TeamLink></td>
                          <td className="num">{r.value.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  ['players', 'Player Stats'],
  ['teams', 'Team Stats'],
  ['leaders', 'League Leaders'],
];

export default function Stats({ league, openPlayer, openTeam, initialSort }) {
  const [tab, setTab] = useState('players');
  return (
    <div>
      <div className="controls" style={{ marginBottom: 12 }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={`btn small ${tab === key ? '' : 'secondary'}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'players' && <PlayerStatsTab league={league} openPlayer={openPlayer} openTeam={openTeam} initialSort={initialSort} />}
      {tab === 'teams' && <TeamStatsTab league={league} openTeam={openTeam} />}
      {tab === 'leaders' && <LeagueLeadersTab league={league} openPlayer={openPlayer} openTeam={openTeam} />}
    </div>
  );
}
