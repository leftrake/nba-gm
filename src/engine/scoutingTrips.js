import { randInt, clamp, makeRng } from './rng.js';
import { overall, getNextPlayerId, resetPlayerIds } from './players.js';
import { generateDraftClass } from './draft.js';
import { scoutedOverallRange, scoutedOverall, scoutedPotential, potentialGrade, scoutUncertainty, getDraftPoints } from './scouting.js';
import { regionFor, SCOUT_REGIONS, personalityNote, scoutBackstoryNote } from './backstory.js';

// ---------- Two-track scouting system ----------
//
// DRAFT TRACK — budget-based. International prospects are hidden until
//   discovered (regional scout or one-time sweep). After discovery:
//   0 draftPoints → "?"; missions add points; ±15 → ±2 at 100 pts.
//
// PRO TRACK — time-based, no budget. Mark up to 6 players on watch list;
//   each simmed game-day adds film. Film removes up to 50% of the
//   career-minutes-based baseline uncertainty.
//
// SCOUTS — up to 4 per team; salaries deducted from annual budget first.
//   Types: regional (auto-discover a region), sleeper finder, big board
//   analyst, draft range specialist. Hired/fired during the offseason only.

// ---- Scout definitions ----

export const SCOUT_TYPES = {
  regional:        { salary: 150_000, label: 'Regional Scout' },
  sleeper:         { salary: 100_000, label: 'Sleeper Finder' },
  bigBoard:        { salary: 125_000, label: 'Big Board Analyst' },
  rangeSpecialist: { salary:  75_000, label: 'Draft Range Specialist' },
};
export const MAX_SCOUTS = 4;
export const PRO_WATCH_SLOTS = 6;
export const PRO_SCOUT_PERSONALITY_THRESHOLD = 20;

// ---- Mission costs ----

// One-time regional discovery (international only — domestic always visible)
export const SWEEP_COSTS = {
  Europe: 150_000,
  'Latin America': 150_000,
  Africa: 225_000,
  'Asia-Pacific': 225_000,
};

export const WORKOUT_COSTS    = { Domestic: 60_000, Europe: 100_000, 'Latin America': 100_000, Africa: 120_000, 'Asia-Pacific': 120_000 };
export const GAME_WATCH_COSTS = { Domestic: 25_000, Europe: 40_000,  'Latin America': 40_000,  Africa: 50_000,  'Asia-Pacific': 50_000  };
export const POACH_COST = 400_000;

export const DRAFT_POINTS_WORKOUT    = 60;
export const DRAFT_POINTS_GAME_WATCH = 25;
export const DRAFT_POINTS_SWEEP      = 75; // points granted to all prospects in a swept region
export const DRAFT_POINTS_COMBINE    = 25; // free baseline given to every domestic prospect via the annual combine
export const DRAFT_POINTS_MAX        = 100;

// Legacy compat
export const DRAFT_SCOUT_COSTS = {
  workout:  WORKOUT_COSTS,
  gameWatch: GAME_WATCH_COSTS,
  regional: 300_000,
  poach:    POACH_COST,
};
export const PRO_SCOUT_GAMES_FULL = 20;
export const EXTENDED_WATCH_COUNT = 3;

// ---- Budget ----

const BUDGET_BASE = { small: 750_000, medium: 1_500_000, large: 2_000_000 };

export function scoutingBudget(team) {
  const market = team.market || 'medium';
  const tolerance = team.owner?.budgetTolerance ?? 50;
  const base = BUDGET_BASE[market] ?? BUDGET_BASE.medium;
  const mult = 0.7 + (tolerance / 100) * 0.6;
  return clamp(Math.round((base * mult) / 50_000) * 50_000, 500_000, 2_500_000);
}

export function totalScoutSalary(scouts) {
  return (scouts ?? []).reduce((sum, s) => sum + s.salary, 0);
}

// Adds points to one team's entry in a prospect's per-team draftPoints map,
// clamped to DRAFT_POINTS_MAX. Each team's missions only ever move their own
// entry — never another team's view of the same prospect.
function addDraftPoints(p, teamId, delta) {
  if (!p.scout || typeof p.scout.draftPoints !== 'object' || p.scout.draftPoints == null) {
    p.scout = { ...p.scout, draftPoints: {} };
  }
  const next = Math.min(DRAFT_POINTS_MAX, getDraftPoints(p, teamId) + delta);
  p.scout.draftPoints[teamId] = next;
  return next;
}

// ---- Discovery ----

