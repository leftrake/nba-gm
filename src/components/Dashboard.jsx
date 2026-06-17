import React from 'react';
import { getTeam, standings, payroll, deadMoneyTotal, dateForDay, teamPlayoffStatus } from '../engine/league.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { overall } from '../engine/players.js';
import { Ovr, money, perGame, fmtDate, TeamLink, NewsText, PlayerLink, ApprovalMeter, approvalColor, GuideTooltip } from './shared.jsx';
import { personalitySummary, ownerStance, seatStatus, isRosterFrozen, directiveStatus, respondToExtension } from '../engine/owner.js';
import { SPECIALTY_INFO } from '../engine/coach.js';
import { LineScore, TopPerformers, usePlayerIndex, asLines } from './BoxScore.jsx';
import { injuryTimeline } from '../engine/injuries.js';
import { NewsItem } from './News.jsx';
import NewsTicker from './Ticker.jsx';
import TradeOffers from './TradeOffers.jsx';
import { ROUND_NAMES } from './Playoffs.jsx';
import Calendar from './Calendar.jsx';

// First scheduled game for `teamId` from the current day forward.
function nextGameFor(league, teamId) {
  for (let di = league.dayIndex; di < league.schedule.length; di++) {
    const g = league.schedule[di].find((x) => x.home === teamId || x.away === teamId);
    if (g) return { di, g };
  }
  return null;
}

