// ---------- League leaders & end-of-season awards ----------
// Awards are computed once, deterministically (no rng), at the moment the
// regular season ends. Winners are stored two ways: a snapshot (id, name,
// team, stat line) on league.seasonAwards — folded into league.history by
// advanceOffseason — and an entry on each winner's own p.awards list so the
// honor follows the player through trades, free agency, and retirement.

import { pushNews } from './save.js';

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

const pg = (s, k) => (s.gp ? (s[k] || 0) / s.gp : 0);

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
function valueScore(s) {
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
    // "starters" for Sixth Man purposes: the five biggest minute totals
    const topMin = new Set(
      [...team.roster].sort((a, b) => b.stats.min - a.stats.min).slice(0, 5).map((p) => p.id)
    );
    for (const p of team.roster) cands.push({ p, team, winPct, bench: !topMin.has(p.id) });
  }
  const eligible = cands.filter((c) => c.p.stats.gp >= AWARD_MIN_GP);

  const mvpScore = (c) => valueScore(c.p.stats) * (0.7 + 0.6 * c.winPct);
  const dpoyScore = (c) =>
    (3 * pg(c.p.stats, 'stl') + 3 * pg(c.p.stats, 'blk') + 0.4 * pg(c.p.stats, 'reb')
      + 0.15 * c.p.ratings.defense) * (0.85 + 0.3 * c.winPct);

  const mvp = top(eligible, mvpScore);
  const dpoy = top(eligible, dpoyScore);
  const roy = top(cands.filter((c) => c.p.exp === 0 && c.p.stats.gp >= ROOKIE_MIN_GP),
    (c) => valueScore(c.p.stats));
  const sixth = top(eligible.filter((c) => c.bench), (c) => valueScore(c.p.stats));

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

  // Record the win on the player and return the serializable league-side snapshot
  const give = (c, award, line) => {
    if (!c.p.awards) c.p.awards = []; // players from saves predating awards
    c.p.awards.push({ season, award });
    return { playerId: c.p.id, name: c.p.name, teamId: c.team.id, line };
  };

  league.seasonAwards = {
    season,
    mvp: mvp && give(mvp, 'MVP', scoringLine(mvp.p.stats)),
    dpoy: dpoy && give(dpoy, 'Defensive Player of the Year', defenseLine(dpoy.p.stats)),
    roy: roy && give(roy, 'Rookie of the Year', scoringLine(roy.p.stats)),
    sixth: sixth && give(sixth, 'Sixth Man of the Year', scoringLine(sixth.p.stats)),
    allNba: allNba.map((teamArr, i) =>
      teamArr.map((c) => give(c, `All-NBA ${TEAM_NAMES[i]} Team`, scoringLine(c.p.stats)))),
  };

  // unshift in reverse prestige order so the news feed reads MVP first
  const news = (text, extra) => pushNews(league, { day: league.dayIndex, category: 'award', ...extra, text });
  for (let i = TEAM_NAMES.length - 1; i >= 0; i--) {
    if (allNba[i].length) news(`All-NBA ${TEAM_NAMES[i]} Team: ${allNba[i].map((c) => c.p.name).join(', ')}.`,
      { teamIds: [...new Set(allNba[i].map((c) => c.team.id))] });
  }
  if (sixth) news(`${sixth.p.name} (${sixth.team.name}) wins Sixth Man of the Year: ${scoringLine(sixth.p.stats)}.`, { teamIds: [sixth.team.id] });
  if (dpoy) news(`${dpoy.p.name} (${dpoy.team.name}) wins Defensive Player of the Year: ${defenseLine(dpoy.p.stats)}.`, { teamIds: [dpoy.team.id] });
  if (roy) news(`${roy.p.name} (${roy.team.name}) is the Rookie of the Year: ${scoringLine(roy.p.stats)}.`, { teamIds: [roy.team.id] });
  if (mvp) news(`🏆 ${mvp.p.name} (${mvp.team.name}) is the ${season} MVP: ${scoringLine(mvp.p.stats)}.`, { teamIds: [mvp.team.id], major: true });

  return league.seasonAwards;
}

const AWARD_ORDER = [
  'MVP',
  'Defensive Player of the Year',
  'Rookie of the Year',
  'Sixth Man of the Year',
  'All-NBA First Team',
  'All-NBA Second Team',
  'All-NBA Third Team',
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
