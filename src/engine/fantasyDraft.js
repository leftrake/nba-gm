import { MIN_SALARY, MAX_SALARY } from '../data/teams.js';
import { makeRng, randInt, gauss, clamp } from './rng.js';
import { generatePlayer, resetPlayerIds, overall, salaryFor } from './players.js';
import { autoLineup } from './lineup.js';
import { evaluateStrategies } from './strategy.js';
import { ensureDraftPicks } from './draftPicks.js';
import { pushNews } from './save.js';
import { getTeam, payrollCalibrationTarget } from './league.js';

// ---------- Fantasy Draft ----------
// An alternative new-game mode: every player from all 30 rosters plus the
// usual free-agent pool is pooled together, and the user snake-drafts their
// roster from scratch against 29 AI teams. One pick per roster spot
// (ROSTER_MAX = 15), so 15 rounds * 30 teams = 450 picks; the pool is sized
// larger so leftovers seed free agency afterward.

export const FANTASY_ROUNDS = 15;
const PICKS_PER_ROUND = 30;

// Same talent pyramid as makeRoster (league.js), with one extra bench tier
// so 15 players come out of each "team's worth" of the pool.
const POOL_TIERS = [
  [81, 10], [75, 8], [71, 7], [67, 6], [67, 6], [63, 6], [63, 6],
  [57, 6], [57, 6], [57, 6], [48, 6], [48, 6], [48, 6], [48, 6], [45, 6],
];
const FRINGE_COUNT = 90; // extra players beyond the 450 that get drafted

// 540-player pool: 30 * 15 tiered players plus a tail of fringe free agents.
export function generateFantasyPool(rng) {
  const pool = [];
  for (let i = 0; i < 30; i++) {
    for (const [mean, spread] of POOL_TIERS) {
      const age = Math.min(randInt(19, 36, rng), randInt(19, 36, rng));
      const ageAdj = age <= 24 ? -4 : age <= 32 ? 6 : 2;
      const p = generatePlayer(rng, {
        age,
        base: clamp(gauss(mean + ageAdj, spread, rng), 35, 90),
      });
      p.contract = null;
      pool.push(p);
    }
  }
  for (let i = 0; i < FRINGE_COUNT; i++) {
    const p = generatePlayer(rng, { base: clamp(gauss(48, 8, rng), 35, 72) });
    p.contract = null;
    pool.push(p);
  }
  pool.sort((a, b) => overall(b) - overall(a));
  return pool;
}

