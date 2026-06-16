import React, { useState } from 'react';
import { getTeam, payroll, makeOffer, askingPrice, midSeasonSignable, proratedMinSalary, signMidSeasonFA, signingException, matchOfferSheet } from '../engine/league.js';
import { scoutedOverall, isHidden } from '../engine/scouting.js';
import { traitSortValue } from '../engine/devTraits.js';
import { POSITIONS } from '../engine/lineup.js';
import { SALARY_CAP, MIN_SALARY, MAX_SALARY, MLE_AMOUNT, ROSTER_MAX } from '../data/teams.js';
import { Ovr, Pot, money, PlayerLink, GuideTooltip } from './shared.jsx';

const OFFERS_PER_ROUND = 3;
const FILTERS_KEY = 'nba-gm-fa-filters';

const DEFAULT_FILTERS = { sortKey: 'ovr', sortDir: 'desc', pos: 'all', minAge: '', maxAge: '', maxAskingM: '' };

function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
    return saved ? { ...DEFAULT_FILTERS, ...saved } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function FreeAgency({ league, commit, openPlayer }) {
  const team = getTeam(league, league.userTeamId);
  const room = SALARY_CAP - payroll(team);
  const isOpen = league.phase === 'offseason/freeagency';
  const isSeason = league.phase === 'regular';
  const [negotiatingId, setNegotiatingId] = useState(null);
  const [salaryM, setSalaryM] = useState(5);
  const [years, setYears] = useState(2);
  const [responses, setResponses] = useState({}); // playerId -> last makeOffer result
  const [message, setMessage] = useState(null); // top-level note (signings)
  const [filters, setFilters] = useState(loadFilters);

  const setFilter = (patch) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      try { localStorage.setItem(FILTERS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const negotiations = league.negotiations;

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

  // ---- Filter & sort
  const SORT_VALUE = {
    ovr: (p) => {
      const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
      if (isHidden(p, proGames)) return -Infinity;
      return scoutedOverall(p, league.season, proGames);
    },
    pot: (p) => traitSortValue(p, league.season, league.scouting?.proWatching?.[p.id] ?? 0, true),
    age: (p) => p.age,
    asking: (p) => askingPrice(p),
    pos: (p) => POSITIONS.indexOf(p.pos),
  };
  const dirMul = filters.sortDir === 'asc' ? 1 : -1;
  const sortValue = SORT_VALUE[filters.sortKey] || SORT_VALUE.ovr;
  const minAge = filters.minAge !== '' ? Number(filters.minAge) : -Infinity;
  const maxAge = filters.maxAge !== '' ? Number(filters.maxAge) : Infinity;
  const maxAsking = filters.maxAskingM !== '' ? Number(filters.maxAskingM) * 1e6 : Infinity;
  const filtered = league.freeAgents.filter((p) =>
    (filters.pos === 'all' || p.pos === filters.pos || p.pos2 === filters.pos)
    && p.age >= minAge && p.age <= maxAge
    && askingPrice(p) <= maxAsking
  );
  const shown = [...filtered]
    .sort((a, b) => (sortValue(b) - sortValue(a)) * dirMul);

  const myRfas = league.freeAgents.filter((p) => p.restrictedFA && p.formerTeamId === team.id);
  const offerSheets = league.offerSheets;

  const matchSheet = (p) => {
    const res = matchOfferSheet(league, p.id);
    setMessage(res.ok
      ? { type: 'ok', text: `${p.name} re-signed — offer sheet matched.` }
      : { type: 'err', text: res.error });
    commit();
  };

  return (
    <div className="panel">
      {isOpen && (
        <div style={{ marginBottom: 14, padding: 10, border: '1px solid var(--accent)', borderRadius: 6, textAlign: 'center' }}>
          <strong>Free Agency is now open</strong>
          <span style={{ color: 'var(--muted)' }}> · {league.faDaysLeft} round{league.faDaysLeft === 1 ? '' : 's'} remaining</span>
        </div>
      )}
      {myRfas.length > 0 && (
        <div style={{ marginBottom: 14, padding: 10, border: '1px solid var(--accent)', borderRadius: 6 }}>
          <h3 style={{ marginTop: 0 }}>Your Restricted Free Agents</h3>
          <table>
            <thead>
              <tr>
                <th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Asking</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {myRfas.map((p) => {
                const sheet = offerSheets.find((s) => s.playerId === p.id);
                const roundsLeft = sheet ? sheet.deadlineRound + 1 - league.faDaysLeft : null;
                return (
                  <tr key={p.id}>
                    <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                    <td>{p.pos}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">{money(askingPrice(p))}</td>
                    <td>
                      {sheet ? (
                        <span style={{ color: 'var(--red)' }}>
                          Offer sheet: {money(sheet.salary)}/yr x {sheet.years}yr — {roundsLeft > 0 ? `match within ${roundsLeft} round${roundsLeft === 1 ? '' : 's'} or lose him` : 'last round to match'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>On the open market — no offer sheets yet</span>
                      )}
                    </td>
                    <td>
                      {sheet && (
                        <button className="btn small" disabled={team.roster.length >= ROSTER_MAX} onClick={() => matchSheet(p)}>
                          Match Offer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <GuideTooltip
        tipKey="fogged_ratings"
        text="Rating ranges reflect your scouting knowledge — tighter ranges mean more certainty. Scout players before the draft or trade deadline to get better information."
        block
      >
        <h2>Free Agents</h2>
      </GuideTooltip>
      <p style={{ marginBottom: 10, color: 'var(--muted)' }}>
        Cap room: <b style={{ color: room > 0 ? 'var(--green)' : 'var(--red)' }}>{money(room)}</b> · Roster: {team.roster.length}/{ROSTER_MAX}
        {room <= 0 && (
          <> · Mid-level exception: <b style={{ color: team.usedMLE ? 'var(--red)' : 'var(--green)' }}>{team.usedMLE ? 'used' : `available (up to ${money(MLE_AMOUNT)})`}</b></>
        )}
        {isOpen
          ? ' · Negotiate salary and years — players weigh money, your record, and their role. Other teams sign players every round, including ones you\'re talking to.'
          : isSeason
          ? ` · In-season market: rest-of-season minimum deals only (${money(proratedMinSalary(league))} right now), and you need an open roster spot. Anyone worth a real contract is holding out for the summer.`
          : ' · Signings open during the Free Agency phase (after the offseason advance), but you can browse anytime.'}
      </p>
      {message && <p style={{ marginBottom: 10, color: message.type === 'ok' ? 'var(--green)' : 'var(--red)' }}>{message.text}</p>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <label>
          Position:{' '}
          <select value={filters.pos} onChange={(e) => setFilter({ pos: e.target.value })}>
            <option value="all">All</option>
            {POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </label>
        <label>
          Age:{' '}
          <input type="number" min={18} max={45} value={filters.minAge} placeholder="min"
                 onChange={(e) => setFilter({ minAge: e.target.value })} style={{ width: 56 }} />
          {' – '}
          <input type="number" min={18} max={45} value={filters.maxAge} placeholder="max"
                 onChange={(e) => setFilter({ maxAge: e.target.value })} style={{ width: 56 }} />
        </label>
        <label>
          Max Asking ($M):{' '}
          <input type="number" min={0} value={filters.maxAskingM} placeholder="any"
                 onChange={(e) => setFilter({ maxAskingM: e.target.value })} style={{ width: 70 }} />
        </label>
        {(filters.pos !== 'all' || filters.minAge !== '' || filters.maxAge !== '' || filters.maxAskingM !== '') && (
          <button className="btn secondary small" onClick={() => setFilter({ pos: 'all', minAge: '', maxAge: '', maxAskingM: '' })}>
            Clear Filters
          </button>
        )}
        <span className="meta" style={{ color: 'var(--muted)' }}>
          {filtered.length}{filtered.length !== league.freeAgents.length ? ` of ${league.freeAgents.length}` : ''} free agents
        </span>
      </div>

      <table>
        <thead>
          <tr>
            {[['ovr', 'Ovr'], ['pot', 'Pot'], [null, 'Player'], ['pos', 'Pos'], ['age', 'Age'], ['asking', 'Asking']].map(([key, label]) => (
              <th
                key={label}
                className={key === 'age' || key === 'asking' || key === 'ovr' || key === 'pot' ? 'num' : undefined}
                style={key ? { cursor: 'pointer' } : undefined}
                onClick={key ? () => setFilter(filters.sortKey === key
                  ? { sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' }
                  : { sortKey: key, sortDir: 'desc' }) : undefined}
                title={key ? 'Click to sort' : undefined}
              >
                {label}{filters.sortKey === key ? (filters.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => {
              const res = responses[p.id];
              const counter = negotiations[p.id]?.counter;
              const left = OFFERS_PER_ROUND - offersUsed(p);
              const holdingOut = isSeason && !midSeasonSignable(p);
              return (
                <React.Fragment key={p.id}>
                  <tr style={holdingOut ? { opacity: 0.55 } : undefined}>
                    <td><Ovr p={p} league={league} fogged={!p.everOnUserTeam} /></td>
                    <td><Pot p={p} league={league} fogged={!p.everOnUserTeam} /></td>
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
                          {(() => {
                            const exc = signingException(league, team.id, Math.round(salaryM * 10) * 100_000);
                            if (exc === 'mle') return <span style={{ color: 'var(--accent)' }}>Uses mid-level exception</span>;
                            if (exc === 'minimum') return <span style={{ color: 'var(--accent)' }}>Uses minimum-salary exception</span>;
                            if (!exc) return <span style={{ color: 'var(--red)' }}>Not enough cap room or exceptions for this offer</span>;
                            return null;
                          })()}
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
