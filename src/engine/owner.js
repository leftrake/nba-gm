// Ownership system: a generated owner per save (user team only) with fixed
// personality (patience, budget tolerance, market size) and a shifting
// approval rating. Approval drives the season's spending budget, periodic
// directives, and — at the bottom — interference events. Job security is
// not a separate meter: `seatStatus` derives it directly from approval.

import { randInt, clamp } from './rng.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { payroll } from './league.js';
import { overall } from './players.js';
import { pushNews } from './save.js';

export const MARKET_BASE_REVENUE = { small: 110_000_000, medium: 145_000_000, large: 185_000_000 };
export const MARKET_LABELS = { small: 'small', medium: 'mid-size', large: 'large' };

const FIRST_NAMES = ['Marcus', 'Diane', 'Robert', 'Linda', 'Howard', 'Carmen', 'Walter', 'Susan', 'Gerald', 'Patricia', 'Irving', 'Naomi', 'Lawrence', 'Vivian', 'Mitchell'];
const LAST_NAMES = ['Whitfield', 'Cole', 'Bannerman', 'Okafor', 'Reyes', 'Sterling', 'Kowalski', 'Brandt', 'Lindqvist', 'Vance', 'Marchetti', 'Halloway', 'Osei', 'Pruitt', 'Castellan'];

function ownerName(rng) {
  return `${FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1, rng)]} ${LAST_NAMES[randInt(0, LAST_NAMES.length - 1, rng)]}`;
}

// How far above/below the cap an owner is willing to let the budget sit,
// purely from budget tolerance: 0 -> 85% of the cap, 100 -> 130% of the tax.
function toleranceCeiling(tolerance) {
  const t = tolerance / 100;
  return SALARY_CAP * 0.85 + t * (LUXURY_TAX * 1.3 - SALARY_CAP * 0.85);
}

export function generateOwner(rng, team) {
  const patience = randInt(0, 100, rng);
  const budgetTolerance = randInt(0, 100, rng);
  const marketSize = team.market || 'medium';
  const owner = {
    name: ownerName(rng),
    patience,
    budgetTolerance,
    marketSize,
    approval: 50,
    champYears: 0,
    missedPlayoffsStreak: 0,
    directives: [],
    freezeUntilDay: 0,
    extensionOffered: false,
  };
  owner.budget = Math.round(Math.min(MARKET_BASE_REVENUE[marketSize], toleranceCeiling(budgetTolerance)) / 100_000) * 100_000;
  owner.projectedBudget = owner.budget;
  return owner;
}

// One-line read on who this owner is, for the dashboard profile card.
export function personalitySummary(owner) {
  const patienceLabel = owner.patience < 33 ? 'demanding win-now' : owner.patience < 66 ? 'pragmatic' : 'patient rebuild-backing';
  const spendLabel = owner.budgetTolerance < 33 ? 'budget-conscious' : owner.budgetTolerance < 66 ? 'measured-spending' : 'deep-pocketed';
  return `A ${patienceLabel}, ${spendLabel} owner in a ${MARKET_LABELS[owner.marketSize]} market.`;
}

// Current stance toward the GM, derived from approval.
export function ownerStance(owner) {
  if (owner.approval >= 80) return 'Thrilled with the direction of the team';
  if (owner.approval >= 60) return 'Pleased with the front office';
  if (owner.approval >= 40) return 'Watching closely';
  if (owner.approval >= 25) return 'Skeptical of the front office';
  return 'On the verge of a front-office shake-up';
}

// Job security is the effect of approval, not a parallel system — this is
// purely a display label derived from the same number.
export function seatStatus(owner) {
  if (owner.approval >= 60) return 'Secure';
  if (owner.approval >= 40) return 'Stable';
  if (owner.approval >= 25) return 'Warm Seat';
  return 'Hot Seat';
}

// ---------- Revenue & budget ----------

export function computeRevenue(owner, result) {
  const base = MARKET_BASE_REVENUE[owner.marketSize];
  const winFactor = 0.8 + (result.wins / 82) * 0.4; // 0.8 - 1.2
  let revenue = base * winFactor;
  revenue += result.playoffRound * base * 0.05; // playoff runs pay off
  if (result.champion) revenue += base * 0.25; // title bump
  else if (owner.champYears > 0) revenue += base * 0.1 * (owner.champYears / 3); // afterglow
  if (owner.marketSize === 'small' && owner.missedPlayoffsStreak >= 3) revenue *= 0.85; // tanking hurts attendance
  return revenue;
}

