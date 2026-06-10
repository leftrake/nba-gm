import { overall } from './players.js';
import { getTeam, payroll } from './league.js';
import { SALARY_CAP } from '../data/teams.js';

// Trade value: overall matters most, youth and contract length matter too
export function tradeValue(p) {
  const ovr = overall(p);
  let v = Math.pow(Math.max(ovr - 40, 1), 2.4);
  // youth premium / age discount
  if (p.age <= 23) v *= 1.5;
  else if (p.age <= 26) v *= 1.2;
  else if (p.age >= 32) v *= 0.6;
  else if (p.age >= 30) v *= 0.8;
  // potential premium
  v *= 1 + Math.max(0, p.potential - ovr) * 0.02;
  // bad contract discount
  const fair = Math.pow(Math.max(ovr - 40, 1), 2.4);
  if (p.contract && p.contract.salary > 30_000_000 && ovr < 75) v *= 0.7;
  return Math.round(v);
}

// Validate a trade under simplified cap rules
export function validateTrade(league, teamAId, playersAIds, teamBId, playersBIds) {
  const a = getTeam(league, teamAId);
  const b = getTeam(league, teamBId);
  if (!playersAIds.length && !playersBIds.length) return { ok: false, reason: 'Empty trade.' };

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

// AI decision: does team B accept?
export function aiEvaluateTrade(league, teamBId, incoming, outgoing) {
  const valueIn = incoming.reduce((s, p) => s + tradeValue(p), 0);
  const valueOut = outgoing.reduce((s, p) => s + tradeValue(p), 0);
  if (valueOut === 0) return { accept: valueIn > 0, ratio: Infinity };
  const ratio = valueIn / valueOut;
  // AI wants at least ~95% value back, with slight team-specific noise
  const team = getTeam(league, teamBId);
  const greed = 0.92 + ((team.id.charCodeAt(0) + team.id.charCodeAt(2)) % 10) * 0.015;
  return { accept: ratio >= greed, ratio, greed };
}

export function executeTrade(league, teamAId, playersAIds, teamBId, playersBIds) {
  const a = getTeam(league, teamAId);
  const b = getTeam(league, teamBId);
  const outA = a.roster.filter((p) => playersAIds.includes(p.id));
  const outB = b.roster.filter((p) => playersBIds.includes(p.id));
  a.roster = a.roster.filter((p) => !playersAIds.includes(p.id)).concat(outB);
  b.roster = b.roster.filter((p) => !playersBIds.includes(p.id)).concat(outA);
  const names = (ps) => ps.map((p) => p.name).join(', ') || 'nothing';
  league.news.unshift({
    day: league.dayIndex,
    text: `TRADE: ${a.name} send ${names(outA)} to the ${b.name} for ${names(outB)}.`,
  });
}
