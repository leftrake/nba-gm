import { rand, gauss, clamp } from './rng.js';
import { overall } from './players.js';

// Rotation: top 9 by overall get minutes
export function getRotation(roster) {
  const sorted = [...roster].sort((a, b) => overall(b) - overall(a));
  const rot = sorted.slice(0, 9);
  const MINUTES = [36, 34, 33, 30, 28, 22, 18, 14, 10]; // sums to ~225 ≈ 240 with noise
  return rot.map((p, i) => ({ p, min: MINUTES[i] || 8 }));
}

export function teamStrength(roster) {
  const rot = getRotation(roster);
  if (rot.length === 0) return 30;
  const totalMin = rot.reduce((s, r) => s + r.min, 0);
  return rot.reduce((s, r) => s + overall(r.p) * r.min, 0) / totalMin;
}

// Simulate one game between two rosters. Returns box score + result.
export function simGame(homeRoster, awayRoster, rng = rand) {
  const hs = teamStrength(homeRoster) + 1.5; // home court
  const as = teamStrength(awayRoster);

  const diff = hs - as;
  const base = 112;
  let homePts = Math.round(base + diff * 0.9 + gauss(0, 9, rng));
  let awayPts = Math.round(base - diff * 0.9 + gauss(0, 9, rng));
  if (homePts === awayPts) homePts += rng() > 0.5 ? 1 : -1; // no ties

  return {
    homePts: Math.max(70, homePts),
    awayPts: Math.max(70, awayPts),
    homeBox: distributeStats(homeRoster, Math.max(70, homePts), rng),
    awayBox: distributeStats(awayRoster, Math.max(70, awayPts), rng),
  };
}

function distributeStats(roster, teamPts, rng) {
  const rot = getRotation(roster);
  const totalMin = rot.reduce((s, r) => s + r.min, 0);
  // usage weight: scoring ability * minutes
  const weights = rot.map(({ p, min }) => {
    const score = p.ratings.inside * 0.4 + p.ratings.mid * 0.25 + p.ratings.three * 0.35;
    return Math.pow(score, 1.8) * min;
  });
  const wSum = weights.reduce((a, b) => a + b, 0);

  return rot.map(({ p, min }, i) => {
    const ptsShare = (weights[i] / wSum) * teamPts;
    const pts = Math.max(0, Math.round(ptsShare + gauss(0, 4, rng)));
    const threeRate = clamp(p.ratings.three / 250, 0.05, 0.45);
    const tpm = Math.round(pts * threeRate / 3);
    const fgm = Math.round((pts - tpm) / 2.1) + tpm;
    const fga = Math.round(fgm / clamp(0.38 + (overall(p) - 50) * 0.003, 0.36, 0.58));
    return {
      playerId: p.id,
      min,
      pts,
      reb: Math.max(0, Math.round((p.ratings.rebounding / 12) * (min / 36) + gauss(0, 1.5, rng))),
      ast: Math.max(0, Math.round((p.ratings.passing / 13) * (min / 36) + gauss(0, 1.2, rng))),
      stl: Math.max(0, Math.round(p.ratings.defense / 70 + gauss(0, 0.6, rng))),
      blk: Math.max(0, Math.round((p.ratings.defense + p.ratings.inside) / 180 + gauss(0, 0.5, rng))),
      fgm, fga: Math.max(fga, fgm),
      tpm, tpa: Math.max(tpm, Math.round(tpm / 0.36)),
    };
  });
}

export function applyBoxToStats(roster, box) {
  for (const line of box) {
    const p = roster.find((x) => x.id === line.playerId);
    if (!p) continue;
    const s = p.stats;
    s.gp += 1; s.min += line.min; s.pts += line.pts; s.reb += line.reb;
    s.ast += line.ast; s.stl += line.stl; s.blk += line.blk;
    s.fgm += line.fgm; s.fga += line.fga; s.tpm += line.tpm; s.tpa += line.tpa;
  }
}
