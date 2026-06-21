import { overall } from './players.js';
import { tradeValue, validateTrade, aiEvaluateTrade, executeTrade } from './trade.js';
import { getTeamPicks, violatesStepien } from './draftPicks.js';
import { payroll, payrollTarget, projectedPayroll, projectedPayrollLimit } from './league.js';
import { SALARY_CAP, LUXURY_TAX, ROSTER_MAX } from '../data/teams.js';

// Front-office strategies. Every team is tagged 'contending' (top ~10 by
// record and roster strength), 'rebuilding' (bottom ~8), or 'retooling'
// (the middle). The strategy shades trade valuations and vetoes bad-fit
// deals (trade.js), and drives AI-to-AI trades during the season. Assigned
// at league creation and re-evaluated each offseason.

export function rosterStrength(team) {
  const top = team.roster.map(overall).sort((a, b) => b - a).slice(0, 8);
  return top.reduce((s, o) => s + o, 0) / Math.max(top.length, 1);
}

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const STRATEGY_NOTES = {
  contending: 'contending — wants proven help for a title run',
  rebuilding: 'rebuilding — prefers youth and draft picks',
  retooling: 'retooling — open to value and roster fit',
};

// A quick read on what a team needs for the trade machine: its two weakest
// positions by best-player rating, its front-office strategy, and a one-line
// note on what they'd likely want back, derived from that strategy.
export function teamNeeds(team) {
  const byPos = POSITIONS.map((pos) => {
    const players = team.roster.filter((p) => p.pos === pos);
    const rating = players.length ? Math.max(...players.map(overall)) : 0;
    return { pos, rating };
  });
  const thin = [...byPos].sort((a, b) => a.rating - b.rating).slice(0, 2);
  const strategy = team.strategy || 'retooling';
  return { thin, strategy, note: STRATEGY_NOTES[strategy] || STRATEGY_NOTES.retooling };
}

// Rank by the sum of record rank and roster-strength rank, so a stacked team
// that started slow still reads as a contender. With no games played yet
// (new league, fresh offseason) last season's record or pure roster
// strength decides. Returns the list of teams whose strategy changed.
export function evaluateStrategies(league) {
  const strength = new Map(league.teams.map((t) => [t.id, rosterStrength(t)]));
  const winPct = (t) => {
    const gp = t.wins + t.losses;
    if (gp > 0) return t.wins / gp;
    if (t.lastWins != null) return t.lastWins / 82;
    return 0.5;
  };
  const rank = new Map(league.teams.map((t) => [t.id, 0]));
  const addRanks = (sorted) => sorted.forEach((t, i) => rank.set(t.id, rank.get(t.id) + i));
  addRanks([...league.teams].sort((a, b) => strength.get(b.id) - strength.get(a.id)));
  addRanks([...league.teams].sort((a, b) => winPct(b) - winPct(a) || strength.get(b.id) - strength.get(a.id)));
  const ordered = [...league.teams].sort((a, b) => rank.get(a.id) - rank.get(b.id) || strength.get(b.id) - strength.get(a.id));
  const changes = [];
  ordered.forEach((t, i) => {
    const next = i < 10 ? 'contending' : i >= ordered.length - 8 ? 'rebuilding' : 'retooling';
    if (t.strategy && t.strategy !== next) changes.push({ team: t, from: t.strategy, to: next });
    t.strategy = next;
  });
  return changes;
}

