import React from 'react';
import { overall } from '../engine/players.js';
import { teamStrength } from '../engine/sim.js';
import { ownerStance, seatStatus, personalitySummary } from '../engine/owner.js';
import { scoutingBudget } from '../engine/scoutingTrips.js';
import { PlayerLink, money } from './shared.jsx';

// One-line summary of what changed on the user's roster this offseason,
// derived from league.offseasonRosterSnapshot (captured the moment the
// Finals ended) vs. the roster as it stands heading into the new season.
function buildNarrative(league, userTeam) {
  const snapshot = new Set(league.offseasonRosterSnapshot || []);
  const draftedIds = new Set((league.draft?.results || []).filter((r) => r.teamId === userTeam.id).map((r) => r.playerId));
  const current = userTeam.roster;
  const added = current.filter((p) => !snapshot.has(p.id));
  const departedCount = [...snapshot].filter((id) => !current.some((p) => p.id === id)).length;
  const draftPicks = added.filter((p) => draftedIds.has(p.id));
  const faSignings = added.filter((p) => !draftedIds.has(p.id));

  const parts = [];
  if (draftPicks.length === 1) parts.push(`selected ${draftPicks[0].name} (${draftPicks[0].pos}) in the draft`);
  else if (draftPicks.length > 1) parts.push(`selected ${draftPicks.length} prospects in the draft`);
  if (faSignings.length === 1) parts.push(`added ${faSignings[0].name} in free agency`);
  else if (faSignings.length > 1) parts.push(`added ${faSignings.length} players in free agency`);
  if (departedCount) parts.push(`saw ${departedCount} player${departedCount > 1 ? 's' : ''} leave the roster`);

  if (!parts.length) return 'Your roster heads into the new season unchanged.';
  return `This offseason you ${parts.join(', ')}.`;
}

// Final offseason phase: a snapshot of the roster, team, and front office
// heading into the new season. "Start Season" calls startNewSeason() and
// transitions league.phase to 'regular'.
export default function SeasonPreview({ league, openPlayer, onStart }) {
  const userTeam = league.teams.find((t) => t.id === league.userTeamId);
  if (!userTeam) {
    return (
      <div className="modal-overlay">
        <div className="modal-card offseason-gate">
          <h2>Season Preview</h2>
          <div className="controls"><button className="btn" onClick={onStart}>Start Season</button></div>
        </div>
      </div>
    );
  }

  const roster = [...userTeam.roster]
    .map((p) => ({ p, ovr: overall(p) }))
    .sort((a, b) => b.ovr - a.ovr);

  const strengths = league.teams.map((t) => ({ id: t.id, conf: t.conf, s: teamStrength(t) }));
  const confTeams = strengths.filter((t) => t.conf === userTeam.conf).sort((a, b) => b.s - a.s);
  const seed = confTeams.findIndex((t) => t.id === userTeam.id) + 1;

  const owner = userTeam.owner;
  const narrative = buildNarrative(league, userTeam);

  return (
    <div className="modal-overlay">
      <div className="modal-card wide offseason-gate">
        <h2>{league.season} Season Preview</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>{narrative}</p>

        <div className="grid2" style={{ marginBottom: 16 }}>
          <div className="panel">
            <h3>Projected Standing</h3>
            <p style={{ fontSize: 28, fontWeight: 600 }}>{seed}{ordinalSuffix(seed)} in the {userTeam.conf}</p>
            <p style={{ color: 'var(--muted)' }}>Based on current roster strength vs. the rest of the league.</p>
          </div>
          <div className="panel">
            <h3>Front Office</h3>
            {owner ? (
              <>
                <p>{personalitySummary(owner)}</p>
                <p>{ownerStance(owner)} · Seat status: <strong>{seatStatus(owner)}</strong></p>
              </>
            ) : <p style={{ color: 'var(--muted)' }}>No owner profile.</p>}
            <p>Scouting budget for the year: <strong>{money(scoutingBudget(userTeam))}</strong></p>
          </div>
        </div>

        <div className="panel">
          <h3>Projected Roster</h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Overall</th></tr></thead>
              <tbody>
                {roster.map(({ p, ovr }) => (
                  <tr key={p.id}>
                    <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                    <td>{p.pos}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">{ovr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="controls" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn" onClick={onStart}>Start Season</button>
        </div>
      </div>
    </div>
  );
}

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
