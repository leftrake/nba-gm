import React, { useEffect, useMemo } from 'react';
import { getTeam } from '../engine/league.js';
import { decodeBox, periodLabel, starLines } from '../engine/sim.js';
import { injuryTimeline } from '../engine/injuries.js';
import { ddTd } from '../engine/stats.js';
import { TeamLink, TeamBadge, PlayerLink } from './shared.jsx';

// Players move teams (or get waived) mid-season, so box-score names resolve
// against the whole league, not just the current roster of the team shown.
export function usePlayerIndex(league) {
  return useMemo(() => {
    const byId = new Map();
    for (const t of league.teams) for (const p of t.roster) byId.set(p.id, p);
    for (const p of league.freeAgents) if (!byId.has(p.id)) byId.set(p.id, p);
    return byId;
  }, [league]);
}

// Lines arrive either as objects (fresh sim results) or compact arrays
// (loaded from the save) — see BOX_COLS in sim.js.
export const asLines = (box) => (box.length > 0 && Array.isArray(box[0]) ? decodeBox(box) : box);

// Small red injury icon with a tooltip showing the injury type and the
// expected return timeline, for a player who left this specific game hurt.
function BoxInjuryIcon({ entry }) {
  if (!entry) return null;
  return (
    <span style={{ color: 'var(--red)', marginLeft: 4 }} title={`${entry.type} — ${injuryTimeline(entry)}`}>
      🩹
    </span>
  );
}

