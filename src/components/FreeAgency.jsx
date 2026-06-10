import React, { useState } from 'react';
import { getTeam, payroll, signFreeAgent, askingPrice } from '../engine/league.js';
import { SALARY_CAP, ROSTER_MAX } from '../data/teams.js';
import { Ovr, money } from './shared.jsx';

export default function FreeAgency({ league, commit }) {
  const team = getTeam(league, league.userTeamId);
  const pay = payroll(team);
  const room = SALARY_CAP - pay;
  const [message, setMessage] = useState(null);
  const isOpen = league.phase === 'freeagency';

  const sign = (p) => {
    const price = askingPrice(p);
    if (team.roster.length >= ROSTER_MAX) {
      setMessage({ type: 'error', text: 'Roster full (15). Waive someone first.' });
      return;
    }
    if (price > room && price > 1_300_000) {
      setMessage({ type: 'error', text: `Not enough cap room for ${p.name} (${money(price)} asking, ${money(Math.max(room, 0))} available). Minimum contracts can always be signed.` });
      return;
    }
    signFreeAgent(league, team.id, p.id);
    setMessage({ type: 'ok', text: `Signed ${p.name}!` });
    commit();
  };

  return (
    <div className="panel">
      <h2>Free Agents</h2>
      <p style={{ marginBottom: 10, color: 'var(--muted)' }}>
        Cap room: <b style={{ color: room > 0 ? 'var(--green)' : 'var(--red)' }}>{money(room)}</b> · Roster: {team.roster.length}/{ROSTER_MAX}
        {!isOpen && ' · Signings open during the Free Agency phase (after the offseason advance), but you can browse anytime.'}
      </p>
      {message && <p style={{ marginBottom: 10, color: message.type === 'ok' ? 'var(--green)' : 'var(--red)' }}>{message.text}</p>}
      <table>
        <thead>
          <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Asking</th><th></th></tr>
        </thead>
        <tbody>
          {league.freeAgents.slice(0, 50).map((p) => (
            <tr key={p.id}>
              <td><Ovr p={p} /></td>
              <td style={{ color: 'var(--muted)' }}>{p.potential}</td>
              <td>{p.name}</td>
              <td>{p.pos}</td>
              <td className="num">{p.age}</td>
              <td className="num">{money(askingPrice(p))}</td>
              <td>
                <button className="btn small" disabled={!isOpen} onClick={() => sign(p)}>Sign</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
