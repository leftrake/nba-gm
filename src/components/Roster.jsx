import React, { useState } from 'react';
import { getTeam, payroll, deadMoneyTotal, releasePlayer, standings, dateForDay, askingPrice, offerExtension } from '../engine/league.js';
import { extensionType, extensionSalaryRange, extensionWindowLabel, rookieMax } from '../engine/extensions.js';
import { overall, supportedMinutes, posLabel } from '../engine/players.js';
import { POSITIONS, TOTAL_MINUTES, autoLineup, normalizeLineup, lineupErrors, lineupWarnings, playerFit, isInjured } from '../engine/lineup.js';
import { scoutedOverall } from '../engine/scouting.js';
import { getTeamPicks, pickLabel } from '../engine/draftPicks.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { Ovr, Pot, Sta, Cond, Morale, InjuryTag, OvrArc, posStripe, money, perGame, fgPct, fmtDate, TeamLink, PlayerLink, StrategyTag } from './shared.jsx';

// Visual cap breakdown: each contract as a proportional block colored by
// years remaining (green = 1yr, yellow = 2-3yr, red = 4yr+), dead money as
// a faded block, with cap/tax line markers.
function CapBreakdown({ team, pay, dead }) {
  const scale = Math.max(LUXURY_TAX, pay + dead) * 1.02;
  const segs = [...team.roster]
    .filter((p) => p.contract)
    .sort((a, b) => b.contract.salary - a.contract.salary)
    .map((p) => {
      const yrs = p.contract.years;
      const cls = yrs <= 1 ? 'yr1' : yrs <= 3 ? 'yr23' : 'yr4plus';
      return { key: p.id, label: p.name.split(' ').slice(-1)[0], width: (p.contract.salary / scale) * 100, cls, title: `${p.name} — ${money(p.contract.salary)}/yr, ${yrs} yr${yrs === 1 ? '' : 's'} left` };
    });
  const deadWidth = (dead / scale) * 100;
  const capPct = (SALARY_CAP / scale) * 100;
  const taxPct = (LUXURY_TAX / scale) * 100;
  return (
    <div>
      <div className="cap-bar-v2">
        {segs.map((s) => (
          <div key={s.key} className={`cap-seg ${s.cls}`} style={{ width: `${s.width}%` }} title={s.title}>
            {s.width > 5 ? s.label : ''}
          </div>
        ))}
        {dead > 0 && (
          <div className="cap-seg dead" style={{ width: `${deadWidth}%` }} title={`Dead money — ${money(dead)}`}>
            {deadWidth > 4 ? 'Dead' : ''}
          </div>
        )}
        <div className="cap-bar-v2-marker" style={{ left: `${capPct}%` }} title={`Salary cap — ${money(SALARY_CAP)}`} />
        <div className="cap-bar-v2-marker" style={{ left: `${taxPct}%` }} title={`Luxury tax — ${money(LUXURY_TAX)}`} />
      </div>
      <div className="cap-legend">
        <span><span className="dot" style={{ background: 'var(--green)' }} /> 1 yr left</span>
        <span><span className="dot" style={{ background: 'var(--yellow)' }} /> 2–3 yrs</span>
        <span><span className="dot" style={{ background: 'var(--red)' }} /> 4+ yrs</span>
        {dead > 0 && <span><span className="dot" style={{ background: 'var(--muted)', opacity: 0.6 }} /> Dead money</span>}
        <span style={{ marginLeft: 'auto' }}>Cap {money(SALARY_CAP)} · Tax {money(LUXURY_TAX)}</span>
      </div>
    </div>
  );
}