// Sets up league.fantasyDraft: a randomized snake order (so the user's slot
// isn't fixed) and the combined player pool.
export function initFantasyDraft(league, rng) {
  // The player-id counter (players.js) is a module-level variable that
  // doesn't survive a save load — it always restarts at 1. Mirror
  // initDraft's guard here: push it past every id already on a roster or
  // in free agency before minting the 540-player fantasy pool, so a fantasy
  // draft can never hand out ids that collide with existing players.
  const maxId = Math.max(
    0,
    ...league.teams.flatMap((t) => t.roster.map((p) => p.id)),
    ...league.freeAgents.map((p) => p.id),
  );
  resetPlayerIds(maxId + 1);

  const teamIds = league.teams.map((t) => t.id);
  const shuffled = [...teamIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const order = [];
  for (let round = 0; round < FANTASY_ROUNDS; round++) {
    order.push(...(round % 2 === 0 ? shuffled : [...shuffled].reverse()));
  }
  league.fantasyDraft = {
    order,
    pickIndex: 0,
    pool: generateFantasyPool(rng),
    results: [], // { pick, round, teamId, playerId, playerName, pos, ovr, age }
  };
}

// Team id currently on the clock, or null if the draft is over (or not running)
export function onFantasyClock(league) {
  const d = league.fantasyDraft;
  if (!d || d.pickIndex >= d.order.length) return null;
  return d.order[d.pickIndex];
}

// Need multiplier: teams want at least a couple of players at every
// position before stacking up on any one of them.
function teamNeedScore(team, pos) {
  let count = 0;
  for (const p of team.roster) if (p.pos === pos) count++;
  if (count === 0) return 1.25;
  if (count === 1) return 1.12;
  if (count === 2) return 1.0;
  if (count === 3) return 0.92;
  return 0.8;
}

function avgAge(team) {
  if (!team.roster.length) return 27;
  return team.roster.reduce((s, p) => s + p.age, 0) / team.roster.length;
}

// Draft a pool player for the team on the clock. Used by the user's big
// board, AI picks, and the auto-pick button.
export function makeFantasyPick(league, playerId) {
  const d = league.fantasyDraft;
  const teamId = onFantasyClock(league);
  if (!teamId) return null;
  const idx = d.pool.findIndex((p) => p.id === playerId);
  if (idx === -1) return null;
  const p = d.pool.splice(idx, 1)[0];
  const team = getTeam(league, teamId);
  const pick = d.pickIndex + 1;
  team.roster.push(p);
  d.results.push({
    pick, round: Math.floor(d.pickIndex / PICKS_PER_ROUND) + 1,
    teamId, playerId: p.id, playerName: p.name, pos: p.pos, ovr: overall(p), age: p.age,
  });
  d.pickIndex += 1;
  if (teamId === league.userTeamId) {
    pushNews(league, { day: 0, category: 'draft', teamIds: [team.id], text: `Fantasy draft pick #${pick}: the ${team.name} select ${p.name} (${p.pos}, ${p.age}, ${overall(p)} ovr).` });
  }
  return p;
}

// Shared need+value scoring used by both AI picks and the auto-pick button.
function bestPick(league, team, rng) {
  const d = league.fantasyDraft;
  const age = avgAge(team);
  let best = null;
  let bestVal = -Infinity;
  for (const p of d.pool) {
    let v = overall(p) * 0.55 + p.potential * 0.35;
    if (rng) v += gauss(0, 2.5, rng);
    v *= teamNeedScore(team, p.pos);
    if (age > 27.5 && p.age <= 25) v += 2;
    if (age < 25 && p.age >= 28) v += 2;
    if (v > bestVal) { bestVal = v; best = p; }
  }
  return best;
}

// One AI pick: the team on the clock takes the best fit by need+value, with
// per-pick noise so the draft isn't a pure ranking. No-op (returns null) if
// the draft is over or the user is on the clock — their picks come from the
// big board.
export function simFantasyPick(league) {
  const d = league.fantasyDraft;
  if (!d || d.pickIndex >= d.order.length || d.order[d.pickIndex] === league.userTeamId) return null;
  const team = getTeam(league, d.order[d.pickIndex]);
  const rng = makeRng(league.seed + d.pickIndex * 7919);
  const best = bestPick(league, team, rng);
  return best ? makeFantasyPick(league, best.id) : null;
}

// AI picks until the current round ends, pausing if the user comes on the clock.
export function simFantasyRound(league) {
  const d = league.fantasyDraft;
  if (!d) return;
  const round = Math.floor(d.pickIndex / PICKS_PER_ROUND);
  const end = Math.min((round + 1) * PICKS_PER_ROUND, d.order.length);
  while (d.pickIndex < end && simFantasyPick(league)) {}
}

// AI picks until the user is on the clock or the draft ends
export function simFantasyToUser(league) {
  while (simFantasyPick(league)) {}
}

// Picks the recommended player for whoever is on the clock, including the
// user — the "Auto-Pick for Me" button.
export function autoFantasyPick(league) {
  const d = league.fantasyDraft;
  const teamId = onFantasyClock(league);
  if (!teamId) return null;
  if (teamId !== league.userTeamId) return simFantasyPick(league);
  const team = getTeam(league, teamId);
  const best = bestPick(league, team, null);
  return best ? makeFantasyPick(league, best.id) : null;
}

// Leftover pool players join free agency, drafted rosters get contracts
// scaled toward the cap, and the league drops into the normal season.
export function finishFantasyDraft(league) {
  const d = league.fantasyDraft;
  const rng = makeRng(league.seed + 99_991);

  league.freeAgents = d.pool.sort((a, b) => overall(b) - overall(a));
  for (const p of league.freeAgents) p.faRoundsUnsigned = 0;

  for (const team of league.teams) {
    for (const p of team.roster) {
      p.contract = { salary: salaryFor(overall(p), p.age), years: randInt(1, 4, rng) };
    }
    const target = payrollCalibrationTarget(rng);
    for (let pass = 0; pass < 3; pass++) {
      const total = team.roster.reduce((s, p) => s + p.contract.salary, 0);
      const factor = target / total;
      if (Math.abs(factor - 1) < 0.02) break;
      for (const p of team.roster) {
        p.contract.salary = clamp(
          Math.round((p.contract.salary * factor) / 100_000) * 100_000,
          MIN_SALARY, MAX_SALARY,
        );
      }
    }
  }

  league.fantasyDraftResults = d.results;
  league.fantasyDraftOrder = d.order.slice(0, PICKS_PER_ROUND);

  getTeam(league, league.userTeamId).lineup = autoLineup(getTeam(league, league.userTeamId).roster);
  evaluateStrategies(league);
  ensureDraftPicks(league);

  league.fantasyDraft = null;
  league.phase = 'regular';
  pushNews(league, { day: 0, category: 'league', major: true, text: `The fantasy draft is complete. All 30 rosters have been built from scratch — good luck, GM!` });
}
