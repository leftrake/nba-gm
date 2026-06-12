import { overall } from './players.js';
import { tradeValue, validateTrade, aiEvaluateTrade, executeTrade } from './trade.js';
import { getTeamPicks, violatesStepien } from './draftPicks.js';

// Front-office strategies. Every team is tagged 'contending' (top ~10 by
// record and roster strength), 'rebuilding' (bottom ~8), or 'retooling'
// (the middle). The strategy shades trade valuations and vetoes bad-fit
// deals (trade.js), and drives AI-to-AI trades during the season. Assigned
// at league creation and re-evaluated each offseason.

export function rosterStrength(team) {
  const top = team.roster.map(overall).sort((a, b) => b - a).slice(0, 8);
  return top.reduce((s, o) => s + o, 0) / Math.max(top.length, 1);
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
