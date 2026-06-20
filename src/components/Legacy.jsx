import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import {
  SINGLE_SEASON_CATS, CAREER_CATS, GAME_HIGH_CATS, formatCatValue, findPlayerById, PACE_CATS,
} from '../engine/legacy.js';
import { groupAwards } from '../engine/awards.js';
import { TeamLink, PlayerLink, NewsText, money } from './shared.jsx';
import { Card } from './ui/Card.jsx';
import { Tabs } from './ui/Tabs.jsx';

const TABS = [
  { key: 'records', label: 'Record Book' },
  { key: 'hof', label: 'Hall of Fame' },
  { key: 'dynasties', label: 'Dynasties' },
  { key: 'legacy', label: 'My Legacy' },
  { key: 'honors', label: 'Honors' },
  { key: 'history', label: 'Season History' },
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

function PaceLeaders({ league, cat, openPlayer }) {
  const flags = league.recordPaceFlags?.[league.season] || {};
  const leaders = [];
  for (const [playerId, catFlags] of Object.entries(flags)) {
    if (!catFlags[cat.key]) continue;
    const p = findPlayerById(league, Number(playerId));
    if (p) leaders.push(p);
  }
  if (leaders.length === 0) return null;
  return (
    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-1)' }}>
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
    <div style={{ marginBottom: 'var(--sp-5)' }}>
      <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>{cat.label}</div>
      {entries.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No qualifying entries yet.</p>}
      {entries.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>{cat.team ? 'Team' : 'Player'}</th>
                {scope === 'season' && !cat.team && <th>Team</th>}
                {scope === 'season' && <th>Season</th>}
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
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
        </div>
      )}
      {scope === 'season' && PACE_CATS.includes(cat) && (
        <PaceLeaders league={league} cat={cat} openPlayer={openPlayer} openTeam={openTeam} />
      )}
    </div>
  );
}

function RecordBook({ league, openPlayer, openTeam }) {
  const book = league.recordBook || { singleSeason: {}, career: {} };
  const highs = league.recordBook?.gameHighs || {};

  return (
    <Card noPad>
      {/* Game Highs */}
      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)' }}>
        <span className="ui-section-title">Game Highs</span>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table">
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
                    <td colSpan={6} style={{ color: 'var(--text-muted)' }}>No qualifying games yet.</td>
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

      <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--sp-4)' }}>
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <span className="ui-section-title">Single-Season Records</span>
        </div>
        {SINGLE_SEASON_CATS.map((cat) => (
          <RecordTable key={cat.key} league={league} cat={cat} entries={book.singleSeason[cat.key] || []} scope="season" openPlayer={openPlayer} openTeam={openTeam} />
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--sp-4)', paddingBottom: 'var(--sp-2)' }}>
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <span className="ui-section-title">Career Records</span>
        </div>
        {CAREER_CATS.map((cat) => (
          <RecordTable key={cat.key} league={league} cat={cat} entries={book.career[cat.key] || []} scope="career" openPlayer={openPlayer} openTeam={openTeam} />
        ))}
      </div>
    </Card>
  );
}

function HallOfFame({ league, openPlayer }) {
  const inductees = [...(league.hallOfFame || [])].sort((a, b) => b.inductedSeason - a.inductedSeason);
  return (
    <Card>
      <span className="ui-section-title" style={{ display: 'block', marginBottom: 'var(--sp-4)' }}>Hall of Fame</span>
      {inductees.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No one has been inducted yet.</p>}
      {inductees.map((h, idx) => {
        const p = findPlayerById(league, h.playerId);
        const cs = h.careerSummary;
        return (
          <div key={h.playerId} style={idx > 0 ? { borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginTop: 'var(--sp-4)' } : {}}>
            <div style={{ marginBottom: 'var(--sp-1)', display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 'var(--text-md)' }}>
                {p ? <PlayerLink p={p} openPlayer={openPlayer}>{h.name}</PlayerLink> : h.name}
              </strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Class of {h.inductedSeason}</span>
            </div>
            {h.draftedByUser && (
              <p style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)' }}>
                ⭐ You drafted him in the {h.draftYear} round {h.draftRound} (pick {h.draftPick}).
              </p>
            )}
            <p style={{ marginTop: 'var(--sp-1)' }}>{h.narrative}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-1)' }}>
              {cs.gp} GP · {cs.ppg} ppg · {cs.rpg} rpg · {cs.apg} apg · {cs.seasons} seasons
              {cs.championships > 0 && <> · {cs.championships}× champion</>}
              {cs.honors && <> · {cs.honors}</>}
            </p>
          </div>
        );
      })}
    </Card>
  );
}

