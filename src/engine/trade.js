import { overall } from './players.js';
import { getTeam, payroll } from './league.js';
import { SALARY_CAP } from '../data/teams.js';
import { pushNews } from './save.js';
import { clamp } from './rng.js';
import { bumpTurmoil } from './morale.js';
import { pickValue, pickLabel, violatesStepien } from './draftPicks.js';

// Trade value: overall matters most, youth and contract length matter too.
// Pass a front-office strategy ('contending' | 'rebuilding' | 'retooling')
// to value the player through that team's lens; omit it for a neutral view.
export function tradeValue(p, strategy) {
  const ovr = overall(p);
  let v = Math.pow(Math.max(ovr - 40, 1), 2.4);
  // youth premium / age discount
  if (p.age <= 23) v *= 1.5;
  else if (p.age <= 26) v *= 1.2;
  else if (p.age >= 32) v *= 0.6;
  else if (p.age >= 30) v *= 0.8;
  // potential premium
  const upside = Math.max(0, p.potential - ovr);
  v *= 1 + upside * 0.02;
  // bad contract discount
  if (p.contract && p.contract.salary > 30_000_000 && ovr < 75) v *= 0.7;
  // a player who has publicly demanded a trade has sharply reduced value
  if (p.tradeDemand) v *= 0.5;
  if (strategy === 'rebuilding') {
    // youth and upside are the whole point; veterans are trade bait
    if (p.age <= 25) v *= 1.2;
    else if (p.age >= 30) v *= 0.7;
    else if (p.age >= 28) v *= 0.85;
    v *= 1 + upside * 0.012;
  } else if (strategy === 'contending') {
    // proven production now beats upside later
    if (ovr >= 75) v *= 1.15;
    else if (ovr >= 68) v *= 1.08;
    if (p.age <= 23 && ovr < 66) v *= 0.75;
    v /= 1 + upside * 0.008;
  }
  return Math.round(v);
}

// Validate a trade under simplified cap rules. Draft picks don't count
// toward roster size or salary matching — only toward whether the trade is
// non-empty.
export function validateTrade(league, teamAId, playersAIds, teamBId, playersBIds, picksAIds = [], picksBIds = []) {
  const a = getTeam(league, teamAId);
  const b = getTeam(league, teamBId);
  if (!playersAIds.length && !playersBIds.length && !picksAIds.length && !picksBIds.length) return { ok: false, reason: 'Empty trade.' };

  const outA = a.roster.filter((p) => playersAIds.includes(p.id));
  const outB = b.roster.filter((p) => playersBIds.includes(p.id));

  const newSizeA = a.roster.length - outA.length + outB.length;
  const newSizeB = b.roster.length - outB.length + outA.length;
  if (newSizeA > 15 || newSizeB > 15) return { ok: false, reason: 'A team would exceed 15 players.' };
  if (newSizeA < 8 || newSizeB < 8) return { ok: false, reason: 'A team would drop below 8 players.' };

  // Salary matching: if over the cap after trade, incoming salary <= 125% outgoing + 250k
  const salOutA = outA.reduce((s, p) => s + p.contract.salary, 0);
  const salOutB = outB.reduce((s, p) => s + p.contract.salary, 0);
  const check = (team, salOut, salIn) => {
    const newPayroll = payroll(team) - salOut + salIn;
    if (newPayroll > SALARY_CAP && salIn > salOut * 1.25 + 250_000) return false;
    return true;
  };
  if (!check(a, salOutA, salOutB)) return { ok: false, reason: `${a.name} fail salary matching (over the cap, taking back too much).` };
  if (!check(b, salOutB, salOutA)) return { ok: false, reason: `${b.name} fail salary matching (over the cap, taking back too much).` };

  return { ok: true };
}

