import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import {
  SINGLE_SEASON_CATS, CAREER_CATS, GAME_HIGH_CATS, formatCatValue, findPlayerById, PACE_CATS,
} from '../engine/legacy.js';
import { groupAwards } from '../engine/awards.js';
import { TeamLink, PlayerLink, money } from './shared.jsx';

const TABS = [
  ['records', 'Record Book'],
  ['hof', 'Hall of Fame'],
  ['dynasties', 'Dynasties'],
  ['legacy', 'My Legacy'],
  ['honors', 'Honors'],
];

function HolderCell({ league, entry, openPlayer, openTeam }) {
  if (entry.teamId != null) {
    return <TeamLink team={getTeam(league, entry.teamId)} openTeam={openTeam}>{entry.teamName}</TeamLink>;
  }
  const p = findPlayerById(league, entry.playerId);
  return (
    <>
      {p ? <PlayerLink p={p} openPlayer={openPlayer}>{entry.name}</PlayerLink> : entry.name}
      {entry.retired && <span className="tag" style={{ marginLeft: 6 }}>Retired</span>}
    </>
  );
}

function PaceLeaders({ league, cat, openPlayer, openTeam }) {
  const flags = league.recordPaceFlags?.[league.season] || {};
  const leaders = [];
  for (const [playerId, catFlags] of Object.entries(flags)) {
    if (!catFlags[cat.key]) continue;
    const p = findPlayerById(league, Number(playerId));
    if (p) leaders.push(p);
  }
  if (leaders.length === 0) return null;
  return (
    <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
      🔥 On pace this season: {leaders.map((p, i) => (
        <React.Fragment key={p.id}>
          {i > 0 && ', '}
          <PlayerLink p={p} openPlayer={openPlayer} />
        </React.Fragment>
      ))}
    </p>
  );
}

