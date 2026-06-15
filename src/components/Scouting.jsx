import React from 'react';
import { scoutedOverall } from '../engine/scouting.js';
import { watchPlayer, regionalSweep, poachIntel, SCOUT_COSTS, EXTENDED_WATCH_COUNT } from '../engine/scoutingTrips.js';
import { regionFor, SCOUT_REGIONS } from '../engine/backstory.js';
import { Ovr, Pot, money, PlayerLink, Origin, GuideTooltip } from './shared.jsx';

export default function Scouting({ league, commit, openPlayer }) {
  const s = league.scouting;
  if (!s) {
    return (
      <div className="panel">
        <h2>Scouting</h2>
        <p style={{ color: 'var(--muted)' }}>
          The scouting window opens once the playoffs end, before the draft. Come back then.
        </p>
      </div>
    );
  }

  const userId = league.userTeamId;
  const budget = s.budgets[userId] ?? 0;
  const board = [...s.prospects].sort(
    (a, b) => scoutedOverall(b, league.season) - scoutedOverall(a, league.season)
  );
  const reports = s.reports[userId] ?? [];

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
          text="Your scouting budget resets each offseason. Spend it on players you're targeting in the draft — extended watches reveal backstory traits that affect development and market value."
          block
        >
          <h2>Scouting</h2>
        </GuideTooltip>
        <p style={{ marginBottom: 6 }}>
          Remaining budget: <b>{money(budget)}</b>
        </p>
        <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
          Watch individual prospects to chip away at the fog around them — three
          watches gives a full, true read. Regional sweeps spread a little
          coverage across every prospect from a region. Poach intel reveals
          what two other teams have been scouting.
        </p>

        <h3 style={{ marginTop: 10 }}>Regional Sweeps ({money(SCOUT_COSTS.regional)} each)</h3>
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
              const full = watched >= EXTENDED_WATCH_COUNT;
              return (
                <tr key={p.id}>
                  <td><Ovr p={p} league={league} fogged /></td>
                  <td><Pot p={p} league={league} fogged /></td>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  <td>{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td><Origin p={p} /></td>
                  <td>{region}</td>
                  <td className="num">{watched}/{EXTENDED_WATCH_COUNT}</td>
                  <td>
                    <button
                      className="btn small"
                      disabled={full || budget < cost}
                      onClick={() => run(watchPlayer, p.id)}
                    >
                      {full ? 'Fully scouted' : `Watch (${money(cost)})`}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
