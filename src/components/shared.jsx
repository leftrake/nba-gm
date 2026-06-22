import React, { useState, useEffect, useRef } from 'react';
import { textOnColor } from '../engine/colorUtils.js';
import { overall, flagFor } from '../engine/players.js';
import { scoutRange, scoutedOverallRange, scoutUncertainty, isHidden, fogColor } from '../engine/scouting.js';
import { traitBand, traitShort, TRAIT_COLORS } from '../engine/devTraits.js';
import { MORALE_WARNING_STREAK } from '../engine/morale.js';
import { injuryTimeline } from '../engine/injuries.js';
import { coachTalkQuote, COACH_TALK_OPTIONS } from '../engine/coachTalk.js';
import { TEAMS } from '../data/teams.js';

function ovrClass(o) {
  return o >= 85 ? 'elite' : o >= 75 ? 'great' : o >= 65 ? 'good' : o >= 55 ? 'ok' : 'bad';
}

// Exact overall for the user's own players; a scouted range for everyone
// else, uncolored so the tier color doesn't give anything away.
export function Ovr({ p, league, fogged }) {
  if (fogged) {
    const teamId = league.userTeamId;
    const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
    if (isHidden(p, teamId, proGames)) return <span className="ovr" style={{ color: 'var(--muted)' }}>?</span>;
    const [lo, hi] = scoutedOverallRange(p, league.season, teamId, proGames);
    const u = scoutUncertainty(p, teamId, proGames);
    return (
      <span className="ovr" title={`Scouting uncertainty ±${u}`}>
        {lo}–{hi}{' '}
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: fogColor(u), verticalAlign: 'middle' }} />
      </span>
    );
  }
  const o = overall(p);
  return <span className={`ovr ${ovrClass(o)}`}>{o}</span>;
}

// Potential as a dev-trait band. Own players show the exact tier; opponents
// show a possibly-wide band that collapses as scouting/minutes accumulate.
// "?" when there's no scouting information at all.
export function Pot({ p, league, fogged }) {
  const proGames = fogged ? (league.scouting?.proWatching?.[p.id] ?? 0) : 0;
  const band = traitBand(p, league.season, league.userTeamId, proGames, fogged);
  if (band === null) return <span className="ovr" style={{ color: 'var(--muted)' }}>?</span>;
  if (band.lo === band.hi) {
    return <span className="ovr" style={{ color: TRAIT_COLORS[band.lo] }}>{band.lo}</span>;
  }
  return (
    <span className="ovr" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }} title={`${band.lo}–${band.hi}`}>
      <span style={{ color: TRAIT_COLORS[band.lo] }}>{traitShort(band.lo)}</span>
      {'–'}
      <span style={{ color: TRAIT_COLORS[band.hi] }}>{traitShort(band.hi)}</span>
    </span>
  );
}

// Where a player is from: "🇺🇸 Duke" / "🇷🇸 Serbia", or the longer
// "🇺🇸 USA · Duke · born Chicago" with `full`. Renders nothing for players
// from saves that predate origins.
export function Origin({ p, full }) {
  if (!p.nationality) return null;
  const flag = flagFor(p.nationality);
  const born = full && p.birthplace ? ` · born ${p.birthplace}` : '';
  if (full && p.from !== p.nationality) return <>{flag} {p.nationality} · {p.from}{born}</>;
  return <>{flag} {full ? p.nationality : p.from}{born}</>;
}

// Stamina: exact for the user's own players, a scouted range for everyone
// else, same fog rules as the other ratings.
export function Sta({ p, league, fogged }) {
  if (p.stamina == null) return <span className="ovr">–</span>;
  if (fogged) {
    const teamId = league.userTeamId;
    const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
    if (isHidden(p, teamId, proGames)) return <span className="ovr" style={{ color: 'var(--muted)' }}>?</span>;
    const [lo, hi] = scoutRange(p, p.stamina, league.season, 'sta', teamId, proGames);
    return <span className="ovr">{lo}–{hi}</span>;
  }
  return <span className="ovr">{p.stamina}</span>;
}

// Condition dot: green fresh → red gassed. Not fogged — it tracks publicly
// visible minutes played, so everyone's is common knowledge.
export function condColor(c) {
  return c >= 85 ? 'var(--color-success)' : c >= 70 ? 'var(--color-warning)' : c >= 50 ? 'var(--color-primary)' : 'var(--color-danger)';
}

