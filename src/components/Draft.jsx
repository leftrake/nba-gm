import React from 'react';
import { getTeam } from '../engine/league.js';
import { makeDraftPick, onTheClock, rookieSalary, rookieContractYears } from '../engine/draft.js';
import { scoutedOverall, scoutedPotential } from '../engine/scouting.js';
import { Ovr, Pot, money, PlayerLink, TeamLink, Origin } from './shared.jsx';
import { Section, SectionHeader } from './ui/index.js';

function boardValue(p, season, teamId) {
  return scoutedOverall(p, season, teamId) + scoutedPotential(p, season, true, teamId) * 0.5;
}

export default function Draft({ league, commit, openPlayer, openTeam }) {
  const d = league.draft;
  if (!d) {
    return (
      <Section title="Draft" spacing="sm">
        <p style={{ color: 'var(--text-muted)' }}>
          The draft runs each offseason — after the playoffs, before free agency. Come back then.
        </p>
      </Section>
    );
  }

  const live = league.phase === 'offseason/draft';
  const clockTeamId = live ? onTheClock(league) : null;
  const myTurn = clockTeamId === league.userTeamId;
  const pickNo = d.pickIndex + 1;
  const nextUserPick = d.order.indexOf(league.userTeamId, d.pickIndex) + 1;

  const draftedPlayer = (r) =>
    getTeam(league, r.teamId).roster.find((p) => p.id === r.playerId)
    || league.freeAgents.find((p) => p.id === r.playerId);

  const wentToFreeAgency = (r) =>
    !getTeam(league, r.teamId).roster.some((p) => p.id === r.playerId)
    && league.freeAgents.some((p) => p.id === r.playerId);

  const board = [...d.prospects].sort(
    (a, b) => boardValue(b, league.season, league.userTeamId) - boardValue(a, league.season, league.userTeamId)
  );

  const draft = (p) => {
    makeDraftPick(league, p.id);
    commit();
  };

  return (
    <>
      <Section title={`${d.season} NBA Draft`} spacing="sm">
        {live && clockTeamId && (
          <p style={{ marginBottom: 'var(--sp-2)' }}>
            Round {pickNo <= 30 ? 1 : 2} · Pick {pickNo}/{d.order.length} · On the clock:{' '}
            <b><TeamLink team={getTeam(league, clockTeamId)} openTeam={openTeam} /></b>
            {myTurn && <span style={{ color: 'var(--color-success)' }}> — your pick! Slot contract: {money(rookieSalary(pickNo))} × {rookieContractYears(pickNo)}yr</span>}
          </p>
        )}
        {live && clockTeamId && (
          <p style={{ marginBottom: 'var(--sp-2)', color: 'var(--text-muted)' }}>
            Up next: {d.order.slice(d.pickIndex + 1, d.pickIndex + 6).map((id) => getTeam(league, id).name).join(' → ')}…
            {!myTurn && (nextUserPick ? ` Your next pick is #${nextUserPick}.` : ' You have no picks left.')}
          </p>
        )}
        {live && !clockTeamId && (
          <p style={{ marginBottom: 'var(--sp-2)', color: 'var(--text-muted)' }}>
            All 60 picks are in. Finish the draft (controls above) to send undrafted prospects to free agency and open signings.
          </p>
        )}

        {d.prospects.length > 0 && (
          <>
            <SectionHeader title="Big Board" />
            <div className="ui-table-wrap">
              <table className="ui-table">
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
                          <button className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => draft(p)}>Draft</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {d.results.length > 0 && (
        <Section title="Picks" spacing="sm">
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr><th className="num">Pick</th><th>Team</th><th>Player</th><th>Pos</th><th></th></tr>
              </thead>
              <tbody>
                {d.results.map((r) => {
                  const p = draftedPlayer(r);
                  const mine = r.teamId === league.userTeamId;
                  return (
                    <tr key={r.pick} style={mine ? { background: 'var(--color-success-soft)' } : undefined}>
                      <td className="num" style={mine ? { fontWeight: 'var(--weight-bold)' } : undefined}>{r.pick}</td>
                      <td><TeamLink team={getTeam(league, r.teamId)} openTeam={openTeam} /></td>
                      <td style={mine ? { fontWeight: 'var(--weight-bold)' } : undefined}>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : r.playerName}</td>
                      <td>{r.pos}</td>
                      <td>
                        {wentToFreeAgency(r) && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>→ Free Agent (roster full)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
