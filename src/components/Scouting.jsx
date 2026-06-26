import React, { useState } from 'react';
import { scoutedOverall, scoutUncertainty, isHidden, fogColor, getDraftPoints } from '../engine/scouting.js';
import {
  workoutProspect, gameWatchProspect, sweepRegion, poachIntel, domesticSweep, domesticSweepAvailable,
  markProWatch, removeProWatch,
  hireScout, fireScout, getScouts,
  isDiscovered,
  DRAFT_POINTS_MAX, PRO_SCOUT_GAMES_FULL, PRO_WATCH_SLOTS,
  SWEEP_COSTS, WORKOUT_COSTS, GAME_WATCH_COSTS, POACH_COST, DOMESTIC_SWEEP_COST, DOMESTIC_SWEEP_COOLDOWN_YEARS,
  SCOUT_TYPES, MAX_SCOUTS,
  totalScoutSalary, scoutingBudget,
} from '../engine/scoutingTrips.js';
import { regionFor, SCOUT_REGIONS } from '../engine/backstory.js';
import { Ovr, Pot, PlayerLink, Origin, GuideTooltip } from './shared.jsx';
import { Card, Button, Badge, Section, SectionHeader, Divider, Tabs, ProgressBar, Table, Stat } from './ui/index.js';

const INTL_REGIONS = SCOUT_REGIONS.filter((r) => r !== 'Domestic');

function dollars(n) {
  return n >= 1_000_000 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;
}

function FogDot({ u }) {
  return (
    <span
      title={`Scouting uncertainty ±${u}`}
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: fogColor(u), verticalAlign: 'middle', marginLeft: 3, flexShrink: 0,
      }}
    />
  );
}

// ---- Draft Board tab ----

function LockedRegionRow({ region, count, budget, league, userId, scouts, colCount, commit }) {
  const cost = SWEEP_COSTS[region];
  const hasRegionalScout = scouts.some((s) => s.type === 'regional' && s.region === region);
  const doSweep = () => {
    const res = sweepRegion(league, userId, region);
    if (res.ok) commit();
    else alert(res.error);
  };
  return (
    <tr style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
      <td colSpan={colCount - 1}>
        🔒 {count} undiscovered prospect{count !== 1 ? 's' : ''} in {region}
      </td>
      <td>
        {hasRegionalScout
          ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Regional scout covers this</span>
          : (
            <Button
              size="sm" variant="secondary"
              disabled={budget < cost}
              onClick={doSweep}
              title={`One-time sweep — discover all ${region} prospects in every class`}
            >
              Sweep ({dollars(cost)})
            </Button>
          )
        }
      </td>
    </tr>
  );
}