function getAllDraftProspects(league) {
  return [
    ...(league.scouting?.prospects ?? []),
    ...(league.scouting?.draftBoard ?? []).flatMap((dc) => dc.prospects),
  ];
}

// Domestic prospects are always visible. International prospects must be
// discovered via a regional scout or one-time sweep mission.
export function isDiscovered(p, teamId, league) {
  if (regionFor(p) === 'Domestic') return true;
  return (league.scouting?.discovered?.[teamId] ?? []).includes(p.id);
}

function discoverProspects(league, teamId, prospects) {
  const s = league.scouting;
  if (!s.discovered) s.discovered = {};
  if (!s.discovered[teamId]) s.discovered[teamId] = [];
  let count = 0;
  for (const p of prospects) {
    if (!s.discovered[teamId].includes(p.id)) {
      s.discovered[teamId].push(p.id);
      count++;
    }
  }
  return count;
}

// ---- Scout management ----

export function getScouts(league, teamId) {
  return league.scouting?.scouts?.[teamId] ?? [];
}

export function hireScout(league, teamId, type, qualifier = null) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting not available.' };
  if (!s.scouts) s.scouts = {};
  if (!s.scouts[teamId]) s.scouts[teamId] = [];
  const scouts = s.scouts[teamId];
  if (scouts.length >= MAX_SCOUTS) return { ok: false, error: `Maximum ${MAX_SCOUTS} scouts per team.` };
  const typeDef = SCOUT_TYPES[type];
  if (!typeDef) return { ok: false, error: 'Unknown scout type.' };

  if (type === 'sleeper' && scouts.some((sc) => sc.type === 'sleeper'))
    return { ok: false, error: 'Already have a Sleeper Finder.' };
  if (type === 'bigBoard' && scouts.some((sc) => sc.type === 'bigBoard'))
    return { ok: false, error: 'Already have a Big Board Analyst.' };
  if (type === 'regional') {
    const valid = ['Europe', 'Latin America', 'Africa', 'Asia-Pacific'];
    if (!valid.includes(qualifier)) return { ok: false, error: 'Invalid region.' };
    if (scouts.some((sc) => sc.type === 'regional' && sc.region === qualifier))
      return { ok: false, error: `Already have a Regional Scout for ${qualifier}.` };
  }
  if (type === 'rangeSpecialist') {
    if (!['lottery', 'secondRound'].includes(qualifier))
      return { ok: false, error: 'Specify lottery or secondRound.' };
    if (scouts.some((sc) => sc.type === 'rangeSpecialist' && sc.range === qualifier))
      return { ok: false, error: `Already have a Range Specialist for that range.` };
  }

  const scout = { type, salary: typeDef.salary, hiredSeason: league.season };
  if (type === 'regional') scout.region = qualifier;
  if (type === 'rangeSpecialist') scout.range = qualifier;
  scouts.push(scout);
  if (type === 'bigBoard') refreshBigBoard(league, teamId);
  return { ok: true };
}

export function fireScout(league, teamId, type, qualifier = null) {
  const scouts = league.scouting?.scouts?.[teamId];
  if (!scouts) return { ok: false, error: 'No scouts on staff.' };
  const idx = scouts.findIndex((sc) => {
    if (sc.type !== type) return false;
    if (type === 'regional') return sc.region === qualifier;
    if (type === 'rangeSpecialist') return sc.range === qualifier;
    return true;
  });
  if (idx === -1) return { ok: false, error: 'Scout not found.' };
  scouts.splice(idx, 1);
  return { ok: true };
}

// ---- Scout effects ----