// AI decision: does team B accept? Both sides of the deal are valued
// through B's strategy lens, and some deals are vetoed outright because
// they don't fit the strategy, no matter how fair the value is.
export function aiEvaluateTrade(league, teamBId, incoming, outgoing, incomingPicks = [], outgoingPicks = []) {
  const team = getTeam(league, teamBId);
  const strategy = team.strategy || 'retooling';
  const veto = strategyVeto(team, strategy, incoming, outgoing);
  if (veto) return { accept: false, ratio: 0, reason: veto };
  if (violatesStepien(league, teamBId, outgoingPicks.map((p) => p.id))) {
    return { accept: false, ratio: 0, reason: `The ${team.name} won't trade away first-round picks in consecutive years.` };
  }
  const valueIn = incoming.reduce((s, p) => s + tradeValue(p, strategy), 0)
    + incomingPicks.reduce((s, p) => s + pickValue(league, p, strategy), 0);
  const valueOut = outgoing.reduce((s, p) => s + tradeValue(p, strategy), 0)
    + outgoingPicks.reduce((s, p) => s + pickValue(league, p, strategy), 0);
  if (valueOut === 0) return { accept: valueIn > 0, ratio: Infinity };
  const ratio = valueIn / valueOut;
  // AI wants at least ~95% value back, with slight team-specific noise
  const greed = 0.92 + ((team.id.charCodeAt(0) + team.id.charCodeAt(2)) % 10) * 0.015;
  return { accept: ratio >= greed, ratio, greed };
}

// Deals a front office won't make at any price.
function strategyVeto(team, strategy, incoming, outgoing) {
  if (strategy === 'contending') {
    const bestIn = Math.max(0, ...incoming.map((p) => overall(p)));
    const star = outgoing.find((p) => overall(p) >= 76 && overall(p) > bestIn + 2);
    if (star) return `The ${team.name} are contending and won't sell ${star.name}.`;
  }
  if (strategy === 'rebuilding') {
    const vet = incoming.find((p) => p.age >= 29 && (p.contract?.salary || 0) > 10_000_000);
    if (vet) return `The ${team.name} are rebuilding and won't take on ${vet.name}'s veteran contract.`;
    const bestYoungIn = Math.max(0, ...incoming.filter((p) => p.age <= 25).map((p) => p.potential));
    const keeper = outgoing.find((p) => p.age <= 23 && p.potential >= 76 && p.potential > bestYoungIn + 2);
    if (keeper) return `The ${team.name} are rebuilding around ${keeper.name} and won't move him.`;
  }
  return null;
}

export function executeTrade(league, teamAId, playersAIds, teamBId, playersBIds, picksAIds = [], picksBIds = []) {
  const a = getTeam(league, teamAId);
  const b = getTeam(league, teamBId);
  const outA = a.roster.filter((p) => playersAIds.includes(p.id));
  const outB = b.roster.filter((p) => playersBIds.includes(p.id));
  a.roster = a.roster.filter((p) => !playersAIds.includes(p.id)).concat(outB);
  b.roster = b.roster.filter((p) => !playersBIds.includes(p.id)).concat(outA);
  // failed extension talks don't follow a player to a new front office
  // (signed extensions do, like any contract)
  for (const p of [...outA, ...outB]) {
    delete p.extTalksFailed;
    // a fresh start: any trade demand is resolved, and morale nudges toward neutral
    p.tradeDemand = false;
    p.tradeDemandTeam = null;
    p.moraleLowStreak = 0;
    p.morale = Math.round(clamp((p.morale ?? 50) * 0.6 + 20, 0, 100) * 10) / 10;
  }
  const picksA = picksAIds.map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
  const picksB = picksBIds.map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
  for (const pick of picksA) pick.teamId = teamBId;
  for (const pick of picksB) pick.teamId = teamAId;
  bumpTurmoil(a);
  bumpTurmoil(b);
  const names = (ps, picks) => [...ps.map((p) => p.name), ...picks.map((p) => pickLabel(p))].join(', ') || 'nothing';
  pushNews(league, {
    day: league.dayIndex,
    category: 'trade',
    teamIds: [a.id, b.id],
    // a star changing hands makes it a blockbuster
    major: [...outA, ...outB].some((p) => overall(p) >= 80),
    text: `TRADE: ${a.name} send ${names(outA, picksA)} to the ${b.name} for ${names(outB, picksB)}.`,
  });
}
