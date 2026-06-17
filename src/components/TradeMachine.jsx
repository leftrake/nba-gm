import React, { useState, useEffect } from 'react';
import { getTeam, payroll, tradesLocked } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { scoutedOverall, isHidden } from '../engine/scouting.js';
import { tradeValue, validateMultiTrade, aiEvaluateMultiTrade, executeMultiTrade, resolveMultiTradeLegs } from '../engine/trade.js';
import { getTeamPicks, pickValue, pickLabel } from '../engine/draftPicks.js';
import { applyShoppedPenalty } from '../engine/morale.js';
import { teamNeeds } from '../engine/strategy.js';
import { ownerSignoffRequired, ownerBlocksTrade, ownerStance } from '../engine/owner.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { safeAccent, textOnColor } from '../engine/colorUtils.js';
import { Ovr, Pot, StrategyTag, money, PlayerLink, GuideTooltip } from './shared.jsx';
import { Card, Button, SectionHeader, Divider } from './ui/index.js';

// Map raw trade value to 0.5–5 star rating in 0.5 increments.
// Thresholds derived from the actual league-wide trade value distribution
// (420 rostered players): each tier covers roughly ~35–55 players so every
// band feels meaningfully different. Picks share the same scale.
const STAR_THRESHOLDS = [
  [8000, 5],   // superstar / elite young player   (~top 10%)
  [5500, 4.5], // franchise star                   (~top 18%)
  [3800, 4],   // clear All-Star                   (~top 28%)
  [2800, 3.5], // quality starter / borderline AS  (~top 38%)
  [1900, 3],   // solid starter                    (~top 50%)
  [1200, 2.5], // average starter                  (~top 63%)
  [700, 2],    // rotation player                  (~top 72%)
  [400, 1.5],  // depth piece                      (~top 80%)
  [100, 1],    // bench / 2nd-round pick            (~top 89%)
  [0, 0.5],    // fringe / throwaway               (bottom ~10%)
];

function valueToStars(v) {
  return (STAR_THRESHOLDS.find(([min]) => v >= min) ?? [0, 0.5])[1];
}

