import React from 'react';
import { getTeam } from '../engine/league.js';
import { makeDraftPick, onTheClock, rookieSalary, rookieContractYears } from '../engine/draft.js';
import { scoutedOverall, scoutedPotential } from '../engine/scouting.js';
import { Ovr, Pot, money, PlayerLink, TeamLink, Origin } from './shared.jsx';

// Big-board sort key: scouted overall blended with scouted potential, so
// young upside plays rank up without leaking true ratings.
function boardValue(p, season) {
  return scoutedOverall(p, season) + scoutedPotential(p, season, true) * 0.5;
}

export default function Draft({ league, commit, openPlayer, openTeam }) {
  const d = league.draft;
  if (!d) {
    return (
      <div className="panel">
        <h2>Draft</h2>
        <p style={{ color: 'var(--muted)' }}>
          The draft runs each offseason — after the playoffs, before free agency. Come back then.
        </p>
      </div>
    );
  }

  const live = league.phase === 'draft';
  const clockTeamId = live ? onTheClock(league) : null;
  const myTurn = clockTeamId === league.userTeamId;
  const pickNo = d.pickIndex + 1;
  const nextUserPick = d.order.indexOf(league.userTeamId, d.pickIndex) + 1; // 0 = none left

  // Drafted players live on rosters (or in free agency if there was no
  // roster spot) — find the object so the result row can open a player card.
  const draftedPlayer = (r) =>
    getTeam(league, r.teamId).roster.find((p) => p.id === r.playerId)
    || league.freeAgents.find((p) => p.id === r.playerId);

  const board = [...d.prospects].sort(
    (a, b) => boardValue(b, league.season) - boardValue(a, league.season)
  );

  const draft = (p) => {
    makeDraftPick(league, p.id);
    commit();
  };

  return (
    <>
      <div className="panel">
        <h2>{d.season} NBA Draft</h2>
        {live && clockTeamId && (
          <p style={{ marginBottom: 6 }}>
            Round {pickNo <= 30 ? 1 : 2} · Pick {pickNo}/{d.order.length} · On the clock:{' '}
            <b><TeamLink team={getTeam(league, clockTeamId)} openTeam={openTeam} /></b>
            {myTurn && <span style={{ color: 'var(--green)' }}> — your pick! Slot contract: {money(rookieSalary(pickNo))} × {rookieContractYears(pickNo)}yr</span>}
          </p>
        )}
        {live && clockTeamId && (
          <p style={{ marginBottom: 6, color: 'var(--muted)' }}>
            Up next: {d.order.slice(d.pickIndex + 1, d.pickIndex + 6).map((id) => getTeam(league, id).name).join(' → ')}…
            {!myTurn && (nextUserPick ? ` Your next pick is #${nextUserPick}.` : ' You have no picks left.')}
          </p>
        )}
        {live && !clockTeamId && (
          <p style={{ marginBottom: 6, color: 'var(--muted)' }}>
            All 60 picks are in. Finish the draft (controls above) to send undrafted prospects to free agency and open signings.
          </p>
        )}

        {d.prospects.length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>Big Board</h3>
            <table>
              <thead>
                <tr><th className="num">#</th><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th>From</th><th></th></tr>
              </thead>
              <tbody>
                {board.map((p, i) => (
                  <tr key={p.id}>
                    <td className="num">{i + 1}</td>
                    <td><Ovr p={p} league={league} fogged /></td>
                    <td><Pot p={p} league={league} fogged /></td>
                    <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                    <td>{p.pos}</td>
                    <td className="num">{p.age}</td>
                    <td><Origin p={p} /></td>
                    <td>
                      {myTurn && (
                        <button className="btn small" onClick={() => draft(p)}>Draft</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {d.results.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Picks</h3>
          <table>
            <thead>
              <tr><th className="num">Pick</th><th>Team</th><th>Player</th><th>Pos</th></tr>
            </thead>
            <tbody>
              {[...d.results].reverse().map((r) => {
                const p = draftedPlayer(r);
                const mine = r.teamId === league.userTeamId;
                return (
                  <tr key={r.pick} style={mine ? { color: 'var(--green)' } : undefined}>
                    <td className="num">{r.pick}</td>
                    <td><TeamLink team={getTeam(league, r.teamId)} openTeam={openTeam} /></td>
                    <td>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : r.playerName}</td>
                    <td>{r.pos}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
