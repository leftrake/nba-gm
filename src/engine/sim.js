import { rand, gauss, clamp } from './rng.js';
import { overall } from './players.js';
import { POSITIONS, autoLineup, lineupErrors, posFit } from './lineup.js';

// A team's game rotation: the saved lineup when it's legal, otherwise a
// fresh auto lineup (AI teams never store one). Each entry carries the slot
// the player occupies so out-of-position starters get a fit penalty.
export function getRotation(team) {
  const lineup = team.lineup && lineupErrors(team.lineup, team.roster).length === 0
    ? team.lineup
    : autoLineup(team.roster);
  const rot = [];
  for (const pos of POSITIONS) {
    const s = lineup.starters[pos];
    const p = s.id != null ? team.roster.find((x) => x.id === s.id) : null;
    if (p && s.min > 0) rot.push({ p, min: s.min, slot: pos });
  }
  for (const b of lineup.bench) {
    const p = team.roster.find((x) => x.id === b.id);
    if (p && b.min > 0) rot.push({ p, min: b.min, slot: p.pos }); // bench subs at natural position
  }
  return rot;
}

function rotationStrength(rot) {
  if (rot.length === 0) return 30;
  const totalMin = rot.reduce((s, r) => s + r.min, 0);
  return rot.reduce((s, r) => s + overall(r.p) * posFit(r.p.pos, r.slot) * r.min, 0) / totalMin;
}

export function teamStrength(team) {
  return rotationStrength(getRotation(team));
}

// Simulate one game between two teams. Returns box score + result.
export function simGame(homeTeam, awayTeam, rng = rand) {
  const homeRot = getRotation(homeTeam);
  const awayRot = getRotation(awayTeam);
  const hs = rotationStrength(homeRot) + 1.5; // home court
  const as = rotationStrength(awayRot);

  const diff = hs - as;
  const base = 112;
  let homePts = Math.round(base + diff * 0.9 + gauss(0, 9, rng));
  let awayPts = Math.round(base - diff * 0.9 + gauss(0, 9, rng));
  if (homePts === awayPts) homePts += rng() > 0.5 ? 1 : -1; // no ties

  return {
    homePts: Math.max(70, homePts),
    awayPts: Math.max(70, awayPts),
    homeBox: distributeStats(homeRot, Math.max(70, homePts), rng),
    awayBox: distributeStats(awayRot, Math.max(70, awayPts), rng),
  };
}

function distributeStats(rot, teamPts, rng) {
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