function ProspectRow({ p, league, budget, userId, hasBigBoard, hasSleeper, sleeperIds, bigBoardIds, commit }) {
  const region = regionFor(p);
  const wkCost = WORKOUT_COSTS[region] ?? WORKOUT_COSTS.Domestic;
  const gwCost = GAME_WATCH_COSTS[region] ?? GAME_WATCH_COSTS.Domestic;
  const pts = getDraftPoints(p, userId);
  const full = pts >= DRAFT_POINTS_MAX;
  const isSleeper = hasSleeper && sleeperIds.includes(p.id);
  const bbRank = hasBigBoard ? bigBoardIds.indexOf(p.id) : -1;
  const hidden = isHidden(p, userId, 0, league.settings);
  const pct = Math.min(100, Math.round((pts / DRAFT_POINTS_MAX) * 100));

  const doMission = (fn) => {
    const res = fn(league, userId, p.id);
    if (res.ok) commit();
    else alert(res.error);
  };

  return (
    <tr>
      {hasBigBoard && (
        <td className="num" style={{ color: 'var(--text-muted)' }}>
          {bbRank >= 0 ? `#${bbRank + 1}` : '–'}
        </td>
      )}
      <td>
        <Ovr p={p} league={league} fogged />
        {isSleeper && (
          <span title="Sleeper pick — high upside, lightly scouted" style={{ marginLeft: 4, color: 'var(--color-warning)' }}>★</span>
        )}
      </td>
      <td><Pot p={p} league={league} fogged /></td>
      <td><PlayerLink p={p} /></td>
      <td>{p.pos}</td>
      <td className="num">{p.age}</td>
      <td><Origin p={p} /></td>
      <td>{region}</td>
      <td>
        {hidden ? (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 80 }}
               title={`${pts} of ${DRAFT_POINTS_MAX} scouting points`}>
            <div style={{ width: 48, flexShrink: 0 }}>
              <ProgressBar value={pct} variant={full ? 'success' : 'primary'} size="sm" />
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
              {pts}/{DRAFT_POINTS_MAX}
            </span>
          </div>
        )}
      </td>
      <td>
        {full ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Full read</span>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
            <Button size="sm" variant="primary" disabled={budget < wkCost}
                    onClick={() => doMission(workoutProspect)}
                    title="Individual workout — +60 scouting points">
              Workout ({dollars(wkCost)})
            </Button>
            <Button size="sm" variant="secondary" disabled={budget < gwCost}
                    onClick={() => doMission(gameWatchProspect)}
                    title="Game watch — +25 scouting points">
              Watch ({dollars(gwCost)})
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function DraftClassSection({ dc, label, league, budget, userId, scouts, commit }) {
  const hasBigBoard = scouts.some((s) => s.type === 'bigBoard');
  const hasSleeper = scouts.some((s) => s.type === 'sleeper');
  const sleeperIds = hasSleeper ? (league.scouting?.sleeperPicks?.[userId] ?? []) : [];
  const bigBoardIds = hasBigBoard ? (league.scouting?.bigBoardRanks?.[userId] ?? []) : [];

  const discovered = dc.prospects.filter((p) => isDiscovered(p, userId, league));
  const draftSortOvr = (p) => (isHidden(p, userId, 0, league.settings) ? -Infinity : scoutedOverall(p, league.season, userId, 0, league.settings));
  const sorted = [...discovered].sort((a, b) => draftSortOvr(b) - draftSortOvr(a));

  const undiscoveredByRegion = {};
  for (const p of dc.prospects) {
    if (!isDiscovered(p, userId, league)) {
      const r = regionFor(p);
      undiscoveredByRegion[r] = (undiscoveredByRegion[r] ?? 0) + 1;
    }
  }

  // +1 for bigBoard rank column
  const colCount = 9 + (hasBigBoard ? 1 : 0);

  return (
    <Section title={label} spacing="sm">
      <div className="ui-table-wrap">
        <table className="ui-table zebra">
          <thead>
            <tr>
              {hasBigBoard && <th title="Big Board Analyst rank">#</th>}
              <th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th>
              <th className="num">Age</th><th>From</th><th>Region</th>
              <th>Scout</th><th>Missions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <ProspectRow
                key={p.id}
                p={p}
                league={league}
                budget={budget}
                userId={userId}
                hasBigBoard={hasBigBoard}
                hasSleeper={hasSleeper}
                sleeperIds={sleeperIds}
                bigBoardIds={bigBoardIds}
                commit={commit}
              />
            ))}
            {Object.entries(undiscoveredByRegion).map(([region, count]) => (
              <LockedRegionRow
                key={region}
                region={region}
                count={count}
                budget={budget}
                league={league}
                userId={userId}
                scouts={scouts}
                colCount={colCount}
                commit={commit}
              />
            ))}
            {discovered.length === 0 && Object.keys(undiscoveredByRegion).length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--sp-8)' }}>
                  No prospects in this class yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function DraftBoardTab({ league, commit }) {
  const s = league.scouting;
  const userId = league.userTeamId;
  const budget = s.budgets[userId] ?? 0;
  const reports = s.reports[userId] ?? [];
  const scouts = getScouts(league, userId);

  const doPoach = () => {
    const res = poachIntel(league, userId);
    if (res.ok) commit();
    else alert(res.error);
  };

  const domesticSweepOnCooldown = !domesticSweepAvailable(league, userId);
  const domesticSweepReadySeason = (s.domesticSweepUsed?.[userId] ?? -Infinity) + DOMESTIC_SWEEP_COOLDOWN_YEARS;
  const doDomesticSweep = () => {
    const res = domesticSweep(league, userId);
    if (res.ok) commit();
    else alert(res.error);
  };

  const currentClass = s.prospects?.length
    ? [{ draftSeason: league.season, prospects: s.prospects, label: `Draft Class ${league.season} (current)` }]
    : [];
  const boardClasses = (s.draftBoard ?? []).map((dc) => {
    const yearsOut = dc.draftSeason - league.season;
    return { ...dc, label: `Draft Class ${dc.draftSeason} (${yearsOut} year${yearsOut === 1 ? '' : 's'} away)` };
  });
  const allClasses = [...currentClass, ...boardClasses];

  return (
    <>
      <GuideTooltip
        tipKey="scouting_draft_board"
        text="Your annual scouting budget funds missions on future draft classes. Workouts give a big reveal (+60 pts); game watches are cheaper (+25 pts). International prospects must be discovered before you can scout them — hire a regional scout or run a one-time sweep. You also get a Domestic Sweep that gives every domestic prospect a flat scouting bump for a flat fee, reusable every 2 years once a new class comes around. The board spans 3 years so you can start building your board years in advance."
        block
      >
        <SectionHeader
          title="Draft Board"
          subtitle={<>Budget: <b>{dollars(budget)}</b></>}
          action={
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button
                size="sm" variant="secondary"
                disabled={domesticSweepOnCooldown || budget < DOMESTIC_SWEEP_COST}
                onClick={doDomesticSweep}
                title={domesticSweepOnCooldown
                  ? `On cooldown — available again in ${domesticSweepReadySeason}`
                  : `Gives every domestic prospect ${dollars(DOMESTIC_SWEEP_COST)} worth of scouting in one pass — reusable every ${DOMESTIC_SWEEP_COOLDOWN_YEARS} years`}
              >
                {domesticSweepOnCooldown ? `Domestic Sweep (cooldown)` : `Domestic Sweep (${dollars(DOMESTIC_SWEEP_COST)})`}
              </Button>
              <Button
                size="sm" variant="secondary"
                disabled={budget < POACH_COST}
                onClick={doPoach}
                title="Reveals which prospects 2 other teams have been scouting this offseason"
              >
                Poach Intel ({dollars(POACH_COST)})
              </Button>
            </div>
          }
        />
      </GuideTooltip>

      {allClasses.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-4)' }}>
          No upcoming draft classes loaded yet. The board populates at league start.
        </p>
      ) : (
        allClasses.map((dc) => (
          <DraftClassSection
            key={dc.draftSeason}
            dc={dc}
            label={dc.label}
            league={league}
            budget={budget}
            userId={userId}
            scouts={scouts}
            commit={commit}
          />
        ))
      )}

      {reports.length > 0 && (
        <>
          <Divider />
          <Section title="Scout Reports" spacing="sm">
            {reports.map((r, i) => (
              <p key={i} style={{ marginBottom: 'var(--sp-2)', color: 'var(--text-muted)' }}>{r.text}</p>
            ))}
          </Section>
        </>
      )}
    </>
  );
}