export function computeBudget(team, owner, revenue) {
  const ceiling = toleranceCeiling(owner.budgetTolerance);
  let budget = Math.min(revenue, ceiling);
  if (owner.approval < 25) budget = Math.min(budget, payroll(team)); // payroll freeze
  return Math.round(budget / 100_000) * 100_000;
}

// ---------- Playoff result helper ----------

// 0 = missed the playoffs, 1-4 = eliminated in that round, 5 = champion.
export function playoffRoundReached(league, teamId) {
  const po = league.playoffs;
  if (!po) return 0;
  if (po.champion === teamId) return 5;
  let maxRound = -1;
  for (const c of po.completed || []) {
    if (c.series.high === teamId || c.series.low === teamId) maxRound = Math.max(maxRound, c.round);
  }
  if (po.finals && po.finals.winner && po.finals.winner !== teamId
    && (po.finals.high === teamId || po.finals.low === teamId)) maxRound = 3;
  return maxRound + 1;
}

// ---------- In-season approval drift ----------

// Every 10 games, nudge approval toward the team's record this season —
// small swings, not a rollercoaster.
export function dailyApprovalUpdate(team) {
  const owner = team.owner;
  if (!owner) return;
  const gp = team.wins + team.losses;
  if (gp === 0 || gp % 10 !== 0) return;
  const winPct = team.wins / gp;
  owner.approval = clamp(owner.approval + (winPct - 0.5) * 2, 0, 100);
}

// ---------- Interference ----------

// At low approval, the owner occasionally lashes out: a roster freeze or a
// public shot in the press. Rare, and only while approval stays low.
export function maybeOwnerInterference(league, team, rng) {
  const owner = team.owner;
  if (!owner || owner.approval >= 25) return;
  if (owner.freezeUntilDay && league.dayIndex < owner.freezeUntilDay) return;
  if (rng() >= 0.01) return;
  if (rng() < 0.5) {
    owner.freezeUntilDay = league.dayIndex + 5;
    pushNews(league, { day: league.dayIndex, category: 'owner', major: true, teamIds: [team.id], text: `🔒 Ownership imposes a five-day roster freeze on the ${team.city} ${team.name} amid mounting frustration with the front office.` });
  } else {
    pushNews(league, { day: league.dayIndex, category: 'owner', major: true, teamIds: [team.id], text: `📰 Sources close to ownership express frustration with the ${team.city} ${team.name}'s front-office direction.` });
  }
}

// ---------- Signing budget ----------

// Whether a contract's salary would push total team spend above what the owner
// has budgeted this season. This is advisory only: a cap-legal signing always
// goes through, but exceeding budget costs approval (see below).
// Coach salary is included as a pre-committed operating expense even though
// it does not count against the cap.
export function exceedsOwnerBudget(team, salary) {
  const owner = team.owner;
  if (!owner) return false;
  let budgetCap = owner.budget;
  if (owner.approval < 25) budgetCap = Math.min(budgetCap, payroll(team)); // payroll freeze
  const coachCost = team.coach?.salary ?? 0;
  return payroll(team) + coachCost + salary > budgetCap;
}

// Approval hit for signing a player whose salary exceeds the owner's budget.
export function applyBudgetOverageEffect(team) {
  const owner = team.owner;
  if (!owner) return;
  owner.approval = clamp(owner.approval - 4, 0, 100);
}

export function isRosterFrozen(league, team) {
  const owner = team.owner;
  return !!(owner && owner.freezeUntilDay && league.dayIndex < owner.freezeUntilDay);
}

// ---------- Trade reactions ----------

// Approval shifts with how a trade's value worked out for the user.
export function applyTradeApprovalEffect(team, giveVal, getVal) {
  const owner = team.owner;
  if (!owner || giveVal <= 0) return;
  const ratio = getVal / giveVal;
  if (ratio >= 1.1) owner.approval = clamp(owner.approval + 3, 0, 100);
  else if (ratio < 0.7) owner.approval = clamp(owner.approval - 5, 0, 100);
}

const SIGNOFF_VALUE_THRESHOLD = 150;

// Below 50 approval, the owner wants a say in big deals.
export function ownerSignoffRequired(team, giveVal, getVal) {
  const owner = team.owner;
  if (!owner || owner.approval >= 50) return false;
  return giveVal >= SIGNOFF_VALUE_THRESHOLD || getVal >= SIGNOFF_VALUE_THRESHOLD;
}

