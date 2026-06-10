import { TEAMS } from '../data/teams.js';
import { makeRng, randInt, clamp, gauss } from './rng.js';
import { generatePlayer, resetPlayerIds, emptyStats, developPlayer, overall, salaryFor } from './players.js';
import { simGame, applyBoxToStats } from './sim.js';

export const GAMES_PER_TEAM = 82;

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

// Each team plays 82 games
export function makeSchedule(teams, rng) {
  const games = [];
  const counts = Object.fromEntries(teams.map((t) => [t.id, 0]));
  const ids = teams.map((t) => t.id);

  // Base: everyone plays everyone twice (58 games), then fill to 82 with random matchups
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      games.push({ home: ids[i], away: ids[j] });
      games.push({ home: ids[j], away: ids[i] });
      counts[ids[i]] += 2;
      counts[ids[j]] += 2;
    }
  }
  let guard = 0;
  while (guard++ < 20000) {
    const need = ids.filter((id) => counts[id] < GAMES_PER_TEAM);
    if (need.length < 2) break;
    const a = need[randInt(0, need.length - 1, rng)];
    let b = need[randInt(0, need.length - 1, rng)];
    if (a === b) continue;
    if (rng() > 0.5) games.push({ home: a, away: b });
    else games.push({ home: b, away: a });
    counts[a]++; counts[b]++;
  }

  // Shuffle, then pack into days where no team plays twice
  for (let i = games.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [games[i], games[j]] = [games[j], games[i]];
  }
  const days = [];
  let remaining = games;
  while (remaining.length) {
    const day = [];
    const used = new Set();
    const leftover = [];
    for (const g of remaining) {
      if (day.length < 11 && !used.has(g.home) && !used.has(g.away)) {
        day.push(g);
        used.add(g.home); used.add(g.away);
      } else {
        leftover.push(g);
      }
    }
    days.push(day);
    remaining = leftover;
  }
  return days;
}

export function getTeam(league, id) {
  return league.teams.find((t) => t.id === id);
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
  league.phase = 'regular';
  league.playoffs = null;
  league.news.unshift({ day: 0, text: `The ${league.season} season begins!` });
}
