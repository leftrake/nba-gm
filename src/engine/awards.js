// ---------- League leaders & end-of-season awards ----------
// Awards are computed once, deterministically (no rng), at the moment the
// regular season ends. Winners are stored two ways: a snapshot (id, name,
// team, stat line) on league.seasonAwards — folded into league.history by
// advanceOffseason — and an entry on each winner's own p.awards list so the
// honor follows the player through trades, free agency, and retirement.

import { pushNews } from './save.js';
import { overall } from './players.js';

export const LEADER_MIN_GP = 20;
const AWARD_MIN_GP = 50;
const ROOKIE_MIN_GP = 30;

export const LEADER_CATS = [
  ['pts', 'Points', 'PPG'],
  ['reb', 'Rebounds', 'RPG'],
  ['ast', 'Assists', 'APG'],
  ['stl', 'Steals', 'SPG'],
  ['blk', 'Blocks', 'BPG'],
];

export const pg = (s, k) => (s.gp ? (s[k] || 0) / s.gp : 0);

// Early in the season nobody has 20 games yet, so the qualifying bar tracks
// the league's most-played player until it reaches the real minimum.
export function leaderMinGp(league) {
  let max = 0;
  for (const t of league.teams) for (const p of t.roster) max = Math.max(max, p.stats.gp);
  return Math.max(1, Math.min(LEADER_MIN_GP, max));
}

export function statLeaders(league, key, count = 10) {
  const minGp = leaderMinGp(league);
  const rows = [];
  for (const team of league.teams) {
    for (const p of team.roster) {
      if (p.stats.gp >= minGp) rows.push({ p, team, value: pg(p.stats, key) });
    }
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, count);
}

// All-around production per game — the basis of MVP/ROY/Sixth Man "voting"
export function valueScore(s) {
  return pg(s, 'pts') + 1.2 * pg(s, 'reb') + 1.5 * pg(s, 'ast')
    + 2 * pg(s, 'stl') + 2 * pg(s, 'blk') - pg(s, 'tov');
}

const scoringLine = (s) => `${pg(s, 'pts').toFixed(1)} ppg, ${pg(s, 'reb').toFixed(1)} rpg, ${pg(s, 'ast').toFixed(1)} apg`;
const defenseLine = (s) => `${pg(s, 'stl').toFixed(1)} spg, ${pg(s, 'blk').toFixed(1)} bpg, ${pg(s, 'reb').toFixed(1)} rpg`;

