import { TEAMS, SALARY_CAP, MIN_SALARY, MAX_SALARY, ROSTER_MAX } from '../data/teams.js';
import { makeRng, randInt, clamp, gauss } from './rng.js';
import { generatePlayer, resetPlayerIds, emptyStats, developPlayer, overall, salaryFor, assignOrigin } from './players.js';
import { simGame, applyBoxToStats, encodeBox } from './sim.js';
import { initDraft } from './draft.js';
import { evaluateStrategies, maybeAiTrade } from './strategy.js';
import { autoLineup } from './lineup.js';

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
      const p = generatePlayer(rng);
      p.contract = null;
      return p;
    }),
    news: [{ day: 0, text: `Welcome, GM! You're now running the ${TEAMS.find(t => t.id === userTeamId).city} ${TEAMS.find(t => t.id === userTeamId).name}.` }],
    history: [],
  };
  // Only the user's lineup persists; AI teams auto-set theirs every game
  getTeam(league, userTeamId).lineup = autoLineup(getTeam(league, userTeamId).roster);
  evaluateStrategies(league);
  return league;
}

function makeRoster(rng) {
  const roster = [];
  // ensure positional coverage: 2 of each position + 4 random
  const positions = ['PG', 'PG', 'SG', 'SG', 'SF', 'SF', 'PF', 'PF', 'C', 'C'];
  for (const pos of positions) roster.push(generatePlayer(rng, { pos }));
  for (let i = 0; i < 4; i++) roster.push(generatePlayer(rng));
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
  };
  for (const team of league.teams) team.roster.forEach(fill);
  league.freeAgents.forEach(fill);
  league.draft?.prospects?.forEach(fill);
  // Saves predating front-office strategies
  if (league.teams.some((t) => !t.strategy)) evaluateStrategies(league);
  // Saves predating lineups
  const user = getTeam(league, league.userTeamId);
  if (!user.lineup) user.lineup = autoLineup(user.roster);
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
    if (r.homePts > r.awayPts) { home.wins++; away.losses++; }
    else { away.wins++; home.losses++; }
    results.push({ ...g, homePts: r.homePts, awayPts: r.awayPts, homeBox: r.homeBox, awayBox: r.awayBox });
  }
  if (!league.resultsByDay) league.resultsByDay = []; // saves predating this field
  // box scores persist in compact array form (see BOX_COLS in sim.js) so a
  // full season of them stays around ~1MB of localStorage; resultsByDay
  // resets every season, so they don't pile up across years
  league.resultsByDay[league.dayIndex] = results.map(({ home, away, homePts, awayPts, homeBox, awayBox }) => ({
    home, away, homePts, awayPts, homeBox: encodeBox(homeBox), awayBox: encodeBox(awayBox),
  }));
  maybeAiTrade(league, rng);
  league.dayIndex += 1;
  if (league.dayIndex >= league.schedule.length) {
    league.phase = 'playoffs';
    league.playoffs = initPlayoffs(league);
    league.news.unshift({ day: league.dayIndex, text: 'The regular season is over. Playoffs begin!' });
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
function seriesHomeTeam(m, gameIdx) {
  return [m.high, m.high, m.low, m.low, m.high, m.low, m.high][gameIdx];
}

// Sim one game in every unfinished series of the current round; advance the
// round only once all its series are decided.
export function simPlayoffGame(league) {
  const po = league.playoffs;
  if (!po || po.champion) return;
  po.gamesPlayed = po.gamesPlayed || 0; // also covers saves predating this field
  const rng = makeRng(league.seed + 999_983 + po.round * 31 + po.gamesPlayed * 101);

  const playGame = (m) => {
    if (!m || m.winner) return;
    const homeId = seriesHomeTeam(m, m.highWins + m.lowWins);
    const awayId = homeId === m.high ? m.low : m.high;
    const r = simGame(getTeam(league, homeId), getTeam(league, awayId), rng);
    if (!m.games) m.games = [];
    m.games.push({ home: homeId, away: awayId, homePts: r.homePts, awayPts: r.awayPts });
    po.gamesPlayed += 1;
    const highWon = (r.homePts > r.awayPts) === (homeId === m.high);
    if (highWon) m.highWins += 1; else m.lowWins += 1;
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
      league.news.unshift({ day: league.dayIndex, text: `🏆 The ${champ.city} ${champ.name} are NBA Champions!` });
      league.phase = 'offseason';
    }
  }
}