// ---- Pro Scouting tab ----

function findLeaguePlayer(league, playerId) {
  for (const t of league.teams) {
    const p = t.roster.find((x) => x.id === playerId);
    if (p) return { p, team: t };
  }
  const p = league.freeAgents.find((x) => x.id === playerId);
  return p ? { p, team: null } : null;
}

function searchLeaguePlayers(league, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const userId = league.userTeamId;
  const out = [];
  for (const team of league.teams) {
    if (team.id === userId) continue;
    for (const p of team.roster) {
      if (p.name.toLowerCase().includes(q)) out.push({ p, teamLabel: `${team.city} ${team.name}` });
    }
  }
  for (const p of league.freeAgents) {
    if (p.name.toLowerCase().includes(q)) out.push({ p, teamLabel: 'Free Agent' });
  }
  return out.slice(0, 25);
}

function ProScoutingTab({ league, commit, openPlayer }) {
  const s = league.scouting;
  const [query, setQuery] = useState('');
  const userId = league.userTeamId;

  const watchList = s.proWatchList ?? [];
  const proWatching = s.proWatching ?? {};
  const proReports = s.proReports ?? [];
  const matches = searchLeaguePlayers(league, query);
  const slotsUsed = watchList.length;

  const toggleWatch = (playerId) => {
    const res = watchList.includes(playerId)
      ? removeProWatch(league, playerId)
      : markProWatch(league, playerId);
    if (res.ok) commit();
    else alert(res.error);
  };

  const watchCols = [
    { key: 'ovr', label: 'Ovr', render: (row) => <Ovr p={row._p} league={league} fogged /> },
    { key: 'name', label: 'Player', render: (row) => <PlayerLink p={row._p} openPlayer={openPlayer} /> },
    { key: 'team', label: 'Team' },
    { key: 'film', label: 'Film', render: (row) => {
      const pct = Math.min(100, Math.round((row._games / PRO_SCOUT_GAMES_FULL) * 100));
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 90 }}>
          <div style={{ width: 52, flexShrink: 0 }}>
            <ProgressBar value={pct} variant={pct >= 100 ? 'success' : 'primary'} size="sm" />
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
            {row._games}/{PRO_SCOUT_GAMES_FULL}
          </span>
        </div>
      );
    }},
    { key: 'fog', label: 'Fog', render: (row) => {
      const u = row._u;
      return u === null
        ? <span style={{ color: 'var(--text-muted)' }} title="No read yet">?</span>
        : <FogDot u={u} />;
    }},
    { key: 'action', label: '', render: (row) => (
      <Button size="sm" variant="ghost" onClick={() => toggleWatch(row._key)}>Stop Watching</Button>
    )},
  ];

  const watchRows = watchList.map((id) => {
    const found = findLeaguePlayer(league, id);
    if (!found) return null;
    const { p, team } = found;
    const games = proWatching[id] ?? 0;
    const u = isHidden(p, userId, games, league.settings) ? null : scoutUncertainty(p, userId, games, league.settings);
    return {
      _key: id,
      _p: p,
      _games: games,
      _u: u,
      team: team ? `${team.city} ${team.name}` : 'Free Agent',
    };
  }).filter(Boolean);

  const searchCols = [
    { key: 'ovr', label: 'Ovr', render: (row) => <Ovr p={row._p} league={league} fogged /> },
    { key: 'pot', label: 'Pot', render: (row) => <Pot p={row._p} league={league} fogged /> },
    { key: 'name', label: 'Player', render: (row) => <PlayerLink p={row._p} openPlayer={openPlayer} /> },
    { key: 'team', label: 'Team' },
    { key: 'pos', label: 'Pos' },
    { key: 'age', label: 'Age', numeric: true },
    { key: 'action', label: '', render: (row) => {
      const isWatching = watchList.includes(row._p.id);
      return (
        <Button
          size="sm"
          variant={isWatching ? 'secondary' : 'primary'}
          disabled={!isWatching && slotsUsed >= PRO_WATCH_SLOTS}
          title={!isWatching && slotsUsed >= PRO_WATCH_SLOTS ? `Watch list full (${PRO_WATCH_SLOTS} slots)` : undefined}
          onClick={() => toggleWatch(row._p.id)}
        >
          {isWatching ? 'Watching ✓' : 'Watch'}
        </Button>
      );
    }},
  ];

  const searchRows = matches.map(({ p, teamLabel }) => ({
    _key: p.id,
    _p: p,
    team: teamLabel,
    pos: p.pos,
    age: p.age,
  }));

  return (
    <>
      <GuideTooltip
        tipKey="scouting_pro"
        text="Mark players as watched from here or from their player card. Each simmed game-day accumulates film — after 20 game-days your read reaches maximum tightness. Fog resets each offseason as players develop, but your watch list carries over. Rookies who were scouted pre-draft start with a head start based on their draft scouting points."
        block
      >
        <SectionHeader
          title="Pro Scouting"
          subtitle={
            <span>
              Watch slots: <b style={{ color: slotsUsed >= PRO_WATCH_SLOTS ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                {slotsUsed}/{PRO_WATCH_SLOTS} used
              </b>
            </span>
          }
        />
      </GuideTooltip>

      {watchList.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>
          No players on your watch list. Search below to add trade targets or free agents to track.
        </p>
      ) : (
        <>
          <Table columns={watchCols} rows={watchRows} zebra />
          <Divider />
        </>
      )}

      <Section title="Add Players to Watch" subtitle="Search any other team's roster or free agents to track for trades or free agency.">
        <input
          type="text"
          placeholder="Search by player name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 'var(--sp-3)', maxWidth: 280 }}
        />
        {query.trim().length >= 2 && (
          matches.length === 0
            ? <p style={{ color: 'var(--text-muted)' }}>No matching players found.</p>
            : <Table columns={searchCols} rows={searchRows} zebra />
        )}
      </Section>

      {proReports.length > 0 && (
        <>
          <Divider />
          <Section title="Pro Scout Reports" spacing="sm">
            {proReports.map((r, i) => (
              <p key={i} style={{ marginBottom: 'var(--sp-2)', color: 'var(--text-muted)' }}>{r.text}</p>
            ))}
          </Section>
        </>
      )}
    </>
  );
}

