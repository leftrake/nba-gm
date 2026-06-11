import React, { useEffect, useMemo } from 'react';
import { getTeam } from '../engine/league.js';
import { decodeBox } from '../engine/sim.js';
import { TeamLink, PlayerLink } from './shared.jsx';

// Players move teams (or get waived) mid-season, so box-score names resolve
// against the whole league, not just the current roster of the team shown.
function usePlayerIndex(league) {
  return useMemo(() => {
    const byId = new Map();
    for (const t of league.teams) for (const p of t.roster) byId.set(p.id, p);
    for (const p of league.freeAgents) if (!byId.has(p.id)) byId.set(p.id, p);
    return byId;
  }, [league]);
}

// Lines arrive either as objects (fresh sim results) or compact arrays
// (loaded from the save) — see BOX_COLS in sim.js.
const asLines = (box) => (box.length > 0 && Array.isArray(box[0]) ? decodeBox(box) : box);

export function BoxTable({ league, teamId, pts, box, openTeam, openPlayer }) {
  const byId = usePlayerIndex(league);
  const team = getTeam(league, teamId);
  const lines = asLines(box).filter((l) => l.min > 0);
  const total = (k) => lines.reduce((s, l) => s + l[k], 0);
  return (
    <div>
      <h3><TeamLink team={team} openTeam={openTeam} />{pts != null && <> · {pts}</>}</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th><th className="num">MIN</th><th className="num">PTS</th><th className="num">REB</th>
            <th className="num">AST</th><th className="num">STL</th><th className="num">BLK</th><th className="num">TO</th>
            <th className="num">PF</th><th className="num">FG</th><th className="num">3P</th><th className="num">FT</th>
          </tr>
        </thead>
        <tbody>
          {[...lines].sort((a, b) => b.pts - a.pts).map((line) => {
            const p = byId.get(line.playerId);
            return (
              <tr key={line.playerId}>
                <td>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'}</td>
                <td className="num">{line.min}</td>
                <td className="num"><b>{line.pts}</b></td>
                <td className="num">{line.reb}</td>
                <td className="num">{line.ast}</td>
                <td className="num">{line.stl}</td>
                <td className="num">{line.blk}</td>
                <td className="num">{line.tov}</td>
                <td className="num" style={line.pf >= 6 ? { color: 'var(--red)', fontWeight: 700 } : undefined}
                    title={line.pf >= 6 ? 'Fouled out' : undefined}>
                  {line.pf}
                </td>
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
            <td className="num">{total('ast')}</td>
            <td className="num">{total('stl')}</td>
            <td className="num">{total('blk')}</td>
            <td className="num">{total('tov')}</td>
            <td className="num">{total('pf')}</td>
            <td className="num">{total('fgm')}-{total('fga')}</td>
            <td className="num">{total('tpm')}-{total('tpa')}</td>
            <td className="num">{total('ftm')}-{total('fta')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Full-game modal: away and home box scores for one stored result.
export default function BoxScoreModal({ league, game, title, onClose, openTeam, openPlayer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const away = getTeam(league, game.away);
  const home = getTeam(league, game.home);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>
            {title ? `${title} · ` : ''}
            <span className={game.awayPts > game.homePts ? 'winner' : ''}>{away.name} {game.awayPts}</span>
            {' @ '}
            <span className={game.homePts > game.awayPts ? 'winner' : ''}>{home.name} {game.homePts}</span>
          </h2>
          <button className="btn small secondary" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <BoxTable league={league} teamId={game.away} pts={game.awayPts} box={game.awayBox} openTeam={openTeam} openPlayer={openPlayer} />
          <BoxTable league={league} teamId={game.home} pts={game.homePts} box={game.homeBox} openTeam={openTeam} openPlayer={openPlayer} />
        </div>
      </div>
    </div>
  );
}
