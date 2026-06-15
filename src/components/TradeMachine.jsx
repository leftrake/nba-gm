import React, { useState, useEffect } from 'react';
import { getTeam, payroll, TRADE_DEADLINE_DAY } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { scoutedOverall } from '../engine/scouting.js';
import { tradeValue, validateMultiTrade, aiEvaluateMultiTrade, executeMultiTrade, resolveMultiTradeLegs } from '../engine/trade.js';
import { getTeamPicks, pickValue, pickLabel } from '../engine/draftPicks.js';
import { applyShoppedPenalty } from '../engine/morale.js';
import { teamNeeds } from '../engine/strategy.js';
import { ownerSignoffRequired, ownerBlocksTrade, ownerStance } from '../engine/owner.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { Ovr, Pot, StrategyTag, money, PlayerLink, GuideTooltip } from './shared.jsx';

const YELLOW = '#d29922';

// Value of a leg from its own team's perspective: outgoing assets are
// valued by whoever would receive them (their needs/strategy), incoming
// assets by this team's own needs/strategy.
function legValue(league, legs, leg) {
  const giveVal = leg.outPlayers.reduce((s, p) => {
    const dest = legs.find((l) => l.inPlayers.includes(p))?.team;
    return s + tradeValue(p, undefined, dest);
  }, 0) + leg.outPicks.reduce((s, p) => {
    const dest = legs.find((l) => l.inPicks.includes(p))?.team;
    return s + pickValue(league, p, dest?.strategy);
  }, 0);
  const getVal = leg.inPlayers.reduce((s, p) => s + tradeValue(p, undefined, leg.team), 0)
    + leg.inPicks.reduce((s, p) => s + pickValue(league, p, leg.team.strategy), 0);
  return { giveVal, getVal };
}