// Clips the ★ glyph to its left half — a clean half-star with no special Unicode.
function HalfStar() {
  return (
    <span style={{
      background: 'linear-gradient(to right, var(--color-warning) 50%, transparent 50%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }}>★</span>
  );
}

function StarRating({ value }) {
  const stars = valueToStars(value);
  const full = Math.floor(stars);
  const half = stars % 1 !== 0;
  return (
    <span title={`Trade value: ${value}`} style={{ color: 'var(--color-warning)', whiteSpace: 'nowrap', letterSpacing: 1 }}>
      {'★'.repeat(full)}{half ? <HalfStar /> : null}
    </span>
  );
}

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
  const projColor = projected <= SALARY_CAP ? 'var(--color-success)' : projected <= LUXURY_TAX ? 'var(--color-warning)' : 'var(--color-danger)';
  const teamSends = sends[team.id] || { players: {}, picks: {} };
  const otherTeams = teamIds.filter((id) => id !== team.id).map((id) => getTeam(league, id));
  const picks = getTeamPicks(league, team.id);
  const fogged = (p) => team.id !== userId && !p.everOnUserTeam;
  const seenOvr = (p) => {
    if (!fogged(p)) return overall(p);
    const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
    if (isHidden(p, proGames)) return -Infinity;
    return scoutedOverall(p, league.season, proGames);
  };
  const sortedRoster = [...team.roster].sort((a, b) => seenOvr(b) - seenOvr(a));
  const needs = team.id !== userId ? teamNeeds(team) : null;
  const destTeam = (assetId, kind) => {
    const destId = teamSends[kind][assetId] ?? otherTeams[0]?.id;
    return destId != null ? getTeam(league, destId) : null;
  };

  const accentColor = safeAccent(team.color);
  const isUser = team.id === userId;

  return (
    <Card
      style={{
        '--team-color': team.color,
        '--team-color-safe': accentColor,
        '--team-color-text': textOnColor(team.color),
        borderTop: `3px solid ${accentColor}`,
        ...(isUser ? { borderColor: 'var(--team-color-line)' } : null),
      }}
    >
      {/* Team header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
        {changeTeamAt ? (
          <select
            value={team.id}
            onChange={(e) => changeTeamAt(e.target.value)}
            style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: accentColor, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: 'var(--sp-1) var(--sp-2)', borderRadius: 'var(--radius-sm)', flex: 1, cursor: 'pointer' }}
          >
            {league.teams.filter((t) => t.id === team.id || !teamIds.includes(t.id)).map((t) => {
              const space = SALARY_CAP - payroll(t);
              const spaceLabel = space >= 0 ? `${money(space)} cap space` : `${money(-space)} over cap`;
              return (
                <option key={t.id} value={t.id}>{t.city} {t.name} ({t.strategy}, {spaceLabel})</option>
              );
            })}
          </select>
        ) : (
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-base)', color: accentColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {team.city} {team.name}
          </div>
        )}
        {removeTeam && <Button variant="ghost" size="sm" onClick={removeTeam}>Remove</Button>}
      </div>

      {!isUser && <StrategyTag team={team} />}

      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: 'var(--sp-1)' }}>
        {money(pay)} payroll · {capSpace >= 0 ? `${money(capSpace)} cap space` : `${money(-capSpace)} over cap`} · {taxDistance >= 0 ? `${money(taxDistance)} below tax` : `${money(-taxDistance)} into tax`}
      </p>
      <p style={{ marginTop: 'var(--sp-1)' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Projected: </span>
        <span className="cap-impact" style={{ color: projColor }}>{money(projected)}</span>
      </p>

      {/* Sends */}
      <div className="ui-section-title" style={{ marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-2)' }}>Sends</div>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th></th><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th>
              <th className="num">Age</th><th className="num">Salary</th><th className="num">Value</th>
              {teamIds.length > 2 && <th>To</th>}
            </tr>
          </thead>
          <tbody>
            {sortedRoster.map((p) => {
              const checked = teamSends.players[p.id] != null;
              return (
                <tr key={p.id} className="clickable" onClick={() => toggleAsset(team.id, 'players', p.id)}>
                  <td><input type="checkbox" readOnly checked={checked} /></td>
                  <td><Ovr p={p} league={league} fogged={fogged(p)} /></td>
                  <td><Pot p={p} league={league} fogged={fogged(p)} /></td>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  <td>{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">{money(p.contract.salary)}</td>
                  <td className="num"><StarRating value={tradeValue(p, undefined, destTeam(p.id, 'players'))} /></td>
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
      </div>

      {picks.length > 0 && (
        <div className="ui-table-wrap" style={{ marginTop: 'var(--sp-2)' }}>
          <table className="ui-table">
            <thead>
              <tr>
                <th></th><th>Pick</th><th className="num">Value</th>
                {teamIds.length > 2 && <th>To</th>}
              </tr>
            </thead>
            <tbody>
              {picks.map((pick) => {
                const checked = teamSends.picks[pick.id] != null;
                return (
                  <tr key={pick.id} className="clickable" onClick={() => toggleAsset(team.id, 'picks', pick.id)}>
                    <td><input type="checkbox" readOnly checked={checked} /></td>
                    <td>{pickLabel(pick)}</td>
                    <td className="num"><StarRating value={pickValue(league, pick, destTeam(pick.id, 'picks')?.strategy)} /></td>
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
        </div>
      )}

      {/* Receives */}
      {(leg.inPlayers.length > 0 || leg.inPicks.length > 0) && (
        <>
          <div className="ui-section-title" style={{ marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-2)' }}>Receives</div>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Ovr</th><th>Pot</th><th>Player / Pick</th><th>Pos</th>
                  <th className="num">Age</th><th className="num">Salary</th><th className="num">Value</th><th>From</th>
                </tr>
              </thead>
              <tbody>
                {leg.inPlayers.map((p) => {
                  const owner = legs.find((l) => l.outPlayers.includes(p))?.team;
                  const pFogged = owner?.id !== userId && !p.everOnUserTeam;
                  return (
                    <tr key={p.id} className="trade-asset-enter">
                      <td><Ovr p={p} league={league} fogged={pFogged} /></td>
                      <td><Pot p={p} league={league} fogged={pFogged} /></td>
                      <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                      <td>{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">{money(p.contract.salary)}</td>
                      <td className="num"><StarRating value={tradeValue(p, undefined, team)} /></td>
                      <td>{owner?.name}</td>
                    </tr>
                  );
                })}
                {leg.inPicks.map((pick) => {
                  const owner = legs.find((l) => l.outPicks.includes(pick))?.team;
                  return (
                    <tr key={pick.id} className="trade-asset-enter">
                      <td colSpan={6}>{pickLabel(pick)}</td>
                      <td className="num"><StarRating value={pickValue(league, pick, team.strategy)} /></td>
                      <td>{owner?.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Needs */}
      {needs && (
        <>
          <Divider space="sm" />
          <div className="ui-section-title" style={{ marginBottom: 'var(--sp-1)' }}>Needs</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Thin at {needs.thin.map((x) => `${x.pos} (${x.rating})`).join(', ')}
          </p>
          <p style={{ fontStyle: 'italic', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--sp-1)' }}>{needs.note}</p>
        </>
      )}
    </Card>
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

  const deadlinePassed = tradesLocked(league);
  const lockedText = league.phase === 'playoffs'
    ? 'Trades are locked for the playoffs. They reopen once the offseason begins.'
    : 'Trades are now locked until next season. Any moves you wanted to make had to happen before today.';

  return (
    <div className="warroom page-fade">
      {/* Header: title + actions + message feedback */}
      <Card>
        <SectionHeader
          title={
            deadlinePassed ? (
              <GuideTooltip tipKey="trade_deadline" text={lockedText} block>
                Trade Machine
              </GuideTooltip>
            ) : 'Trade Machine'
          }
          action={
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <Button variant="primary" size="md" onClick={propose} disabled={!hasAnyAsset || deadlinePassed}>
                Propose Trade
              </Button>
              {teamIds.length < 4 && (
                <Button variant="secondary" size="sm" onClick={addTeam}>+ Add Team</Button>
              )}
            </div>
          }
        />
        {message && (
          <div style={{
            marginTop: 'var(--sp-3)',
            padding: 'var(--sp-3)',
            borderRadius: 'var(--radius-sm)',
            background: message.type === 'ok' ? 'var(--color-success-soft)' : 'var(--color-danger-soft)',
            border: `1px solid ${message.type === 'ok' ? 'var(--color-success-line)' : 'var(--color-danger-line)'}`,
          }}>
            {message.lines.map((line, i) => (
              <p key={i} style={{ color: message.type === 'ok' ? 'var(--color-success)' : 'var(--color-danger)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-snug)' }}>
                {line}
              </p>
            ))}
          </div>
        )}
      </Card>

      {/* Deal summary: one mini-card per team + value meter */}
      {hasAnyAsset && (
        <Card>
          <SectionHeader title="Deal Summary" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--sp-3)' }}>
            {legs.map((leg) => {
              const legIsUser = leg.team.id === userId;
              const salOut = leg.outPlayers.reduce((s, p) => s + p.contract.salary, 0);
              const assets = [
                ...leg.outPlayers.map((p) => `${p.name} (${money(p.contract.salary)})`),
                ...leg.outPicks.map((pick) => pickLabel(pick)),
              ];
              return (
                <Card key={leg.team.id} elevation="sunken" style={{ borderTop: `3px solid ${safeAccent(leg.team.color)}` }}>
                  <div style={{ fontWeight: 'var(--weight-semibold)', color: legIsUser ? 'var(--team-color-safe)' : safeAccent(leg.team.color), marginBottom: 'var(--sp-1)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {legIsUser ? 'You send' : `${leg.team.name} sends`}
                  </div>
                  {assets.length > 0 ? (
                    <>
                      <div style={{ fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-snug)' }}>{assets.join(', ')}</div>
                      {leg.outPlayers.length > 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: 'var(--sp-1)' }}>{money(salOut)} in salary</div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--text-sm)' }}>Nothing sent</div>
                  )}
                </Card>
              );
            })}
          </div>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <div className="value-meter">
              <div className="side-a" style={{ width: `${givePct}%` }} />
              <div className="side-b" style={{ width: `${100 - givePct}%` }} />
            </div>
            <div className="value-meter-labels">
              <span>You give ({Math.round(givePct)}%)</span>
              <span>You get ({Math.round(100 - givePct)}%)</span>
            </div>
          </div>
        </Card>
      )}

      {/* Team panels grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--sp-4)' }}>
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
    </div>
  );
}