function top(pool, score) {
  let best = null;
  let bestV = -Infinity;
  for (const c of pool) {
    const v = score(c);
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

export function computeAwards(league) {
  const season = league.season;
  const cands = [];
  for (const team of league.teams) {
    const games = team.wins + team.losses;
    const winPct = games ? team.wins / games : 0.5;
    // "starters" for Sixth Man purposes: the five highest per-game minute averages
    // (using per-game rather than totals so an injured starter isn't mis-classified as bench)
    const topMin = new Set(
      [...team.roster]
        .filter((p) => p.stats.gp > 0)
        .sort((a, b) => b.stats.min / b.stats.gp - a.stats.min / a.stats.gp)
        .slice(0, 5)
        .map((p) => p.id)
    );
    for (const p of team.roster) cands.push({ p, team, winPct, bench: !topMin.has(p.id) });
  }
  const eligible = cands.filter((c) => c.p.stats.gp >= AWARD_MIN_GP);

  // MVP requires a winning team — players on sub-.450 teams are heavily penalized.
  // The multiplier range (0.55 at .450 → 1.25 at .730) makes team success decisive.
  const mvpScore = (c) => {
    const base = valueScore(c.p.stats);
    if (c.winPct < 0.35) return base * 0.3; // essentially ineligible
    if (c.winPct < 0.45) return base * (0.3 + c.winPct); // sharp penalty below .450
    return base * (0.5 + 1.0 * c.winPct);
  };
  const dpoyScore = (c) =>
    (3 * pg(c.p.stats, 'stl') + 3 * pg(c.p.stats, 'blk') + 0.4 * pg(c.p.stats, 'reb')
      + 0.15 * (c.p.ratings.perimeterDefense + c.p.ratings.interiorDefense) / 2) * (0.8 + 0.4 * c.winPct);

  const mvp = top(eligible, mvpScore);
  const dpoy = top(eligible, dpoyScore);
  const roy = top(cands.filter((c) => c.p.exp === 0 && c.p.stats.gp >= ROOKIE_MIN_GP),
    (c) => valueScore(c.p.stats));
  const sixth = top(eligible.filter((c) => c.bench), (c) => valueScore(c.p.stats));

  // COY: coach whose team most overperformed their roster talent.
  // Expected win% is derived from the average OVR of each team's top 8 players.
  // The coach with the biggest actual − expected gap wins.
  const coyCands = league.teams.map((team) => {
    const sorted = [...team.roster].sort((a, b) => overall(b) - overall(a)).slice(0, 8);
    const avgOvr = sorted.length ? sorted.reduce((s, p) => s + overall(p), 0) / sorted.length : 65;
    const expWinPct = Math.min(Math.max(0.30 + (avgOvr - 60) * 0.02, 0.15), 0.85);
    const games = team.wins + team.losses;
    const actualWinPct = games ? team.wins / games : 0.5;
    const expectedWins = Math.round(games * expWinPct);
    return { team, score: actualWinPct - expWinPct, expectedWins };
  }).filter(({ team }) => (team.wins + team.losses) >= 50 && team.coach);
  coyCands.sort((a, b) => b.score - a.score);
  const coyCand = coyCands[0] ?? null;

  // MIP: most improved player vs their previous season value.
  // Must have played at least one prior season with real minutes.
  const mipScore = (c) => {
    const prev = c.p.careerStats?.[c.p.careerStats.length - 1];
    if (!prev || prev.gp < 20 || c.p.exp < 1) return -Infinity;
    return valueScore(c.p.stats) - valueScore(prev);
  };
  const mip = top(eligible, mipScore);

  // All-NBA: three teams of two guards, two forwards, one center,
  // filled best-first by MVP score.
  const CLASS = { PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' };
  const TEAM_NAMES = ['First', 'Second', 'Third'];
  const slots = TEAM_NAMES.map(() => ({ G: 2, F: 2, C: 1 }));
  const allNba = TEAM_NAMES.map(() => []);
  for (const c of [...eligible].sort((a, b) => mvpScore(b) - mvpScore(a))) {
    const cls = CLASS[c.p.pos];
    const ti = slots.findIndex((s) => s[cls] > 0);
    if (ti === -1) continue;
    slots[ti][cls] -= 1;
    allNba[ti].push(c);
  }

  // All-Defensive: two teams of five, filled best-first by DPOY score
  // (positionless, like the modern voting format).
  const DEF_TEAM_NAMES = ['First', 'Second'];
  const allDef = DEF_TEAM_NAMES.map(() => []);
  const ranked = [...eligible].sort((a, b) => dpoyScore(b) - dpoyScore(a));
  for (let i = 0; i < DEF_TEAM_NAMES.length * 5 && i < ranked.length; i++) {
    allDef[Math.floor(i / 5)].push(ranked[i]);
  }

  // Record the win on the player and return the serializable league-side snapshot
  const give = (c, award, line) => {
    if (!c.p.awards) c.p.awards = []; // players from saves predating awards
    c.p.awards.push({ season, award });
    return { playerId: c.p.id, name: c.p.name, teamId: c.team.id, line };
  };

  // COY snapshot: stored separately since it tracks a coach, not a player
  let coy = null;
  if (coyCand) {
    const { team, expectedWins } = coyCand;
    if (!team.coach.awards) team.coach.awards = [];
    team.coach.awards.push({ season, award: 'Coach of the Year' });
    const winsAbove = team.wins - expectedWins;
    coy = {
      coachName: team.coach.name,
      teamId: team.id,
      teamName: `${team.city} ${team.name}`,
      record: `${team.wins}-${team.losses}`,
      line: `${team.wins}-${team.losses} record (${winsAbove >= 0 ? '+' : ''}${winsAbove} vs. expected)`,
    };
  }

  league.seasonAwards = {
    season,
    mvp: mvp && give(mvp, 'MVP', scoringLine(mvp.p.stats)),
    dpoy: dpoy && give(dpoy, 'Defensive Player of the Year', defenseLine(dpoy.p.stats)),
    roy: roy && give(roy, 'Rookie of the Year', scoringLine(roy.p.stats)),
    sixth: sixth && give(sixth, 'Sixth Man of the Year', scoringLine(sixth.p.stats)),
    mip: mip && give(mip, 'Most Improved Player', scoringLine(mip.p.stats)),
    coy,
    allNba: allNba.map((teamArr, i) =>
      teamArr.map((c) => give(c, `All-NBA ${TEAM_NAMES[i]} Team`, scoringLine(c.p.stats)))),
    allDef: allDef.map((teamArr, i) =>
      teamArr.map((c) => give(c, `All-Defensive ${DEF_TEAM_NAMES[i]} Team`, defenseLine(c.p.stats)))),
  };

  // unshift in reverse prestige order so the news feed reads MVP first
  const news = (text, extra) => pushNews(league, { day: league.dayIndex, category: 'award', ...extra, text });
  for (let i = DEF_TEAM_NAMES.length - 1; i >= 0; i--) {
    if (allDef[i].length) news(`All-Defensive ${DEF_TEAM_NAMES[i]} Team: ${allDef[i].map((c) => c.p.name).join(', ')}.`,
      { teamIds: [...new Set(allDef[i].map((c) => c.team.id))] });
  }
  for (let i = TEAM_NAMES.length - 1; i >= 0; i--) {
    if (allNba[i].length) news(`All-NBA ${TEAM_NAMES[i]} Team: ${allNba[i].map((c) => c.p.name).join(', ')}.`,
      { teamIds: [...new Set(allNba[i].map((c) => c.team.id))] });
  }
  if (coy) news(`${coy.coachName} (${coyCand.team.name}) wins Coach of the Year: ${coy.line}.`, { teamIds: [coyCand.team.id] });
  if (mip) news(`${mip.p.name} (${mip.team.name}) wins Most Improved Player: ${scoringLine(mip.p.stats)}.`, { teamIds: [mip.team.id] });
  if (sixth) news(`${sixth.p.name} (${sixth.team.name}) wins Sixth Man of the Year: ${scoringLine(sixth.p.stats)}.`, { teamIds: [sixth.team.id] });
  if (dpoy) news(`${dpoy.p.name} (${dpoy.team.name}) wins Defensive Player of the Year: ${defenseLine(dpoy.p.stats)}.`, { teamIds: [dpoy.team.id] });
  if (roy) news(`${roy.p.name} (${roy.team.name}) is the Rookie of the Year: ${scoringLine(roy.p.stats)}.`, { teamIds: [roy.team.id] });
  if (mvp) news(`🏆 ${mvp.p.name} (${mvp.team.name}) is the ${season} MVP: ${scoringLine(mvp.p.stats)}.`, { teamIds: [mvp.team.id], major: true });

  return league.seasonAwards;
}

const AWARD_ORDER = [
  'Finals MVP',
  'MVP',
  'All-Star MVP',
  'Defensive Player of the Year',
  'Rookie of the Year',
  'Sixth Man of the Year',
  'Most Improved Player',
  'Coach of the Year',
  'NBA Cup',
  'All-NBA First Team',
  'All-NBA Second Team',
  'All-NBA Third Team',
  'All-Defensive First Team',
  'All-Defensive Second Team',
  'All-Star',
];

// Group a player's award list by honor, ordered by prestige:
// [{ award, seasons: [2027, 2029] }, ...]
export function groupAwards(awards = []) {
  const by = new Map();
  for (const a of awards) {
    if (!by.has(a.award)) by.set(a.award, []);
    by.get(a.award).push(a.season);
  }
  return [...by.entries()]
    .sort((a, b) => AWARD_ORDER.indexOf(a[0]) - AWARD_ORDER.indexOf(b[0]))
    .map(([award, seasons]) => ({ award, seasons: seasons.sort((x, y) => x - y) }));
}

// "2× MVP, All-NBA First Team" — for retirement write-ups
export function honorsSummary(awards) {
  return groupAwards(awards)
    .map((g) => (g.seasons.length > 1 ? `${g.seasons.length}× ${g.award}` : g.award))
    .join(', ');
}
