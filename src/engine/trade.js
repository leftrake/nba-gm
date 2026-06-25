import { overall, recordTransaction } from './players.js';
import { getTeam, payroll, recordSeasonStint, tradesLocked } from './league.js';
import { SALARY_CAP, ROSTER_MAX } from '../data/teams.js';
import { pushNews, recordTrade } from './save.js';
import { clamp } from './rng.js';
import { bumpTurmoil, adjustMorale } from './morale.js';
import { reputationMult, tradedAwayPenalty } from './backstory.js';
import { pickValue, pickLabel, violatesStepien } from './draftPicks.js';
import { teamNeeds } from './strategy.js';
import { applyTradeApprovalEffect } from './owner.js';

// Discount applied to tradeValue for a player currently injured, by
// injury.tier (injuries.js) — used by tradeValue itself, so every AI trade
// path (strategy.js, tradeOffers.js) and the Trade Machine's own valuation
// automatically discount hurt players without needing their own checks.
const INJURY_VALUE_MULT = { dtd: 0.95, minor: 0.85, significant: 0.65, season: 0.4 };

// Tracks the user's biggest trade "win" (received value minus given-up
// value) for the GM legacy tracker — only trades where the user gained.
function recordBestTrade(league, teamId, diff, text) {
  if (teamId !== league.userTeamId) return;
  if (diff > (league.gmLegacy.bestTrade?.valueDiff ?? 0)) {
    league.gmLegacy.bestTrade = { season: league.season, text, valueDiff: diff };
  }
}

// Trade value: overall matters most, youth and contract length matter too.
// Pass a front-office strategy ('contending' | 'rebuilding' | 'retooling')
// to value the player through that team's lens; omit it for a neutral view.
// Pass `team` to additionally weight the player by how well their position
// fits that team's roster: a plus at one of their two thinnest spots is
// worth more, a third-stringer at an already-stacked spot is worth less.
export function tradeValue(p, strategy, team) {
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
  // bad contract discount — a signed extension is what this player actually
  // costs going forward, so value against that salary once it's on the books
  const futureSalary = p.extension ? p.extension.salary : p.contract?.salary;
  if (futureSalary > 30_000_000 && ovr < 75) v *= 0.7;
  // a player who has publicly demanded a trade has sharply reduced value
  if (p.tradeDemand) v *= 0.5;
  // an injured player is worth less the longer they'll be out — nobody
  // trades for a guy who can't play, full stop for a season-ender
  if (p.injury) v *= INJURY_VALUE_MULT[p.injury.tier] ?? 1;
  // a useful secondary position is worth a little extra — versatility
  if (p.pos2) v *= 1.05;
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
  if (team) {
    const { thin } = teamNeeds(team);
    if (thin.some((x) => x.pos === p.pos)) {
      v *= 1.15; // fills one of the team's two thinnest spots
    } else {
      const better = team.roster.filter((x) => x.pos === p.pos && overall(x) > ovr).length;
      if (better >= 2) v *= 0.9; // already two deep at this position
    }
  }
  // once a backstory is public, AI valuations account for it (backstory.js)
  v *= reputationMult(p);
  return Math.round(v);
}

// Validate a trade under simplified cap rules. Draft picks don't count
// toward roster size or salary matching — only toward whether the trade is
// non-empty.
export function validateTrade(league, teamAId, playersAIds, teamBId, playersBIds, picksAIds = [], picksBIds = []) {
  if (tradesLocked(league)) {
    return { ok: false, reason: 'Trades are locked until next offseason.' };
  }
  const a = getTeam(league, teamAId);
  const b = getTeam(league, teamBId);
  if (!playersAIds.length && !playersBIds.length && !picksAIds.length && !picksBIds.length) return { ok: false, reason: 'Empty trade.' };

  const outA = a.roster.filter((p) => playersAIds.includes(p.id));
  const outB = b.roster.filter((p) => playersBIds.includes(p.id));

  const newSizeA = a.roster.length - outA.length + outB.length;
  const newSizeB = b.roster.length - outB.length + outA.length;
  if (newSizeA > ROSTER_MAX || newSizeB > ROSTER_MAX) return { ok: false, reason: `A team would exceed ${ROSTER_MAX} players.` };
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
  const veto = strategyVeto(team, strategy, incoming, outgoing, incomingPicks);
  if (veto) return { accept: false, ratio: 0, reason: veto };
  if (violatesStepien(league, teamBId, outgoingPicks.map((p) => p.id))) {
    return { accept: false, ratio: 0, reason: `The ${team.name} won't trade away first-round picks in consecutive years.` };
  }
  const valueIn = incoming.reduce((s, p) => s + tradeValue(p, strategy, team), 0)
    + incomingPicks.reduce((s, p) => s + pickValue(league, p, strategy), 0);
  const valueOut = outgoing.reduce((s, p) => s + tradeValue(p, strategy, team), 0)
    + outgoingPicks.reduce((s, p) => s + pickValue(league, p, strategy), 0);
  if (valueOut === 0) return { accept: valueIn > 0, ratio: Infinity };
  const ratio = valueIn / valueOut;
  // AI wants at least ~95% value back, with slight team-specific noise
  const greed = 0.92 + ((team.id.charCodeAt(0) + team.id.charCodeAt(2)) % 10) * 0.015;
  return { accept: ratio >= greed, ratio, greed };
}

