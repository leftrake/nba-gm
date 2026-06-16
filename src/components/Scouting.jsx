import React, { useState } from 'react';
import { scoutedOverall, scoutUncertainty, isHidden, fogColor } from '../engine/scouting.js';
import {
  workoutProspect, gameWatchProspect, sweepRegion, poachIntel,
  markProWatch, removeProWatch,
  hireScout, fireScout, getScouts,
  isDiscovered,
  DRAFT_POINTS_MAX, PRO_SCOUT_GAMES_FULL, PRO_WATCH_SLOTS,
  SWEEP_COSTS, WORKOUT_COSTS, GAME_WATCH_COSTS, POACH_COST,
  SCOUT_TYPES, MAX_SCOUTS,
  totalScoutSalary, scoutingBudget,
} from '../engine/scoutingTrips.js';
import { regionFor, SCOUT_REGIONS } from '../engine/backstory.js';
import { Ovr, Pot, PlayerLink, Origin, GuideTooltip } from './shared.jsx';

const INTL_REGIONS = SCOUT_REGIONS.filter((r) => r !== 'Domestic');

function dollars(n) {
  return n >= 1_000_000 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;
}

// ---- Shared helpers ----

function FogDot({ u }) {
  return (
    <span
      title={`Scouting uncertainty ±${u}`}
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: fogColor(u), verticalAlign: 'middle', marginLeft: 3, flexShrink: 0 }}
    />
  );
}

function run(fn, league, ...args) {
  const res = fn(league, ...args);
  return res;
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
    <tr style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
      <td colSpan={colCount - 1}>
        🔒 {count} undiscovered prospect{count !== 1 ? 's' : ''} in {region}
      </td>
      <td>
        {hasRegionalScout ? (
          <span style={{ color: 'var(--muted)' }}>Regional scout covers this</span>
        ) : (
          <button
            className="btn small secondary"
            disabled={budget < cost}
            onClick={doSweep}
            title={`One-time sweep — discover all ${region} prospects in every class`}
          >
            Sweep ({dollars(cost)})
          </button>
        )}
      </td>
    </tr>
  );
}

