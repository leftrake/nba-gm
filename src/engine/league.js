import { TEAMS, SALARY_CAP, LUXURY_TAX, MIN_SALARY, MAX_SALARY, MLE_AMOUNT, ROSTER_MAX } from '../data/teams.js';
import { makeRng, randInt, clamp, gauss } from './rng.js';
import { generatePlayer, resetPlayerIds, emptyStats, developPlayer, overall, salaryFor, assignOrigin, shouldRetire, generateStamina, supportedMinutes, generateDurability, snapshotRatings, ratingRow } from './players.js';
import { rollGameInjuries, tickInjuries, injuryTimeline } from './injuries.js';
import { simGame, applyBoxToStats, encodeBox, starLines } from './sim.js';
import { initDraft } from './draft.js';
import { initFantasyDraft } from './fantasyDraft.js';
import { ensureDraftPicks } from './draftPicks.js';
import { computeAwards, honorsSummary } from './awards.js';
import { evaluateStrategies, maybeAiTrade, maybeAiSalaryDump } from './strategy.js';
import { autoLineup } from './lineup.js';
import { SAVE_VERSION, NEWS_MAX, pushNews } from './save.js';
import {
  initMorale, moraleSalaryMult, applyResultMorale, bumpRosterMorale, bumpTurmoil,
  dailyMoraleUpdate, updateTradeDemands, maybeShopDisgruntled, adjustMorale,
} from './morale.js';
import { extensionType, extensionSalaryRange, rookieMax } from './extensions.js';
import { maybeGenerateTradeOffer, expireTradeOffers } from './tradeOffers.js';
import { diffStats } from './stats.js';
import { buildAllStarEvent } from './allstar.js';
import { generateOwner, dailyApprovalUpdate, maybeOwnerInterference, processOwnerSeason, playoffRoundReached, issueDirectives } from './owner.js';

export function createLeague(userTeamId, seed = Date.now(), opts = {}) {
  const rng = makeRng(seed);
  resetPlayerIds(1);
  const fantasy = !!opts.fantasyDraft;

  const teams = TEAMS.map((t) => ({
    ...t,
    roster: fantasy ? [] : makeRoster(rng),
    deadMoney: [], // { playerName, salary, years } — cap hits from waived contracts
    wins: 0,
    losses: 0,
    tradesThisSeason: 0,
  }));

  const league = {
    saveVersion: SAVE_VERSION,
    seed,
    season: 2026,
    userTeamId,
    teams,
    schedule: makeSchedule(teams, rng),
    dayIndex: 0,
    resultsByDay: [],
    phase: fantasy ? 'fantasydraft' : 'regular', // regular | playoffs | offseason | draft | freeagency | fantasydraft
    playoffs: null,
    freeAgents: fantasy ? [] : Array.from({ length: 60 }, () => {
      // unsigned for a reason: the open market skews toward fringe talent
      const p = generatePlayer(rng, { base: clamp(gauss(48, 8, rng), 35, 72) });
      p.contract = null;
      return p;
    }),
    news: [{ day: 0, season: 2026, phase: 'regular', category: 'league', teamIds: [userTeamId], text: `Welcome, GM! You're now running the ${TEAMS.find(t => t.id === userTeamId).city} ${TEAMS.find(t => t.id === userTeamId).name}.` }],
    newsArchive: {}, // { [season]: [major news items, chronological] }
    tradeOffers: [], // incoming AI trade offers awaiting a response
    history: [],
  };
  if (fantasy) {
    initFantasyDraft(league, rng);
  } else {
    league.freeAgents.sort((a, b) => overall(b) - overall(a));
    // Only the user's lineup persists; AI teams auto-set theirs every game
    getTeam(league, userTeamId).lineup = autoLineup(getTeam(league, userTeamId).roster);
    evaluateStrategies(league);
    ensureDraftPicks(league);
  }
  if (userTeamId) {
    const userTeam = getTeam(league, userTeamId);
    userTeam.owner = generateOwner(rng, userTeam);
    issueDirectives(league, userTeam, rng);
  }
  return league;
}

function makeRoster(rng) {
  // Talent pyramid, NBA-shaped: a star, a second option, supporting
  // starters, rotation pieces, and bench filler. (gauss() here has an
  // effective sd of ~0.4x the nominal value, so i.i.d. rolls would produce
  // a league with no stars at all — the pyramid is explicit instead.)
  // Priced by salaryFor, a roster like this naturally costs near the cap.
  // Tier levels match the league the draft pipeline sustains long-run, so
  // the league-wide average rating holds steady from season one instead of
  // inflating toward a stronger steady state.
  const tiers = [
    [81, 10], [75, 8], [71, 7], [67, 6], [67, 6], [63, 6], [63, 6],
    [57, 6], [57, 6], [57, 6], [48, 6], [48, 6], [48, 6], [48, 6],
  ];
  // positional coverage: 2 of each position + 4 random, shuffled so the
  // star slot isn't always a point guard
  const positions = ['PG', 'PG', 'SG', 'SG', 'SF', 'SF', 'PF', 'PF', 'C', 'C', null, null, null, null];
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const roster = tiers.map(([mean, spread], i) => {
    // min of two rolls skews young (~25 avg), matching the steady-state
    // league the talent pipeline produces over many simulated seasons
    const age = Math.min(randInt(19, 36, rng), randInt(19, 36, rng));
    // ...which also concentrates talent in the prime years: the young
    // arrive raw (the potential curve hands their value back as upside),
    // primes run hot. Without this skew the opening league's young
    // cohort peaks too strong and the league average inflates for the
    // first several seasons before settling.
    const ageAdj = age <= 24 ? -4 : age <= 32 ? 6 : 2;
    return generatePlayer(rng, {
      pos: positions[i] || undefined,
      age,
      base: clamp(gauss(mean + ageAdj, spread, rng), 35, 90),
      // A young opening-day star keeps a superstar ceiling. Without these,
      // the league hits a star drought in seasons 2-4: opening primes have
      // declined and the first drafted superstars haven't matured yet.
      potential: i === 0 && age <= 23 ? randInt(84, 91, rng) : undefined,
    });
  });

  // Calibrate opening-day books: scale every contract toward a target near
  // the cap, so most franchises start within $10M of it and some slightly
  // over. The scaling leaves individual players a little over- or
  // underpaid relative to market, which is realistic.
  const target = SALARY_CAP - 7_000_000 + rng() * 14_000_000; // $134M–$148M
  for (let pass = 0; pass < 3; pass++) {
    const total = roster.reduce((s, p) => s + p.contract.salary, 0);
    const factor = target / total;
    if (Math.abs(factor - 1) < 0.02) break;
    for (const p of roster) {
      p.contract.salary = clamp(
        Math.round((p.contract.salary * factor) / 100_000) * 100_000,
        MIN_SALARY, MAX_SALARY,
      );
    }
  }
  return roster;
}

// Target season length in calendar days: Oct 21 → ~Apr 13 (see dateForDay).
// The placer may run a few days over if constraints force it.
export const SEASON_DAYS = 175;

// Fixed calendar events, as dayIndex offsets from Oct 21 (day 0).
export const OPENING_NIGHT_DAY = 0;
export const CHRISTMAS_DAY = 65; // Oct 21 + 65 = Dec 25
export const TRADE_DEADLINE_DAY = 115; // ~Feb 13 — last day trades are allowed
export const ALL_STAR_DAYS = [116, 117, 118]; // Fri (skills/dunk), Sat, Sun (game) — no games scheduled

export function getLeagueEvents() {
  return [
    { id: 'opening-night', dayIndex: OPENING_NIGHT_DAY, icon: '🎉', label: 'Opening Night', description: 'The season tips off around the league tonight.' },
    { id: 'christmas', dayIndex: CHRISTMAS_DAY, icon: '🎄', label: 'Christmas Day Games', description: "A full slate of marquee Christmas Day matchups around the league." },
    { id: 'trade-deadline', dayIndex: TRADE_DEADLINE_DAY, icon: '⏰', label: 'Trade Deadline', description: 'Last day for trades this season — all deals lock after today.' },
    { id: 'all-star-friday', dayIndex: ALL_STAR_DAYS[0], icon: '⭐', label: 'All-Star Friday', description: 'Skills Challenge and 3-Point Contest — no games tonight.' },
    { id: 'all-star-game', dayIndex: ALL_STAR_DAYS[ALL_STAR_DAYS.length - 1], icon: '⭐', label: 'All-Star Game', description: "The All-Star Game caps the league's mid-season break." },
  ];
}