// Called each offseason in initScoutingPhase: auto-discovers regions for
// teams with regional scouts, applies range specialist baseline points,
// and (re)generates sleeper picks and big board ranks.
function applyScoutEffects(league, teamId, rng) {
  const s = league.scouting;
  const scouts = s.scouts?.[teamId] ?? [];
  if (!s.discovered) s.discovered = {};
  if (!s.sleeperPicks) s.sleeperPicks = {};
  if (!s.bigBoardRanks) s.bigBoardRanks = {};

  const allProspects = getAllDraftProspects(league);

  // Regional scouts: auto-discover their region across all board classes
  for (const sc of scouts) {
    if (sc.type === 'regional') {
      discoverProspects(league, teamId, allProspects.filter((p) => regionFor(p) === sc.region));
    }
  }

  // Range specialists: +10 draftPoints to already-discovered prospects in range
  const rangeScouts = scouts.filter((sc) => sc.type === 'rangeSpecialist');
  if (rangeScouts.length) {
    const disc = allProspects.filter((p) => isDiscovered(p, teamId, league));
    const sorted = [...disc].sort((a, b) => scoutedOverall(b, league.season, teamId) - scoutedOverall(a, league.season, teamId));
    for (const sc of rangeScouts) {
      const targets = sc.range === 'lottery' ? sorted.slice(0, 14) : sorted.slice(30, 60);
      for (const p of targets) {
        const pts = getDraftPoints(p, teamId);
        if (pts > 0 && pts < DRAFT_POINTS_MAX) addDraftPoints(p, teamId, 10);
      }
    }
  }

  // Sleeper finder: flags 3–5 high-potential under-scouted discovered prospects
  if (scouts.some((sc) => sc.type === 'sleeper')) {
    const disc = allProspects.filter((p) => isDiscovered(p, teamId, league));
    const candidates = disc
      .filter((p) => getDraftPoints(p, teamId) < 40 && p.potential >= 74)
      .sort((a, b) => b.potential - a.potential);
    const count = 3 + Math.floor(rng() * 3);
    s.sleeperPicks[teamId] = candidates.slice(0, count).map((p) => p.id);
  } else {
    s.sleeperPicks[teamId] = [];
  }

  refreshBigBoard(league, teamId);
}