// A few times a season, a contender buys a veteran from a rebuilding team
// for young players. Called once per sim day; the deal only happens if both
// front offices like it under their own strategy lens and it passes the
// usual cap rules, so most days nothing comes of it.
export function maybeAiTrade(league, rng) {
  if (rng() >= 0.025) return;
  const ai = league.teams.filter((t) => t.id !== league.userTeamId);
  const buyers = ai.filter((t) => t.strategy === 'contending');
  // rebuilders are the natural sellers, but they're also the weakest teams
  // and often have no vet worth buying, so retooling teams sell too
  const sellers = ai.filter((t) => t.strategy === 'rebuilding' || t.strategy === 'retooling');
  if (!buyers.length || !sellers.length) return;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  for (let attempt = 0; attempt < 10; attempt++) {
    const buyer = pick(buyers);
    const seller = pick(sellers);
    // contract guard: old saves can carry contract-less retirees on rosters
    const vets = seller.roster.filter((p) => p.contract && p.age >= 28 && overall(p) >= 60);
    if (!vets.length) continue;
    const vet = pick(vets);
    // the buyer shops its non-star young players, plus modestly paid
    // role players as salary filler; cheapest package first
    const shortlist = buyer.roster
      .filter((p) => overall(p) < 76 && (p.age <= 26 || (p.age <= 28 && p.contract.salary <= 10_000_000)))
      .slice(0, 8);
    const packages = [];
    for (let i = 0; i < shortlist.length; i++) {
      packages.push([shortlist[i]]);
      for (let j = i + 1; j < shortlist.length; j++) packages.push([shortlist[i], shortlist[j]]);
    }
    const value = (pkg) => pkg.reduce((s, p) => s + tradeValue(p), 0);
    packages.sort((a, b) => value(a) - value(b));

    // Rebuilders covet picks: sometimes the seller asks the buyer to sweeten
    // the package with one of its own future 1sts (Stepien-legal only). The
    // gate is keyed off the team ids (not rng()) so it doesn't perturb the
    // random sequence on attempts where no sweetener applies.
    const buyerFirsts = seller.strategy === 'rebuilding'
      ? getTeamPicks(league, buyer.id).filter((p) => p.round === 1 && !violatesStepien(league, buyer.id, [p.id]))
      : [];
    const sweetenerGate = (buyer.id.charCodeAt(0) + seller.id.charCodeAt(1)) % 20 === 0;
    const sweetener = buyerFirsts.length && sweetenerGate ? [buyerFirsts[0]] : [];
    const sweetenerIds = sweetener.map((p) => p.id);

    for (const pkg of packages) {
      const pkgIds = pkg.map((p) => p.id);
      if (!validateTrade(league, buyer.id, pkgIds, seller.id, [vet.id], sweetenerIds, []).ok) continue;
      if (!aiEvaluateTrade(league, seller.id, pkg, [vet], sweetener, []).accept) continue;
      if (!aiEvaluateTrade(league, buyer.id, [vet], pkg, [], sweetener).accept) continue;
      executeTrade(league, buyer.id, pkgIds, seller.id, [vet.id], sweetenerIds, []);
      return;
    }
  }
}

// A few times a season, a team that's run well past its comfort zone (over
// the tax, or over its own strategy's spending plan) dumps an expensive,
// non-core contract on a rebuilder with cap room — often sweetened with a
// future 2nd. The rebuilder takes on a player for free (and a future asset),
// which costs them nothing since they're under the cap; the over-extended
// team frees up money. Real-NBA shorthand for "expiring/bad contract + pick
// for nothing," one of the most common offseason trade types.
export function maybeAiSalaryDump(league, rng) {
  if (rng() >= 0.02) return;
  const ai = league.teams.filter((t) => t.id !== league.userTeamId);
  // dumpers: spending well beyond what their strategy calls for
  const dumpers = ai.filter((t) => payroll(t) > Math.max(LUXURY_TAX, payrollTarget(t)));
  const takers = ai.filter((t) => t.strategy === 'rebuilding');
  if (!dumpers.length || !takers.length) return;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  for (let attempt = 0; attempt < 10; attempt++) {
    const dumper = pick(dumpers);
    const taker = pick(takers);
    if (dumper.id === taker.id) continue;
    if (taker.roster.length >= ROSTER_MAX || dumper.roster.length <= 8) continue;
    // a "bad contract": expensive, but not a core piece worth keeping
    const badContracts = dumper.roster
      .filter((p) => p.contract && p.contract.salary >= 10_000_000 && overall(p) < 74)
      .sort((a, b) => b.contract.salary - a.contract.salary);
    if (!badContracts.length) continue;
    const vet = badContracts[0];
    const capRoom = SALARY_CAP - payroll(taker);
    if (vet.contract.salary > capRoom) continue; // taker can't absorb without matching
    // Multi-year bad contracts carry into next season same as a free-agent
    // signing would — a rebuilder shouldn't eat one just for a sweetener
    // pick if it blows past the cap discipline its own strategy calls for.
    if (vet.contract.years > 1 && projectedPayroll(taker) + vet.contract.salary > projectedPayrollLimit(taker)) continue;
    // sweeten with a spare future 2nd if the dumper has one (2nds never
    // trip the Stepien rule, so no extra check needed)
    const dumperSeconds = getTeamPicks(league, dumper.id).filter((p) => p.round === 2);
    const sweetener = dumperSeconds.length ? [dumperSeconds[0]] : [];
    const sweetenerIds = sweetener.map((p) => p.id);
    if (!validateTrade(league, dumper.id, [vet.id], taker.id, [], sweetenerIds, []).ok) continue;
    if (!aiEvaluateTrade(league, taker.id, [vet], [], sweetener, []).accept) continue;
    executeTrade(league, dumper.id, [vet.id], taker.id, [], sweetenerIds, []);
    return;
  }
}