// Real NBA formula, per team: 4 division opponents x4 (16 games),
// 6 in-conference opponents x4 + 4 in-conference opponents x3 (36),
// all 15 other-conference opponents x2, one home one away (30) = 82.
//
// Which cross-division conference opponents get 3 games (instead of 4) is
// decided by an offset rule on each team's index within its division: for
// ordered divisions X < Y, the pair (X[i], Y[j]) plays 3 games iff
// (j - i) mod 5 is 1 or 2. That gives every team exactly two 3-game
// opponents in each of the other two divisions (so 6x4 + 4x3), and
// alternating which side hosts twice balances everyone to 41 home games.
function buildMatchups(teams) {
  const games = [];
  // n-game series alternating venue, `a` hosting first (and the extra game when n is odd)
  const pushSeries = (a, b, n) => {
    for (let k = 0; k < n; k++) {
      games.push(k % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
  };

  const confs = { East: [], West: [] };
  for (const t of teams) confs[t.conf].push(t);

  for (const e of confs.East) for (const w of confs.West) pushSeries(e.id, w.id, 2);

  for (const conf of ['East', 'West']) {
    const divNames = [...new Set(confs[conf].map((t) => t.div))].sort();
    const byDiv = divNames.map((dn) => confs[conf].filter((t) => t.div === dn));

    for (const div of byDiv) {
      for (let i = 0; i < div.length; i++) {
        for (let j = i + 1; j < div.length; j++) pushSeries(div[i].id, div[j].id, 4);
      }
    }

    for (let x = 0; x < byDiv.length; x++) {
      for (let y = x + 1; y < byDiv.length; y++) {
        const X = byDiv[x], Y = byDiv[y];
        for (let i = 0; i < X.length; i++) {
          for (let j = 0; j < Y.length; j++) {
            const off = (j - i + 5) % 5;
            if (off === 1) pushSeries(X[i].id, Y[j].id, 3);
            else if (off === 2) pushSeries(Y[j].id, X[i].id, 3);
            else pushSeries(X[i].id, Y[j].id, 4);
          }
        }
      }
    }
  }
  return games;
}

export function makeSchedule(teams, rng) {
  const pool = buildMatchups(teams);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const remainingCount = Object.fromEntries(teams.map((t) => [t.id, 0]));
  for (const g of pool) { remainingCount[g.home]++; remainingCount[g.away]++; }

  const playedDays = Object.fromEntries(teams.map((t) => [t.id, new Set()]));
  // Back-to-backs are allowed, three games in three days are not,
  // and no team plays more than 4 games in any 7-day span.
  const canPlay = (id, d) => {
    const days = playedDays[id];
    if (days.has(d)) return false;
    if (days.has(d - 1) && days.has(d - 2)) return false;
    let recent = 0;
    for (let k = d - 6; k < d; k++) if (days.has(k)) recent++;
    return recent < 4;
  };

  const schedule = [];
  let remaining = pool;
  for (let d = 0; remaining.length > 0; d++) {
    // All-Star Weekend: no games leaguewide.
    if (ALL_STAR_DAYS.includes(d)) {
      schedule.push([]);
      continue;
    }
    // Pace the league so games run out right around SEASON_DAYS; teams with
    // the most games left get scheduled first so nobody falls behind.
    const target = d < SEASON_DAYS
      ? Math.ceil(remaining.length / (SEASON_DAYS - d)) + 1
      : teams.length / 2;
    // Soft penalty keeps back-to-backs occasional rather than routine
    const scored = remaining
      .map((g) => ({
        g,
        score: remainingCount[g.home] + remainingCount[g.away]
          - (playedDays[g.home].has(d - 1) ? 4 : 0)
          - (playedDays[g.away].has(d - 1) ? 4 : 0)
          + rng() * 2,
      }))
      .sort((a, b) => b.score - a.score);
    const day = [];
    const leftover = [];
    for (const { g } of scored) {
      if (day.length < target && canPlay(g.home, d) && canPlay(g.away, d)) {
        day.push(g);
        playedDays[g.home].add(d);
        playedDays[g.away].add(d);
        remainingCount[g.home]--;
        remainingCount[g.away]--;
      } else {
        leftover.push(g);
      }
    }
    schedule.push(day);
    remaining = leftover;
  }
  return schedule;
}

export function getTeam(league, id) {
  return league.teams.find((t) => t.id === id);
}

// Saves predating player origins / experience: fill the missing fields.
// Seeded from the league, so repeated loads of an unsaved league derive the
// same values.
export function backfillPlayers(league) {
  const rng = makeRng(league.seed + 424_243);
  const fill = (p) => {
    if (!p.nationality) assignOrigin(p, rng);
    if (p.exp == null) p.exp = Math.max(0, p.age - randInt(19, 22, rng));
    // stats fields added with the possession sim
    if (p.stats && p.stats.ftm == null) { p.stats.ftm = 0; p.stats.fta = 0; p.stats.tov = 0; }
    if (p.stats && p.stats.pf == null) p.stats.pf = 0;
    // stats fields added with rebound splits and plus/minus
    if (p.stats && p.stats.oreb == null) { p.stats.oreb = 0; p.stats.dreb = 0; p.stats.pm = 0; }
    if (!p.awards) p.awards = []; // saves predating awards
    // saves predating the stamina/fatigue system
    if (p.stamina == null) p.stamina = generateStamina(p.pos, p.age, rng);
    if (p.condition == null) p.condition = 100;
    // saves predating the injury system
    if (p.durability == null) p.durability = generateDurability(rng);
    // saves predating the morale system
    if (p.morale == null) p.morale = initMorale(p.id);
    if (p.moraleLowStreak == null) p.moraleLowStreak = 0;
    if (p.tradeDemand == null) p.tradeDemand = false;
  };
  for (const team of league.teams) team.roster.forEach(fill);
  for (const team of league.teams) if (team.turmoil == null) team.turmoil = 0;
  for (const team of league.teams) {
    if (team.tradesThisSeason == null) team.tradesThisSeason = 0;
    if (team.market == null) team.market = TEAMS.find((t) => t.id === team.id)?.market || 'medium';
  }
  // Saves predating the ownership system: generate an owner for the user's team
  if (league.userTeamId) {
    const userTeam = getTeam(league, league.userTeamId);
    if (userTeam && !userTeam.owner) {
      userTeam.owner = generateOwner(rng, userTeam);
      issueDirectives(league, userTeam, rng);
    }
  }
  league.freeAgents.forEach(fill);
  league.draft?.prospects?.forEach(fill);
  // Saves predating draft-pick trading
  ensureDraftPicks(league);
  // Saves predating front-office strategies
  if (league.teams.some((t) => !t.strategy)) evaluateStrategies(league);
  // Saves predating lineups
  const user = getTeam(league, league.userTeamId);
  if (!user.lineup) user.lineup = autoLineup(user.roster);
  // Saves predating the news cap
  if (league.news.length > NEWS_MAX) league.news.length = NEWS_MAX;
  // Saves predating incoming trade offers
  if (!league.tradeOffers) league.tradeOffers = [];
  // Saves predating news categories/archiving
  if (!league.newsArchive) league.newsArchive = {};
  for (const n of league.news) {
    if (!n.category) n.category = 'league';
    if (n.season == null) n.season = league.season;
  }
}

// Schedule day N falls on Oct 21 + N of the year before `season`
// (a season labeled 2026 runs Oct 2025 – spring 2026).
export function dateForDay(league, dayIndex) {
  return new Date(league.season - 1, 9, 21 + dayIndex);
}

// Inverse of dateForDay: which dayIndex (possibly negative or beyond the
// schedule) does a given calendar date fall on?
export function dayIndexForDate(league, date) {
  const start = new Date(league.season - 1, 9, 21);
  return Math.round((date - start) / 86400000);
}

export function payroll(team) {
  return team.roster.reduce((s, p) => s + (p.contract?.salary || 0), 0) + deadMoneyTotal(team);
}

export function deadMoneyTotal(team) {
  return (team.deadMoney || []).reduce((s, d) => s + d.salary, 0);
}

// ---------- Condition ----------
// Day-to-day freshness (0–100), shown on the Roster screen and read by the
// game sim as a flat rating penalty. Playing burns it: cheap minutes for
// high-stamina players, expensive for low-stamina ones, with a steep
// surcharge past the minutes stamina supports.
function conditionCost(p, min) {
  const perMin = clamp(0.42 - ((p.stamina ?? 60) - 50) * 0.006, 0.16, 0.65);
  const over = Math.max(0, min - supportedMinutes(p));
  return min * perMin + Math.pow(over, 1.5) * 0.35;
}

const setCond = (p, v) => { p.condition = Math.round(clamp(v, 0, 100) * 10) / 10; };

// One calendar day for every player: a big overnight recovery on a rest
// day, a small one on a game day — which is why the second night of a
// back-to-back starts lower — minus the burn for tonight's minutes.
function updateConditions(league, results) {
  const minToday = new Map();
  for (const r of results) {
    for (const line of [...r.homeBox, ...r.awayBox]) minToday.set(line.playerId, line.min);
  }
  for (const team of league.teams) {
    for (const p of team.roster) {
      const cond = p.condition ?? 100;
      const min = minToday.get(p.id) ?? 0;
      const recover = min > 0 ? 2 + (100 - cond) * 0.08 : 5 + (100 - cond) * 0.2;
      setCond(p, cond + recover - conditionCost(p, min));
    }
  }
  // unsigned players rest too, so a mid-season signing arrives fresh
  for (const p of league.freeAgents) setCond(p, (p.condition ?? 100) + 5 + (100 - (p.condition ?? 100)) * 0.2);
}

// Simulate one day of games. Returns results.
export function simDay(league) {
  if (league.phase !== 'regular' || league.dayIndex >= league.schedule.length) return [];
  const rng = makeRng(league.seed + league.dayIndex * 7919 + 13);
  const results = [];
  for (const g of league.schedule[league.dayIndex]) {
    const home = getTeam(league, g.home);
    const away = getTeam(league, g.away);
    const r = simGame(home, away, rng);
    // injured players sat out tonight (tick), then anyone who played risks
    // getting hurt (roll) — order matters so fresh casualties don't tick
    // the game they just played. Roll injuries before tallying stats so a
    // player hurt mid-game banks only the minutes he actually played.
    tickInjuries(league, home);
    tickInjuries(league, away);
    const hurt = [
      ...rollGameInjuries(league, home, r.homeBox, rng),
      ...rollGameInjuries(league, away, r.awayBox, rng),
    ];
    applyBoxToStats(home.roster, r.homeBox);
    applyBoxToStats(away.roster, r.awayBox);
    const injuryReport = hurt.map((p) => ({ playerId: p.id, type: p.injury.type, tier: p.injury.tier, gamesLeft: p.injury.gamesLeft }));
    for (const p of hurt) {
      r.events.push({ q: '', t: '', text: `🩹 ${p.name} left the game injured: ${p.injury.type} (${injuryTimeline(p.injury)}).` });
    }
    if (r.homePts > r.awayPts) { home.wins++; away.losses++; }
    else { away.wins++; home.losses++; }
    results.push({ ...g, homePts: r.homePts, awayPts: r.awayPts, homeBox: r.homeBox, awayBox: r.awayBox, homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs, events: r.events, injuryReport });
  }
  // unsigned players heal on the calendar — no games to count down
  if (league.dayIndex % 2 === 0) {
    for (const p of league.freeAgents) {
      if (p.injury && p.injury.tier !== 'season' && --p.injury.gamesLeft <= 0) p.injury = null;
    }
  }
  if (!league.resultsByDay) league.resultsByDay = []; // saves predating this field
  // What persists per game (resultsByDay resets every season, so nothing
  // piles up across years): the user's games keep the full box scores and
  // game-flow events; everyone else's keep just the quarter line score and
  // each side's top performers, so a season of results stays well under
  // ~1MB of localStorage. Boxes store in compact array form (see BOX_COLS).
  league.resultsByDay[league.dayIndex] = results.map((r) => {
    const slim = { home: r.home, away: r.away, homePts: r.homePts, awayPts: r.awayPts, homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs, injuryReport: r.injuryReport };
    if (r.home === league.userTeamId || r.away === league.userTeamId) {
      return { ...slim, homeBox: encodeBox(r.homeBox), awayBox: encodeBox(r.awayBox), events: r.events };
    }
    return { ...slim, homeStars: encodeBox(starLines(r.homeBox)), awayStars: encodeBox(starLines(r.awayBox)) };
  });
  updateConditions(league, results);
  dailyMoraleUpdate(league, results);
  updateTradeDemands(league);
  maybeShopDisgruntled(league, rng);
  maybeAiTrade(league, rng);
  maybeAiSalaryDump(league, rng);
  aiExtensions(league, rng);
  maybeAiMidSeasonSigning(league, rng);
  expireTradeOffers(league);
  maybeGenerateTradeOffer(league, rng);
  const userTeam = league.userTeamId ? getTeam(league, league.userTeamId) : null;
  if (userTeam) {
    dailyApprovalUpdate(userTeam);
    maybeOwnerInterference(league, userTeam, rng);
  }
  league.dayIndex += 1;
  if (league.dayIndex === TRADE_DEADLINE_DAY + 1) {
    pushNews(league, { day: league.dayIndex, category: 'league', major: true, text: '🔒 The trade deadline has passed. All trades are locked until the offseason.' });
  }
  if (league.dayIndex === ALL_STAR_DAYS[0] && league.allStar?.season !== league.season) {
    league.allStar = buildAllStarEvent(league, rng);
    pushNews(league, { day: league.dayIndex, category: 'league', major: true, text: '⭐ All-Star rosters have been announced — the league pauses for All-Star Weekend.' });
  }
  if (league.dayIndex >= league.schedule.length) {
    league.phase = 'playoffs';
    league.playoffs = initPlayoffs(league);
    computeAwards(league);
    // the week off before the playoffs gets everyone most of the way fresh
    for (const team of league.teams) {
      for (const p of team.roster) setCond(p, (p.condition ?? 100) + 20 + (100 - (p.condition ?? 100)) * 0.5);
    }
    pushNews(league, { day: league.dayIndex, category: 'league', text: 'The regular season is over. Playoffs begin!' });
  }
  return results;
}

export function standings(league, conf) {
  return league.teams
    .filter((t) => !conf || t.conf === conf)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}

// ---------- Playoffs ----------
export function initPlayoffs(league) {
  const seedConf = (conf) => standings(league, conf).slice(0, 8).map((t) => t.id);
  return {
    round: 0, // 0=first round, 1=conf semis, 2=conf finals, 3=finals
    East: makeRoundMatchups(seedConf('East')),
    West: makeRoundMatchups(seedConf('West')),
    finals: null,
    champion: null,
    completed: [], // finished series from earlier rounds: { round, conf, series }
    log: [],
  };
}

function makeRoundMatchups(seeds) {
  // 1v8, 4v5, 3v6, 2v7
  const order = [[0, 7], [3, 4], [2, 5], [1, 6]];
  return order.map(([a, b]) => makeSeries(seeds[a], seeds[b]));
}

function makeSeries(high, low) {
  return { high, low, highWins: 0, lowWins: 0, winner: null, games: [] };
}

// Best-of-7 under the 2-2-1-1-1 format: games 1, 2, 5, 7 at the higher seed
export function seriesHomeTeam(m, gameIdx) {
  return [m.high, m.high, m.low, m.low, m.high, m.low, m.high][gameIdx];
}

// Sim one game in every unfinished series of the current round; advance the
// round only once all its series are decided. Returns the games played this
// call as { series, game, round } so the UI can show a post-game view.
export function simPlayoffGame(league) {
  const po = league.playoffs;
  if (!po || po.champion) return [];
  const played = [];
  po.gamesPlayed = po.gamesPlayed || 0; // also covers saves predating this field
  const rng = makeRng(league.seed + 999_983 + po.round * 31 + po.gamesPlayed * 101);

  // Playoff schedules have off days between games: burn condition for
  // tonight's minutes, then bank roughly two rest days before the next one.
  const playoffCondition = (team, box) => {
    const minByPlayer = new Map(box.map((l) => [l.playerId, l.min]));
    for (const p of team.roster) {
      const cond = p.condition ?? 100;
      setCond(p, cond + 9 + (100 - cond) * 0.3 - conditionCost(p, minByPlayer.get(p.id) ?? 0));
    }
  };

  const playGame = (m) => {
    if (!m || m.winner) return;
    const homeId = seriesHomeTeam(m, m.highWins + m.lowWins);
    const awayId = homeId === m.high ? m.low : m.high;
    const r = simGame(getTeam(league, homeId), getTeam(league, awayId), rng);
    const hurt = [];
    for (const [id, box] of [[homeId, r.homeBox], [awayId, r.awayBox]]) {
      const team = getTeam(league, id);
      playoffCondition(team, box);
      tickInjuries(league, team);
      for (const p of rollGameInjuries(league, team, box, rng)) {
        hurt.push(p);
        r.events.push({ q: '', t: '', text: `🩹 ${p.name} left the game injured: ${p.injury.type} (${injuryTimeline(p.injury)}).` });
      }
    }
    if (!m.games) m.games = [];
    // playoff games keep their full box scores and game log for the season
    // (league.playoffs resets every year, so they don't accumulate)
    const game = {
      home: homeId, away: awayId, homePts: r.homePts, awayPts: r.awayPts,
      homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs, events: r.events,
      homeBox: encodeBox(r.homeBox), awayBox: encodeBox(r.awayBox),
      injuryReport: hurt.map((p) => ({ playerId: p.id, type: p.injury.type, tier: p.injury.tier, gamesLeft: p.injury.gamesLeft })),
    };
    m.games.push(game);
    played.push({ series: m, game, round: po.round });
    po.gamesPlayed += 1;
    const highWon = (r.homePts > r.awayPts) === (homeId === m.high);
    if (highWon) m.highWins += 1; else m.lowWins += 1;
    // playoff results swing morale harder than a regular-season game
    applyResultMorale(getTeam(league, homeId), r.homePts > r.awayPts, 2);
    applyResultMorale(getTeam(league, awayId), r.awayPts > r.homePts, 2);
    if (m.highWins === 4 || m.lowWins === 4) {
      m.winner = m.highWins === 4 ? m.high : m.low;
      po.log.push(`${getTeam(league, m.winner).name} win series ${Math.max(m.highWins, m.lowWins)}-${Math.min(m.highWins, m.lowWins)}`);
    }
  };

  if (po.round < 3) {
    for (const conf of ['East', 'West']) po[conf].forEach(playGame);
    if (['East', 'West'].every((c) => po[c].every((m) => m.winner))) advanceRound(po, league);
  } else if (po.finals && !po.finals.winner) {
    playGame(po.finals);
    if (po.finals.winner) {
      po.champion = po.finals.winner;
      const champ = getTeam(league, po.champion);
      bumpRosterMorale(champ, 10);
      pushNews(league, { day: league.dayIndex, category: 'league', major: true, teamIds: [champ.id], text: `🏆 The ${champ.city} ${champ.name} are NBA Champions!` });
      league.phase = 'offseason';
    }
  }
  return played;
}

function advanceRound(po, league) {
  // archive the round's series so their games stay viewable all season
  if (!po.completed) po.completed = []; // saves predating series history
  for (const conf of ['East', 'West']) {
    for (const m of po[conf]) {
      po.completed.push({ round: po.round, conf, series: m });
      bumpRosterMorale(getTeam(league, m.winner), 3); // playoff series win
    }
  }
  if (po.East.length === 1 && po.West.length === 1) {
    // Finals home court goes to the conference champ with the better record
    const e = getTeam(league, po.East[0].winner);
    const w = getTeam(league, po.West[0].winner);
    po.finals = e.wins >= w.wins ? makeSeries(e.id, w.id) : makeSeries(w.id, e.id);
    po.round = 3;
  } else {
    for (const conf of ['East', 'West']) {
      const winners = po[conf].map((m) => m.winner);
      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        const a = getTeam(league, winners[i]);
        const b = getTeam(league, winners[i + 1]);
        next.push(a.wins >= b.wins ? makeSeries(a.id, b.id) : makeSeries(b.id, a.id));
      }
      po[conf] = next;
    }
    po.round += 1;
  }
}

// Fast-forward: sim game-by-game until the current round is done
export function simPlayoffRound(league) {
  const po = league.playoffs;
  if (!po || po.champion) return [];
  const startRound = po.round;
  let guard = 0;
  const played = [];
  while (!po.champion && po.round === startRound && guard++ < 100) played.push(...simPlayoffGame(league));
  return played;
}

// ---------- Offseason ----------
// A retirement write-up with career averages and honors. Pool players who
// never appeared in an NBA game leave silently.
function announceRetirement(league, p, teamId = null) {
  const tot = (p.careerStats || []).reduce(
    (a, s) => ({ gp: a.gp + s.gp, pts: a.pts + s.pts, reb: a.reb + s.reb, ast: a.ast + s.ast }),
    { gp: 0, pts: 0, reb: 0, ast: 0 }
  );
  if (!tot.gp) return;
  const seasons = new Set((p.careerStats || []).map((s) => s.season)).size;
  const avg = (k) => (tot[k] / tot.gp).toFixed(1);
  let text = `${p.name} retires at age ${p.age} after ${seasons} season${seasons === 1 ? '' : 's'}: `
    + `${avg('pts')} ppg, ${avg('reb')} rpg, ${avg('ast')} apg across ${tot.gp} games.`;
  const honors = honorsSummary(p.awards);
  if (honors) text += ` Honors: ${honors}.`;
  // a decorated career ending is a headline; a journeyman's is a footnote
  pushNews(league, { day: 0, category: 'milestone', major: !!honors, teamIds: teamId ? [teamId] : undefined, text });
}

export function advanceOffseason(league) {
  const rng = makeRng(league.seed + league.season * 104729);
  const userTeam = getTeam(league, league.userTeamId); // absent in headless all-AI sims
  league.history.push({
    season: league.season,
    champion: league.playoffs?.champion || null,
    userRecord: userTeam ? `${userTeam.wins}-${userTeam.losses}` : '',
    awards: league.seasonAwards ?? null, // snapshot from computeAwards at season's end
  });
  league.seasonAwards = null;

  // Captured before per-team wins/losses reset below, for the ownership system
  const ownerResult = userTeam ? {
    wins: userTeam.wins,
    playoffRound: playoffRoundReached(league, userTeam.id),
    champion: league.playoffs?.champion === userTeam.id,
  } : null;

  const expiring = [];
  const retiring = [];
  const devEntries = []; // the user team's development report rows
  for (const team of league.teams) {
    const isUserTeam = team.id === league.userTeamId;
    for (const p of team.roster) {
      // archive season stats, split into one row per team if traded mid-season
      let prev = emptyStats();
      for (const stint of p.seasonStints || []) {
        const stintStats = diffStats(stint.stats, prev);
        if (stintStats.gp > 0) p.careerStats.push({ season: league.season, team: stint.team, ...stintStats });
        prev = stint.stats;
      }
      const finalStats = diffStats(p.stats, prev);
      if (finalStats.gp > 0) p.careerStats.push({ season: league.season, team: team.id, ...finalStats });
      p.seasonStints = [];
      p.stats = emptyStats();
      p.condition = 100; // a summer off heals everything
      p.injury = null; // ...including last spring's torn ACL
      snapshotRatings(p, league.season); // progression history: ratings before this summer's development
      const oldRow = ratingRow(p);
      developPlayer(p, rng);
      const entry = isUserTeam
        ? { id: p.id, name: p.name, pos: p.pos, age: p.age, old: oldRow, now: ratingRow(p) }
        : null;
      if (entry) devEntries.push(entry);
      // Retirement comes for everyone, contract or not; a retired contract
      // simply comes off the books.
      if (shouldRetire(p, rng) || (p.age >= 30 && overall(p) < 40)) {
        if (entry) entry.retired = true;
        retiring.push({ team, p });
        continue;
      }
      if (p.contract) {
        p.contract.years -= 1;
        if (p.contract.years <= 0) {
          if (p.extension) {
            // the extension signed during the season kicks in seamlessly
            p.contract = p.extension;
            p.extension = null;
            delete p.extOfferMade;
          } else {
            // a 1st-round rookie-scale deal that just ran out unextended
            // sends the player to restricted free agency instead of the
            // normal Bird-rights re-sign window
            const wasRookieScale = p.draftPick && p.draftPick <= 30 && (p.exp ?? 0) === 4;
            if (isUserTeam && !p.extOfferMade) {
              // he notices the front office never even tried to extend him
              adjustMorale(p, -8);
            }
            p.contract = null;
            if (wasRookieScale) {
              p.restrictedFA = true;
              p.formerTeamId = team.id;
            }
            expiring.push({ team, p, wasRookieScale });
          }
        } else {
          // extension talks are a once-a-season affair; give him a fresh
          // shot next season if his deal didn't expire
          delete p.extTalksFailed;
        }
      }
    }
    // Dead money burns off on the same clock as the contracts it came from
    team.deadMoney = (team.deadMoney || [])
      .map((d) => ({ ...d, years: d.years - 1 }))
      .filter((d) => d.years > 0);
    team.lastWins = team.wins; // free agents judge teams by last season's record
    team.wins = 0;
    team.losses = 0;
  }

  // The user reviews this on the Development Report screen after advancing.
  // One report per save — overwritten every offseason, so it stays small.
  // Empty in headless all-AI sims, where no team is the user's.
  league.devReport = { season: league.season, entries: devEntries };

  for (const { team, p } of retiring) {
    team.roster = team.roster.filter((x) => x.id !== p.id);
    announceRetirement(league, p, team.id);
  }

  // Expiring contracts: the incumbent team gets a re-sign window
  // (Bird-rights style — allowed to cross the cap, but not the luxury
  // tax). Teams keep their best players most of the time, so only a few
  // quality starters reach the open market each summer. The user's
  // expiring players always hit free agency — re-signing them is the
  // user's job.
  for (const { team, p, wasRookieScale } of expiring) {
    // If the front office already passed on extending him mid-season, that
    // was the retention decision — he tests the market (no second roll).
    const triedMidSeason = p.extTalksFailed;
    delete p.extTalksFailed;
    if (wasRookieScale) {
      // restrictedFA/formerTeamId already set when his rookie deal expired
      team.roster = team.roster.filter((x) => x.id !== p.id);
      league.freeAgents.push(p);
      pushNews(league, { day: 0, category: 'signing', teamIds: [team.id], text: `${p.name}'s rookie-scale contract expires without an extension — he enters restricted free agency.` });
      continue;
    }
    if (team.id !== league.userTeamId && !triedMidSeason && rng() < resignChance(team, p)) {
      // Bird-rights premium: incumbents pay a little over market to keep
      // their own players off the open market
      const salary = clamp(
        Math.round((askingPrice(p) * (1.0 + rng() * 0.25)) / 100_000) * 100_000,
        MIN_SALARY, MAX_SALARY,
      );
      // contenders push past the tax line a bit to keep their core together
      const ceiling = team.strategy === 'contending' ? LUXURY_TAX + 15_000_000 : LUXURY_TAX;
      if (payroll(team) + salary <= ceiling) {
        p.contract = { salary, years: preferredYears(p) };
        delete p.extOfferMade;
        if (overall(p) >= 70) {
          pushNews(league, { day: 0, category: 'signing', teamIds: [team.id], text: `${p.name} re-signs with the ${team.city} ${team.name} (${fmtM(salary)} x ${p.contract.years}yr).` });
        }
        continue;
      }
    }
    team.roster = team.roster.filter((x) => x.id !== p.id);
    league.freeAgents.push(p);
  }

  // Age free agents, drop retirees, top up the pool
  league.freeAgents = league.freeAgents.filter((p) => {
    p.condition = 100;
    p.injury = null;
    snapshotRatings(p, league.season);
    developPlayer(p, rng);
    if (overall(p) >= 38 && !shouldRetire(p, rng)) return true;
    announceRetirement(league, p);
    return false;
  });
  while (league.freeAgents.length < 50) {
    // pool top-ups are fringe talent — quality starters rarely go unsigned
    const p = generatePlayer(rng, { age: randInt(19, 30, rng), base: clamp(gauss(48, 8, rng), 35, 70) });
    p.contract = null;
    league.freeAgents.push(p);
  }
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  // The pool would otherwise grow without bound (each draft class outnumbers
  // retirements); the unsigned tail quietly heads overseas
  if (league.freeAgents.length > 70) league.freeAgents.length = 70;

  // Front offices reassess direction each summer
  const labels = { contending: 'win-now mode', rebuilding: 'a full rebuild', retooling: 'a retool' };
  for (const { team, to } of evaluateStrategies(league)) {
    if (team.id === league.userTeamId) continue;
    pushNews(league, { day: 0, category: 'league', teamIds: [team.id], text: `The ${team.name} front office shifts to ${labels[to]}.` });
  }

  if (userTeam && ownerResult) {
    processOwnerSeason(league, userTeam, rng, ownerResult);
  }

  league.season += 1;
  // Draft first, then free agency (finishDraft opens it)
  initDraft(league, rng);
  league.phase = 'draft';
  pushNews(league, { day: 0, category: 'league', text: `Welcome to the ${league.season} offseason. The draft is up first, then free agency.` });
}

// How likely a team is to re-sign its own expiring player before he hits
// the market. Better players are kept harder, winners keep their guys,
// and homegrown draftees (p.draftTeam) get a loyalty bump.
function resignChance(team, p) {
  if (p.tradeDemand) return 0; // a player who demanded out won't stay
  const ovr = overall(p);
  let chance = ovr >= 80 ? 0.88 : ovr >= 70 ? 0.8 : ovr >= 60 ? 0.6 : 0.35;
  // mid-season (extensions) this is the live record; in the offseason the
  // games are zeroed out and it falls back to last season's
  const winPct = currentWinPct(team);
  chance += (winPct - 0.5) * 0.4; // stars stay with winners, drift from losers
  if (p.draftTeam === team.id) chance += 0.1;
  if (p.age >= 34) chance -= 0.15; // aging vets get let go
  // rebuilders actively shed salary: expensive vets who aren't core pieces
  // hit the market instead of getting Bird-rights renewals
  if (team.strategy === 'rebuilding' && (p.contract?.salary || 0) > 8_000_000 && ovr < 80) chance -= 0.35;
  return clamp(chance, 0.05, 0.95);
}

// AI teams attack free agency: every round, every team with room works down
// the board chasing the best player it can afford. Players still negotiate
// under the same rules as the user (role fit, winners' discount, losers'
// premium), so a star can turn a team down — but with 29 front offices
// shopping, the top of the market is usually picked clean after round one.
export function simFreeAgencyDay(league) {
  const rng = makeRng(league.seed + league.season * 31 + league.faDaysLeft);
  league.offerSheets = league.offerSheets || [];
  // Deepest cap room shops first — those are the teams that can land stars
  const order = league.teams
    .filter((t) => t.id !== league.userTeamId)
    .sort((a, b) => payroll(a) - payroll(b));
  for (const team of order) {
    if (team.roster.length >= ROSTER_MAX) continue;
    // Plan room respects each team's strategy-driven payroll target.
    // Contenders are willing to spend into the luxury tax for win-now
    // pieces, so their hard limit is the tax line; everyone else is bound by
    // the salary cap (the minimum/MLE exceptions below cover the rest, and
    // can push a contender just past the tax "occasionally").
    const capRoom = SALARY_CAP - payroll(team);
    const planRoom = payrollTarget(team) - payroll(team);
    const hardLimit = team.strategy === 'contending' ? LUXURY_TAX - payroll(team) : capRoom;
    const room = Math.min(hardLimit, planRoom);
    // capped-out teams with a playable roster sit out rather than hoover
    // up every minimum guy on the market
    if (team.roster.length >= 13 && room < 5_000_000) continue;
    // how far past asking price this front office will stretch this round
    const stretch = 1.1 + rng() * 0.4;
    let tried = 0;
    for (let i = 0; i < league.freeAgents.length && tried < 12; i++) {
      const target = league.freeAgents[i]; // pool is sorted best-first
      if (target.offerSheetPending) continue; // already under an offer sheet this round
      const ask = askingPrice(target);
      let exception = null;
      if (ask > room) {
        if (ask <= MIN_SALARY * 1.05) exception = 'minimum';
        else if (capRoom <= 0 && !team.usedMLE && ask <= MLE_AMOUNT * 1.1) exception = 'mle';
        else continue; // out of their price range
      }
      tried++;
      const years = preferredYears(target);
      let demand = offerDemand(league, team.id, target, years);
      if (demand === null) continue; // wants a bigger role than this roster offers
      if (exception === 'mle') demand = Math.min(demand, MLE_AMOUNT);
      if (!exception && demand > ask * stretch) continue; // demanding more than this office will pay
      if (!exception && demand > room) continue;
      if (exception === 'minimum' && demand > MIN_SALARY * 1.05) continue;
      // A restricted free agent's former team holds the right to match —
      // signing him is an "offer sheet", not an immediate deal.
      if (target.restrictedFA) {
        if (target.formerTeamId === league.userTeamId) {
          const deadlineRound = Math.max(0, league.faDaysLeft - 3);
          league.offerSheets.push({ playerId: target.id, fromTeamId: team.id, formerTeamId: target.formerTeamId, salary: demand, years, deadlineRound });
          target.offerSheetPending = true;
          const roundsLeft = league.faDaysLeft - deadlineRound;
          pushNews(league, {
            day: 0, category: 'signing', major: true, teamIds: [league.userTeamId, team.id],
            text: `URGENT: the ${team.city} ${team.name} sign restricted free agent ${target.name} to an offer sheet (${fmtM(demand)}/yr x ${years}yr). Match it on the Free Agency screen within ${roundsLeft} round${roundsLeft === 1 ? '' : 's'} or lose his rights.`,
          });
          if (exception === 'mle') team.usedMLE = true;
          break;
        }
        const formerTeam = getTeam(league, target.formerTeamId);
        const formerMatches = formerTeam.strategy !== 'rebuilding' && overall(target) >= 75
          && payroll(formerTeam) + demand <= LUXURY_TAX + 15_000_000;
        if (formerMatches) {
          // the original team matches immediately — this bidder leaves empty-handed
          league.freeAgents.splice(i, 1);
          i--;
          target.restrictedFA = false;
          delete target.formerTeamId;
          target.contract = { salary: demand, years };
          delete target.extOfferMade;
          formerTeam.roster.push(target);
          pushNews(league, { day: 0, category: 'signing', teamIds: [formerTeam.id], text: `The ${formerTeam.city} ${formerTeam.name} match an offer sheet to keep ${target.name} (${fmtM(demand)}/yr x ${years}yr).` });
          continue;
        }
        target.restrictedFA = false;
        delete target.formerTeamId;
      }
      signFreeAgent(league, team.id, target.id, demand, years);
      if (exception === 'mle') team.usedMLE = true;
      break;
    }
  }
  // Market clearing: every player still unsigned gets less demanding next
  // round, so the board doesn't stay frozen on day-one asking prices.
  for (const fa of league.freeAgents) fa.faRoundsUnsigned = (fa.faRoundsUnsigned || 0) + 1;

  league.faDaysLeft -= 1;

  // Resolve any offer sheet whose matching window has closed unmatched.
  for (let i = league.offerSheets.length - 1; i >= 0; i--) {
    const sheet = league.offerSheets[i];
    if (league.faDaysLeft > sheet.deadlineRound) continue;
    const target = league.freeAgents.find((p) => p.id === sheet.playerId);
    league.offerSheets.splice(i, 1);
    if (!target) continue; // already resolved (e.g. matched)
    const fromTeam = getTeam(league, sheet.fromTeamId);
    target.restrictedFA = false;
    target.offerSheetPending = false;
    delete target.formerTeamId;
    signFreeAgent(league, sheet.fromTeamId, target.id, sheet.salary, sheet.years);
    pushNews(league, {
      day: 0, category: 'signing', major: true, teamIds: [league.userTeamId, sheet.fromTeamId],
      text: `You missed the deadline to match — ${target.name} signs with the ${fromTeam.city} ${fromTeam.name} (${fmtM(sheet.salary)}/yr x ${sheet.years}yr).`,
    });
  }

  if (league.faDaysLeft <= 0) {
    finalizeFreeAgency(league);
    startNewSeason(league);
  }
}

// Free agency mop-up: by the time the market closes, virtually no player
// worth starting (70+ overall) should still be unsigned. Quality vets who
// got no offers settle for short, cheap deals — minimum salary if a team is
// already over the cap and out of exceptions, market rate otherwise.
function finalizeFreeAgency(league) {
  let guard = 0;
  while (guard++ < 200) {
    const p = league.freeAgents.find((x) => overall(x) >= 70);
    if (!p) break;
    const teams = league.teams
      .filter((t) => t.id !== league.userTeamId && t.roster.length < ROSTER_MAX)
      .sort((a, b) => payroll(a) - payroll(b));
    if (!teams.length) break; // every roster is full; he stays unsigned
    // mop-up deals are settle-for-less: a quality vet who got no real offers
    // takes a short, cheap deal rather than sit out the season
    const team = teams[0];
    const capRoom = SALARY_CAP - payroll(team);
    const ask = askingPrice(p);
    let salary, years;
    if (capRoom <= 0 && !team.usedMLE && ask <= MLE_AMOUNT) {
      salary = Math.min(ask, MLE_AMOUNT); years = preferredYears(p); team.usedMLE = true;
    } else { salary = MIN_SALARY; years = 1; } // minimum exception: short, cheap deal
    signFreeAgent(league, team.id, p.id, salary, years);
  }
}

// A player's asking price falls the longer he sits unsigned in free agency
// (see faRoundsUnsigned, bumped once per FA round in simFreeAgencyDay) —
// roughly 12% per round, so a star who's gone unsigned for a few rounds
// becomes affordable to teams that passed on him at full price.
export function askingPrice(p) {
  const base = salaryFor(overall(p), p.age);
  const discount = Math.pow(0.875, p.faRoundsUnsigned || 0);
  return clamp(Math.round((base * discount) / 100_000) * 100_000, MIN_SALARY, MAX_SALARY);
}

// Deterministic per-team noise in [0,1), independent of the rng sequence so
// it can be sampled repeatedly without perturbing other random draws.
function teamNoise(teamId, salt) {
  let h = 0;
  for (let i = 0; i < teamId.length; i++) h = (Math.imul(h ^ teamId.charCodeAt(i), 2654435761) >>> 0);
  h = Math.imul(h ^ salt, 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

// How much a front office plans to spend this offseason, by strategy:
// rebuilders hoard cap room well under the cap, retoolers sit close to it,
// and contenders plan into the luxury tax (and sometimes past it). This is a
// soft planning target, not a hard limit — see simFreeAgencyDay/MLE_AMOUNT
// for how teams already over the cap can still add players.
export function payrollTarget(team) {
  const n = teamNoise(team.id, 17);
  if (team.strategy === 'rebuilding') return 100_000_000 + n * 25_000_000; // $100-125M
  if (team.strategy === 'contending') return SALARY_CAP + n * (LUXURY_TAX - SALARY_CAP + 15_000_000); // cap..tax+$15M
  return Math.round(SALARY_CAP * (0.92 + n * 0.10)); // retooling: 92-102% of cap
}

// ---------- Mid-season free agency ----------
// During the regular season, teams with an open roster spot can sign
// leftover free agents to rest-of-season minimum deals. Anyone good enough
// to command a real contract holds out for the offseason instead.

export function midSeasonSignable(p) {
  return overall(p) < 68;
}

// Minimum salary prorated over the days left in the season; the deal runs
// 1 year, so it comes off the books in the offseason.
export function proratedMinSalary(league) {
  const total = league.schedule?.length || SEASON_DAYS;
  const remaining = clamp(total - league.dayIndex, 0, total);
  return Math.max(100_000, Math.round(((MIN_SALARY * remaining) / total) / 100_000) * 100_000);
}

export function signMidSeasonFA(league, teamId, playerId) {
  if (league.phase !== 'regular') return { ok: false, error: 'Mid-season signings are only possible during the regular season.' };
  const team = getTeam(league, teamId);
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: 'Roster full (15). Waive someone first.' };
  const idx = league.freeAgents.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'That player is no longer a free agent.' };
  const p = league.freeAgents[idx];
  if (!midSeasonSignable(p)) {
    return { ok: false, error: `${p.name} won't take a minimum deal mid-season — he's holding out for a real contract in the offseason.` };
  }
  p.contract = { salary: proratedMinSalary(league), years: 1 };
  league.freeAgents.splice(idx, 1);
  team.roster.push(p); // on the roster now — available for the next game
  bumpTurmoil(team, 0.5);
  pushNews(league, { day: league.dayIndex, category: 'signing', teamIds: [team.id], text: `The ${team.city} ${team.name} sign ${p.name} to a rest-of-season minimum contract.` });
  return { ok: true, player: p };
}

// AI teams with an open roster spot occasionally add a body mid-season —
// and go shopping in earnest when injuries leave the roster thin.
function maybeAiMidSeasonSigning(league, rng) {
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    if (team.roster.length >= ROSTER_MAX) continue;
    const healthy = team.roster.filter((p) => !p.injury).length;
    if (rng() >= (healthy < 10 ? 0.25 : 0.01)) continue;
    // pool is sorted best-first; nobody signs a guy who's also hurt
    const target = league.freeAgents.find((p) => midSeasonSignable(p) && !p.injury);
    if (target) signMidSeasonFA(league, team.id, target.id);
  }
}