// Recompute the big board ranks for a single team. Called after hiring the
// analyst and after each scouting action so the board stays current.
function refreshBigBoard(league, teamId) {
  const s = league.scouting;
  if (!s.bigBoardRanks) s.bigBoardRanks = {};
  const scouts = s.scouts?.[teamId] ?? [];
  if (!scouts.some((sc) => sc.type === 'bigBoard')) {
    s.bigBoardRanks[teamId] = [];
    return;
  }
  const team = league.teams.find((t) => t.id === teamId);
  const currentProspects = s.prospects ?? [];
  const disc = currentProspects.filter((p) => isDiscovered(p, teamId, league));
  const posCounts = {};
  for (const rp of team?.roster ?? []) posCounts[rp.pos] = (posCounts[rp.pos] ?? 0) + 1;
  const scored = disc.map((p) => {
    let score = scoutedOverall(p, league.season, teamId);
    const cnt = posCounts[p.pos] ?? 0;
    if (cnt <= 1) score += 5;
    else if (cnt <= 2) score += 2;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  s.bigBoardRanks[teamId] = scored.slice(0, 20).map(({ p }) => p.id);
}

// ---- Draft Combine ----

// Annual automatic event: every domestic prospect in the current draft class
// gets a free baseline scouting bump for all teams. Simulates the public
// pre-draft combine — no budget cost, runs once per offseason when the class
// is promoted. International prospects aren't eligible (they have their own
// regional discovery path).
function runDraftCombine(league) {
  const s = league.scouting;
  const domestic = (s.prospects ?? []).filter((p) => regionFor(p) === 'Domestic');
  if (!domestic.length) return;
  for (const team of league.teams) {
    for (const p of domestic) addDraftPoints(p, team.id, DRAFT_POINTS_COMBINE);
  }
  addReport(league, league.userTeamId,
    `Draft Combine complete — ${domestic.length} domestic prospects received a baseline evaluation (all teams +${DRAFT_POINTS_COMBINE} pts).`);
}

// ---- Season initialization ----

// Called at the start of each regular season (startNewSeason).
// Scout salaries are deducted from the annual budget before missions start.
export function initSeasonScouting(league, rng) {
  const prev = league.scouting ?? {};
  const budgets = {};
  const budgetTotals = {};
  const reports = {};
  for (const team of league.teams) {
    const annual = scoutingBudget(team);
    const scouts = prev.scouts?.[team.id] ?? [];
    budgetTotals[team.id] = annual;
    budgets[team.id] = Math.max(0, annual - totalScoutSalary(scouts));
    reports[team.id] = [];
  }
  league.scouting = {
    prospects:    prev.prospects    ?? [],
    budgets,
    budgetTotals,
    reports,
    // Carry watchlists forward so poach intel works during the regular season.
    // Stale entries (drafted prospects no longer in the pool) are skipped
    // gracefully in poachIntel when the prospect can't be found.
    watchlists:   prev.watchlists   ?? {},
    scouts:       prev.scouts       ?? {},
    discovered:   prev.discovered   ?? {},
    domesticSweepUsed: prev.domesticSweepUsed ?? {},
    draftBoard:   prev.draftBoard   ?? [],
    proWatching:  prev.proWatching   ?? {},
    proWatchList: prev.proWatchList  ?? [],
    proReports:   prev.proReports    ?? [],
    sleeperPicks: prev.sleeperPicks ?? {},
    bigBoardRanks: prev.bigBoardRanks ?? {},
    poachCount:   0,
  };
}

// ---- Draft board rotation ----

// Remaps scouting references when a prospect's negative board ID is replaced
// with a real positive ID at class-promotion time.
function remapScoutingId(league, oldId, newId) {
  const s = league.scouting;
  for (const tid of Object.keys(s.watchlists ?? {})) {
    const arr = s.watchlists[tid] ?? [];
    const i = arr.indexOf(oldId);
    if (i !== -1) arr[i] = newId;
  }
  if (s.proWatching?.[oldId] !== undefined) {
    s.proWatching[newId] = s.proWatching[oldId];
    delete s.proWatching[oldId];
  }
  if (s.proWatchList) {
    const i = s.proWatchList.indexOf(oldId);
    if (i !== -1) s.proWatchList[i] = newId;
  }
  for (const tid of Object.keys(s.discovered ?? {})) {
    const arr = s.discovered[tid] ?? [];
    const i = arr.indexOf(oldId);
    if (i !== -1) arr[i] = newId;
  }
  for (const tid of Object.keys(s.sleeperPicks ?? {})) {
    const arr = s.sleeperPicks[tid] ?? [];
    const i = arr.indexOf(oldId);
    if (i !== -1) arr[i] = newId;
  }
  for (const tid of Object.keys(s.bigBoardRanks ?? {})) {
    const arr = s.bigBoardRanks[tid] ?? [];
    const i = arr.indexOf(oldId);
    if (i !== -1) arr[i] = newId;
  }
}

// Called when playoffs end. Promotes the current season's pre-scouted class
// (or generates a fresh one), adds a future class to the board, applies
// scout effects, and runs AI scouting missions.
export function initScoutingPhase(league, rng) {
  if (!league.scouting) initSeasonScouting(league, rng);
  const s = league.scouting;
  if (!s.scouts)       s.scouts       = {};
  if (!s.discovered)   s.discovered   = {};
  if (!s.sleeperPicks) s.sleeperPicks = {};
  if (!s.bigBoardRanks) s.bigBoardRanks = {};

  // Reset draft watchlists for the new class so each offseason starts fresh.
  // AI teams will repopulate their watchlists via aiScoutTurn below, and those
  // watchlists persist into the regular season so poach intel works year-round.
  s.watchlists = {};
  for (const team of league.teams) s.watchlists[team.id] = [];

  // AI teams adjust their scout rosters each offseason
  for (const team of league.teams) {
    if (team.id !== league.userTeamId) aiHireScouts(league, team, rng);
  }

  // Promote the upcoming draft class from the board. This is called at the END
  // of playoffs, before advanceOffseason increments league.season, so the class
  // being drafted next is draftSeason === league.season + 1. Filter out any
  // stale entries (draftSeason <= league.season) accumulated from old saves.
  const board = (s.draftBoard ?? []).filter((dc) => dc.draftSeason > league.season);
  if (board.length > 0 && board[0].draftSeason === league.season + 1) {
    const current = board.shift();
    let counter = league.nextPlayerId ?? getNextPlayerId();
    for (const p of current.prospects) {
      if (p.id < 0) {
        const newId = counter++;
        remapScoutingId(league, p.id, newId);
        p.id = newId;
      }
    }
    resetPlayerIds(counter);
    league.nextPlayerId = counter;
    s.prospects = current.prospects;
  } else {
    resetPlayerIds(league.nextPlayerId ?? getNextPlayerId());
    s.prospects = generateDraftClass(rng);
    league.nextPlayerId = getNextPlayerId();
  }

  // Keep 2 future classes on the board (one in s.prospects + two here = 3 visible total)
  const futureSeason = league.season + 3;
  if (!board.some((dc) => dc.draftSeason === futureSeason)) {
    const futureRng = makeRng(league.seed + futureSeason * 70_007 + 555_001);
    board.push({ draftSeason: futureSeason, prospects: generateDraftClass(futureRng, { boardSeason: futureSeason }) });
  }
  s.draftBoard = board;

  // Annual Draft Combine: free baseline bump for all domestic prospects in the current class
  runDraftCombine(league);

  // Apply scout effects for all teams (auto-discover, +10 pts, sleepers, big board)
  for (const team of league.teams) {
    const effectRng = makeRng(league.seed + league.season * 55_003 + team.id.charCodeAt(0) * 7);
    applyScoutEffects(league, team.id, effectRng);
  }

  // AI teams spend their missions budget
  for (const team of league.teams) {
    if (team.id !== league.userTeamId) aiScoutTurn(league, team, rng);
  }
}

// Generate 2 future draft classes at league creation (uses negative IDs so
// the main player-ID counter is not advanced, keeping the simulation deterministic).
export function initDraftBoard(league, rng) {
  const board = [];
  for (let i = 1; i <= 2; i++) {
    const futureSeason = league.season + i;
    const classRng = makeRng(league.seed + futureSeason * 70_007 + 555_001);
    board.push({ draftSeason: futureSeason, prospects: generateDraftClass(classRng, { boardSeason: futureSeason }) });
  }
  league.scouting.draftBoard = board;
}

// ---- Report generation ----

const SKILL_LABELS = {
  closeShot: 'finishing inside', midRange: 'midrange touch', threePoint: 'outside shooting', freeThrow: 'free-throw shooting',
  passing: 'passing', ballHandling: 'ball-handling',
  perimeterDefense: 'perimeter defense', interiorDefense: 'rim protection', steal: 'ball-hawking', block: 'shot-blocking',
  offensiveRebounding: 'offensive rebounding', defensiveRebounding: 'defensive rebounding',
  speed: 'quickness', strength: 'physicality',
};

function workoutPhysicalNote(p) {
  const r = p.ratings;
  if (r.speed >= 80) return 'tested explosively above average';
  if (r.strength >= 80) return 'physical tools already look NBA-ready';
  if (r.speed < 48)    return 'not the most explosive athlete — will need to rely on skill';
  if (r.strength < 48) return 'still needs to add bulk before the next level';
  return 'athletic profile checks the boxes';
}

function gameWatchNarrativeNote(p, rng) {
  const r = p.ratings;
  const notes = [];
  if (r.threePoint >= 76)        notes.push('knocked down pull-up threes off movement');
  if (r.block >= 76)             notes.push('altered shots around the rim all night');
  if (r.steal >= 76)             notes.push('active hands — created turnovers in the passing lanes');
  if (r.passing >= 78)           notes.push('made the right read on nearly every possession');
  if (r.offensiveRebounding >= 76) notes.push('relentless on the offensive glass, found angles others missed');
  if (r.speed >= 80)             notes.push('pace of play was a tier above the competition');
  if (r.strength >= 78)          notes.push('physical play stood out — stronger than most at this level');
  if (r.closeShot >= 78)         notes.push('finished through contact inside the arc');
  if (r.ballHandling >= 78)      notes.push('showed excellent ball security under pressure');
  if (r.defensiveRebounding >= 78) notes.push('owned the defensive glass all night');
  if (r.midRange >= 78)          notes.push('hit tough pull-ups in the midrange consistently');
  if (r.perimeterDefense >= 78)  notes.push('held assignments in check on the perimeter');
  if (r.interiorDefense >= 78)   notes.push("presence around the rim disrupted the whole offense");
  if (r.freeThrow < 45)          notes.push('free throws were a liability — could get intentionally fouled at the next level');
  if (r.perimeterDefense < 45 && ['PG', 'SG', 'SF'].includes(p.pos))
    notes.push('gave up too many buckets on the perimeter — defensive improvement needed');

  if (notes.length) return notes[Math.floor(rng() * notes.length)];
  const ovr = overall(p);
  if (ovr >= 80) return 'overall impact was obvious from the opening tip';
  if (ovr >= 70) return 'held their own and showed why they belong on the board';
  return 'showed flashes worth continued tracking';
}

function generateWorkoutReport(p, season, rng, teamId) {
  const pts = getDraftPoints(p, teamId);
  const [lo, hi] = scoutedOverallRange(p, season, teamId);
  const grade = potentialGrade(scoutedPotential(p, season, pts < DRAFT_POINTS_MAX, teamId));
  const [topKey, topVal] = Object.entries(p.ratings).sort((a, b) => b[1] - a[1])[0];
  const noise = pts >= 75 ? 3 : pts >= 45 ? 6 : 12;
  const foggedVal = clamp(topVal + Math.round((rng() - 0.5) * noise * 2), 25, 99);
  return `Private workout — ${p.name} (${p.pos}): ${SKILL_LABELS[topKey]} immediately stood out, grades at ~${foggedVal}. ${workoutPhysicalNote(p)}. Projects ${lo}–${hi} OVR, ${grade} ceiling.`;
}

function generateGameWatchReport(p, season, rng, teamId) {
  const pts = getDraftPoints(p, teamId);
  const [lo, hi] = scoutedOverallRange(p, season, teamId);
  const grade = potentialGrade(scoutedPotential(p, season, pts < DRAFT_POINTS_MAX, teamId));
  const note = gameWatchNarrativeNote(p, rng);
  const projection = pts >= 75
    ? `Full read: ${overall(p)} OVR, ${grade} ceiling.`
    : `Projects ${lo}–${hi} OVR, ${grade} upside.`;
  return `Watched ${p.name} (${p.pos}, ${p.from}): ${note}. ${projection}`;
}

function generateProScoutReport(league, p, gamesWatched) {
  const team = league.teams.find((t) => t.roster.some((x) => x.id === p.id));
  const where = team ? `${team.city} ${team.name}` : 'free agent';
  return `After ${gamesWatched} game-days of film on ${p.name} (${where}): ${scoutBackstoryNote(p)}`;
}

export function addReport(league, teamId, text, playerId = null) {
  const s = league.scouting;
  s.reports[teamId] = s.reports[teamId] ?? [];
  s.reports[teamId].unshift({ text, playerId });
}

// ---- Target finders ----

function findDraftProspect(league, playerId) {
  for (const p of (league.scouting?.prospects ?? [])) {
    if (p.id === playerId) return p;
  }
  for (const dc of (league.scouting?.draftBoard ?? [])) {
    for (const p of dc.prospects) {
      if (p.id === playerId) return p;
    }
  }
  return null;
}

function findLeaguePlayer(league, playerId) {
  for (const team of league.teams) {
    const p = team.roster.find((x) => x.id === playerId);
    if (p) return p;
  }
  return league.freeAgents.find((x) => x.id === playerId) ?? null;
}

function findScoutTarget(league, playerId) {
  return findDraftProspect(league, playerId) ?? findLeaguePlayer(league, playerId);
}

// ---- Draft missions ----

function runDraftMission(league, teamId, playerId, points, cost, reportFn) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting not available.' };
  const p = findDraftProspect(league, playerId);
  if (!p) return { ok: false, error: 'Prospect not on draft board.' };
  if (!isDiscovered(p, teamId, league))
    return { ok: false, error: 'Prospect not yet discovered — sweep the region first.' };
  const pts = getDraftPoints(p, teamId);
  if (pts >= DRAFT_POINTS_MAX) return { ok: false, error: `${p.name} is already fully scouted.` };
  if ((s.budgets[teamId] ?? 0) < cost) return { ok: false, error: 'Not enough scouting budget.' };
  s.budgets[teamId] -= cost;
  addDraftPoints(p, teamId, points);
  if (!s.watchlists[teamId]) s.watchlists[teamId] = [];
  if (!s.watchlists[teamId].includes(playerId)) s.watchlists[teamId].push(playerId);
  const rng = makeRng(league.seed + league.season * 80_001 + playerId * 13 + Math.floor((pts + points) / 10));
  const text = reportFn(p, league.season, rng, teamId);
  addReport(league, teamId, text, playerId);
  refreshBigBoard(league, teamId);
  return { ok: true, text };
}

export function workoutProspect(league, teamId, playerId) {
  const p = findDraftProspect(league, playerId);
  if (!p) return { ok: false, error: 'Prospect not found.' };
  const region = regionFor(p);
  return runDraftMission(league, teamId, playerId, DRAFT_POINTS_WORKOUT, WORKOUT_COSTS[region] ?? WORKOUT_COSTS.Domestic, generateWorkoutReport);
}

export function gameWatchProspect(league, teamId, playerId) {
  const p = findDraftProspect(league, playerId);
  if (!p) return { ok: false, error: 'Prospect not found.' };
  const region = regionFor(p);
  return runDraftMission(league, teamId, playerId, DRAFT_POINTS_GAME_WATCH, GAME_WATCH_COSTS[region] ?? GAME_WATCH_COSTS.Domestic, generateGameWatchReport);
}

// One-time discovery mission for an international region.
// Reveals all prospects across all draft classes from that region.
export function sweepRegion(league, teamId, region) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting not available.' };
  if (region === 'Domestic') return { ok: false, error: 'Domestic prospects are always visible.' };
  const cost = SWEEP_COSTS[region];
  if (!cost) return { ok: false, error: 'Unknown region.' };
  if ((s.budgets[teamId] ?? 0) < cost) return { ok: false, error: 'Not enough scouting budget.' };
  const all = getAllDraftProspects(league);
  const targets = all.filter((p) => regionFor(p) === region);
  const newCount = discoverProspects(league, teamId, targets);
  // Grant scouting points to every prospect in the region — the sweep team
  // spends real time with each player, not just a name-check.
  for (const p of targets) addDraftPoints(p, teamId, DRAFT_POINTS_SWEEP);
  s.budgets[teamId] -= cost;
  const text = `Scouting sweep of ${region}: ${newCount} new prospect${newCount === 1 ? '' : 's'} discovered, all evaluated (${DRAFT_POINTS_SWEEP} scouting pts each).`;
  addReport(league, teamId, text);
  refreshBigBoard(league, teamId);
  return { ok: true, text, discovered: newCount };
}