function Dynasties({ league, openPlayer, openTeam }) {
  const dynasties = [...(league.dynasties || [])].sort((a, b) => b.endSeason - a.endSeason);
  return (
    <Card>
      <span className="ui-section-title" style={{ display: 'block', marginBottom: 'var(--sp-4)' }}>Dynasties</span>
      {dynasties.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No dynasty has emerged yet — win 2+ championships within a 4-year span.</p>}
      {dynasties.map((d, idx) => (
        <div key={d.teamId + '-' + d.startSeason} style={idx > 0 ? { borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginTop: 'var(--sp-4)' } : {}}>
          <strong style={{ fontSize: 'var(--text-md)' }}>
            <TeamLink team={getTeam(league, d.teamId)} openTeam={openTeam}>{d.name}</TeamLink>
          </strong>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-1)' }}>
            {d.championships.length}× champions ({d.championships.join(', ')}) · Record {d.record?.wins}-{d.record?.losses}
          </p>
          {d.corePlayers?.length > 0 && (
            <p style={{ marginTop: 'var(--sp-1)' }}>
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
    </Card>
  );
}

function MyLegacy({ league, openPlayer, openTeam }) {
  const gm = league.gmLegacy || {};
  const winPct = gm.totalWins + gm.totalLosses > 0 ? (gm.totalWins / (gm.totalWins + gm.totalLosses) * 100).toFixed(1) : '–';
  return (
    <Card>
      <span className="ui-section-title" style={{ display: 'block', marginBottom: 'var(--sp-4)' }}>My Legacy</span>

      <div className="ui-table-wrap" style={{ marginBottom: 'var(--sp-5)' }}>
        <table className="ui-table">
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
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>Best Trade</div>
        {gm.bestTrade ? (
          <p>{gm.bestTrade.text} <span style={{ color: 'var(--text-muted)' }}>({gm.bestTrade.season})</span></p>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>No standout trade wins yet.</p>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>Best Draft Pick</div>
        {gm.bestDraftPick ? (() => {
          const p = findPlayerById(league, gm.bestDraftPick.playerId);
          return (
            <p>
              {p ? <PlayerLink p={p} openPlayer={openPlayer}>{gm.bestDraftPick.name}</PlayerLink> : gm.bestDraftPick.name}
              {' '}— pick #{gm.bestDraftPick.pick} ({gm.bestDraftPick.season}), peaked at {gm.bestDraftPick.peakOverall} overall.
            </p>
          );
        })() : (
          <p style={{ color: 'var(--text-muted)' }}>No standout draft picks yet.</p>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>Best Free Agent Signing</div>
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
          <p style={{ color: 'var(--text-muted)' }}>No standout free agent steals yet.</p>
        )}
      </div>
    </Card>
  );
}

function allPlayersEver(league) {
  const out = [];
  for (const t of league.teams) for (const p of t.roster) out.push(p);
  for (const p of league.freeAgents) out.push(p);
  for (const p of league.retiredPlayers) out.push(p);
  return out;
}

function AwardRow({ league, label, entry, openPlayer, openTeam }) {
  if (!entry) return null;
  const p = findPlayerById(league, entry.playerId);
  return (
    <tr>
      <td>{label}</td>
      <td>{p ? <PlayerLink p={p} openPlayer={openPlayer}>{entry.name}</PlayerLink> : entry.name}</td>
      <td><TeamLink team={getTeam(league, entry.teamId)} openTeam={openTeam} /></td>
      <td style={{ color: 'var(--text-muted)' }}>{entry.line}</td>
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
      style={{ width: '100%', maxWidth: 320, marginTop: 'var(--sp-3)' }}
    />
  );

  const q = query.trim().toLowerCase();
  if (q) {
    const matches = allPlayersEver(league).filter((p) => (p.awards || []).length && p.name.toLowerCase().includes(q));
    return (
      <Card>
        <span className="ui-section-title" style={{ display: 'block', marginBottom: 'var(--sp-2)' }}>Honors</span>
        {searchBar}
        {matches.length === 0 && <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-3)' }}>No award history for "{query}".</p>}
        {matches.map((p) => (
          <div key={p.id} style={{ marginTop: 'var(--sp-4)' }}>
            <strong style={{ fontSize: 'var(--text-md)' }}><PlayerLink p={p} openPlayer={openPlayer} /></strong>
            <div className="ui-table-wrap" style={{ marginTop: 'var(--sp-2)' }}>
              <table className="ui-table">
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
          </div>
        ))}
      </Card>
    );
  }

  if (!season) {
    return (
      <Card>
        <span className="ui-section-title" style={{ display: 'block', marginBottom: 'var(--sp-2)' }}>Honors</span>
        {searchBar}
        <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-3)' }}>No award history yet — honors are recorded at the end of each season.</p>
      </Card>
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
    <Card noPad>
      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-3)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="ui-section-title">Honors</span>
        <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search player by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />
      </div>

      <div style={{ padding: 'var(--sp-4)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>Major Awards</div>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table">
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
      </div>

      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>All-NBA Teams</div>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead><tr><th>Team</th><th>Player</th><th>Team</th><th>Stats</th></tr></thead>
          <tbody>
            {['First', 'Second', 'Third'].map((label, i) => (
              (a?.allNba?.[i] || []).map((entry) => (
                <AwardRow key={`${label}-${entry.playerId}`} league={league} label={`All-NBA ${label}`} entry={entry} openPlayer={openPlayer} openTeam={openTeam} />
              ))
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>All-Defensive Teams</div>
      </div>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead><tr><th>Team</th><th>Player</th><th>Team</th><th>Stats</th></tr></thead>
          <tbody>
            {['First', 'Second'].map((label, i) => (
              (a?.allDef?.[i] || []).map((entry) => (
                <AwardRow key={`${label}-${entry.playerId}`} league={league} label={`All-Defensive ${label}`} entry={entry} openPlayer={openPlayer} openTeam={openTeam} />
              ))
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: 'var(--sp-4)', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)' }}>All-Stars</div>
        {allStars.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No All-Star roster recorded for {season}.</p>
        ) : (
          <p>{allStars.map((p, i) => (
            <React.Fragment key={p.id}>
              {i > 0 && ', '}
              <PlayerLink p={p} openPlayer={openPlayer} />
            </React.Fragment>
          ))}</p>
        )}
      </div>
    </Card>
  );
}

function FantasyDraftHistory({ league, openPlayer, openTeam }) {
  if (!league.fantasyDraftResults?.length) return null;
  return (
    <Card style={{ marginBottom: 'var(--sp-4)' }}>
      <span className="ui-section-title" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>Founding Fantasy Draft</span>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
        How this franchise was built: every team drafted its roster from a
        league-wide player pool in a 15-round snake draft.
      </p>
      <details>
        <summary className="stories-toggle">All {league.fantasyDraftResults.length} picks</summary>
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr><th className="num">Pick</th><th>Rnd</th><th>Team</th><th>Player</th><th>Pos</th></tr>
            </thead>
            <tbody>
              {league.fantasyDraftResults.map((r) => {
                const p = getTeam(league, r.teamId).roster.find((x) => x.id === r.playerId);
                const mine = r.teamId === league.userTeamId;
                return (
                  <tr key={r.pick} style={mine ? { color: 'var(--color-success)' } : undefined}>
                    <td className="num">{r.pick}</td>
                    <td className="num">{r.round}</td>
                    <td><TeamLink team={getTeam(league, r.teamId)} openTeam={openTeam} /></td>
                    <td>{p ? <PlayerLink p={p} openPlayer={openPlayer} /> : r.playerName}</td>
                    <td>{r.pos}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function SeasonHistory({ league, openPlayer, openTeam }) {
  return (
    <>
      <FantasyDraftHistory league={league} openPlayer={openPlayer} openTeam={openTeam} />
      <Card noPad>
        <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)' }}>
          <span className="ui-section-title">Season History</span>
        </div>
        {league.history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', padding: '0 var(--sp-4) var(--sp-4)' }}>No completed seasons yet.</p>
        ) : (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead><tr><th>Season</th><th>Champion</th><th>MVP</th><th>Your Record</th></tr></thead>
              <tbody>
                {[...league.history].reverse().map((h) => {
                  const stories = league.newsArchive?.[h.season] ?? [];
                  return (
                    <React.Fragment key={h.season}>
                      <tr>
                        <td>{h.season}</td>
                        <td>{h.champion ? <TeamLink team={getTeam(league, h.champion)} openTeam={openTeam} /> : '–'}</td>
                        <td>{h.awards?.mvp?.name ?? '–'}</td>
                        <td>{h.userRecord}</td>
                      </tr>
                      {stories.length > 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '0 8px 6px' }}>
                            <details>
                              <summary className="stories-toggle">That year's biggest stories ({stories.length})</summary>
                              {stories.map((n, i) => (
                                <div className="news-item" key={i}><NewsText text={n.text} openTeam={openTeam} /></div>
                              ))}
                            </details>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function Legacy({ league, openPlayer, openTeam }) {
  const [tab, setTab] = useState('records');
  return (
    <div>
      <Tabs tabs={TABS} activeTab={tab} onTabChange={setTab} />
      {tab === 'records' && <RecordBook league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'hof' && <HallOfFame league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'dynasties' && <Dynasties league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'legacy' && <MyLegacy league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'honors' && <Honors league={league} openPlayer={openPlayer} openTeam={openTeam} />}
      {tab === 'history' && <SeasonHistory league={league} openPlayer={openPlayer} openTeam={openTeam} />}
    </div>
  );
}