// ---------- Free agency negotiation ----------
// Free agents weigh three things beyond the raw asking price: greed (some
// demand more than market value), team quality (good players discount for
// winners and surcharge losing teams), and role (stars won't join a team
// with two better players at their position). Personality is derived
// deterministically from the player id, so it needs no stored state and
// survives save/load.

function faNoise(playerId, salt) {
  let h = (Math.imul(playerId + 1, 374761393) ^ Math.imul(salt, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function greed(p) {
  return 0.95 + faNoise(p.id, 1) * 0.35; // demands 0.95x–1.30x asking price
}

export function preferredYears(p) {
  const n = faNoise(p.id, 2);
  if (p.age <= 24) return n > 0.4 ? 4 : 3;
  if (p.age <= 29) return 2 + Math.floor(n * 3);
  return n > 0.6 ? 3 : 2;
}

function betterAtPosition(team, p) {
  const o = overall(p);
  return team.roster.filter((x) => x.pos === p.pos && overall(x) > o).length;
}

function roleBlocked(team, p) {
  return overall(p) >= 75 && betterAtPosition(team, p) >= 2;
}

// Core of the demand formula, shared by free-agency offers and in-season
// extensions; only the win percentage the player judges the team by differs.
function demandSalary(team, p, years, winPct) {
  const o = overall(p);
  let mult = greed(p);
  const caresAboutWinning = clamp((o - 60) / 25, 0, 1);
  mult *= clamp(1 + caresAboutWinning * (0.55 - winPct), 0.85, 1.3);
  mult *= moraleSalaryMult(p);
  if (o >= 65 && betterAtPosition(team, p) >= 2) mult *= 1.15;
  const pref = preferredYears(p);
  if (years < pref) mult *= 1 + 0.08 * (pref - years);
  else if (years > pref) mult *= Math.max(0.9, 1 - 0.03 * (years - pref));
  const sal = Math.round((askingPrice(p) * mult) / 100_000) * 100_000;
  return clamp(sal, MIN_SALARY, MAX_SALARY);
}

// Salary at which this player accepts `years` from this team, or null if
// no amount of money will do (role-blocked star).
export function offerDemand(league, teamId, p, years) {
  const team = getTeam(league, teamId);
  if (roleBlocked(team, p)) return null;
  if (p.tradeDemand && p.tradeDemandTeam === teamId) return null; // won't re-sign with the team he demanded out from
  return demandSalary(team, p, years, (team.lastWins ?? 41) / 82);
}

// Mid-season: judge the team by this season's record once it means something
function currentWinPct(team) {
  const gp = team.wins + team.losses;
  return gp >= 10 ? team.wins / gp : (team.lastWins ?? 41) / 82;
}

// ---------- Contract extensions ----------
// Three windows — rookie-scale (RFX), veteran, and final-year — resolved by
// extensionType() (extensions.js). Extended players never reach free
// agency; a rookie-scale window that closes unsigned instead sends the
// player to restricted free agency (advanceOffseason / simFreeAgencyDay).

export function extensionEligible(p) {
  return extensionType(p) !== null;
}

// Salary at which this player extends for `years`, or null if he won't
// extend at any price right now: role-blocked, or a star on a losing team
// who'd rather see wins (or the open market) first. The conditions are
// live — if the record improves, he can be approached again.
export function extensionDemand(league, teamId, p, years) {
  const team = getTeam(league, teamId);
  if (roleBlocked(team, p)) return null;
  if (p.tradeDemand) return null; // a disgruntled player won't commit long-term to this team
  const winPct = currentWinPct(team);
  if (overall(p) >= 78 && winPct < 0.45 && faNoise(p.id, 7) < 0.6) return null;
  return demandSalary(team, p, years, winPct);
}

// User-facing extension offer. The player evaluates it like a free-agency
// offer (money, record, role, preferred length); a rejection sets a floor,
// and he only re-opens talks for a strictly better salary — except a
// standing counter, which is always honored. Salary is clamped to the
// window's rules (rookie max, +/-20% of current for veterans, market rate
// for final-year), and a lowball offer (<85% of demand) insults the player.
export function offerExtension(league, teamId, playerId, salary, years) {
  if (league.phase !== 'regular') return { ok: false, error: 'Extensions can only be negotiated during the regular season.' };
  const team = getTeam(league, teamId);
  const p = team.roster.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'That player is not on your roster.' };
  if (p.extension) return { ok: false, error: `${p.name} has already signed an extension.` };
  const type = extensionType(p);
  if (!type) return { ok: false, error: `${p.name} isn't extension-eligible right now.` };
  years = clamp(Math.round(years), 1, 4);
  const range = extensionSalaryRange(p, type);
  salary = clamp(Math.round(salary / 100_000) * 100_000, range.min, range.max);
  p.extOfferMade = true;
  league.extensionTalks = league.extensionTalks || {};
  const talks = league.extensionTalks[playerId];
  const meetsCounter = talks?.counter && years === talks.counter.years && salary >= talks.counter.salary;
  if (!meetsCounter && talks && salary <= talks.best) {
    return { ok: false, error: `${p.name} already turned down ${fmtM(talks.best)}/yr — he'll only re-open talks for a better number.` };
  }
  let demand = meetsCounter ? salary : extensionDemand(league, teamId, p, years);
  if (demand === null) {
    const reason = roleBlocked(team, p)
      ? `${p.name} wants a featured role, and you already have two better players at ${p.pos} — he won't commit long-term.`
      : `${p.name} won't discuss an extension while the team is losing — win more games, or risk him testing the market.`;
    return { ok: true, decision: 'reject', reason };
  }
  demand = clamp(demand, range.min, range.max);
  if (salary >= demand) {
    p.extension = { salary, years, type };
    delete p.extTalksFailed;
    delete league.extensionTalks[playerId];
    adjustMorale(p, 6);
    pushNews(league, { day: league.dayIndex, category: 'signing', teamIds: [team.id], text: `${p.name} signs a ${years}-year, ${fmtM(salary)}/yr extension with the ${team.city} ${team.name}.` });
    return { ok: true, decision: 'accept', reason: `${p.name} signs: ${fmtM(salary)}/yr x ${years}yr, starting next season.` };
  }
  if (salary < demand * 0.85) {
    adjustMorale(p, -3);
    const entry = { best: Math.max(talks?.best ?? 0, salary) };
    league.extensionTalks[playerId] = entry;
    return { ok: true, decision: 'reject', reason: `${p.name}'s agent calls the offer insulting — that lowball won't be forgotten.` };
  }
  const entry = { best: Math.max(talks?.best ?? 0, salary) };
  let reason;
  const pref = preferredYears(p);
  const counterSalary = clamp(extensionDemand(league, teamId, p, pref) ?? demand, range.min, range.max);
  if (extensionDemand(league, teamId, p, pref) !== null) {
    entry.counter = { salary: counterSalary, years: pref };
    reason = `${p.name} counters: ${fmtM(counterSalary)}/yr x ${pref}yr.`;
  }
  if (!reason) {
    reason = years < pref
      ? `${p.name} is looking for a longer commitment (${pref} years).`
      : `${p.name} is holding out for more money.`;
  }
  league.extensionTalks[playerId] = entry;
  return { ok: true, decision: entry.counter ? 'counter' : 'reject', reason, counter: entry.counter };
}

// Each AI front office reviews its roster once a season, on a team-specific
// day (so extension news trickles in rather than flooding a single day),
// across all three extension windows. Rookie-scale extensions prioritize
// high-potential youth; veteran extensions respect strategy (rebuilders
// don't tie up cap in aging vets); final-year extensions use the existing
// retention odds. When the office passes, the player is flagged to test the
// market (and, for rookie-scale deals reaching their last year, restricted
// free agency).
function aiExtensions(league, rng) {
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    const reviewDay = 40 + ((team.id.charCodeAt(0) * 5 + team.id.charCodeAt(1) * 11 + team.id.charCodeAt(2) * 23) % 60);
    if (league.dayIndex !== reviewDay) continue;
    for (const p of team.roster) {
      const type = extensionType(p);
      if (!type || p.extOfferMade) continue;
      if (p.age >= 36 && type !== 'rookie') continue;
      if (type === 'veteran' && team.strategy === 'rebuilding' && p.age >= 28) continue;
      if (type === 'rookie' && !(p.potential >= 68 || overall(p) >= 65)) continue;
      if (rng() >= resignChance(team, p)) { p.extTalksFailed = true; continue; }
      const years = type === 'rookie' ? 4 : preferredYears(p);
      const range = extensionSalaryRange(p, type);
      let demand = extensionDemand(league, team.id, p, years);
      if (demand === null) continue; // player won't extend now; his window may still resolve later
      demand = clamp(demand, range.min, range.max);
      if (payroll(team) - p.contract.salary + demand > LUXURY_TAX) continue;
      p.extension = { salary: demand, years, type };
      adjustMorale(p, 6);
      if (overall(p) >= 70 || type === 'rookie') {
        pushNews(league, { day: league.dayIndex, category: 'signing', teamIds: [team.id], text: `${p.name} agrees to a ${years}-year, ${fmtM(demand)}/yr extension with the ${team.city} ${team.name}.` });
      }
    }
  }
}

const fmtM = (n) => `$${(n / 1e6).toFixed(1)}M`;

export function evaluateOffer(league, teamId, p, salary, years) {
  const team = getTeam(league, teamId);
  if (roleBlocked(team, p)) {
    return { decision: 'reject', reason: `${p.name} wants a featured role, and the ${team.name} already have two better players at ${p.pos}.` };
  }
  const demand = offerDemand(league, teamId, p, years);
  if (salary >= demand) return { decision: 'accept' };
  if (salary >= demand * 0.8) {
    const pref = preferredYears(p);
    const counterSalary = offerDemand(league, teamId, p, pref);
    return {
      decision: 'counter',
      reason: `${p.name} counters: ${fmtM(counterSalary)} x ${pref}yr.`,
      counter: { salary: counterSalary, years: pref },
    };
  }
  const lastWins = team.lastWins ?? 41;
  let reason;
  if (salary < askingPrice(p) * 0.7) reason = `${p.name}'s agent calls the offer insulting and hangs up.`;
  else if (lastWins < 35 && overall(p) >= 70) reason = `${p.name} wants to play for a winner — joining a ${lastWins}-win team will cost you a premium.`;
  else if (overall(p) >= 65 && betterAtPosition(team, p) >= 2) reason = `${p.name} sees too many good ${p.pos}s on your roster and wants to be paid for the smaller role.`;
  else if (years < preferredYears(p)) reason = `${p.name} is looking for a longer deal (${preferredYears(p)} years).`;
  else reason = `${p.name} is holding out for more money.`;
  return { decision: 'reject', reason };
}

// Which cap mechanism would cover a contract of this salary for this team,
// or null if none does. 'cap-room' covers it outright; 'mle' is the
// once-per-offseason mid-level exception (over-cap teams only, up to
// MLE_AMOUNT, ~$12M); 'minimum' is the always-available roster-fill exception.
export function signingException(league, teamId, salary) {
  const team = getTeam(league, teamId);
  let capLimit = SALARY_CAP;
  if (team.owner) {
    let budgetCap = team.owner.budget;
    if (team.owner.approval < 25) budgetCap = Math.min(budgetCap, payroll(team)); // payroll freeze
    capLimit = Math.min(capLimit, budgetCap);
  }
  const capRoom = capLimit - payroll(team);
  if (salary <= capRoom) return 'cap-room';
  if (salary <= MIN_SALARY * 1.05) return 'minimum';
  if (capRoom <= 0 && !team.usedMLE && salary <= MLE_AMOUNT) return 'mle';
  return null;
}

// User-facing offer. Validates cap/roster, enforces per-round patience
// (three failed offers and the agent stops talking until the next round),
// and signs the player on acceptance. Counter-offers persist on
// league.negotiations so they survive reloads — but the player stays on
// the open market and can sign elsewhere between rounds.
export function makeOffer(league, teamId, playerId, salary, years) {
  if (league.phase !== 'freeagency') return { ok: false, error: 'Free agency is not open.' };
  const team = getTeam(league, teamId);
  const p = league.freeAgents.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'That player is no longer a free agent.' };
  if (p.restrictedFA && p.formerTeamId !== teamId) {
    const formerTeam = getTeam(league, p.formerTeamId);
    return { ok: false, error: `${p.name} is a restricted free agent — his rights remain with the ${formerTeam.city} ${formerTeam.name} unless they decline to match an offer sheet.` };
  }
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: 'Roster full (15). Waive someone first.' };
  const exception = signingException(league, teamId, salary);
  if (!exception) {
    const room = SALARY_CAP - payroll(team);
    const mleNote = team.usedMLE
      ? "you've already used this offseason's mid-level exception"
      : `the mid-level exception only covers up to ${fmtM(MLE_AMOUNT)}`;
    return { ok: false, error: `Not enough cap room (${fmtM(Math.max(room, 0))} available), and ${mleNote}. Minimum contracts can always be offered.` };
  }
  league.negotiations = league.negotiations || {};
  const nego = league.negotiations[playerId] || { offers: 0, round: league.faDaysLeft, counter: null };
  if (nego.round !== league.faDaysLeft) { nego.offers = 0; nego.round = league.faDaysLeft; }
  // accepting a standing counter is always honored, even out of patience
  const meetsCounter = nego.counter && years === nego.counter.years && salary >= nego.counter.salary;
  if (!meetsCounter && nego.offers >= 3) {
    league.negotiations[playerId] = nego;
    return { ok: false, error: `${p.name}'s agent has stopped returning your calls until the next round.` };
  }
  nego.offers += 1;
  const res = meetsCounter ? { decision: 'accept' } : evaluateOffer(league, teamId, p, salary, years);
  if (res.decision === 'accept') {
    delete league.negotiations[playerId];
    signFreeAgent(league, teamId, playerId, salary, years);
    if (exception === 'mle') team.usedMLE = true;
    return { ok: true, decision: 'accept', exception, reason: `${p.name} accepts: ${fmtM(salary)} x ${years}yr!` };
  }
  if (res.decision === 'counter') nego.counter = res.counter;
  league.negotiations[playerId] = nego;
  return { ok: true, ...res };
}