export function poachIntel(league, teamId) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting not available.' };
  if ((s.budgets[teamId] ?? 0) < POACH_COST) return { ok: false, error: 'Not enough scouting budget.' };
  s.budgets[teamId] -= POACH_COST;
  s.poachCount = (s.poachCount ?? 0) + 1;
  const rng = makeRng(league.seed + league.season * 90_001 + teamId.charCodeAt(0) * 31 + s.poachCount);
  const pool = league.teams.filter((t) => t.id !== teamId);
  const picks = [];
  for (let i = 0; i < 2 && pool.length; i++) picks.push(pool.splice(randInt(0, pool.length - 1, rng), 1)[0]);
  const all = [...(s.prospects ?? []), ...(s.draftBoard ?? []).flatMap((dc) => dc.prospects)];
  const lines = picks.map((t) => {
    const revealed = [];
    for (const id of (s.watchlists[t.id] ?? [])) {
      const prospect = all.find((p) => p.id === id);
      if (!prospect) continue;
      // Poach intel also discovers previously unknown prospects
      if (!isDiscovered(prospect, teamId, league)) {
        discoverProspects(league, teamId, [prospect]);
        revealed.push(`${prospect.name} (newly discovered)`);
      } else {
        revealed.push(prospect.name);
      }
    }
    return revealed.length
      ? `the ${t.city} ${t.name} are tracking ${revealed.join(', ')}`
      : `the ${t.city} ${t.name} haven't tipped their hand`;
  });
  const text = `Poach intel: ${lines.join('; ')}.`;
  addReport(league, teamId, text);
  return { ok: true, text };
}

