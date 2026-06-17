// ---------- Morale ----------
// Every player carries a morale value (0-100), shown on the Roster screen.
// It drifts slowly toward a per-player baseline shaped by recent team
// results, role (minutes vs. what his rating "deserves"), front-office
// turmoil (lots of roster moves), and discrete events — extensions, playoff
// wins, being shopped in a rejected trade. Stars (high overall) weight wins
// most heavily; everyone else weights their role/minutes most.
//
// Effects: moraleRatingMod feeds a small +/- rating offset into the
// possession sim (sim.js); moraleSalaryMult nudges contract/extension
// demands pricier when unhappy, cheaper when happy (league.js demandSalary).
//
// Trade demands: a star (overall >= 75) whose morale stays below
// TRADE_DEMAND_THRESHOLD for TRADE_DEMAND_STREAK consecutive sim days
// publicly demands a trade (p.tradeDemand = true). That sharply cuts his
// trade value (trade.js), drags down teammates' morale a little, and blocks
// re-signing (league.js resignChance/extensionDemand/offerDemand). It
// resolves either by being traded (executeTrade clears it) or by morale
// recovering past RESCIND_THRESHOLD.

import { clamp, gauss, makeRng } from './rng.js';
import { overall } from './players.js';
import { tradeValue, validateTrade, executeTrade } from './trade.js';
import { pushNews } from './save.js';
import { lossMoraleMult, legendTeammateBonus } from './backstory.js';
import { chemistryBonus } from './coach.js';

// Seeded off the player's id (not the league rng) so adding morale doesn't
// shift the random sequence everything else in player generation draws from.
export function initMorale(id) {
  const r = makeRng(((id * 2654435761) ^ 0x9e3779b9) >>> 0);
  return Math.round(clamp(gauss(58, 14, r), 15, 90));
}

// How much a player cares about winning vs. his role/minutes — stars lean
// toward winning, role players lean toward role. Shared with league.js's
// demand formula.
export function caresAboutWinning(p) {
  return clamp((overall(p) - 60) / 25, 0, 1);
}

// Effective rating offset applied to shooting/passing in the possession
// sim: roughly -1 to +1 at the morale extremes, nothing at the 50 baseline.
export function moraleRatingMod(p) {
  return clamp(((p.morale ?? 50) - 50) * 0.02, -1, 1);
}

// Contract/extension demand multiplier: unhappy players price themselves
// higher, happy ones discount slightly.
export function moraleSalaryMult(p) {
  return clamp(1 + (50 - (p.morale ?? 50)) * 0.004, 0.85, 1.2);
}

const setMorale = (p, v) => { p.morale = Math.round(clamp(v, 0, 100) * 10) / 10; };

// Apply a flat morale delta to one player — extension outcomes, RFA window
// closing unsigned, etc.
export function adjustMorale(p, delta) {
  setMorale(p, (p.morale ?? 50) + delta);
}

// Win/loss bump for an entire roster — used after every regular-season and
// playoff game. `scale` lets playoff results (and the eventual title) swing
// morale harder than a single regular-season result.
export function applyResultMorale(team, won, scale = 1) {
  for (const p of team.roster) {
    const caresWin = caresAboutWinning(p);
    const delta = (won ? 0.15 : -0.15) * (0.4 + caresWin) * scale;
    setMorale(p, (p.morale ?? 50) + delta);
  }
}

// Flat morale bump for an entire roster — title runs, extensions, etc.
export function bumpRosterMorale(team, amount) {
  for (const p of team.roster) setMorale(p, (p.morale ?? 50) + amount);
}

// Roster moves (trades, waives, mid-season signings) spike a team's
// "turmoil" counter, which drags everyone's morale down a little until it
// decays away (see dailyMoraleUpdate).
export function bumpTurmoil(team, amount = 1) {
  team.turmoil = (team.turmoil ?? 0) + amount;
}

