import React, { useState } from 'react';
import { getTeam, payroll, deadMoneyTotal, releasePlayer, standings, dateForDay, askingPrice, offerExtension } from '../engine/league.js';
import { extensionType, extensionSalaryRange, extensionWindowLabel, rookieMax } from '../engine/extensions.js';
import { overall, supportedMinutes, posLabel, TRAINING_FOCUS_OPTIONS } from '../engine/players.js';
import { POSITIONS, TOTAL_MINUTES, autoLineup, normalizeLineup, lineupErrors, lineupWarnings, playerFit, isInjured } from '../engine/lineup.js';
import { scoutedOverall, isHidden } from '../engine/scouting.js';
import { getTeamPicks, pickLabel } from '../engine/draftPicks.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { safeAccent, textOnColor } from '../engine/colorUtils.js';
import { Ovr, Pot, Sta, Cond, Morale, InjuryTag, OvrArc, posStripe, money, perGame, fgPct, fmtDate, TeamLink, PlayerLink, StrategyTag, turmoilLabel, turmoilColor, GuideTooltip } from './shared.jsx';
import { MORALE_WARNING_STREAK } from '../engine/morale.js';
import { Section, Tooltip } from './ui/index.js';

// Visual cap breakdown — proportional blocks colored by years remaining.
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

function OverStamina({ p, min }) {
  if (!p) return null;
  const sup = Math.round(supportedMinutes(p));
  if (!(min > sup + 2)) return null;
  return (
    <span style={{ color: 'var(--color-danger)', marginLeft: 4 }} title={`${min} min assigned, but his stamina supports ~${sup} — he'll wear down late in games`}>
      ⚠
    </span>
  );
}

function MinInput({ value, onChange, disabled }) {
  const [draft, setDraft] = useState(null);
  const step = (delta) => {
    const cur = Number(draft ?? value) || 0;
    onChange(Math.max(0, Math.min(48, cur + delta)));
  };
  return (
    <div className="min-stepper">
      <button type="button" className="min-step-btn" disabled={disabled || value <= 0} onClick={() => step(-1)} aria-label="Decrease minutes">−</button>
      <input
        type="number" min={0} max={48}
        className="min-step-input"
        disabled={disabled}
        value={draft ?? value}
        onFocus={(e) => { setDraft(String(value)); e.target.select(); }}
        onChange={(e) => { setDraft(e.target.value); if (e.target.value !== '') onChange(e.target.value); }}
        onBlur={() => { if (draft === '') onChange(0); setDraft(null); }}
      />
      <button type="button" className="min-step-btn" disabled={disabled || value >= 48} onClick={() => step(1)} aria-label="Increase minutes">+</button>
    </div>
  );
}

const TABS = [
  { key: 'lineup', label: 'Lineup' },
  { key: 'stats', label: 'Stats' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'development', label: 'Development' },
];

