import React, { useEffect } from 'react';
import { askingPrice } from '../engine/league.js';
import { durabilityNote } from '../engine/players.js';
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

export default function PlayerCard({ league, player: p, onClose, openTeam }) {
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
            {p.pos} · {p.age} yrs · {p.exp != null && <>{p.exp === 0 ? 'Rookie' : `${p.exp} yr${p.exp === 1 ? '' : 's'} exp`} · </>}{p.nationality && <><Origin p={p} full /> · </>}{team ? <TeamLink team={team} openTeam={openTeam} /> : 'Free Agent'}
          </span>
          <button className="btn small secondary" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</button>
        </div>

        <p style={{ margin: '10px 0' }}>
          Overall: <Ovr p={p} league={league} fogged={fogged} /> · Potential: <Pot p={p} league={league} fogged={fogged} /> · Condition: <Cond p={p} /> ·{' '}
          {p.contract
            ? <>Contract: <b>{money(p.contract.salary)}</b>/yr × <b>{p.contract.years}</b> {p.contract.years === 1 ? 'year' : 'years'}</>
            : <>Asking: <b>{money(askingPrice(p))}</b>/yr</>}
          {p.extension && <> · Extension: <b style={{ color: 'var(--green)' }}>{money(p.extension.salary)}</b>/yr × <b>{p.extension.years}</b> (starts next season)</>}
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
                <th>Season</th><th className="num">GP</th><th className="num">MPG</th><th className="num">PPG</th>
                <th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th>
              </tr>
            </thead>
            <tbody>
              {[...p.careerStats].reverse().map((s) => (
                <tr key={s.season}>
                  <td>{s.season}</td>
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
