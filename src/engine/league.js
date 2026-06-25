import { TEAMS, SALARY_CAP, LUXURY_TAX, MIN_SALARY, MAX_SALARY, MLE_AMOUNT, ROSTER_MAX, TWO_WAY_MAX, TWO_WAY_SALARY, TWO_WAY_MAX_EXP } from '../data/teams.js';
import { makeRng, randInt, clamp, gauss } from './rng.js';
import { generatePlayer, resetPlayerIds, getNextPlayerId, emptyStats, developPlayer, overall, salaryFor, assignOrigin, shouldRetire, generateStamina, supportedMinutes, generateDurability, snapshotRatings, ratingRow, recordContract, recordTransaction, FRINGE_OVR_MEAN, FRINGE_OVR_SPREAD, FRINGE_OVR_FLOOR, FRINGE_OVR_CEIL } from './players.js';
import { ZONE_STAT_COLS } from './shotZones.js';
import { rollGameInjuries, tickInjuries, injuryTimeline } from './injuries.js';
import { simGame, applyBoxToStats, encodeBox, decodeBox, starLines, simGLeagueGame } from './sim.js';
import { initDraft } from './draft.js';
import { initFantasyDraft } from './fantasyDraft.js';
import { ensureDraftPicks } from './draftPicks.js';
import { computeAwards, honorsSummary } from './awards.js';
import { evaluateStrategies, maybeAiTrade, maybeAiSalaryDump, maybeAiBuyoutRelease } from './strategy.js';
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
import { generateOwner, dailyApprovalUpdate, maybeOwnerInterference, processOwnerSeason, playoffRoundReached, issueDirectives, exceedsOwnerBudget, applyBudgetOverageEffect } from './owner.js';
import { maybeCoachConversation } from './coachTalk.js';
import { checkMilestoneAlerts } from './milestoneAlerts.js';
import { updateGLeagueHotStreak, maybeQueueCallUpPrompt } from './callUps.js';
import {
  snapshotRetiree, computeRecordBook, describeBrokenRecord, checkRecordPace, checkGameHighs,
  evaluateHallOfFame, detectDynasties, updateGmLegacy, updateCrossSaveLegacy,
} from './legacy.js';
import { askingPriceMult, extensionDemandMult, maybeRevealBackstory } from './backstory.js';
import { initScoutingPhase, initSeasonScouting, initDraftBoard, tickProScouting } from './scoutingTrips.js';
import { computeQualitySeasons, TRAIT_NEWS_REVEAL_TIERS, traitFromPotential } from './devTraits.js';
import { generateCoach, devBonus, coachSalary } from './coach.js';

