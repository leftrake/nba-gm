import { TEAMS, SALARY_CAP, LUXURY_TAX, MIN_SALARY, MAX_SALARY, ROSTER_MAX } from '../data/teams.js';
import { makeRng, randInt, clamp, gauss } from './rng.js';
import { generatePlayer, resetPlayerIds, emptyStats, developPlayer, overall, salaryFor, assignOrigin, shouldRetire, generateStamina, supportedMinutes, generateDurability, snapshotRatings, ratingRow } from './players.js';
import { rollGameInjuries, tickInjuries, injuryTimeline } from './injuries.js';
import { simGame, applyBoxToStats, encodeBox, starLines } from './sim.js';
import { initDraft } from './draft.js';
import { computeAwards, honorsSummary } from './awards.js';
import { evaluateStrategies, maybeAiTrade } from './strategy.js';
import { autoLineup } from './lineup.js';
import { SAVE_VERSION, NEWS_MAX, pushNews } from './save.js';
import {
  initMorale, moraleSalaryMult, applyResultMorale, bumpRosterMorale, bumpTurmoil,
  dailyMoraleUpdate, updateTradeDemands, maybeShopDisgruntled,
} from './morale.js';

export function createLeague(userTeamId, seed = Date.now()) {
  const rng = makeRng(seed);
  resetPlayerIds(1);

  const teams = TEAMS.map((t) => ({
    ...t,
    roster: makeRoster(rng),
    deadMoney: [], // { playerName, salary, years } — cap hits from waived contracts
    wins: 0,
    losses: 0,
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
    phase: 'regular', // regular | playoffs | offseason | draft | freeagency
    playoffs: null,
    freeAgents: Array.from({ length: 60 }, () => {
      // unsigned for a reason: the open market skews toward fringe talent
      const p = generatePlayer(rng, { base: clamp(gauss(48, 8, rng), 35, 72) });
      p.contract = null;
      return p;
    }),
    news: [{ day: 0, season: 2026, phase: 'regular', category: 'league', teamIds: [userTeamId], text: `Welcome, GM! You're now running the ${TEAMS.find(t => t.id === userTeamId).city} ${TEAMS.find(t => t.id === userTeamId).name}.` }],
    newsArchive: {}, // { [season]: [major news items, chronological] }
    history: [],
  };
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  // Only the user's lineup persists; AI teams auto-set theirs every game
  getTeam(league, userTeamId).lineup = autoLineup(getTeam(league, userTeamId).roster);
  evaluateStrategies(league);
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
  league.freeAgents.forEach(fill);
  league.draft?.prospects?.forEach(fill);
  // Saves predating front-office strategies
  if (league.teams.some((t) => !t.strategy)) evaluateStrategies(league);
  // Saves predating lineups
  const user = getTeam(league, league.userTeamId);
  if (!user.lineup) user.lineup = autoLineup(user.roster);
  // Saves predating the news cap
  if (league.news.length > NEWS_MAX) league.news.length = NEWS_MAX;
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
    applyBoxToStats(home.roster, r.homeBox);
    applyBoxToStats(away.roster, r.awayBox);
    // injured players sat out tonight (tick), then anyone who played risks
    // getting hurt (roll) — order matters so fresh casualties don't tick
    tickInjuries(league, home);
    tickInjuries(league, away);
    const hurt = [
      ...rollGameInjuries(league, home, r.homeBox, rng),
      ...rollGameInjuries(league, away, r.awayBox, rng),
    ];
    for (const p of hurt) {
      r.events.push({ q: '', t: '', text: `🩹 ${p.name} left the game injured: ${p.injury.type} (${injuryTimeline(p.injury)}).` });
    }
    if (r.homePts > r.awayPts) { home.wins++; away.losses++; }
    else { away.wins++; home.losses++; }
    results.push({ ...g, homePts: r.homePts, awayPts: r.awayPts, homeBox: r.homeBox, awayBox: r.awayBox, homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs, events: r.events });
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
    const slim = { home: r.home, away: r.away, homePts: r.homePts, awayPts: r.awayPts, homeQtrs: r.homeQtrs, awayQtrs: r.awayQtrs };
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
  aiExtensions(league, rng);
  maybeAiMidSeasonSigning(league, rng);
  league.dayIndex += 1;
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
    for (const [id, box] of [[homeId, r.homeBox], [awayId, r.awayBox]]) {
      const team = getTeam(league, id);
      playoffCondition(team, box);
      tickInjuries(league, team);
      for (const p of rollGameInjuries(league, team, box, rng)) {
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
  if (!po || po.champion) return;
  const startRound = po.round;
  let guard = 0;
  while (!po.champion && po.round === startRound && guard++ < 100) simPlayoffGame(league);
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
  const seasons = p.careerStats.length;
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

  const expiring = [];
  const retiring = [];
  const devEntries = []; // the user team's development report rows
  for (const team of league.teams) {
    const isUserTeam = team.id === league.userTeamId;
    for (const p of team.roster) {
      // archive season stats
      if (p.stats.gp > 0) p.careerStats.push({ season: league.season, ...p.stats });
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
          } else {
            p.contract = null;
            expiring.push({ team, p });
          }
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
  for (const { team, p } of expiring) {
    // If the front office already passed on extending him mid-season, that
    // was the retention decision — he tests the market (no second roll).
    const triedMidSeason = p.extTalksFailed;
    delete p.extTalksFailed;
    if (team.id !== league.userTeamId && !triedMidSeason && rng() < resignChance(team, p)) {
      // Bird-rights premium: incumbents pay a little over market to keep
      // their own players off the open market
      const salary = clamp(
        Math.round((askingPrice(p) * (1.0 + rng() * 0.25)) / 100_000) * 100_000,
        MIN_SALARY, MAX_SALARY,
      );
      if (payroll(team) + salary <= LUXURY_TAX) {
        p.contract = { salary, years: preferredYears(p) };
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
    const room = SALARY_CAP - payroll(team);
    // capped-out teams with a playable roster sit out rather than hoover
    // up every minimum guy on the market
    if (team.roster.length >= 13 && room < 5_000_000) continue;
    // how far past asking price this front office will stretch this round
    const stretch = 1.1 + rng() * 0.4;
    let tried = 0;
    for (let i = 0; i < league.freeAgents.length && tried < 12; i++) {
      const target = league.freeAgents[i]; // pool is sorted best-first
      const ask = askingPrice(target);
      if (ask > room && ask > MIN_SALARY) continue; // out of their price range
      tried++;
      const years = preferredYears(target);
      const demand = offerDemand(league, team.id, target, years);
      if (demand === null) continue; // wants a bigger role than this roster offers
      if (demand > ask * stretch) continue; // demanding more than this office will pay
      if (demand > room && demand > MIN_SALARY) continue;
      signFreeAgent(league, team.id, target.id, demand, years);
      break;
    }
  }
  league.faDaysLeft -= 1;
  if (league.faDaysLeft <= 0) startNewSeason(league);
}

export function askingPrice(p) {
  return salaryFor(overall(p), p.age);
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
// During the regular season, a player entering the final year of his
// contract can sign an extension that starts when the current deal ends.
// Extended players never reach free agency.

export function extensionEligible(p) {
  return !!(p.contract && p.contract.years === 1 && !p.extension);
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
// standing counter, which is always honored.
export function offerExtension(league, teamId, playerId, salary, years) {
  if (league.phase !== 'regular') return { ok: false, error: 'Extensions can only be negotiated during the regular season.' };
  const team = getTeam(league, teamId);
  const p = team.roster.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'That player is not on your roster.' };
  if (p.extension) return { ok: false, error: `${p.name} has already signed an extension.` };
  if (!extensionEligible(p)) return { ok: false, error: 'Only players entering the final year of their contract can be extended.' };
  years = clamp(Math.round(years), 1, 4);
  salary = clamp(Math.round(salary / 100_000) * 100_000, MIN_SALARY, MAX_SALARY);
  league.extensionTalks = league.extensionTalks || {};
  const talks = league.extensionTalks[playerId];
  const meetsCounter = talks?.counter && years === talks.counter.years && salary >= talks.counter.salary;
  if (!meetsCounter && talks && salary <= talks.best) {
    return { ok: false, error: `${p.name} already turned down ${fmtM(talks.best)}/yr — he'll only re-open talks for a better number.` };
  }
  const demand = meetsCounter ? salary : extensionDemand(league, teamId, p, years);
  if (demand === null) {
    const reason = roleBlocked(team, p)
      ? `${p.name} wants a featured role, and you already have two better players at ${p.pos} — he won't commit long-term.`
      : `${p.name} won't discuss an extension while the team is losing — win more games, or risk him testing the market.`;
    return { ok: true, decision: 'reject', reason };
  }
  if (salary >= demand) {
    p.extension = { salary, years };
    delete p.extTalksFailed;
    delete league.extensionTalks[playerId];
    p.morale = Math.round(clamp((p.morale ?? 50) + 6, 0, 100) * 10) / 10;
    pushNews(league, { day: league.dayIndex, category: 'signing', teamIds: [team.id], text: `${p.name} signs a ${years}-year, ${fmtM(salary)}/yr extension with the ${team.city} ${team.name}.` });
    return { ok: true, decision: 'accept', reason: `${p.name} signs: ${fmtM(salary)}/yr x ${years}yr, starting next season.` };
  }
  const entry = { best: Math.max(talks?.best ?? 0, salary) };
  let reason;
  if (salary >= demand * 0.85) {
    const pref = preferredYears(p);
    const counterSalary = extensionDemand(league, teamId, p, pref);
    if (counterSalary !== null) {
      entry.counter = { salary: counterSalary, years: pref };
      reason = `${p.name} counters: ${fmtM(counterSalary)}/yr x ${pref}yr.`;
    }
  }
  if (!reason) {
    reason = years < preferredYears(p)
      ? `${p.name} is looking for a longer commitment (${preferredYears(p)} years).`
      : `${p.name} is holding out for more money.`;
  }
  league.extensionTalks[playerId] = entry;
  return { ok: true, decision: entry.counter ? 'counter' : 'reject', reason, counter: entry.counter };
}

// Each AI front office reviews its expiring contracts once a season, on a
// team-specific day in the middle of the schedule (so extension news
// trickles in rather than flooding a single day). Quality players mostly
// extend — the same retention odds as the offseason re-sign window; when
// the office passes instead, the player is flagged to test the market.
function aiExtensions(league, rng) {
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    const reviewDay = 40 + ((team.id.charCodeAt(0) * 5 + team.id.charCodeAt(1) * 11 + team.id.charCodeAt(2) * 23) % 60);
    if (league.dayIndex !== reviewDay) continue;
    for (const p of team.roster) {
      if (!extensionEligible(p) || p.age >= 36) continue;
      if (rng() >= resignChance(team, p)) { p.extTalksFailed = true; continue; }
      const years = preferredYears(p);
      const demand = extensionDemand(league, team.id, p, years);
      if (demand === null) continue; // player won't extend now; the offseason window may still keep him
      if (payroll(team) - p.contract.salary + demand > LUXURY_TAX) continue;
      p.extension = { salary: demand, years };
      p.morale = Math.round(clamp((p.morale ?? 50) + 6, 0, 100) * 10) / 10;
      if (overall(p) >= 70) {
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
  if (team.roster.length >= ROSTER_MAX) return { ok: false, error: 'Roster full (15). Waive someone first.' };
  const room = SALARY_CAP - payroll(team);
  if (salary > room && salary > MIN_SALARY) {
    return { ok: false, error: `Not enough cap room (${fmtM(Math.max(room, 0))} available). Minimum contracts can always be offered.` };
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
    return { ok: true, decision: 'accept', reason: `${p.name} accepts: ${fmtM(salary)} x ${years}yr!` };
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

export function releasePlayer(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  const idx = team.roster.findIndex((p) => p.id === playerId);
  if (idx === -1) return false;
  const p = team.roster.splice(idx, 1)[0];
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
