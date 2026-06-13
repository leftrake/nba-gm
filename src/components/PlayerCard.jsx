import React, { useEffect } from 'react';
import { askingPrice, getTeam } from '../engine/league.js';
import { durabilityNote, ratingRow, posLabel } from '../engine/players.js';
import { injuryTimeline } from '../engine/injuries.js';
import { groupAwards } from '../engine/awards.js';
import { scoutRange } from '../engine/scouting.js';
import { Ovr, Pot, Cond, money, perGame, fgPct, TeamLink, Origin } from './shared.jsx';

const RATINGS = [
  ['inside', 'Inside'],
  ['mid', 'Mid-Range'],
  ['three', 'Three-Point'],
  ['passing', 'Passing'],
  ['rebounding', 'Rebounding'],
  ['defense', 'Defense'],
  ['athleticism', 'Athleticism'],
];

function barColor(v) {
  if (v >= 85) return '#d2a8ff';
  if (v >= 75) return 'var(--green)';
  if (v >= 65) return '#58a6ff';
  if (v >= 55) return 'var(--text)';
  return 'var(--muted)';
}

function StatLine({ stats }) {
  if (!stats.gp) return <p style={{ color: 'var(--muted)' }}>No games played this season.</p>;
  const tp = stats.tpa ? ((stats.tpm / stats.tpa) * 100).toFixed(1) : '–';
  const ft = stats.fta ? ((stats.ftm / stats.fta) * 100).toFixed(1) : '–';
  const cells = [
    ['GP', stats.gp], ['MPG', perGame(stats, 'min')], ['PPG', perGame(stats, 'pts')],
    ['RPG', perGame(stats, 'reb')], ['APG', perGame(stats, 'ast')], ['SPG', perGame(stats, 'stl')],
    ['BPG', perGame(stats, 'blk')], ['TOPG', stats.tov != null ? perGame(stats, 'tov') : '–'],
    ['PFPG', stats.pf != null ? perGame(stats, 'pf') : '–'],
    ['FG%', fgPct(stats)], ['3P%', tp], ['FT%', ft],
  ];
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {cells.map(([label, v]) => (
        <span key={label}>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span> <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

// Overall by season as a small inline line chart. `points` is [season, ovr][].
function OverallChart({ points }) {
  const w = 520, h = 130, padX = 26, padY = 22;
  const ovrs = points.map(([, o]) => o);
  const lo = Math.min(...ovrs) - 3;
  const hi = Math.max(...ovrs) + 3;
  const x = (i) => points.length === 1 ? w / 2 : padX + (i * (w - 2 * padX)) / (points.length - 1);
  const y = (o) => h - padY - ((o - lo) / (hi - lo)) * (h - 2 * padY);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block' }}>
      <polyline
        points={points.map(([, o], i) => `${x(i)},${y(o)}`).join(' ')}
        fill="none" stroke="var(--accent)" strokeWidth="2"
      />
      {points.map(([season, o], i) => (
        <g key={season}>
          <circle cx={x(i)} cy={y(o)} r="3" fill="var(--accent)" />
          <text x={x(i)} y={y(o) - 7} textAnchor="middle" fontSize="11" fill="var(--text)">{o}</text>
          <text x={x(i)} y={h - 5} textAnchor="middle" fontSize="10" fill="var(--muted)">'{String(season).slice(2)}</text>
        </g>
      ))}
    </svg>
  );
}

// Progression: overall-by-season chart. History rows are end-of-season
// snapshots, so the current ratings supply the latest column.
function Progression({ league, p }) {
  const history = p.ratingHistory ?? [];
  if (!history.length) return null;
  const rows = [...history, [league.season, ...ratingRow(p)]];
  return (
    <>
      <h3 style={{ marginTop: 14 }}>Progression</h3>
      <OverallChart points={rows.map((r) => [r[0], r[1]])} />
    </>
  );
}

export default function PlayerCard({ league, player: p, onClose, openTeam, onTradeFor }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const team = league.teams.find((t) => t.roster.some((x) => x.id === p.id));
  const fogged = team?.id !== league.userTeamId;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>{p.name}</h2>
          <span style={{ color: 'var(--muted)' }}>
            {posLabel(p)} · {p.age} yrs · {p.exp != null &&<>{p.exp === 0 ? 'Rookie' : `${p.exp} yr${p.exp === 1 ? '' : 's'} exp`} · </>}{p.nationality && <><Origin p={p} full /> · </>}{team ? <TeamLink team={team} openTeam={openTeam} /> : 'Free Agent'}
          </span>
          <span style={{ flex: 1 }} />
          {team && onTradeFor && (
            <button className="btn small secondary" onClick={() => onTradeFor(p)}>Trade</button>
          )}
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        <p style={{ margin: '10px 0' }}>
          Overall: <Ovr p={p} league={league} fogged={fogged} /> · Potential: <Pot p={p} league={league} fogged={fogged} /> · Condition: <Cond p={p} /> ·{' '}
          {p.contract
            ? <>Contract: <b>{money(p.contract.salary)}</b>/yr × <b>{p.contract.years}</b> {p.contract.years === 1 ? 'year' : 'years'}</>
            : <>Asking: <b>{money(askingPrice(p))}</b>/yr</>}
          {p.extension && <> · Extension: <b style={{ color: 'var(--green)' }}>{money(p.extension.salary)}</b>/yr × <b>{p.extension.years}</b> (starts next season)</>}
        </p>

        <p style={{ margin: '10px 0', color: 'var(--muted)' }}>
          {p.draftYear
            ? <>Draft: <b style={{ color: 'var(--text)' }}>{p.draftYear}</b>, Round {p.draftRound} (Pick {p.draftPick}) — <TeamLink team={getTeam(league, p.draftTeam)} openTeam={openTeam} /></>
            : 'Draft: Undrafted'}
        </p>

        {p.injury && (
          <p style={{ margin: '10px 0', color: 'var(--red)' }}>
            🩹 <b>{p.injury.type}</b> — {injuryTimeline(p.injury)}.
          </p>
        )}
        {durabilityNote(p) && (
          <p style={{ margin: '10px 0', color: 'var(--muted)' }}>
            ⚕ Scouting note: {durabilityNote(p)}.
          </p>
        )}

        <h3>Ratings {fogged && <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>(scouted — ranges tighten with experience)</span>}</h3>
        {[...RATINGS, ['stamina', 'Stamina']].map(([key, label]) => {
          // stamina lives outside p.ratings but scouts like any other rating
          const v = key === 'stamina' ? (p.stamina ?? 60) : p.ratings[key];
          const [lo, hi] = fogged ? scoutRange(p, v, league.season, key) : [v, v];
          const mid = (lo + hi) / 2;
          return (
            <div className="rating-row" key={key}>
              <span style={{ color: 'var(--muted)' }}>{label}</span>
              <div className="rating-bar"><div style={{ width: `${mid}%`, background: fogged ? 'var(--muted)' : barColor(v) }} /></div>
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>{fogged ? `${lo}–${hi}` : v}</span>
            </div>
          );
        })}

        {!fogged && <Progression league={league} p={p} />}

        <h3 style={{ marginTop: 14 }}>This Season ({league.season})</h3>
        <StatLine stats={p.stats} />

        {p.awards?.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>Awards</h3>
            {groupAwards(p.awards).map((g) => (
              <div key={g.award} style={{ marginBottom: 2 }}>
                {g.seasons.length > 1 && <b>{g.seasons.length}× </b>}{g.award}{' '}
                <span style={{ color: 'var(--muted)' }}>({g.seasons.join(', ')})</span>
              </div>
            ))}
          </>
        )}

        <h3 style={{ marginTop: 14 }}>Career</h3>
        {p.careerStats.length === 0 && <p style={{ color: 'var(--muted)' }}>No previous seasons.</p>}
        {p.careerStats.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Team</th><th className="num">GP</th><th className="num">MPG</th><th className="num">PPG</th>
                <th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th>
              </tr>
            </thead>
            <tbody>
              {[...p.careerStats].reverse().map((s, i) => (
                <tr key={`${s.season}-${s.team ?? i}`}>
                  <td>{s.season}</td>
                  <td>{s.team != null ? <TeamLink team={getTeam(league, s.team)} openTeam={openTeam} /> : '–'}</td>
                  <td className="num">{s.gp}</td>
                  <td className="num">{perGame(s, 'min')}</td>
                  <td className="num">{perGame(s, 'pts')}</td>
                  <td className="num">{perGame(s, 'reb')}</td>
                  <td className="num">{perGame(s, 'ast')}</td>
                  <td className="num">{fgPct(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