// At rock-bottom approval, ownership can flatly block a lopsided deal.
export function ownerBlocksTrade(team, giveVal, getVal, rng) {
  const owner = team.owner;
  if (!owner || owner.approval >= 25) return false;
  if (giveVal <= 0 || getVal >= giveVal * 0.85) return false;
  return rng() < 0.5;
}

// ---------- Directives ----------

const DIRECTIVE_DEFS = {
  luxury_tax: {
    text: 'Get under the luxury tax this offseason.',
    deadline: 'By the start of next season',
    check: (league, team, snap) => payroll(team) <= LUXURY_TAX,
    attempted: (league, team, snap) => payroll(team) < snap.payroll,
    success: 'the payroll is back under the luxury tax line.',
    fail: 'the payroll is still above the luxury tax, but ownership notes the effort to bring it down.',
    ignore: 'the payroll remains deep in the luxury tax with no plan to address it.',
  },
  marquee_signing: {
    text: 'Sign a marquee free agent (80+ overall) this offseason.',
    deadline: 'By the start of next season',
    check: (league, team, snap) => team.roster.some((p) => overall(p) >= 80 && !snap.rosterIds.includes(p.id)),
    attempted: (league, team, snap) => team.roster.some((p) => overall(p) >= 75 && !snap.rosterIds.includes(p.id)),
    success: 'the front office landed a marquee free agent.',
    fail: 'the front office added talent this summer, but nothing the fanbase would call a marquee signing.',
    ignore: 'the roster looks the same as last spring — no marquee addition was made.',
  },
  rebuild_vets: {
    text: 'The fanbase wants a rebuild — move the veterans (30+) this offseason.',
    deadline: 'By the start of next season',
    check: (league, team, snap) => countOver30(team) < snap.over30,
    attempted: (league, team, snap) => countOver30(team) <= snap.over30,
    success: 'the roster is visibly younger after this summer\'s moves.',
    fail: 'a couple of veterans moved, but the roster is still graybeard-heavy.',
    ignore: 'the veteran core was left fully intact, against ownership\'s wishes.',
  },
  compete_now: {
    text: 'Make the playoffs this season.',
    deadline: "By the end of this season",
    check: (league, team, snap) => (league.playoffs?.completed || []).some((c) => c.round === 0 && (c.series.high === team.id || c.series.low === team.id)) || league.playoffs?.champion === team.id,
    attempted: (league, team, snap) => team.wins / Math.max(1, team.wins + team.losses) >= 0.45,
    success: 'the team made the playoffs as ownership demanded.',
    fail: 'the playoff push fell short, but ownership credits the fight.',
    ignore: 'the team missed the playoffs by a wide margin, with no real push.',
  },
  add_piece: {
    text: 'Make a move to upgrade the roster by the trade deadline.',
    deadline: 'By the trade deadline',
    check: (league, team, snap) => (team.tradesThisSeason || 0) > (snap.tradesThisSeason || 0),
    attempted: (league, team, snap) => false,
    success: 'the front office made a move to bolster the roster, as asked.',
    fail: 'no upgrade materialized before the deadline.',
    ignore: 'no upgrade materialized before the deadline, and no real effort was visible.',
  },
};

function countOver30(team) {
  return team.roster.filter((p) => p.age >= 30).length;
}

function snapshotFor(team) {
  return {
    payroll: payroll(team),
    rosterIds: team.roster.map((p) => p.id),
    over30: countOver30(team),
    tradesThisSeason: team.tradesThisSeason || 0,
  };
}

// Live read on a directive before the season-end evaluation: 'done' if its
// condition is already met, 'on-track' if progress has been made, otherwise
// 'pending'. Lets the dashboard show a checkmark as soon as the GM delivers.
export function directiveStatus(league, team, directive) {
  const def = DIRECTIVE_DEFS[directive.type];
  if (!def) return 'pending';
  if (def.check(league, team, directive.snapshot)) return 'done';
  if (def.attempted(league, team, directive.snapshot)) return 'on-track';
  return 'pending';
}

