import React, { useState } from 'react';
import { getTeam, payroll, makeOffer, askingPrice, midSeasonSignable, proratedMinSalary, signMidSeasonFA } from '../engine/league.js';
import { scoutedOverall } from '../engine/scouting.js';
import { SALARY_CAP, MIN_SALARY, MAX_SALARY, ROSTER_MAX } from '../data/teams.js';
import { Ovr, Pot, money, PlayerLink } from './shared.jsx';

const OFFERS_PER_ROUND = 3;

export default function FreeAgency({ league, commit, openPlayer }) {
  const team = getTeam(league, league.userTeamId);
  const room = SALARY_CAP - payroll(team);
  const isOpen = league.phase === 'freeagency';
  const isSeason = league.phase === 'regular';
  const [negotiatingId, setNegotiatingId] = useState(null);
  const [salaryM, setSalaryM] = useState(5);
  const [years, setYears] = useState(2);
  const [responses, setResponses] = useState({}); // playerId -> last makeOffer result
  const [message, setMessage] = useState(null); // top-level note (signings)

  const negotiations = league.negotiations || {};

  const toggleNegotiation = (p) => {
    if (negotiatingId === p.id) {
      setNegotiatingId(null);
      return;
    }
    setNegotiatingId(p.id);
    setSalaryM(askingPrice(p) / 1e6);
    setYears(2);
  };

  const offer = (p, salM, yrs) => {
    const res = makeOffer(league, team.id, p.id, Math.round(salM * 10) * 100_000, yrs);
    if (res.ok && res.decision === 'accept') {
      setMessage({ type: 'ok', text: res.reason });
      setNegotiatingId(null);
    } else {
      setMessage(null);
    }
    setResponses((r) => ({ ...r, [p.id]: res }));
    commit();
  };

  const offersUsed = (p) => {
    const n = negotiations[p.id];
    return n && n.round === league.faDaysLeft ? n.offers : 0;
  };

  const signMin = (p) => {
    const res = signMidSeasonFA(league, team.id, p.id);
    setMessage(res.ok
      ? { type: 'ok', text: `${p.name} signed for the rest of the season (${money(res.player.contract.salary)}) — available for the next game.` }
      : { type: 'err', text: res.error });
    commit();
  };

  return (
    <div className="panel">
      <h2>Free Agents</h2>
      <p style={{ marginBottom: 10, color: 'var(--muted)' }}>
        Cap room: <b style={{ color: room > 0 ? 'var(--green)' : 'var(--red)' }}>{money(room)}</b> · Roster: {team.roster.length}/{ROSTER_MAX}
        {isOpen
          ? ' · Negotiate salary and years — players weigh money, your record, and their role. Other teams sign players every round, including ones you\'re talking to.'
          : isSeason
          ? ` · In-season market: rest-of-season minimum deals only (${money(proratedMinSalary(league))} right now), and you need an open roster spot. Anyone worth a real contract is holding out for the summer.`
          : ' · Signings open during the Free Agency phase (after the offseason advance), but you can browse anytime.'}
      </p>
      {message && <p style={{ marginBottom: 10, color: message.type === 'ok' ? 'var(--green)' : 'var(--red)' }}>{message.text}</p>}
      <table>
        <thead>
          <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Asking</th><th></th></tr>
        </thead>
        <tbody>
          {[...league.freeAgents]
            .sort((a, b) => scoutedOverall(b, league.season) - scoutedOverall(a, league.season))
            .slice(0, 50)
            .map((p) => {
              const res = responses[p.id];
              const counter = negotiations[p.id]?.counter;
              const left = OFFERS_PER_ROUND - offersUsed(p);
              const holdingOut = isSeason && !midSeasonSignable(p);
              return (
                <React.Fragment key={p.id}>
                  <tr style={holdingOut ? { opacity: 0.55 } : undefined}>
                    <td><Ovr p={p} league={league} fogged /></td>
                    <td><Pot p={p} league={league} fogged /></td>
                    <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                    <td>{p.pos}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">{money(askingPrice(p))}</td>
                    <td>
                      {isSeason ? (
                        holdingOut ? (
                          <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }} title="Won't take a minimum deal — available in offseason free agency">
                            Holding out for a real contract
                          </span>
                        ) : (
                          <button
                            className="btn small"
                            disabled={team.roster.length >= ROSTER_MAX}
                            title={team.roster.length >= ROSTER_MAX ? 'Roster full (15)' : `Rest-of-season minimum: ${money(proratedMinSalary(league))}`}
                            onClick={() => signMin(p)}
                          >
                            Sign Min
                          </button>
                        )
                      ) : (
                        <button className="btn small" disabled={!isOpen} onClick={() => toggleNegotiation(p)}>
                          {negotiatingId === p.id ? 'Close' : counter ? 'Counter…' : 'Negotiate'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {negotiatingId === p.id && isOpen && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--bg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 4px' }}>
                          <label>
                            Salary ($M):{' '}
                            <input
                              type="number"
                              min={MIN_SALARY / 1e6}
                              max={MAX_SALARY / 1e6}
                              step={0.5}
                              value={salaryM}
                              onChange={(e) => setSalaryM(Number(e.target.value))}
                              style={{ width: 80 }}
                            />
                          </label>
                          <label>
                            Years:{' '}
                            <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
                              {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                          </label>
                          <button className="btn small" disabled={left <= 0} onClick={() => offer(p, salaryM, years)}>
                            Submit Offer
                          </button>
                          <span style={{ color: 'var(--muted)' }}>
                            {left > 0 ? `${left} offer${left === 1 ? '' : 's'} left this round` : 'Agent unavailable until next round'}
                          </span>
                          {counter && (
                            <span style={{ color: 'var(--accent)' }}>
                              Counter on the table: {money(counter.salary)} x {counter.years}yr{' '}
                              <button className="btn small" onClick={() => offer(p, counter.salary / 1e6, counter.years)}>
                                Accept Counter
                              </button>
                            </span>
                          )}
                        </div>
                        {res && !(res.ok && res.decision === 'accept') && (
                          <div style={{ padding: '0 4px 6px', color: !res.ok || res.decision === 'reject' ? 'var(--red)' : 'var(--accent)' }}>
                            {res.ok ? res.reason : res.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