export function signFreeAgent(league, teamId, playerId, salary, years) {
  const team = getTeam(league, teamId);
  const idx = league.freeAgents.findIndex((p) => p.id === playerId);
  if (idx === -1 || team.roster.length >= ROSTER_MAX) return false;
  const p = league.freeAgents[idx];
  p.contract = {
    salary: salary ?? askingPrice(p),
    years: years ?? clamp(Math.round(gauss(2.5, 1)), 1, 4),
  };
  delete p.extOfferMade;
  p.restrictedFA = false;
  p.offerSheetPending = false;
  delete p.formerTeamId;
  league.freeAgents.splice(idx, 1);
  team.roster.push(p);
  if (league.negotiations?.[playerId] && teamId !== league.userTeamId) {
    pushNews(league, { day: 0, category: 'signing', teamIds: [team.id, league.userTeamId], text: `${p.name} broke off negotiations with you to sign elsewhere.` });
  }
  if (league.negotiations) delete league.negotiations[playerId];
  // a star changing teams in free agency is a headline
  pushNews(league, { day: 0, category: 'signing', major: overall(p) >= 80, teamIds: [team.id], text: `${p.name} signs with the ${team.city} ${team.name} (${fmtM(p.contract.salary)} x ${p.contract.years}yr).` });
  return true;
}