function TeamPanel({ league, team, teamIds, legs, sends, toggleAsset, setDest, changeTeamAt, removeTeam, openPlayer, userId }) {
  const leg = legs.find((l) => l.team.id === team.id);
  const pay = payroll(team);
  const salOut = leg.outPlayers.reduce((s, p) => s + p.contract.salary, 0);
  const salIn = leg.inPlayers.reduce((s, p) => s + p.contract.salary, 0);
  const projected = pay - salOut + salIn;
  const capSpace = SALARY_CAP - pay;
  const taxDistance = LUXURY_TAX - pay;
  const projColor = projected <= SALARY_CAP ? 'var(--green)' : projected <= LUXURY_TAX ? YELLOW : 'var(--red)';
  const teamSends = sends[team.id] || { players: {}, picks: {} };
  const otherTeams = teamIds.filter((id) => id !== team.id).map((id) => getTeam(league, id));
  const picks = getTeamPicks(league, team.id);
  const fogged = team.id !== userId;
  const seenOvr = (p) => (fogged ? scoutedOverall(p, league.season) : overall(p));
  const sortedRoster = [...team.roster].sort((a, b) => seenOvr(b) - seenOvr(a));
  const needs = team.id !== userId ? teamNeeds(team) : null;
  // Value an outgoing asset from the perspective of whoever would receive
  // it: a player who fills the destination's thin spot, or a pick the
  // destination's strategy covets, is worth more to that team.
  const destTeam = (assetId, kind) => {
    const destId = teamSends[kind][assetId] ?? otherTeams[0]?.id;
    return destId != null ? getTeam(league, destId) : null;
  };

  return (
    <div className="panel team-col" style={{ '--team-color': team.color, borderTop: `3px solid ${team.color}`, ...(team.id === userId ? { borderColor: 'var(--team-color-line)', borderTopColor: team.color } : null) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ marginBottom: 0 }}>
          {changeTeamAt ? (
            <select value={team.id} onChange={(e) => changeTeamAt(e.target.value)}>
              {league.teams.filter((t) => t.id === team.id || !teamIds.includes(t.id)).map((t) => {
                const space = SALARY_CAP - payroll(t);
                const spaceLabel = space >= 0 ? `${money(space)} cap space` : `${money(-space)} over cap`;
                return (
                  <option key={t.id} value={t.id}>{t.city} {t.name} ({t.strategy}, {spaceLabel})</option>
                );
              })}
            </select>
          ) : `${team.city} ${team.name}`}
        </h2>
        {removeTeam && <button className="btn secondary" onClick={removeTeam}>Remove</button>}
      </div>
      {team.id !== userId && <StrategyTag team={team} />}
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
        Payroll {money(pay)} · {capSpace >= 0 ? `${money(capSpace)} cap space` : `${money(-capSpace)} over the cap`} · {taxDistance >= 0 ? `${money(taxDistance)} below tax` : `${money(-taxDistance)} into tax`}
      </p>
      <p style={{ marginTop: 6 }}>
        Projected payroll: <span className="cap-impact" style={{ color: projColor }}>{money(projected)}</span>
      </p>

      <h3>Sends</h3>
      <table>
        <thead>
          <tr><th></th><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Salary</th><th className="num">Value</th>{teamIds.length > 2 && <th>To</th>}</tr>
        </thead>
        <tbody>
          {sortedRoster.map((p) => {
            const checked = teamSends.players[p.id] != null;
            return (
              <tr key={p.id} className="clickable" onClick={() => toggleAsset(team.id, 'players', p.id)}>
                <td><input type="checkbox" readOnly checked={checked} /></td>
                <td><Ovr p={p} league={league} fogged={fogged} /></td>
                <td><Pot p={p} league={league} fogged={fogged} /></td>
                <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                <td>{p.pos}</td>
                <td className="num">{p.age}</td>
                <td className="num">{money(p.contract.salary)}</td>
                <td className="num" style={{ color: 'var(--muted)' }}>{tradeValue(p, undefined, destTeam(p.id, 'players'))}</td>
                {teamIds.length > 2 && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {checked && (
                      <select value={teamSends.players[p.id]} onChange={(e) => setDest(team.id, 'players', p.id, e.target.value)}>
                        {otherTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {picks.length > 0 && (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr><th></th><th>Pick</th><th className="num">Value</th>{teamIds.length > 2 && <th>To</th>}</tr>
          </thead>
          <tbody>
            {picks.map((pick) => {
              const checked = teamSends.picks[pick.id] != null;
              return (
                <tr key={pick.id} className="clickable" onClick={() => toggleAsset(team.id, 'picks', pick.id)}>
                  <td><input type="checkbox" readOnly checked={checked} /></td>
                  <td>{pickLabel(pick)}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{pickValue(league, pick, destTeam(pick.id, 'picks')?.strategy)}</td>
                  {teamIds.length > 2 && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {checked && (
                        <select value={teamSends.picks[pick.id]} onChange={(e) => setDest(team.id, 'picks', pick.id, e.target.value)}>
                          {otherTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(leg.inPlayers.length > 0 || leg.inPicks.length > 0) && (
        <>
          <h3>Receives</h3>
          <table>
            <thead>
              <tr><th>Ovr</th><th>Pot</th><th>Player / Pick</th><th>Pos</th><th className="num">Age</th><th className="num">Salary</th><th className="num">Value</th><th>From</th></tr>
            </thead>
            <tbody>
              {leg.inPlayers.map((p) => {
                const owner = legs.find((l) => l.outPlayers.includes(p))?.team;
                const pFogged = owner?.id !== userId;
                return (
                  <tr key={p.id} className="trade-asset-enter">
                    <td><Ovr p={p} league={league} fogged={pFogged} /></td>
                    <td><Pot p={p} league={league} fogged={pFogged} /></td>
                    <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                    <td>{p.pos}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">{money(p.contract.salary)}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{tradeValue(p, undefined, team)}</td>
                    <td>{owner?.name}</td>
                  </tr>
                );
              })}
              {leg.inPicks.map((pick) => {
                const owner = legs.find((l) => l.outPicks.includes(pick))?.team;
                return (
                  <tr key={pick.id} className="trade-asset-enter">
                    <td colSpan={6}>{pickLabel(pick)}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{pickValue(league, pick, team.strategy)}</td>
                    <td>{owner?.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {needs && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <h3>Needs</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Thin at {needs.thin.map((x) => `${x.pos} (${x.rating})`).join(', ')}
          </p>
          <p style={{ fontStyle: 'italic', fontSize: 13, color: 'var(--muted)' }}>{needs.note}</p>
        </div>
      )}
    </div>
  );
}

export default function TradeMachine({ league, commit, openPlayer, prefill }) {
  const userId = league.userTeamId;
  const others = league.teams.filter((t) => t.id !== userId);
  const [teamIds, setTeamIds] = useState([userId, others[0].id]);
  const [sends, setSends] = useState({});
  const [message, setMessage] = useState(null);

  // A "Counter in Trade Machine" click from an incoming offer seeds a
  // 2-team deal so the user can tweak it.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.otherId) {
      const s = {
        [userId]: { players: {}, picks: {} },
        [prefill.otherId]: { players: {}, picks: {} },
      };
      for (const id of prefill.give || []) s[userId].players[id] = prefill.otherId;
      for (const id of prefill.givePicks || []) s[userId].picks[id] = prefill.otherId;
      for (const id of prefill.get || []) s[prefill.otherId].players[id] = userId;
      for (const id of prefill.getPicks || []) s[prefill.otherId].picks[id] = userId;
      setTeamIds([userId, prefill.otherId]);
      setSends(s);
    }
    setMessage(null);
  }, [prefill?.key]);

  const legs = resolveMultiTradeLegs(league, teamIds, sends);
  const hasAnyAsset = legs.some((l) => l.outPlayers.length || l.outPicks.length);
  const userLeg = legs.find((l) => l.team.id === userId);
  const { giveVal: myGive, getVal: myGet } = legValue(league, legs, userLeg);
  const meterTotal = myGive + myGet;
  const givePct = meterTotal > 0 ? (myGive / meterTotal) * 100 : 50;

  const toggleAsset = (teamId, kind, id) => {
    setSends((prev) => {
      const next = { ...prev };
      const teamSends = { players: { ...(next[teamId]?.players || {}) }, picks: { ...(next[teamId]?.picks || {}) } };
      if (teamSends[kind][id] != null) {
        delete teamSends[kind][id];
      } else {
        teamSends[kind][id] = teamIds.find((id2) => id2 !== teamId);
      }
      next[teamId] = teamSends;
      return next;
    });
    setMessage(null);
  };

  const setDest = (teamId, kind, id, destId) => {
    setSends((prev) => {
      const next = { ...prev };
      const teamSends = { players: { ...(next[teamId]?.players || {}) }, picks: { ...(next[teamId]?.picks || {}) } };
      teamSends[kind][id] = destId;
      next[teamId] = teamSends;
      return next;
    });
    setMessage(null);
  };

  // Drop any sends pointing at `goneId` (a removed/swapped team) and that
  // team's own sends entirely.
  const dropTeam = (prevSends, goneId) => {
    const next = {};
    for (const [tid, s] of Object.entries(prevSends)) {
      if (tid === goneId) continue;
      const players = {};
      for (const [pid, dest] of Object.entries(s.players || {})) if (dest !== goneId) players[pid] = dest;
      const picks = {};
      for (const [pid, dest] of Object.entries(s.picks || {})) if (dest !== goneId) picks[pid] = dest;
      next[tid] = { players, picks };
    }
    return next;
  };

  const addTeam = () => {
    if (teamIds.length >= 4) return;
    const avail = league.teams.find((t) => !teamIds.includes(t.id));
    if (!avail) return;
    setTeamIds([...teamIds, avail.id]);
    setMessage(null);
  };

  const removeTeam = (id) => {
    if (id === userId || teamIds.length <= 2) return;
    setTeamIds(teamIds.filter((t) => t !== id));
    setSends((prev) => dropTeam(prev, id));
    setMessage(null);
  };

  const changeTeamAt = (index, newId) => {
    const oldId = teamIds[index];
    if (newId === oldId) return;
    const newTeamIds = [...teamIds];
    newTeamIds[index] = newId;
    setTeamIds(newTeamIds);
    setSends((prev) => dropTeam(prev, oldId));
    setMessage(null);
  };

  const propose = () => {
    if (!hasAnyAsset) return;
    const userTeam = getTeam(league, userId);
    const validation = validateMultiTrade(league, teamIds, sends);
    if (!validation.ok) {
      const lines = Object.entries(validation.perTeam)
        .filter(([, v]) => !v.ok)
        .map(([tid, v]) => v.reason);
      setMessage({ type: 'error', lines: lines.length ? lines : [validation.reason || 'Invalid trade.'] });
      return;
    }
    if (ownerBlocksTrade(userTeam, myGive, myGet, Math.random)) {
      setMessage({ type: 'error', lines: ["Ownership sources say this deal doesn't fit our direction — the front office pulls it back."] });
      return;
    }
    if (ownerSignoffRequired(userTeam, myGive, myGet)) {
      const ok = window.confirm(
        `${ownerStance(userTeam.owner)}. Ownership wants to sign off on a deal this size — proceed anyway?`
      );
      if (!ok) {
        setMessage({ type: 'error', lines: ['Trade not submitted — ownership sign-off declined.'] });
        return;
      }
    }
    const evalns = aiEvaluateMultiTrade(league, teamIds, sends, userId, validation.legs);
    const rejections = Object.entries(evalns).filter(([, e]) => !e.accept);
    if (!rejections.length) {
      executeMultiTrade(league, teamIds, sends);
      setSends({});
      const partners = validation.legs
        .filter((l) => l.team.id !== userId && (l.inPlayers.length || l.inPicks.length || l.outPlayers.length || l.outPicks.length))
        .map((l) => l.team.name);
      setMessage({ type: 'ok', lines: [`Trade accepted by the ${partners.join(' and ')}!`] });
      commit();
      return;
    }
    const lines = rejections.map(([tid, e]) => {
      const team = getTeam(league, tid);
      if (e.reason) return `The ${team.name} reject the deal: ${e.reason}`;
      const pct = Math.round(e.ratio * 100);
      let note;
      if (pct < 70) {
        note = 'Not even close.';
      } else {
        const ask = team.strategy === 'rebuilding'
          ? 'add a draft pick or a young prospect'
          : team.strategy === 'contending'
            ? 'add proven veteran help or a future pick'
            : 'add a player or a draft pick';
        note = pct < 90 ? `They want more value — ${ask}.` : `They're close — ${ask} to get it done.`;
      }
      return `The ${team.name} reject the deal: they value what they'd receive at ~${pct}% of what they'd give up. ${note}`;
    });
    for (const [tid] of rejections) {
      const leg = validation.legs.find((l) => l.team.id === tid);
      applyShoppedPenalty(leg.inPlayers);
    }
    setMessage({ type: 'error', lines });
    commit();
  };

  const deadlinePassed = league.phase === 'regular' && league.dayIndex > TRADE_DEADLINE_DAY;

  return (
    <div className="warroom" style={{ '--team-color': getTeam(league, userId).color }}>
      <div className="panel">
        {deadlinePassed ? (
          <GuideTooltip
            tipKey="trade_deadline"
            text="Trades are now locked until next season. Any moves you wanted to make had to happen before today."
            block
          >
            <h2>Trade Machine</h2>
          </GuideTooltip>
        ) : (
          <h2>Trade Machine</h2>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={propose} disabled={!hasAnyAsset}>Propose Trade</button>
          {teamIds.length < 4 && (
            <button className="btn secondary" onClick={addTeam}>Add Team</button>
          )}
        </div>
        {message && (
          <div style={{ marginTop: 10 }}>
            {message.lines.map((line, i) => (
              <p key={i} style={{ color: message.type === 'ok' ? 'var(--green)' : 'var(--red)' }}>{line}</p>
            ))}
          </div>
        )}
        {hasAnyAsset && (
          <div style={{ marginTop: 14 }}>
            <div className="value-meter">
              <div className="side-a" style={{ width: `${givePct}%` }} />
              <div className="side-b" style={{ width: `${100 - givePct}%` }} />
            </div>
            <div className="value-meter-labels">
              <span>You give · {myGive}</span>
              <span>You receive · {myGet}</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(300px, 1fr))`, gap: 16 }}>
        {teamIds.map((id, i) => (
          <TeamPanel
            key={id}
            league={league}
            team={getTeam(league, id)}
            teamIds={teamIds}
            legs={legs}
            sends={sends}
            toggleAsset={toggleAsset}
            setDest={setDest}
            changeTeamAt={i > 0 ? (newId) => changeTeamAt(i, newId) : null}
            removeTeam={teamIds.length > 2 && i > 0 ? () => removeTeam(id) : null}
            openPlayer={openPlayer}
            userId={userId}
          />
        ))}
      </div>
      <div className="panel">
        <h2>Trade Value Summary</h2>
        {legs.map((leg) => {
          const { giveVal, getVal } = legValue(league, legs, leg);
          if (!giveVal && !getVal) return null;
          const lopsided = giveVal > 0 && getVal < giveVal * 0.85;
          return (
            <p className="result-row" key={leg.team.id}>
              <span>{leg.team.name}</span>
              <span>
                Gives {giveVal} · Receives {getVal}
                {lopsided && <span className="tag" style={{ color: 'var(--red)', marginLeft: 6 }}>GIVING UP MORE</span>}
              </span>
            </p>
          );
        })}
        {!hasAnyAsset && <p style={{ color: 'var(--muted)' }}>Select players or picks to send to see trade value.</p>}
      </div>
    </div>
  );
}