export function createLeague(userTeamId, seed = Date.now(), opts = {}) {
  const rng = makeRng(seed);
  // Coaches draw from their own sequence so adding/changing the coaching
  // system doesn't reshuffle the roster/schedule rng draws for a given seed.
  const coachRng = makeRng(seed + 818_181);
  resetPlayerIds(1);
  const fantasy = !!opts.fantasyDraft;

  const teams = TEAMS.map((t) => ({
    ...t,
    roster: fantasy ? [] : makeRoster(rng),
    twoWay: [], // up to TWO_WAY_MAX players on cap-exempt two-way deals — see signToTwoWay
    deadMoney: [], // { playerName, salary, years } — cap hits from waived contracts
    wins: 0,
    losses: 0,
    tradesThisSeason: 0,
    streak: { result: null, count: 0 },
    coach: generateCoach(coachRng),
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
    phase: fantasy ? 'fantasydraft' : 'regular',
    // regular | awards | playoffs | fantasydraft | offseason/finals-mvp | offseason/development
    // | offseason/coaching | offseason/lottery | offseason/draft | offseason/freeagency | offseason/preview
    playoffs: null,
    freeAgents: fantasy ? [] : Array.from({ length: 60 }, () => {
      // unsigned for a reason: the open market skews toward fringe talent
      const p = generatePlayer(rng, { base: clamp(gauss(FRINGE_OVR_MEAN, FRINGE_OVR_SPREAD, rng), FRINGE_OVR_FLOOR, FRINGE_OVR_CEIL) });
      p.contract = null;
      return p;
    }),
    news: [{ day: 0, season: 2026, phase: 'regular', category: 'league', teamIds: [userTeamId], text: `Welcome, GM! You're now running the ${TEAMS.find(t => t.id === userTeamId).city} ${TEAMS.find(t => t.id === userTeamId).name}.` }],
    newsArchive: {}, // { [season]: [major news items, chronological] }
    tradeHistory: [], // executed trades, chronological — see executeTrade/executeMultiTrade
    tradeOffers: [], // incoming AI trade offers awaiting a response
    tradeOfferCooldowns: {}, // { [teamId]: dayIndex } — see tradeOffers.js
    negotiations: {}, // { [playerId]: { ... } } — in-progress FA offers
    offerSheets: [], // RFA offer sheets awaiting the original team's match
    extensionTalks: {}, // { [playerId]: { ... } } — in-progress extension offers
    history: [],
    saveId: `${seed}_${Date.now()}`,
    retiredPlayers: [], // trimmed snapshots — see engine/legacy.js
    recordBook: { singleSeason: {}, career: {}, gameHighs: {} },
    hallOfFame: [],
    dynasties: [],
    teamSeasonRecords: [], // { season, teamId, wins, losses } — one row/team/season
    recordPaceFlags: {}, // { [season]: { [playerId]: { [category]: true } } }
    recordBreakingMoment: null,
    gmLegacy: {
      totalWins: 0, totalLosses: 0, championships: 0, confFinalsAppearances: 0,
      bestSeasonRecord: null, bestTrade: null, bestDraftPick: null, bestFASigning: null,
      draftWatchlist: [], faWatchlist: [],
    },
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
  initSeasonScouting(league, rng);
  initDraftBoard(league, rng); // pre-generate 2 future draft classes for multi-year scouting
  league.nextPlayerId = getNextPlayerId();
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
    [57, 6], [57, 6], [57, 6], [53, 6], [53, 6], [53, 6], [53, 6],
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
      base: clamp(gauss(mean + ageAdj, spread, rng), 42, 90),
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
  const target = payrollCalibrationTarget(rng);
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

// How far past the luxury tax line a contender will push to keep its core
// together (re-signings, offer-sheet matches). Distinct from capProjection's
// APRON, which is a display threshold for the future-payroll screen, not a
// spending decision.
export const CONTENDER_CEILING = LUXURY_TAX + 15_000_000;

// A roster-payroll target near the cap, used to calibrate a fresh team's
// books (opening day, fantasy draft): most franchises land within $10M of
// the cap and some slightly over. Shared so both calibration sites use the
// same band.
export function payrollCalibrationTarget(rng) {
  return SALARY_CAP - 7_000_000 + rng() * 14_000_000; // $134M-$148M
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

// Trades lock once the deadline passes and remain locked through the
// playoffs, reopening only when the next offseason begins.
export function tradesLocked(league) {
  if (league.phase === 'playoffs' || league.phase === 'awards') return true;
  if (league.phase === 'regular' && league.dayIndex > TRADE_DEADLINE_DAY) return true;
  return false;
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

// Synthetic "teams" for the All-Star Game box score — not real franchises,
// so they're not in league.teams, but getTeam needs to resolve them for
// shared box-score components (TeamBadge/TeamLink/LineScore).
const ALLSTAR_TEAMS = {
  EAST: { id: 'EAST', city: 'Team', name: 'East', color: '#1d428a', conf: 'East' },
  WEST: { id: 'WEST', city: 'Team', name: 'West', color: '#c8102e', conf: 'West' },
};

export function getTeam(league, id) {
  return league.teams.find((t) => t.id === id) || ALLSTAR_TEAMS[id];
}

// The migration path for the JSON-serialized save (see save.js): every field
// added to the league/team/player shape after initial release gets a
// default here, keyed off `== null`/`!field` so old saves are patched to the
// current shape on load. New fields should be added here FIRST — read sites
// elsewhere can then assume the field always exists, instead of repeating
// `?? ` / `|| []` / `|| {}` defaults at every call site.
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
    // stats fields added with the shot-chart zone breakdown
    for (const bucket of [p.stats, p.playoffStats, p.gLeagueStats]) {
      if (!bucket) continue;
      for (const col of ZONE_STAT_COLS) if (bucket[col] == null) bucket[col] = 0;
    }
    // saves predating the 14-attribute ratings split — derive the new
    // fields from the old 7-rating shape (inside/mid/three/passing/
    // rebounding/defense/athleticism) rather than a fresh roll, so an
    // existing player's profile carries over instead of resetting.
    if (p.ratings && p.ratings.closeShot == null) {
      const r = p.ratings;
      const oldMid = r.mid ?? 60, oldThree = r.three ?? 60, oldPassing = r.passing ?? 60;
      const oldDefense = r.defense ?? 60, oldRebounding = r.rebounding ?? 60, oldAthleticism = r.athleticism ?? 60;
      r.closeShot = r.inside ?? 60;
      r.midRange = oldMid;
      r.threePoint = oldThree;
      r.freeThrow = Math.round(clamp(oldMid * 0.5 + oldThree * 0.3 + oldPassing * 0.2, 25, 99));
      r.ballHandling = oldPassing;
      r.perimeterDefense = oldDefense;
      r.interiorDefense = oldDefense;
      r.steal = oldDefense;
      r.block = oldDefense;
      r.offensiveRebounding = oldRebounding;
      r.defensiveRebounding = oldRebounding;
      r.speed = oldAthleticism;
      r.strength = oldAthleticism;
      delete r.inside; delete r.mid; delete r.three; delete r.rebounding; delete r.defense; delete r.athleticism;
    }
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
    if (p.trainingFocus === undefined) p.trainingFocus = null;
    // saves predating player season-stint tracking (mid-season trades)
    if (!p.seasonStints) p.seasonStints = [];
    // saves predating playoff stat tracking
    if (!p.playoffStats) p.playoffStats = emptyStats();
    if (!p.playoffCareerStats) p.playoffCareerStats = [];
    // saves predating G-League assignment tracking for two-way players
    if (!p.gLeagueStats) p.gLeagueStats = emptyStats();
    if (!p.gLeagueCareerStats) p.gLeagueCareerStats = [];
    // saves predating the legacy/records system
    if (p.championships == null) p.championships = 0;
    // saves predating dev-trait fog collapse counter
    if (p.qualitySeasons == null) p.qualitySeasons = computeQualitySeasons(p);
    // saves predating the "was on user team" no-fog flag
    if (!p.everOnUserTeam && league.userTeamId) {
      if (p.careerStats?.some((s) => s.team === league.userTeamId)) p.everOnUserTeam = true;
    }
  };
  for (const team of league.teams) team.roster.forEach(fill);
  for (const team of league.teams) (team.twoWay || []).forEach(fill);
  if (!league.settings) league.settings = {};
  if (league.settings.suppressInjuryAlerts == null) league.settings.suppressInjuryAlerts = false;
  for (const team of league.teams) if (team.turmoil == null) team.turmoil = 0;
  for (const team of league.teams) {
    if (!team.streak) team.streak = { result: null, count: 0 };
    if (team.tradesThisSeason == null) team.tradesThisSeason = 0;
    if (team.market == null) team.market = TEAMS.find((t) => t.id === team.id)?.market || 'medium';
    // saves predating dead-money tracking from waived contracts
    if (!team.deadMoney) team.deadMoney = [];
    // saves predating two-way contracts
    if (!team.twoWay) team.twoWay = [];
    // saves predating the coaching staff system
    if (!team.coach) team.coach = generateCoach(rng);
    if (!team.coach.style) team.coach.style = 'balanced';
    if (!team.coach.salary) team.coach.salary = coachSalary(team.coach.rating);
  }
  if (!league.coachCandidates) league.coachCandidates = [generateCoach(rng), generateCoach(rng)];
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
  // Saves predating this patch have other prospect pools carrying the old
  // rating shape too — easy to miss since they're not under league.draft or
  // league.freeAgents: the current season's pre-draft scouting pool
  // (league.scouting.prospects, populated well before league.draft exists)
  // and the 2 future draft-board classes generated at league creation.
  league.scouting?.prospects?.forEach(fill);
  league.scouting?.draftBoard?.forEach((dc) => dc.prospects?.forEach(fill));
  // Saves predating this patch captured mid-fantasy-draft have an undrafted
  // pool that's neither a roster nor a free agent yet.
  league.fantasyDraft?.pool?.forEach(fill);
  // Saves predating draft-pick trading
  ensureDraftPicks(league);
  // Saves predating front-office strategies
  if (league.teams.some((t) => !t.strategy)) evaluateStrategies(league);
  // Saves predating lineups (skip during mid-fantasy-draft when roster is still empty)
  const user = getTeam(league, league.userTeamId);
  if (!user.lineup && user.roster.length) user.lineup = autoLineup(user.roster);
  // Saves predating the news cap
  if (league.news.length > NEWS_MAX) league.news.length = NEWS_MAX;
  // Saves predating the trade history log
  if (!league.tradeHistory) league.tradeHistory = [];
  // Saves predating incoming trade offers
  if (!league.tradeOffers) league.tradeOffers = [];
  // Saves predating year-round scouting budgets
  if (!league.scouting) initSeasonScouting(league, rng);
  // Saves predating multi-year draft board and pro scouting track
  if (!league.scouting.draftBoard) {
    const bfRng = makeRng(league.seed + league.season * 70_007 + 888_001);
    initDraftBoard(league, bfRng);
    league.nextPlayerId = getNextPlayerId();
  }
  if (!league.scouting.proWatching)  league.scouting.proWatching  = {};
  if (!league.scouting.proWatchList) league.scouting.proWatchList = [];
  if (!league.scouting.proReports)   league.scouting.proReports   = [];
  // If reloaded mid-allstar weekend with the event already built and the
  // day past, mark it shown so the sim loop doesn't get stuck on redirect.
  if (league.allStar && !league.allStar.shown && league.phase === 'regular'
      && league.dayIndex > ALL_STAR_DAYS[ALL_STAR_DAYS.length - 1]) {
    league.allStar.shown = true;
  }
  if (!league.tradeOfferCooldowns) league.tradeOfferCooldowns = {};
  // Saves predating free-agency negotiations / RFA offer sheets / extensions
  if (!league.negotiations) league.negotiations = {};
  if (!league.offerSheets) league.offerSheets = [];
  if (!league.extensionTalks) league.extensionTalks = {};
  // Saves predating news categories/archiving
  if (!league.newsArchive) league.newsArchive = {};
  for (const n of league.news) {
    if (!n.category) n.category = 'league';
    if (n.season == null) n.season = league.season;
  }
  // Saves predating the legacy/records system
  if (!league.saveId) league.saveId = `${league.seed}_${Date.now()}`;
  if (!league.retiredPlayers) league.retiredPlayers = [];
  if (!league.recordBook) league.recordBook = { singleSeason: {}, career: {} };
  if (!league.recordBook.gameHighs) league.recordBook.gameHighs = {};
  if (!league.hallOfFame) league.hallOfFame = [];
  if (!league.dynasties) league.dynasties = [];
  if (!league.teamSeasonRecords) league.teamSeasonRecords = [];
  if (!league.recordPaceFlags) league.recordPaceFlags = {};
  if (league.recordBreakingMoment === undefined) league.recordBreakingMoment = null;
  if (!league.gmLegacy) {
    league.gmLegacy = {
      totalWins: 0, totalLosses: 0, championships: 0, confFinalsAppearances: 0,
      bestSeasonRecord: null, bestTrade: null, bestDraftPick: null, bestFASigning: null,
      draftWatchlist: [], faWatchlist: [],
    };
  }
  if (!league.gmLegacy.finalsMVPs) league.gmLegacy.finalsMVPs = [];
  // Saves predating the offseason phase sequence: map the old flat phases
  // onto their equivalent sub-phase. 'offseason' had no Finals MVP/dev
  // report data computed yet, so it lands on the finals-mvp screen, which
  // tolerates a missing league.finalsMVP.
  if (league.phase === 'offseason') league.phase = 'offseason/finals-mvp';
  else if (league.phase === 'draft') league.phase = 'offseason/draft';
  else if (league.phase === 'freeagency') league.phase = 'offseason/freeagency';
  if (league.finalsMVP === undefined) league.finalsMVP = null;
  if (!league.offseasonRosterSnapshot) league.offseasonRosterSnapshot = [];
  // Restore the player-id counter so any players generated after load get IDs
  // that can never collide with existing or retired players in this save.
  if (league.nextPlayerId == null) {
    const allIds = [
      ...league.teams.flatMap((t) => t.roster.map((p) => p.id)),
      ...league.teams.flatMap((t) => (t.twoWay || []).map((p) => p.id)),
      ...league.freeAgents.map((p) => p.id),
      ...(league.retiredPlayers || []).map((p) => p.id),
      ...(league.scouting?.prospects || []).map((p) => p.id),
      ...(league.draft?.prospects || []).map((p) => p.id),
      ...(league.scouting?.draftBoard || []).flatMap((dc) => dc.prospects.map((p) => p.id)),
    ];
    league.nextPlayerId = (allIds.length ? Math.max(...allIds) : 0) + 1;
  }
  // One-time repair for saves created before league.nextPlayerId existed as a
  // persisted, never-resetting counter: two active players (on the same or
  // different teams) can end up sharing an id, which makes id-keyed lookups
  // (box score names, dashboard links, player cards) resolve to whichever one
  // a given lookup happens to hit, while their actual stat lines stay correct
  // since those are tied to the in-memory roster object, not the id. Give the
  // less-established player in each colliding group a fresh id so every
  // lookup is unambiguous going forward.
  league.nextPlayerId = repairDuplicateLivePlayerIds(league, league.nextPlayerId);
  resetPlayerIds(league.nextPlayerId);
}

function repairDuplicateLivePlayerIds(league, nextId) {
  const groups = new Map();
  const add = (p) => {
    if (!groups.has(p.id)) groups.set(p.id, []);
    groups.get(p.id).push(p);
  };
  for (const t of league.teams) for (const p of t.roster) add(p);
  for (const t of league.teams) for (const p of (t.twoWay || [])) add(p);
  for (const p of league.freeAgents) add(p);
  for (const players of groups.values()) {
    if (players.length < 2) continue;
    // Keep the id on whoever has the longest track record (most likely to be
    // referenced by past awards/record-book/legacy entries); reassign the rest.
    players.sort((a, b) => (b.careerStats?.length || 0) - (a.careerStats?.length || 0));
    for (const p of players.slice(1)) p.id = nextId++;
  }
  return nextId;
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
  return team.roster.reduce((s, p) => s + (p.contract?.twoWay ? 0 : (p.contract?.salary || 0)), 0) + deadMoneyTotal(team);
}

export function deadMoneyTotal(team) {
  return team.deadMoney.reduce((s, d) => s + d.salary, 0);
}

// Projects next season's payroll from the current roster: contracts with
// more than one year left carry forward at the same salary, contracts
// expiring this season drop off (unless an extension has already been
// signed, which takes their place), and dead money follows the same
// one-year decrement. Used to keep AI extension offers and free-agent
// signings from double-spending cap space that's about to evaporate.
export function projectedPayroll(team) {
  const roster = team.roster.reduce((s, p) => {
    if (!p.contract || p.contract.twoWay) return s;
    if (p.contract.years > 1) return s + p.contract.salary;
    return s + (p.extension ? p.extension.salary : 0);
  }, 0);
  const dead = team.deadMoney.reduce((s, d) => s + (d.years > 1 ? d.salary : 0), 0);
  return roster + dead;
}

// How far into projected future payroll a front office is willing to
// commit, by strategy: contenders can run it up to the tax line,
// mid-tier (retooling) teams stay near the cap, and rebuilders keep
// real room well under the cap for the next wave of free agency.
export function projectedPayrollLimit(team) {
  if (team.strategy === 'contending') return LUXURY_TAX;
  if (team.strategy === 'rebuilding') return SALARY_CAP * 0.85;
  return SALARY_CAP;
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

// ---------- Per-game news ----------

// Win/loss streaks: every 5th game of a streak (5, 10, 15, …) gets a
// callout, highlighted once it reaches double digits.
function updateStreak(league, team, won) {
  const kind = won ? 'W' : 'L';
  if (team.streak?.result === kind) team.streak.count += 1;
  else team.streak = { result: kind, count: 1 };
  if (team.streak.count >= 5 && team.streak.count % 5 === 0) {
    pushNews(league, {
      day: league.dayIndex, category: 'league', major: team.id === league.userTeamId,
      teamIds: [team.id],
      text: kind === 'W'
        ? `🔥 The ${team.city} ${team.name} have won ${team.streak.count} straight.`
        : `❄️ The ${team.city} ${team.name} have lost ${team.streak.count} in a row.`,
    });
  }
}

// One-line narrative for the user's game: a notable run or clutch moment
// pulled from the game log, or failing that, the top performer's line.
function gameNarrative(r, home, away) {
  const run = (r.events || []).find((e) => /ripped off a|closed the game on a/.test(e.text));
  if (run) return run.text;
  const clutch = (r.events || []).find((e) => /ties it|puts the .+ up/.test(e.text));
  if (clutch) return clutch.text;
  const top = starLines([...r.homeBox, ...r.awayBox], 1)[0];
  if (top) {
    const p = home.roster.find((x) => x.id === top.playerId) || away.roster.find((x) => x.id === top.playerId);
    if (p) return `${p.name} led the way with ${top.pts} pts, ${top.reb} reb, ${top.ast} ast.`;
  }
  return null;
}

// Pushes news for one finished game: a compact line score for everyone, a
// highlighted recap with a one-line narrative for the user's own game,
// milestone call-outs (40+ points, triple-doubles, 20+ rebounds), and
// injury reports.
function pushGameNews(league, r, home, away, hurt) {
  pushNews(league, {
    day: league.dayIndex, category: 'game',
    teamIds: [home.id, away.id],
    text: `${away.id} ${r.awayPts} @ ${home.id} ${r.homePts}`,
  });

  if (home.id === league.userTeamId || away.id === league.userTeamId) {
    const winner = r.homePts > r.awayPts ? home : away;
    const loser = r.homePts > r.awayPts ? away : home;
    const winPts = Math.max(r.homePts, r.awayPts);
    const losePts = Math.min(r.homePts, r.awayPts);
    let text = `${winner.city} ${winner.name} beat ${loser.city} ${loser.name} ${winPts}-${losePts}.`;
    const narrative = gameNarrative(r, home, away);
    if (narrative) text += ` ${narrative}`;
    pushNews(league, { day: league.dayIndex, category: 'game', major: true, teamIds: [home.id, away.id], text });
  }

  for (const [team, box] of [[home, r.homeBox], [away, r.awayBox]]) {
    for (const l of box) {
      if (l.min === 0) continue;
      const p = team.roster.find((x) => x.id === l.playerId);
      if (!p) continue;
      const major = team.id === league.userTeamId;
      if (l.pts >= 40) {
        pushNews(league, { day: league.dayIndex, category: 'milestone', major, teamIds: [team.id], text: `🌟 ${p.name} (${team.id}) erupted for ${l.pts} points.` });
      }
      if (l.pts >= 10 && l.reb >= 10 && l.ast >= 10) {
        pushNews(league, { day: league.dayIndex, category: 'milestone', major, teamIds: [team.id], text: `🌟 ${p.name} (${team.id}) recorded a triple-double: ${l.pts} pts, ${l.reb} reb, ${l.ast} ast.` });
      }
      if (l.reb >= 20) {
        pushNews(league, { day: league.dayIndex, category: 'milestone', major, teamIds: [team.id], text: `🌟 ${p.name} (${team.id}) hauled in ${l.reb} rebounds.` });
      }
    }
  }

  for (const p of hurt) {
    const team = home.roster.includes(p) ? home : away;
    pushNews(league, {
      day: league.dayIndex, category: 'injury', major: team.id === league.userTeamId,
      teamIds: [team.id],
      text: `🩹 ${p.name} (${team.id}) left the game with a ${p.injury.type} — ${injuryTimeline(p.injury)}.`,
    });
  }
}

// Summarizes the user's games over [startDay, league.dayIndex) into one
// news item: record and the week's standout performer. Called after a
// multi-day "Sim Week".
export function weeklyRecapNews(league, startDay) {
  const userTeamId = league.userTeamId;
  if (!userTeamId) return;
  const user = getTeam(league, userTeamId);
  const games = [];
  for (let di = startDay; di < league.dayIndex; di++) {
    const day = league.resultsByDay[di];
    const r = day?.find((x) => x.home === userTeamId || x.away === userTeamId);
    if (r) games.push(r);
  }
  if (games.length === 0) return;
  let wins = 0, losses = 0, best = null;
  for (const r of games) {
    const isHome = r.home === userTeamId;
    const won = isHome ? r.homePts > r.awayPts : r.awayPts > r.homePts;
    if (won) wins++; else losses++;
    const box = isHome ? r.homeBox : r.awayBox;
    if (!box) continue;
    for (const l of decodeBox(box).filter((x) => x.min > 0)) {
      const score = l.pts + 0.7 * (l.reb + l.ast) + l.stl + l.blk - 0.7 * l.tov;
      if (!best || score > best.score) best = { line: l, score };
    }
  }
  let text = `📅 Weekly recap: the ${user.city} ${user.name} went ${wins}-${losses}`;
  const p = best && user.roster.find((x) => x.id === best.line.playerId);
  if (p) text += `, led by ${p.name} (${best.line.pts} pts, ${best.line.reb} reb, ${best.line.ast} ast).`;
  else text += '.';
  pushNews(league, { day: league.dayIndex, category: 'league', major: true, teamIds: [userTeamId], text });
}

// Full per-play text is by far the biggest thing in an active save (every
// play of every user-team game, regular season or playoffs) — and it's only
// ever read for the game just played (see BoxScore.jsx's play-by-play tab).
// Past a couple of games back nobody re-opens old play-by-play, so once a
// game ages past KEEP_PBP_GAMES-many newer user games, drop `playByPlay`/
// `events` and keep the box score (still wanted by Schedule/Calendar's
// "view this past game" links).
const KEEP_PBP_GAMES = 2;

function trimPlayByPlay(containers, keep = KEEP_PBP_GAMES) {
  for (let i = 0; i < containers.length - keep; i++) {
    delete containers[i].playByPlay;
    delete containers[i].events;
  }
}

function collectRegularPbpGames(league) {
  const out = [];
  for (const day of league.resultsByDay || []) {
    for (const r of day) if (r.playByPlay) out.push(r);
  }
  return out;
}

// Same idea for the playoffs: gathers every game still carrying play-by-play
// (i.e. the user's games — see simPlayoffGame) across completed series and
// the in-progress round, ordered round-then-game-index so trimPlayByPlay
// drops the oldest ones first.
function collectPlayoffPbpGames(po) {
  const out = [];
  const addSeries = (round, m) => {
    if (!m?.games) return;
    m.games.forEach((g, idx) => { if (g.playByPlay) out.push({ round, idx, g }); });
  };
  for (const { round, series } of po.completed || []) addSeries(round, series);
  if (po.round < 3) {
    for (const conf of ['East', 'West']) for (const m of po[conf] || []) addSeries(po.round, m);
  } else if (po.finals) addSeries(3, po.finals);
  return out.sort((a, b) => a.round - b.round || a.idx - b.idx).map((x) => x.g);
}

// Injury truncation shaves points off a box line *after* simGame has already
// banked its quarter-by-quarter line score live, so the quarters can sum to
// more than the post-truncation final. Claw the difference back out of the
// latest quarters (where a late injury would actually have cost the points)
// so the displayed line score always adds up to the final score.
function reconcileQuarters(qtrs, pts) {
  let delta = qtrs.reduce((s, q) => s + q, 0) - pts;
  for (let i = qtrs.length - 1; i >= 0 && delta > 0; i--) {
    const take = Math.min(delta, qtrs[i]);
    qtrs[i] -= take;
    delta -= take;
  }
}

// Simulate one day of games. Returns results.
export function simDay(league) {
  if (league.phase !== 'regular' || league.dayIndex >= league.schedule.length) return [];
  const rng = makeRng(league.seed + league.dayIndex * 7919 + 13);
  // a calendar day passes for every team's wounded — whether or not they
  // play tonight — before tonight's games risk any new injuries, so fresh
  // casualties don't tick the day they got hurt.
  for (const team of league.teams) tickInjuries(league, team);
  const results = [];
  for (const g of league.schedule[league.dayIndex]) {
    const home = getTeam(league, g.home);
    const away = getTeam(league, g.away);
    const r = simGame(home, away, rng);
    // Two-way players on assignment play a G-League game the same night
    // instead of riding the NBA bench.
    for (const team of [home, away]) {
      for (const p of team.twoWay) {
        const box = simGLeagueGame(p, rng);
        applyBoxToStats([p], [box], 'gLeagueStats');
        updateGLeagueHotStreak(p, box);
      }
    }
    // Roll injuries before tallying stats so a player hurt mid-game banks
    // only the minutes he actually played.
    const hurt = [
      ...rollGameInjuries(league, home, r.homeBox, rng),
      ...rollGameInjuries(league, away, r.awayBox, rng),
    ];
    applyBoxToStats(home.roster, r.homeBox);
    applyBoxToStats(away.roster, r.awayBox);
    checkGameHighs(league, r, home, away);
    const injuryReport = hurt.map((p) => ({ playerId: p.id, type: p.injury.type, tier: p.injury.tier, daysLeft: p.injury.daysLeft }));
    for (const p of hurt) {
      r.events.push({ q: '', t: '', text: `🩹 ${p.name} left the game injured: ${p.injury.type} (${injuryTimeline(p.injury)}).` });
    }
    // Sync stored score to the box totals after injury truncation *before*
    // deciding the winner, so the recorded result always matches the final
    // score shown to the user. simGame plays out overtime until someone
    // leads, so the pre-truncation score is never tied — use it only as a
    // tiebreaker on the rare chance truncation rounding ties the box totals.
    const rawHomeWon = r.homePts > r.awayPts;
    r.homePts = r.homeBox.reduce((s, l) => s + l.pts, 0);
    r.awayPts = r.awayBox.reduce((s, l) => s + l.pts, 0);
    reconcileQuarters(r.homeQtrs, r.homePts);
    reconcileQuarters(r.awayQtrs, r.awayPts);
    const homeWon = r.homePts !== r.awayPts ? r.homePts > r.awayPts : rawHomeWon;
    if (homeWon) { home.wins++; away.losses++; }
    else { away.wins++; home.losses++; }
    updateStreak(league, home, homeWon);
    updateStreak(league, away, !homeWon);
    pushGameNews(league, r, home, away, hurt);
    results.push({ ...g, homePts: r.homePts, awayPts: r.awayPts, homeBox: r.homeBox, awayBox: r.awayBox, homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs, events: r.events, playByPlay: r.playByPlay, injuryReport });
  }
  // unsigned players heal on the same calendar clock as rostered players
  for (const p of league.freeAgents) {
    if (p.injury && p.injury.tier !== 'season' && --p.injury.daysLeft <= 0) p.injury = null;
  }
  if (!league.resultsByDay) league.resultsByDay = []; // saves predating this field
  // What persists per game (resultsByDay resets every season, so nothing
  // piles up across years): the user's games keep the full box scores and
  // game-flow events/play-by-play (trimmed to the last KEEP_PBP_GAMES below);
  // everyone else's keep just the quarter line score and each side's top
  // performers. Boxes store in compact array form (see BOX_COLS).
  league.resultsByDay[league.dayIndex] = results.map((r) => {
    const slim = { home: r.home, away: r.away, homePts: r.homePts, awayPts: r.awayPts, homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs, injuryReport: r.injuryReport };
    if (r.home === league.userTeamId || r.away === league.userTeamId) {
      return { ...slim, homeBox: encodeBox(r.homeBox), awayBox: encodeBox(r.awayBox), events: r.events, playByPlay: r.playByPlay };
    }
    return { ...slim, homeStars: encodeBox(starLines(r.homeBox)), awayStars: encodeBox(starLines(r.awayBox)) };
  });
  trimPlayByPlay(collectRegularPbpGames(league));
  updateConditions(league, results);
  dailyMoraleUpdate(league, results);
  updateTradeDemands(league);
  maybeShopDisgruntled(league, rng);
  maybeAiTrade(league, rng);
  maybeAiSalaryDump(league, rng);
  maybeAiBuyoutRelease(league, rng);
  aiExtensions(league, rng);
  maybeAiMidSeasonSigning(league, rng);
  maybeAiBuyoutSigning(league, rng);
  expireTradeOffers(league);
  maybeGenerateTradeOffer(league, rng);
  const userTeam = league.userTeamId ? getTeam(league, league.userTeamId) : null;
  if (userTeam) {
    dailyApprovalUpdate(userTeam);
    maybeOwnerInterference(league, userTeam, rng);
    maybeCoachConversation(league, userTeam, rng);
    maybeQueueCallUpPrompt(league, userTeam);
  }
  if (league.dayIndex % 7 === 0) {
    const flaggedThisWeek = checkRecordPace(league);
    if (userTeam) checkMilestoneAlerts(league, userTeam, flaggedThisWeek);
  }
  tickProScouting(league); // pro-scouting film accumulates each simmed game-day
  league.dayIndex += 1;
  if (league.dayIndex === TRADE_DEADLINE_DAY + 1) {
    pushNews(league, { day: league.dayIndex, category: 'league', major: true, text: '🔒 The trade deadline has passed. All trades are locked until the offseason.' });
  }
  if (league.dayIndex === ALL_STAR_DAYS[0] && league.allStar?.season !== league.season) {
    league.allStar = buildAllStarEvent(league);
    pushNews(league, { day: league.dayIndex, category: 'league', major: true, text: '⭐ All-Star rosters have been announced — the league pauses for All-Star Weekend.' });
  }
  if (league.dayIndex >= league.schedule.length) {
    league.phase = 'awards';
    league.playoffs = initPlayoffs(league);
    computeAwards(league);
    // the week off before the playoffs gets everyone most of the way fresh
    for (const team of league.teams) {
      for (const p of team.roster) setCond(p, (p.condition ?? 100) + 20 + (100 - (p.condition ?? 100)) * 0.5);
    }
    league.dayIndex += 7;
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

export function makeRoundMatchups(seeds) {
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

  // Each call plays one round of games across the league, the playoff
  // equivalent of a calendar day — tick every team's wounded, not just
  // tonight's two combatants, so injuries heal on the same clock as the
  // regular season.
  for (const team of league.teams) tickInjuries(league, team);

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
      applyBoxToStats(team.roster, box, 'playoffStats');
      for (const p of rollGameInjuries(league, team, box, rng)) {
        hurt.push(p);
        r.events.push({ q: '', t: '', text: `🩹 ${p.name} left the game injured: ${p.injury.type} (${injuryTimeline(p.injury)}).` });
      }
    }
    if (!m.games) m.games = [];
    // playoff games persist for the whole offseason (league.playoffs only
    // resets when the next season starts), so unlike a single regular-season
    // day, this data sits in the save through development/draft/free agency.
    // Mirror resultsByDay's rule: full box + play-by-play only for games
    // involving the user's team (and even then, play-by-play is trimmed to
    // the last KEEP_PBP_GAMES below); everyone else gets quarter lines + top
    // performers, which is enough for "click a series for results". The
    // Finals always get a full box regardless — computeFinalsMVP needs every
    // player's line, not just the top 3 per team.
    const isUserGame = homeId === league.userTeamId || awayId === league.userTeamId;
    const fullBox = isUserGame || m === po.finals;
    const game = {
      home: homeId, away: awayId, homePts: r.homePts, awayPts: r.awayPts,
      homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs,
      injuryReport: hurt.map((p) => ({ playerId: p.id, type: p.injury.type, tier: p.injury.tier, daysLeft: p.injury.daysLeft })),
      ...(isUserGame ? { events: r.events, playByPlay: r.playByPlay } : null),
      ...(fullBox
        ? { homeBox: encodeBox(r.homeBox), awayBox: encodeBox(r.awayBox) }
        : { homeStars: encodeBox(starLines(r.homeBox)), awayStars: encodeBox(starLines(r.awayBox)) }),
    };
    m.games.push(game);
    played.push({ series: m, game, round: po.round });
    po.gamesPlayed += 1;
    // Sync stored score to the box totals after injury truncation *before*
    // deciding the winner, so the series record always matches the final
    // score shown to the user (see simDay for why rawHomeWon is the tiebreaker).
    const rawHomeWon = r.homePts > r.awayPts;
    game.homePts = r.homeBox.reduce((s, l) => s + l.pts, 0);
    game.awayPts = r.awayBox.reduce((s, l) => s + l.pts, 0);
    reconcileQuarters(game.homeQtrs, game.homePts);
    reconcileQuarters(game.awayQtrs, game.awayPts);
    const homeWon = game.homePts !== game.awayPts ? game.homePts > game.awayPts : rawHomeWon;
    const highWon = homeWon === (homeId === m.high);
    if (highWon) m.highWins += 1; else m.lowWins += 1;
    // playoff results swing morale harder than a regular-season game
    applyResultMorale(getTeam(league, homeId), homeWon, 2);
    applyResultMorale(getTeam(league, awayId), !homeWon, 2);
    if (m.highWins === 4 || m.lowWins === 4) {
      m.winner = m.highWins === 4 ? m.high : m.low;
      po.log.push(`${getTeam(league, m.winner).name} win series ${Math.max(m.highWins, m.lowWins)}-${Math.min(m.highWins, m.lowWins)}`);
    }
  };

  if (po.round < 3) {
    for (const conf of ['East', 'West']) po[conf].forEach(playGame);
    // a night of playoff games stands in for the ~2 rest days between a
    // series' games — matches playoffCondition's recovery formula above, and
    // keeps news/dates from bunching every round onto the same calendar day
    if (played.length) league.dayIndex += 2;
    if (['East', 'West'].every((c) => po[c].every((m) => m.winner))) advanceRound(po, league);
  } else if (po.finals && !po.finals.winner) {
    playGame(po.finals);
    if (played.length) league.dayIndex += 2;
    if (po.finals.winner) {
      po.champion = po.finals.winner;
      const champ = getTeam(league, po.champion);
      bumpRosterMorale(champ, 10);
      pushNews(league, { day: league.dayIndex, category: 'league', major: true, teamIds: [champ.id], text: `🏆 The ${champ.city} ${champ.name} are NBA Champions!` });

      const mvp = computeFinalsMVP(league);
      league.finalsMVP = mvp;
      if (mvp) {
        const mvpPlayer = getTeam(league, mvp.teamId).roster.find((x) => x.id === mvp.playerId);
        mvpPlayer.awards = mvpPlayer.awards || [];
        mvpPlayer.awards.push({ season: league.season, award: 'Finals MVP' });
        if (mvp.teamId === league.userTeamId) {
          league.gmLegacy.finalsMVPs ??= [];
          league.gmLegacy.finalsMVPs.push({ playerId: mvp.playerId, name: mvp.name, season: league.season });
        }
      }
      // Snapshot the user's roster before development/draft/FA reshape it,
      // so the Season Preview screen can summarize what changed this summer.
      const userTeamNow = getTeam(league, league.userTeamId);
      league.offseasonRosterSnapshot = userTeamNow ? userTeamNow.roster.map((p) => p.id) : [];

      league.phase = 'offseason/finals-mvp';
      // Pre-draft scouting window opens: seed the prospect pool and let the
      // AI spend its scouting budgets before the user advances the offseason.
      initScoutingPhase(league, makeRng(league.seed + league.season * 70_007 + 555_001));
      league.nextPlayerId = getNextPlayerId();
    }
  }
  trimPlayByPlay(collectPlayoffPbpGames(po));
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
  // a few extra days off between rounds, on top of the per-game gap already
  // added in simPlayoffGame, mirroring the real layoff before the next round
  league.dayIndex += 3;
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

// Where a team stands in the playoffs right now: its active series (if
// still alive and the bracket has reached it), the series it was eliminated
// in, or the championship. Returns null if the team never made the playoffs
// or its next series hasn't been set yet.
export function teamPlayoffStatus(league, teamId) {
  const po = league.playoffs;
  if (!po) return null;
  if (po.champion === teamId) return { champion: true, round: 3 };
  if (po.finals && (po.finals.high === teamId || po.finals.low === teamId)) {
    return { series: po.finals, round: 3, active: !po.finals.winner };
  }
  for (const conf of ['East', 'West']) {
    for (const m of po[conf] || []) {
      if (m.high === teamId || m.low === teamId) return { series: m, round: po.round, active: !m.winner };
    }
  }
  for (const { round, conf, series } of [...(po.completed || [])].reverse()) {
    if (series.high === teamId || series.low === teamId) {
      return { series, round, active: false, eliminated: series.winner !== teamId };
    }
  }
  return null;
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

const round1 = (n) => Math.round(n * 10) / 10;

// The top performer across the Finals series by points, efficiency, and a
// bonus weight on the series-clinching game.
function computeFinalsMVP(league) {
  const finals = league.playoffs?.finals;
  if (!finals?.games?.length) return null;
  const lastGame = finals.games[finals.games.length - 1];
  const totals = new Map();
  for (const game of finals.games) {
    for (const [teamId, encoded] of [[game.home, game.homeBox], [game.away, game.awayBox]]) {
      // an in-progress Finals series from before full Finals boxes were kept
      // may have earlier games stored as star lines only
      if (!encoded) continue;
      for (const line of decodeBox(encoded)) {
        if (line.min <= 0) continue;
        let t = totals.get(line.playerId);
        if (!t) {
          t = { playerId: line.playerId, teamId, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, gp: 0, clutch: 0 };
          totals.set(line.playerId, t);
        }
        t.pts += line.pts; t.reb += line.reb; t.ast += line.ast; t.stl += line.stl; t.blk += line.blk; t.gp += 1;
        if (game === lastGame) t.clutch = line.pts + 0.7 * (line.reb + line.ast) + line.stl + line.blk;
      }
    }
  }
  let best = null;
  let bestScore = -Infinity;
  for (const t of totals.values()) {
    const score = t.pts / t.gp + 0.7 * (t.reb + t.ast) / t.gp + (t.stl + t.blk) / t.gp
      + (t.teamId === league.playoffs.champion ? 4 : 0)
      + t.clutch * 0.5;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best) return null;
  const p = league.teams.flatMap((tm) => tm.roster).find((x) => x.id === best.playerId);
  if (!p) return null;
  return {
    playerId: p.id, name: p.name, pos: p.pos, teamId: best.teamId,
    ppg: round1(best.pts / best.gp), rpg: round1(best.reb / best.gp), apg: round1(best.ast / best.gp), gp: best.gp,
  };
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
  // Coaching decisions draw from their own sequence so they don't reshuffle
  // the rng draws player development/free agency depend on.
  const coachRng = makeRng(league.seed + league.season * 104729 + 555_555);
  const userTeam = getTeam(league, league.userTeamId); // absent in headless all-AI sims
  league.history.push({
    season: league.season,
    champion: league.playoffs?.champion || null,
    userRecord: userTeam ? `${userTeam.wins}-${userTeam.losses}` : '',
    awards: league.seasonAwards ?? null, // snapshot from computeAwards at season's end
  });
  league.seasonAwards = null;

  // Every player on the champion's roster banks a championship credit —
  // before retirements/trades reshuffle that roster.
  if (league.playoffs?.champion) {
    const champTeam = getTeam(league, league.playoffs.champion);
    for (const p of champTeam.roster) p.championships = (p.championships || 0) + 1;
  }

  // Captured before per-team wins/losses reset below, for the ownership system
  const ownerResult = userTeam ? {
    wins: userTeam.wins,
    losses: userTeam.losses,
    playoffRound: playoffRoundReached(league, userTeam.id),
    champion: league.playoffs?.champion === userTeam.id,
  } : null;

  const expiring = [];
  const retiring = [];
  const devEntries = []; // the user team's development report rows
  for (const team of league.teams) {
    const isUserTeam = team.id === league.userTeamId;
    for (const p of [...team.roster, ...team.twoWay]) {
      // archive season stats, split into one row per team if traded mid-season
      let prev = emptyStats();
      for (const stint of p.seasonStints) {
        const stintStats = diffStats(stint.stats, prev);
        if (stintStats.gp > 0) p.careerStats.push({ season: league.season, team: stint.team, ...stintStats });
        prev = stint.stats;
      }
      const finalStats = diffStats(p.stats, prev);
      if (finalStats.gp > 0) p.careerStats.push({ season: league.season, team: team.id, ...finalStats });
      p.seasonStints = [];
      p.stats = emptyStats();
      // rosters are frozen during the playoffs (no trades/signings), so
      // unlike regular-season stats this never needs to split into stints
      if (p.playoffStats.gp > 0) p.playoffCareerStats.push({ season: league.season, team: team.id, ...p.playoffStats });
      p.playoffStats = emptyStats();
      // assignment production resets the same way — no stint-splitting since
      // two-way players can't currently be traded mid-season
      const gLeagueGp = p.gLeagueStats.gp;
      if (gLeagueGp > 0) p.gLeagueCareerStats.push({ season: league.season, team: team.id, ...p.gLeagueStats });
      p.gLeagueStats = emptyStats();
      p.condition = 100; // a summer off heals everything
      p.injury = null; // ...including last spring's torn ACL
      // Track qualifying seasons for dev-trait fog collapse.
      const prevQS = p.qualitySeasons ?? 0;
      p.qualitySeasons = computeQualitySeasons(p);
      // Fire news when a Star+ trait first becomes confirmable (collapses to a single tier).
      if (p.qualitySeasons >= 3 && prevQS < 3) {
        const tier = traitFromPotential(p.potential);
        if (TRAIT_NEWS_REVEAL_TIERS.has(tier)) {
          pushNews(league, {
            category: 'scouting',
            text: `Scouts have confirmed ${p.name} has ${tier === 'Generational' ? 'generational' : tier === 'Superstar' ? 'superstar' : 'star'} potential.`,
          });
        }
      }
      snapshotRatings(p, league.season); // progression history: ratings before this summer's development
      const oldRow = ratingRow(p);
      // A full season of G-League reps speeds up closing the gap to his
      // existing ceiling — separate from devBonus, which nudges the ceiling itself.
      const repBonus = clamp(gLeagueGp / 12, 0, 2.5);
      developPlayer(p, rng, devBonus(team.coach), repBonus);
      maybeRevealBackstory(league, p, team); // backstory.js: reputation emerges after 2 seasons
      const entry = isUserTeam
        ? { id: p.id, name: p.name, pos: p.pos, age: p.age, old: oldRow, now: ratingRow(p) }
        : null;
      if (entry) devEntries.push(entry);
      // Retirement comes for everyone, contract or not; a retired contract
      // simply comes off the books.
      if (shouldRetire(p, rng) || (p.age >= 30 && overall(p) < 40)) {
        if (entry) {
          entry.retired = true;
          const seasons = new Set((p.careerStats || []).map((s) => s.season)).size;
          const seasonsWithTeam = (p.careerStats || []).filter((s) => s.team === team.id).length;
          if (seasons > 0) {
            entry.farewell = `After ${seasons} season${seasons === 1 ? '' : 's'} ${p.name} has retired.`
              + (seasonsWithTeam > 0 ? ` He spent ${seasonsWithTeam} of those season${seasonsWithTeam === 1 ? '' : 's'} with you.` : '');
          }
        }
        retiring.push({ team, p });
        continue;
      }
      if (p.contract) {
        p.contract.years -= 1;
        if (p.contract.years <= 0) {
          if (p.extension) {
            // the extension signed during the season kicks in seamlessly
            p.contract = p.extension;
            recordContract(p, league.season + 1, team.id, p.contract);
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
    team.deadMoney = team.deadMoney
      .map((d) => ({ ...d, years: d.years - 1 }))
      .filter((d) => d.years > 0);
    team.lastWins = team.wins; // free agents judge teams by last season's record
    league.teamSeasonRecords.push({ season: league.season, teamId: team.id, wins: team.wins, losses: team.losses });
    team.wins = 0;
    team.losses = 0;

    // AI teams quietly re-sign or replace their coach; the user does this on
    // the Coaching Decisions screen instead (see league.coachCandidates below).
    if (team.id !== league.userTeamId) {
      // Expensive bad coaches face slightly more pressure; cheap bad coaches
      // still fire at normal rate so AI doesn't hoard low-salary underperformers.
      const fireP = team.coach.salary >= 7_000_000 ? 0.35 : 0.3;
      if (team.coach.rating < 60 && coachRng() < fireP) {
        pushNews(league, { day: 0, category: 'league', teamIds: [team.id], text: `The ${team.name} part ways with head coach ${team.coach.name} after a disappointing season.` });
        team.coach = generateCoach(coachRng);
      } else {
        team.coach.seasonsWithTeam += 1;
      }
    }
  }
  // Two fresh candidates for the user's Coaching Decisions screen, alongside
  // the option to retain the incumbent.
  if (league.userTeamId) {
    league.coachCandidates = [generateCoach(coachRng), generateCoach(coachRng)];
  }

  // The user reviews this on the Development Report screen after advancing.
  // One report per save — overwritten every offseason, so it stays small.
  // Empty in headless all-AI sims, where no team is the user's.
  league.devReport = { season: league.season, entries: devEntries };

  const newlyRetired = [];
  for (const { team, p } of retiring) {
    team.roster = team.roster.filter((x) => x.id !== p.id);
    team.twoWay = team.twoWay.filter((x) => x.id !== p.id);
    const snap = snapshotRetiree(p, league, team.id);
    league.retiredPlayers.push(snap);
    newlyRetired.push(snap);
    announceRetirement(league, p, team.id);
  }

  // All-time record book, Hall of Fame, dynasties, and the GM legacy
  // tracker — derived from this season's careerStats/history/retirees.
  const brokenRecords = computeRecordBook(league);
  for (const b of brokenRecords) {
    const { text, isUserTeam } = describeBrokenRecord(league, b);
    pushNews(league, { day: 0, category: 'milestone', major: true, recordBreaker: true, teamIds: isUserTeam ? [league.userTeamId] : undefined, text });
    if (isUserTeam && !league.recordBreakingMoment) league.recordBreakingMoment = { ...b, text, isUserTeam: true };
  }
  evaluateHallOfFame(league, newlyRetired);
  detectDynasties(league);
  updateGmLegacy(league, ownerResult);
  updateCrossSaveLegacy(league);

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
      team.twoWay = team.twoWay.filter((x) => x.id !== p.id);
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
      const ceiling = team.strategy === 'contending' ? CONTENDER_CEILING : LUXURY_TAX;
      if (payroll(team) + salary <= ceiling) {
        p.contract = { salary, years: preferredYears(p) };
        recordContract(p, league.season + 1, team.id, p.contract);
        delete p.extOfferMade;
        if (overall(p) >= 70) {
          pushNews(league, { day: 0, category: 'signing', teamIds: [team.id], text: `${p.name} re-signs with the ${team.city} ${team.name} (${fmtM(salary)} x ${p.contract.years}yr).` });
        }
        continue;
      }
    }
    team.roster = team.roster.filter((x) => x.id !== p.id);
    team.twoWay = team.twoWay.filter((x) => x.id !== p.id);
    league.freeAgents.push(p);
  }

  // Age free agents, drop retirees, top up the pool. Players who just hit
  // the market above were already aged/developed once this offseason while
  // still rostered — skip them here so they don't get a second growth roll.
  const justExpiredIds = new Set(expiring.map((e) => e.p.id));
  league.freeAgents = league.freeAgents.filter((p) => {
    p.condition = 100;
    p.injury = null;
    if (!justExpiredIds.has(p.id)) {
      snapshotRatings(p, league.season);
      developPlayer(p, rng);
    }
    if (overall(p) >= 38 && !shouldRetire(p, rng)) return true;
    announceRetirement(league, p);
    return false;
  });
  while (league.freeAgents.length < 50) {
    // pool top-ups are fringe talent — quality starters rarely go unsigned
    const p = generatePlayer(rng, { age: randInt(19, 30, rng), base: clamp(gauss(FRINGE_OVR_MEAN, FRINGE_OVR_SPREAD, rng), FRINGE_OVR_FLOOR, FRINGE_OVR_CEIL) });
    p.contract = null;
    league.freeAgents.push(p);
  }
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  // The pool would otherwise grow without bound (each draft class outnumbers
  // retirements); the unsigned tail quietly heads overseas
  if (league.freeAgents.length > 70) league.freeAgents.length = 70;
  league.nextPlayerId = getNextPlayerId();

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
  // Draft order (including the lottery) is resolved now so the Draft Lottery
  // screen can reveal it; the draft itself doesn't open until that phase ends.
  initDraft(league, rng);
  league.phase = 'offseason/development';
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
      // Multi-year deals carry into next season at full salary — make sure
      // they don't stack on top of next season's already-committed payroll
      // (expiring deals dropping off, pending extensions kicking in) and
      // blow past what this team's strategy can support down the road.
      if (years > 1 && projectedPayroll(team) + demand > projectedPayrollLimit(team)) continue;
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
          && payroll(formerTeam) + demand <= CONTENDER_CEILING;
        if (formerMatches) {
          // the original team matches immediately — this bidder leaves empty-handed
          league.freeAgents.splice(i, 1);
          i--;
          target.restrictedFA = false;
          delete target.formerTeamId;
          target.contract = { salary: demand, years };
          recordContract(target, league.season, formerTeam.id, target.contract);
          delete target.extOfferMade;
          formerTeam.roster.push(target);
          const aiMatchText = `The ${formerTeam.city} ${formerTeam.name} match an offer sheet to keep ${target.name} (${fmtM(demand)}/yr x ${years}yr).`;
          pushNews(league, { day: 0, category: 'signing', teamIds: [formerTeam.id], text: aiMatchText });
          recordTransaction(target, { season: league.season, type: 'free-agency', team: formerTeam.id, text: aiMatchText });
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
    league.phase = 'offseason/preview';
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
  // "Undrafted gem" types are systematically underpriced until their
  // reputation becomes public — see backstory.js
  return clamp(Math.round((base * discount * askingPriceMult(p)) / 100_000) * 100_000, MIN_SALARY, MAX_SALARY);
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

// A vet waived after the trade deadline (a "buyout") will sign for a
// rest-of-season minimum same as a fringe player, regardless of his rating —
// that's the whole story of a real-NBA buyout candidate chasing a ring.
export function buyoutEligible(p) {
  return p.waivedDuringSeason != null;
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
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: `Roster full (${ROSTER_MAX}). Waive someone first.` };
  const idx = league.freeAgents.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'That player is no longer a free agent.' };
  const p = league.freeAgents[idx];
  const buyout = buyoutEligible(p);
  if (!midSeasonSignable(p) && !buyout) {
    return { ok: false, error: `${p.name} won't take a minimum deal mid-season — he's holding out for a real contract in the offseason.` };
  }
  p.contract = { salary: proratedMinSalary(league), years: 1 };
  recordContract(p, league.season, team.id, p.contract);
  league.freeAgents.splice(idx, 1);
  if (team.id === league.userTeamId) p.everOnUserTeam = true;
  team.roster.push(p); // on the roster now — available for the next game
  bumpTurmoil(team, 0.5);
  const text = buyout
    ? `The ${team.city} ${team.name} sign bought-out ${p.name} for the stretch run.`
    : `The ${team.city} ${team.name} sign ${p.name} to a rest-of-season minimum contract.`;
  pushNews(league, { day: league.dayIndex, category: 'signing', teamIds: [team.id], text });
  recordTransaction(p, { season: league.season, day: league.dayIndex, type: 'free-agency', team: team.id, text });
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

// Once the trade deadline passes, contenders go shopping in earnest for
// bought-out vets — unlike the fringe pickups above, this targets the best
// available buyout candidate (not a random thin-roster fill).
function maybeAiBuyoutSigning(league, rng) {
  if (league.dayIndex <= TRADE_DEADLINE_DAY) return;
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    if (team.strategy !== 'contending') continue;
    if (team.roster.length >= ROSTER_MAX) continue;
    if (rng() >= 0.12) continue;
    const target = league.freeAgents.find((p) => buyoutEligible(p) && !p.injury);
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
  // "Family provider" types sign extensions cheaper — see backstory.js
  return Math.round(demandSalary(team, p, years, winPct) * extensionDemandMult(p));
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
      // Project payroll for the season this extension actually activates:
      // start from next season's committed payroll (which already accounts
      // for other expiring deals and previously-signed extensions), drop
      // this player's own next-season contribution (his current deal if it
      // carries over, or nothing if it's expiring), and add the extension.
      const ownContribution = p.contract.years > 1 ? p.contract.salary : 0;
      const projected = projectedPayroll(team) - ownContribution + demand;
      if (projected > projectedPayrollLimit(team)) continue;
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
  const capRoom = SALARY_CAP - payroll(team);
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
  if (league.phase !== 'offseason/freeagency') return { ok: false, error: 'Free agency is not open.' };
  const team = getTeam(league, teamId);
  const p = league.freeAgents.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'That player is no longer a free agent.' };
  if (p.restrictedFA && p.formerTeamId !== teamId) {
    const formerTeam = getTeam(league, p.formerTeamId);
    return { ok: false, error: `${p.name} is a restricted free agent — his rights remain with the ${formerTeam.city} ${formerTeam.name} unless they decline to match an offer sheet.` };
  }
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: `Roster full (${ROSTER_MAX}). Waive someone first.` };
  const exception = signingException(league, teamId, salary);
  if (!exception) {
    const room = SALARY_CAP - payroll(team);
    const mleNote = team.usedMLE
      ? "you've already used this offseason's mid-level exception"
      : `the mid-level exception only covers up to ${fmtM(MLE_AMOUNT)}`;
    return { ok: false, error: `Not enough cap room (${fmtM(Math.max(room, 0))} available), and ${mleNote}. Minimum contracts can always be offered.` };
  }
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
    const overBudget = exceedsOwnerBudget(team, salary);
    signFreeAgent(league, teamId, playerId, salary, years);
    if (exception === 'mle') team.usedMLE = true;
    let reason = `${p.name} accepts: ${fmtM(salary)} x ${years}yr!`;
    if (overBudget) {
      applyBudgetOverageEffect(team);
      reason += ` This signing exceeds your owner's budget — approval rating will drop.`;
    }
    return { ok: true, decision: 'accept', exception, reason };
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
  const rng = makeRng(league.seed + league.season * 1009 + p.id * 13);
  p.contract = {
    salary: salary ?? askingPrice(p),
    years: years ?? clamp(Math.round(gauss(2.5, 1, rng)), 1, 4),
  };
  recordContract(p, league.season, team.id, p.contract);
  if (teamId === league.userTeamId) {
    league.gmLegacy.faWatchlist.push({ playerId: p.id, season: league.season, salary: p.contract.salary, age: p.age });
  }
  delete p.extOfferMade;
  p.restrictedFA = false;
  p.offerSheetPending = false;
  delete p.formerTeamId;
  league.freeAgents.splice(idx, 1);
  if (teamId === league.userTeamId) p.everOnUserTeam = true;
  team.roster.push(p);
  if (league.negotiations?.[playerId] && teamId !== league.userTeamId) {
    pushNews(league, { day: 0, category: 'signing', teamIds: [team.id, league.userTeamId], text: `${p.name} broke off negotiations with you to sign elsewhere.` });
  }
  if (league.negotiations) delete league.negotiations[playerId];
  // a star changing teams in free agency is a headline
  const signText = `${p.name} signs with the ${team.city} ${team.name} (${fmtM(p.contract.salary)} x ${p.contract.years}yr).`;
  pushNews(league, { day: 0, category: 'signing', major: overall(p) >= 80, teamIds: [team.id], text: signText });
  recordTransaction(p, { season: league.season, type: 'free-agency', team: team.id, text: signText });
  return true;
}

// ---------- Two-way contracts ----------
// A small development slot alongside the standard roster: fixed low salary,
// cap-exempt (see payroll() above), and limited to players early in their
// career. Lives in team.twoWay, separate from team.roster, so it never
// affects ROSTER_MAX or lineup eligibility — call up a player to make him
// playable, which moves him into team.roster but keeps his contract exempt.

export function twoWayEligible(p) {
  return (p.exp ?? 0) <= TWO_WAY_MAX_EXP;
}

export function signToTwoWay(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  if (team.twoWay.length >= TWO_WAY_MAX) return { ok: false, error: `Two-way slots full (${TWO_WAY_MAX}).` };
  const idx = league.freeAgents.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'That player is no longer a free agent.' };
  const p = league.freeAgents[idx];
  if (p.restrictedFA) return { ok: false, error: `${p.name} is a restricted free agent — his rights remain with his former team.` };
  if (!twoWayEligible(p)) return { ok: false, error: `${p.name} has too much NBA experience for a two-way contract (max ${TWO_WAY_MAX_EXP} years).` };
  p.contract = { salary: TWO_WAY_SALARY, years: 1, twoWay: true };
  recordContract(p, league.season, team.id, p.contract);
  delete p.extOfferMade;
  p.restrictedFA = false;
  p.offerSheetPending = false;
  delete p.formerTeamId;
  league.freeAgents.splice(idx, 1);
  if (teamId === league.userTeamId) p.everOnUserTeam = true;
  team.twoWay.push(p);
  const twTextSign = `The ${team.city} ${team.name} sign ${p.name} to a two-way contract.`;
  pushNews(league, { day: league.dayIndex || 0, category: 'signing', teamIds: [team.id], text: twTextSign });
  recordTransaction(p, { season: league.season, day: league.dayIndex || 0, type: 'two-way', team: team.id, text: twTextSign });
  return { ok: true, player: p };
}

export function callUpTwoWay(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: `Roster full (${ROSTER_MAX}). Waive someone first.` };
  const idx = team.twoWay.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'Not on this team\'s two-way roster.' };
  const p = team.twoWay.splice(idx, 1)[0];
  team.roster.push(p);
  pushNews(league, { day: league.dayIndex || 0, category: 'signing', teamIds: [team.id], text: `The ${team.city} ${team.name} call up two-way player ${p.name}.` });
  return { ok: true, player: p };
}

export function sendDownTwoWay(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  const idx = team.roster.findIndex((p) => p.id === playerId);
  if (idx === -1) return { ok: false, error: 'Not on this team\'s roster.' };
  const p = team.roster[idx];
  if (!p.contract?.twoWay) return { ok: false, error: `${p.name} is on a standard contract — only two-way players can be sent down.` };
  if (team.twoWay.length >= TWO_WAY_MAX) return { ok: false, error: `Two-way slots full (${TWO_WAY_MAX}).` };
  team.roster.splice(idx, 1);
  team.twoWay.push(p);
  return { ok: true, player: p };
}

// Converts a two-way deal into a standard contract — the player permanently
// takes a regular roster spot and counts against the cap from here on.
export function convertTwoWayToStandard(league, teamId, playerId, salary, years) {
  const team = getTeam(league, teamId);
  const twoWayIdx = team.twoWay.findIndex((p) => p.id === playerId);
  const onRoster = twoWayIdx === -1 ? team.roster.find((p) => p.id === playerId && p.contract?.twoWay) : null;
  if (twoWayIdx === -1 && !onRoster) return { ok: false, error: 'Not a two-way player on this team.' };
  if (twoWayIdx !== -1 && team.roster.length >= ROSTER_MAX) return { ok: false, error: `Roster full (${ROSTER_MAX}). Waive someone first.` };
  const p = twoWayIdx !== -1 ? team.twoWay[twoWayIdx] : onRoster;
  p.contract = {
    salary: salary ?? salaryFor(overall(p), p.age),
    years: years ?? 2,
  };
  recordContract(p, league.season, team.id, p.contract);
  if (twoWayIdx !== -1) {
    team.twoWay.splice(twoWayIdx, 1);
    team.roster.push(p);
  }
  pushNews(league, { day: league.dayIndex || 0, category: 'signing', teamIds: [team.id], text: `The ${team.city} ${team.name} convert ${p.name} to a standard contract (${fmtM(p.contract.salary)} x ${p.contract.years}yr).` });
  return { ok: true, player: p };
}

export function releaseTwoWay(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  let fromRoster = false;
  let idx = team.twoWay.findIndex((p) => p.id === playerId);
  if (idx === -1) { idx = team.roster.findIndex((p) => p.id === playerId && p.contract?.twoWay); fromRoster = true; }
  if (idx === -1) return false;
  const arr = fromRoster ? team.roster : team.twoWay;
  const p = arr.splice(idx, 1)[0];
  p.contract = null;
  league.freeAgents.push(p);
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  const twTextRelease = `The ${team.city} ${team.name} release two-way player ${p.name}.`;
  pushNews(league, { day: league.dayIndex || 0, category: 'signing', teamIds: [team.id], text: twTextRelease });
  recordTransaction(p, { season: league.season, type: 'waived', team: team.id, text: twTextRelease });
  return true;
}

// User matches an offer sheet on his own restricted free agent, keeping him
// at the offer's salary/years instead of losing him to the bidding team.
export function matchOfferSheet(league, playerId) {
  const idx = league.offerSheets.findIndex((s) => s.playerId === playerId && s.formerTeamId === league.userTeamId);
  if (idx === -1) return { ok: false, error: 'No offer sheet to match for that player.' };
  const sheet = league.offerSheets[idx];
  const team = getTeam(league, league.userTeamId);
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: `Roster full (${ROSTER_MAX}). Waive someone first.` };
  const p = league.freeAgents.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'That player is no longer available.' };
  p.contract = { salary: sheet.salary, years: sheet.years };
  recordContract(p, league.season, team.id, p.contract);
  league.gmLegacy.faWatchlist.push({ playerId: p.id, season: league.season, salary: p.contract.salary, age: p.age });
  delete p.extOfferMade;
  p.restrictedFA = false;
  p.offerSheetPending = false;
  delete p.formerTeamId;
  league.freeAgents = league.freeAgents.filter((x) => x.id !== playerId);
  p.everOnUserTeam = true;
  team.roster.push(p);
  league.offerSheets.splice(idx, 1);
  const matchText = `The ${team.city} ${team.name} match the offer sheet and retain ${p.name} (${fmtM(sheet.salary)}/yr x ${sheet.years}yr).`;
  pushNews(league, { day: 0, category: 'signing', major: true, teamIds: [team.id], text: matchText });
  recordTransaction(p, { season: league.season, type: 'free-agency', team: team.id, text: matchText });
  return { ok: true };
}

// Snapshots a player's cumulative season stats against the team he's about
// to leave, so advanceOffseason can split this season's careerStats row into
// one entry per team. No-op if he hasn't played for this team yet.
export function recordSeasonStint(p, teamId) {
  if (!p.stats.gp) return;
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
    team.deadMoney.push({ playerName: p.name, salary: p.contract.salary, years: p.contract.years });
  }
  p.contract = null;
  // a fresh start: whatever grudge he held against this front office is
  // moot once he's no longer on its roster (mirrors executeTrade's reset)
  p.tradeDemand = false;
  p.tradeDemandTeam = null;
  p.moraleLowStreak = 0;
  const isBuyout = league.phase === 'regular' && league.dayIndex > TRADE_DEADLINE_DAY;
  if (isBuyout) p.waivedDuringSeason = league.dayIndex;
  league.freeAgents.push(p);
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  const text = isBuyout
    ? `The ${team.city} ${team.name} and ${p.name} agree to a buyout, making him a free agent.`
    : `The ${team.name} waive ${p.name}.`;
  pushNews(league, { day: 0, category: 'signing', teamIds: [team.id], text });
  recordTransaction(p, { season: league.season, type: 'waived', team: team.id, text });
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
  initSeasonScouting(league, rng);
  pushNews(league, { day: 0, category: 'league', text: `The ${league.season} season begins!` });
}
