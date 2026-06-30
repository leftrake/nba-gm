import React, { useState } from 'react';
import { scoutedOverall, isHidden } from '../engine/scouting.js';
import { overall, posLabel } from '../engine/players.js';
import { traitSortValue } from '../engine/devTraits.js';
import { POSITIONS } from '../engine/lineup.js';
import { Ovr, Pot, Origin, PlayerLink } from './PlayerDisplay.jsx';
import { TeamLink, TeamBadge } from './TeamDisplay.jsx';
import { money } from './formatters.js';
import { Section, SectionHeader, Button, Table } from './ui/index.js';

const FILTERS_KEY = 'nba-gm-players-filters';
const DEFAULT_FILTERS = { search: '', team: 'all', pos: 'all', minAge: '', maxAge: '', sortKey: 'ovr', sortDir: 'desc' };
const DEFAULT_SORT_DIR = { ovr: 'desc', pot: 'desc', age: 'desc', name: 'asc', team: 'asc' };

function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
    return saved ? { ...DEFAULT_FILTERS, ...saved } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function Players({ league, openPlayer, openTeam }) {
  const [filters, setFilters] = useState(loadFilters);

  const setFilter = (patch) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      try { localStorage.setItem(FILTERS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const all = [];
  for (const team of league.teams) {
    for (const p of team.roster) all.push({ p, team });
    for (const p of team.twoWay) all.push({ p, team });
  }
  for (const p of league.freeAgents) all.push({ p, team: null });

  const search = filters.search.trim().toLowerCase();
  const minAge = filters.minAge !== '' ? Number(filters.minAge) : -Infinity;
  const maxAge = filters.maxAge !== '' ? Number(filters.maxAge) : Infinity;
  const filtered = all.filter(({ p, team }) => {
    if (filters.team === 'fa' && team) return false;
    if (filters.team !== 'all' && filters.team !== 'fa' && team?.id !== filters.team) return false;
    if (filters.pos !== 'all' && p.pos !== filters.pos && p.pos2 !== filters.pos) return false;
    if (p.age < minAge || p.age > maxAge) return false;
    if (search && !p.name.toLowerCase().includes(search)) return false;
    return true;
  });

  const SORT_VALUE = {
    ovr: ({ p }) => {
      if (p.everOnUserTeam) return overall(p);
      const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
      if (isHidden(p, league.userTeamId, proGames, league.settings)) return -Infinity;
      return scoutedOverall(p, league.season, league.userTeamId, proGames, league.settings);
    },
    pot: ({ p }) => traitSortValue(p, league.season, league.userTeamId, league.scouting?.proWatching?.[p.id] ?? 0, true),
    age: ({ p }) => p.age,
  };
  const dirMul = filters.sortDir === 'asc' ? 1 : -1;
  let shown;
  if (filters.sortKey === 'name') {
    shown = [...filtered].sort((a, b) => a.p.name.localeCompare(b.p.name) * dirMul);
  } else if (filters.sortKey === 'team') {
    const label = (row) => row.team ? `${row.team.city} ${row.team.name}` : 'zzz Free Agent';
    shown = [...filtered].sort((a, b) => label(a).localeCompare(label(b)) * dirMul);
  } else {
    const sortValue = SORT_VALUE[filters.sortKey] || SORT_VALUE.ovr;
    shown = [...filtered].sort((a, b) => (sortValue(b) - sortValue(a)) * dirMul);
  }

  const handleSort = (key) => {
    if (filters.sortKey === key) {
      setFilter({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilter({ sortKey: key, sortDir: DEFAULT_SORT_DIR[key] || 'desc' });
    }
  };
  const arrow = (key) => filters.sortKey === key ? (filters.sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const cols = [
    { key: 'ovr', label: `Ovr${arrow('ovr')}`, numeric: true, sortable: true,
      render: (row) => <Ovr p={row._p} league={league} fogged={!row._p.everOnUserTeam} /> },
    { key: 'pot', label: `Pot${arrow('pot')}`, numeric: true, sortable: true,
      render: (row) => <Pot p={row._p} league={league} fogged={!row._p.everOnUserTeam} /> },
    { key: 'name', label: `Player${arrow('name')}`, sortable: true,
      render: (row) => <PlayerLink p={row._p} openPlayer={openPlayer} /> },
    { key: 'pos', label: 'Pos', render: (row) => posLabel(row._p) },
    { key: 'age', label: `Age${arrow('age')}`, numeric: true, sortable: true },
    { key: 'team', label: `Team${arrow('team')}`, sortable: true,
      render: (row) => row._team
        ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <TeamBadge team={row._team} size="small" />
            <TeamLink team={row._team} openTeam={openTeam}>{row._team.id}</TeamLink>
          </span>
        )
        : <span className="tag" style={{ color: 'var(--text-muted)' }}>FA</span> },
    { key: 'origin', label: 'From', render: (row) => <Origin p={row._p} /> },
    { key: 'contract', label: 'Contract', numeric: true,
      render: (row) => row._team && row._p.contract
        ? `${money(row._p.contract.salary)} × ${row._p.contract.years}yr`
        : '—' },
  ];
  const rows = shown.map(({ p, team }) => ({ _key: p.id, _p: p, _team: team, age: p.age }));

  const hasFilters = filters.search !== '' || filters.team !== 'all' || filters.pos !== 'all' || filters.minAge !== '' || filters.maxAge !== '';

  return (
    <div className="page-fade">
      <Section>
        <SectionHeader title="Players" subtitle="Every player in the league — your roster, opponents, and free agents." />

        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search by name…"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            style={{ width: 200 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Team</span>
            <select value={filters.team} onChange={(e) => setFilter({ team: e.target.value })}>
              <option value="all">All</option>
              <option value="fa">Free Agents</option>
              {[...league.teams].sort((a, b) => a.city.localeCompare(b.city)).map((t) => (
                <option key={t.id} value={t.id}>{t.city} {t.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Pos</span>
            <select value={filters.pos} onChange={(e) => setFilter({ pos: e.target.value })}>
              <option value="all">All</option>
              {POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Age</span>
            <input type="number" min={18} max={45} value={filters.minAge} placeholder="min"
                   onChange={(e) => setFilter({ minAge: e.target.value })} style={{ width: 56 }} />
            <span style={{ color: 'var(--text-muted)' }}>–</span>
            <input type="number" min={18} max={45} value={filters.maxAge} placeholder="max"
                   onChange={(e) => setFilter({ maxAge: e.target.value })} style={{ width: 56 }} />
          </label>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={() => setFilter({ search: '', team: 'all', pos: 'all', minAge: '', maxAge: '' })}>
              Clear Filters
            </Button>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginLeft: 'auto' }}>
            {filtered.length}{filtered.length !== all.length ? ` of ${all.length}` : ''} players
          </span>
        </div>

        <Table columns={cols} rows={rows} onSort={handleSort} zebra />
      </Section>
    </div>
  );
}
