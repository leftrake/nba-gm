import React from 'react';
import { getTeam, standings, payroll, deadMoneyTotal, dateForDay, teamPlayoffStatus } from '../engine/league.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { overall } from '../engine/players.js';
import { Ovr, money, perGame, fmtDate, TeamLink, NewsText, PlayerLink, GuideTooltip } from './shared.jsx';
import { LineScore, TopPerformers, usePlayerIndex, asLines } from './BoxScore.jsx';
import { injuryTimeline } from '../engine/injuries.js';
import { NewsItem } from './News.jsx';
import NewsTicker from './Ticker.jsx';
import TradeOffers from './TradeOffers.jsx';
import { ROUND_NAMES } from './Playoffs.jsx';
import Calendar from './Calendar.jsx';
import { Card, Stat, Section, SectionHeader, Table, Badge, ProgressBar, Divider } from './ui/index.js';

// First scheduled game for `teamId` from the current day forward.
function nextGameFor(league, teamId) {
  for (let di = league.dayIndex; di < league.schedule.length; di++) {
    const g = league.schedule[di].find((x) => x.home === teamId || x.away === teamId);
    if (g) return { di, g };
  }
  return null;
}

// ── Hero banner (Card: lifted hero with team-color accent) ───────────────────
function Banner({ league, team, seed, openTeam }) {
  const ng = nextGameFor(league, team.id);
  const po = league.phase === 'playoffs' ? teamPlayoffStatus(league, team.id) : null;

  let nextStat = null;
  if (league.phase === 'playoffs' && po) {
    if (po.champion) {
      nextStat = <Stat size="lg" value="🏆 NBA Champions" label="Playoffs" />;
    } else if (po.series) {
      const opp = getTeam(league, po.series.high === team.id ? po.series.low : po.series.high);
      const myW = po.series.high === team.id ? po.series.highWins : po.series.lowWins;
      const oppW = po.series.high === team.id ? po.series.lowWins : po.series.highWins;
      nextStat = (
        <Stat
          size="lg"
          value={<>{ROUND_NAMES[po.round]} · vs <TeamLink team={opp} openTeam={openTeam} /></>}
          label={`Series ${myW}-${oppW}${po.eliminated ? ' · Eliminated' : ''}`}
        />
      );
    } else {
      nextStat = <Stat size="md" value="Awaiting next round" label="Playoffs" color="var(--text-muted)" />;
    }
  } else if (ng) {
    const opp = getTeam(league, ng.g.home === team.id ? ng.g.away : ng.g.home);
    nextStat = (
      <Stat
        size="lg"
        value={<>{ng.g.home === team.id ? 'vs' : '@'} <TeamLink team={opp} openTeam={openTeam} /></>}
        label={`${league.phase === 'regular' ? 'Next Game' : 'Schedule'} · ${fmtDate(dateForDay(league, ng.di))}`}
      />
    );
  } else {
    nextStat = (
      <Stat size="md" value="No games remaining" label={league.phase === 'regular' ? 'Next Game' : 'Schedule'} color="var(--text-muted)" />
    );
  }

  return (
    <Card style={{ borderLeft: '4px solid var(--team-color)', marginBottom: 'var(--sp-5)' }}>
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 2 }}>
          {league.season} Season
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', lineHeight: 'var(--leading-tight)', marginTop: 'var(--sp-1)', color: 'var(--text-primary)' }}>
          {team.city} {team.name}
        </h1>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-8)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Stat size="xl" value={`${team.wins}-${team.losses}`} label="Record" color="var(--team-color-safe)" />
        <Stat size="md" value={`#${seed}`} label={`${team.conf}ern Conference`} />
        {nextStat}
      </div>
    </Card>
  );
}

