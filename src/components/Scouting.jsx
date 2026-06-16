import React, { useState } from 'react';
import { scoutedOverall, scoutedOverallRange } from '../engine/scouting.js';
import { watchPlayer, regionalSweep, poachIntel, SCOUT_COSTS, EXTENDED_WATCH_COUNT } from '../engine/scoutingTrips.js';
import { regionFor, SCOUT_REGIONS } from '../engine/backstory.js';
import { Ovr, Pot, money, PlayerLink, Origin, GuideTooltip } from './shared.jsx';

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

export default function Scouting({ league, commit, openPlayer }) {
  const s = league.scouting;
  const [query, setQuery] = useState('');

  const userId = league.userTeamId;
  const budget = s.budgets[userId] ?? 0;
  const board = [...s.prospects].sort(
    (a, b) => scoutedOverall(b, league.season) - scoutedOverall(a, league.season)
  );
  const reports = s.reports[userId] ?? [];
  const matches = searchLeaguePlayers(league, query);

  const run = (fn, ...args) => {
    const res = fn(league, userId, ...args);
    if (res.ok) commit();
    else alert(res.error);
  };

  return (
    <>
      <div className="panel">
        <GuideTooltip
          tipKey="scouting_screen"
          text="Your scouting budget resets each season and can be spent any time — on draft prospects once the class is set, or on any other player in the league to sharpen your read before a trade or free-agent signing. Extended watches reveal backstory traits that affect development and market value."
          block
        >
          <h2>Scouting</h2>
        </GuideTooltip>
        <p style={{ marginBottom: 6 }}>
          Remaining budget: <b>{money(budget)}</b>
        </p>
        <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
          Watch a player to chip away at the fog around them — three watches
          gives a full, true read.
        </p>

        <h3 style={{ marginTop: 10 }}>Scout a Player</h3>
        <p style={{ color: 'var(--muted)', marginBottom: 8 }}>
          Search any other team's roster or the free-agent pool to scout a trade target or free agent.
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
                <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Team</th><th>Pos</th><th className="num">Age</th><th className="num">Scouted</th><th></th></tr>
              </thead>
              <tbody>
                {matches.map(({ p, teamLabel }) => {
                  const region = regionFor(p);
                  const cost = SCOUT_COSTS.watch[region] ?? SCOUT_COSTS.watch.Domestic;
                  const watched = p.scout?.watched ?? 0;
                  const [lo, hi] = scoutedOverallRange(p, league.season);
                  const revealed = lo === hi;
                  return (
                    <tr key={p.id}>
                      <td><Ovr p={p} league={league} fogged /></td>
                      <td><Pot p={p} league={league} fogged /></td>
                      <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                      <td>{teamLabel}</td>
                      <td>{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">{revealed ? '—' : `${watched}/${EXTENDED_WATCH_COUNT}`}</td>
                      <td>
                        {revealed ? (
                          <span style={{ color: 'var(--muted)' }}>Fully revealed</span>
                        ) : (
                          <button
                            className="btn small"
                            disabled={watched >= EXTENDED_WATCH_COUNT || budget < cost}
                            onClick={() => run(watchPlayer, p.id)}
                          >
                            {watched >= EXTENDED_WATCH_COUNT ? 'No more insight' : `Watch (${money(cost)})`}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {board.length > 0 ? (
          <>
            <h3 style={{ marginTop: 10 }}>Regional Sweeps ({money(SCOUT_COSTS.regional)} each)</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 8 }}>
              Regional sweeps spread a little coverage across every prospect from a
              region. Poach intel reveals what two other teams have been scouting.
            </p>
            <div className="controls" style={{ marginBottom: 10 }}>
              {SCOUT_REGIONS.map((region) => (
                <button
                  key={region}
                  className="btn small secondary"
                  disabled={budget < SCOUT_COSTS.regional}
                  onClick={() => run(regionalSweep, region)}
                >
                  Sweep {region}
                </button>
              ))}
              <button
                className="btn small secondary"
                disabled={budget < SCOUT_COSTS.poach}
                onClick={() => run(poachIntel)}
              >
                Poach Intel ({money(SCOUT_COSTS.poach)})
              </button>
            </div>

            <h3 style={{ marginTop: 10 }}>Prospect Board</h3>
            <table>
              <thead>
                <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th>From</th><th>Region</th><th className="num">Scouted</th><th></th></tr>
              </thead>
              <tbody>
                {board.map((p) => {
                  const region = regionFor(p);
                  const cost = SCOUT_COSTS.watch[region] ?? SCOUT_COSTS.watch.Domestic;
                  const watched = p.scout?.watched ?? 0;
                  const [lo, hi] = scoutedOverallRange(p, league.season);
                  const revealed = lo === hi;
                  return (
                    <tr key={p.id}>
                      <td><Ovr p={p} league={league} fogged /></td>
                      <td><Pot p={p} league={league} fogged /></td>
                      <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                      <td>{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td><Origin p={p} /></td>
                      <td>{region}</td>
                      <td className="num">{revealed ? '—' : `${watched}/${EXTENDED_WATCH_COUNT}`}</td>
                      <td>
                        {revealed ? (
                          <span style={{ color: 'var(--muted)' }}>Fully revealed</span>
                        ) : (
                          <button
                            className="btn small"
                            disabled={watched >= EXTENDED_WATCH_COUNT || budget < cost}
                            onClick={() => run(watchPlayer, p.id)}
                          >
                            {watched >= EXTENDED_WATCH_COUNT ? 'No more insight' : `Watch (${money(cost)})`}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ color: 'var(--muted)' }}>
            The draft prospect board opens once the playoffs end.
          </p>
        )}
      </div>

      {reports.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <GuideTooltip
            tipKey="scout_report"
            text="Rating ranges tighten with each report. Three watches on the same player fully reveals his ratings and personality. Regional sweeps cover more players cheaply but with less accuracy."
            block
          >
            <h3>Scout Reports</h3>
          </GuideTooltip>
          {reports.map((r, i) => (
            <p key={i} style={{ marginBottom: 8 }}>{r.text}</p>
          ))}
        </div>
      )}
    </>
  );
}