export function condLabel(c) {
  return c >= 85 ? 'Fresh' : c >= 70 ? 'Good' : c >= 50 ? 'Tired' : 'Exhausted';
}

export function Cond({ p, label }) {
  const c = Math.round(p.condition ?? 100);
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`Condition ${c}% — drains with heavy minutes (worse on back-to-backs), recovers on rest days`}>
      <span style={{ color: condColor(c), fontSize: 10, verticalAlign: 'middle' }}>●</span> {c}
      {label && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{condLabel(c)}</span>}
    </span>
  );
}

// Morale dot: green happy → red disgruntled. Not fogged — every team's
// chemistry is common knowledge, even if the underlying ratings aren't.
export function moraleColor(m) {
  return m >= 70 ? 'var(--color-success)' : m >= 50 ? 'var(--color-primary)' : m >= 30 ? 'var(--color-warning)' : 'var(--color-danger)';
}

function moraleEmoji(m) {
  return m >= 70 ? '😄' : m >= 50 ? '🙂' : m >= 30 ? '😕' : '😠';
}

export function Morale({ p }) {
  const m = Math.round(p.morale ?? 50);
  const unhappy = !p.tradeDemand && (p.moraleLowStreak ?? 0) >= MORALE_WARNING_STREAK;
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`Morale ${m}/100 — rises with winning, minutes/role, playoff success and extensions; falls with losing, being underused, being shopped, and roster turmoil`}>
      <span style={{ color: moraleColor(m) }}>{moraleEmoji(m)}</span> {m}
      {p.tradeDemand && (
        <span className="tag" style={{ color: 'var(--red)', marginLeft: 4 }} title={`${p.name} has publicly demanded a trade`}>
          TRADE REQUEST
        </span>
      )}
      {unhappy && (
        <span className="tag" style={{ color: '#d29922', marginLeft: 4 }} title={`${p.name} has been unhappy for a while — a trade demand may follow if this continues`}>
          UNHAPPY
        </span>
      )}
    </span>
  );
}

// Red injury chip: type plus days remaining. Renders nothing for the healthy.
export function InjuryTag({ p }) {
  if (!p.injury) return null;
  const season = p.injury.tier === 'season';
  return (
    <span
      className="tag"
      style={{ color: 'var(--red)', marginLeft: 6 }}
      title={`${p.injury.type} — ${season ? 'out for the season' : `${p.injury.daysLeft} day${p.injury.daysLeft === 1 ? '' : 's'} remaining`}`}
    >
      🩹 {p.injury.type} · {season ? 'season' : `${p.injury.daysLeft}d`}
    </span>
  );
}

