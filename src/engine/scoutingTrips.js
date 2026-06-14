import { randInt, clamp, makeRng } from './rng.js';
import { overall } from './players.js';
import { generateDraftClass } from './draft.js';
import { scoutedOverallRange, scoutedOverall, scoutedPotential, potentialGrade } from './scouting.js';
import { regionFor, SCOUT_REGIONS, personalityNote, scoutBackstoryNote } from './backstory.js';

// ---------- Scouting trips ----------
// Runs during the offseason phase, between the playoffs ending and the
// draft. league.scouting holds a pre-generated draft class (the same one
// initDraft will consume) plus a per-team budget, scout reports, and
// watchlists. Spending here mutates each prospect's `scout.watched` counter,
// which engine/scouting.js's scoutUncertainty reads to tighten fog — so
// progress carries straight through to the draft big board.

export const SCOUT_COSTS = {
  watch: { Domestic: 50_000, Europe: 100_000, 'Latin America': 100_000, Africa: 150_000, 'Asia-Pacific': 150_000 },
  regional: 300_000,
  poach: 400_000,
};

export const EXTENDED_WATCH_COUNT = 3;

const BUDGET_BASE = { small: 500_000, medium: 1_000_000, large: 1_500_000 };

// $500K-2M, by market size and (for the user) owner budget tolerance.
export function scoutingBudget(team) {
  const market = team.market || 'medium';
  const tolerance = team.owner?.budgetTolerance ?? 50;
  const base = BUDGET_BASE[market] ?? BUDGET_BASE.medium;
  const mult = 0.7 + (tolerance / 100) * 0.6; // 0.7x-1.3x
  return clamp(Math.round((base * mult) / 50_000) * 50_000, 500_000, 2_000_000);
}

const SKILL_LABELS = {
  inside: 'finishing inside', mid: 'midrange touch', three: 'outside shooting',
  passing: 'passing', rebounding: 'rebounding', defense: 'defense', athleticism: 'athleticism',
};

function topSkills(p, n = 2) {
  return Object.entries(p.ratings).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => SKILL_LABELS[k]);
}

function weakestSkill(p) {
  const [k] = Object.entries(p.ratings).sort((a, b) => a[1] - b[1])[0];
  return SKILL_LABELS[k];
}

// Natural-language scout report. Vaguer the first time out, concrete once a
// player has been fully scouted (extended watch).
export function generateScoutReport(p, season, rng) {
  const watched = p.scout?.watched ?? 0;
  const [lo, hi] = scoutedOverallRange(p, season);
  const grade = potentialGrade(scoutedPotential(p, season, watched < EXTENDED_WATCH_COUNT));
  const strengths = topSkills(p, 2);

  if (watched <= 1) {
    return `Our scout caught ${p.name} (${p.pos}, ${p.age}, out of ${p.from}) on a recent trip. Early read: ${strengths[0]} stands out, projecting somewhere in the ${lo}-${hi} range with ${grade} long-term upside. He comes across as ${personalityNote(p)}, but our staff wants more looks.`;
  }
  if (watched === 2) {
    return `A second look at ${p.name} sharpens the picture: ${strengths.join(' and ')} are real strengths, and the overall now projects to ${lo}-${hi} with ${grade} upside. There are some whispers about his makeup — he's ${personalityNote(p)} — but nothing confirmed yet.`;
  }
  const ovr = overall(p);
  return `Extended report on ${p.name}: a true ${ovr} overall right now with ${strengths.join(' and ')} as his best tools and ${weakestSkill(p)} as the clear weakness. Potential grade: ${potentialGrade(p.potential)}. ${scoutBackstoryNote(p)}`;
}

// Called when the playoffs end and league.phase becomes 'offseason'. Seeds
// the draft prospect pool early (initDraft consumes this same array, scouting
// progress and all), assigns every team a budget, and lets the AI spend
// theirs immediately.
export function initScoutingPhase(league, rng) {
  const prospects = generateDraftClass(rng);
  const budgets = {};
  const reports = {};
  const watchlists = {};
  for (const team of league.teams) {
    budgets[team.id] = scoutingBudget(team);
    reports[team.id] = [];
    watchlists[team.id] = [];
  }
  league.scouting = { prospects, budgets, reports, watchlists };
  for (const team of league.teams) {
    if (team.id !== league.userTeamId) aiScoutTurn(league, team, rng);
  }
}

export function addReport(league, teamId, text, playerId = null) {
  const s = league.scouting;
  s.reports[teamId] = s.reports[teamId] ?? [];
  s.reports[teamId].unshift({ text, playerId });
}