// Resolve every active directive against the current state, adjusting
// approval and pushing news for each outcome.
export function evaluateDirectives(league, team) {
  const owner = team.owner;
  if (!owner) return;
  for (const d of owner.directives || []) {
    const def = DIRECTIVE_DEFS[d.type];
    if (!def) continue;
    if (def.check(league, team, d.snapshot)) {
      owner.approval = clamp(owner.approval + 8, 0, 100);
      pushNews(league, { day: 0, category: 'owner', major: true, teamIds: [team.id], text: `Ownership is pleased: ${def.success}` });
    } else if (def.attempted(league, team, d.snapshot)) {
      owner.approval = clamp(owner.approval - 3, 0, 100);
      pushNews(league, { day: 0, category: 'owner', teamIds: [team.id], text: `Mixed marks from ownership: ${def.fail}` });
    } else {
      owner.approval = clamp(owner.approval - 10, 0, 100);
      pushNews(league, { day: 0, category: 'owner', major: true, teamIds: [team.id], text: `📰 Sources close to ownership express frustration with the front office's direction: ${def.ignore}` });
    }
  }
  owner.directives = [];
}

// Issue 1-3 new directives based on the owner's personality and the team's
// situation. A low-patience owner issues more, and harsher, directives.
export function issueDirectives(league, team, rng) {
  const owner = team.owner;
  if (!owner) return;
  const candidates = [];
  if (payroll(team) > LUXURY_TAX && owner.budgetTolerance < 50) candidates.push('luxury_tax');
  if (owner.missedPlayoffsStreak >= 1 && owner.approval < 70) candidates.push('marquee_signing');
  if (owner.missedPlayoffsStreak >= 2) {
    if (owner.patience < 50) candidates.push('compete_now');
    else candidates.push('rebuild_vets');
  }
  if (team.strategy === 'contending' && owner.approval >= 40) candidates.push('add_piece');
  // always-available fallbacks so the pool is never empty
  if (!candidates.includes('compete_now')) candidates.push('compete_now');
  if (!candidates.includes('add_piece')) candidates.push('add_piece');

  // shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const maxCount = owner.patience < 33 ? 3 : owner.patience < 66 ? 2 : 1;
  const count = Math.min(maxCount, 1 + Math.floor(rng() * maxCount));
  const seen = new Set();
  for (const type of candidates) {
    if (owner.directives.length >= count) break;
    if (seen.has(type)) continue;
    seen.add(type);
    const def = DIRECTIVE_DEFS[type];
    owner.directives.push({ type, text: def.text, deadline: def.deadline, snapshot: snapshotFor(team) });
    pushNews(league, { day: 0, category: 'owner', major: true, teamIds: [team.id], text: `📋 Ownership directive: ${def.text}` });
  }
}

// The user responds to a pending GM contract extension offer (issued after
// winning a championship). Accepting boosts ownership approval and signals
// long-term security; declining is a no-op on approval but clears the offer.
export function respondToExtension(league, team, accept) {
  const owner = team.owner;
  if (!owner || !owner.extensionOffered) return;
  owner.extensionOffered = false;
  if (accept) {
    owner.approval = clamp(owner.approval + 5, 0, 100);
    pushNews(league, { day: 0, category: 'owner', teamIds: [team.id], text: `You accept ${owner.name}'s contract extension as GM.` });
  } else {
    pushNews(league, { day: 0, category: 'owner', teamIds: [team.id], text: `You politely decline ${owner.name}'s contract extension offer, preferring to let your results speak season to season.` });
  }
}

// ---------- Season transitions ----------

// Called once per season for the user's team, before the new directives are
// issued: resolves last cycle's directives, updates approval from the
// season just finished, and computes next season's budget.
export function processOwnerSeason(league, team, rng, result) {
  const owner = team.owner;
  if (!owner) return;

  evaluateDirectives(league, team);

  if (result.champion) {
    owner.approval = 100;
    owner.champYears = 3;
    owner.extensionOffered = true;
    pushNews(league, { day: 0, category: 'owner', major: true, teamIds: [team.id], text: `🏆 Ownership is overjoyed by the championship and publicly credits the front office — ${owner.name} offers you a contract extension as GM.` });
  } else {
    owner.approval = clamp(owner.approval + (result.wins / 82 - 0.5) * 20 + result.playoffRound * 3, 0, 100);
    if (owner.champYears > 0) owner.champYears -= 1;
  }
  owner.missedPlayoffsStreak = result.playoffRound > 0 ? 0 : (owner.missedPlayoffsStreak || 0) + 1;

  const revenue = computeRevenue(owner, result);
  owner.projectedBudget = computeBudget(team, owner, revenue);
  owner.budget = owner.projectedBudget;

  team.tradesThisSeason = 0;

  issueDirectives(league, team, rng);
}
