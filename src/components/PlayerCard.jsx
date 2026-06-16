import React, { useEffect } from 'react';
import { askingPrice, getTeam } from '../engine/league.js';
import { durabilityNote, ratingRow, posLabel, similarPlayers, TRAINING_FOCUS_OPTIONS } from '../engine/players.js';
import { injuryTimeline } from '../engine/injuries.js';
import { groupAwards } from '../engine/awards.js';
import { scoutRange, isHidden } from '../engine/scouting.js';
import { markProWatch, removeProWatch } from '../engine/scoutingTrips.js';
import { personalityNote, scoutBackstoryNote } from '../engine/backstory.js';
import { recordsHeldBy, POS_NAMES } from '../engine/legacy.js';
import { Ovr, Pot, Cond, money, perGame, fgPct, TeamLink, PlayerLink, Origin } from './shared.jsx';

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

// Memorial layout for a retired player (a trimmed `league.retiredPlayers`
// snapshot — no ratings/contract/live stats, just career history).
function RetiredMemorial({ league, p, onClose, openTeam }) {
  const totals = (p.careerStats || []).reduce(
    (a, c) => ({ gp: a.gp + c.gp, pts: a.pts + c.pts, reb: a.reb + c.reb, ast: a.ast + c.ast }),
    { gp: 0, pts: 0, reb: 0, ast: 0 }
  );
  const seasons = [...new Set((p.careerStats || []).map((c) => c.season))].sort((a, b) => a - b);
  const recordsHeld = recordsHeldBy(league, p.id);
  const hof = league.hallOfFame?.find((h) => h.playerId === p.id);
  const finalTeam = p.finalTeam != null ? getTeam(league, p.finalTeam) : null;
  const userSeasons = (p.careerStats || []).filter((c) => c.team === league.userTeamId).length;
  const posName = POS_NAMES[p.pos] || p.pos;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>{p.name}</h2>
          <span style={{ color: 'var(--muted)' }}>
            {posName} · Retired after {p.retiredSeason}
            {finalTeam && <> · last with <TeamLink team={finalTeam} openTeam={openTeam} /></>}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        {hof && (
          <div style={{ marginTop: 10 }}>
            <h3>🏛️ Hall of Fame — Class of {hof.inductedSeason}</h3>
            <p>{hof.narrative}</p>
          </div>
        )}

        {!hof && (
          <p style={{ margin: '10px 0', color: 'var(--muted)' }}>
            {seasons.length} season{seasons.length === 1 ? '' : 's'} in the league
            {p.draftYear ? <>, drafted {p.draftYear} round {p.draftRound} (pick {p.draftPick}) by <TeamLink team={getTeam(league, p.draftTeam)} openTeam={openTeam} /></> : ', undrafted'}.
          </p>
        )}

        {p.championships > 0 && (
          <p style={{ margin: '10px 0' }}>🏆 {p.championships}× champion</p>
        )}

        {recordsHeld.length > 0 && (
          <p style={{ margin: '10px 0', color: 'var(--accent)' }}>
            📜 All-time record holder: {recordsHeld.join(', ')}
          </p>
        )}

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

        <h3 style={{ marginTop: 14 }}>Career Totals</h3>
        <p>
          {p.peakOverall != null && <><span className={`ovr ${p.peakOverall >= 85 ? 'elite' : p.peakOverall >= 75 ? 'great' : p.peakOverall >= 65 ? 'good' : 'ok'}`}>{p.peakOverall}</span> peak overall · </>}
          {totals.gp} GP · {perGame(totals, 'pts')} ppg · {perGame(totals, 'reb')} rpg · {perGame(totals, 'ast')} apg
        </p>

        {userSeasons > 0 && (
          <p style={{ margin: '10px 0', color: 'var(--team-color)' }}>
            🤝 Spent {userSeasons} season{userSeasons === 1 ? '' : 's'} with your franchise.
          </p>
        )}

        <h3 style={{ marginTop: 14 }}>Season by Season</h3>
        {p.careerStats.length === 0 && <p style={{ color: 'var(--muted)' }}>No recorded seasons.</p>}
        {p.careerStats.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Season</th><th>Team</th><th className="num">GP</th><th className="num">PPG</th>
                <th className="num">RPG</th><th className="num">APG</th><th className="num">FG%</th>
              </tr>
            </thead>
            <tbody>
              {[...p.careerStats].reverse().map((s, i) => (
                <tr key={`${s.season}-${s.team ?? i}`}>
                  <td>{s.season}</td>
                  <td>{s.team != null ? <TeamLink team={getTeam(league, s.team)} openTeam={openTeam} /> : '–'}</td>
                  <td className="num">{s.gp}</td>
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

export default function PlayerCard({ league, player: p, onClose, openTeam, openPlayer, onTradeFor, commit }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (p.retiredSeason != null) {
    return <RetiredMemorial league={league} p={p} onClose={onClose} openTeam={openTeam} />;
  }

  const team = league.teams.find((t) => t.roster.some((x) => x.id === p.id));
  const fogged = team?.id !== league.userTeamId && !p.everOnUserTeam;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>{p.name}</h2>
          <span style={{ color: 'var(--muted)' }}>
            {posLabel(p)} · {p.age} yrs · {p.exp != null &&<>{p.exp === 0 ? 'Rookie' : `${p.exp} yr${p.exp === 1 ? '' : 's'} exp`} · </>}{team ? <TeamLink team={team} openTeam={openTeam} /> : 'Free Agent'}
          </span>
          <span style={{ flex: 1 }} />
          {team && onTradeFor && (
            <button className="btn small secondary" onClick={() => onTradeFor(p)}>Trade</button>
          )}
          {fogged && commit && (() => {
            const isWatching = league.scouting?.proWatchList?.includes(p.id);
            const games = league.scouting?.proWatching?.[p.id] ?? 0;
            return (
              <button
                className={`btn small secondary${isWatching ? ' active' : ''}`}
                onClick={() => {
                  if (isWatching) removeProWatch(league, p.id);
                  else markProWatch(league, p.id);
                  commit();
                }}
              >
                {isWatching ? `Watching (${games} days)` : 'Watch'}
              </button>
            );
          })()}
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        {p.nationality && (
          <p style={{ margin: '4px 0', color: 'var(--muted)' }}>
            <Origin p={p} full />
          </p>
        )}

        <p style={{ margin: '10px 0' }}>
          Overall: <Ovr p={p} league={league} fogged={fogged} /> · Potential: <Pot p={p} league={league} fogged={fogged} /> · Condition: <Cond p={p} /> ·{' '}
          {p.contract
            ? <>Contract: <b>{money(p.contract.salary)}</b>/yr × <b>{p.contract.years}</b> {p.contract.years === 1 ? 'year' : 'years'}</>
            : <>Asking: <b>{money(askingPrice(p))}</b>/yr</>}
          {p.extension && (
            <> · Extension: <b style={{ color: 'var(--green)' }}>{money(p.extension.salary)}</b>/yr × <b>{p.extension.years}</b> (starts in {p.contract?.years === 1 ? '1 season' : `${p.contract?.years} seasons`})</>
          )}
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

        <p style={{ margin: '10px 0', color: 'var(--muted)' }}>
          {p.backstoryRevealed
            ? <>📰 {scoutBackstoryNote(p)}</>
            : <>Personality: comes across as {personalityNote(p)}.</>}
        </p>

        <h3>Ratings {fogged && <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>(scouted — ranges tighten with experience)</span>}</h3>
        {[...RATINGS, ['stamina', 'Stamina']].map(([key, label]) => {
          // stamina lives outside p.ratings but scouts like any other rating
          const v = key === 'stamina' ? (p.stamina ?? 60) : p.ratings[key];
          const proGames = fogged ? (league.scouting?.proWatching?.[p.id] ?? 0) : 0;
          const hidden = fogged && isHidden(p, proGames);
          const [lo, hi] = (fogged && !hidden) ? scoutRange(p, v, league.season, key, proGames) : [v, v];
          const mid = (lo + hi) / 2;
          return (
            <div className="rating-row" key={key}>
              <span style={{ color: 'var(--muted)' }}>{label}</span>
              <div className="rating-bar"><div style={{ width: `${hidden ? 0 : mid}%`, background: fogged ? 'var(--muted)' : barColor(v) }} /></div>
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums', color: hidden ? 'var(--muted)' : undefined }}>
                {hidden ? '?' : fogged ? `${lo}–${hi}` : v}
              </span>
            </div>
          );
        })}

        {!fogged && <Progression league={league} p={p} />}

        {!fogged && (
          <p style={{ margin: '10px 0' }}>
            <label style={{ color: 'var(--muted)' }}>
              Training Focus:{' '}
              <select
                value={p.trainingFocus || ''}
                onChange={(e) => {
                  p.trainingFocus = e.target.value || null;
                  commit?.();
                }}
              >
                <option value="">None</option>
                {TRAINING_FOCUS_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>
            {p.trainingFocus && (
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
                Boosts development in {TRAINING_FOCUS_OPTIONS.find((f) => f.id === p.trainingFocus).boost.join(', ')} at the cost of slight regression in {TRAINING_FOCUS_OPTIONS.find((f) => f.id === p.trainingFocus).neglect}.
              </span>
            )}
          </p>
        )}

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
                <th className="num">RPG</th><th className="num">APG</th><th className="num">SPG</th><th className="num">BPG</th>
                <th className="num">TOPG</th><th className="num">FG%</th><th className="num">3P%</th><th className="num">FT%</th>
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
                  <td className="num">{perGame(s, 'stl')}</td>
                  <td className="num">{perGame(s, 'blk')}</td>
                  <td className="num">{s.tov != null ? perGame(s, 'tov') : '–'}</td>
                  <td className="num">{fgPct(s)}</td>
                  <td className="num">{s.tpa ? ((s.tpm / s.tpa) * 100).toFixed(1) : '–'}</td>
                  <td className="num">{s.fta ? ((s.ftm / s.fta) * 100).toFixed(1) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {p.contractHistory?.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>Contract History</h3>
            <table>
              <thead>
                <tr><th>Season</th><th>Team</th><th className="num">Salary</th><th className="num">Years</th></tr>
              </thead>
              <tbody>
                {[...p.contractHistory].reverse().map((c, i) => (
                  <tr key={i}>
                    <td>{c.season}</td>
                    <td><TeamLink team={getTeam(league, c.team)} openTeam={openTeam} /></td>
                    <td className="num">{money(c.salary)}</td>
                    <td className="num">{c.years}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3 style={{ marginTop: 14 }}>Similar Players</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {similarPlayers(league, p).map(({ p: sp, team: st }) => {
            const spFogged = st.id !== league.userTeamId;
            return (
              <div key={sp.id}>
                <Ovr p={sp} league={league} fogged={spFogged} /> <PlayerLink p={sp} openPlayer={openPlayer} /> ({posLabel(sp)}) — <TeamLink team={st} openTeam={openTeam} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
