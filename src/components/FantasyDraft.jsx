import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { POSITIONS } from '../engine/lineup.js';
import { onFantasyClock, makeFantasyPick } from '../engine/fantasyDraft.js';
import { Ovr, Pot, PlayerLink, TeamLink, Origin } from './shared.jsx';
import { Section, SectionHeader } from './ui/index.js';

const SORTS = {
  ovr: (a, b) => overall(b) - overall(a),
  age: (a, b) => a.age - b.age,
  pot: (a, b) => b.potential - a.potential,
};

function needColor(count) {
  if (count <= 1) return 'var(--color-danger)';
  if (count === 2) return 'var(--color-warning)';
  return 'var(--color-success)';
}

export default function FantasyDraft({ league, commit, openPlayer, openTeam }) {
  const [posFilter, setPosFilter] = useState('All');
  const [sortKey, setSortKey] = useState('ovr');

  const d = league.fantasyDraft;
  if (!d) {
    return (
      <Section title="Fantasy Draft" spacing="sm">
        <p style={{ color: 'var(--text-muted)' }}>No fantasy draft is in progress.</p>
      </Section>
    );
  }

  const clockTeamId = onFantasyClock(league);
  const myTurn = clockTeamId === league.userTeamId;
  const pickNo = d.pickIndex + 1;
  const round = Math.floor(d.pickIndex / 30) + 1;
  const nextUserPick = d.order.indexOf(league.userTeamId, d.pickIndex) + 1;

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
      <Section title="Fantasy Draft" spacing="sm">
        {clockTeamId ? (
          <>
            <p style={{ marginBottom: 'var(--sp-2)' }}>
              Round {round} · Pick {pickNo}/{d.order.length} · On the clock:{' '}
              <b><TeamLink team={getTeam(league, clockTeamId)} openTeam={openTeam} /></b>
              {myTurn && <span style={{ color: 'var(--color-success)' }}> — your pick!</span>}
            </p>
            <p style={{ marginBottom: 'var(--sp-2)', color: 'var(--text-muted)' }}>
              Up next: {d.order.slice(d.pickIndex + 1, d.pickIndex + 6).map((id) => getTeam(league, id).name).join(' → ')}…
              {!myTurn && (nextUserPick ? ` Your next pick is #${nextUserPick}.` : ' You have no picks left.')}
            </p>
          </>
        ) : (
          <p style={{ marginBottom: 'var(--sp-2)', color: 'var(--text-muted)' }}>
            All {d.order.length} picks are in. Finish the draft (controls above) to assign contracts and start the season.
          </p>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 480px' }}>
          <Section title="Draft Board" spacing="sm">
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Position:</span>
              {['All', ...POSITIONS].map((pos) => (
                <button
                  key={pos}
                  className={`ui-btn ui-btn--sm ${posFilter === pos ? 'ui-btn--primary' : 'ui-btn--secondary'}`}
                  onClick={() => setPosFilter(pos)}
                >
                  {pos}
                </button>
              ))}
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ marginLeft: 'var(--sp-2)' }}>
                <option value="ovr">Overall</option>
                <option value="age">Age</option>
                <option value="pot">Potential</option>
              </select>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
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
                          <button className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => draft(p)}>Draft</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <div style={{ flex: '1 1 260px' }}>
          <Section title={`Your Roster (${myRoster.length}/15)`} spacing="sm">
            {POSITIONS.map((pos) => (
              <div key={pos} style={{ marginBottom: 'var(--sp-3)' }}>
                <div style={{ marginBottom: 'var(--sp-1)' }}>
                  <b>{pos}</b>{' '}
                  <span className="tag" style={{ color: needColor(posCounts[pos]) }}>{posCounts[pos]}</span>
                </div>
                {myRoster.filter((p) => p.pos === pos).map((p) => (
                  <div key={p.id} style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    <PlayerLink p={p} openPlayer={openPlayer} /> — <Ovr p={p} league={league} /> ovr, age {p.age}
                  </div>
                ))}
              </div>
            ))}
          </Section>

          <Section title="Recent Picks" spacing="sm">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead><tr><th className="num">Pick</th><th>Team</th><th>Player</th><th>Pos</th></tr></thead>
                <tbody>
                  {[...d.results].slice(-10).reverse().map((r) => {
                    const p = getTeam(league, r.teamId).roster.find((x) => x.id === r.playerId);
                    const mine = r.teamId === league.userTeamId;
                    return (
                      <tr key={r.pick} style={mine ? { color: 'var(--color-success)' } : undefined}>
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
          </Section>
        </div>
      </div>
    </>
  );
}
