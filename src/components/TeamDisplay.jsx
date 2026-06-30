import React from 'react';
import { textOnColor } from '../engine/colorUtils.js';
import { TEAMS } from '../data/teams.js';
import { approvalColor, turmoilLabel, turmoilColor } from './formatters.js';

// Front-office strategy badge (see engine/strategy.js)
const STRATEGY_COLORS = { contending: 'var(--color-success)', retooling: 'var(--color-primary)', rebuilding: 'var(--color-danger)' };
export function StrategyTag({ team }) {
  if (!team.strategy) return null;
  return <span className="tag" style={{ color: STRATEGY_COLORS[team.strategy] }}>{team.strategy}</span>;
}

// 0-100 owner approval meter, colored the same thresholds as ownerStance/seatStatus.
export function ApprovalMeter({ value }) {
  return (
    <div className="approval-bar">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: approvalColor(value) }} />
    </div>
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

export { approvalColor, turmoilLabel, turmoilColor };