export function BoxTable({ league, teamId, pts, box, openTeam, openPlayer, injuryReport }) {
  const byId = usePlayerIndex(league);
  const team = getTeam(league, teamId);
  const lines = asLines(box).filter((l) => l.min > 0);
  const total = (k) => lines.reduce((s, l) => s + l[k], 0);
  const injuryById = new Map((injuryReport || []).map((e) => [e.playerId, e]));
  const hurtHere = (injuryReport || []).filter((e) => lines.some((l) => l.playerId === e.playerId));
  return (
    <div>
      <h3><TeamBadge team={team} size="small" /> <TeamLink team={team} openTeam={openTeam} />{pts != null && <> · {pts}</>}</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th><th className="num">MIN</th><th className="num">PTS</th><th className="num">REB</th>
            <th className="num">OREB</th><th className="num">DREB</th>
            <th className="num">AST</th><th className="num">STL</th><th className="num">BLK</th><th className="num">TO</th>
            <th className="num">PF</th><th className="num">+/-</th><th className="num">FG</th><th className="num">3P</th><th className="num">FT</th>
          </tr>
        </thead>
        <tbody>
          {[...lines].sort((a, b) => b.pts - a.pts).map((line) => {
            const p = byId.get(line.playerId);
            const badge = ddTd(line);
            return (
              <tr key={line.playerId}>
                <td>
                  {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'}
                  {badge && (
                    <span className="tag" style={{ marginLeft: 6, color: 'var(--accent)' }} title={badge === 'TD' ? 'Triple-double' : 'Double-double'}>
                      {badge}
                    </span>
                  )}
                  <BoxInjuryIcon entry={injuryById.get(line.playerId)} />
                </td>
                <td className="num">{line.min}</td>
                <td className="num"><b>{line.pts}</b></td>
                <td className="num">{line.reb}</td>
                <td className="num">{line.oreb}</td>
                <td className="num">{line.dreb}</td>
                <td className="num">{line.ast}</td>
                <td className="num">{line.stl}</td>
                <td className="num">{line.blk}</td>
                <td className="num">{line.tov}</td>
                <td className="num" style={line.pf >= 6 ? { color: 'var(--red)', fontWeight: 700 } : undefined}
                    title={line.pf >= 6 ? 'Fouled out' : undefined}>
                  {line.pf}
                </td>
                <td className="num">{line.pm > 0 ? `+${line.pm}` : line.pm}</td>
                <td className="num">{line.fgm}-{line.fga}</td>
                <td className="num">{line.tpm}-{line.tpa}</td>
                <td className="num">{line.ftm}-{line.fta}</td>
              </tr>
            );
          })}
          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
            <td>Total</td>
            <td className="num" />
            <td className="num">{total('pts')}</td>
            <td className="num">{total('reb')}</td>
            <td className="num">{total('oreb')}</td>
            <td className="num">{total('dreb')}</td>
            <td className="num">{total('ast')}</td>
            <td className="num">{total('stl')}</td>
            <td className="num">{total('blk')}</td>
            <td className="num">{total('tov')}</td>
            <td className="num">{total('pf')}</td>
            <td className="num" />
            <td className="num">{total('fgm')}-{total('fga')}</td>
            <td className="num">{total('tpm')}-{total('tpa')}</td>
            <td className="num">{total('ftm')}-{total('fta')}</td>
          </tr>
        </tbody>
      </table>
      {hurtHere.length > 0 && (
        <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>
          🩹 Injury report: {hurtHere.map((e, i) => {
            const p = byId.get(e.playerId);
            return (
              <React.Fragment key={e.playerId}>
                {i > 0 && ', '}
                {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'} — {e.type} ({injuryTimeline(e)})
              </React.Fragment>
            );
          })}
        </p>
      )}
    </div>
  );
}

// Quarter-by-quarter line score; renders nothing for results from saves
// that predate quarter tracking.
export function LineScore({ league, game }) {
  if (!game.homeQtrs?.length) return null;
  const cols = game.homeQtrs.map((_, i) => periodLabel(i));
  const row = (teamId, qtrs, oppQtrs, pts, winner) => (
    <tr>
      <td style={winner ? { fontWeight: 700 } : undefined}><TeamBadge team={getTeam(league, teamId)} size="small" /> {getTeam(league, teamId).name}</td>
      {qtrs.map((q, i) => <td className="num" key={i} style={q > oppQtrs[i] ? { fontWeight: 700 } : undefined}>{q}</td>)}
      <td className="num"><b>{pts}</b></td>
    </tr>
  );
  return (
    <table style={{ maxWidth: 460, marginBottom: 14 }}>
      <thead>
        <tr><th />{cols.map((c) => <th className="num" key={c}>{c}</th>)}<th className="num">T</th></tr>
      </thead>
      <tbody>
        {row(game.away, game.awayQtrs, game.homeQtrs, game.awayPts, game.awayPts > game.homePts)}
        {row(game.home, game.homeQtrs, game.awayQtrs, game.homePts, game.homePts > game.awayPts)}
      </tbody>
    </table>
  );
}

// "Name (Team) — 31 PTS, 9 REB, 5 AST", the best lines across both teams.
export function TopPerformers({ league, game, openPlayer }) {
  const byId = usePlayerIndex(league);
  const sides = [
    [game.home, game.homeBox || game.homeStars],
    [game.away, game.awayBox || game.awayStars],
  ].filter(([, box]) => box);
  const all = sides.flatMap(([teamId, box]) => asLines(box).map((l) => ({ l, teamId })));
  const top = starLines(all.map((x) => x.l), 3).map((l) => all.find((x) => x.l === l));
  if (top.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <h3>Top Performers</h3>
      {top.map(({ l, teamId }) => {
        const p = byId.get(l.playerId);
        return (
          <div key={l.playerId} className="result-row" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <span>★ {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'}
              <span style={{ color: 'var(--muted)' }}> (<TeamBadge team={getTeam(league, teamId)} size="small" /> {getTeam(league, teamId).name})</span>
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <b>{l.pts}</b> PTS · {l.reb} REB · {l.ast} AST
              <span style={{ color: 'var(--muted)' }}> · {l.fgm}-{l.fga} FG</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// The highlight log recorded during the sim: runs, clutch shots, big
// quarters, quarter scores, injuries. Post-game notes carry no period tag.
export function GameFlow({ events }) {
  if (!events?.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <h3>Game Flow</h3>
      {events.map((e, i) => (
        <div className="news-item" key={i}>
          {e.q && (
            <span style={{ color: 'var(--muted)', display: 'inline-block', minWidth: 70 }}>
              {e.q}{e.t ? ` ${e.t}` : ''}
            </span>
          )}
          {e.text}
        </div>
      ))}
    </div>
  );
}

// Full game page (as a modal): line score, top performers, box scores when
// the save kept them, and the game-flow log. Falls back gracefully for
// games stored slim (top performers only) and for results from old saves.
export default function GameModal({ league, game, title, onClose, openTeam, openPlayer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const away = getTeam(league, game.away);
  const home = getTeam(league, game.home);
  const fullBox = !!(game.homeBox && game.awayBox);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>
            {title ? `${title} · ` : ''}
            <span className={game.awayPts > game.homePts ? 'winner' : ''}><TeamBadge team={away} size="small" /> {away.name} {game.awayPts}</span>
            {' @ '}
            <span className={game.homePts > game.awayPts ? 'winner' : ''}><TeamBadge team={home} size="small" /> {home.name} {game.homePts}</span>
          </h2>
          <button className="btn small secondary" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <LineScore league={league} game={game} />
          <TopPerformers league={league} game={game} openPlayer={openPlayer} />
          {fullBox ? (
            <div className="grid2">
              <BoxTable league={league} teamId={game.away} pts={game.awayPts} box={game.awayBox} openTeam={openTeam} openPlayer={openPlayer} injuryReport={game.injuryReport} />
              <BoxTable league={league} teamId={game.home} pts={game.homePts} box={game.homeBox} openTeam={openTeam} openPlayer={openPlayer} injuryReport={game.injuryReport} />
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>
              Full box scores are kept for your games and playoff games; other games keep the line score and top performers.
            </p>
          )}
          <GameFlow events={game.events} />
        </div>
      </div>
    </div>
  );
}
