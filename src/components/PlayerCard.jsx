import React, { useEffect, useState } from 'react';
import { askingPrice, getTeam } from '../engine/league.js';
import { durabilityNote, ratingRow, posLabel, similarPlayers, overall, formatHeight, TRAINING_FOCUS_OPTIONS, DEV_ARC_LABELS } from '../engine/players.js';
import { ARCHETYPE_LABELS } from '../engine/archetypes.js';
import { injuryTimeline } from '../engine/injuries.js';
import { groupAwards, leaderMinGp } from '../engine/awards.js';
import { positionalPercentiles } from '../engine/stats.js';
import { scoutRange, isHidden } from '../engine/scouting.js';
import { markProWatch, removeProWatch } from '../engine/scoutingTrips.js';
import { personalityNote, scoutBackstoryNote, rookieBlurb } from '../engine/backstory.js';
import { getMilestones, milestoneIcon } from '../engine/milestones.js';
import { recordsHeldBy, POS_NAMES } from '../engine/legacy.js';
import { Ovr, OvrArc, Pot, Cond, PlayerLink, Origin } from './PlayerDisplay.jsx';
import { TeamLink, TeamBadge } from './TeamDisplay.jsx';
import { money, fmtPerGame, fmtFgPct } from './formatters.js';
import ShotChart from './ShotChart.jsx';

const RATINGS = [
  { category: 'Shooting', color: '#4ade80', items: [
    ['closeShot', 'Close Shot'], ['midRange', 'Mid-Range'], ['threePoint', 'Three-Point'], ['freeThrow', 'Free Throw'],
  ] },
  { category: 'Playmaking', color: '#facc15', items: [
    ['passing', 'Passing'], ['ballHandling', 'Ball Handling'],
  ] },
  { category: 'Defense', color: '#60a5fa', items: [
    ['perimeterDefense', 'Perimeter D'], ['interiorDefense', 'Interior D'], ['steal', 'Steal'], ['block', 'Block'],
  ] },
  { category: 'Rebounding', color: '#fb923c', items: [
    ['offensiveRebounding', 'Off. Rebounding'], ['defensiveRebounding', 'Def. Rebounding'],
  ] },
  { category: 'Physical', color: '#c084fc', items: [
    ['speed', 'Speed'], ['strength', 'Strength'], ['stamina', 'Stamina'],
  ] },
];

function barColor(v) {
  if (v >= 85) return '#d2a8ff';
  if (v >= 75) return 'var(--color-success)';
  if (v >= 65) return '#58a6ff';
  if (v >= 55) return 'var(--text-primary)';
  return 'var(--text-muted)';
}

function OverallChart({ points }) {
  const w = 520, h = 130, padX = 26, padY = 22;
  const ovrs = points.map(([, o]) => o);
  const lo = Math.min(...ovrs) - 3;
  const hi = Math.max(...ovrs) + 3;
  const x = (i) => points.length === 1 ? w / 2 : padX + (i * (w - 2 * padX)) / (points.length - 1);
  const y = (o) => h - padY - ((o - lo) / (hi - lo)) * (h - 2 * padY);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block' }}>
      <polyline points={points.map(([, o], i) => `${x(i)},${y(o)}`).join(' ')} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
      {points.map(([season, o], i) => (
        <g key={season}>
          <circle cx={x(i)} cy={y(o)} r="3" fill="var(--color-primary)" />
          <text x={x(i)} y={y(o) - 7} textAnchor="middle" fontSize="11" fill="var(--text-primary)">{o}</text>
          <text x={x(i)} y={h - 5} textAnchor="middle" fontSize="10" fill="var(--text-muted)">'{String(season).slice(2)}</text>
        </g>
      ))}
    </svg>
  );
}

function SeasonStats({ stats }) {
  if (!stats.gp) return <p style={{ color: 'var(--text-muted)' }}>No games played this season.</p>;
  const tp = stats.tpa ? ((stats.tpm / stats.tpa) * 100).toFixed(1) : '–';
  const ft = stats.fta ? ((stats.ftm / stats.fta) * 100).toFixed(1) : '–';
  const cells = [
    ['GP', stats.gp], ['MPG', fmtPerGame(stats, 'min')], ['PPG', fmtPerGame(stats, 'pts')],
    ['RPG', fmtPerGame(stats, 'reb')], ['APG', fmtPerGame(stats, 'ast')], ['SPG', fmtPerGame(stats, 'stl')],
    ['BPG', fmtPerGame(stats, 'blk')], ['FG%', fmtFgPct(stats)], ['3P%', tp], ['FT%', ft],
  ];
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
      {cells.map(([label, v]) => (
        <div key={label} className="ui-stat ui-stat--sm">
          <span className="ui-stat__value">{v}</span>
          <span className="ui-stat__label">{label}</span>
        </div>
      ))}
    </div>
  );
}