// A player whose name comes up in a rejected trade offer hears about it.
export function applyShoppedPenalty(players) {
  for (const p of players) setMorale(p, (p.morale ?? 50) - 4);
}

// Minutes per game a player at this overall "deserves" — the bar
// dailyMoraleUpdate compares actual minutes against for the role component.
function expectedMinutes(ovr) {
  if (ovr >= 80) return 32;
  if (ovr >= 72) return 27;
  if (ovr >= 64) return 21;
  if (ovr >= 56) return 15;
  return 9;
}

// One day's morale tick for every player in the league: win/loss (from
// today's results, if any), role fit (minutes played vs. expected, only on
// nights a player suited up), turmoil drag, a drag from any teammate openly
// demanding a trade, and gentle drift back toward each player's baseline so
// morale doesn't get stuck at an extreme once whatever caused it passes.
export function dailyMoraleUpdate(league, results) {
  const byTeam = new Map(); // teamId -> { won, box }
  for (const r of results) {
    const homeWon = r.homePts > r.awayPts;
    byTeam.set(r.home, { won: homeWon, box: r.homeBox });
    byTeam.set(r.away, { won: !homeWon, box: r.awayBox });
  }
  for (const team of league.teams) {
    const info = byTeam.get(team.id);
    const turmoil = team.turmoil ?? 0;
    const demandCount = team.roster.filter((p) => p.tradeDemand).length;
    const legendBonus = legendTeammateBonus(team);
    const coachBonus = chemistryBonus(team.coach);
    // An authoritative (high-rated) coach keeps the locker room steadier:
    // role dissatisfaction, turmoil drag, and trade-demand contagion are
    // softened slightly. A weak coach amplifies the same pressures.
    // Range: rating 45 → -0.25, rating 70 → 0, rating 99 → +0.25.
    const coachAuth = clamp(((team.coach?.rating ?? 70) - 70) / 116, -0.25, 0.25);
    for (const p of team.roster) {
      const ovr = overall(p);
      const caresWin = caresAboutWinning(p);
      const caresRole = 1 - caresWin * 0.6;
      let m = p.morale ?? 50;
      if (info) {
        const resultDelta = (info.won ? 0.15 : -0.15) * (0.4 + caresWin);
        // "Busted prospect" types sour faster on losers; "family provider"
        // types stay loyal to teams that pay them well — see backstory.js.
        m += info.won ? resultDelta : resultDelta * lossMoraleMult(p);
        const line = info.box.find((l) => l.playerId === p.id);
        const min = line?.min ?? 0;
        if (min > 0) {
          const gap = clamp(min - expectedMinutes(ovr), -15, 15);
          m += gap * 0.015 * caresRole * (1 - coachAuth * 0.5);
        }
      }
      m -= turmoil * 0.01 * (1 - coachAuth * 0.6);
      m -= demandCount * 0.02 * (1 - coachAuth * 0.6);
      m += legendBonus; // steady locker room from a long-tenured "one city legend"
      m += coachBonus; // a chemistry-minded (or poor) head coach
      m += (50 - m) * 0.003; // gentle drift back toward neutral
      setMorale(p, m);
    }
  }
  for (const team of league.teams) {
    if (team.turmoil) team.turmoil = Math.max(0, team.turmoil - 0.05);
  }
}

const TRADE_DEMAND_THRESHOLD = 28;
const TRADE_DEMAND_STREAK = 25; // consecutive low-morale sim days
const RESCIND_THRESHOLD = 45;

// Early-warning point on the moraleLowStreak — crossing this shows an
// "unhappy" flag in the UI well before the streak reaches TRADE_DEMAND_STREAK
// and triggers an actual trade demand.
export const MORALE_WARNING_STREAK = 12;

