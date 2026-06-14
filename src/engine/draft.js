import { ROSTER_MAX, MIN_SALARY } from '../data/teams.js';
import { makeRng, randInt, gauss, clamp } from './rng.js';
import { generatePlayer, resetPlayerIds, overall, recordContract } from './players.js';
import { pushNews } from './save.js';
import { ensureDraftPicks, removeDraftedPicks, addFuturePicks, FUTURE_DRAFTS } from './draftPicks.js';

// ---------- NBA Draft ----------
// Runs between the playoffs and free agency. Two rounds of 30 picks: a
// weighted lottery among the 14 worst teams decides the top 4, then both
// rounds proceed in reverse-record order. Prospects are 18–22, so the
// existing scouting fog is at its widest for them — the big board shows
// ranges and grades, never true numbers.

export const DRAFT_ROUNDS = 2;

// 1st-round picks get a 4-year rookie scale deal (so an "RFX" extension in
// year 3 or 4 is meaningful); 2nd-rounders sign for 3.
export function rookieContractYears(pick) {
  return pick <= 30 ? 4 : 3;
}
const CLASS_SIZE = 68; // 60 get drafted; the rest go to free agency

// NBA lottery odds (chances out of 1000) for the 14 lottery seats, worst record first
const LOTTERY_WEIGHTS = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];

// Rookie scale: ~$10M for the #1 pick sliding to the minimum by the end of
// round 1; every second-rounder signs for the minimum.
export function rookieSalary(pickNumber) {
  if (pickNumber > 30) return MIN_SALARY;
  const t = (30 - pickNumber) / 29;
  return Math.round((MIN_SALARY + t * t * 8_800_000) / 100_000) * 100_000;
}

// Every class follows the same talent pyramid: a few future superstars at
// the top, a band of future starters, and role players the rest of the way
// down. Prospects arrive far below their ceiling — the younger they are,
// the wider the gap — and grow into it via developPlayer.
function generateDraftClass(rng) {
  const prospects = [];
  // Sized so the league's talent pyramid holds steady year over year: more
  // superstar/starter prospects than this and star counts inflate the
  // league-wide average rating across seasons.
  const superstars = randInt(1, 3, rng);
  const starters = superstars + randInt(4, 7, rng);
  for (let i = 0; i < CLASS_SIZE; i++) {
    // the better the prospect, the younger he declares
    let age, potential;
    if (i < superstars) { age = randInt(18, 20, rng); potential = randInt(88, 97, rng); }
    else if (i < starters) { age = randInt(18, 21, rng); potential = randInt(76, 87, rng); }
    else { age = randInt(18, 22, rng); potential = Math.round(clamp(gauss(60, 9, rng), 42, 74)); }
    const gap = Math.max(6, (23 - age) * 3.5 + 4 + gauss(0, 3, rng));
    const base = clamp(potential - gap, 30, 76);
    const p = generatePlayer(rng, { age, base, exp: 0, potential });
    p.contract = null; // signs a rookie deal when drafted
    prospects.push(p);
  }
  return prospects;
}