// ---- Staff tab ----

const RANGE_LABELS = { lottery: 'Lottery (Top 14)', secondRound: '2nd Round' };

function StaffTab({ league, commit }) {
  const userId = league.userTeamId;
  const s = league.scouting;
  const scouts = getScouts(league, userId);
  const userTeam = league.teams.find((t) => t.id === userId);
  const annual = scoutingBudget(userTeam);
  const salary = totalScoutSalary(scouts);
  const budget = s?.budgets[userId] ?? 0;
  const canHire = league.phase?.startsWith('offseason');
  const overBudget = salary > annual;

  const doHire = (type, qualifier = null) => {
    const res = hireScout(league, userId, type, qualifier);
    if (res.ok) commit();
    else alert(res.error);
  };

  const doFire = (sc) => {
    const res = fireScout(league, userId, sc.type, sc.region ?? sc.range ?? null);
    if (res.ok) commit();
    else alert(res.error);
  };

  const staffCols = [
    { key: 'type', label: 'Scout Type', render: (row) => SCOUT_TYPES[row._sc.type]?.label ?? row._sc.type },
    { key: 'specialty', label: 'Specialty', render: (row) => (
      <span style={{ color: 'var(--text-muted)' }}>
        {row._sc.region ?? (row._sc.range ? RANGE_LABELS[row._sc.range] : '—')}
      </span>
    )},
    { key: 'salary', label: 'Salary', numeric: true, render: (row) => dollars(row._sc.salary) },
    { key: 'action', label: '', render: (row) => (
      <Button size="sm" variant="ghost" disabled={!canHire} onClick={() => doFire(row._sc)}>Release</Button>
    )},
  ];
  const staffRows = scouts.map((sc, i) => ({ _key: i, _sc: sc }));

  return (
    <>
      <SectionHeader title="Scout Staff" />

      <Card style={{ display: 'flex', gap: 'var(--sp-8)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
        <Stat value={dollars(annual)} label="Annual Budget" size="sm" />
        <Stat value={dollars(salary)} label="Scout Salaries" size="sm" color={overBudget ? 'var(--color-danger)' : undefined} />
        <Stat value={dollars(budget)} label="Available (Missions)" size="sm" />
        <Stat value={`${scouts.length}/${MAX_SCOUTS}`} label="Scouts on Staff" size="sm" />
      </Card>

      {overBudget && (
        <Card style={{ borderLeft: '3px solid var(--color-danger)', marginBottom: 'var(--sp-4)', color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>
          Scout salaries exceed this season's budget — consider releasing a scout.
        </Card>
      )}

      {!canHire && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)' }}>
          Scout hiring and releasing is only available during the offseason.
        </p>
      )}

      {scouts.length > 0 ? (
        <>
          <Table columns={staffCols} rows={staffRows} zebra />
          <Divider />
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>No scouts on staff.</p>
      )}

      {scouts.length < MAX_SCOUTS && (
        <Section title="Hire Scouts">
          {/* Regional scouts */}
          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <div style={{ marginBottom: 'var(--sp-2)' }}>
              <b>Regional Scout</b>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>
                {dollars(SCOUT_TYPES.regional.salary)}/yr — auto-discovers all prospects in a region each offseason
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {INTL_REGIONS.map((region) => {
                const has = scouts.some((sc) => sc.type === 'regional' && sc.region === region);
                const wouldExceed = !has && salary + SCOUT_TYPES.regional.salary > annual;
                return (
                  <Button
                    key={region}
                    size="sm"
                    variant={has ? 'secondary' : 'ghost'}
                    disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                    title={has ? `Already have a ${region} scout` : wouldExceed ? 'Salary would exceed budget' : `Hire a regional scout for ${region}`}
                    onClick={() => doHire('regional', region)}
                  >
                    {region}{has ? ' ✓' : ''}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Sleeper finder */}
          {(() => {
            const has = scouts.some((sc) => sc.type === 'sleeper');
            const wouldExceed = !has && salary + SCOUT_TYPES.sleeper.salary > annual;
            return (
              <div style={{ marginBottom: 'var(--sp-3)' }}>
                <Button
                  size="sm"
                  variant={has ? 'secondary' : 'ghost'}
                  disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                  title={wouldExceed ? 'Salary would exceed budget' : undefined}
                  onClick={() => doHire('sleeper')}
                >
                  {has ? 'Sleeper Finder ✓' : `Hire Sleeper Finder (${dollars(SCOUT_TYPES.sleeper.salary)}/yr)`}
                </Button>
                {' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  flags 3–5 high-upside, under-scouted prospects each offseason
                </span>
              </div>
            );
          })()}

          {/* Big board analyst */}
          {(() => {
            const has = scouts.some((sc) => sc.type === 'bigBoard');
            const wouldExceed = !has && salary + SCOUT_TYPES.bigBoard.salary > annual;
            return (
              <div style={{ marginBottom: 'var(--sp-3)' }}>
                <Button
                  size="sm"
                  variant={has ? 'secondary' : 'ghost'}
                  disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                  title={wouldExceed ? 'Salary would exceed budget' : undefined}
                  onClick={() => doHire('bigBoard')}
                >
                  {has ? 'Big Board Analyst ✓' : `Hire Big Board Analyst (${dollars(SCOUT_TYPES.bigBoard.salary)}/yr)`}
                </Button>
                {' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  generates a top-20 ranked list weighted by positional need
                </span>
              </div>
            );
          })()}

          {/* Range specialists */}
          <div style={{ marginBottom: 'var(--sp-3)' }}>
            <div style={{ marginBottom: 'var(--sp-2)' }}>
              <b>Draft Range Specialist</b>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>
                {dollars(SCOUT_TYPES.rangeSpecialist.salary)}/yr — +10 baseline points to prospects in their range
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {[['lottery', 'Lottery (Top 14)'], ['secondRound', '2nd Round']].map(([range, label]) => {
                const has = scouts.some((sc) => sc.type === 'rangeSpecialist' && sc.range === range);
                const wouldExceed = !has && salary + SCOUT_TYPES.rangeSpecialist.salary > annual;
                return (
                  <Button
                    key={range}
                    size="sm"
                    variant={has ? 'secondary' : 'ghost'}
                    disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                    title={has ? 'Already have this specialist' : wouldExceed ? 'Salary would exceed budget' : undefined}
                    onClick={() => doHire('rangeSpecialist', range)}
                  >
                    {label}{has ? ' ✓' : ''}
                  </Button>
                );
              })}
            </div>
          </div>
        </Section>
      )}
    </>
  );
}

// ---- Main component ----

export default function Scouting({ league, commit, openPlayer }) {
  const [tab, setTab] = useState('draft');
  const watchCount = league.scouting?.proWatchList?.length ?? 0;
  const scouts = getScouts(league, league.userTeamId);

  const tabs = [
    { key: 'draft', label: 'Draft Board' },
    {
      key: 'pro',
      label: (
        <>
          Pro Scouting
          {watchCount > 0 && <Badge variant="default" style={{ marginLeft: 'var(--sp-1)' }}>{watchCount}</Badge>}
        </>
      ),
    },
    {
      key: 'staff',
      label: (
        <>
          Staff
          {scouts.length > 0 && <Badge variant="default" style={{ marginLeft: 'var(--sp-1)' }}>{scouts.length}</Badge>}
        </>
      ),
    },
  ];

  return (
    <div className="page-fade">
      <Tabs tabs={tabs} activeTab={tab} onTabChange={setTab} />
      {tab === 'draft' && <DraftBoardTab league={league} commit={commit} openPlayer={openPlayer} />}
      {tab === 'pro' && <ProScoutingTab league={league} commit={commit} openPlayer={openPlayer} />}
      {tab === 'staff' && <StaffTab league={league} commit={commit} />}
    </div>
  );
}
