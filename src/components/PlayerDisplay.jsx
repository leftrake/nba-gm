import React from 'react';
import { overall, flagFor } from '../engine/players.js';
import { scoutRange, scoutedOverallRange, scoutUncertainty, isHidden, fogColor } from '../engine/scouting.js';
import { traitBand, traitShort, TRAIT_COLORS } from '../engine/devTraits.js';
import { MORALE_WARNING_STREAK } from '../engine/morale.js';
import { condColor, condLabel, moraleColor } from './formatters.js';

function ovrClass(o) {
  return o >= 85 ? 'elite' : o >= 75 ? 'great' : o >= 65 ? 'good' : o >= 55 ? 'ok' : 'bad';
}

// Exact overall for the user's own players; a scouted range for everyone
// else, uncolored so the tier color doesn't give anything away.
export function Ovr({ p, league, fogged }) {
  if (fogged) {
    const teamId = league.userTeamId;
    const settings = league.settings;
    const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
    if (isHidden(p, teamId, proGames, settings)) return <span className="ovr" style={{ color: 'var(--muted)' }}>?</span>;
    const [lo, hi] = scoutedOverallRange(p, league.season, teamId, proGames, settings);
    const u = scoutUncertainty(p, teamId, proGames, settings);
    if (lo === hi) return <span className={`ovr ${ovrClass(lo)}`}>{lo}</span>;
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
  const fogOff = league.settings?.difficulty?.scoutingFog === 'off';
  const effectiveFogged = fogged && !fogOff;
  const proGames = effectiveFogged ? (league.scouting?.proWatching?.[p.id] ?? 0) : 0;
  const band = traitBand(p, league.season, league.userTeamId, proGames, effectiveFogged);
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
    const settings = league.settings;
    const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
    if (isHidden(p, teamId, proGames, settings)) return <span className="ovr" style={{ color: 'var(--muted)' }}>?</span>;
    const [lo, hi] = scoutRange(p, p.stamina, league.season, 'sta', teamId, proGames, settings);
    if (lo === hi) return <span className="ovr">{lo}</span>;
    return <span className="ovr">{lo}–{hi}</span>;
  }
  return <span className="ovr">{p.stamina}</span>;
}

// Condition dot: green fresh → red gassed. Not fogged — it tracks publicly
// visible minutes played, so everyone's is common knowledge.
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

// Overall rating rendered as a filled progress arc, colored the same as
// the Ovr tier colors (ovrClass).
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
