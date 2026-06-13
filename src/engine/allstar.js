// ---------- All-Star Weekend ----------
// A lightweight mid-season event: "fan vote" starters/reserves picked from
// each conference's statistical leaders, a quick scoring-only exhibition
// game (not the full sim — All-Star rosters don't have real rotations), and
// a First-Half Honors snapshot of the league's per-game leaders so far.
// Everything stored on league.allStar is plain data (serializable).

import { pg, valueScore, statLeaders, LEADER_CATS } from './awards.js';
import { overall } from './players.js';

const STARTERS_PER_CONF = 5;
const RESERVES_PER_CONF = 7;

function eligiblePlayers(league, conf) {
  const minGp = Math.max(1, Math.floor((league.dayIndex || 1) * 0.5));
  const rows = [];
  for (const team of league.teams) {
    if (team.conf !== conf) continue;
    for (const p of team.roster) {
      if ((p.stats?.gp || 0) < minGp) continue;
      rows.push({ playerId: p.id, teamId: team.id, score: valueScore(p.stats) });
    }
  }
  return rows.sort((a, b) => b.score - a.score);
}

// Top 5 per conference are "starters", next 7 are "reserves" — a simple
// stand-in for the real All-Star voting/selection process.
export function selectAllStars(league) {
  const out = {};
  for (const conf of ['East', 'West']) {
    const ranked = eligiblePlayers(league, conf);
    out[conf] = {
      starters: ranked.slice(0, STARTERS_PER_CONF).map(({ playerId, teamId }) => ({ playerId, teamId })),
      reserves: ranked.slice(STARTERS_PER_CONF, STARTERS_PER_CONF + RESERVES_PER_CONF).map(({ playerId, teamId }) => ({ playerId, teamId })),
    };
  }
  return out;
}

export function getPlayerById(league, playerId) {
  for (const team of league.teams) {
    const p = team.roster.find((x) => x.id === playerId);
    if (p) return { player: p, team };
  }
  return null;
}

// A quick, non-rotation scoring exhibition: each roster's 12 players split a
// high-scoring team total roughly by overall rating, with some game-to-game
// variance. Reserves contribute too, just less.
function simAllStarTeam(league, roster, rng) {
  const weights = roster.map(({ playerId }) => {
    const found = getPlayerById(league, playerId);
    return Math.max(1, found ? overall(found.player) - 30 : 30);
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const teamPts = Math.round(155 + rng() * 45); // 155-200
  const lines = roster.map(({ playerId, teamId }, i) => {
    const share = weights[i] / totalWeight;
    const pts = Math.max(0, Math.round(teamPts * share * (0.8 + rng() * 0.4)));
    const reb = Math.max(0, Math.round(8 * share * 12 * (0.6 + rng() * 0.8)));
    const ast = Math.max(0, Math.round(6 * share * 12 * (0.6 + rng() * 0.8)));
    return { playerId, teamId, pts, reb, ast };
  });
  const actualPts = lines.reduce((s, l) => s + l.pts, 0);
  return { pts: actualPts, lines };
}

export function simAllStarGame(league, starters, reserves, rng) {
  const sides = {};
  for (const conf of ['East', 'West']) {
    sides[conf] = simAllStarTeam(league, [...starters[conf], ...reserves[conf]], rng);
  }
  const winner = sides.East.pts >= sides.West.pts ? 'East' : 'West';
  const allLines = [...sides.East.lines, ...sides.West.lines];
  const mvp = allLines.reduce((best, l) => (!best || l.pts > best.pts ? l : best), null);
  return {
    East: { pts: sides.East.pts, lines: sides.East.lines },
    West: { pts: sides.West.pts, lines: sides.West.lines },
    winner,
    mvp,
  };
}

// Top-3 per category league-wide at the All-Star break.
export function firstHalfHonors(league) {
  return LEADER_CATS.map(([key, label, unit]) => ({
    key,
    label,
    unit,
    leaders: statLeaders(league, key, 3).map((r) => ({ playerId: r.p.id, teamId: r.team.id, value: r.value })),
  }));
}

export function buildAllStarEvent(league, rng) {
  const rosters = selectAllStars(league);
  const game = simAllStarGame(
    league,
    { East: rosters.East.starters, West: rosters.West.starters },
    { East: rosters.East.reserves, West: rosters.West.reserves },
    rng
  );
  return {
    season: league.season,
    rosters,
    game,
    honors: firstHalfHonors(league),
    shown: false,
  };
}
