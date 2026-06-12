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
// "🇺🇸 USA · Duke" with `full`. Renders nothing for players from saves
// that predate origins.
export function Origin({ p, full }) {
  if (!p.nationality) return null;
  const flag = flagFor(p.nationality);
  if (full && p.from !== p.nationality) return <>{flag} {p.nationality} · {p.from}</>;
  return <>{flag} {full ? p.nationality : p.from}</>;
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

export function PlayerLink({ p, openPlayer, children }) {
  if (!openPlayer) return <>{children ?? p.name}</>;
  return (
    <a className="team-link" onClick={(e) => { e.stopPropagation(); openPlayer(p); }}>
      {children ?? p.name}
    </a>
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
