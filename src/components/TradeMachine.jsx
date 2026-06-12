import React, { useState, useEffect } from 'react';
import { getTeam } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { scoutedOverall } from '../engine/scouting.js';
import { tradeValue, validateTrade, aiEvaluateTrade, executeTrade } from '../engine/trade.js';
import { applyShoppedPenalty } from '../engine/morale.js';
import { Ovr, Pot, money, PlayerLink } from './shared.jsx';

function TradeSide({ league, team, valueStrategy, fogged, selected, toggle, openPlayer }) {
  const seenOvr = (p) => (fogged ? scoutedOverall(p, league.season) : overall(p));
  const sorted = [...team.roster].sort((a, b) => seenOvr(b) - seenOvr(a));
  return (
    <table>
      <thead>
        <tr><th></th><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Salary</th><th className="num">Value</th></tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.id} className="clickable" onClick={() => toggle(p.id)}>
            <td><input type="checkbox" readOnly checked={selected.includes(p.id)} /></td>
            <td><Ovr p={p} league={league} fogged={fogged} /></td>
            <td><Pot p={p} league={league} fogged={fogged} /></td>
            <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
            <td>{p.pos}</td>
            <td className="num">{p.age}</td>
            <td className="num">{money(p.contract.salary)}</td>
            <td className="num" style={{ color: 'var(--muted)' }}>{tradeValue(p, valueStrategy)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TradeMachine({ league, commit, openPlayer, prefill }) {
  const userId = league.userTeamId;
  const others = league.teams.filter((t) => t.id !== userId);
  const [otherId, setOtherId] = useState(prefill?.otherId ?? others[0].id);
  const [give, setGive] = useState(prefill?.give ?? []);
  const [get, setGet] = useState(prefill?.get ?? []);
  const [message, setMessage] = useState(null);

  // A "Counter in Trade Machine" click from an incoming offer seeds the
  // partner and both sides of the deal so the user can tweak it.
  useEffect(() => {
    if (!prefill) return;
    setOtherId(prefill.otherId);
    setGive(prefill.give);
    setGet(prefill.get);
    setMessage(null);
  }, [prefill?.key]);

  const userTeam = getTeam(league, userId);
  const otherTeam = getTeam(league, otherId);

  const toggle = (list, setList) => (id) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    setMessage(null);
  };

  const changeOther = (id) => {
    setOtherId(id);
    setGet([]);
    setMessage(null);
  };

  const propose = () => {
    const valid = validateTrade(league, userId, give, otherId, get);
    if (!valid.ok) {
      setMessage({ type: 'error', text: `Invalid trade: ${valid.reason}` });
      return;
    }
    const incoming = userTeam.roster.filter((p) => give.includes(p.id));
    const outgoing = otherTeam.roster.filter((p) => get.includes(p.id));
    const evaln = aiEvaluateTrade(league, otherId, incoming, outgoing);
    if (evaln.accept) {
      executeTrade(league, userId, give, otherId, get);
      setGive([]); setGet([]);
      setMessage({ type: 'ok', text: `Trade accepted! The ${otherTeam.name} agree to the deal.` });
      commit();
    } else if (evaln.reason) {
      applyShoppedPenalty(incoming);
      setMessage({ type: 'error', text: `The ${otherTeam.name} reject the offer. ${evaln.reason}` });
      commit();
    } else {
      const pct = Math.round(evaln.ratio * 100);
      applyShoppedPenalty(incoming);
      setMessage({
        type: 'error',
        text: `The ${otherTeam.name} reject the offer. They value your package at ~${pct}% of what they're giving up. ${pct < 70 ? 'Not even close.' : pct < 90 ? 'Add more value.' : 'You\'re close — sweeten it slightly.'}`,
      });
      commit();
    }
  };

  // values shown through the partner's strategy lens, matching how they judge the deal
  const giveVal = userTeam.roster.filter((p) => give.includes(p.id)).reduce((s, p) => s + tradeValue(p, otherTeam.strategy), 0);
  const getVal = otherTeam.roster.filter((p) => get.includes(p.id)).reduce((s, p) => s + tradeValue(p, otherTeam.strategy), 0);

  return (
    <div>
      <div className="panel">
        <h2>Trade Machine</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Trade partner:</span>
          <select value={otherId} onChange={(e) => changeOther(e.target.value)}>
            {others.map((t) => (
              <option key={t.id} value={t.id}>{t.city} {t.name} ({t.wins}-{t.losses}, {t.strategy})</option>
            ))}
          </select>
          <button className="btn" onClick={propose} disabled={!give.length && !get.length}>Propose Trade</button>
          <span style={{ color: 'var(--muted)' }}>You send value {giveVal} · You receive value {getVal} (as the {otherTeam.name} see it)</span>
        </div>
        {message && (
          <p style={{ marginTop: 10, color: message.type === 'ok' ? 'var(--green)' : 'var(--red)' }}>{message.text}</p>
        )}
      </div>
      <div className="grid2">
        <div className="panel">
          <h2>You Send ({userTeam.name})</h2>
          <TradeSide league={league} team={userTeam} valueStrategy={otherTeam.strategy} fogged={false} selected={give} toggle={toggle(give, setGive)} openPlayer={openPlayer} />
        </div>
        <div className="panel">
          <h2>You Receive ({otherTeam.name})</h2>
          <TradeSide league={league} team={otherTeam} valueStrategy={otherTeam.strategy} fogged selected={get} toggle={toggle(get, setGet)} openPlayer={openPlayer} />
        </div>
      </div>
    </div>
  );
}