// One "watch player" assignment: $50K-150K depending on region, ticks the
// prospect's scout.watched counter (3 = extended watch = full reveal).
export function watchPlayer(league, teamId, playerId) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting is not available right now.' };
  const p = s.prospects.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: 'Prospect not found.' };
  if ((p.scout.watched ?? 0) >= EXTENDED_WATCH_COUNT) return { ok: false, error: `${p.name} is already fully scouted.` };
  const region = regionFor(p);
  const cost = SCOUT_COSTS.watch[region] ?? SCOUT_COSTS.watch.Domestic;
  if ((s.budgets[teamId] ?? 0) < cost) return { ok: false, error: 'Not enough scouting budget.' };
  s.budgets[teamId] -= cost;
  p.scout.watched = (p.scout.watched ?? 0) + 1;
  if (!s.watchlists[teamId].includes(playerId)) s.watchlists[teamId].push(playerId);
  const rng = makeRng(league.seed + league.season * 80_001 + playerId * 13 + p.scout.watched * 7);
  const text = generateScoutReport(p, league.season, rng);
  addReport(league, teamId, text, playerId);
  return { ok: true, text };
}

// $300K, light fog reduction across every prospect from one region — cheap
// coverage, and the path by which a "regional sweep" can stumble onto an
// "undrafted gem" the rest of the league missed.
export function regionalSweep(league, teamId, region) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting is not available right now.' };
  if ((s.budgets[teamId] ?? 0) < SCOUT_COSTS.regional) return { ok: false, error: 'Not enough scouting budget.' };
  s.budgets[teamId] -= SCOUT_COSTS.regional;
  const targets = s.prospects.filter((p) => regionFor(p) === region);
  for (const p of targets) {
    if ((p.scout.watched ?? 0) < EXTENDED_WATCH_COUNT) p.scout.watched = (p.scout.watched ?? 0) + 1;
  }
  const text = `Our scouts swept ${region} prospects this round, sharpening our read on ${targets.length} player${targets.length === 1 ? '' : 's'}.`;
  addReport(league, teamId, text);
  return { ok: true, text };
}

// $400K — reveals which prospects two other teams have been watching.
export function poachIntel(league, teamId) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting is not available right now.' };
  if ((s.budgets[teamId] ?? 0) < SCOUT_COSTS.poach) return { ok: false, error: 'Not enough scouting budget.' };
  s.budgets[teamId] -= SCOUT_COSTS.poach;
  s.poachCount = (s.poachCount ?? 0) + 1;
  const rng = makeRng(league.seed + league.season * 90_001 + teamId * 31 + s.poachCount);
  const pool = league.teams.filter((t) => t.id !== teamId);
  const picks = [];
  for (let i = 0; i < 2 && pool.length; i++) picks.push(pool.splice(randInt(0, pool.length - 1, rng), 1)[0]);
  const lines = picks.map((t) => {
    const names = (s.watchlists[t.id] ?? [])
      .map((id) => s.prospects.find((p) => p.id === id)?.name)
      .filter(Boolean);
    return names.length
      ? `the ${t.city} ${t.name} have been scouting ${names.join(', ')}`
      : `the ${t.city} ${t.name} haven't tipped their hand on any prospects yet`;
  });
  const text = `Poach intel: ${lines.join('; ')}.`;
  addReport(league, teamId, text);
  return { ok: true, text };
}

// AI spend: contenders mostly watch the top available prospects (sure
// things); rebuilders lean on cheap regional sweeps, which is how a
// rebuilding team can end up reaching on (or missing) an "undrafted gem".
// Spends down to whatever's left under the cheapest action.
export function aiScoutTurn(league, team, rng) {
  const s = league.scouting;
  const prospects = [...s.prospects].sort((a, b) => scoutedOverall(b, league.season) - scoutedOverall(a, league.season));
  const sweepChance = team.strategy === 'rebuilding' ? 0.7 : 0.25;
  let guard = 0;
  while (guard++ < 60) {
    const budget = s.budgets[team.id] ?? 0;
    if (budget >= SCOUT_COSTS.regional && rng() < sweepChance) {
      regionalSweep(league, team.id, SCOUT_REGIONS[randInt(0, SCOUT_REGIONS.length - 1, rng)]);
      continue;
    }
    const target = prospects.find((p) => (p.scout.watched ?? 0) < EXTENDED_WATCH_COUNT
      && (SCOUT_COSTS.watch[regionFor(p)] ?? SCOUT_COSTS.watch.Domestic) <= budget);
    if (target) { watchPlayer(league, team.id, target.id); continue; }
    if (budget >= SCOUT_COSTS.regional) { regionalSweep(league, team.id, SCOUT_REGIONS[randInt(0, SCOUT_REGIONS.length - 1, rng)]); continue; }
    // Every prospect the budget can reach is already fully scouted (a common
    // late-budget state once the rest of the league has weighed in) — scouts
    // re-confirm a known prospect rather than sit idle.
    if (budget >= SCOUT_COSTS.watch.Domestic) {
      const recheck = [...prospects].sort(() => rng() - 0.5)[0];
      s.budgets[team.id] -= SCOUT_COSTS.watch.Domestic;
      if (recheck) addReport(league, team.id, `Our scouts re-confirmed their read on ${recheck.name} — nothing new to report.`, recheck.id);
      continue;
    }
    break;
  }
}