export default function Roster({ league, commit, teamId, openTeam, openPlayer, onTradeFor }) {
  const [tab, setTab] = useState('lineup');
  const [sortKey, setSortKey] = useState('ovr');
  const [posFilter, setPosFilter] = useState('all');
  const [dragSource, setDragSource] = useState(null); // { kind:'bench', index } | { kind:'starter', pos }
  const [pickSlot, setPickSlot] = useState(null);
  const [extendingId, setExtendingId] = useState(null);
  const [extSalaryM, setExtSalaryM] = useState(5);
  const [extYears, setExtYears] = useState(3);
  const [extResponses, setExtResponses] = useState({});
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
      if (prev != null) lu.bench.unshift({ id: prev, min: slot.min });
      slot.id = null; slot.min = 0;
    } else {
      const other = POSITIONS.find((q) => lu.starters[q].id === id);
      if (other) {
        lu.starters[other].id = prev;
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

  const swapStarters = (posA, posB) => {
    if (posA === posB) return;
    const lu = normalizeLineup(team.lineup, team.roster);
    const idA = lu.starters[posA].id;
    lu.starters[posA].id = lu.starters[posB].id;
    lu.starters[posB].id = idA;
    saveLineup(lu);
  };

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

  const seenOvr = (p) => {
    if (isUser) return overall(p);
    const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
    if (isHidden(p, proGames)) return -Infinity;
    return scoutedOverall(p, league.season, proGames);
  };

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
  const starterIds = isUser ? new Set(POSITIONS.map((pos) => lineup.starters[pos].id).filter((id) => id != null)) : new Set();
  const hasMoraleWarning = team.roster.some((p) => !p.tradeDemand && (p.moraleLowStreak ?? 0) >= MORALE_WARNING_STREAK);
  const hasExtensionEligible = isUser && team.roster.some((p) => !p.extension && extensionType(p) && extensionType(p) !== 'final');
  const rosterRows = isUser
    ? [...sorted.filter((p) => starterIds.has(p.id)), ...sorted.filter((p) => !starterIds.has(p.id))]
    : sorted;

  const prevTeam = () => { const idx = league.teams.findIndex((t) => t.id === teamId); openTeam(league.teams[(idx - 1 + league.teams.length) % league.teams.length].id); };
  const nextTeam = () => { const idx = league.teams.findIndex((t) => t.id === teamId); openTeam(league.teams[(idx + 1) % league.teams.length].id); };

  return (
    <div style={{ '--team-color': team.color, '--team-color-safe': safeAccent(team.color), '--team-color-text': textOnColor(team.color) }}>

      {/* ══ TEAM HEADER ══ */}
      <div className="ui-card" style={{ borderLeft: '4px solid var(--team-color-safe)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="team-logo" style={{ width: 56, height: 56, fontSize: 20, background: team.color, color: textOnColor(team.color) }}>{team.id}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 2 }}>{team.city}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', lineHeight: 'var(--leading-tight)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {team.name}
              {isUser && <span className="ui-badge ui-badge--primary">YOUR TEAM</span>}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              {team.wins}–{team.losses}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontFamily: 'inherit', fontWeight: 400 }}>#{seed} {team.conf}</span>
              {!isUser && <StrategyTag team={team} />}
              <span
                className="ui-badge"
                style={{ color: turmoilColor(team.turmoil ?? 0), borderColor: turmoilColor(team.turmoil ?? 0), background: 'transparent' }}
                title="Locker room turmoil — spikes after trades and waives, decays over time"
              >
                {turmoilLabel(team.turmoil ?? 0)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexShrink: 0 }}>
            <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={prevTeam} title="Previous team">◀</button>
            <select value={teamId} onChange={(e) => openTeam(e.target.value)}>
              {league.teams.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
            </select>
            <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={nextTeam} title="Next team">▶</button>
          </div>
        </div>
      </div>

      {/* ══ CAP STRIP ══ */}
      <div style={{ background: 'var(--surface-0)', borderLeft: '4px solid var(--team-color-safe)', borderBottom: '1px solid var(--border)', padding: 'var(--sp-2) var(--sp-4)', display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="ui-stat ui-stat--sm">
          <span className="ui-stat__value" style={{ color: pay > LUXURY_TAX ? 'var(--color-danger)' : pay > SALARY_CAP ? 'var(--color-warning)' : 'inherit' }}>{money(pay)}</span>
          <span className="ui-stat__label">Payroll</span>
        </div>
        <div className="ui-stat ui-stat--sm">
          <span className="ui-stat__value" style={{ color: 'var(--text-muted)' }}>{money(SALARY_CAP)}</span>
          <span className="ui-stat__label">Salary Cap</span>
        </div>
        <div className="ui-stat ui-stat--sm">
          <span className="ui-stat__value" style={{ color: 'var(--text-muted)' }}>{money(LUXURY_TAX)}</span>
          <span className="ui-stat__label">Lux Tax</span>
        </div>
        {dead > 0 && (
          <div className="ui-stat ui-stat--sm">
            <span className="ui-stat__value" style={{ color: 'var(--text-muted)' }}>{money(dead)}</span>
            <span className="ui-stat__label">Dead Money</span>
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          {pay > LUXURY_TAX && <span className="ui-badge ui-badge--danger">LUXURY TAX</span>}
          {pay <= SALARY_CAP && <span className="ui-badge ui-badge--success">{money(SALARY_CAP - pay)} room</span>}
          {pay > SALARY_CAP && pay <= LUXURY_TAX && <span className="ui-badge ui-badge--warning">Over cap</span>}
          <span className="ui-badge ui-badge--default">{team.roster.length} players</span>
        </div>
      </div>

      {/* ══ TAB BAR ══ */}
      <div style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', padding: '0 var(--sp-4)', display: 'flex', gap: 'var(--sp-1)' }}>
        {TABS.map(({ key, label }) => (
          <button key={key} className={`ui-tab${tab === key ? ' ui-tab--active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* ══ TAB CONTENT ══ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)', padding: 'var(--sp-4)' }}>

        {/* ─── LINEUP ─── */}
        {tab === 'lineup' && (<>
          {isUser && (
            <div className="ui-section">
              <div className="ui-section-header">
                <div className="ui-section-header__action">
                  <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => saveLineup(autoLineup(team.roster))}>Auto-Fill</button>
                  <span style={{ fontSize: 'var(--text-sm)', color: totalMin === TOTAL_MINUTES ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 'var(--weight-semibold)' }}>
                    {totalMin}/{TOTAL_MINUTES} min
                  </span>
                </div>
              </div>
              {luErrors.length > 0 && (
                <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--sp-3)', fontSize: 'var(--text-sm)' }}>
                  {luErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                  <div style={{ color: 'var(--text-muted)' }}>Until fixed, games use an auto rotation.</div>
                </div>
              )}
              {luWarnings.length > 0 && (
                <div style={{ color: 'var(--color-warning)', marginBottom: 'var(--sp-3)', fontSize: 'var(--text-sm)' }}>
                  {luWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
                <div>
                  <div className="ui-section-title" style={{ marginBottom: 'var(--sp-2)' }}>Starters</div>
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead>
                        <tr><th>Slot</th><th>Player</th><th className="num">Ovr</th><th>Fit</th><th className="num">Cond</th><th className="num">Min</th></tr>
                      </thead>
                      <tbody>
                        {POSITIONS.map((pos) => {
                          const slot = lineup.starters[pos];
                          const p = slot.id != null ? byId.get(slot.id) : null;
                          const fit = p ? playerFit(p, pos) : 1;
                          const isDragging = dragSource?.kind === 'starter' && dragSource?.pos === pos;
                          const isDropTarget = dragSource != null && !isDragging;
                          return (
                            <tr
                              key={pos}
                              className={isDropTarget ? 'lineup-drop-target' : ''}
                              style={{ height: 52, ...(isDragging ? { opacity: 0.4 } : null) }}
                              draggable={p != null}
                              onDragStart={() => p && setDragSource({ kind: 'starter', pos })}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (!dragSource) return;
                                if (dragSource.kind === 'bench') {
                                  const id = lineup.bench[dragSource.index]?.id;
                                  if (id) setStarter(pos, id);
                                } else if (dragSource.kind === 'starter') {
                                  swapStarters(dragSource.pos, pos);
                                }
                                setDragSource(null);
                              }}
                              onDragEnd={() => setDragSource(null)}
                            >
                              <td style={{ cursor: p ? 'grab' : 'default', color: 'var(--text-muted)', whiteSpace: 'nowrap', userSelect: 'none' }} title={p ? 'Drag to swap' : undefined}>
                                <span className="drag-handle">{p ? '⠿' : ''}</span> <b>{pos}</b>
                              </td>
                              <td>
                                <button className="slot-pick" style={p ? undefined : { color: 'var(--color-danger)' }} onClick={() => setPickSlot(pos)} title={`Choose your starting ${pos}`}>
                                  {p ? (
                                    <>
                                      <a className="team-link" onClick={(e) => { e.stopPropagation(); openPlayer?.(p); }}>
                                        {p.name}{isInjured(p) ? ' 🩹' : ''}
                                      </a>
                                      {' '}
                                      <span style={{ color: 'var(--text-muted)' }}>▾</span>
                                    </>
                                  ) : (
                                    <>empty — pick a starter <span style={{ color: 'var(--text-muted)' }}>▾</span></>
                                  )}
                                </button>
                              </td>
                              <td className="num">{p ? overall(p) : '–'}</td>
                              <td>
                                {p && fit < 1 && (
                                  <span className="ui-badge" style={{ color: fit <= 0.85 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                                    {p.pos} −{Math.round((1 - fit) * 100)}%
                                  </span>
                                )}
                              </td>
                              <td className="num">{p ? <Cond p={p} /> : '–'}</td>
                              <td className="num">
                                <MinInput value={slot.min} disabled={slot.id == null} onChange={(v) => setStarterMin(pos, v)} />
                                <OverStamina p={p} min={slot.min} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={{ borderLeft: '2px solid var(--team-color-safe)', paddingLeft: 'var(--sp-4)' }}>
                  <div className="ui-section-title" style={{ marginBottom: 'var(--sp-2)' }}>Bench Rotation</div>
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead>
                        <tr><th></th><th>Player</th><th>Pos</th><th className="num">Ovr</th><th className="num">Cond</th><th className="num">Min</th></tr>
                      </thead>
                      <tbody>
                        {lineup.bench.map((b, i) => {
                          const p = byId.get(b.id);
                          if (!p) return null;
                          const isDragging = dragSource?.kind === 'bench' && dragSource?.index === i;
                          const isDropTarget = dragSource?.kind === 'bench' && !isDragging;
                          return (
                            <tr
                              key={b.id}
                              className={isDropTarget ? 'lineup-drop-target' : ''}
                              draggable
                              onDragStart={() => setDragSource({ kind: 'bench', index: i })}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (!dragSource) return;
                                if (dragSource.kind === 'bench') {
                                  reorderBench(dragSource.index, i);
                                } else if (dragSource.kind === 'starter') {
                                  setStarter(dragSource.pos, null);
                                }
                                setDragSource(null);
                              }}
                              onDragEnd={() => setDragSource(null)}
                              style={{ ...(b.min === 0 ? { opacity: 0.55 } : null), ...(isDragging ? { opacity: 0.35 } : null) }}
                            >
                              <td className="drag-handle" title="Drag to reorder">⠿</td>
                              <td><PlayerLink p={p} openPlayer={openPlayer} />{isInjured(p) ? ' 🩹' : ''}</td>
                              <td>{posLabel(p)}</td>
                              <td className="num">{overall(p)}</td>
                              <td className="num"><Cond p={p} /></td>
                              <td className="num">
                                <MinInput value={b.min} onChange={(v) => setBenchMin(b.id, v)} />
                                <OverStamina p={p} min={b.min} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-2)' }}>
                    Bench players sub in at their natural position. 0 minutes = out of the rotation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isUser && (
            <div className="ui-section">
              <div className="ui-section-header">
                <div className="ui-section-header__left">
                  <GuideTooltip tipKey="fogged_ratings" text="Rating ranges reflect your scouting knowledge — tighter ranges mean more certainty." block>
                    <div className="ui-section-title">Depth Chart</div>
                  </GuideTooltip>
                </div>
                <div className="ui-section-header__action">
                  <StrategyTag team={team} />
                  {(() => {
                    const form = recent.map(({ g, r }) => {
                      if (!r) return null;
                      const home = g.home === team.id;
                      const myPts = home ? r.homePts : r.awayPts;
                      const oppPts = home ? r.awayPts : r.homePts;
                      return myPts > oppPts ? 'W' : 'L';
                    }).filter(Boolean);
                    return form.length > 0 && (
                      <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Last 5</span>
                        {form.map((r, i) => (
                          <span key={i} className="ui-badge" style={{ color: r === 'W' ? 'var(--color-success)' : 'var(--color-danger)', borderColor: r === 'W' ? 'var(--color-success)' : 'var(--color-danger)' }}>{r}</span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
              {(() => {
                const fogOvr = (p) => { const g = league.scouting?.proWatching?.[p.id] ?? 0; return isHidden(p, g) ? -Infinity : scoutedOverall(p, league.season, g); };
                const sorted = [...team.roster].sort((a, b) => fogOvr(b) - fogOvr(a));
                return (
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Pos</th>
                          <th className="num">Age</th>
                          <th className="num">Ovr</th>
                          <th className="num">Cond</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((p) => (
                          <tr key={p.id} className="clickable" onClick={() => openPlayer?.(p)}>
                            <td><PlayerLink p={p} openPlayer={openPlayer} />{isInjured(p) ? ' 🩹' : ''}</td>
                            <td>{posLabel(p)}</td>
                            <td className="num">{p.age}</td>
                            <td className="num"><Ovr p={p} league={league} fogged /></td>
                            <td className="num"><Cond p={p} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <div className="ui-section">
              <div className="ui-section-header"><div className="ui-section-header__left"><div className="ui-section-title">Recent Results</div></div></div>
              {recent.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No games played yet.</p>}
              {recent.map(({ di, g, r }) => {
                const opp = oppOf(g);
                const home = g.home === team.id;
                const myPts = r ? (home ? r.homePts : r.awayPts) : null;
                const oppPts = r ? (home ? r.awayPts : r.homePts) : null;
                return (
                  <div className="result-row" key={di}>
                    <span style={{ color: 'var(--text-muted)' }}>{fmtDate(dateForDay(league, di))}</span>
                    <span>{home ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam}>{opp.name}</TeamLink></span>
                    {r ? (
                      <span>
                        <b style={{ color: myPts > oppPts ? 'var(--color-success)' : 'var(--color-danger)' }}>{myPts > oppPts ? 'W' : 'L'}</b>
                        {' '}{myPts}-{oppPts}
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>–</span>}
                  </div>
                );
              })}
            </div>
            <div className="ui-section">
              <div className="ui-section-header"><div className="ui-section-header__left"><div className="ui-section-title">Upcoming Games</div></div></div>
              {upcoming.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Regular season complete.</p>}
              {upcoming.map(({ di, g }) => {
                const opp = oppOf(g);
                return (
                  <div className="result-row" key={di}>
                    <span style={{ color: 'var(--text-muted)' }}>{fmtDate(dateForDay(league, di))}</span>
                    <span>{g.home === team.id ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam}>{opp.name}</TeamLink></span>
                    <span className="num" style={{ color: 'var(--text-muted)' }}>{opp.wins}-{opp.losses}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>)}

        {/* ─── STATS ─── */}
        {tab === 'stats' && (
          <div className="ui-section">
            <div className="ui-section-header">
              <div className="ui-section-header__left">
                <div className="ui-section-title">Per-Game Stats</div>
                <div className="ui-section-subtitle">{league.season} season</div>
              </div>
              <div className="ui-section-header__action">
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
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {filtered.length}{filtered.length !== team.roster.length ? ` / ${team.roster.length}` : ''} players
                </span>
              </div>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table sticky-head">
                <thead>
                  <tr>
                    <th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th>
                    <th className="num" title="Stamina">Sta</th>
                    <th className="num">Cond</th>
                    <th className="num">PPG</th><th className="num">RPG</th><th className="num">APG</th>
                    <th className="num">SPG</th><th className="num">BPG</th><th className="num">FG%</th>
                    {onTradeFor && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.id} className={`clickable ${posStripe(p)}`} onClick={() => openPlayer?.(p)}>
                      <td>{isUser ? <OvrArc value={overall(p)} /> : <Ovr p={p} league={league} fogged={!isUser} />}</td>
                      <td><Pot p={p} league={league} fogged={!isUser} /></td>
                      <td><PlayerLink p={p} openPlayer={openPlayer} /><InjuryTag p={p} /></td>
                      <td>{posLabel(p)}</td>
                      <td className="num">{p.age}</td>
                      <td className="num"><Sta p={p} league={league} fogged={!isUser} /></td>
                      <td className="num"><Cond p={p} /></td>
                      <td className="num">{perGame(p.stats, 'pts')}</td>
                      <td className="num">{perGame(p.stats, 'reb')}</td>
                      <td className="num">{perGame(p.stats, 'ast')}</td>
                      <td className="num">{perGame(p.stats, 'stl')}</td>
                      <td className="num">{perGame(p.stats, 'blk')}</td>
                      <td className="num">{fgPct(p.stats)}</td>
                      {onTradeFor && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => onTradeFor(p)}>Trade</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── CONTRACTS ─── */}
        {tab === 'contracts' && (<>
          <div className="ui-section">
            <div className="ui-section-header">
              <div className="ui-section-header__left">
                <div className="ui-section-title">Cap &amp; Contracts</div>
              </div>
            </div>
            {extMessage && <p style={{ marginBottom: 'var(--sp-3)', color: 'var(--color-success)' }}>{extMessage}</p>}
            <CapBreakdown team={team} pay={pay} dead={dead} />
          </div>

          <div className="ui-section">
            <div className="ui-table-wrap">
              <table className="ui-table sticky-head">
                <thead>
                  <tr>
                    <th>Ovr</th><th>Player</th><th>Pos</th><th className="num">Age</th>
                    <th className="num">Salary</th><th className="num">Yrs</th>
                    <th>
                      {hasExtensionEligible ? (
                        <GuideTooltip tipKey="extension_eligible" text="You can lock this player up before he hits free agency.">Status</GuideTooltip>
                      ) : 'Status'}
                    </th>
                    {isUser && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map((p, i) => {
                    const extType = extensionType(p);
                    const isStarter = isUser && starterIds.has(p.id);
                    return (
                      <React.Fragment key={p.id}>
                        {isUser && i > 0 && starterIds.has(rosterRows[i - 1].id) && !isStarter && (
                          <tr>
                            <td colSpan={isUser ? 8 : 7} style={{ padding: 0, borderBottom: '2px solid var(--team-color-safe)' }}>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, padding: '4px 8px' }}>Bench</div>
                            </td>
                          </tr>
                        )}
                        <tr className={`clickable ${posStripe(p)}`} onClick={() => openPlayer?.(p)}>
                          <td>{isUser ? <OvrArc value={overall(p)} /> : <Ovr p={p} league={league} fogged={!isUser} />}</td>
                          <td><PlayerLink p={p} openPlayer={openPlayer} /><InjuryTag p={p} /></td>
                          <td>{posLabel(p)}</td>
                          <td className="num">{p.age}</td>
                          <td className="num">{p.contract ? money(p.contract.salary) : '–'}</td>
                          <td className="num">{p.contract?.years ?? '–'}</td>
                          <td>
                            {p.extension ? (
                              <span className="ui-badge ui-badge--success" title={`Extension: ${money(p.extension.salary)}/yr × ${p.extension.years}`}>EXT ✓</span>
                            ) : extType === 'rookie' ? (
                              <span className="ui-badge ui-badge--danger" title={`Rookie extension window — max ${money(rookieMax(p))}/yr. ${extensionWindowLabel('rookie')}`}>RFX ELIGIBLE</span>
                            ) : extType === 'final' ? (
                              <span className="ui-badge ui-badge--primary" title={extensionWindowLabel('final')}>EXPIRING</span>
                            ) : extType === 'veteran' ? (
                              <span className="ui-badge ui-badge--default" title={extensionWindowLabel('veteran')}>EXT</span>
                            ) : null}
                          </td>
                          {isUser && (
                            <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                              {canExtend && extType && (
                                <button className="ui-btn ui-btn--sm ui-btn--secondary" style={{ marginRight: 'var(--sp-1)' }} onClick={() => toggleExtend(p)}>
                                  {extendingId === p.id ? 'Close' : extTalks[p.id]?.counter ? 'Counter…' : 'Extend…'}
                                </button>
                              )}
                              {!canExtend && extType && (
                                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }} title="Extensions can only be negotiated during the regular season">
                                  {extType === 'rookie' ? 'RFX' : extType === 'veteran' ? 'EXT' : 'EXP'} — offseason
                                </span>
                              )}
                              {' '}
                              <button
                                className="ui-btn ui-btn--sm ui-btn--danger"
                                disabled={team.roster.length <= 8}
                                onClick={() => {
                                  const c = p.contract;
                                  const deadMsg = c
                                    ? `Their ${money(c.salary)}/yr stays on your cap as dead money for ${c.years} more season${c.years === 1 ? '' : 's'} (${money(c.salary * c.years)} total).`
                                    : 'No contract — no dead money.';
                                  if (confirm(`Waive ${p.name}? ${deadMsg}`)) { releasePlayer(league, teamId, p.id); commit(); }
                                }}
                              >Waive</button>
                            </td>
                          )}
                        </tr>
                        {extendingId === p.id && canExtend && (() => {
                          const range = extensionSalaryRange(p, extType);
                          return (
                            <tr>
                              <td colSpan={isUser ? 8 : 7} style={{ background: 'var(--surface-0)' }}>
                                <div style={{ padding: 'var(--sp-1) var(--sp-2)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                                  {extensionWindowLabel(extType)}
                                  {extType === 'rookie' && <> Rookie max: {money(rookieMax(p))}/yr.</>}
                                  {extType === 'veteran' && <> Range: {money(range.min)}–{money(range.max)}/yr.</>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', padding: 'var(--sp-1) var(--sp-2)' }}>
                                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Market: {money(askingPrice(p))}/yr</span>
                                  <label style={{ fontSize: 'var(--text-sm)' }}>
                                    Salary ($M):{' '}
                                    <input type="number" min={range.min / 1e6} max={range.max / 1e6} step={0.5} value={extSalaryM} onChange={(e) => setExtSalaryM(Number(e.target.value))} style={{ width: 80 }} />
                                  </label>
                                  <label style={{ fontSize: 'var(--text-sm)' }}>
                                    Years:{' '}
                                    <select value={extYears} onChange={(e) => setExtYears(Number(e.target.value))}>
                                      {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                  </label>
                                  <button className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => offerExt(p, extSalaryM, extYears)}>Offer Extension</button>
                                  {extTalks[p.id]?.counter && (
                                    <span style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
                                      Counter: {money(extTalks[p.id].counter.salary)}/yr × {extTalks[p.id].counter.years}yr{' '}
                                      <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => offerExt(p, extTalks[p.id].counter.salary / 1e6, extTalks[p.id].counter.years)}>Accept</button>
                                    </span>
                                  )}
                                </div>
                                {extResponses[p.id] && !(extResponses[p.id].ok && extResponses[p.id].decision === 'accept') && (
                                  <div style={{ padding: '0 var(--sp-2) var(--sp-2)', fontSize: 'var(--text-sm)', color: !extResponses[p.id].ok || extResponses[p.id].decision === 'reject' ? 'var(--color-danger)' : 'var(--color-primary)' }}>
                                    {extResponses[p.id].ok ? extResponses[p.id].reason : extResponses[p.id].error}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {team.deadMoney.length > 0 && (
            <div className="ui-section">
              <div className="ui-section-header">
                <div className="ui-section-header__left">
                  <GuideTooltip tipKey="dead_money" text="Dead money is the remaining salary of a waived player. It clears when their original contract would have expired." block>
                    <div className="ui-section-title">Dead Money</div>
                  </GuideTooltip>
                  <div className="ui-section-subtitle">Cap hits from waived contracts.</div>
                </div>
              </div>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr><th>Player</th><th className="num">Cap Hit</th><th className="num">Yrs Left</th></tr>
                  </thead>
                  <tbody>
                    {team.deadMoney.map((d, i) => (
                      <tr key={i}><td>{d.playerName}</td><td className="num">{money(d.salary)}</td><td className="num">{d.years}</td></tr>
                    ))}
                    <tr><td><b>Total</b></td><td className="num"><b>{money(dead)}</b></td><td></td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="ui-section">
            <div className="ui-section-header">
              <div className="ui-section-header__left"><div className="ui-section-title">Future Draft Picks</div></div>
            </div>
            {(() => {
              const picks = getTeamPicks(league, team.id);
              if (!picks.length) return <p style={{ color: 'var(--text-muted)' }}>No picks owned.</p>;
              return (
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {picks.map((pick) => <span key={pick.id} className="ui-badge ui-badge--default">{pickLabel(pick)}</span>)}
                </div>
              );
            })()}
          </div>
        </>)}

        {/* ─── DEVELOPMENT ─── */}
        {tab === 'development' && (
          <div className="ui-section">
            <div className="ui-section-header">
              <div className="ui-section-header__left">
                <div className="ui-section-title">Player Development</div>
                <div className="ui-section-subtitle">{isUser ? 'Progression, dev traits, and training' : 'Scouted potential — ranges tighten as you watch them play'}</div>
              </div>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table sticky-head">
                <thead>
                  <tr>
                    <th>Player</th><th>Pos</th><th className="num">Age</th>
                    <th className="num">Ovr</th>
                    <th className="num" title="Overall change from last season end">Δ</th>
                    <th>
                      {hasMoraleWarning ? (
                        <GuideTooltip tipKey="morale_warning" text="This player is unhappy. Sustained low morale leads to a trade demand.">Morale</GuideTooltip>
                      ) : 'Morale'}
                    </th>
                    <th>Potential</th>
                    {isUser && (
                      <th>
                        <Tooltip content="Applied each offseason — boosts selected attributes, slight regression in one other. No effect on current ratings." position="bottom">
                          Training Focus
                        </Tooltip>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...team.roster].sort((a, b) => overall(b) - overall(a)).map((p) => {
                    const lastEntry = p.ratingHistory?.slice(-1)?.[0];
                    const lastOvr = lastEntry?.[1];
                    const delta = lastOvr != null ? overall(p) - lastOvr : null;
                    return (
                      <tr key={p.id} className={`clickable ${posStripe(p)}`} onClick={() => openPlayer?.(p)}>
                        <td><PlayerLink p={p} openPlayer={openPlayer} /><InjuryTag p={p} /></td>
                        <td>{posLabel(p)}</td>
                        <td className="num">{p.age}</td>
                        <td className="num">{isUser ? <OvrArc value={overall(p)} /> : <Ovr p={p} league={league} fogged={!isUser} />}</td>
                        <td className="num">
                          {delta != null ? (
                            <span style={{ color: delta > 0 ? 'var(--color-success)' : delta < 0 ? 'var(--color-danger)' : 'var(--text-muted)', fontWeight: delta !== 0 ? 'var(--weight-semibold)' : 'inherit' }}>
                              {delta > 0 ? `+${delta}` : delta === 0 ? '—' : delta}
                            </span>
                          ) : '–'}
                        </td>
                        <td><Morale p={p} /></td>
                        <td><Pot p={p} league={league} fogged={!isUser} /></td>
                        {isUser && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <select
                              value={p.trainingFocus || ''}
                              onChange={(e) => { p.trainingFocus = e.target.value || null; commit(); }}
                              style={{ fontSize: 'var(--text-xs)' }}
                            >
                              <option value="">Balanced</option>
                              {TRAINING_FOCUS_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                            </select>
                            {(() => {
                              const f = TRAINING_FOCUS_OPTIONS.find((opt) => opt.id === p.trainingFocus);
                              return f ? (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap' }}>
                                  +{f.boost.join(', ')} · −{f.neglect}
                                </div>
                              ) : null;
                            })()}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* ══ STARTER PICKER MODAL ══ */}
      {pickSlot && (
        <div className="ui-modal-overlay" onClick={() => setPickSlot(null)}>
          <div className="ui-modal ui-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="ui-modal-header">
              <div>
                <div className="ui-modal-title">Starting {pickSlot}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>Ranked by value at {pickSlot}</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                {lineup.starters[pickSlot].id != null && (
                  <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => { setStarter(pickSlot, null); setPickSlot(null); }}>Clear Slot</button>
                )}
                <button className="ui-modal-close" onClick={() => setPickSlot(null)}>✕</button>
              </div>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr><th>Player</th><th>Pos</th><th>Role</th><th className="num">Ovr</th><th className="num">At {pickSlot}</th></tr>
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
                            ...(startsAt === pickSlot ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--color-primary)' } : null),
                          }}
                          onClick={() => { if (injured) return; setStarter(pickSlot, rp.id); setPickSlot(null); }}
                        >
                          <td>{rp.name}{injured ? ' 🩹' : ''}</td>
                          <td>{posLabel(rp)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {startsAt === pickSlot ? <b style={{ color: 'var(--color-primary)' }}>current</b>
                              : startsAt ? `Starts at ${startsAt}`
                              : benchIdx >= 0 ? `Bench #${benchIdx + 1}`
                              : '–'}
                          </td>
                          <td className="num"><span className="ovr">{overall(rp)}</span></td>
                          <td className="num">
                            {eff}
                            {fit < 1 && (
                              <span style={{ color: fit <= 0.85 ? 'var(--color-danger)' : 'var(--text-muted)', marginLeft: 'var(--sp-1)', fontSize: 'var(--text-xs)' }}>
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
        </div>
      )}
    </div>
  );
}