export function initDraft(league, rng) {
  // The player-id counter isn't restored on save load, so freshly generated
  // ids can collide with existing players. Pick results reference prospects
  // by id, so push the counter past everyone currently in the league first.
  const maxId = Math.max(
    0,
    ...league.teams.flatMap((t) => t.roster.map((p) => p.id)),
    ...league.freeAgents.map((p) => p.id),
  );
  resetPlayerIds(maxId + 1);

  // Worst record first; lastWins holds the just-completed season. The
  // sub-1 jitter only breaks ties.
  const byRecord = league.teams
    .map((t) => ({ id: t.id, key: (t.lastWins ?? 41) + rng() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.id);

  // Weighted lottery without replacement among the 14 worst for picks 1–4
  const seats = byRecord.slice(0, 14).map((id, i) => ({ id, w: LOTTERY_WEIGHTS[i] }));
  const top4 = [];
  for (let n = 0; n < 4; n++) {
    let roll = rng() * seats.reduce((s, x) => s + x.w, 0);
    const idx = seats.findIndex((x) => (roll -= x.w) < 0);
    top4.push(seats.splice(idx === -1 ? seats.length - 1 : idx, 1)[0].id);
  }
  const round1 = [...top4, ...byRecord.filter((id) => !top4.includes(id))];
  const round2 = byRecord; // round 2 is straight reverse-record

  // The slot order above is keyed by each team's own record (originalTeamId);
  // resolve each slot to whoever currently owns that team's pick.
  ensureDraftPicks(league);
  const draftSeason = league.season;
  const ownerOf = (round, originalTeamId) => {
    const p = league.draftPicks.find((p) => p.season === draftSeason && p.round === round && p.originalTeamId === originalTeamId);
    return p ? p.teamId : originalTeamId;
  };

  league.draft = {
    season: draftSeason,
    order: [...round1.map((id) => ownerOf(1, id)), ...round2.map((id) => ownerOf(2, id))],
    pickIndex: 0,
    prospects: generateDraftClass(rng),
    results: [], // { pick, round, teamId, playerId, playerName, pos }
  };

  // This draft's picks are consumed; roll the ownership window forward so
  // every team always has FUTURE_DRAFTS years of 1sts and 2nds to trade.
  removeDraftedPicks(league, draftSeason);
  addFuturePicks(league, draftSeason + FUTURE_DRAFTS);

  const winner = league.teams.find((t) => t.id === top4[0]);
  const userPicks = league.draft.order
    .map((id, i) => (id === league.userTeamId ? i + 1 : null))
    .filter((n) => n !== null);
  pushNews(league, {
    day: 0,
    category: 'draft',
    teamIds: [winner.id, league.userTeamId],
    text: `Draft lottery: the ${winner.city} ${winner.name} land the #1 pick. You pick at #${userPicks.join(' and #')}.`,
  });
}

// Team id currently on the clock, or null if the draft is over (or not running)
export function onTheClock(league) {
  const d = league.draft;
  if (!d || d.pickIndex >= d.order.length) return null;
  return d.order[d.pickIndex];
}

// Draft a prospect for the team on the clock. Used by both the AI and the
// user's big board.
export function makeDraftPick(league, prospectId) {
  const d = league.draft;
  const teamId = onTheClock(league);
  if (!teamId) return null;
  const idx = d.prospects.findIndex((p) => p.id === prospectId);
  if (idx === -1) return null;
  const p = d.prospects.splice(idx, 1)[0];
  const team = league.teams.find((t) => t.id === teamId);
  const pick = d.pickIndex + 1;
  p.draftTeam = teamId; // homegrown marker — boosts re-sign odds later
  p.draftYear = d.season;
  p.draftRound = pick <= 30 ? 1 : 2;
  p.draftPick = pick;
  if (team.roster.length < ROSTER_MAX) {
    p.contract = { salary: rookieSalary(pick), years: rookieContractYears(pick) };
    recordContract(p, league.season, team.id, p.contract);
    team.roster.push(p);
  } else {
    // no roster spot — the pick goes unsigned and hits free agency
    league.freeAgents.push(p);
    pushNews(league, { day: 0, category: 'draft', teamIds: [team.id], text: `The ${team.name} draft ${p.name} but have no roster spot; he heads to free agency.` });
  }
  d.results.push({ pick, round: pick <= 30 ? 1 : 2, teamId, playerId: p.id, playerName: p.name, pos: p.pos });
  d.pickIndex += 1;
  if (teamId === league.userTeamId) {
    pushNews(league, { day: 0, category: 'draft', teamIds: [team.id], text: `With pick #${pick}, the ${team.name} select ${p.name} (${p.pos}, ${p.age}).` });
  }
  return p;
}

// One AI pick: the team on the clock takes the best available by a blend of
// current ability and potential, with per-pick noise so the draft isn't a
// pure ranking. No-op (returns null) if the draft is over or the user is on
// the clock — their picks come from the big board.
export function simDraftPick(league) {
  const d = league.draft;
  if (!d || d.pickIndex >= d.order.length || d.order[d.pickIndex] === league.userTeamId) return null;
  const rng = makeRng(league.seed + league.season * 50_111 + d.pickIndex * 37);
  let best = null;
  let bestVal = -Infinity;
  for (const p of d.prospects) {
    const v = overall(p) * 0.5 + p.potential * 0.5 + gauss(0, 2.5, rng);
    if (v > bestVal) { bestVal = v; best = p; }
  }
  return best ? makeDraftPick(league, best.id) : null;
}

// AI picks until the end of the current round, pausing if the user comes on
// the clock.
export function simDraftRound(league) {
  const d = league.draft;
  if (!d) return;
  const end = d.pickIndex < 30 ? 30 : d.order.length;
  while (d.pickIndex < end && simDraftPick(league)) {}
}

// AI picks until the user is on the clock or the draft ends
export function simDraftToUser(league) {
  while (simDraftPick(league)) {}
}

// Undrafted prospects join the free-agent pool; free agency opens.
export function finishDraft(league) {
  const d = league.draft;
  if (d && d.prospects.length) {
    league.freeAgents.push(...d.prospects); // contracts are already null
    d.prospects = [];
    league.freeAgents.sort((a, b) => overall(b) - overall(a));
  }
  league.phase = 'freeagency';
  league.faDaysLeft = 5;
  league.negotiations = {};
  // fresh market: every team gets its mid-level exception back, and asking
  // prices reset to full value at the start of the new offseason
  for (const team of league.teams) team.usedMLE = false;
  for (const p of league.freeAgents) p.faRoundsUnsigned = 0;
  pushNews(league, { day: 0, category: 'league', text: `The draft is complete. Free agency is open for 5 rounds of signings.` });
}