// Proactive "someone got hurt" popup — shared by the regular-season Calendar
// sim loop and the playoff sim handlers in App.jsx, since the user's own
// player getting hurt is the one result worth interrupting a fast-forward for.
export function InjuryAlertModal({ alert, onClose, onGoToRoster }) {
  if (!alert) return null;
  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">🩹 Injury Update</div>
        </div>
        {alert.injured.map((p) => (
          <p key={`hurt-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
            <b>{p.name}</b> ({p.pos}) goes down with {p.injury.type.toLowerCase()} —{' '}
            <span style={{ color: 'var(--color-danger)' }}>{injuryTimeline(p.injury)}</span>.
          </p>
        ))}
        {alert.returned.map((p) => (
          <p key={`back-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
            <b>{p.name}</b> ({p.pos}) is <span style={{ color: 'var(--color-success)' }}>back and available</span> for tonight's game.
          </p>
        ))}
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>You may want to adjust your rotation before the next game.</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button className="ui-btn ui-btn--primary ui-btn--md" onClick={onGoToRoster}>Go to Roster</button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={onClose}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

export function CoachTalkModal({ league, team, onResolve }) {
  const talk = team?.pendingCoachTalk;
  const quote = talk ? coachTalkQuote(league, team, talk) : null;
  // If the flagged player was traded/waived before the GM responded, the
  // conversation is moot — auto-clear it rather than leaving the sim
  // controls stuck disabled with no modal to resolve.
  useEffect(() => {
    if (talk && !quote) onResolve('dismiss');
  }, [talk, quote]);
  if (!talk || !quote) return null;
  return (
    <div className="ui-modal-overlay">
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">🗣️ A Word From the Coach</div>
        </div>
        <p style={{ marginBottom: 'var(--sp-4)' }}>{quote}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {COACH_TALK_OPTIONS[talk.cause].map((opt) => (
            <button key={opt.id} className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => onResolve(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MilestoneAlertModal({ team, onClose }) {
  const alert = team?.pendingMilestoneAlert;
  if (!alert) return null;
  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">📈 Heads Up</div>
        </div>
        <p style={{ marginBottom: 'var(--sp-4)' }}>{alert.text}</p>
        <button className="ui-btn ui-btn--primary ui-btn--md" onClick={onClose}>Nice!</button>
      </div>
    </div>
  );
}

export function CallUpPromptModal({ team, onResolve }) {
  const prompt = team?.pendingCallUpPrompt;
  if (!prompt) return null;
  return (
    <div className="ui-modal-overlay">
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">📞 Call From the G League</div>
        </div>
        <p style={{ marginBottom: 'var(--sp-4)' }}>{prompt.text}</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button className="ui-btn ui-btn--primary ui-btn--md" onClick={() => onResolve(true)}>Call him up</button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => onResolve(false)}>Leave him down</button>
        </div>
      </div>
    </div>
  );
}

// Front-office strategy badge (see engine/strategy.js)
const STRATEGY_COLORS = { contending: 'var(--color-success)', retooling: 'var(--color-primary)', rebuilding: 'var(--color-danger)' };
export function StrategyTag({ team }) {
  if (!team.strategy) return null;
  return <span className="tag" style={{ color: STRATEGY_COLORS[team.strategy] }}>{team.strategy}</span>;
}

// 0-100 owner approval meter, colored the same thresholds as ownerStance/seatStatus.
export function approvalColor(a) {
  return a >= 60 ? 'var(--color-success)' : a >= 40 ? 'var(--color-primary)' : a >= 25 ? 'var(--color-warning)' : 'var(--color-danger)';
}

export function ApprovalMeter({ value }) {
  return (
    <div className="approval-bar">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: approvalColor(value) }} />
    </div>
  );
}

// Locker room turmoil: spikes from roster moves (trades, waives) and decays
// slowly. Not fogged — every team's locker room mood is common knowledge.
export function turmoilLabel(t) {
  return t >= 1.5 ? 'Volatile' : t >= 0.5 ? 'Tense' : 'Stable';
}

export function turmoilColor(t) {
  return t >= 1.5 ? 'var(--color-danger)' : t >= 0.5 ? 'var(--color-warning)' : 'var(--color-success)';
}

export function money(n) {
  return `$${(n / 1e6).toFixed(1)}M`;
}

export function perGame(stats, key) {
  if (!stats.gp) return '–';
  return (stats[key] / stats.gp).toFixed(1);
}

export function fgPct(stats) {
  if (!stats.fga) return '–';
  return ((stats.fgm / stats.fga) * 100).toFixed(1);
}

export function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Overall rating rendered as a filled progress arc, colored the same as
// the Ovr tier colors (`ovrClass`).
export function OvrArc({ value, size = 38 }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = value >= 85 ? 'var(--color-elite)' : value >= 75 ? 'var(--color-success)' : value >= 65 ? 'var(--color-info)' : value >= 55 ? 'var(--text-primary)' : 'var(--text-muted)';
  return (
    <span className="ovr-arc" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
        />
      </svg>
      <span className="ovr-arc-num" style={{ color }}>{value}</span>
    </span>
  );
}

export function PlayerLink({ p, openPlayer, children }) {
  if (!openPlayer) return <>{children ?? p.name}</>;
  return (
    <a className="team-link" onClick={(e) => { e.stopPropagation(); openPlayer(p); }}>
      {children ?? p.name}
    </a>
  );
}

// Small colored circle with the team's abbreviation, matching the bracket
// chips on the Playoffs screen. `size` controls the chip's diameter/font.
const TEAM_BADGE_SIZES = {
  small: { size: 18, fontSize: 8 },
  medium: { size: 26, fontSize: 10 },
  large: { size: 56, fontSize: 17 },
};

export function TeamBadge({ team, size = 'medium' }) {
  const { size: px, fontSize } = TEAM_BADGE_SIZES[size] || TEAM_BADGE_SIZES.medium;
  return (
    <span className="team-logo" style={{ width: px, height: px, fontSize, '--logo-color': team.color, color: textOnColor(team.color) }}>
      {team.id}
    </span>
  );
}

export function TeamLink({ team, openTeam, children }) {
  const label = children ?? `${team.city} ${team.name}`;
  if (!openTeam) return <>{label}</>;
  return <a className="team-link" onClick={() => openTeam(team.id)}>{label}</a>;
}

// Falling confetti overlay for celebratory offseason moments (championships,
// award wins on the user's team).
const CONFETTI_COLORS = ['#f0883e', '#3fb950', '#58a6ff', '#d2a8ff', '#d29922', '#f85149'];

export function Confetti() {
  const pieces = React.useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 2.2 + Math.random() * 1.6,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotate: Math.random() * 360,
    })),
    []
  );
  return (
    <div className="confetti">
      {pieces.map((c, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${c.left}%`,
            background: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
            transform: `rotate(${c.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

// "Boston Celtics" / "Celtics" → team id, for linkifying free-form news text
const NAME_TO_ID = {};
for (const t of TEAMS) {
  NAME_TO_ID[`${t.city} ${t.name}`] = t.id;
  NAME_TO_ID[t.name] = t.id;
}
const NAMES_RE = new RegExp(
  `(${Object.keys(NAME_TO_ID).sort((a, b) => b.length - a.length).join('|')})`,
  'g'
);

export function NewsText({ text, openTeam }) {
  return (
    <>
      {text.split(NAMES_RE).map((part, i) =>
        NAME_TO_ID[part] && openTeam ? (
          <a key={i} className="team-link" onClick={() => openTeam(NAME_TO_ID[part])}>{part}</a>
        ) : (
          part
        )
      )}
    </>
  );
}

// ---- Onboarding (Layer 1 walkthrough + Layer 2 first-encounter tooltips) ----
// Kept entirely separate from the main save: tooltip flags live under one
// flat object, the walkthrough under its own boolean.
export const TOOLTIPS_KEY = 'nba-gm-tooltips';
export const WALKTHROUGH_KEY = 'nba-gm-walkthrough-done';

function loadSeenTooltips() {
  try {
    return JSON.parse(localStorage.getItem(TOOLTIPS_KEY)) || {};
  } catch {
    return {};
  }
}

export function hasSeenTooltip(key) {
  return !!loadSeenTooltips()[`tt_${key}`];
}

export function markTooltipSeen(key) {
  try {
    const seen = loadSeenTooltips();
    seen[`tt_${key}`] = true;
    localStorage.setItem(TOOLTIPS_KEY, JSON.stringify(seen));
  } catch {}
}

export function isWalkthroughDone() {
  try {
    return localStorage.getItem(WALKTHROUGH_KEY) === 'true';
  } catch {
    return true;
  }
}

export function markWalkthroughDone() {
  try { localStorage.setItem(WALKTHROUGH_KEY, 'true'); } catch {}
}

// Clears both onboarding keys so the first-session walkthrough and every
// first-encounter tooltip fire again, as if this were a brand new save.
export function resetTutorial() {
  try {
    localStorage.removeItem(TOOLTIPS_KEY);
    localStorage.removeItem(WALKTHROUGH_KEY);
  } catch {}
}

// Wraps `children` with a small popover shown the first time `tipKey` is
// encountered. Dismissed via the ✕ or by clicking anywhere outside; once
// dismissed (this session or a previous one), renders just the children.
export function GuideTooltip({ tipKey, text, children, block }) {
  const [seen, setSeen] = useState(() => hasSeenTooltip(tipKey));
  const ref = useRef(null);

  useEffect(() => {
    if (seen) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) dismiss();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const dismiss = () => {
    markTooltipSeen(tipKey);
    setSeen(true);
  };

  if (seen) return <>{children}</>;

  return (
    <span ref={ref} className={`guide-tooltip-anchor${block ? ' block' : ''}`}>
      {children}
      <div className="guide-tooltip-popover">
        <button className="guide-tooltip-close" onClick={dismiss} aria-label="Dismiss">✕</button>
        <p>{text}</p>
      </div>
    </span>
  );
}