// User matches an offer sheet on his own restricted free agent, keeping him
// at the offer's salary/years instead of losing him to the bidding team.
export function matchOfferSheet(league, playerId) {
  const idx = (league.offerSheets || []).findIndex((s) => s.playerId === playerId && s.formerTeamId === league.userTeamId);
  if (idx === -1) return { ok: false, error: 'No offer sheet to match for that player.' };
  const sheet = league.offerSheets[idx];
  const team = getTeam(league, league.userTeamId);
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: 'Roster full (15). Waive someone first.' };
  const p = league.freeAgents.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'That player is no longer available.' };
  p.contract = { salary: sheet.salary, years: sheet.years };
  delete p.extOfferMade;
  p.restrictedFA = false;
  p.offerSheetPending = false;
  delete p.formerTeamId;
  league.freeAgents = league.freeAgents.filter((x) => x.id !== playerId);
  team.roster.push(p);
  league.offerSheets.splice(idx, 1);
  pushNews(league, { day: 0, category: 'signing', major: true, teamIds: [team.id], text: `The ${team.city} ${team.name} match the offer sheet and retain ${p.name} (${fmtM(sheet.salary)}/yr x ${sheet.years}yr).` });
  return { ok: true };
}

// Snapshots a player's cumulative season stats against the team he's about
// to leave, so advanceOffseason can split this season's careerStats row into
// one entry per team. No-op if he hasn't played for this team yet.
export function recordSeasonStint(p, teamId) {
  if (!p.stats.gp) return;
  if (!p.seasonStints) p.seasonStints = [];
  p.seasonStints.push({ team: teamId, stats: { ...p.stats } });
}