function ProspectRow({ p, league, budget, userId, hasBigBoard, hasSleeper, sleeperIds, bigBoardIds, commit }) {
  const region = regionFor(p);
  const wkCost = WORKOUT_COSTS[region] ?? WORKOUT_COSTS.Domestic;
  const gwCost = GAME_WATCH_COSTS[region] ?? GAME_WATCH_COSTS.Domestic;
  const pts = p.scout?.draftPoints ?? 0;
  const full = pts >= DRAFT_POINTS_MAX;
  const isSleeper = hasSleeper && sleeperIds.includes(p.id);
  const bbRank = hasBigBoard ? bigBoardIds.indexOf(p.id) : -1;
  const hidden = isHidden(p);

  const doMission = (fn) => {
    const res = fn(league, userId, p.id);
    if (res.ok) commit();
    else alert(res.error);
  };

  return (
    <tr>
      {hasBigBoard && <td className="num" style={{ color: 'var(--muted)' }}>{bbRank >= 0 ? `#${bbRank + 1}` : '–'}</td>}
      <td>
        <Ovr p={p} league={league} fogged />
        {isSleeper && <span title="Sleeper pick — high upside, lightly scouted" style={{ marginLeft: 4, color: '#d29922' }}>★</span>}
      </td>
      <td><Pot p={p} league={league} fogged /></td>
      <td><PlayerLink p={p} /></td>
      <td>{p.pos}</td>
      <td className="num">{p.age}</td>
      <td><Origin p={p} /></td>
      <td>{region}</td>
      <td className="num">
        {hidden ? (
          <span style={{ color: 'var(--muted)' }}>—</span>
        ) : (
          <span title={`${pts} of ${DRAFT_POINTS_MAX} scouting points`}>{pts}/{DRAFT_POINTS_MAX}</span>
        )}
      </td>
      <td>
        {full ? (
          <span style={{ color: 'var(--muted)' }}>Full read</span>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn small"
              disabled={budget < wkCost}
              onClick={() => doMission(workoutProspect)}
              title={`Individual workout — +60 scouting points`}
            >
              Workout ({dollars(wkCost)})
            </button>
            <button
              className="btn small secondary"
              disabled={budget < gwCost}
              onClick={() => doMission(gameWatchProspect)}
              title={`Game watch — +25 scouting points`}
            >
              Watch ({dollars(gwCost)})
            </button>
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
  const draftSortOvr = (p) => (isHidden(p) ? -Infinity : scoutedOverall(p, league.season));
  const sorted = [...discovered].sort((a, b) => draftSortOvr(b) - draftSortOvr(a));

  // Group undiscovered international prospects by region
  const undiscoveredByRegion = {};
  for (const p of dc.prospects) {
    if (!isDiscovered(p, userId, league)) {
      const r = regionFor(p);
      undiscoveredByRegion[r] = (undiscoveredByRegion[r] ?? 0) + 1;
    }
  }

  const colCount = 9 + (hasBigBoard ? 1 : 0);

  return (
    <>
      <h4 style={{ marginTop: 14, marginBottom: 6, color: 'var(--muted)', fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>
        {label}
      </h4>
      <table>
        <thead>
          <tr>
            {hasBigBoard && <th title="Big Board Analyst rank">#</th>}
            <th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th>
            <th className="num">Age</th><th>From</th><th>Region</th>
            <th className="num">Pts</th><th>Actions</th>
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
              <td colSpan={colCount} style={{ color: 'var(--muted)', textAlign: 'center', padding: 12 }}>
                No prospects in this class yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
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
      <div className="panel">
        <GuideTooltip
          tipKey="scouting_draft_board"
          text="Your annual scouting budget funds missions on future draft classes. Workouts give a big reveal (+60 pts); game watches are cheaper (+25 pts). International prospects must be discovered before you can scout them — hire a regional scout or run a one-time sweep. The board spans 3 years so you can start building your board years in advance."
          block
        >
          <h2>Draft Board</h2>
        </GuideTooltip>

        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap' }}>
          <span>Budget: <b>{dollars(budget)}</b></span>
          <button
            className="btn small secondary"
            disabled={budget < POACH_COST}
            onClick={doPoach}
            title="Reveals which prospects 2 other teams have been scouting this offseason"
          >
            Poach Intel ({dollars(POACH_COST)})
          </button>
        </div>

        {allClasses.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
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
      </div>

      {reports.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Scout Reports</h3>
          {reports.map((r, i) => (
            <p key={i} style={{ marginBottom: 8 }}>{r.text}</p>
          ))}
        </div>
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

function FilmBar({ games }) {
  const pct = Math.min(100, Math.round((games / PRO_SCOUT_GAMES_FULL) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--green)' : 'var(--accent)', borderRadius: 3 }} />
      </div>
      <span style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{games}/{PRO_SCOUT_GAMES_FULL}</span>
    </div>
  );
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

  return (
    <>
      <div className="panel">
        <GuideTooltip
          tipKey="scouting_pro"
          text="Mark players as watched from here or from their player card. Each simmed game-day accumulates film — after 20 game-days your read reaches maximum tightness. Fog resets each offseason as players develop, but your watch list carries over. Rookies who were scouted pre-draft start with a head start based on their draft scouting points."
          block
        >
          <h2>Pro Scouting</h2>
        </GuideTooltip>

        <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
          Watch slots: <b style={{ color: slotsUsed >= PRO_WATCH_SLOTS ? 'var(--red)' : 'var(--text)' }}>{slotsUsed}/{PRO_WATCH_SLOTS} used</b>
        </p>

        {watchList.length === 0 ? (
          <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
            No players on your watch list. Search below to add trade targets or free agents to track.
          </p>
        ) : (
          <table style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>Ovr</th><th>Player</th><th>Team</th>
                <th>Film</th><th>Fog</th><th></th>
              </tr>
            </thead>
            <tbody>
              {watchList.map((id) => {
                const found = findLeaguePlayer(league, id);
                if (!found) return null;
                const { p, team } = found;
                const games = proWatching[id] ?? 0;
                const u = isHidden(p, games) ? null : scoutUncertainty(p, games);
                return (
                  <tr key={id}>
                    <td><Ovr p={p} league={league} fogged /></td>
                    <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                    <td>{team ? `${team.city} ${team.name}` : 'Free Agent'}</td>
                    <td><FilmBar games={games} /></td>
                    <td title={u === null ? 'No read yet' : `Uncertainty ±${u} — ${u <= 2 ? 'tight' : u <= 4 ? 'decent' : u <= 7 ? 'moderate' : 'wide'}`}>
                      {u === null ? (
                        <span style={{ color: 'var(--muted)' }}>?</span>
                      ) : (
                        <FogDot u={u} />
                      )}
                    </td>
                    <td>
                      <button className="btn small secondary" onClick={() => toggleWatch(id)}>
                        Stop Watching
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h3 style={{ marginTop: 10 }}>Add Players to Watch</h3>
        <p style={{ color: 'var(--muted)', marginBottom: 8 }}>
          Search any other team's roster or free agents to track for trades or free agency.
        </p>
        <input
          type="text"
          placeholder="Search by player name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 10, maxWidth: 280 }}
        />
        {query.trim().length >= 2 && (
          matches.length === 0 ? (
            <p style={{ color: 'var(--muted)', marginBottom: 10 }}>No matching players found.</p>
          ) : (
            <table style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>Ovr</th><th>Pot</th><th>Player</th><th>Team</th>
                  <th>Pos</th><th className="num">Age</th><th></th>
                </tr>
              </thead>
              <tbody>
                {matches.map(({ p, teamLabel }) => {
                  const isWatching = watchList.includes(p.id);
                  return (
                    <tr key={p.id}>
                      <td><Ovr p={p} league={league} fogged /></td>
                      <td><Pot p={p} league={league} fogged /></td>
                      <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                      <td>{teamLabel}</td>
                      <td>{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td>
                        <button
                          className={`btn small${isWatching ? ' secondary' : ''}`}
                          disabled={!isWatching && slotsUsed >= PRO_WATCH_SLOTS}
                          onClick={() => toggleWatch(p.id)}
                          title={!isWatching && slotsUsed >= PRO_WATCH_SLOTS ? `Watch list full (${PRO_WATCH_SLOTS} slots)` : undefined}
                        >
                          {isWatching ? 'Watching ✓' : 'Watch'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      {proReports.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Pro Scout Reports</h3>
          {proReports.map((r, i) => (
            <p key={i} style={{ marginBottom: 8 }}>{r.text}</p>
          ))}
        </div>
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

  const overBudget = salary > annual;

  return (
    <>
      <div className="panel">
        <h2>Scout Staff</h2>
        <div style={{ marginBottom: 12 }}>
          <span>Annual scouting budget: <b>{dollars(annual)}</b></span>
          {' · '}
          <span>Scout salaries: <b style={{ color: overBudget ? 'var(--red)' : 'var(--text)' }}>{dollars(salary)}</b></span>
          {' · '}
          <span>Available for missions: <b>{dollars(budget)}</b></span>
          {' · '}
          <span style={{ color: 'var(--muted)' }}>{scouts.length}/{MAX_SCOUTS} scouts</span>
        </div>

        {overBudget && (
          <p style={{ color: 'var(--red)', marginBottom: 10 }}>
            ⚠ Scout salaries exceed this season's budget — consider releasing a scout.
          </p>
        )}

        {!canHire && (
          <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
            Scout hiring and releasing is only available during the offseason.
          </p>
        )}

        {scouts.length > 0 ? (
          <table style={{ marginBottom: 16 }}>
            <thead>
              <tr><th>Scout Type</th><th>Specialty</th><th className="num">Salary</th><th></th></tr>
            </thead>
            <tbody>
              {scouts.map((sc, i) => (
                <tr key={i}>
                  <td>{SCOUT_TYPES[sc.type]?.label ?? sc.type}</td>
                  <td style={{ color: 'var(--muted)' }}>
                    {sc.region ?? (sc.range ? RANGE_LABELS[sc.range] : '—')}
                  </td>
                  <td className="num">{dollars(sc.salary)}</td>
                  <td>
                    <button className="btn small secondary" disabled={!canHire} onClick={() => doFire(sc)}>
                      Release
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>No scouts on staff.</p>
        )}

        {scouts.length < MAX_SCOUTS && (
          <>
            <h3 style={{ marginBottom: 8 }}>Hire Scouts</h3>

            {/* Regional scouts */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 4 }}>
                <b>Regional Scout</b>
                <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                  {dollars(SCOUT_TYPES.regional.salary)}/yr — auto-discovers all prospects in a region each offseason
                </span>
              </div>
              <div className="controls">
                {INTL_REGIONS.map((region) => {
                  const has = scouts.some((sc) => sc.type === 'regional' && sc.region === region);
                  const wouldExceed = !has && salary + SCOUT_TYPES.regional.salary > annual;
                  return (
                    <button
                      key={region}
                      className={`btn small${has ? '' : ' secondary'}`}
                      disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                      title={has ? `Already have a ${region} scout` : wouldExceed ? 'Salary would exceed budget' : `Hire a regional scout for ${region}`}
                      onClick={() => doHire('regional', region)}
                    >
                      {region}{has ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sleeper finder */}
            {(() => {
              const has = scouts.some((sc) => sc.type === 'sleeper');
              const wouldExceed = !has && salary + SCOUT_TYPES.sleeper.salary > annual;
              return (
                <div style={{ marginBottom: 10 }}>
                  <button
                    className="btn small secondary"
                    disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                    title={wouldExceed ? 'Salary would exceed budget' : undefined}
                    onClick={() => doHire('sleeper')}
                  >
                    {has ? 'Sleeper Finder ✓' : `Hire Sleeper Finder (${dollars(SCOUT_TYPES.sleeper.salary)}/yr)`}
                  </button>
                  {' '}
                  <span style={{ color: 'var(--muted)' }}>flags 3–5 high-upside, under-scouted prospects each offseason</span>
                </div>
              );
            })()}

            {/* Big board analyst */}
            {(() => {
              const has = scouts.some((sc) => sc.type === 'bigBoard');
              const wouldExceed = !has && salary + SCOUT_TYPES.bigBoard.salary > annual;
              return (
                <div style={{ marginBottom: 10 }}>
                  <button
                    className="btn small secondary"
                    disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                    title={wouldExceed ? 'Salary would exceed budget' : undefined}
                    onClick={() => doHire('bigBoard')}
                  >
                    {has ? 'Big Board Analyst ✓' : `Hire Big Board Analyst (${dollars(SCOUT_TYPES.bigBoard.salary)}/yr)`}
                  </button>
                  {' '}
                  <span style={{ color: 'var(--muted)' }}>generates a top-20 ranked list weighted by positional need</span>
                </div>
              );
            })()}

            {/* Range specialists */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ marginBottom: 4 }}>
                <b>Draft Range Specialist</b>
                <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                  {dollars(SCOUT_TYPES.rangeSpecialist.salary)}/yr — +10 baseline points to prospects in their range
                </span>
              </div>
              <div className="controls">
                {[['lottery', 'Lottery (Top 14)'], ['secondRound', '2nd Round']].map(([range, label]) => {
                  const has = scouts.some((sc) => sc.type === 'rangeSpecialist' && sc.range === range);
                  const wouldExceed = !has && salary + SCOUT_TYPES.rangeSpecialist.salary > annual;
                  return (
                    <button
                      key={range}
                      className={`btn small${has ? '' : ' secondary'}`}
                      disabled={has || scouts.length >= MAX_SCOUTS || !canHire}
                      title={has ? 'Already have this specialist' : wouldExceed ? 'Salary would exceed budget' : undefined}
                      onClick={() => doHire('rangeSpecialist', range)}
                    >
                      {label}{has ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---- Main component ----

export default function Scouting({ league, commit, openPlayer }) {
  const [tab, setTab] = useState('draft');
  const watchCount = league.scouting?.proWatchList?.length ?? 0;
  const scouts = getScouts(league, league.userTeamId);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className={`btn small${tab === 'draft' ? '' : ' secondary'}`}
          onClick={() => setTab('draft')}
        >
          Draft Board
        </button>
        <button
          className={`btn small${tab === 'pro' ? '' : ' secondary'}`}
          onClick={() => setTab('pro')}
        >
          Pro Scouting
          {watchCount > 0 && (
            <span style={{ marginLeft: 5, color: 'var(--muted)' }}>({watchCount})</span>
          )}
        </button>
        <button
          className={`btn small${tab === 'staff' ? '' : ' secondary'}`}
          onClick={() => setTab('staff')}
        >
          Staff
          {scouts.length > 0 && (
            <span style={{ marginLeft: 5, color: 'var(--muted)' }}>({scouts.length})</span>
          )}
        </button>
      </div>

      {tab === 'draft' && <DraftBoardTab league={league} commit={commit} openPlayer={openPlayer} />}
      {tab === 'pro' && <ProScoutingTab league={league} commit={commit} openPlayer={openPlayer} />}
      {tab === 'staff' && <StaffTab league={league} commit={commit} />}
    </>
  );
}