function RecordTable({ league, cat, entries, scope, openPlayer, openTeam }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3>{cat.label}</h3>
      {entries.length === 0 && <p style={{ color: 'var(--muted)' }}>No qualifying entries yet.</p>}
      {entries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th><th>{cat.team ? 'Team' : 'Player'}</th>
              {scope === 'season' && !cat.team && <th>Team</th>}
              {scope === 'season' && <th>Season</th>}
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><HolderCell league={league} entry={entry} openPlayer={openPlayer} openTeam={openTeam} /></td>
                {scope === 'season' && !cat.team && (
                  <td>{entry.team != null ? <TeamLink team={getTeam(league, entry.team)} openTeam={openTeam} /> : '–'}</td>
                )}
                {scope === 'season' && <td>{entry.season}</td>}
                <td className="num">{formatCatValue(cat.key, entry.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {scope === 'season' && PACE_CATS.includes(cat) && (
        <PaceLeaders league={league} cat={cat} openPlayer={openPlayer} openTeam={openTeam} />
      )}
    </div>
  );
}

function GameHighs({ league, openPlayer, openTeam }) {
  const highs = league.recordBook?.gameHighs || {};
  return (
    <div className="panel">
      <h2>Game Highs</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th><th>Player</th><th>Team</th><th>Opponent</th><th>Season</th><th>Final Score</th><th className="num">Value</th>
          </tr>
        </thead>
        <tbody>
          {GAME_HIGH_CATS.map((cat) => {
            const entry = highs[cat.key];
            if (!entry) {
              return (
                <tr key={cat.key}>
                  <td>{cat.label}</td>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>No qualifying games yet.</td>
                </tr>
              );
            }
            const p = findPlayerById(league, entry.playerId);
            return (
              <tr key={cat.key}>
                <td>{cat.label}</td>
                <td>{p ? <PlayerLink p={p} openPlayer={openPlayer}>{entry.name}</PlayerLink> : entry.name}</td>
                <td><TeamLink team={getTeam(league, entry.team)} openTeam={openTeam} /></td>
                <td><TeamLink team={getTeam(league, entry.opponent)} openTeam={openTeam} /></td>
                <td>{entry.season}</td>
                <td>{entry.teamScore}-{entry.oppScore}</td>
                <td className="num">{formatCatValue(cat.key, entry.value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecordBook({ league, openPlayer, openTeam }) {
  const book = league.recordBook || { singleSeason: {}, career: {} };
  return (
    <>
      <GameHighs league={league} openPlayer={openPlayer} openTeam={openTeam} />
      <div className="panel">
        <h2>Single-Season Records</h2>
        {SINGLE_SEASON_CATS.map((cat) => (
          <RecordTable key={cat.key} league={league} cat={cat} entries={book.singleSeason[cat.key] || []} scope="season" openPlayer={openPlayer} openTeam={openTeam} />
        ))}
      </div>
      <div className="panel">
        <h2>Career Records</h2>
        {CAREER_CATS.map((cat) => (
          <RecordTable key={cat.key} league={league} cat={cat} entries={book.career[cat.key] || []} scope="career" openPlayer={openPlayer} openTeam={openTeam} />
        ))}
      </div>
    </>
  );
}

function HallOfFame({ league, openPlayer }) {
  const inductees = [...(league.hallOfFame || [])].sort((a, b) => b.inductedSeason - a.inductedSeason);
  return (
    <div className="panel">
      <h2>Hall of Fame</h2>
      {inductees.length === 0 && <p style={{ color: 'var(--muted)' }}>No one has been inducted yet.</p>}
      {inductees.map((h) => {
        const p = findPlayerById(league, h.playerId);
        const cs = h.careerSummary;
        return (
          <div key={h.playerId} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
            <h3 style={{ marginBottom: 4 }}>
              {p ? <PlayerLink p={p} openPlayer={openPlayer}>{h.name}</PlayerLink> : h.name}
              <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>Class of {h.inductedSeason}</span>
            </h3>
            {h.draftedByUser && (
              <p style={{ color: 'var(--green)', fontSize: 13 }}>
                ⭐ You drafted him in the {h.draftYear} round {h.draftRound} (pick {h.draftPick}).
              </p>
            )}
            <p>{h.narrative}</p>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {cs.gp} GP · {cs.ppg} ppg · {cs.rpg} rpg · {cs.apg} apg · {cs.seasons} seasons
              {cs.championships > 0 && <> · {cs.championships}× champion</>}
              {cs.honors && <> · {cs.honors}</>}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Dynasties({ league, openPlayer, openTeam }) {
  const dynasties = [...(league.dynasties || [])].sort((a, b) => b.endSeason - a.endSeason);
  return (
    <div className="panel">
      <h2>Dynasties</h2>
      {dynasties.length === 0 && <p style={{ color: 'var(--muted)' }}>No dynasty has emerged yet — win 2+ championships within a 4-year span.</p>}
      {dynasties.map((d) => (
        <div key={d.teamId + '-' + d.startSeason} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
          <h3 style={{ marginBottom: 4 }}>
            <TeamLink team={getTeam(league, d.teamId)} openTeam={openTeam}>{d.name}</TeamLink>
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            {d.championships.length}× champions ({d.championships.join(', ')}) · Record {d.record?.wins}-{d.record?.losses}
          </p>
          {d.corePlayers?.length > 0 && (
            <p>
              Core players:{' '}
              {d.corePlayers.map((cp, i) => {
                const p = findPlayerById(league, cp.id);
                return (
                  <React.Fragment key={cp.id}>
                    {i > 0 && ', '}
                    {p ? <PlayerLink p={p} openPlayer={openPlayer}>{cp.name}</PlayerLink> : cp.name}
                  </React.Fragment>
                );
              })}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function MyLegacy({ league, openPlayer, openTeam }) {
  const gm = league.gmLegacy || {};
  const winPct = gm.totalWins + gm.totalLosses > 0 ? (gm.totalWins / (gm.totalWins + gm.totalLosses) * 100).toFixed(1) : '–';
  return (
    <div className="panel">
      <h2>My Legacy</h2>
      <table>
        <tbody>
          <tr><td>Record</td><td className="num">{gm.totalWins ?? 0}-{gm.totalLosses ?? 0} ({winPct}%)</td></tr>
          <tr><td>Championships</td><td className="num">{gm.championships ?? 0}</td></tr>
          <tr><td>Conference Finals Appearances</td><td className="num">{gm.confFinalsAppearances ?? 0}</td></tr>
          <tr>
            <td>Best Season</td>
            <td className="num">{gm.bestSeasonRecord ? `${gm.bestSeasonRecord.wins}-${gm.bestSeasonRecord.losses} (${gm.bestSeasonRecord.season})` : '–'}</td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>Best Trade</h3>
      {gm.bestTrade ? (
        <p>{gm.bestTrade.text} <span style={{ color: 'var(--muted)' }}>({gm.bestTrade.season})</span></p>
      ) : (
        <p style={{ color: 'var(--muted)' }}>No standout trade wins yet.</p>
      )}

      <h3 style={{ marginTop: 14 }}>Best Draft Pick</h3>
      {gm.bestDraftPick ? (() => {
        const p = findPlayerById(league, gm.bestDraftPick.playerId);
        return (
          <p>
            {p ? <PlayerLink p={p} openPlayer={openPlayer}>{gm.bestDraftPick.name}</PlayerLink> : gm.bestDraftPick.name}
            {' '}— pick #{gm.bestDraftPick.pick} ({gm.bestDraftPick.season}), peaked at {gm.bestDraftPick.peakOverall} overall.
          </p>
        );
      })() : (
        <p style={{ color: 'var(--muted)' }}>No standout draft picks yet.</p>
      )}

      <h3 style={{ marginTop: 14 }}>Best Free Agent Signing</h3>
      {gm.bestFASigning ? (() => {
        const p = findPlayerById(league, gm.bestFASigning.playerId);
        return (
          <p>
            {p ? <PlayerLink p={p} openPlayer={openPlayer}>{gm.bestFASigning.name}</PlayerLink> : gm.bestFASigning.name}
            {' '}— signed for {money(gm.bestFASigning.salary)}/yr in {gm.bestFASigning.season}, peaked at {gm.bestFASigning.peakOverall} overall
            (a {money(gm.bestFASigning.steal)}/yr steal).
          </p>
        );
      })() : (
        <p style={{ color: 'var(--muted)' }}>No standout free agent steals yet.</p>
      )}
    </div>
  );
}

// Every player who has ever appeared in this save: active rosters, free
// agents, and retirees — the only places a player's `.awards` list survives.
function allPlayersEver(league) {
  const out = [];
  for (const t of league.teams) for (const p of t.roster) out.push(p);
  for (const p of league.freeAgents) out.push(p);
  for (const p of league.retiredPlayers) out.push(p);
  return out;
}

// One award-winner row: entries come from league.history[i].awards, shaped
// { playerId, name, teamId, line }.
function AwardRow({ league, label, entry, openPlayer, openTeam }) {
  if (!entry) return null;
  const p = findPlayerById(league, entry.playerId);
  return (
    <tr>
      <td>{label}</td>
      <td>{p ? <PlayerLink p={p} openPlayer={openPlayer}>{entry.name}</PlayerLink> : entry.name}</td>
      <td><TeamLink team={getTeam(league, entry.teamId)} openTeam={openTeam} /></td>
      <td style={{ color: 'var(--muted)' }}>{entry.line}</td>
    </tr>
  );
}

function Honors({ league, openPlayer, openTeam }) {
  const seasons = (league.history || [])
    .filter((h) => h.awards)
    .map((h) => h.season)
    .sort((a, b) => b - a);
  const [season, setSeason] = useState(seasons[0] ?? null);
  const [query, setQuery] = useState('');

  const searchBar = (
    <input
      type="text"
      placeholder="Search player by name…"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      style={{ width: '100%', maxWidth: 320, marginTop: 8 }}
    />
  );

  const q = query.trim().toLowerCase();
  if (q) {
    const matches = allPlayersEver(league).filter((p) => (p.awards || []).length && p.name.toLowerCase().includes(q));
    return (
      <div className="panel">
        <h2>Honors</h2>
        {searchBar}
        {matches.length === 0 && <p style={{ color: 'var(--muted)' }}>No award history for "{query}".</p>}
        {matches.map((p) => (
          <div key={p.id} style={{ marginTop: 14 }}>
            <h3><PlayerLink p={p} openPlayer={openPlayer} /></h3>
            <table>
              <thead><tr><th>Award</th><th>Seasons</th></tr></thead>
              <tbody>
                {groupAwards(p.awards).map((g) => (
                  <tr key={g.award}>
                    <td>{g.award}</td>
                    <td>{g.seasons.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }

  if (!season) {
    return (
      <div className="panel">
        <h2>Honors</h2>
        {searchBar}
        <p style={{ color: 'var(--muted)' }}>No award history yet — honors are recorded at the end of each season.</p>
      </div>
    );
  }

  const a = league.history.find((h) => h.season === season)?.awards;
  const allStars = [];
  let asMvp = null;
  for (const p of allPlayersEver(league)) {
    for (const honor of p.awards || []) {
      if (honor.season !== season) continue;
      if (honor.award === 'All-Star') allStars.push(p);
      if (honor.award === 'All-Star MVP') asMvp = p;
    }
  }

  return (
    <div className="panel">
      <h2>Honors</h2>
      <div className="controls" style={{ marginBottom: 0 }}>
        <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {searchBar}

      <h3 style={{ marginTop: 14 }}>Major Awards</h3>
      <table>
        <thead><tr><th>Award</th><th>Player</th><th>Team</th><th>Stats</th></tr></thead>
        <tbody>
          <AwardRow league={league} label="MVP" entry={a?.mvp} openPlayer={openPlayer} openTeam={openTeam} />
          <AwardRow league={league} label="Defensive Player of the Year" entry={a?.dpoy} openPlayer={openPlayer} openTeam={openTeam} />
          <AwardRow league={league} label="Rookie of the Year" entry={a?.roy} openPlayer={openPlayer} openTeam={openTeam} />
          <AwardRow league={league} label="Sixth Man of the Year" entry={a?.sixth} openPlayer={openPlayer} openTeam={openTeam} />
          {asMvp && (
            <tr>
              <td>All-Star MVP</td>
              <td><PlayerLink p={asMvp} openPlayer={openPlayer} /></td>
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>All-NBA Teams</h3>
      <table>
        <thead><tr><th>Team</th><th>Player</th><th>Team</th><th>Stats</th></tr></thead>
        <tbody>
          {['First', 'Second', 'Third'].map((label, i) => (
            (a?.allNba?.[i] || []).map((entry) => (
              <AwardRow key={`${label}-${entry.playerId}`} league={league} label={`All-NBA ${label}`} entry={entry} openPlayer={openPlayer} openTeam={openTeam} />
            ))
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>All-Defensive Teams</h3>
      <table>
        <thead><tr><th>Team</th><th>Player</th><th>Team</th><th>Stats</th></tr></thead>
        <tbody>
          {['First', 'Second'].map((label, i) => (
            (a?.allDef?.[i] || []).map((entry) => (
              <AwardRow key={`${label}-${entry.playerId}`} league={league} label={`All-Defensive ${label}`} entry={entry} openPlayer={openPlayer} openTeam={openTeam} />
            ))
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>All-Stars</h3>
      {allStars.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No All-Star roster recorded for {season}.</p>
      ) : (
        <p>{allStars.map((p, i) => (
          <React.Fragment key={p.id}>
            {i > 0 && ', '}
            <PlayerLink p={p} openPlayer={openPlayer} />
          </React.Fragment>
        ))}</p>
      )}
    </div>
  );
}

export default function Legacy({ league, openPlayer, openTeam }) {
  const [tab, setTab] = useState('records');
  return (
    <div>
      <div className="panel">
        <h2>Legacy &amp; Records</h2>
        <div className="news-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'records' && <RecordBook league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'hof' && <HallOfFame league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'dynasties' && <Dynasties league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'legacy' && <MyLegacy league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'honors' && <Honors league={league} openPlayer={openPlayer} openTeam={openTeam} />}
    </div>
  );
}