// ── Celebration callouts (Card: special animated moments) ────────────────────
function DynastyBanner({ league, team }) {
  const dyn = (league.dynasties || []).find((d) =>
    d.teamId === team.id && league.season >= d.startSeason && league.season - d.endSeason <= 1);
  if (!dyn) return null;
  return (
    <Card className="champion-banner" style={{ textAlign: 'center', marginBottom: 'var(--sp-4)' }}>
      <h2>🏆 {dyn.name}</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        {dyn.championships.length} championships since {dyn.startSeason} · Record {dyn.record?.wins}-{dyn.record?.losses}
      </p>
    </Card>
  );
}

function RecordBreakingBanner({ league, commit }) {
  const m = league.recordBreakingMoment;
  if (!m) return null;
  return (
    <Card className="champion-banner" style={{ textAlign: 'center', marginBottom: 'var(--sp-4)' }}>
      <h2>📜 Record Broken!</h2>
      <p>{m.text}</p>
      <button className="btn small secondary" onClick={() => { league.recordBreakingMoment = null; commit(); }}>
        Dismiss
      </button>
    </Card>
  );
}

// ── GM Legacy — bare Section ─────────────────────────────────────────────────
function LegacySection({ league, setScreen }) {
  const gm = league.gmLegacy || {};
  return (
    <Section
      title="My Legacy"
      action={
        <a className="team-link" style={{ color: 'var(--team-color-safe)', fontSize: 'var(--text-sm)' }} onClick={() => setScreen('legacy')}>
          View record book ▸
        </a>
      }
      spacing="sm"
    >
      <p style={{ color: 'var(--text-muted)' }}>
        {gm.totalWins ?? 0}-{gm.totalLosses ?? 0} · {gm.championships ?? 0} championship{(gm.championships ?? 0) === 1 ? '' : 's'} ·{' '}
        {gm.confFinalsAppearances ?? 0} conf. finals appearance{(gm.confFinalsAppearances ?? 0) === 1 ? '' : 's'}
      </p>
    </Section>
  );
}

// ── Last game result — Section with raised Card for the score callout ─────────
function FeaturedGame({ league, fg, openTeam, openPlayer, openGame }) {
  const me = league.userTeamId;
  const byId = usePlayerIndex(league);
  const won = fg.home === me ? fg.homePts > fg.awayPts : fg.awayPts > fg.homePts;
  const title = fg.isPlayoff ? `${ROUND_NAMES[fg.round]} · Game ${fg.gameNo}` : fmtDate(dateForDay(league, fg.day));
  return (
    <Section title={`Last Game · ${title}`} spacing="sm">
      {/* Score — raised callout card with win/loss accent */}
      <Card elevation="raised" style={{ borderLeft: `3px solid ${won ? 'var(--color-success)' : 'var(--color-danger)'}`, padding: 'var(--sp-3) var(--sp-4)' }}>
        <p className="score-big" style={{ fontSize: 32 }}>
          <span className={fg.awayPts > fg.homePts ? 'winner' : ''}>
            <TeamLink team={getTeam(league, fg.away)} openTeam={openTeam} /> {fg.awayPts}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 20 }}> @ </span>
          <span className={fg.homePts > fg.awayPts ? 'winner' : ''}>
            <TeamLink team={getTeam(league, fg.home)} openTeam={openTeam} /> {fg.homePts}
          </span>
          <b style={{ marginLeft: 10, fontSize: 20, color: won ? 'var(--color-success)' : 'var(--color-danger)' }}>{won ? 'W' : 'L'}</b>
        </p>
      </Card>
      {/* Supplementary details on the bare surface */}
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <LineScore league={league} game={fg} />
        <TopPerformers league={league} game={fg} openPlayer={openPlayer} />
        {fg.injuryReport?.length > 0 && (
          <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-3)' }}>
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
        <p style={{ marginTop: 'var(--sp-3)' }}>
          <a className="team-link" style={{ color: 'var(--accent)' }} onClick={() => openGame(fg, title)}>
            Full box score &amp; game flow ▸
          </a>
        </p>
      </div>
    </Section>
  );
}

