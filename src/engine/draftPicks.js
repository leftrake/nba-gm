import { getTeam } from './league.js';
import { clamp } from './rng.js';

// ---------- Draft picks as tradeable assets ----------
// Every team always owns its own 1st- and 2nd-round picks for the next
// FUTURE_DRAFTS draft years; trades can move ownership around. A pick is
// identified by (season, round, originalTeamId) — the original team decides
// where the pick lands (its record sets the slot), while teamId tracks who
// currently owns it. Ids are deterministic so no counter is needed and the
// whole array is plain JSON for localStorage.

const ROUNDS = [1, 2];
export const FUTURE_DRAFTS = 4;

function pickId(season, round, originalTeamId) {
  return `${season}-${round}-${originalTeamId}`;
}

// Old saves (and a freshly created league, before createLeague seeds picks)
// won't have league.draftPicks — seed the next FUTURE_DRAFTS draft years on
// first access so nothing downstream has to special-case its absence.
export function ensureDraftPicks(league) {
  if (league.draftPicks) return;
  league.draftPicks = [];
  const start = league.season + 1;
  for (let i = 0; i < FUTURE_DRAFTS; i++) addFuturePicks(league, start + i);
}

// Give every team a fresh 1st and 2nd for the given draft season.
export function addFuturePicks(league, season) {
  for (const team of league.teams) {
    for (const round of ROUNDS) {
      league.draftPicks.push({ id: pickId(season, round, team.id), season, round, originalTeamId: team.id, teamId: team.id });
    }
  }
}

// Drop picks for a draft that just happened — they're consumed.
export function removeDraftedPicks(league, season) {
  league.draftPicks = league.draftPicks.filter((p) => p.season !== season);
}

export function findPick(league, id) {
  ensureDraftPicks(league);
  return league.draftPicks.find((p) => p.id === id);
}

// Every pick currently owned by a team, soonest first.
export function getTeamPicks(league, teamId) {
  ensureDraftPicks(league);
  return league.draftPicks
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => a.season - b.season || a.round - b.round);
}

// "2028 1st" or, if it came from another team in a trade, "2028 1st (via MIA)"
export function pickLabel(pick) {
  const ord = pick.round === 1 ? '1st' : '2nd';
  let label = `${pick.season} ${ord}`;
  if (pick.originalTeamId !== pick.teamId) label += ` (via ${pick.originalTeamId})`;
  return label;
}

// Where the original team's pick projects to land in its draft, based on
// in-progress record (or last season's, before the new season tips off).
// Slot 1 = worst record (best pick), slot 30 = best record.
// For picks further out, the team's strategy nudges the projection: a
// rebuilder is more likely to keep landing in the same range (or improve,
// as the rebuild bears fruit), while a contender's win% is more likely to
// regress as its roster ages — so the pick's value drifts accordingly the
// further out it is.
export function projectedSlot(league, originalTeamId, yearsOut = 0) {
  const team = getTeam(league, originalTeamId);
  const gp = team.wins + team.losses;
  let winPct = gp > 0 ? team.wins / gp : (team.lastWins ?? 41) / 82;
  if (yearsOut > 0) {
    const drift = team.strategy === 'rebuilding' ? 0.04 : team.strategy === 'contending' ? -0.04 : 0;
    winPct = clamp(winPct + drift * yearsOut, 0.1, 0.9);
  }
  return clamp(Math.round(1 + (1 - winPct) * 29), 1, 30);
}

// Trade value of a future pick: a 1st projects to a prospect somewhere
// between a late-lottery talent (slot 1) and a fringe rotation piece (slot
// 30), with an upside premium since the player is still unknown. 2nds are
// cheap sweeteners regardless of slot. Further-out picks are discounted —
// next year's pick is worth more than one three years out, which carries a
// lot more uncertainty about where the original team will land.
export function pickValue(league, pick, strategy) {
  const nextDraftSeason = league.season + 1;
  const yearsOut = Math.max(0, pick.season - nextDraftSeason);
  const slot = projectedSlot(league, pick.originalTeamId, yearsOut);
  let base;
  if (pick.round === 1) {
    const expectedOvr = 75 - (slot - 1) * (15 / 29);
    base = Math.pow(Math.max(expectedOvr - 40, 1), 2.4) * 1.4;
  } else {
    base = 40 + Math.max(0, 30 - slot) * 2;
  }
  const discount = Math.max(0.35, 1 - yearsOut * 0.18);
  let v = base * discount;
  // rebuilders covet picks; contenders would rather have the player now
  if (strategy === 'rebuilding') v *= 1.3;
  else if (strategy === 'contending') v *= 0.85;
  return Math.round(v);
}

// Stepien rule: a team can never trade away its 1st-round picks in two
// consecutive draft years. Checks whether trading away the given pick ids
// would leave any of the team's outgoing 1sts with no adjacent-year 1st
// still in hand.
export function violatesStepien(league, teamId, outgoingPickIds) {
  if (!outgoingPickIds.length) return false;
  const picks = getTeamPicks(league, teamId);
  const remainingFirstSeasons = new Set(
    picks.filter((p) => p.round === 1 && !outgoingPickIds.includes(p.id)).map((p) => p.season),
  );
  const tradedFirsts = picks.filter((p) => p.round === 1 && outgoingPickIds.includes(p.id));
  return tradedFirsts.some((p) => !remainingFirstSeasons.has(p.season - 1) && !remainingFirstSeasons.has(p.season + 1));
}
