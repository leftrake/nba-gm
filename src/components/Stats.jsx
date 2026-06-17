import React, { useState } from 'react';
import { leaderMinGp, LEADER_MIN_GP } from '../engine/awards.js';
import {
  perGame, fgPct, tpPct, ftPct, tsPct, possessions,
  teamStatTotals, pointsAllowed, allPlayerStatRows, leaderRows,
} from '../engine/stats.js';
import { PlayerLink, TeamLink } from './shared.jsx';
import { Card } from './ui/Card.jsx';
import { Tabs } from './ui/Tabs.jsx';

const PCT_COLS = new Set(['fgPct', 'tpPct', 'ftPct', 'tsPct']);

const PLAYER_COLS = [
  ['pts', 'PTS'], ['reb', 'REB'], ['oreb', 'OREB'], ['dreb', 'DREB'], ['ast', 'AST'],
  ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TOV'], ['pf', 'PF'], ['min', 'MIN'], ['pm', '+/-'],
  ['fgPct', 'FG%'], ['tpPct', '3P%'], ['ftPct', 'FT%'], ['tsPct', 'TS%'],
];

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
    return (r === 0 ? 0 : r).toFixed(1);
  }
  return (Math.round(v) || 0).toLocaleString();
}

function SortTh({ label, sortKey, sortState, onSort, className, icon }) {
  const [activeKey, dir] = sortState;
  const active = activeKey === sortKey;
  const cls = [className, 'sortable', active && 'sorted'].filter(Boolean).join(' ');
  return (
    <th className={cls} onClick={() => onSort(sortKey)}>
      {icon ? `${icon} ` : ''}{label}{active ? (dir === 'desc' ? ' ▾' : ' ▴') : ''}
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

function PlayerStatsTab({ league, openPlayer, openTeam }) {
  const [teamFilter, setTeamFilter] = useState('all');
  const [minGp, setMinGp] = useState(10);
  const [perGameMode, setPerGameMode] = useState(true);
  const [sortState, onSort] = useSort('pts');
  const [sortKey, sortDir] = sortState;

  let rows = allPlayerStatRows(league, Math.max(0, Number(minGp) || 0));
  if (teamFilter !== 'all') rows = rows.filter((r) => r.team.id === teamFilter);
  rows = [...rows].sort((a, b) => {
    const av = colValue(a.stats, sortKey, perGameMode);
    const bv = colValue(b.stats, sortKey, perGameMode);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  return (
    <Card noPad>
      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-3)', display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          Team:
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="all">All Teams</option>
            {[...league.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.city} {t.name}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          Min GP:
          <input type="number" min={0} style={{ width: 56 }} value={minGp}
            onChange={(e) => setMinGp(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          <button className={`ui-btn ui-btn--sm ${perGameMode ? 'ui-btn--primary' : 'ui-btn--secondary'}`} onClick={() => setPerGameMode(true)}>Per Game</button>
          <button className={`ui-btn ui-btn--sm ${!perGameMode ? 'ui-btn--primary' : 'ui-btn--secondary'}`} onClick={() => setPerGameMode(false)}>Totals</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', padding: 'var(--sp-8)', textAlign: 'center' }}>No players meet this filter yet.</p>
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table">
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
                <tr key={p.id} style={team.id === league.userTeamId ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
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
    </Card>
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
    <Card noPad>
      <div className="ui-table-wrap">
        <table className="ui-table">
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
              <tr key={r.team.id} style={r.team.id === league.userTeamId ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
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
    </Card>
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

function Podium({ rows, unit, openPlayer, openTeam, league }) {
  if (rows.length < 3) return null;
  const steps = ['first', 'second', 'third'];
  return (
    <div className="podium">
      {rows.slice(0, 3).map((r, i) => (
        <div className={`podium-step ${steps[i]}`} key={r.p.id} style={r.team.id === league.userTeamId ? { boxShadow: 'inset 0 0 0 1px var(--team-color-safe)' } : undefined}>
          <div className="podium-rank">{i + 1}</div>
          <div className="podium-value">{r.value.toFixed(1)}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{unit}</div>
          <div style={{ marginTop: 'var(--sp-2)' }}><PlayerLink p={r.p} openPlayer={openPlayer} /></div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}><TeamLink team={r.team} openTeam={openTeam}>{r.team.id}</TeamLink></div>
        </div>
      ))}
    </div>
  );
}

function LeagueLeadersTab({ league, openPlayer, openTeam }) {
  const minGp = leaderMinGp(league);
  return (
    <div>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)', fontSize: 'var(--text-sm)' }}>
        Minimum {LEADER_MIN_GP} games played
        {minGp < LEADER_MIN_GP ? ` (scaled to ${minGp} this early in the season)` : ''}.
      </p>
      <div className="grid2">
        {LEADER_CATS.map(([label, unit, valueFn, icon]) => {
          const rows = leaderRows(league, minGp, valueFn);
          return (
            <Card key={label} noPad>
              <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)' }}>
                <span className="ui-section-title">{icon} {label}</span>
              </div>
              {rows.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', padding: '0 var(--sp-4) var(--sp-4)' }}>No qualifying players yet.</p>
              ) : (
                <>
                  <div style={{ padding: '0 var(--sp-4)' }}>
                    <Podium rows={rows} unit={unit} openPlayer={openPlayer} openTeam={openTeam} league={league} />
                  </div>
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}>#</th>
                          <th>Player</th>
                          <th>Team</th>
                          <th className="num">{unit}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.p.id} style={r.team.id === league.userTeamId ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : {}}>
                            <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                            <td><PlayerLink p={r.p} openPlayer={openPlayer} /></td>
                            <td><TeamLink team={r.team} openTeam={openTeam}>{r.team.id}</TeamLink></td>
                            <td className="num">{r.value.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  { key: 'players', label: 'Player Stats' },
  { key: 'teams', label: 'Team Stats' },
  { key: 'leaders', label: 'League Leaders' },
];

export default function Stats({ league, openPlayer, openTeam }) {
  const [tab, setTab] = useState('players');
  return (
    <div>
      <Tabs tabs={TABS} activeTab={tab} onTabChange={setTab} />
      {tab === 'players' && <PlayerStatsTab league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'teams' && <TeamStatsTab league={league} openTeam={openTeam} />}
      {tab === 'leaders' && <LeagueLeadersTab league={league} openPlayer={openPlayer} openTeam={openTeam} />}
    </div>
  );
}
