import React from 'react';
import { overall, flagFor } from '../engine/players.js';
import { scoutRange, scoutedOverallRange, scoutedPotential, potentialGrade } from '../engine/scouting.js';
import { TEAMS } from '../data/teams.js';

function ovrClass(o) {
  return o >= 85 ? 'elite' : o >= 75 ? 'great' : o >= 65 ? 'good' : o >= 55 ? 'ok' : 'bad';
}

// Exact overall for the user's own players; a scouted range for everyone
// else, uncolored so the tier color doesn't give anything away.
export function Ovr({ p, league, fogged }) {
  if (fogged) {
    const [lo, hi] = scoutedOverallRange(p, league.season);
    return <span className="ovr">{lo}–{hi}</span>;
  }
  const o = overall(p);
  return <span className={`ovr ${ovrClass(o)}`}>{o}</span>;
}

// Potential is never shown as a number — letter grade only, fuzzed for
// players the GM can't scout exactly. The grade is all you get: no color.
export function Pot({ p, league, fogged }) {
  const v = scoutedPotential(p, league.season, fogged);
  return <span className="ovr" style={{ color: 'var(--muted)' }}>{potentialGrade(v)}</span>;
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
    const [lo, hi] = scoutRange(p, p.stamina, league.season, 'sta');
    return <span className="ovr">{lo}–{hi}</span>;
  }
  return <span className="ovr">{p.stamina}</span>;
}

// Condition dot: green fresh → red gassed. Not fogged — it tracks publicly
// visible minutes played, so everyone's is common knowledge.
export function condColor(c) {
  return c >= 85 ? 'var(--green)' : c >= 70 ? '#d29922' : c >= 50 ? '#f0883e' : 'var(--red)';
}

export function Cond({ p }) {
  const c = Math.round(p.condition ?? 100);
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`Condition ${c}% — drains with heavy minutes (worse on back-to-backs), recovers on rest days`}>
      <span style={{ color: condColor(c), fontSize: 10, verticalAlign: 'middle' }}>●</span> {c}
    </span>
  );
}

// Morale dot: green happy → red disgruntled. Not fogged — every team's
// chemistry is common knowledge, even if the underlying ratings aren't.
export function moraleColor(m) {
  return m >= 70 ? 'var(--green)' : m >= 50 ? 'var(--accent)' : m >= 30 ? '#d29922' : 'var(--red)';
}

function moraleEmoji(m) {
  return m >= 70 ? '😄' : m >= 50 ? '🙂' : m >= 30 ? '😕' : '😠';
}

export function Morale({ p }) {
  const m = Math.round(p.morale ?? 50);
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`Morale ${m}/100 — rises with winning, minutes/role, playoff success and extensions; falls with losing, being underused, being shopped, and roster turmoil`}>
      <span style={{ color: moraleColor(m) }}>{moraleEmoji(m)}</span> {m}
      {p.tradeDemand && (
        <span className="tag" style={{ color: 'var(--red)', marginLeft: 4 }} title={`${p.name} has publicly demanded a trade`}>
          TRADE REQUEST
        </span>
      )}
    </span>
  );
}

// Red injury chip: type plus games remaining. Renders nothing for the healthy.
export function InjuryTag({ p }) {
  if (!p.injury) return null;
  const season = p.injury.tier === 'season';
  return (
    <span
      className="tag"
      style={{ color: 'var(--red)', marginLeft: 6 }}
      title={`${p.injury.type} — ${season ? 'out for the season' : `${p.injury.gamesLeft} game${p.injury.gamesLeft === 1 ? '' : 's'} remaining`}`}
    >
      🩹 {p.injury.type} · {season ? 'season' : `${p.injury.gamesLeft} gm`}
    </span>
  );
}

// Front-office strategy badge (see engine/strategy.js)
const STRATEGY_COLORS = { contending: 'var(--green)', retooling: 'var(--accent)', rebuilding: 'var(--red)' };
export function StrategyTag({ team }) {
  if (!team.strategy) return null;
  return <span className="tag" style={{ color: STRATEGY_COLORS[team.strategy] }}>{team.strategy}</span>;
}

// 0-100 owner approval meter, colored the same thresholds as ownerStance/seatStatus.
export function approvalColor(a) {
  return a >= 60 ? 'var(--green)' : a >= 40 ? 'var(--accent)' : a >= 25 ? '#d29922' : 'var(--red)';
}

export function ApprovalMeter({ value }) {
  return (
    <div className="approval-bar">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: approvalColor(value) }} />
    </div>
  );
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
  const color = value >= 85 ? '#d2a8ff' : value >= 75 ? 'var(--green)' : value >= 65 ? '#58a6ff' : value >= 55 ? 'var(--text)' : 'var(--muted)';
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

// Left-border accent class for a player's primary position
export function posStripe(p) {
  return `pos-stripe-${p.pos}`;
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
  small: { size: 18, fontSize: 9 },
  medium: { size: 26, fontSize: 11 },
  large: { size: 56, fontSize: 20 },
};

export function TeamBadge({ team, size = 'medium' }) {
  const { size: px, fontSize } = TEAM_BADGE_SIZES[size] || TEAM_BADGE_SIZES.medium;
  return (
    <span className="team-logo" style={{ width: px, height: px, fontSize, background: team.color }}>
      {team.id}
    </span>
  );
}

export function TeamLink({ team, openTeam, children }) {
  const label = children ?? `${team.city} ${team.name}`;
  if (!openTeam) return <>{label}</>;
  return <a className="team-link" onClick={() => openTeam(team.id)}>{label}</a>;
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
