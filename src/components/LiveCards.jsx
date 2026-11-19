import React from 'react';
import { TeamBadge } from './TeamDisplay.jsx';
import { JerseyDot, KitSwatch, surname } from './ArenaCourt.jsx';

// The moments around the play itself: the matchup before tip-off, a beat at
// each break, the result at the end, and the sim's own highlights as they
// happen. Everything here is fed already-spoiler-safe data by LiveGame —
// these components only lay it out.

const ICON = { run: '🔥', clutch: '⏱', injury: '🩹' };

export function HighlightBanner({ events, color }) {
  return (
    <div className="live-banner" style={{ borderColor: color }} role="status">
      {events.map((e, i) => (
        <div key={i}>
          <span aria-hidden="true">{ICON[e.k] ?? '★'} </span>
          {e.text.replace(/^🩹\s*/, '')}
        </div>
      ))}
    </div>
  );
}

// A substitution, as the new five take the floor — lower-third style, one
// per team that changed: who's in, who's out, numbers drawn the way the court
// draws them so each disc that appears or goes finds its name.
export function SubBanner({ side, team, kit, ins, outs, playerById }) {
  const who = (ids) => ids.map((id) => {
    const p = playerById(id);
    return (
      <span key={id} className="live-sub-player">
        <JerseyDot kit={kit} number={p?.jerseyNumber ?? ''} size={18} />
        {surname(p?.name ?? '')}
      </span>
    );
  });
  return (
    <div className={`live-sub live-sub--${side}`} role="status" aria-label={`${team.name} substitution`}>
      <div className="live-sub-head"><KitSwatch kit={kit} size={10} /> {team.name}</div>
      {ins.length > 0 && <div className="live-sub-row"><span className="live-sub-tag live-sub-tag--in">In</span>{who(ins)}</div>}
      {outs.length > 0 && <div className="live-sub-row"><span className="live-sub-tag">Out</span>{who(outs)}</div>}
    </div>
  );
}

function TeamHead({ team, record }) {
  return (
    <div className="live-card-team">
      <TeamBadge team={team} size="small" />
      <span className="live-card-teamname">{team.name}</span>
      {record && <span className="live-card-muted">{record}</span>}
    </div>
  );
}

export function TipOffCard({ home, away, pre, onStart, kicker = 'Tip-off', subtitle = null }) {
  const side = (team, s) => (
    <div className="live-card-side">
      <TeamHead team={team} record={s.record} />
      <div className="live-card-label">Starting five</div>
      <ul className="live-card-list">
        {s.starters.map((p) => (
          <li key={p.id}>
            <span>{p.name} <span className="live-card-muted">{p.pos}</span></span>
            {/* No games yet this season — not a debut: a veteran's opener reads the same. */}
            <span className="live-card-muted" title={p.ppg == null ? 'No games yet this season' : undefined}>
              {p.ppg == null ? '—' : `${p.ppg.toFixed(1)} ppg`}
            </span>
          </li>
        ))}
      </ul>
      {s.out.length > 0 && <div className="live-card-out">Out: {s.out.join(', ')}</div>}
    </div>
  );
  return (
    <div className="live-card" role="dialog" aria-label="Tip-off">
      <div className="live-card-kicker">{kicker}</div>
      <div className="live-card-title">{away.name} at {home.name}</div>
      {subtitle && <div className="live-card-center live-card-muted">{subtitle}</div>}
      <div className="live-card-cols">
        {side(away, pre.away)}
        {side(home, pre.home)}
      </div>
      <div className="live-card-actions">
        <button className="ui-btn ui-btn--primary ui-btn--md" onClick={onStart}>Tip off ▶</button>
      </div>
    </div>
  );
}

export function BreakCard({ title, home, away, score, period, leaders, notes, onContinue }) {
  return (
    <div className="live-card" role="dialog" aria-label={title}>
      <div className="live-card-kicker">{title}</div>
      <div className="live-card-score">
        <TeamHead team={away} /><span className="live-card-big">{score.away}</span>
        <span className="live-card-muted">–</span>
        <span className="live-card-big">{score.home}</span><TeamHead team={home} />
      </div>
      {period && (
        <div className="live-card-muted live-card-center">
          This period: {away.id} {period.away} · {home.id} {period.home}
        </div>
      )}
      <div className="live-card-cols">
        {[[away, leaders.away], [home, leaders.home]].map(([team, l]) => (
          <div key={team.id} className="live-card-side">
            <div className="live-card-label">Leading {team.name}</div>
            {l ? <div>{l.name} <span className="live-card-muted">{l.pts} pts · {l.reb} reb · {l.ast} ast</span></div>
              : <div className="live-card-muted">—</div>}
          </div>
        ))}
      </div>
      {notes.length > 0 && <ul className="live-card-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <div className="live-card-actions">
        <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={onContinue}>Continue ▸</button>
      </div>
    </div>
  );
}

export function FinalCard({ home, away, score, top, notes, note = null }) {
  const winner = score.home > score.away ? home : away;
  return (
    <div className="live-card" role="dialog" aria-label="Final">
      <div className="live-card-kicker">Final</div>
      <div className="live-card-score">
        <TeamHead team={away} /><span className="live-card-big">{score.away}</span>
        <span className="live-card-muted">–</span>
        <span className="live-card-big">{score.home}</span><TeamHead team={home} />
      </div>
      <div className="live-card-center live-card-muted">{note ?? `${winner.city} ${winner.name} win`}</div>
      <div className="live-card-cols">
        {[[away, top.away], [home, top.home]].map(([team, lines]) => (
          <div key={team.id} className="live-card-side">
            <div className="live-card-label">{team.name}</div>
            <ul className="live-card-list">
              {lines.map((l) => (
                <li key={l.id}><span>{l.name}</span><span className="live-card-muted">{l.pts}p {l.reb}r {l.ast}a</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {notes.length > 0 && <ul className="live-card-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  );
}