// Deals a front office won't make at any price.
function strategyVeto(team, strategy, incoming, outgoing, incomingPicks = []) {
  if (strategy === 'contending') {
    const bestIn = Math.max(0, ...incoming.map((p) => overall(p)));
    const star = outgoing.find((p) => overall(p) >= 76 && overall(p) > bestIn + 2);
    if (star) return `The ${team.name} are contending and won't sell ${star.name}.`;
  }
  if (strategy === 'rebuilding') {
    const vet = incoming.find((p) => p.age >= 29 && (p.contract?.salary || 0) > 10_000_000);
    // ...unless they're giving up little or nothing for him — a salary dump
    // with cap room costs a rebuilder nothing, and often comes with a pick.
    const outgoingValue = outgoing.reduce((s, p) => s + tradeValue(p, strategy), 0);
    if (vet && outgoingValue > 0 && !incomingPicks.length) {
      return `The ${team.name} are rebuilding and won't take on ${vet.name}'s veteran contract.`;
    }
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
  for (const p of outA) recordSeasonStint(p, a.id);
  for (const p of outB) recordSeasonStint(p, b.id);
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
  // "One city legend" types take a real morale hit leaving their draft team
  for (const p of outA) adjustMorale(p, tradedAwayPenalty(p, a.id));
  for (const p of outB) adjustMorale(p, tradedAwayPenalty(p, b.id));
  const picksA = picksAIds.map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
  const picksB = picksBIds.map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
  for (const pick of picksA) pick.teamId = teamBId;
  for (const pick of picksB) pick.teamId = teamAId;
  bumpTurmoil(a);
  bumpTurmoil(b);
  a.tradesThisSeason = (a.tradesThisSeason || 0) + 1;
  b.tradesThisSeason = (b.tradesThisSeason || 0) + 1;
  const names = (ps, picks) => [...ps.map((p) => p.name), ...picks.map((p) => pickLabel(p))].join(', ') || 'nothing';
  const tradeText = `${a.name} send ${names(outA, picksA)} to the ${b.name} for ${names(outB, picksB)}.`;
  for (const p of outA) recordTransaction(p, { season: league.season, day: league.dayIndex, type: 'trade', team: b.id, fromTeam: a.id, text: tradeText });
  for (const p of outB) recordTransaction(p, { season: league.season, day: league.dayIndex, type: 'trade', team: a.id, fromTeam: b.id, text: tradeText });
  if (a.owner) {
    const give = outA.reduce((s, p) => s + tradeValue(p, undefined, b), 0) + picksA.reduce((s, p) => s + pickValue(league, p, b.strategy), 0);
    const get = outB.reduce((s, p) => s + tradeValue(p, undefined, a), 0) + picksB.reduce((s, p) => s + pickValue(league, p, a.strategy), 0);
    applyTradeApprovalEffect(a, give, get);
    recordBestTrade(league, a.id, get - give, tradeText);
  }
  if (b.owner) {
    const give = outB.reduce((s, p) => s + tradeValue(p, undefined, a), 0) + picksB.reduce((s, p) => s + pickValue(league, p, a.strategy), 0);
    const get = outA.reduce((s, p) => s + tradeValue(p, undefined, b), 0) + picksA.reduce((s, p) => s + pickValue(league, p, b.strategy), 0);
    applyTradeApprovalEffect(b, give, get);
    recordBestTrade(league, b.id, get - give, tradeText);
  }
  pushNews(league, {
    day: league.dayIndex,
    category: 'trade',
    teamIds: [a.id, b.id],
    // a star changing hands makes it a blockbuster
    major: [...outA, ...outB].some((p) => overall(p) >= 80),
    text: `TRADE: ${tradeText}`,
  });
  recordTrade(league, {
    season: league.season,
    day: league.dayIndex,
    teamIds: [a.id, b.id],
    text: tradeText,
  });
}

// ---------- Multi-team trades (2-4 teams) ----------
// `sends` describes who is giving what to whom:
//   sends[teamId] = { players: { [playerId]: destTeamId }, picks: { [pickId]: destTeamId } }
// Every entry must point at another team that's part of the trade (teamIds).
// resolveMultiTradeLegs turns that into one leg per team with resolved
// player/pick objects, ready for validation, AI evaluation, and execution.
export function resolveMultiTradeLegs(league, teamIds, sends) {
  const legs = teamIds.map((id) => ({
    team: getTeam(league, id),
    outPlayers: [], outPicks: [], inPlayers: [], inPicks: [],
  }));
  const byId = new Map(legs.map((l) => [l.team.id, l]));
  for (const fromId of teamIds) {
    const fromTeam = getTeam(league, fromId);
    const s = sends[fromId] || {};
    for (const [pid, destId] of Object.entries(s.players || {})) {
      if (!byId.has(destId) || destId === fromId) continue;
      // object keys are always strings, but player ids are numbers
      const p = fromTeam.roster.find((pl) => String(pl.id) === pid);
      if (!p) continue;
      byId.get(fromId).outPlayers.push(p);
      byId.get(destId).inPlayers.push(p);
    }
    for (const [pid, destId] of Object.entries(s.picks || {})) {
      if (!byId.has(destId) || destId === fromId) continue;
      const pick = league.draftPicks.find((dp) => String(dp.id) === pid);
      if (!pick) continue;
      byId.get(fromId).outPicks.push(pick);
      byId.get(destId).inPicks.push(pick);
    }
  }
  return legs;
}

// Validate an N-team trade: every team's roster size and salary-matching are
// checked independently against their own cap situation, plus the Stepien
// rule for any picks they're sending out. Returns per-team ok/reason so the
// UI can say exactly who has the problem.
export function validateMultiTrade(league, teamIds, sends) {
  const legs = resolveMultiTradeLegs(league, teamIds, sends);
  if (tradesLocked(league)) {
    return { ok: false, perTeam: {}, legs, reason: 'Trades are locked until next offseason.' };
  }
  const totalAssets = legs.reduce((s, l) => s + l.outPlayers.length + l.outPicks.length, 0);
  if (!totalAssets) return { ok: false, perTeam: {}, legs, reason: 'Empty trade.' };

  const perTeam = {};
  let ok = true;
  for (const leg of legs) {
    const { team, outPlayers, outPicks, inPlayers } = leg;
    const newSize = team.roster.length - outPlayers.length + inPlayers.length;
    if (newSize > ROSTER_MAX) {
      perTeam[team.id] = { ok: false, reason: `${team.name} would exceed ${ROSTER_MAX} players.` };
      ok = false;
      continue;
    }
    if (newSize < 8) {
      perTeam[team.id] = { ok: false, reason: `${team.name} would drop below 8 players.` };
      ok = false;
      continue;
    }
    const salOut = outPlayers.reduce((s, p) => s + p.contract.salary, 0);
    const salIn = inPlayers.reduce((s, p) => s + p.contract.salary, 0);
    const newPayroll = payroll(team) - salOut + salIn;
    if (newPayroll > SALARY_CAP && salIn > salOut * 1.25 + 250_000) {
      perTeam[team.id] = { ok: false, reason: `${team.name} fail salary matching (over the cap, taking back too much).` };
      ok = false;
      continue;
    }
    if (violatesStepien(league, team.id, outPicks.map((p) => p.id))) {
      perTeam[team.id] = { ok: false, reason: `${team.name} can't trade away first-round picks in consecutive years.` };
      ok = false;
      continue;
    }
    perTeam[team.id] = { ok: true };
  }
  return { ok, perTeam, legs };
}

// AI evaluation for every non-user team in an N-team trade: each one
// independently decides whether what they're getting is worth what they're
// giving up, exactly as in a 2-team deal.
export function aiEvaluateMultiTrade(league, teamIds, sends, userId, legs) {
  legs = legs || resolveMultiTradeLegs(league, teamIds, sends);
  const perTeam = {};
  for (const leg of legs) {
    if (leg.team.id === userId) continue;
    // a team added to the trade but with nothing coming or going is a
    // bystander — nothing to evaluate, so don't reject on their behalf
    if (!leg.inPlayers.length && !leg.inPicks.length && !leg.outPlayers.length && !leg.outPicks.length) continue;
    perTeam[leg.team.id] = aiEvaluateTrade(league, leg.team.id, leg.inPlayers, leg.outPlayers, leg.inPicks, leg.outPicks);
  }
  return perTeam;
}

// Execute an N-team trade: every outgoing player/pick moves to its
// destination team in one shot.
export function executeMultiTrade(league, teamIds, sends) {
  const legs = resolveMultiTradeLegs(league, teamIds, sends);
  for (const leg of legs) {
    for (const p of leg.outPlayers) recordSeasonStint(p, leg.team.id);
    const outIds = new Set(leg.outPlayers.map((p) => p.id));
    leg.team.roster = leg.team.roster.filter((p) => !outIds.has(p.id));
  }
  for (const leg of legs) {
    leg.team.roster = leg.team.roster.concat(leg.inPlayers);
    if (leg.team.id === league.userTeamId) {
      for (const p of leg.inPlayers) p.everOnUserTeam = true;
    }
  }
  const allMoved = legs.flatMap((l) => l.outPlayers);
  for (const p of allMoved) {
    delete p.extTalksFailed;
    p.tradeDemand = false;
    p.tradeDemandTeam = null;
    p.moraleLowStreak = 0;
    p.morale = Math.round(clamp((p.morale ?? 50) * 0.6 + 20, 0, 100) * 10) / 10;
  }
  for (const leg of legs) {
    for (const pick of leg.outPicks) {
      const dest = legs.find((l) => l.inPicks.includes(pick));
      if (dest) pick.teamId = dest.team.id;
    }
  }
  let userDiff = null;
  for (const leg of legs) {
    bumpTurmoil(leg.team);
    if (leg.outPlayers.length || leg.outPicks.length || leg.inPlayers.length || leg.inPicks.length) {
      leg.team.tradesThisSeason = (leg.team.tradesThisSeason || 0) + 1;
    }
    if (leg.team.owner) {
      const give = leg.outPlayers.reduce((s, p) => {
        const dest = legs.find((l) => l.inPlayers.includes(p))?.team;
        return s + tradeValue(p, undefined, dest);
      }, 0) + leg.outPicks.reduce((s, p) => {
        const dest = legs.find((l) => l.inPicks.includes(p))?.team;
        return s + pickValue(league, p, dest?.strategy);
      }, 0);
      const get = leg.inPlayers.reduce((s, p) => s + tradeValue(p, undefined, leg.team), 0)
        + leg.inPicks.reduce((s, p) => s + pickValue(league, p, leg.team.strategy), 0);
      applyTradeApprovalEffect(leg.team, give, get);
      if (leg.team.id === league.userTeamId) userDiff = get - give;
    }
  }

  const names = (ps, picks) => [...ps.map((p) => p.name), ...picks.map((p) => pickLabel(p))].join(', ') || 'nothing';
  const major = legs.some((l) => l.outPlayers.some((p) => overall(p) >= 80));
  const summary = legs
    .filter((l) => l.outPlayers.length || l.outPicks.length)
    .map((l) => `${l.team.name} send ${names(l.outPlayers, l.outPicks)}`)
    .join('; ');
  for (const leg of legs) {
    for (const p of leg.outPlayers) {
      const dest = legs.find((l) => l.inPlayers.includes(p))?.team;
      if (dest) recordTransaction(p, { season: league.season, day: league.dayIndex, type: 'trade', team: dest.id, fromTeam: leg.team.id, text: `${summary}.` });
    }
  }
  if (userDiff != null) recordBestTrade(league, league.userTeamId, userDiff, `${summary}.`);
  pushNews(league, {
    day: league.dayIndex,
    category: 'trade',
    teamIds: legs.map((l) => l.team.id),
    major,
    text: legs.length > 2 ? `${legs.length}-TEAM TRADE: ${summary}.` : `TRADE: ${summary}.`,
  });
  recordTrade(league, {
    season: league.season,
    day: league.dayIndex,
    teamIds: legs.map((l) => l.team.id),
    text: `${summary}.`,
  });
}
