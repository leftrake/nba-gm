// ---------- Legacy & historical records ----------
// All-time record book, Hall of Fame, dynasties, and the user's GM legacy
// tracker. Record book / HOF entries are derived from p.careerStats and
// league.history at season end (see computeRecordBook etc., called from
// advanceOffseason) — only the derived top-10 lists and HOF entries are
// stored persistently, not redundant copies of career data.

import { TEAMS } from '../data/teams.js';
import { makeRng, clamp } from './rng.js';
import { overall, salaryFor } from './players.js';
import { honorsSummary, groupAwards } from './awards.js';
import { pushNews } from './save.js';

// ---------- Categories ----------

export const SINGLE_SEASON_CATS = [
  { key: 'pts', label: 'Points (Season)', statKey: 'pts', minGp: 50 },
  { key: 'ppg', label: 'PPG (Season)', statKey: 'pts', perGame: true, minGp: 50 },
  { key: 'ast', label: 'Assists (Season)', statKey: 'ast', minGp: 50 },
  { key: 'reb', label: 'Rebounds (Season)', statKey: 'reb', minGp: 50 },
  { key: 'stl', label: 'Steals (Season)', statKey: 'stl', minGp: 50 },
  { key: 'spg', label: 'SPG (Season)', statKey: 'stl', perGame: true, minGp: 50 },
  { key: 'blk', label: 'Blocks (Season)', statKey: 'blk', minGp: 50 },
  { key: 'bpg', label: 'BPG (Season)', statKey: 'blk', perGame: true, minGp: 50 },
  { key: 'fgPct', label: 'FG% (Season)', minFga: 200 },
  { key: 'teamWins', label: 'Wins (Team Season)', team: true },
];

export const CAREER_CATS = [
  { key: 'pts', label: 'Career Points', statKey: 'pts' },
  { key: 'reb', label: 'Career Rebounds', statKey: 'reb' },
  { key: 'ast', label: 'Career Assists', statKey: 'ast' },
  { key: 'stl', label: 'Career Steals', statKey: 'stl' },
  { key: 'blk', label: 'Career Blocks', statKey: 'blk' },
  { key: 'gp', label: 'Career Games Played', statKey: 'gp' },
  { key: 'championships', label: 'Career Championships' },
];

// All-time single-game bests, updated after every game in simDay (see
// checkGameHighs). Each entry in league.recordBook.gameHighs is keyed by
// `key` below: { playerId, name, value, team, opponent, season, teamScore,
// oppScore }.
export const GAME_HIGH_CATS = [
  { key: 'pts', label: 'Points', statKey: 'pts' },
  { key: 'reb', label: 'Rebounds', statKey: 'reb' },
  { key: 'ast', label: 'Assists', statKey: 'ast' },
  { key: 'stl', label: 'Steals', statKey: 'stl' },
  { key: 'blk', label: 'Blocks', statKey: 'blk' },
  { key: 'tpm', label: 'Three-Pointers Made', statKey: 'tpm' },
  { key: 'min', label: 'Minutes', statKey: 'min' },
];

// Categories with a meaningful "on pace this season" projection — rate
// stats (fgPct) and the team-level category aren't tracked mid-season.
export const PACE_CATS = SINGLE_SEASON_CATS.filter((c) => !c.team && c.key !== 'fgPct');