export function releasePlayer(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  const idx = team.roster.findIndex((p) => p.id === playerId);
  if (idx === -1) return false;
  const p = team.roster.splice(idx, 1)[0];
  recordSeasonStint(p, teamId);
  bumpTurmoil(team);
  if (p.contract) {
    if (!team.deadMoney) team.deadMoney = []; // saves predating this field
    team.deadMoney.push({ playerName: p.name, salary: p.contract.salary, years: p.contract.years });
  }
  p.contract = null;
  league.freeAgents.push(p);
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  pushNews(league, { day: 0, category: 'signing', teamIds: [team.id], text: `The ${team.name} waive ${p.name}.` });
  return true;
}

export function startNewSeason(league) {
  const rng = makeRng(league.seed + league.season * 7);
  // AI teams fill out rosters to minimum 13
  for (const team of league.teams) {
    while (team.roster.length < 13 && league.freeAgents.length) {
      const cheap = league.freeAgents[league.freeAgents.length - 1];
      if (team.id === league.userTeamId) break; // user manages their own roster
      signFreeAgent(league, team.id, cheap.id);
    }
  }
  league.negotiations = {};
  league.extensionTalks = {};
  league.schedule = makeSchedule(league.teams, rng);
  league.dayIndex = 0;
  league.resultsByDay = [];
  league.phase = 'regular';
  league.playoffs = null;
  pushNews(league, { day: 0, category: 'league', text: `The ${league.season} season begins!` });
}
