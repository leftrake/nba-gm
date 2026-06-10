import { TEAMS } from '../data/teams.js';
import { makeRng, randInt, clamp, gauss } from './rng.js';
import { generatePlayer, resetPlayerIds, emptyStats, developPlayer, overall, salaryFor } from './players.js';
import { simGame, applyBoxToStats } from './sim.js';

export function createLeague(userTeamId, seed = Date.now()) {
  const rng = makeRng(seed);
  resetPlayerIds(1);

  const teams = TEAMS.map((t) => ({
    ...t,
    roster: makeRoster(rng),
    wins: 0,
    losses: 0,
  }));

  return {
    seed,
    season: 2026,
    userTeamId,
    teams,
    schedule: makeSchedule(teams, rng),
    dayIndex: 0,
    resultsByDay: [],
    phase: 'regular', // regular | playoffs | offseason | freeagency
    playoffs: null,
    freeAgents: Array.from({ length: 60 }, () => {
      const p = generatePlayer(rng);
      p.contract = null;
      return p;
    }),
    news: [{ day: 0, text: `Welcome, GM! You're now running the ${TEAMS.find(t => t.id === userTeamId).city} ${TEAMS.find(t => t.id === userTeamId).name}.` }],
    history: [],
  };
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

// Schedule day N falls on Oct 21 + N of the year before `season`
// (a season labeled 2026 runs Oct 2025 – spring 2026).
export function dateForDay(league, dayIndex) {
  return new Date(league.season - 1, 9, 21 + dayIndex);
}

export function payroll(team) {
  return team.roster.reduce((s, p) => s + (p.contract?.salary || 0), 0);
}

// Simulate one day of games. Returns results.
export function simDay(league) {
  if (league.phase !== 'regular' || league.dayIndex >= league.schedule.length) return [];
  const rng = makeRng(league.seed + league.dayIndex * 7919 + 13);
  const results = [];
  for (const g of league.schedule[league.dayIndex]) {
    const home = getTeam(league, g.home);
    const away = getTeam(league, g.away);
    const r = simGame(home.roster, away.roster, rng);
    applyBoxToStats(home.roster, r.homeBox);
    applyBoxToStats(away.roster, r.awayBox);
    if (r.homePts > r.awayPts) { home.wins++; away.losses++; }
    else { away.wins++; home.losses++; }
    results.push({ ...g, homePts: r.homePts, awayPts: r.awayPts });
  }
  if (!league.resultsByDay) league.resultsByDay = []; // saves predating this field
  league.resultsByDay[league.dayIndex] = results;
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
  return order.map(([a, b]) => ({ high: seeds[a], low: seeds[b], highWins: 0, lowWins: 0, winner: null }));
}

export function simPlayoffRound(league) {
  const po = league.playoffs;
  if (!po || po.champion) return;
  const rng = makeRng(league.seed + 999_983 + po.round * 31);

  const playSeries = (m) => {
    while (m.highWins < 4 && m.lowWins < 4) {
      const home = getTeam(league, m.high);
      const away = getTeam(league, m.low);
      const r = simGame(home.roster, away.roster, rng);
      if (r.homePts > r.awayPts) m.highWins++; else m.lowWins++;
    }
    m.winner = m.highWins === 4 ? m.high : m.low;
    po.log.push(`${getTeam(league, m.winner).name} win series ${Math.max(m.highWins, m.lowWins)}-${Math.min(m.highWins, m.lowWins)}`);
  };

  if (po.round < 3) {
    for (const conf of ['East', 'West']) {
      po[conf].forEach(playSeries);
      if (po[conf].length > 1) {
        const winners = po[conf].map((m) => m.winner);
        const next = [];
        for (let i = 0; i < winners.length; i += 2) {
          next.push({ high: winners[i], low: winners[i + 1], highWins: 0, lowWins: 0, winner: null });
        }
        po[conf] = next;
      }
    }
    if (po.East.length === 1 && po.East[0].winner && po.West.length === 1 && po.West[0].winner) {
      po.finals = { high: po.East[0].winner, low: po.West[0].winner, highWins: 0, lowWins: 0, winner: null };
      po.round = 3;
    } else {
      po.round += 1;
    }
  } else if (po.finals && !po.finals.winner) {
    playSeries(po.finals);
    po.champion = po.finals.winner;
    const champ = getTeam(league, po.champion);
    league.news.unshift({ day: league.dayIndex, text: `🏆 The ${champ.city} ${champ.name} are NBA Champions!` });
    league.phase = 'offseason';
  }
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
    team.wins = 0;
    team.losses = 0;
  }

  // Expiring contracts → free agency
  for (const { team, p } of expiring) {
    if (p.age > 38 || overall(p) < 40) continue; // retire quietly
    team.roster = team.roster.filter((x) => x.id !== p.id);
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

  league.season += 1;
  league.phase = 'freeagency';
  league.faDaysLeft = 5;
  league.news.unshift({ day: 0, text: `Welcome to the ${league.season} offseason. Free agency is open for 5 rounds of signings.` });
}

// AI teams sign free agents each FA day
export function simFreeAgencyDay(league) {
  const rng = makeRng(league.seed + league.season * 31 + league.faDaysLeft);
  const CAP = 141_000_000;
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    if (team.roster.length >= 15) continue;
    if (rng() > 0.6) continue;
    const room = CAP - payroll(team);
    const affordable = league.freeAgents.filter((p) => askingPrice(p) <= Math.max(room, 1_200_000));
    if (!affordable.length) continue;
    const target = affordable[Math.floor(Math.pow(rng(), 2) * Math.min(affordable.length, 10))];
    signFreeAgent(league, team.id, target.id);
  }
  league.faDaysLeft -= 1;
  if (league.faDaysLeft <= 0) startNewSeason(league);
}

export function askingPrice(p) {
  return salaryFor(overall(p), p.age);
}

export function signFreeAgent(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  const idx = league.freeAgents.findIndex((p) => p.id === playerId);
  if (idx === -1 || team.roster.length >= 15) return false;
  const p = league.freeAgents[idx];
  p.contract = { salary: askingPrice(p), years: clamp(Math.round(gauss(2.5, 1)), 1, 4) };
  league.freeAgents.splice(idx, 1);
  team.roster.push(p);
  league.news.unshift({ day: 0, text: `${p.name} signs with the ${team.city} ${team.name} ($${(p.contract.salary / 1e6).toFixed(1)}M x ${p.contract.years}yr).` });
  return true;
}

export function releasePlayer(league, teamId, playerId) {
  const team = getTeam(league, teamId);
  const idx = team.roster.findIndex((p) => p.id === playerId);
  if (idx === -1) return false;
  const p = team.roster.splice(idx, 1)[0];
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
  league.schedule = makeSchedule(league.teams, rng);
  league.dayIndex = 0;
  league.resultsByDay = [];
  league.phase = 'regular';
  league.playoffs = null;
  league.news.unshift({ day: 0, text: `The ${league.season} season begins!` });
}