// Legacy alias
export function regionalSweep(league, teamId, region) {
  return sweepRegion(league, teamId, region);
}

// ---- Pro scouting track ----

export function markProWatch(league, playerId) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting not available.' };
  if (!s.proWatchList) s.proWatchList = [];
  if (s.proWatchList.includes(playerId)) return { ok: false, error: 'Already watching.' };
  if (s.proWatchList.length >= PRO_WATCH_SLOTS)
    return { ok: false, error: `Watch list full (${PRO_WATCH_SLOTS} slots). Remove a player first.` };
  s.proWatchList.push(playerId);
  return { ok: true };
}

export function removeProWatch(league, playerId) {
  const s = league.scouting;
  if (!s) return { ok: false, error: 'Scouting not available.' };
  s.proWatchList = (s.proWatchList ?? []).filter((id) => id !== playerId);
  return { ok: true };
}

// Called once per simDay. Increments film count for each watched player
// and triggers personality reveal at threshold.
export function tickProScouting(league) {
  const s = league.scouting;
  if (!s?.proWatchList?.length) return;
  if (!s.proWatching) s.proWatching = {};
  if (!s.proReports) s.proReports = [];
  const activeIds = new Set([
    ...league.teams.flatMap((t) => t.roster.map((p) => p.id)),
    ...league.teams.flatMap((t) => (t.twoWay || []).map((p) => p.id)),
    ...league.freeAgents.map((p) => p.id),
  ]);
  s.proWatchList = s.proWatchList.filter((id) => activeIds.has(id));
  for (const id of s.proWatchList) {
    const prev = s.proWatching[id] ?? 0;
    s.proWatching[id] = prev + 1;
    if (prev < PRO_SCOUT_PERSONALITY_THRESHOLD && s.proWatching[id] >= PRO_SCOUT_PERSONALITY_THRESHOLD) {
      const p = findScoutTarget(league, id);
      if (p) s.proReports.unshift({ text: generateProScoutReport(league, p, s.proWatching[id]), playerId: id });
    }
  }
}