export function formatCatValue(catKey, value) {
  if (catKey === 'fgPct') return `${(value * 100).toFixed(1)}%`;
  if (catKey === 'ppg' || catKey === 'spg' || catKey === 'bpg' || catKey === 'min') return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

function teamName(teamId) {
  const t = TEAMS.find((x) => x.id === teamId);
  return t ? `${t.city} ${t.name}` : teamId;
}

// ---------- Lookups across rosters / free agents / retirees ----------

export function findPlayerById(league, id) {
  for (const t of league.teams) {
    const p = t.roster.find((x) => x.id === id);
    if (p) return p;
  }
  const fa = league.freeAgents.find((x) => x.id === id);
  if (fa) return fa;
  return league.retiredPlayers.find((x) => x.id === id) || null;
}

function allPlayersForRecords(league) {
  const out = [];
  for (const t of league.teams) for (const p of t.roster) out.push(p);
  for (const p of league.freeAgents) out.push(p);
  for (const p of league.retiredPlayers) out.push(p);
  return out;
}

// Highest overall ever reached, from ratingHistory plus the current rating.
export function peakOverall(p) {
  let peak = overall(p);
  for (const row of p.ratingHistory || []) peak = Math.max(peak, row[1]);
  return peak;
}

export function getPeakOverall(p) {
  return p.peakOverall != null ? p.peakOverall : peakOverall(p);
}

// ---------- Retirement snapshot ----------

// Trimmed, persistent record of a retired player: just enough for the
// record book, Hall of Fame, and memorial cards. No ratings/contracts.
export function snapshotRetiree(p, league, teamId) {
  return {
    id: p.id,
    name: p.name,
    pos: p.pos,
    retiredSeason: league.season,
    careerStats: p.careerStats || [],
    awards: p.awards || [],
    draftYear: p.draftYear ?? null,
    draftRound: p.draftRound ?? null,
    draftPick: p.draftPick ?? null,
    draftTeam: p.draftTeam ?? null,
    championships: p.championships || 0,
    peakOverall: peakOverall(p),
    finalTeam: teamId,
  };
}

// ---------- Record book ----------

export function computeRecordBook(league) {
  const players = allPlayersForRecords(league);
  const newBook = { singleSeason: {}, career: {}, gameHighs: league.recordBook?.gameHighs || {} };

  for (const cat of SINGLE_SEASON_CATS) {
    if (cat.team) continue;
    const candidates = [];
    for (const p of players) {
      for (const c of p.careerStats || []) {
        if (cat.minGp && c.gp < cat.minGp) continue;
        if (cat.minFga && c.fga < cat.minFga) continue;
        let value;
        if (cat.key === 'fgPct') value = c.fga ? c.fgm / c.fga : 0;
        else if (cat.perGame) value = c.gp ? c[cat.statKey] / c.gp : 0;
        else value = c[cat.statKey];
        candidates.push({ playerId: p.id, name: p.name, team: c.team, season: c.season, value, retired: !!p.retiredSeason });
      }
    }
    candidates.sort((a, b) => b.value - a.value);
    newBook.singleSeason[cat.key] = candidates.slice(0, 10);
  }

  newBook.singleSeason.teamWins = (league.teamSeasonRecords || [])
    .map((r) => ({ teamId: r.teamId, teamName: teamName(r.teamId), season: r.season, value: r.wins }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  for (const cat of CAREER_CATS) {
    const candidates = [];
    for (const p of players) {
      let value;
      if (cat.key === 'championships') value = p.championships || 0;
      else value = (p.careerStats || []).reduce((s, c) => s + (c[cat.statKey] || 0), 0);
      if (value <= 0) continue;
      const stats = p.careerStats || [];
      const lastEntry = stats[stats.length - 1];
      candidates.push({ playerId: p.id, name: p.name, team: lastEntry?.team, value, retired: !!p.retiredSeason });
    }
    candidates.sort((a, b) => b.value - a.value);
    newBook.career[cat.key] = candidates.slice(0, 10);
  }

  // Detect newly-broken #1 records (skip categories with no prior record —
  // nothing to "break" the first time a category gets populated).
  const broken = [];
  const prev = league.recordBook || { singleSeason: {}, career: {} };
  for (const cat of SINGLE_SEASON_CATS) {
    const prevTop = prev.singleSeason?.[cat.key]?.[0];
    const nextTop = newBook.singleSeason[cat.key]?.[0];
    if (prevTop && nextTop && nextTop.value > prevTop.value) {
      broken.push({ category: cat.key, label: cat.label, scope: 'season', team: !!cat.team, oldHolder: prevTop, newHolder: nextTop });
    }
  }
  for (const cat of CAREER_CATS) {
    const prevTop = prev.career?.[cat.key]?.[0];
    const nextTop = newBook.career[cat.key]?.[0];
    if (prevTop && nextTop && nextTop.value > prevTop.value && nextTop.playerId !== prevTop.playerId) {
      broken.push({ category: cat.key, label: cat.label, scope: 'career', team: false, oldHolder: prevTop, newHolder: nextTop });
    }
  }

  league.recordBook = newBook;
  return broken;
}

// Human-readable description of a broken record, for news/banners.
export function describeBrokenRecord(league, b) {
  const holderName = b.team ? b.newHolder.teamName : b.newHolder.name;
  const oldName = b.oldHolder ? (b.team ? b.oldHolder.teamName : b.oldHolder.name) : null;
  const scopeWord = b.scope === 'career' ? 'career' : 'single-season';
  const valueStr = formatCatValue(b.category, b.newHolder.value);
  const oldValueStr = b.oldHolder ? formatCatValue(b.category, b.oldHolder.value) : null;
  let text = `📜 RECORD BROKEN: ${holderName} set the new all-time ${scopeWord} ${b.label} record with ${valueStr}`;
  if (oldName) text += ` (previously ${oldName}, ${oldValueStr})`;
  text += '.';
  const isUserTeam = b.team ? b.newHolder.teamId === league.userTeamId : b.newHolder.team === league.userTeamId;
  return { text, isUserTeam };
}

// ---------- Mid-season pace tracking ----------

function currentSeasonLeaders(league, statKey, n = 3) {
  const rows = [];
  for (const team of league.teams) {
    for (const p of team.roster) {
      if (p.stats.gp >= 15) rows.push({ playerId: p.id, name: p.name, teamId: team.id, value: p.stats[statKey], gp: p.stats.gp });
    }
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, n);
}

// Called weekly during the regular season (dayIndex % 7 === 0). Projects
// each top leader's full-season pace and, the first time it crosses the
// current record, announces it.
export function checkRecordPace(league) {
  const season = league.season;
  if (!league.recordPaceFlags) league.recordPaceFlags = {};
  if (!league.recordPaceFlags[season]) league.recordPaceFlags[season] = {};
  const flags = league.recordPaceFlags[season];
  for (const cat of PACE_CATS) {
    const record = league.recordBook?.singleSeason?.[cat.key]?.[0];
    if (!record) continue;
    for (const cand of currentSeasonLeaders(league, cat.statKey)) {
      const projected = cat.perGame ? cand.value / cand.gp : (cand.value / cand.gp) * 82;
      if (projected < record.value) continue;
      const flagged = flags[cand.playerId] || (flags[cand.playerId] = {});
      if (flagged[cat.key]) continue;
      flagged[cat.key] = true;
      const text = `${cand.name} is on pace to break the all-time single-season ${cat.label} record `
        + `(projected ${formatCatValue(cat.key, projected)} vs. ${formatCatValue(cat.key, record.value)}).`;
      pushNews(league, {
        day: league.dayIndex, category: 'milestone',
        major: cand.teamId === league.userTeamId,
        teamIds: [cand.teamId],
        text,
      });
    }
  }
}

// ---------- Game highs ----------

// Called once per game from simDay, after box stats are applied to players.
// Compares each player's line against the all-time single-game bests and
// updates/announces any new records. `home`/`away` are team objects;
// `r` is the simGame result (homeBox/awayBox/homePts/awayPts).
export function checkGameHighs(league, r, home, away) {
  if (!league.recordBook) league.recordBook = { singleSeason: {}, career: {} };
  if (!league.recordBook.gameHighs) league.recordBook.gameHighs = {};
  const highs = league.recordBook.gameHighs;
  const sides = [
    { box: r.homeBox, team: home, opp: away, teamScore: r.homePts, oppScore: r.awayPts },
    { box: r.awayBox, team: away, opp: home, teamScore: r.awayPts, oppScore: r.homePts },
  ];
  for (const side of sides) {
    for (const line of side.box) {
      if (line.min <= 0) continue;
      const p = side.team.roster.find((x) => x.id === line.playerId);
      if (!p) continue;
      for (const cat of GAME_HIGH_CATS) {
        const value = line[cat.statKey];
        if (value <= 0) continue;
        const prev = highs[cat.key];
        if (prev && value <= prev.value) continue;
        highs[cat.key] = {
          playerId: p.id, name: p.name, value,
          team: side.team.id, opponent: side.opp.id,
          season: league.season,
          teamScore: side.teamScore, oppScore: side.oppScore,
        };
        if (!prev) continue; // nothing to "break" the first time a category gets populated
        const isUserGame = side.team.id === league.userTeamId || side.opp.id === league.userTeamId;
        let text = `🌟 GAME HIGH: ${p.name} (${teamName(side.team.id)}) recorded ${formatCatValue(cat.key, value)} ${cat.label.toLowerCase()} `
          + `vs. the ${teamName(side.opp.id)} (final: ${side.teamScore}-${side.oppScore}), a new all-time single-game record`;
        text += ` (previously ${prev.name}, ${formatCatValue(cat.key, prev.value)}).`;
        pushNews(league, {
          day: league.dayIndex, category: 'milestone',
          major: isUserGame,
          teamIds: [side.team.id, side.opp.id],
          text,
        });
      }
    }
  }
}

// ---------- Hall of Fame ----------

const HOF_THRESHOLD = 40;
export const POS_NAMES = { PG: 'point guard', SG: 'shooting guard', SF: 'forward', PF: 'forward', C: 'center' };

export function recordsHeldBy(league, playerId) {
  const held = [];
  const book = league.recordBook || { singleSeason: {}, career: {} };
  for (const cat of SINGLE_SEASON_CATS) {
    if (book.singleSeason[cat.key]?.[0]?.playerId === playerId) held.push(cat.label);
  }
  for (const cat of CAREER_CATS) {
    if (book.career[cat.key]?.[0]?.playerId === playerId) held.push(cat.label);
  }
  return held;
}

function hofScore(snap, recordsHeld) {
  let score = Math.max(0, snap.peakOverall - 75) * 2;
  score += Math.min(new Set((snap.careerStats || []).map((c) => c.season)).size, 15);
  score += (snap.championships || 0) * 5;
  for (const g of groupAwards(snap.awards)) {
    const w = g.award === 'MVP' ? 10
      : g.award === 'Defensive Player of the Year' ? 6
      : g.award.startsWith('All-NBA') ? 3
      : g.award.startsWith('All-Defensive') ? 2 : 1;
    score += w * g.seasons.length;
  }
  score += recordsHeld.length * 8;
  return score;
}

// 3-4 narrative voices, chosen by what the career emphasizes (with a
// seeded tiebreak among equally-fitting templates for variety).
function generateNarrative(league, snap, recordsHeld) {
  const seasons = [...new Set((snap.careerStats || []).map((c) => c.season))].sort((a, b) => a - b);
  const span = seasons.length ? `${seasons[0]}–${seasons[seasons.length - 1]}` : 'his career';
  const teamSeasonCounts = new Map();
  for (const c of snap.careerStats || []) teamSeasonCounts.set(c.team, (teamSeasonCounts.get(c.team) || 0) + 1);
  const primaryTeamId = [...teamSeasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const primaryTeam = primaryTeamId ? teamName(primaryTeamId) : 'the league';
  const teamsList = [...teamSeasonCounts.keys()].map(teamName).join(', ') || 'the league';
  const totals = (snap.careerStats || []).reduce(
    (a, c) => ({ gp: a.gp + c.gp, pts: a.pts + c.pts, reb: a.reb + c.reb, ast: a.ast + c.ast }),
    { gp: 0, pts: 0, reb: 0, ast: 0 }
  );
  const avgLine = totals.gp
    ? `${(totals.pts / totals.gp).toFixed(1)} ppg, ${(totals.reb / totals.gp).toFixed(1)} rpg, ${(totals.ast / totals.gp).toFixed(1)} apg`
    : 'modest career numbers';
  const honors = honorsSummary(snap.awards);
  const champ = snap.championships || 0;
  const champSentence = champ ? `He won ${champ} championship${champ > 1 ? 's' : ''}.` : '';
  const honorsSentence = honors ? `Career honors: ${honors}.` : '';
  const recordsSentence = recordsHeld.length ? `He retired holding the all-time record for ${recordsHeld.join(', ')}.` : '';
  const posName = POS_NAMES[snap.pos] || snap.pos;

  const templates = [
    () => `${snap.name} was a dominant ${posName} who anchored the ${primaryTeam} for ${span}. ${champSentence} ${honorsSentence} ${recordsSentence}`,
    () => `Few players matched ${snap.name}'s impact at ${posName} during a career that spanned ${span}, split between the ${teamsList}. ${recordsSentence} ${champSentence} ${honorsSentence}`,
    () => `${snap.name} retires as one of the great ${posName}s of his era, posting ${avgLine} across ${seasons.length} season${seasons.length === 1 ? '' : 's'} with the ${teamsList}. ${champSentence} ${recordsSentence}`,
    () => `A ${posName} renowned for his two-way impact, ${snap.name} spent ${span} in the league, primarily with the ${primaryTeam}. ${honorsSentence} ${champSentence} ${recordsSentence}`,
  ];

  let eligible;
  if (champ >= 2) eligible = [0, 1];
  else if (recordsHeld.length) eligible = [1, 2];
  else if (honors) eligible = [3, 0];
  else eligible = [2, 3];

  const rng = makeRng(league.seed + snap.id * 7777);
  const idx = eligible[Math.floor(rng() * eligible.length)];
  return templates[idx]().replace(/\s+/g, ' ').trim();
}

export function evaluateHallOfFame(league, newlyRetired) {
  for (const snap of newlyRetired) {
    const gp = (snap.careerStats || []).reduce((s, c) => s + c.gp, 0);
    if (gp < 200) continue; // never really a rotation player
    const recordsHeld = recordsHeldBy(league, snap.id);
    const score = hofScore(snap, recordsHeld);
    if (score < HOF_THRESHOLD) continue;
    const narrative = generateNarrative(league, snap, recordsHeld);
    const totals = (snap.careerStats || []).reduce(
      (a, c) => ({ gp: a.gp + c.gp, pts: a.pts + c.pts, reb: a.reb + c.reb, ast: a.ast + c.ast }),
      { gp: 0, pts: 0, reb: 0, ast: 0 }
    );
    const isUserPlayer = snap.draftTeam === league.userTeamId || snap.finalTeam === league.userTeamId;
    league.hallOfFame.push({
      playerId: snap.id,
      name: snap.name,
      inductedSeason: league.season,
      narrative,
      careerSummary: {
        gp: totals.gp,
        ppg: totals.gp ? +(totals.pts / totals.gp).toFixed(1) : 0,
        rpg: totals.gp ? +(totals.reb / totals.gp).toFixed(1) : 0,
        apg: totals.gp ? +(totals.ast / totals.gp).toFixed(1) : 0,
        seasons: new Set((snap.careerStats || []).map((c) => c.season)).size,
        championships: snap.championships || 0,
        honors: honorsSummary(snap.awards),
      },
      draftedByUser: snap.draftTeam === league.userTeamId,
      draftYear: snap.draftYear,
      draftRound: snap.draftRound,
      draftPick: snap.draftPick,
    });
    pushNews(league, {
      day: 0, category: 'milestone', major: true,
      teamIds: isUserPlayer ? [league.userTeamId] : undefined,
      text: `🏛️ ${snap.name} has been inducted into the Hall of Fame.`,
    });
  }
}

// ---------- Dynasties ----------

function computeCorePlayers(league, teamId, startSeason, endSeason) {
  const minutes = new Map();
  for (const p of allPlayersForRecords(league)) {
    for (const c of p.careerStats || []) {
      if (c.team !== teamId || c.season < startSeason || c.season > endSeason) continue;
      minutes.set(p.id, (minutes.get(p.id) || { id: p.id, name: p.name, min: 0 }));
      minutes.get(p.id).min += c.min;
    }
  }
  return [...minutes.values()].sort((a, b) => b.min - a.min).slice(0, 5).map((x) => ({ id: x.id, name: x.name }));
}

export function detectDynasties(league) {
  const lastEntry = league.history[league.history.length - 1];
  const champ = lastEntry?.champion;
  if (!champ) return;
  const season = lastEntry.season;
  const recentTitleSeasons = league.history
    .filter((h) => h.champion === champ && h.season <= season && h.season > season - 4)
    .map((h) => h.season)
    .sort((a, b) => a - b);
  if (recentTitleSeasons.length < 2) return;

  let dyn = league.dynasties.find((d) => d.teamId === champ && season - d.endSeason <= 4);
  if (dyn) {
    if (!dyn.championships.includes(season)) dyn.championships.push(season);
    dyn.endSeason = season;
    dyn.startSeason = Math.min(dyn.startSeason, recentTitleSeasons[0]);
  } else {
    dyn = { teamId: champ, startSeason: recentTitleSeasons[0], endSeason: season, championships: [...recentTitleSeasons] };
    league.dynasties.push(dyn);
  }
  const t = TEAMS.find((x) => x.id === champ);
  dyn.name = `${dyn.startSeason}–${dyn.endSeason} ${t.city} Dynasty`;
  const recs = (league.teamSeasonRecords || []).filter((r) => r.teamId === champ && r.season >= dyn.startSeason && r.season <= dyn.endSeason);
  dyn.record = { wins: recs.reduce((s, r) => s + r.wins, 0), losses: recs.reduce((s, r) => s + r.losses, 0) };
  dyn.corePlayers = computeCorePlayers(league, champ, dyn.startSeason, dyn.endSeason);
  pushNews(league, {
    day: 0, category: 'league', major: true, teamIds: [champ],
    text: `🏆 The ${dyn.name} is born — the ${t.city} ${t.name} have won ${dyn.championships.length} titles since ${dyn.startSeason}.`,
  });
}

// ---------- GM legacy ----------

export function expectedOvrForPick(pick) {
  return clamp(78 - (pick - 1) * 0.45, 55, 78);
}

const WATCHLIST_WINDOW = 5; // seasons

export function updateGmLegacy(league, ownerResult) {
  const gm = league.gmLegacy;
  if (ownerResult) {
    gm.totalWins += ownerResult.wins;
    gm.totalLosses += ownerResult.losses;
    if (ownerResult.champion) gm.championships += 1;
    if ((ownerResult.playoffRound ?? 0) >= 3) gm.confFinalsAppearances += 1;
    if (!gm.bestSeasonRecord || ownerResult.wins > gm.bestSeasonRecord.wins) {
      gm.bestSeasonRecord = { season: league.season, wins: ownerResult.wins, losses: ownerResult.losses };
    }
  }

  gm.draftWatchlist = (gm.draftWatchlist || []).filter((e) => league.season - e.season <= WATCHLIST_WINDOW);
  for (const entry of gm.draftWatchlist) {
    const p = findPlayerById(league, entry.playerId);
    if (!p) continue;
    const peak = getPeakOverall(p);
    const score = peak - expectedOvrForPick(entry.pick);
    if (!gm.bestDraftPick || score > gm.bestDraftPick.score) {
      gm.bestDraftPick = { season: entry.season, playerId: p.id, name: p.name, pick: entry.pick, peakOverall: peak, score };
    }
  }

  gm.faWatchlist = (gm.faWatchlist || []).filter((e) => league.season - e.season <= WATCHLIST_WINDOW);
  for (const entry of gm.faWatchlist) {
    const p = findPlayerById(league, entry.playerId);
    if (!p) continue;
    const peak = getPeakOverall(p);
    const marketValue = salaryFor(peak, entry.age);
    const steal = marketValue - entry.salary;
    if (steal > 0 && (!gm.bestFASigning || steal > gm.bestFASigning.steal)) {
      gm.bestFASigning = { season: entry.season, playerId: p.id, name: p.name, salary: entry.salary, peakOverall: peak, steal };
    }
  }
}

// ---------- Cross-save legacy (localStorage, separate from the save file) ----------

const CROSS_SAVE_KEY = 'nba-gm-legacy';

export function updateCrossSaveLegacy(league) {
  if (typeof localStorage === 'undefined') return; // headless sims
  let all;
  try { all = JSON.parse(localStorage.getItem(CROSS_SAVE_KEY) || '[]'); } catch { all = []; }
  if (!Array.isArray(all)) all = [];
  const userTeam = league.teams.find((t) => t.id === league.userTeamId);
  const entry = {
    saveId: league.saveId,
    teamId: league.userTeamId,
    teamName: userTeam ? `${userTeam.city} ${userTeam.name}` : league.userTeamId,
    seasons: league.history.length,
    championships: league.gmLegacy.championships,
    bestSeasonRecord: league.gmLegacy.bestSeasonRecord,
    hallOfFamers: league.hallOfFame.filter((h) => h.draftedByUser).map((h) => h.name),
  };
  const idx = all.findIndex((e) => e.saveId === league.saveId);
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  try { localStorage.setItem(CROSS_SAVE_KEY, JSON.stringify(all)); } catch { /* storage full/unavailable */ }
}

export function readCrossSaveLegacy() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const all = JSON.parse(localStorage.getItem(CROSS_SAVE_KEY) || '[]');
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}