// Tracks how long each star has languished below the unhappiness threshold;
// crossing the streak triggers a public trade demand, and recovering above
// the rescind threshold lifts one.
export function updateTradeDemands(league) {
  for (const team of league.teams) {
    for (const p of team.roster) {
      if (overall(p) >= 75) {
        if ((p.morale ?? 50) < TRADE_DEMAND_THRESHOLD) {
          p.moraleLowStreak = (p.moraleLowStreak ?? 0) + 1;
        } else {
          p.moraleLowStreak = 0;
        }
        if (!p.tradeDemand && p.moraleLowStreak >= TRADE_DEMAND_STREAK) {
          p.tradeDemand = true;
          p.tradeDemandTeam = team.id;
          p.moraleLowStreak = 0;
          pushNews(league, {
            day: league.dayIndex, category: 'morale', major: true, teamIds: [team.id],
            text: `💢 ${p.name} is unhappy in ${team.city} and has publicly demanded a trade.`,
          });
        }
      }
      if (p.tradeDemand && (p.morale ?? 50) >= RESCIND_THRESHOLD) {
        p.tradeDemand = false;
        p.tradeDemandTeam = null;
        p.moraleLowStreak = 0;
        pushNews(league, {
          day: league.dayIndex, category: 'morale', teamIds: [team.id],
          text: `${p.name} rescinds his trade demand and says he's happy to stay with the ${team.city} ${team.name}.`,
        });
      }
    }
  }
}

// AI-to-AI response to a disgruntled star: the seller is willing to take a
// discount (his trade value is already cut by tradeValue's tradeDemand
// penalty) to resolve the situation; the buyer just needs the deal to look
// like a fair value bargain. Resolves the trade demand and gives the player
// a fresh-start morale bump on landing.
export function maybeShopDisgruntled(league, rng) {
  const anyDisgruntled = league.teams.some((t) => t.id !== league.userTeamId && t.roster.some((p) => p.tradeDemand && p.contract));
  if (!anyDisgruntled) return false;
  if (rng() >= 0.2) return false;
  for (const seller of league.teams) {
    const disgruntled = seller.roster.find((p) => p.tradeDemand && p.contract);
    if (!disgruntled) continue;
    if (seller.id === league.userTeamId) continue; // the user handles their own
    const buyers = league.teams.filter((t) => t.id !== seller.id && t.id !== league.userTeamId);
    const shuffled = [...buyers].sort(() => rng() - 0.5);
    for (const buyer of shuffled) {
      const shortlist = buyer.roster
        .filter((p) => p.contract && overall(p) < overall(disgruntled))
        .sort((a, b) => tradeValue(a) - tradeValue(b));
      for (let n = 1; n <= Math.min(2, shortlist.length); n++) {
        const pkg = shortlist.slice(0, n);
        const pkgIds = pkg.map((p) => p.id);
        if (!validateTrade(league, buyer.id, pkgIds, seller.id, [disgruntled.id]).ok) continue;
        const valueOut = tradeValue(disgruntled, seller.strategy);
        const valueIn = pkg.reduce((s, p) => s + tradeValue(p, seller.strategy), 0);
        if (valueOut > 0 && valueIn / valueOut < 0.5) continue; // even a fire sale has a floor
        const buyerValueIn = tradeValue(disgruntled, buyer.strategy);
        const buyerValueOut = pkg.reduce((s, p) => s + tradeValue(p, buyer.strategy), 0);
        if (buyerValueOut > 0 && buyerValueIn / buyerValueOut < 0.7) continue;
        executeTrade(league, seller.id, [disgruntled.id], buyer.id, pkgIds);
        // executeTrade already clears tradeDemand/tradeDemandTeam and resets morale toward neutral
        setMorale(disgruntled, (disgruntled.morale ?? 50) + 15);
        pushNews(league, {
          day: league.dayIndex, category: 'trade', major: true, teamIds: [seller.id, buyer.id],
          text: `TRADE: unhappy ${disgruntled.name} is dealt from the ${seller.name} to the ${buyer.name}, resolving his trade demand.`,
        });
        return true;
      }
    }
  }
  return false;
}