// ── Conference standings snippet — bare Section ──────────────────────────────
function StandingsSection({ league, team, openTeam }) {
  const rows = standings(league, team.conf);
  const seedIdx = rows.findIndex((t) => t.id === team.id);
  const start = Math.max(0, Math.min(seedIdx - 2, rows.length - 5));
  const slice = rows.slice(start, start + 5);
  return (
    <Section title={`${team.conf}ern Conference`} spacing="sm">
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr><th>#</th><th>Team</th><th className="num">W</th><th className="num">L</th></tr>
          </thead>
          <tbody>
            {slice.map((t, i) => {
              const rank = start + i;
              return (
                <tr key={t.id} style={t.id === team.id ? { background: 'var(--surface-2)', boxShadow: 'inset 3px 0 0 var(--team-color-safe)' } : undefined}>
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
    </Section>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ league, leagueRef, commit, lastResults, featuredGame, openTeam, openPlayer, openGame, openNews, onCounterTradeOffer, setScreen, trackFeatured, setLastResults }) {
  const team = getTeam(league, league.userTeamId);
  const confStandings = standings(league, team.conf);
  const seed = confStandings.findIndex((t) => t.id === team.id) + 1;
  const pay = payroll(team);
  const dead = deadMoneyTotal(team);
  const topPlayers = [...team.roster].sort((a, b) => overall(b) - overall(a)).slice(0, 5);
  const lastDay = Math.max(0, league.dayIndex - 1);
  const capVariant = pay > LUXURY_TAX ? 'danger' : pay > SALARY_CAP ? 'warning' : 'primary';

  // GuideTooltip for the cap bar needs to wrap it — keep original logic inline
  const capBar = pay > SALARY_CAP && pay <= LUXURY_TAX ? (
    <GuideTooltip
      tipKey="cap_near_tax"
      text="You're approaching the luxury tax line. Going over costs money and strains owner patience — especially in back-to-back seasons."
      block
    >
      <div data-tour="cap-bar">
        <ProgressBar value={Math.min(100, (pay / LUXURY_TAX) * 100)} variant="warning" />
      </div>
    </GuideTooltip>
  ) : (
    <div data-tour="cap-bar">
      <ProgressBar value={Math.min(100, (pay / LUXURY_TAX) * 100)} variant={capVariant} />
    </div>
  );

  return (
    <div>
      <NewsTicker league={league} openTeam={openTeam} />

      <RecordBreakingBanner league={league} commit={commit} />
      <DynastyBanner league={league} team={team} />

      {/* Hero — Card (lifted) */}
      <Banner league={league} team={team} seed={seed} openTeam={openTeam} />

      {/* GM Legacy */}
      <LegacySection league={league} setScreen={setScreen} />

      {/* Last game result — right after hero for immediate context */}
      {featuredGame && (
        <>
          <Divider />
          <FeaturedGame league={league} fg={featuredGame} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} />
        </>
      )}

      {/* Calendar + trade offers (existing components, own visual weight) */}
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

      {/* Standings + Team Overview side-by-side */}
      <Divider />
      <div className="grid2">
        <StandingsSection league={league} team={team} openTeam={openTeam} />
        <Section title="Team Overview" spacing="sm">
          <div style={{ display: 'flex', gap: 'var(--sp-6)', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
            <Stat
              size="md"
              value={money(pay)}
              label={`Payroll · Cap ${money(SALARY_CAP)}`}
              color={pay > LUXURY_TAX ? 'var(--color-danger)' : pay > SALARY_CAP ? 'var(--color-warning)' : undefined}
            />
            {dead > 0 && <Stat size="sm" value={money(dead)} label="Dead Money" />}
            {pay > LUXURY_TAX && <Badge variant="danger" style={{ alignSelf: 'flex-end', marginBottom: 2 }}>Luxury Tax</Badge>}
          </div>
          {capBar}
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <SectionHeader title="Top Players" />
            <Table
              columns={[
                { key: 'ovr', label: 'OVR' },
                { key: 'name', label: 'Player' },
                { key: 'pos', label: 'Pos' },
                { key: 'pts', label: 'PPG', numeric: true },
              ]}
              rows={topPlayers.map((p) => ({
                _key: p.id,
                ovr: <Ovr p={p} />,
                name: <PlayerLink p={p} openPlayer={openPlayer} />,
                pos: p.pos,
                pts: perGame(p.stats, 'pts'),
              }))}
            />
          </div>
        </Section>
      </div>

      {/* Latest Scores */}
      {lastResults.length > 0 && (
        <>
          <Divider />
          <Section title="Latest Scores" spacing="sm">
            {lastResults.map((r, i) => (
              <div className="result-row" key={i}>
                <span className={r.awayPts > r.homePts ? 'winner' : ''}>
                  <TeamLink team={getTeam(league, r.away)} openTeam={openTeam}>{r.away}</TeamLink> {r.awayPts}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>@</span>
                <span className={r.homePts > r.awayPts ? 'winner' : ''}>
                  <TeamLink team={getTeam(league, r.home)} openTeam={openTeam}>{r.home}</TeamLink> {r.homePts}
                </span>
                <a className="team-link" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}
                   onClick={() => openGame(r, fmtDate(dateForDay(league, lastDay)))}>
                  view ▸
                </a>
              </div>
            ))}
          </Section>
        </>
      )}

      {/* Top Stories */}
      <Divider />
      <div data-tour="news-feed">
        <Section
          title="Top Stories"
          action={
            <a className="team-link" style={{ color: 'var(--team-color-safe)', fontSize: 'var(--text-sm)' }} onClick={openNews}>
              Full feed ▸
            </a>
          }
          spacing="sm"
        >
          {league.news.slice(0, 8).map((n, i) => (
            <NewsItem n={n} openTeam={openTeam} userTeamId={league.userTeamId} key={i} />
          ))}
        </Section>
      </div>

      {/* Injury Report */}
      <Divider />
      <Section title="League Injury Report" spacing="sm">
        {(() => {
          const sortKey = (e) => (e.team.id === league.userTeamId ? '' : `${e.team.city} ${e.team.name}`);
          const injured = league.teams
            .flatMap((t) => t.roster.filter((p) => p.injury).map((p) => ({ team: t, p })))
            .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
          if (injured.length === 0) {
            return <p style={{ color: 'var(--text-muted)' }}>A clean bill of health — nobody is injured right now.</p>;
          }
          return (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr><th>Team</th><th>Player</th><th>Pos</th><th>Injury</th><th className="num">Out</th></tr>
                </thead>
                <tbody>
                  {injured.map(({ team: t, p }) => {
                    const severe = p.injury.tier === 'season' || p.injury.tier === 'significant';
                    return (
                      <tr key={p.id} style={t.id === league.userTeamId ? { background: 'var(--surface-2)' } : undefined}>
                        <td><TeamLink team={t} openTeam={openTeam}>{t.name}</TeamLink></td>
                        <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                        <td>{p.pos}</td>
                        <td style={severe ? { color: 'var(--color-danger)' } : undefined}>🩹 {p.injury.type}</td>
                        <td className="num" style={severe ? { color: 'var(--color-danger)' } : undefined}>
                          {p.injury.tier === 'season' ? 'Season' : `${p.injury.gamesLeft} gm`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Section>

      {/* Founding Fantasy Draft */}
      {league.fantasyDraftResults?.length > 0 && (
        <>
          <Divider />
          <Section title="Founding Fantasy Draft" spacing="sm">
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
          </Section>
        </>
      )}

      {/* Season History */}
      {league.history.length > 0 && (
        <>
          <Divider />
          <Section title="History" spacing="sm">
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
          </Section>
        </>
      )}
    </div>
  );
}