// Legacy alias
export function watchPlayer(league, teamId, playerId) {
  return gameWatchProspect(league, teamId, playerId);
}

// ---- AI scout hiring ----

const REBUILD_PREFS = ['regional', 'regional', 'sleeper', 'rangeSpecialist'];
const CONTEND_PREFS = ['bigBoard', 'rangeSpecialist', 'regional', 'sleeper'];
const RETOOL_PREFS  = ['regional', 'bigBoard', 'rangeSpecialist', 'sleeper'];

function aiHireScouts(league, team, rng) {
  const s = league.scouting;
  if (!s.scouts) s.scouts = {};
  if (!s.scouts[team.id]) s.scouts[team.id] = [];
  const scouts = s.scouts[team.id];
  const annual = scoutingBudget(team);
  const maxSalary = annual * 0.55; // keep at most 55% for salaries

  // Drop scouts we can no longer afford (newest first)
  while (scouts.length > 0 && totalScoutSalary(scouts) > maxSalary) {
    scouts.sort((a, b) => b.hiredSeason - a.hiredSeason);
    scouts.splice(0, 1);
  }

  // Try to hire one more scout if budget and roster allow
  if (scouts.length >= MAX_SCOUTS) return;
  const prefs = team.strategy === 'rebuilding' ? REBUILD_PREFS
              : team.strategy === 'contending' ? CONTEND_PREFS
              : RETOOL_PREFS;

  for (const type of prefs) {
    const cost = SCOUT_TYPES[type]?.salary ?? 0;
    if (totalScoutSalary(scouts) + cost > maxSalary) continue;
    let qualifier = null;
    if (type === 'regional') {
      const covered = scouts.filter((sc) => sc.type === 'regional').map((sc) => sc.region);
      const avail = ['Europe', 'Latin America', 'Africa', 'Asia-Pacific'].filter((r) => !covered.includes(r));
      if (!avail.length) continue;
      qualifier = avail[randInt(0, avail.length - 1, rng)];
    } else if (type === 'rangeSpecialist') {
      const hasCov = scouts.some((sc) => sc.type === 'rangeSpecialist');
      if (hasCov) continue;
      qualifier = team.strategy === 'rebuilding' ? 'secondRound' : 'lottery';
    } else if (type === 'sleeper' && scouts.some((sc) => sc.type === 'sleeper')) {
      continue;
    } else if (type === 'bigBoard' && scouts.some((sc) => sc.type === 'bigBoard')) {
      continue;
    }
    const result = hireScout(league, team.id, type, qualifier);
    if (result.ok) break;
  }
}