// Rival scouting view: star players (fogged), cap situation, strategy, and
// recent form as W/L dots, shown in place of a detailed roster table.
function FrontOfficeSnapshot({ league, team, pay, dead, recent, openPlayer }) {
  const stars = [...team.roster].sort((a, b) => scoutedOverall(b, league.season) - scoutedOverall(a, league.season)).slice(0, 4);
  const form = recent.map(({ g, r }) => {
    if (!r) return null;
    const home = g.home === team.id;
    const myPts = home ? r.homePts : r.awayPts;
    const oppPts = home ? r.awayPts : r.homePts;
    return myPts > oppPts ? 'W' : 'L';
  }).filter(Boolean);

  return (
    <div className="panel" style={{ borderLeft: '4px solid var(--team-color)' }}>
      <h2>Front Office Snapshot</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {stars.map((p) => (
          <div key={p.id} className="panel" style={{ flex: '1 1 150px', margin: 0, padding: 10, borderTop: '3px solid var(--team-color)' }}>
            <div style={{ fontWeight: 700 }}><PlayerLink p={p} openPlayer={openPlayer} /></div>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{posLabel(p)} · Age {p.age}</div>
            <Ovr p={p} league={league} fogged />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div><span style={{ color: 'var(--muted)', fontSize: 12 }}>Strategy</span><br /><StrategyTag team={team} /></div>
        <div>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Last 5</span><br />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {form.length === 0 && <span style={{ color: 'var(--muted)' }}>–</span>}
            {form.map((r, i) => (
              <span key={i} className="tag" style={{ color: r === 'W' ? 'var(--green)' : 'var(--red)', borderColor: r === 'W' ? 'var(--green)' : 'var(--red)' }}>{r}</span>
            ))}
          </div>
        </div>
      </div>
      <CapBreakdown team={team} pay={pay} dead={dead} />
    </div>
  );
}

// Small marker next to a minutes box when the assignment outruns the
// player's stamina — legal, but the fatigue sim will make him pay.
function OverStamina({ p, min }) {
  if (!p) return null;
  const sup = Math.round(supportedMinutes(p));
  if (!(min > sup + 2)) return null;
  return (
    <span style={{ color: 'var(--red)', marginLeft: 4 }} title={`${min} min assigned, but his stamina supports ~${sup} — he'll wear down late in games`}>
      ⚠
    </span>
  );
}

// Minutes box that doesn't fight the typist: focusing selects the current
// value (so typing replaces the 0 instead of appending to it), and the field
// may sit empty mid-edit — it only commits parseable values, settling on
// blur.
function MinInput({ value, onChange, disabled }) {
  const [draft, setDraft] = useState(null); // null = not editing, mirror the prop
  return (
    <input
      type="number" min={0} max={48}
      style={{ width: 56 }}
      disabled={disabled}
      value={draft ?? value}
      onFocus={(e) => { setDraft(String(value)); e.target.select(); }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value !== '') onChange(e.target.value);
      }}
      onBlur={() => { if (draft === '') onChange(0); setDraft(null); }}
    />
  );
}

export default function Roster({ league, commit, teamId, openTeam, openPlayer, onTradeFor }) {
  const [sortKey, setSortKey] = useState('ovr');
  const [posFilter, setPosFilter] = useState('all');
  const [dragIndex, setDragIndex] = useState(null);
  const [pickSlot, setPickSlot] = useState(null); // position whose starter is being chosen
  const [extendingId, setExtendingId] = useState(null); // player being offered an extension
  const [extSalaryM, setExtSalaryM] = useState(5);
  const [extYears, setExtYears] = useState(3);
  const [extResponses, setExtResponses] = useState({}); // playerId -> last offerExtension result
  const [extMessage, setExtMessage] = useState(null);
  const team = getTeam(league, teamId);
  const isUser = teamId === league.userTeamId;
  const pay = payroll(team);
  const dead = deadMoneyTotal(team);
  const seed = standings(league, team.conf).findIndex((t) => t.id === team.id) + 1;

  const games = [];
  league.schedule.forEach((dayGames, di) => {
    const g = dayGames.find((x) => x.home === team.id || x.away === team.id);
    if (g) {
      const r = (league.resultsByDay?.[di] || []).find((x) => x.home === g.home && x.away === g.away);
      games.push({ di, g, r });
    }
  });
  const recent = games.filter((x) => x.di < league.dayIndex).slice(-5).reverse();
  const upcoming = games.filter((x) => x.di >= league.dayIndex).slice(0, 5);
  const oppOf = (g) => getTeam(league, g.home === team.id ? g.away : g.home);

  // ---- Lineup editing (user team only). Handlers normalize the stored
  // lineup against the current roster, mutate, write back, and commit.
  const lineup = isUser ? normalizeLineup(team.lineup, team.roster) : null;
  const luErrors = isUser ? lineupErrors(lineup, team.roster) : [];
  const luWarnings = isUser && luErrors.length === 0 ? lineupWarnings(lineup, team.roster) : [];
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const totalMin = isUser
    ? POSITIONS.reduce((s, pos) => s + (lineup.starters[pos].id != null ? lineup.starters[pos].min : 0), 0)
      + lineup.bench.reduce((s, b) => s + b.min, 0)
    : 0;

  const saveLineup = (lu) => { team.lineup = lu; commit(); };

  const setStarter = (pos, id) => {
    const lu = normalizeLineup(team.lineup, team.roster);
    const slot = lu.starters[pos];
    const prev = slot.id;
    if (id === prev) return;
    if (id == null) {
      // vacating: the old starter goes to the front of the bench with the
      // slot's minutes, so the 240 total is preserved
      if (prev != null) lu.bench.unshift({ id: prev, min: slot.min });
      slot.id = null;
      slot.min = 0;
    } else {
      const other = POSITIONS.find((q) => lu.starters[q].id === id);
      if (other) {
        lu.starters[other].id = prev; // swap slots; minutes stay with the slot
      } else {
        const bi = lu.bench.findIndex((b) => b.id === id);
        const benchMin = bi >= 0 ? lu.bench[bi].min : 0;
        if (bi >= 0) lu.bench.splice(bi, 1);
        if (prev != null) lu.bench.unshift({ id: prev, min: benchMin });
        else slot.min = slot.min || benchMin;
      }
      slot.id = id;
    }
    saveLineup(lu);
  };

  const setStarterMin = (pos, v) => {
    const lu = normalizeLineup(team.lineup, team.roster);
    lu.starters[pos].min = Math.max(0, Math.min(48, Math.round(Number(v) || 0)));
    saveLineup(lu);
  };

  const setBenchMin = (id, v) => {
    const lu = normalizeLineup(team.lineup, team.roster);
    const b = lu.bench.find((x) => x.id === id);
    if (b) b.min = Math.max(0, Math.min(48, Math.round(Number(v) || 0)));
    saveLineup(lu);
  };

  const reorderBench = (from, to) => {
    if (from === to) return;
    const lu = normalizeLineup(team.lineup, team.roster);
    const [moved] = lu.bench.splice(from, 1);
    lu.bench.splice(to, 0, moved);
    saveLineup(lu);
  };

  // ---- Extension offers (user team, regular season only)
  const extTalks = league.extensionTalks;
  const canExtend = isUser && league.phase === 'regular';

  const toggleExtend = (p) => {
    if (extendingId === p.id) { setExtendingId(null); return; }
    const counter = extTalks[p.id]?.counter;
    const type = extensionType(p);
    const range = extensionSalaryRange(p, type);
    setExtendingId(p.id);
    const defaultSalary = counter ? counter.salary : type === 'rookie' ? range.max : askingPrice(p);
    setExtSalaryM(clampM(defaultSalary, range) / 1e6);
    setExtYears(counter ? counter.years : type === 'rookie' ? 4 : 3);
  };

  // Clamp a salary (in dollars) into an extension type's allowed range.
  const clampM = (salary, range) => Math.min(Math.max(salary, range.min), range.max);

  const offerExt = (p, salM, yrs) => {
    const res = offerExtension(league, teamId, p.id, Math.round(salM * 10) * 100_000, yrs);
    setExtResponses((r) => ({ ...r, [p.id]: res }));
    if (res.ok && res.decision === 'accept') {
      setExtMessage(res.reason);
      setExtendingId(null);
    } else {
      setExtMessage(null);
    }
    commit();
  };

  const seenOvr = (p) => (isUser ? overall(p) : scoutedOverall(p, league.season));
  const filtered = posFilter === 'all'
    ? team.roster
    : team.roster.filter((p) => p.pos === posFilter || p.pos2 === posFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'ovr') return seenOvr(b) - seenOvr(a);
    if (sortKey === 'age') return a.age - b.age;
    if (sortKey === 'salary') return (b.contract?.salary || 0) - (a.contract?.salary || 0);
    if (sortKey === 'pts') return (b.stats.gp ? b.stats.pts / b.stats.gp : 0) - (a.stats.gp ? a.stats.pts / a.stats.gp : 0);
    return 0;
  });
  // Group starters before bench (preserving the chosen sort within each
  // group) so the table can show a divider between the two.
  const starterIds = isUser ? new Set(POSITIONS.map((pos) => lineup.starters[pos].id).filter((id) => id != null)) : new Set();
  const rosterRows = isUser
    ? [...sorted.filter((p) => starterIds.has(p.id)), ...sorted.filter((p) => !starterIds.has(p.id))]
    : sorted;

  return (
    <div style={{ '--team-color': team.color }}>
      <div className="panel" style={{ borderLeft: `4px solid var(--team-color)` }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="team-logo" style={{ width: 56, height: 56, fontSize: 20, background: team.color }}>{team.id}</div>
          <div style={{ flex: 1 }}>
            <div className="display-font" style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2 }}>{team.city}</div>
            <h1 className="display-font" style={{ fontSize: 30, margin: '2px 0' }}>{team.name} {isUser && <span className="tag">YOUR TEAM</span>}</h1>
            <div className="score-big" style={{ fontSize: 22 }}>
              {team.wins}-{team.losses}
              <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'inherit', fontWeight: 400, marginLeft: 10 }}>#{seed} in the {team.conf}</span>
              {!isUser && <span style={{ marginLeft: 10, verticalAlign: 'middle' }}><StrategyTag team={team} /></span>}
            </div>
          </div>
          <select value={teamId} onChange={(e) => openTeam(e.target.value)}>
            {league.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.city} {t.name}</option>
            ))}
          </select>
        </div>
        {isUser && (
          <>
            <p style={{ marginTop: 8 }}>
              Payroll: <b>{money(pay)}</b> / Cap {money(SALARY_CAP)}
              {dead > 0 && <span style={{ color: 'var(--muted)' }}> (incl. {money(dead)} dead money)</span>}
              {pay > LUXURY_TAX && <span className="tag" style={{ color: 'var(--red)', marginLeft: 8 }}>LUXURY TAX</span>}
              <span style={{ marginLeft: 10 }}><StrategyTag team={team} /></span>
            </p>
            <CapBreakdown team={team} pay={pay} dead={dead} />
          </>
        )}
      </div>

      {!isUser && (
        <FrontOfficeSnapshot league={league} team={team} pay={pay} dead={dead} recent={recent} openPlayer={openPlayer} />
      )}

      <div className="grid2">
        <div className="panel">
          <h2>Recent Results</h2>
          {recent.length === 0 && <p style={{ color: 'var(--muted)' }}>No games played yet.</p>}
          {recent.map(({ di, g, r }) => {
            const opp = oppOf(g);
            const home = g.home === team.id;
            const myPts = r ? (home ? r.homePts : r.awayPts) : null;
            const oppPts = r ? (home ? r.awayPts : r.homePts) : null;
            return (
              <div className="result-row" key={di}>
                <span style={{ color: 'var(--muted)' }}>{fmtDate(dateForDay(league, di))}</span>
                <span>{home ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam}>{opp.name}</TeamLink></span>
                {r ? (
                  <span>
                    <b style={{ color: myPts > oppPts ? 'var(--green)' : 'var(--red)' }}>{myPts > oppPts ? 'W' : 'L'}</b>
                    {' '}{myPts}-{oppPts}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>–</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="panel">
          <h2>Upcoming Games</h2>
          {upcoming.length === 0 && <p style={{ color: 'var(--muted)' }}>Regular season complete.</p>}
          {upcoming.map(({ di, g }) => {
            const opp = oppOf(g);
            return (
              <div className="result-row" key={di}>
                <span style={{ color: 'var(--muted)' }}>{fmtDate(dateForDay(league, di))}</span>
                <span>{g.home === team.id ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam}>{opp.name}</TeamLink></span>
                <span className="num" style={{ color: 'var(--muted)' }}>{opp.wins}-{opp.losses}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h2>Future Picks</h2>
        {(() => {
          const picks = getTeamPicks(league, team.id);
          if (!picks.length) return <p style={{ color: 'var(--muted)' }}>No picks owned.</p>;
          return (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {picks.map((pick) => (
                <span key={pick.id} className="tag">{pickLabel(pick)}</span>
              ))}
            </div>
          );
        })()}
      </div>

      {isUser && (
        <div className="panel">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <h2 style={{ marginBottom: 0 }}>Lineup</h2>
            <button className="btn secondary small" onClick={() => saveLineup(autoLineup(team.roster))}>Auto-Fill</button>
            <span className="meta" style={{ color: totalMin === TOTAL_MINUTES ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              {totalMin}/{TOTAL_MINUTES} minutes
            </span>
          </div>
          {luErrors.length > 0 && (
            <div style={{ color: 'var(--red)', marginBottom: 10 }}>
              {luErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
              <div style={{ color: 'var(--muted)' }}>Until this is fixed, games use an auto-set rotation instead.</div>
            </div>
          )}
          {luWarnings.length > 0 && (
            <div style={{ color: '#d29922', marginBottom: 10 }}>
              {luWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <div className="grid2">
            <div>
              <h2 style={{ fontSize: 14 }}>Starters</h2>
              <table>
                <thead>
                  <tr><th>Slot</th><th>Player</th><th className="num">Ovr</th><th>Fit</th><th className="num">Cond</th><th className="num">Min</th></tr>
                </thead>
                <tbody>
                  {POSITIONS.map((pos) => {
                    const slot = lineup.starters[pos];
                    const p = slot.id != null ? byId.get(slot.id) : null;
                    const fit = p ? playerFit(p, pos) : 1;
                    return (
                      <tr key={pos}>
                        <td><b>{pos}</b></td>
                        <td>
                          <button
                            className="slot-pick"
                            style={p ? undefined : { color: 'var(--red)' }}
                            onClick={() => setPickSlot(pos)}
                            title={`Choose your starting ${pos}`}
                          >
                            {p ? p.name : 'empty — pick a starter'}{p && isInjured(p) ? ' 🩹' : ''} <span style={{ color: 'var(--muted)' }}>▾</span>
                          </button>
                        </td>
                        <td className="num">{p ? overall(p) : '–'}</td>
                        <td>
                          {p && fit < 1 && (
                            <span className="tag" style={{ color: fit <= 0.85 ? 'var(--red)' : 'var(--muted)' }}>
                              {p.pos} −{Math.round((1 - fit) * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="num">{p ? <Cond p={p} /> : '–'}</td>
                        <td className="num">
                          <MinInput
                            value={slot.min}
                            disabled={slot.id == null}
                            onChange={(v) => setStarterMin(pos, v)}
                          />
                          <OverStamina p={p} min={slot.min} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ borderLeft: '2px solid var(--team-color)', paddingLeft: 14 }}>
              <h2 style={{ fontSize: 14 }}>Bench Rotation</h2>
              <table>
                <thead>
                  <tr><th></th><th>Player</th><th>Pos</th><th className="num">Ovr</th><th className="num">Cond</th><th className="num">Min</th></tr>
                </thead>
                <tbody>
                  {lineup.bench.map((b, i) => {
                    const p = byId.get(b.id);
                    if (!p) return null;
                    return (
                      <tr
                        key={b.id}
                        draggable
                        onDragStart={() => setDragIndex(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (dragIndex != null) reorderBench(dragIndex, i); setDragIndex(null); }}
                        onDragEnd={() => setDragIndex(null)}
                        style={{ ...(b.min === 0 ? { opacity: 0.55 } : null), ...(dragIndex === i ? { opacity: 0.4 } : null) }}
                      >
                        <td style={{ whiteSpace: 'nowrap', cursor: 'grab', color: 'var(--muted)' }} title="Drag to reorder">⠿</td>
                        <td><PlayerLink p={p} openPlayer={openPlayer} />{isInjured(p) ? ' 🩹' : ''}</td>
                        <td>{posLabel(p)}</td>
                        <td className="num">{overall(p)}</td>
                        <td className="num"><Cond p={p} /></td>
                        <td className="num">
                          <MinInput
                            value={b.min}
                            disabled={isInjured(p)}
                            onChange={(v) => setBenchMin(b.id, v)}
                          />
                          <OverStamina p={p} min={b.min} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="meta" style={{ color: 'var(--muted)', marginTop: 8 }}>
                Bench players sub in at their natural position. 0 minutes = out of the rotation.
              </p>
            </div>
          </div>

          {pickSlot && (
            <div className="modal-overlay" onClick={() => setPickSlot(null)}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ marginBottom: 0 }}>Starting {pickSlot}</h2>
                  <span className="meta" style={{ color: 'var(--muted)', flex: 1 }}>
                    Ranked by value at {pickSlot}
                  </span>
                  {lineup.starters[pickSlot].id != null && (
                    <button className="btn secondary small" onClick={() => { setStarter(pickSlot, null); setPickSlot(null); }}>
                      Clear Slot
                    </button>
                  )}
                  <button className="btn secondary small" onClick={() => setPickSlot(null)}>✕</button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Player</th><th>Pos</th><th>Role</th>
                      <th className="num">Ovr</th><th className="num">At {pickSlot}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...team.roster]
                      .sort((a, b) => overall(b) * playerFit(b, pickSlot) - overall(a) * playerFit(a, pickSlot))
                      .map((rp) => {
                        const fit = playerFit(rp, pickSlot);
                        const eff = Math.round(overall(rp) * fit);
                        const startsAt = POSITIONS.find((q) => lineup.starters[q].id === rp.id);
                        const benchIdx = lineup.bench.findIndex((b) => b.id === rp.id);
                        const injured = isInjured(rp);
                        return (
                          <tr
                            key={rp.id}
                            className={injured ? '' : 'clickable'}
                            style={{
                              ...(injured ? { opacity: 0.45 } : null),
                              ...(startsAt === pickSlot ? { background: 'var(--panel2)', boxShadow: 'inset 3px 0 0 var(--accent)' } : null),
                            }}
                            onClick={() => {
                              if (injured) return;
                              setStarter(pickSlot, rp.id);
                              setPickSlot(null);
                            }}
                          >
                            <td>{rp.name}{injured ? ' 🩹' : ''}</td>
                            <td>{posLabel(rp)}</td>
                            <td style={{ color: 'var(--muted)' }}>
                              {startsAt === pickSlot ? <b style={{ color: 'var(--accent)' }}>current</b>
                                : startsAt ? `Starts at ${startsAt}`
                                : benchIdx >= 0 ? `Bench #${benchIdx + 1}`
                                : '–'}
                            </td>
                            <td className="num"><span className="ovr">{overall(rp)}</span></td>
                            <td className="num">
                              {eff}
                              {fit < 1 && (
                                <span style={{ color: fit <= 0.85 ? 'var(--red)' : 'var(--muted)', marginLeft: 6, fontSize: 12 }}>
                                  −{Math.round((1 - fit) * 100)}%
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>Roster</h2>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="ovr">Sort: Overall</option>
            <option value="age">Sort: Age</option>
            <option value="salary">Sort: Salary</option>
            <option value="pts">Sort: PPG</option>
          </select>
          <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
            <option value="all">All Positions</option>
            {POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
          <span className="meta" style={{ color: 'var(--muted)' }}>
            {filtered.length}{filtered.length !== team.roster.length ? ` of ${team.roster.length}` : ''} players
          </span>
        </div>
        {extMessage && <p style={{ marginBottom: 10, color: 'var(--green)' }}>{extMessage}</p>}
        <table>
          <thead>
            <tr>
              <th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th>
              <th className="num" title="Stamina — how many minutes a night he can handle">Sta</th>
              <th className="num" title="Condition — drains with heavy minutes, recovers on rest days">Cond</th>
              <th title="Morale — team chemistry and happiness">Morale</th>
              <th className="num">PPG</th><th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th>
              <th className="num">Salary</th><th className="num">Yrs</th><th></th>
              {isUser && <th></th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rosterRows.map((p, i) => (
              <React.Fragment key={p.id}>
              {isUser && i > 0 && starterIds.has(rosterRows[i - 1].id) && !starterIds.has(p.id) && (
                <tr>
                  <td colSpan={17} style={{ padding: 0, borderBottom: '2px solid var(--team-color)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, padding: '4px 8px' }}>Bench</div>
                  </td>
                </tr>
              )}
              {(() => { const extType = extensionType(p); return (
              <>
              <tr className={posStripe(p)}>
                <td>{isUser ? <OvrArc value={overall(p)} /> : <Ovr p={p} league={league} fogged={!isUser} />}</td>
                <td><Pot p={p} league={league} fogged={!isUser} /></td>
                <td><PlayerLink p={p} openPlayer={openPlayer} /><InjuryTag p={p} /></td>
                <td>{posLabel(p)}</td>
                <td className="num">{p.age}</td>
                <td className="num"><Sta p={p} league={league} fogged={!isUser} /></td>
                <td className="num"><Cond p={p} /></td>
                <td><Morale p={p} /></td>
                <td className="num">{perGame(p.stats, 'pts')}</td>
                <td className="num">{perGame(p.stats, 'reb')}</td>
                <td className="num">{perGame(p.stats, 'ast')}</td>
                <td className="num">{fgPct(p.stats)}</td>
                <td className="num">{p.contract ? money(p.contract.salary) : '–'}</td>
                <td className="num">{p.contract?.years ?? '–'}</td>
                <td>
                  {p.extension ? (
                    <span className="tag" style={{ color: 'var(--green)' }} title={`Extension starts when the current deal ends: ${money(p.extension.salary)}/yr × ${p.extension.years}`}>
                      EXT ✓
                    </span>
                  ) : extType === 'rookie' ? (
                    <span className="tag" style={{ color: 'var(--red)', fontWeight: 'bold' }} title={`Rookie-scale extension window — capped at ${money(rookieMax(p))}/yr. ${extensionWindowLabel('rookie')}`}>
                      RFX ELIGIBLE
                    </span>
                  ) : extType === 'final' ? (
                    <span className="tag" style={{ color: 'var(--accent)' }} title={extensionWindowLabel('final')}>
                      EXPIRING
                    </span>
                  ) : extType === 'veteran' ? (
                    <span className="tag" title={extensionWindowLabel('veteran')}>
                      EXT
                    </span>
                  ) : null}
                </td>
                {isUser && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canExtend && extType && (
                      <button className="btn small" onClick={() => toggleExtend(p)}>
                        {extendingId === p.id ? 'Close' : extTalks[p.id]?.counter ? 'Counter…' : 'Extend…'}
                      </button>
                    )}
                    {!canExtend && extType && (
                      <span style={{ color: 'var(--muted)', fontSize: 11 }} title="Extensions can only be negotiated during the regular season">
                        {extType === 'rookie' ? 'RFX' : extType === 'veteran' ? 'EXT' : 'EXP'} — offseason
                      </span>
                    )}
                    {' '}
                    <button
                      className="btn danger small"
                      disabled={team.roster.length <= 8}
                      onClick={() => {
                        const c = p.contract;
                        const deadMsg = c
                          ? `Their ${money(c.salary)}/yr stays on your cap as dead money for ${c.years} more season${c.years === 1 ? '' : 's'} (${money(c.salary * c.years)} total).`
                          : 'They have no contract, so no dead money is created.';
                        if (confirm(`Waive ${p.name}? ${deadMsg}`)) {
                          releasePlayer(league, teamId, p.id);
                          commit();
                        }
                      }}
                    >
                      Waive
                    </button>
                  </td>
                )}
                <td>
                  {onTradeFor && (
                    <button className="btn small secondary" onClick={() => onTradeFor(p)}>Trade</button>
                  )}
                </td>
              </tr>
              {extendingId === p.id && canExtend && (() => {
                const range = extensionSalaryRange(p, extType);
                return (
                <tr>
                  <td colSpan={17} style={{ background: 'var(--bg)' }}>
                    <div style={{ padding: '6px 4px 0', color: 'var(--muted)', fontSize: 12 }}>
                      {extensionWindowLabel(extType)}
                      {extType === 'rookie' && <> Rookie max: {money(rookieMax(p))}/yr.</>}
                      {extType === 'veteran' && <> Range: {money(range.min)}–{money(range.max)}/yr (±20% of current salary).</>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 4px' }}>
                      <span style={{ color: 'var(--muted)' }}>Market rate: {money(askingPrice(p))}/yr</span>
                      <label>
                        Salary ($M):{' '}
                        <input
                          type="number"
                          min={range.min / 1e6}
                          max={range.max / 1e6}
                          step={0.5}
                          value={extSalaryM}
                          onChange={(e) => setExtSalaryM(Number(e.target.value))}
                          style={{ width: 80 }}
                        />
                      </label>
                      <label>
                        Years:{' '}
                        <select value={extYears} onChange={(e) => setExtYears(Number(e.target.value))}>
                          {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </label>
                      <button className="btn small" onClick={() => offerExt(p, extSalaryM, extYears)}>
                        Offer Extension
                      </button>
                      {extTalks[p.id]?.counter && (
                        <span style={{ color: 'var(--accent)' }}>
                          Counter on the table: {money(extTalks[p.id].counter.salary)}/yr x {extTalks[p.id].counter.years}yr{' '}
                          <button className="btn small" onClick={() => offerExt(p, extTalks[p.id].counter.salary / 1e6, extTalks[p.id].counter.years)}>
                            Accept Counter
                          </button>
                        </span>
                      )}
                    </div>
                    {extResponses[p.id] && !(extResponses[p.id].ok && extResponses[p.id].decision === 'accept') && (
                      <div style={{ padding: '0 4px 6px', color: !extResponses[p.id].ok || extResponses[p.id].decision === 'reject' ? 'var(--red)' : 'var(--accent)' }}>
                        {extResponses[p.id].ok ? extResponses[p.id].reason : extResponses[p.id].error}
                      </div>
                    )}
                  </td>
                </tr>
                );
              })()}
              </>
              ); })()}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {team.deadMoney.length > 0 && (
        <div className="panel">
          <h2>Dead Money</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
            Cap hits from waived contracts. Each entry counts against the cap until the original contract would have expired.
          </p>
          <table>
            <thead>
              <tr><th>Player</th><th className="num">Cap Hit</th><th className="num">Yrs Left</th></tr>
            </thead>
            <tbody>
              {team.deadMoney.map((d, i) => (
                <tr key={i}>
                  <td>{d.playerName}</td>
                  <td className="num">{money(d.salary)}</td>
                  <td className="num">{d.years}</td>
                </tr>
              ))}
              <tr>
                <td><b>Total</b></td>
                <td className="num"><b>{money(dead)}</b></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