function advanceRound(po, league) {
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
export function advanceOffseason(league) {
  const rng = makeRng(league.seed + league.season * 104729);
  league.history.push({
    season: league.season,
    champion: league.playoffs?.champion || null,
    userRecord: `${getTeam(league, league.userTeamId).wins}-${getTeam(league, league.userTeamId).losses}`,
  });

  const expiring = [];
  for (const team of league.teams) {
    for (const p of team.roster) {
      // archive season stats
      if (p.stats.gp > 0) p.careerStats.push({ season: league.season, ...p.stats });
      p.stats = emptyStats();
      developPlayer(p, rng);
      if (p.contract) {
        p.contract.years -= 1;
        if (p.contract.years <= 0) {
          p.contract = null;
          expiring.push({ team, p });
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

  // Expiring contracts → free agency (or quiet retirement)
  for (const { team, p } of expiring) {
    team.roster = team.roster.filter((x) => x.id !== p.id);
    if (p.age > 38 || overall(p) < 40) continue; // retire quietly
    league.freeAgents.push(p);
  }

  // Age free agents, drop retirees, top up the pool
  league.freeAgents = league.freeAgents.filter((p) => {
    developPlayer(p, rng);
    return p.age <= 38 && overall(p) >= 38;
  });
  while (league.freeAgents.length < 50) {
    const p = generatePlayer(rng, { age: randInt(19, 30, rng) });
    p.contract = null;
    league.freeAgents.push(p);
  }
  league.freeAgents.sort((a, b) => overall(b) - overall(a));

  // Front offices reassess direction each summer
  const labels = { contending: 'win-now mode', rebuilding: 'a full rebuild', retooling: 'a retool' };
  for (const { team, to } of evaluateStrategies(league)) {
    if (team.id === league.userTeamId) continue;
    league.news.unshift({ day: 0, text: `The ${team.name} front office shifts to ${labels[to]}.` });
  }

  league.season += 1;
  // Draft first, then free agency (finishDraft opens it)
  initDraft(league, rng);
  league.phase = 'draft';
  league.news.unshift({ day: 0, text: `Welcome to the ${league.season} offseason. The draft is up first, then free agency.` });
}

// AI teams pursue free agents each FA round, negotiating under the same
// preference rules as the user: a player can turn a team down, so each team
// works down a short target list.
export function simFreeAgencyDay(league) {
  const rng = makeRng(league.seed + league.season * 31 + league.faDaysLeft);
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    if (team.roster.length >= ROSTER_MAX) continue;
    if (rng() > 0.6) continue;
    const room = SALARY_CAP - payroll(team);
    for (let attempt = 0; attempt < 3; attempt++) {
      const affordable = league.freeAgents.filter((p) => askingPrice(p) <= Math.max(room, MIN_SALARY));
      if (!affordable.length) break;
      const target = affordable[Math.floor(Math.pow(rng(), 2) * Math.min(affordable.length, 10))];
      const years = preferredYears(target);
      const demand = offerDemand(league, team.id, target, years);
      // how far above asking price this front office will stretch
      const maxPay = Math.max(askingPrice(target) * (1 + rng() * 0.3), MIN_SALARY);
      if (demand === null || demand > maxPay || (demand > room && demand > MIN_SALARY)) continue;
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

// Salary at which this player accepts `years` from this team, or null if
// no amount of money will do (role-blocked star).
export function offerDemand(league, teamId, p, years) {
  const team = getTeam(league, teamId);
  if (roleBlocked(team, p)) return null;
  const o = overall(p);
  let mult = greed(p);
  const winPct = (team.lastWins ?? 41) / 82;
  const caresAboutWinning = clamp((o - 60) / 25, 0, 1);
  mult *= clamp(1 + caresAboutWinning * (0.55 - winPct), 0.85, 1.3);
  if (o >= 65 && betterAtPosition(team, p) >= 2) mult *= 1.15;
  const pref = preferredYears(p);
  if (years < pref) mult *= 1 + 0.08 * (pref - years);
  else if (years > pref) mult *= Math.max(0.9, 1 - 0.03 * (years - pref));
  const sal = Math.round((askingPrice(p) * mult) / 100_000) * 100_000;
  return clamp(sal, MIN_SALARY, MAX_SALARY);
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
    league.news.unshift({ day: 0, text: `${p.name} broke off negotiations with you to sign elsewhere.` });
  }
  if (league.negotiations) delete league.negotiations[playerId];
  league.news.unshift({ day: 0, text: `${p.name} signs with the ${team.city} ${team.name} (${fmtM(p.contract.salary)} x ${p.contract.years}yr).` });
  return true;
}

export function releasePlayer(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  const idx = team.roster.findIndex((p) => p.id === playerId);
  if (idx === -1) return false;
  const p = team.roster.splice(idx, 1)[0];
  if (p.contract) {
    if (!team.deadMoney) team.deadMoney = []; // saves predating this field
    team.deadMoney.push({ playerName: p.name, salary: p.contract.salary, years: p.contract.years });
  }
  p.contract = null;
  league.freeAgents.push(p);
  league.freeAgents.sort((a, b) => overall(b) - overall(a));
  league.news.unshift({ day: 0, text: `The ${team.name} waive ${p.name}.` });
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
  league.schedule = makeSchedule(league.teams, rng);
  league.dayIndex = 0;
  league.resultsByDay = [];
  league.phase = 'regular';
  league.playoffs = null;
  league.news.unshift({ day: 0, text: `The ${league.season} season begins!` });
}
