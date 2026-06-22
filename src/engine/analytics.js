// ---------- Team-level analytics: trends, splits, and narrative findings ----------
// Built entirely on top of this-season per-game box scores already stored in
// league.resultsByDay (see encodeBox/decodeBox in sim.js) — no new tracked
// state, just reconstructing a team's game-by-game history from it.

import { decodeBox } from './sim.js';
import { possessions } from './stats.js';

const POSS_KEYS = ['fga', 'oreb', 'tov', 'fta'];

function sumBoxFields(box) {
  const out = { fga: 0, oreb: 0, tov: 0, fta: 0 };
  for (const line of decodeBox(box)) {
    for (const k of POSS_KEYS) out[k] += line[k] || 0;
  }
  return out;
}

// This season's played games for a team, oldest first: score, possessions,
// and opponent faced. Possessions are derived from the team's own box stats
// (fga - oreb + tov + 0.44*fta), the same estimator teamStatTotals/Stats.jsx
// use for season-long ORTG/DRTG, so per-game and season numbers agree.
export function teamGameLog(league, teamId) {
  const games = [];
  (league.resultsByDay || []).forEach((day, di) => {
    const r = day.find((x) => x.home === teamId || x.away === teamId);
    if (!r) return;
    const home = r.home === teamId;
    const box = home ? r.homeBox : r.awayBox;
    if (!box) return;
    const pts = home ? r.homePts : r.awayPts;
    const oppPts = home ? r.awayPts : r.homePts;
    games.push({
      di, home, oppId: home ? r.away : r.home,
      won: pts > oppPts, pts, oppPts,
      poss: possessions(sumBoxFields(box)),
    });
  });
  return games;
}

// Aggregate W-L/scoring/rating line over a slice of a team's game log.
export function ratingSplit(games) {
  const gp = games.length;
  if (!gp) return { gp: 0, w: 0, l: 0, ppg: 0, oppPpg: 0, ortg: 0, drtg: 0, netRtg: 0 };
  const w = games.filter((g) => g.won).length;
  const pts = games.reduce((s, g) => s + g.pts, 0);
  const oppPts = games.reduce((s, g) => s + g.oppPts, 0);
  const poss = games.reduce((s, g) => s + g.poss, 0);
  const ortg = poss ? (pts / poss) * 100 : 0;
  const drtg = poss ? (oppPts / poss) * 100 : 0;
  return { gp, w, l: gp - w, ppg: pts / gp, oppPpg: oppPts / gp, ortg, drtg, netRtg: ortg - drtg };
}

// The last `n` games, plus the `n` games right before that window — lets a
// caller compare recent form against what came before it.
export function recentForm(games, n = 10) {
  const recent = games.slice(-n);
  const prior = games.slice(0, -n).slice(-n);
  return { recent: ratingSplit(recent), prior: ratingSplit(prior) };
}

export function homeAwaySplit(games) {
  return { home: ratingSplit(games.filter((g) => g.home)), away: ratingSplit(games.filter((g) => !g.home)) };
}

// Games decided by `margin` points or fewer.
export function clutchRecord(games, margin = 5) {
  return ratingSplit(games.filter((g) => Math.abs(g.pts - g.oppPts) <= margin));
}

// Average current win% of opponents faced so far this season.
export function strengthOfSchedule(league, games) {
  if (!games.length) return 0.5;
  const total = games.reduce((sum, g) => {
    const opp = league.teams.find((t) => t.id === g.oppId);
    const gp = (opp?.wins || 0) + (opp?.losses || 0);
    return sum + (gp ? opp.wins / gp : 0.5);
  }, 0);
  return total / games.length;
}

// Plain-English takeaways about a team's recent play, in priority order.
// Every rule needs enough sample size to mean something — without that gate,
// small per-game deltas just read as noise.
export function keyFindings(league, team) {
  const games = teamGameLog(league, team.id);
  const findings = [];

  if (team.streak?.count >= 3) {
    findings.push(team.streak.result === 'W'
      ? `🔥 Riding a ${team.streak.count}-game winning streak.`
      : `❄️ In the middle of a ${team.streak.count}-game losing streak.`);
  }

  if (games.length >= 10) {
    const { recent, prior } = recentForm(games, 10);
    if (prior.gp >= 5) {
      const ortgDelta = recent.ortg - prior.ortg;
      const drtgDelta = recent.drtg - prior.drtg;
      if (Math.abs(ortgDelta) >= 3) {
        findings.push(`Offense has ${ortgDelta > 0 ? 'picked up' : 'fallen off'} ${Math.abs(ortgDelta).toFixed(1)} ORTG over the last ${recent.gp} games.`);
      }
      if (Math.abs(drtgDelta) >= 3) {
        findings.push(`Defense has ${drtgDelta < 0 ? 'improved' : 'slipped'} ${Math.abs(drtgDelta).toFixed(1)} DRTG over the last ${recent.gp} games.`);
      }
    }
  }

  const { home, away } = homeAwaySplit(games);
  if (home.gp >= 3 && away.gp >= 3) {
    const homeWpct = home.w / home.gp, awayWpct = away.w / away.gp;
    if (homeWpct - awayWpct >= 0.3) findings.push(`Much stronger at home (${home.w}-${home.l}) than on the road (${away.w}-${away.l}).`);
    else if (awayWpct - homeWpct >= 0.3) findings.push(`Better on the road (${away.w}-${away.l}) than at home (${home.w}-${home.l}) so far.`);
  }

  const clutch = clutchRecord(games);
  if (clutch.gp >= 3) {
    const wpct = clutch.w / clutch.gp;
    if (wpct >= 0.7) findings.push(`Clutch: ${clutch.w}-${clutch.l} in games decided by 5 points or fewer.`);
    else if (wpct <= 0.3) findings.push(`Shaky late: ${clutch.w}-${clutch.l} in games decided by 5 points or fewer.`);
  }

  if (games.length >= 5) {
    const sos = strengthOfSchedule(league, games);
    if (sos >= 0.58) findings.push(`Faced a tough slate so far — opponents have a combined ${(sos * 100).toFixed(0)}% win rate.`);
    else if (sos <= 0.42) findings.push(`Faced a soft slate so far — opponents have a combined ${(sos * 100).toFixed(0)}% win rate.`);
  }

  return findings;
}