const TRANSACTION_LABELS = {
  draft: 'Draft',
  trade: 'Trade',
  'free-agency': 'Free Agency',
  'two-way': 'Two-Way',
  waived: 'Waived',
};

function TransactionHistory({ league, rows, openTeam }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr><th>Season</th><th>Type</th><th>Team</th><th>Details</th></tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((t, i) => (
            <tr key={i}>
              <td>{t.season}</td>
              <td>{TRANSACTION_LABELS[t.type] || t.type}</td>
              <td><TeamLink team={getTeam(league, t.team)} openTeam={openTeam} /></td>
              <td style={{ color: 'var(--text-muted)' }}>{t.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CareerStatsTable({ league, rows, openTeam }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table sticky-head">
        <thead>
          <tr>
            <th>Season</th><th>Team</th><th className="num">GP</th><th className="num">MPG</th><th className="num">PPG</th>
            <th className="num">RPG</th><th className="num">APG</th><th className="num">SPG</th><th className="num">BPG</th>
            <th className="num">TOPG</th><th className="num">FG%</th><th className="num">3P%</th><th className="num">FT%</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((s, i) => (
            <tr key={`${s.season}-${s.team ?? i}`}>
              <td>{s.season}</td>
              <td>{s.team != null ? <TeamLink team={getTeam(league, s.team)} openTeam={openTeam} /> : '–'}</td>
              <td className="num">{s.gp}</td>
              <td className="num">{fmtPerGame(s, 'min')}</td>
              <td className="num">{fmtPerGame(s, 'pts')}</td>
              <td className="num">{fmtPerGame(s, 'reb')}</td>
              <td className="num">{fmtPerGame(s, 'ast')}</td>
              <td className="num">{fmtPerGame(s, 'stl')}</td>
              <td className="num">{fmtPerGame(s, 'blk')}</td>
              <td className="num">{s.tov != null ? fmtPerGame(s, 'tov') : '–'}</td>
              <td className="num">{fmtFgPct(s)}</td>
              <td className="num">{s.tpa ? ((s.tpm / s.tpa) * 100).toFixed(1) : '–'}</td>
              <td className="num">{s.fta ? ((s.ftm / s.fta) * 100).toFixed(1) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MilestonesTab({ p, league }) {
  const milestones = getMilestones(p, league);
  if (milestones.length === 0) {
    return (
      <div className="ui-section">
        <p style={{ color: 'var(--text-muted)' }}>No milestones recorded yet — check back after a few seasons.</p>
      </div>
    );
  }
  return (
    <div className="ui-section">
      {milestones.map((m, i) => (
        <div
          key={i}
          style={{
            display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start',
            paddingBottom: 'var(--sp-3)',
            marginBottom: i < milestones.length - 1 ? 'var(--sp-3)' : 0,
            borderBottom: i < milestones.length - 1 ? '1px solid var(--border)' : undefined,
          }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', minWidth: 36, fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0 }}>
            {m.season}
          </span>
          <span style={{ fontSize: 'var(--text-sm)' }}>
            {milestoneIcon(m.type)} {m.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function RetiredMemorial({ league, p, onClose, openTeam }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totals = (p.careerStats || []).reduce(
    (a, c) => ({ gp: a.gp + c.gp, pts: a.pts + c.pts, reb: a.reb + c.reb, ast: a.ast + c.ast }),
    { gp: 0, pts: 0, reb: 0, ast: 0 }
  );
  const seasons = [...new Set((p.careerStats || []).map((c) => c.season))].sort((a, b) => a - b);
  const recordsHeld = recordsHeldBy(league, p.id);
  const hof = league.hallOfFame?.find((h) => h.playerId === p.id);
  const finalTeam = p.finalTeam != null ? getTeam(league, p.finalTeam) : null;
  const userSeasons = (p.careerStats || []).filter((c) => c.team === league.userTeamId).length;
  const posName = POS_NAMES[p.pos] || p.pos;

  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal ui-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div>
            <div className="ui-modal-title">{p.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
              {posName} · Retired after {p.retiredSeason}
              {finalTeam && <> · last with <TeamLink team={finalTeam} openTeam={openTeam} /></>}
            </div>
          </div>
          <button className="ui-modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', marginBottom: 'var(--sp-5)', paddingBottom: 'var(--sp-4)', borderBottom: '1px solid var(--border)' }}>
          {p.peakOverall != null && (
            <div className="ui-stat ui-stat--md">
              <span className="ui-stat__value"><span className={`ovr ${p.peakOverall >= 85 ? 'elite' : p.peakOverall >= 75 ? 'great' : p.peakOverall >= 65 ? 'good' : 'ok'}`}>{p.peakOverall}</span></span>
              <span className="ui-stat__label">Peak OVR</span>
            </div>
          )}
          <div className="ui-stat ui-stat--md">
            <span className="ui-stat__value">{totals.gp}</span>
            <span className="ui-stat__label">Career GP</span>
          </div>
          <div className="ui-stat ui-stat--md">
            <span className="ui-stat__value">{fmtPerGame(totals, 'pts')}</span>
            <span className="ui-stat__label">PPG</span>
          </div>
          <div className="ui-stat ui-stat--md">
            <span className="ui-stat__value">{fmtPerGame(totals, 'reb')}</span>
            <span className="ui-stat__label">RPG</span>
          </div>
          <div className="ui-stat ui-stat--md">
            <span className="ui-stat__value">{fmtPerGame(totals, 'ast')}</span>
            <span className="ui-stat__label">APG</span>
          </div>
          {p.championships > 0 && (
            <div className="ui-stat ui-stat--md">
              <span className="ui-stat__value">🏆 {p.championships}×</span>
              <span className="ui-stat__label">Champion</span>
            </div>
          )}
        </div>

        {hof && (
          <div className="ui-section">
            <div className="ui-section-header"><div className="ui-section-title">🏛️ Hall of Fame — Class of {hof.inductedSeason}</div></div>
            <p>{hof.narrative}</p>
          </div>
        )}

        {!hof && (
          <div className="ui-section">
            <p style={{ color: 'var(--text-muted)' }}>
              {seasons.length} season{seasons.length === 1 ? '' : 's'} in the league
              {p.draftYear ? <>, drafted {p.draftYear} round {p.draftRound} (pick {p.draftPick}) by <TeamLink team={getTeam(league, p.draftTeam)} openTeam={openTeam} /></> : ', undrafted'}.
            </p>
          </div>
        )}

        {recordsHeld.length > 0 && (
          <div className="ui-section">
            <p style={{ color: 'var(--color-primary)' }}>📜 All-time record holder: {recordsHeld.join(', ')}</p>
          </div>
        )}

        {userSeasons > 0 && (
          <div className="ui-section">
            <p style={{ color: 'var(--team-color-safe)' }}>🤝 Spent {userSeasons} season{userSeasons === 1 ? '' : 's'} with your franchise.</p>
          </div>
        )}

        {p.awards?.length > 0 && (
          <div className="ui-section">
            <div className="ui-section-header"><div className="ui-section-title">Awards</div></div>
            {groupAwards(p.awards).map((g) => (
              <div key={g.award} style={{ marginBottom: 'var(--sp-1)' }}>
                {g.seasons.length > 1 && <b>{g.seasons.length}× </b>}{g.award}{' '}
                <span style={{ color: 'var(--text-muted)' }}>({g.seasons.join(', ')})</span>
              </div>
            ))}
          </div>
        )}

        <div className="ui-section">
          <div className="ui-section-header"><div className="ui-section-title">Season by Season</div></div>
          {p.careerStats.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No recorded seasons.</p>}
          {p.careerStats.length > 0 && (
            <div className="ui-table-wrap">
              <table className="ui-table sticky-head">
                <thead>
                  <tr><th>Season</th><th>Team</th><th className="num">GP</th><th className="num">PPG</th><th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th></tr>
                </thead>
                <tbody>
                  {[...p.careerStats].reverse().map((s, i) => (
                    <tr key={`${s.season}-${s.team ?? i}`}>
                      <td>{s.season}</td>
                      <td>{s.team != null ? <TeamLink team={getTeam(league, s.team)} openTeam={openTeam} /> : '–'}</td>
                      <td className="num">{s.gp}</td>
                      <td className="num">{fmtPerGame(s, 'pts')}</td>
                      <td className="num">{fmtPerGame(s, 'reb')}</td>
                      <td className="num">{fmtPerGame(s, 'ast')}</td>
                      <td className="num">{fmtFgPct(s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TABS = [['stats', 'Stats'], ['milestones', 'Milestones'], ['history', 'History']];

export default function PlayerCard({ league, player: p, onClose, openTeam, openPlayer, onTradeFor, commit }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [tab, setTab] = useState('stats');

  if (p.retiredSeason != null) {
    return <RetiredMemorial league={league} p={p} onClose={onClose} openTeam={openTeam} />;
  }

  const team = league.teams.find((t) => t.roster.some((x) => x.id === p.id) || (t.twoWay || []).some((x) => x.id === p.id));
  const isTwoWay = !!p.contract?.twoWay;
  const fogged = team?.id !== league.userTeamId && !p.everOnUserTeam;

  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div
        className="ui-modal ui-modal--wide"
        onClick={(e) => e.stopPropagation()}
        style={team ? {
          borderTop: `4px solid ${team.color}`,
          backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${team.color} 14%, var(--surface-1)) 0%, var(--surface-1) 60%)`,
        } : undefined}
      >

        {/* Header */}
        <div className="ui-modal-header">
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            {team && <TeamBadge team={team} size="large" />}
            <div style={{ minWidth: 0 }}>
              <div className="ui-modal-title">{p.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
                {posLabel(p)} · {p.age} yrs
                {p.exp != null && <> · {p.exp === 0 ? 'Rookie' : `${p.exp} yr${p.exp === 1 ? '' : 's'} exp`}</>}
                {' · '}{team ? <TeamLink team={team} openTeam={openTeam} /> : 'Free Agent'}
                {isTwoWay && <span className="ui-badge ui-badge--default" style={{ marginLeft: 'var(--sp-2)' }}>Two-Way</span>}
              </div>
              {p.nationality && (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>
                  <Origin p={p} full />
                </div>
              )}
              {p.heightIn != null && (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>
                  {p.jerseyNumber != null && <>#{p.jerseyNumber} · </>}
                  {formatHeight(p.heightIn)} · {p.weightLbs} lbs · {formatHeight(p.wingspanIn)} wingspan
                </div>
              )}
              {p.archetype && (
                <div style={{ marginTop: 5 }}>
                  <span className="ui-pill ui-pill--info">{ARCHETYPE_LABELS[p.archetype] ?? p.archetype}</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start', flexShrink: 0 }}>
            {team && onTradeFor && !isTwoWay && (
              <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => onTradeFor(p)}>Trade</button>
            )}
            {fogged && commit && (() => {
              const isWatching = league.scouting?.proWatchList?.includes(p.id);
              const games = league.scouting?.proWatching?.[p.id] ?? 0;
              return (
                <button
                  className={`ui-btn ui-btn--sm ui-btn--secondary${isWatching ? ' active' : ''}`}
                  onClick={() => { if (isWatching) removeProWatch(league, p.id); else markProWatch(league, p.id); commit(); }}
                >
                  {isWatching ? `Watching (${games} days)` : 'Watch'}
                </button>
              );
            })()}
            <button className="ui-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Headline stat strip */}
        <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)', marginBottom: 'var(--sp-4)' }}>
          <div className="ui-stat ui-stat--md">
            {fogged
              ? <span className="ui-stat__value"><Ovr p={p} league={league} fogged={fogged} /></span>
              : <OvrArc value={overall(p)} size={44} />}
            <span className="ui-stat__label">Overall</span>
          </div>
          <div className="ui-stat ui-stat--md">
            <span className="ui-stat__value"><Pot p={p} league={league} fogged={fogged} /></span>
            <span className="ui-stat__label">Potential</span>
          </div>
          {p.contract ? (
            <>
              <div className="ui-stat ui-stat--md">
                <span className="ui-stat__value">{money(p.contract.salary)}</span>
                <span className="ui-stat__label">Salary / yr</span>
              </div>
              <div className="ui-stat ui-stat--md">
                <span className="ui-stat__value">{p.contract.years}</span>
                <span className="ui-stat__label">Yrs Remaining</span>
              </div>
            </>
          ) : (
            <div className="ui-stat ui-stat--md">
              <span className="ui-stat__value">{money(askingPrice(p))}</span>
              <span className="ui-stat__label">Asking Price</span>
            </div>
          )}
          {p.extension && (
            <div className="ui-stat ui-stat--md">
              <span className="ui-stat__value" style={{ color: 'var(--color-success)' }}>{money(p.extension.salary)} × {p.extension.years}</span>
              <span className="ui-stat__label">Extension Signed</span>
            </div>
          )}
        </div>

        {/* Always-visible alerts */}
        {p.injury && (
          <div style={{ marginBottom: 'var(--sp-3)', color: 'var(--color-danger)' }}>
            🩹 <b>{p.injury.type}</b> — {injuryTimeline(p.injury)}.
          </div>
        )}
        {durabilityNote(p) && (
          <div style={{ marginBottom: 'var(--sp-3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            ⚕ {durabilityNote(p)}.
          </div>
        )}
        <div style={{ marginBottom: p.devArc && p.devArc !== 'standard' ? 'var(--sp-2)' : 'var(--sp-4)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          {p.backstoryRevealed
            ? <>📰 {scoutBackstoryNote(p)}</>
            : (p.exp === 0 && p.draftYear)
            ? rookieBlurb(p)
            : <>Personality: comes across as {personalityNote(p)}.</>}
        </div>
        {p.devArc && p.devArc !== 'standard' && (
          <div style={{ marginBottom: 'var(--sp-4)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Development: <b style={{ color: 'var(--text-primary)' }}>{DEV_ARC_LABELS[p.devArc]}</b>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 'var(--sp-4)', gap: 0 }}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: 'none', border: 'none', padding: 'var(--sp-2) var(--sp-4)',
                cursor: 'pointer', fontSize: 'var(--text-sm)',
                fontWeight: tab === id ? 'var(--weight-bold)' : undefined,
                color: tab === id ? 'var(--color-primary)' : 'var(--text-muted)',
                borderBottom: tab === id ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: -2,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Stats tab ── */}
        {tab === 'stats' && (
          <>
            <div className="ui-section">
              <div className="ui-section-header">
                <div className="ui-section-header__left">
                  <div className="ui-section-title">Ratings</div>
                  {fogged && <div className="ui-section-subtitle">Scouted ranges — tighten as you watch him play</div>}
                </div>
              </div>
              {RATINGS.map((group) => (
                <div key={group.category}>
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', margin: 'var(--sp-3) 0 6px', color: group.color, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: group.color, flexShrink: 0 }} />
                    {group.category}
                  </div>
                  {group.items.map(([key, label]) => {
                    const v = key === 'stamina' ? (p.stamina ?? 60) : p.ratings[key];
                    const proGames = fogged ? (league.scouting?.proWatching?.[p.id] ?? 0) : 0;
                    const hidden = fogged && isHidden(p, league.userTeamId, proGames, league.settings);
                    const [lo, hi] = (fogged && !hidden) ? scoutRange(p, v, league.season, key, league.userTeamId, proGames, league.settings) : [v, v];
                    const mid = (lo + hi) / 2;
                    return (
                      <div className="rating-row" key={key}>
                        <span style={{ color: 'var(--text-secondary, var(--text-muted))' }}>{label}</span>
                        <div className="rating-bar"><div style={{ width: `${hidden ? 0 : mid}%`, background: fogged ? 'var(--text-muted)' : group.color }} /></div>
                        <span className="num" style={{ fontVariantNumeric: 'tabular-nums', color: hidden ? 'var(--text-muted)' : fogged ? 'var(--text-muted)' : group.color }}>
                          {hidden ? '?' : fogged ? `${lo}–${hi}` : v}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {!fogged && (() => {
              const history = p.ratingHistory ?? [];
              if (!history.length) return null;
              const rows = [...history, [league.season, ...ratingRow(p)]];
              return (
                <div className="ui-section">
                  <div className="ui-section-header"><div className="ui-section-title">Progression</div></div>
                  <OverallChart points={rows.map((r) => [r[0], r[1]])} />
                </div>
              );
            })()}

            {!fogged && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Training Focus</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <select
                    value={p.trainingFocus || ''}
                    onChange={(e) => { p.trainingFocus = e.target.value || null; commit?.(); }}
                  >
                    <option value="">Balanced</option>
                    {TRAINING_FOCUS_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  {p.trainingFocus && (() => {
                    const f = TRAINING_FOCUS_OPTIONS.find((f) => f.id === p.trainingFocus);
                    return f && (
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                        Boosts {f.boost.join(', ')} · slight regression in {f.neglect}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="ui-section">
              <div className="ui-section-header"><div className="ui-section-title">This Season ({league.season})</div></div>
              <SeasonStats stats={p.stats} />
            </div>

            {!fogged && p.stats.gp > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Shot Chart ({league.season})</div></div>
                <ShotChart stats={p.stats} />
              </div>
            )}

            {p.stats.gp > 0 && (
              <div className="ui-section">
                <div className="ui-section-header">
                  <div className="ui-section-header__left">
                    <div className="ui-section-title">Vs. League at {p.pos}</div>
                    <div className="ui-section-subtitle">Percentile this season among same-position players</div>
                  </div>
                </div>
                {positionalPercentiles(league, p, leaderMinGp(league)).map((row) => (
                  <div className="rating-row" key={row.key}>
                    <span style={{ color: 'var(--text-secondary, var(--text-muted))' }}>{row.label}</span>
                    <div className="rating-bar"><div style={{ width: `${row.percentile}%`, background: barColor(row.percentile) }} /></div>
                    <span className="num" style={{ fontVariantNumeric: 'tabular-nums', color: barColor(row.percentile) }}>{row.percentile}</span>
                  </div>
                ))}
              </div>
            )}

            {p.playoffStats.gp > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">This Postseason ({league.season})</div></div>
                <SeasonStats stats={p.playoffStats} />
              </div>
            )}

            {p.gLeagueStats?.gp > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">This Season — G League ({league.season})</div></div>
                <SeasonStats stats={p.gLeagueStats} />
              </div>
            )}
          </>
        )}

        {/* ── Milestones tab ── */}
        {tab === 'milestones' && <MilestonesTab p={p} league={league} />}

        {/* ── History tab ── */}
        {tab === 'history' && (
          <>
            {p.awards?.length > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Awards</div></div>
                {groupAwards(p.awards).map((g) => (
                  <div key={g.award} style={{ marginBottom: 'var(--sp-1)' }}>
                    {g.seasons.length > 1 && <b>{g.seasons.length}× </b>}{g.award}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>({g.seasons.join(', ')})</span>
                  </div>
                ))}
              </div>
            )}

            <div className="ui-section">
              <div className="ui-section-header"><div className="ui-section-title">Career</div></div>
              {p.careerStats.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No previous seasons.</p>}
              {p.careerStats.length > 0 && <CareerStatsTable league={league} rows={p.careerStats} openTeam={openTeam} />}
            </div>

            {p.playoffCareerStats.length > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Career — Playoffs</div></div>
                <CareerStatsTable league={league} rows={p.playoffCareerStats} openTeam={openTeam} />
              </div>
            )}

            {p.gLeagueCareerStats?.length > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Career — G League</div></div>
                <CareerStatsTable league={league} rows={p.gLeagueCareerStats} openTeam={openTeam} />
              </div>
            )}

            {p.contractHistory?.length > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Contract History</div></div>
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead>
                      <tr><th>Season</th><th>Team</th><th className="num">Salary</th><th className="num">Years</th></tr>
                    </thead>
                    <tbody>
                      {[...p.contractHistory].reverse().map((c, i) => (
                        <tr key={i}>
                          <td>{c.season}</td>
                          <td><TeamLink team={getTeam(league, c.team)} openTeam={openTeam} /></td>
                          <td className="num">{money(c.salary)}</td>
                          <td className="num">{c.years}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {p.transactions?.length > 0 && (
              <div className="ui-section">
                <div className="ui-section-header"><div className="ui-section-title">Transactions</div></div>
                <TransactionHistory league={league} rows={p.transactions} openTeam={openTeam} />
              </div>
            )}

            <div className="ui-section">
              {!p.draftYear && (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Draft: Undrafted</div>
              )}
              {p.draftYear && (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  Drafted {p.draftYear}, Round {p.draftRound} (Pick {p.draftPick}) by <TeamLink team={getTeam(league, p.draftTeam)} openTeam={openTeam} />
                </div>
              )}
            </div>

            <div className="ui-section">
              <div className="ui-section-header"><div className="ui-section-title">Similar Players</div></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                {similarPlayers(league, p).map(({ p: sp, team: st }) => {
                  const spFogged = st.id !== league.userTeamId;
                  return (
                    <div key={sp.id} style={{ fontSize: 'var(--text-sm)' }}>
                      <Ovr p={sp} league={league} fogged={spFogged} /> <PlayerLink p={sp} openPlayer={openPlayer} /> ({posLabel(sp)}) — <TeamLink team={st} openTeam={openTeam} />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