// Front-page banner: team identity, record/seed, and the next matchup in
// large display type.
function Banner({ league, team, seed, openTeam }) {
  const ng = nextGameFor(league, team.id);
  const po = league.phase === 'playoffs' ? teamPlayoffStatus(league, team.id) : null;
  return (
    <div className="panel" style={{ borderLeft: '4px solid var(--team-color)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="display-font" style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2 }}>
            {league.season} Season
          </div>
          <h1 className="display-font" style={{ fontSize: 36, margin: '2px 0 6px', lineHeight: 1.1 }}>{team.city} {team.name}</h1>
          <div className="score-big" style={{ fontSize: 26 }}>
            {team.wins}-{team.losses}
            <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'inherit', fontWeight: 400, marginLeft: 10 }}>
              #{seed} in the {team.conf}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
            {league.phase === 'regular' ? 'Next Game' : league.phase === 'playoffs' ? 'Playoffs' : 'Schedule'}
          </div>
          {league.phase === 'playoffs' && po ? (
            po.champion ? (
              <div className="display-font" style={{ fontSize: 18 }}>🏆 NBA Champions</div>
            ) : po.series ? (
              <>
                <div className="display-font" style={{ fontSize: 20 }}>
                  {ROUND_NAMES[po.round]}{' vs '}
                  <TeamLink team={getTeam(league, po.series.high === team.id ? po.series.low : po.series.high)} openTeam={openTeam} />
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Series {po.series.high === team.id ? po.series.highWins : po.series.lowWins}-{po.series.high === team.id ? po.series.lowWins : po.series.highWins}
                  {po.eliminated && ' · Eliminated'}
                </div>
              </>
            ) : (
              <div className="display-font" style={{ fontSize: 18, color: 'var(--muted)' }}>Awaiting next round</div>
            )
          ) : ng ? (
            <>
              <div className="display-font" style={{ fontSize: 20 }}>
                {ng.g.home === team.id ? 'vs' : '@'}{' '}
                <TeamLink team={getTeam(league, ng.g.home === team.id ? ng.g.away : ng.g.home)} openTeam={openTeam} />
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(dateForDay(league, ng.di))}</div>
            </>
          ) : (
            <div className="display-font" style={{ fontSize: 18, color: 'var(--muted)' }}>No games remaining</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Conference standings in context: a handful of rows around the user's
// current seed, with their row highlighted in the team color.
function StandingsWidget({ league, team, openTeam }) {
  const rows = standings(league, team.conf);
  const seedIdx = rows.findIndex((t) => t.id === team.id);
  const start = Math.max(0, Math.min(seedIdx - 2, rows.length - 5));
  const slice = rows.slice(start, start + 5);
  return (
    <div className="panel">
      <h2>{team.conf}ern Conference</h2>
      <table>
        <thead><tr><th>#</th><th>Team</th><th className="num">W</th><th className="num">L</th></tr></thead>
        <tbody>
          {slice.map((t, i) => {
            const rank = start + i;
            return (
              <tr key={t.id} style={t.id === team.id ? { background: 'var(--panel2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : undefined}>
                <td>{rank + 1}{rank === 7 ? ' —' : ''}</td>
                <td><TeamLink team={t} openTeam={openTeam} /></td>
                <td className="num">{t.wins}</td>
                <td className="num">{t.losses}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// League-wide injury report: every player currently out, the user's team
// first, then alphabetical by team.
function InjuryReport({ league, openTeam, openPlayer }) {
  const sortKey = (e) => (e.team.id === league.userTeamId ? '' : `${e.team.city} ${e.team.name}`);
  const injured = league.teams
    .flatMap((team) => team.roster.filter((p) => p.injury).map((p) => ({ team, p })))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return (
    <div className="panel">
      <h2>League Injury Report</h2>
      {injured.length === 0 && <p style={{ color: 'var(--muted)' }}>A clean bill of health — nobody is injured right now.</p>}
      {injured.length > 0 && (
        <table>
          <thead>
            <tr><th>Team</th><th>Player</th><th>Pos</th><th>Injury</th><th className="num">Out</th></tr>
          </thead>
          <tbody>
            {injured.map(({ team, p }) => {
              const severe = p.injury.tier === 'season' || p.injury.tier === 'significant';
              return (
                <tr key={p.id} style={team.id === league.userTeamId ? { background: 'var(--panel2)' } : undefined}>
                  <td><TeamLink team={team} openTeam={openTeam}>{team.name}</TeamLink></td>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  <td>{p.pos}</td>
                  <td style={severe ? { color: 'var(--red)' } : undefined}>🩹 {p.injury.type}</td>
                  <td className="num" style={severe ? { color: 'var(--red)' } : undefined}>
                    {p.injury.tier === 'season' ? 'Season' : `${p.injury.gamesLeft} gm`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The user's most recent game as a rich result card: score, quarter line
// score, top performers from both teams, and a link to the full game page.
function FeaturedGame({ league, fg, openTeam, openPlayer, openGame }) {
  const me = league.userTeamId;
  const byId = usePlayerIndex(league);
  const won = fg.home === me ? fg.homePts > fg.awayPts : fg.awayPts > fg.homePts;
  const title = fg.isPlayoff ? `${ROUND_NAMES[fg.round]} · Game ${fg.gameNo}` : fmtDate(dateForDay(league, fg.day));
  return (
    <div className="panel" style={{ borderLeft: `4px solid ${won ? 'var(--green)' : 'var(--red)'}` }}>
      <h2>Your Last Game · {title}</h2>
      <p className="score-big" style={{ fontSize: 32, marginBottom: 12 }}>
        <span className={fg.awayPts > fg.homePts ? 'winner' : ''}>
          <TeamLink team={getTeam(league, fg.away)} openTeam={openTeam} /> {fg.awayPts}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 20 }}> @ </span>
        <span className={fg.homePts > fg.awayPts ? 'winner' : ''}>
          <TeamLink team={getTeam(league, fg.home)} openTeam={openTeam} /> {fg.homePts}
        </span>
        <b style={{ marginLeft: 10, fontSize: 20, color: won ? 'var(--green)' : 'var(--red)' }}>{won ? 'W' : 'L'}</b>
      </p>
      <LineScore league={league} game={fg} />
      <TopPerformers league={league} game={fg} openPlayer={openPlayer} />
      {fg.injuryReport?.length > 0 && (
        <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>
          🩹 Injury report: {fg.injuryReport.map((e, i) => {
            const p = byId.get(e.playerId);
            const onAway = asLines(fg.awayBox || []).some((l) => l.playerId === e.playerId);
            const teamId = onAway ? fg.away : fg.home;
            return (
              <React.Fragment key={e.playerId}>
                {i > 0 && ', '}
                {p ? <PlayerLink p={p} openPlayer={openPlayer} /> : '–'} ({teamId}) — {e.type} ({injuryTimeline(e)})
              </React.Fragment>
            );
          })}
        </p>
      )}
      <p style={{ marginTop: 10 }}>
        <a className="team-link" style={{ color: 'var(--accent)' }} onClick={() => openGame(fg, title)}>
          Full box score &amp; game flow ▸
        </a>
      </p>
    </div>
  );
}

// Owner profile card: who they are, their current stance/approval, and any
// active directives with deadlines. Shows the projected next-season budget
// once the season is in the books.
function OwnerCard({ league, team, commit }) {
  const owner = team.owner;
  if (!owner) return null;
  const showProjected = league.phase !== 'regular' && league.phase !== 'playoffs' && owner.projectedBudget !== owner.budget;
  return (
    <div className="panel" data-tour="owner-card">
      <h2>Ownership</h2>
      <p style={{ marginTop: 8 }}><b>{owner.name}</b>, Owner</p>
      <p style={{ color: 'var(--muted)' }}>{personalitySummary(owner)}</p>
      <p style={{ marginTop: 8 }}>
        {ownerStance(owner)} · <span style={{ color: approvalColor(owner.approval) }}>{seatStatus(owner)}</span>
      </p>
      <ApprovalMeter value={owner.approval} />
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>Approval {Math.round(owner.approval)}/100</p>
      <p style={{ marginTop: 8 }}>Budget: <b>{money(owner.budget)}</b>{showProjected && <span style={{ color: 'var(--muted)' }}> (projected next season: {money(owner.projectedBudget)})</span>}</p>
      {team.coach && (
        <p style={{ marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>
          Head Coach: <b style={{ color: 'var(--text)' }}>{team.coach.name}</b> · {SPECIALTY_INFO[team.coach.specialty].label}
        </p>
      )}
      {isRosterFrozen(league, team) && (
        <p style={{ color: 'var(--red)' }}>🔒 Roster frozen by ownership.</p>
      )}
      {owner.missedPlayoffsStreak > 0 && (
        <p style={{ color: 'var(--red)' }}>
          📉 Missed the playoffs {owner.missedPlayoffsStreak} season{owner.missedPlayoffsStreak === 1 ? '' : 's'} in a row.
        </p>
      )}
      {owner.champYears > 0 && (
        <p style={{ color: '#e3c567' }}>
          🏆 Championship afterglow — ownership goodwill and revenue boosted for {owner.champYears} more season{owner.champYears === 1 ? '' : 's'}.
        </p>
      )}
      {owner.extensionOffered && (
        <p style={{ color: 'var(--accent)' }}>
          ✉️ {owner.name} has offered you a contract extension as GM.{' '}
          <button className="btn small" onClick={() => { respondToExtension(league, team, true); commit(); }}>Accept</button>{' '}
          <button className="btn small" onClick={() => { respondToExtension(league, team, false); commit(); }}>Decline</button>
        </p>
      )}
      {owner.directives?.length > 0 && (
        <>
          <GuideTooltip
            tipKey="owner_directive"
            text="Your owner wants something specific. Ignoring it costs approval — and low approval leads to budget cuts, interference, and eventually getting fired."
            block
          >
            <h3 style={{ marginTop: 14 }}>Owner Directives</h3>
          </GuideTooltip>
          {owner.directives.map((d, i) => {
            const status = directiveStatus(league, team, d);
            const icon = status === 'done' ? '✅' : status === 'on-track' ? '🟡' : '📋';
            return (
              <p key={i} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                {icon} {d.text}
                <br />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {d.deadline}
                  {status === 'done' && ' · on track to satisfy ownership'}
                  {status === 'on-track' && ' · progress made, but not there yet'}
                </span>
              </p>
            );
          })}
        </>
      )}
    </div>
  );
}

// Banner for an active dynasty era covering the user's team this season.
function DynastyBanner({ league, team }) {
  const dyn = (league.dynasties || []).find((d) =>
    d.teamId === team.id && league.season >= d.startSeason && league.season - d.endSeason <= 1);
  if (!dyn) return null;
  return (
    <div className="panel champion-banner">
      <h2>🏆 {dyn.name}</h2>
      <p style={{ color: 'var(--muted)' }}>
        {dyn.championships.length} championships since {dyn.startSeason} · Record {dyn.record?.wins}-{dyn.record?.losses}
      </p>
    </div>
  );
}

// Dismissible highlight for a record broken by the user's team/player.
function RecordBreakingBanner({ league, commit }) {
  const m = league.recordBreakingMoment;
  if (!m) return null;
  return (
    <div className="panel champion-banner">
      <h2>📜 Record Broken!</h2>
      <p>{m.text}</p>
      <button className="btn small secondary" onClick={() => { league.recordBreakingMoment = null; commit(); }}>
        Dismiss
      </button>
    </div>
  );
}

// Small summary tile linking to the full Legacy screen.
function LegacyTile({ league, setScreen }) {
  const gm = league.gmLegacy || {};
  return (
    <div className="panel">
      <h2>My Legacy</h2>
      <p style={{ color: 'var(--muted)' }}>
        {gm.totalWins ?? 0}-{gm.totalLosses ?? 0} · {gm.championships ?? 0} championship{(gm.championships ?? 0) === 1 ? '' : 's'} ·{' '}
        {gm.confFinalsAppearances ?? 0} conf. finals appearance{(gm.confFinalsAppearances ?? 0) === 1 ? '' : 's'}
      </p>
      <a className="team-link" style={{ color: 'var(--team-color-safe)' }} onClick={() => setScreen('legacy')}>
        View record book, Hall of Fame &amp; more ▸
      </a>
    </div>
  );
}

export default function Dashboard({ league, leagueRef, commit, lastResults, featuredGame, openTeam, openPlayer, openGame, openNews, onCounterTradeOffer, setScreen, trackFeatured, setLastResults }) {
  const team = getTeam(league, league.userTeamId);
  const confStandings = standings(league, team.conf);
  const seed = confStandings.findIndex((t) => t.id === team.id) + 1;
  const pay = payroll(team);
  const dead = deadMoneyTotal(team);
  const topPlayers = [...team.roster].sort((a, b) => overall(b) - overall(a)).slice(0, 5);

  // lastResults all come from the most recently simmed day
  const lastDay = Math.max(0, league.dayIndex - 1);

  return (
    <div>
      <NewsTicker league={league} openTeam={openTeam} />

      <RecordBreakingBanner league={league} commit={commit} />

      <DynastyBanner league={league} team={team} />

      <Banner league={league} team={team} seed={seed} openTeam={openTeam} />

      <LegacyTile league={league} setScreen={setScreen} />

      <OwnerCard league={league} team={team} commit={commit} />

      {featuredGame && (
        <FeaturedGame league={league} fg={featuredGame} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} />
      )}

      <Calendar
        league={league}
        leagueRef={leagueRef}
        commit={commit}
        openTeam={openTeam}
        openGame={openGame}
        setScreen={setScreen}
        trackFeatured={trackFeatured}
        setLastResults={setLastResults}
      />

      <TradeOffers league={league} commit={commit} openPlayer={openPlayer} onCounter={onCounterTradeOffer} />

      <div className="grid2">
        <StandingsWidget league={league} team={team} openTeam={openTeam} />

        <div className="panel">
          <h2>Team Overview</h2>
          <p style={{ marginTop: 8 }}>Payroll: <b>{money(pay)}</b> / Cap {money(SALARY_CAP)}{dead > 0 && <span style={{ color: 'var(--muted)' }}> (incl. {money(dead)} dead money)</span>} {pay > LUXURY_TAX && <span className="tag" style={{ color: 'var(--red)' }}>LUXURY TAX</span>}</p>
          {pay > SALARY_CAP && pay <= LUXURY_TAX ? (
            <GuideTooltip
              tipKey="cap_near_tax"
              text="You're approaching the luxury tax line. Going over costs money and strains owner patience — especially in back-to-back seasons."
              block
            >
              <div className="cap-bar" data-tour="cap-bar"><div className="near" style={{ width: `${Math.min(100, (pay / LUXURY_TAX) * 100)}%` }} /></div>
            </GuideTooltip>
          ) : (
            <div className="cap-bar" data-tour="cap-bar"><div className={pay > LUXURY_TAX ? 'over' : ''} style={{ width: `${Math.min(100, (pay / LUXURY_TAX) * 100)}%` }} /></div>
          )}
          <h3 style={{ marginTop: 14 }}>Top Players</h3>
          <table>
            <tbody>
              {topPlayers.map((p) => (
                <tr key={p.id}>
                  <td><Ovr p={p} /></td>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  <td>{p.pos}</td>
                  <td className="num">{perGame(p.stats, 'pts')} ppg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {lastResults.length > 0 && (
        <div className="panel">
          <h2>Latest Scores</h2>
          {lastResults.map((r, i) => (
            <div className="result-row" key={i}>
              <span className={r.awayPts > r.homePts ? 'winner' : ''}>
                <TeamLink team={getTeam(league, r.away)} openTeam={openTeam}>{r.away}</TeamLink> {r.awayPts}
              </span>
              <span style={{ color: 'var(--muted)' }}>@</span>
              <span className={r.homePts > r.awayPts ? 'winner' : ''}>
                <TeamLink team={getTeam(league, r.home)} openTeam={openTeam}>{r.home}</TeamLink> {r.homePts}
              </span>
              <a className="team-link" style={{ color: 'var(--muted)', fontSize: 12 }}
                 onClick={() => openGame(r, fmtDate(dateForDay(league, lastDay)))}>
                view ▸
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="panel" data-tour="news-feed">
        <h2>Top Stories</h2>
        {league.news.slice(0, 8).map((n, i) => (
          <NewsItem n={n} openTeam={openTeam} userTeamId={league.userTeamId} key={i} />
        ))}
        <p style={{ marginTop: 10 }}>
          <a className="team-link" style={{ color: 'var(--team-color-safe)' }} onClick={openNews}>
            Full news feed ▸
          </a>
        </p>
      </div>

      <InjuryReport league={league} openTeam={openTeam} openPlayer={openPlayer} />

      {league.fantasyDraftResults?.length > 0 && (
        <div className="panel">
          <h2>Founding Fantasy Draft</h2>
          <p style={{ color: 'var(--muted)' }}>
            How this franchise was built: every team drafted its roster from a
            league-wide player pool in a 15-round snake draft.
          </p>
          <details>
            <summary className="stories-toggle">All {league.fantasyDraftResults.length} picks</summary>
            <table>
              <thead>
                <tr><th className="num">Pick</th><th>Rnd</th><th>Team</th><th>Player</th><th>Pos</th></tr>
              </thead>
              <tbody>
                {league.fantasyDraftResults.map((r) => {
                  const p = getTeam(league, r.teamId).roster.find((x) => x.id === r.playerId);
                  const mine = r.teamId === league.userTeamId;
                  return (
                    <tr key={r.pick} style={mine ? { color: 'var(--green)' } : undefined}>
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
          </details>
        </div>
      )}

      {league.history.length > 0 && (
        <div className="panel">
          <h2>History</h2>
          <table>
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
    </div>
  );
}
