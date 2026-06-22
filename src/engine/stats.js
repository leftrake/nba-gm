// ---------- Shared stat math for the Stats page ----------
// Per-game and shooting-percentage helpers operate on any object shaped like
// a player's `stats` (or a team's totals from teamStatTotals).

export const perGame = (s, k) => (s.gp ? (s[k] || 0) / s.gp : 0);

export function fgPct(s) {
  return s.fga ? s.fgm / s.fga : 0;
}

export function tpPct(s) {
  return s.tpa ? s.tpm / s.tpa : 0;
}

export function ftPct(s) {
  return s.fta ? s.ftm / s.fta : 0;
}

// True Shooting %: points per shooting possession, where a possession costs
// 2*(FGA + 0.44*FTA).
export function tsPct(s) {
  const denom = 2 * (s.fga + 0.44 * s.fta);
  return denom ? s.pts / denom : 0;
}

// Possession estimate (works on either per-game or season-total stats):
// FGA - OREB + TOV + 0.44*FTA.
export function possessions(s) {
  return s.fga - s.oreb + s.tov + 0.44 * s.fta;
}

const TOTAL_KEYS = ['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'min', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pm'];

// a - b across every stat key (including gp), for splitting a season's
// cumulative totals into per-team stints around a trade.
export function diffStats(a, b) {
  const out = { gp: a.gp - b.gp };
  for (const k of TOTAL_KEYS) out[k] = (a[k] || 0) - (b[k] || 0);
  return out;
}

// Sums every roster player's season stats into one team-level totals object.
// `gp` is the team's games played (wins + losses), not a sum of player gp.
export function teamStatTotals(team) {
  const totals = { gp: team.wins + team.losses };
  for (const k of TOTAL_KEYS) totals[k] = 0;
  for (const p of team.roster) {
    const s = p.stats;
    for (const k of TOTAL_KEYS) totals[k] += s[k] || 0;
  }
  return totals;
}

// Total points allowed this season, from the day-by-day results log.
export function pointsAllowed(league, teamId) {
  let pts = 0;
  for (const day of league.resultsByDay || []) {
    for (const r of day) {
      if (r.home === teamId) pts += r.awayPts;
      else if (r.away === teamId) pts += r.homePts;
    }
  }
  return pts;
}

// Every player league-wide whose games-played meets the threshold, paired
// with their team.
export function allPlayerStatRows(league, minGp = 0) {
  const rows = [];
  for (const team of league.teams) {
    for (const p of team.roster) {
      if (p.stats.gp >= minGp) rows.push({ p, team, stats: p.stats });
    }
  }
  return rows;
}

// Top `count` players by `valueFn(stats)` among those meeting `minGp`.
export function leaderRows(league, minGp, valueFn, count = 10) {
  return allPlayerStatRows(league, minGp)
    .map((r) => ({ ...r, value: valueFn(r.stats) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

// Double-double / triple-double check from a single game's box line.
export function ddTd(line) {
  const cats = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => (line[k] || 0) >= 10).length;
  return cats >= 3 ? 'TD' : cats >= 2 ? 'DD' : null;
}

// Categories shown in the positional-percentile comparison (PlayerCard).
export const PERCENTILE_STATS = [
  ['pts', 'PTS', (s) => perGame(s, 'pts')],
  ['reb', 'REB', (s) => perGame(s, 'reb')],
  ['ast', 'AST', (s) => perGame(s, 'ast')],
  ['stl', 'STL', (s) => perGame(s, 'stl')],
  ['blk', 'BLK', (s) => perGame(s, 'blk')],
  ['tsPct', 'TS%', (s) => tsPct(s) * 100],
];

// Percentile rank (0-100) of `value` among `pool`, splitting ties evenly.
function percentileRank(value, pool) {
  if (pool.length === 0) return 50;
  const below = pool.filter((v) => v < value).length;
  const equal = pool.filter((v) => v === value).length;
  return Math.round(((below + 0.5 * equal) / pool.length) * 100);
}

// A player's per-game stats benchmarked against every league player at the
// same primary position with at least `minGp` games played.
export function positionalPercentiles(league, player, minGp = 10) {
  const peers = allPlayerStatRows(league, minGp).filter((r) => r.p.pos === player.pos && r.p.id !== player.id);
  return PERCENTILE_STATS.map(([key, label, valueFn]) => {
    const value = valueFn(player.stats);
    const pool = peers.map((r) => valueFn(r.stats));
    return { key, label, value, percentile: percentileRank(value, pool), sampleSize: pool.length };
  });
}
