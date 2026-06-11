import React from 'react';
import { overall } from '../engine/players.js';
import { scoutedOverallRange, scoutedPotential, potentialGrade } from '../engine/scouting.js';
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