// ---- AI mission spending ----

export function aiScoutTurn(league, team, rng) {
  const s = league.scouting;
  if (!s.prospects?.length) return;

  const allDisc = s.prospects.filter((p) => isDiscovered(p, team.id, league));
  const targets = [...allDisc].sort((a, b) => scoutedOverall(b, league.season, team.id) - scoutedOverall(a, league.season, team.id));

  const intlRegions = ['Europe', 'Latin America', 'Africa', 'Asia-Pacific'];
  const sweepChance = team.strategy === 'rebuilding' ? 0.3 : 0.1;
  let guard = 0;
  while (guard++ < 80) {
    const budget = s.budgets[team.id] ?? 0;

    // Occasionally sweep an uncovered international region
    const unswept = intlRegions.find((r) => {
      if ((s.scouts?.[team.id] ?? []).some((sc) => sc.type === 'regional' && sc.region === r)) return false;
      return s.prospects.some((p) => regionFor(p) === r && !isDiscovered(p, team.id, league));
    });
    if (unswept && budget >= (SWEEP_COSTS[unswept] ?? Infinity) && rng() < sweepChance) {
      sweepRegion(league, team.id, unswept);
      continue;
    }

    // Scout undiscovered prospects via missions
    const target = targets.find((p) => getDraftPoints(p, team.id) < DRAFT_POINTS_MAX);
    if (target) {
      const region = regionFor(target);
      const wkCost = WORKOUT_COSTS[region] ?? WORKOUT_COSTS.Domestic;
      const gwCost = GAME_WATCH_COSTS[region] ?? GAME_WATCH_COSTS.Domestic;
      if (budget >= wkCost && rng() < 0.4) { workoutProspect(league, team.id, target.id); continue; }
      if (budget >= gwCost) { gameWatchProspect(league, team.id, target.id); continue; }
    }

    // Drain fallback: re-confirm a known prospect to spend remaining budget
    if (budget >= GAME_WATCH_COSTS.Domestic) {
      const recheck = targets[randInt(0, Math.max(0, targets.length - 1), rng)];
      s.budgets[team.id] -= GAME_WATCH_COSTS.Domestic;
      if (recheck) addReport(league, team.id, `Scouts re-confirmed their read on ${recheck.name}.`, recheck.id);
      continue;
    }
    break;
  }
}
