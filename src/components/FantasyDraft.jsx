import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { POSITIONS } from '../engine/lineup.js';
import { onFantasyClock, makeFantasyPick } from '../engine/fantasyDraft.js';
import { Ovr, Pot, PlayerLink, TeamLink, Origin } from './shared.jsx';

const SORTS = {
  ovr: (a, b) => overall(b) - overall(a),
  age: (a, b) => a.age - b.age,
  pot: (a, b) => b.potential - a.potential,
};

// Need badge thresholds match teamNeedScore in fantasyDraft.js: 0-1 players
// at a position is a real need, 2 is fine, 3+ is covered.
function needColor(count) {
  if (count <= 1) return 'var(--red)';
  if (count === 2) return '#d29922';
  return 'var(--green)';
}

export default function FantasyDraft({ league, commit, openPlayer, openTeam }) {
  const [posFilter, setPosFilter] = useState('All');
  const [sortKey, setSortKey] = useState('ovr');

  const d = league.fantasyDraft;
  if (!d) {
    return (
      <div className="panel">
        <h2>Fantasy Draft</h2>
        <p style={{ color: 'var(--muted)' }}>No fantasy draft is in progress.</p>
      </div>
    );
  }

  const clockTeamId = onFantasyClock(league);
  const myTurn = clockTeamId === league.userTeamId;
  const pickNo = d.pickIndex + 1;
  const round = Math.floor(d.pickIndex / 30) + 1;
  const nextUserPick = d.order.indexOf(league.userTeamId, d.pickIndex) + 1; // 0 = none left

  const board = d.pool
    .filter((p) => posFilter === 'All' || p.pos === posFilter)
    .sort(SORTS[sortKey]);

  const draft = (p) => {
    makeFantasyPick(league, p.id);
    commit();
  };

  const myRoster = getTeam(league, league.userTeamId).roster;
  const posCounts = Object.fromEntries(POSITIONS.map((pos) => [pos, myRoster.filter((p) => p.pos === pos).length]));

  return (
    <>
      <div className="panel">
        <h2>Fantasy Draft</h2>
        {clockTeamId ? (
          <>
            <p style={{ marginBottom: 6 }}>
              Round {round} · Pick {pickNo}/{d.order.length} · On the clock:{' '}
              <b><TeamLink team={getTeam(league, clockTeamId)} openTeam={openTeam} /></b>
              {myTurn && <span style={{ color: 'var(--green)' }}> — your pick!</span>}
            </p>
            <p style={{ marginBottom: 6, color: 'var(--muted)' }}>
              Up next: {d.order.slice(d.pickIndex + 1, d.pickIndex + 6).map((id) => getTeam(league, id).name).join(' → ')}…
              {!myTurn && (nextUserPick ? ` Your next pick is #${nextUserPick}.` : ' You have no picks left.')}
            </p>
          </>
        ) : (
          <p style={{ marginBottom: 6, color: 'var(--muted)' }}>
            All {d.order.length} picks are in. Finish the draft (controls above) to assign contracts and start the season.
          </p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 14, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 480px' }}>
          <h3 style={{ marginTop: 0 }}>Draft Board</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>Position:</span>
            {['All', ...POSITIONS].map((pos) => (
              <button
                key={pos}
                className={`btn small ${posFilter === pos ? '' : 'secondary'}`}
                onClick={() => setPosFilter(pos)}
              >
                {pos}
              </button>
            ))}
            <span style={{ color: 'var(--muted)', marginLeft: 12 }}>Sort:</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="ovr">Overall</option>
              <option value="age">Age</option>
              <option value="pot">Potential</option>
            </select>
          </div>
          <table>
            <thead>
              <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th>From</th><th></th></tr>
            </thead>
            <tbody>
              {board.map((p) => (
                <tr key={p.id}>
                  <td><Ovr p={p} league={league} /></td>
                  <td><Pot p={p} league={league} /></td>
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
        </div>

        <div style={{ flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0 }}>Your Roster ({myRoster.length}/15)</h3>
          {POSITIONS.map((pos) => (
            <div key={pos} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 2 }}>
                <b>{pos}</b>{' '}
                <span className="tag" style={{ color: needColor(posCounts[pos]) }}>{posCounts[pos]}</span>
              </div>
              {myRoster.filter((p) => p.pos === pos).map((p) => (
                <div key={p.id} style={{ color: 'var(--muted)', fontSize: 13 }}>
                  <PlayerLink p={p} openPlayer={openPlayer} /> — <Ovr p={p} league={league} /> ovr, age {p.age}
                </div>
              ))}
            </div>
          ))}

          <h3>Recent Picks</h3>
          <table>
            <thead><tr><th className="num">Pick</th><th>Team</th><th>Player</th><th>Pos</th></tr></thead>
            <tbody>
              {[...d.results].slice(-10).reverse().map((r) => {
                const p = getTeam(league, r.teamId).roster.find((x) => x.id === r.playerId);
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
      </div>
    </>
  );
}
