import { rand, gauss, clamp } from './rng.js';
import { overall, ftRating } from './players.js';
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

// ---------- Possession engine ----------
// A game is ~99 possessions per team, each resolved by the ten players on
// the floor: a usage-weighted shooter picks a shot from his inside/mid/three
// mix, the defense contests it, and misses are rebounded, fouls send shooters
// to the line, turnovers become steals. The floor five rotate in 3-minute
// stints sampled from each player's assigned minutes, so box-score minutes
// land near the lineup screen's targets while stints vary game to game.

const SEGMENT_MIN = 3;
const SEGMENTS = 48 / SEGMENT_MIN;
const OT_MIN = 5;
const OT_POSS = 10;

// Per-game state for one rotation player: cached effective ratings plus the
// box-score line this game writes into. `form` is tonight's hot/cold swing —
// it boosts both usage and shooting, which is what lets stars detonate for
// 50 every so often.
function gamePlayer({ p, min, slot }, rng) {
  const fit = posFit(p.pos, slot);
  const form = gauss(0, 1, rng);
  const r = p.ratings;
  const sharp = form * 2.5; // shooting bump in rating points
  const score = r.inside * 0.4 + r.mid * 0.25 + r.three * 0.35;
  return {
    targetMin: min,
    remaining: min,
    score, // form-free scoring talent — decides who the featured option is
    // The trailing term separates true superstars from everyday stars:
    // without it the league's top ~10 scorers bunch tightly around the
    // same ppg, and no one looks like a season-leading #1 option.
    usage: Math.pow(Math.max(score + sharp, 25) / 60, 2.36) * (1 + Math.max(0, score - 88) * 0.012),
    ins: r.inside + sharp,
    mid: r.mid + sharp,
    three: r.three + sharp,
    pass: r.passing,
    // playing out of position mostly bleeds defense and rebounding
    def: r.defense * (0.55 + 0.45 * fit),
    reb: r.rebounding * (0.55 + 0.45 * fit),
    ftPct: clamp(0.465 + ftRating(p) * 0.005, 0.48, 0.95),
    wIns: Math.pow(Math.max(r.inside - 25, 5), 2),
    wMid: Math.pow(Math.max(r.mid - 25, 5), 2) * 0.5,
    wThree: Math.pow(Math.max(r.three - 25, 5), 2) * 1.05,
    out: false, // fouled out
    cool: 0, // stints benched after picking up the 5th foul
    line: {
      playerId: p.id, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0,
      fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0,
    },
  };
}

function weightedPick(arr, weightFn, rng) {
  let total = 0;
  for (const x of arr) total += weightFn(x);
  let roll = rng() * total;
  for (const x of arr) {
    roll -= weightFn(x);
    if (roll < 0) return x;
  }
  return arr[arr.length - 1];
}

// Lingering caution even after the post-5th-foul benching expires, and a
// shorter leash on four fouls.
function foulTrouble(gp) {
  return gp.line.pf >= 5 ? 0.02 : gp.line.pf === 4 ? 0.3 : 1;
}

// Five on the floor, sampled without replacement weighted by minutes left to
// play (or assigned minutes in OT, when everyone's tank reads empty). The
// square keeps actual minutes close to the lineup screen's targets while
// stints still vary game to game.
function pickFive(players, rng, ot) {
  for (const gp of players) if (gp.cool > 0) gp.cool -= 1; // benched stint served
  const pool = players.filter((gp) => !gp.out && gp.cool === 0);
  const five = [];
  const w = ot
    ? (gp) => gp.targetMin * gp.targetMin * foulTrouble(gp)
    : (gp) => Math.pow(Math.max(gp.remaining, 0.01), 2) * foulTrouble(gp);
  while (five.length < 5 && pool.length > 0) {
    const chosen = weightedPick(pool, w, rng);
    pool.splice(pool.indexOf(chosen), 1);
    five.push(chosen);
  }
  return five;
}

const FOUL_LIMIT = 6;

// Book a personal foul: the 6th fouls you out, the 5th gets you pulled for
// a couple of stints (the coach protecting you is what keeps foul-outs
// occasional rather than nightly).
function addFoul(gp) {
  gp.line.pf += 1;
  if (gp.line.pf >= FOUL_LIMIT) gp.out = true;
  else if (gp.line.pf === FOUL_LIMIT - 1) gp.cool = 2;
}

// Charge a defensive foul, slightly biased toward interior players. A player
// can foul out mid-possession, so never charge someone already out.
function chargeFoul(side, rng) {
  const eligible = side.five.filter((g) => !g.out);
  if (eligible.length === 0) return;
  addFoul(weightedPick(eligible, (g) => 1 + g.reb / 100, rng));
}

// Mid-stint substitution: pull anyone who fouled out or just hit his 5th
// foul, filling the hole from the bench by minutes remaining.
function replaceFouledOut(ctx, players, rng) {
  if (!ctx.five.some((g) => g.out || g.cool > 0)) return ctx;
  const five = ctx.five.filter((g) => !(g.out || g.cool > 0));
  const bench = players.filter((g) => !g.out && g.cool === 0 && !ctx.five.includes(g));
  while (five.length < 5 && bench.length > 0) {
    const sub = weightedPick(bench, (g) => Math.max(g.remaining, 0.01), rng);
    bench.splice(bench.indexOf(sub), 1);
    five.push(sub);
  }
  return floorContext(five, ctx.team);
}

// Floor-unit aggregates the possession loop reads constantly. `team` is the
// shared running team score, which the usage soft-cap reads.
function floorContext(five, team) {
  const n = five.length || 1;
  let def = 0, pass = 0, reb = 0;
  for (const gp of five) { def += gp.def; pass += gp.pass; reb += gp.reb; }
  return { five, team, def: def / n, pass: pass / n, reb: reb / n };
}

// Soft cap on any one player's share of team scoring: full usage up to ~28%
// of the team's points, then his weight falls off quickly, so even a
// monster scorer settles near 30% rather than running away with half the
// offense. No-op early in the game, before "share" means anything.
const SHARE_CAP = 0.30;
function shotWeight(gp, team) {
  if (team.pts < 30) return gp.usage;
  const over = gp.line.pts / team.pts - SHARE_CAP;
  return over <= 0 ? gp.usage : gp.usage * Math.max(0.1, 1 - over * 10);
}

// True if the offense keeps the ball (offensive board); credits the rebound.
function offenseRebounds(off, def, rng) {
  const orbP = clamp(0.2 + (off.reb - def.reb) * 0.004, 0.1, 0.35);
  const offensive = rng() < orbP;
  const side = offensive ? off.five : def.five;
  // ~7% of misses go out of bounds / become team rebounds — no credit
  if (rng() < 0.93) weightedPick(side, (g) => Math.pow(g.reb, 2.7), rng).line.reb += 1;
  return offensive;
}

// n free throws; returns points, and whether the last one missed (live ball).
function shootFreeThrows(shooter, n, rng) {
  let made = 0, lastMissed = false;
  for (let i = 0; i < n; i++) {
    shooter.line.fta += 1;
    if (rng() < shooter.ftPct) { shooter.line.ftm += 1; made += 1; }
    else lastMissed = i === n - 1;
  }
  shooter.line.pts += made;
  return { made, lastMissed };
}

const ASSISTED_P = { ins: 0.76, mid: 0.68, three: 0.955 };

function maybeAssist(off, shooter, type, rng) {
  if (rng() >= ASSISTED_P[type]) return;
  const others = off.five.filter((g) => g !== shooter);
  if (others.length === 0) return;
  // pass rating capped so a generational 95+ passer concentrates assists
  // like a 92 passer, not a black hole
  weightedPick(others, (g) => Math.pow(Math.min(g.pass, 90), 4.75), rng).line.ast += 1;
}

// One offensive possession. Mutates box-score lines, returns points scored.
function playPossession(off, def, home, rng) {
  // turnover before a shot gets up?
  const toP = clamp(0.125 + (def.def - off.pass) * 0.0012, 0.07, 0.2);
  if (rng() < toP) {
    const loser = weightedPick(off.five, (g) => g.usage, rng);
    loser.line.tov += 1;
    if (rng() < 0.12) {
      addFoul(loser); // offensive foul: a charge on the ball-handler, not a steal
    } else if (rng() < 0.58) {
      weightedPick(def.five, (g) => g.def * g.def, rng).line.stl += 1;
    }
    return 0;
  }
  // common defensive foul away from the shot: side out, play continues
  if (rng() < 0.065) chargeFoul(def, rng);
  // non-shooting foul in the penalty: two shots, no field-goal attempt
  if (rng() < 0.04) {
    chargeFoul(def, rng);
    const shooter = weightedPick(off.five, (g) => shotWeight(g, off.team), rng);
    const { made, lastMissed } = shootFreeThrows(shooter, 2, rng);
    if (lastMissed && offenseRebounds(off, def, rng)) return made + playShots(off, def, home, rng);
    return made;
  }
  return playShots(off, def, home, rng);
}

// Shot attempts until the possession ends (score, defensive board, FTs).
function playShots(off, def, home, rng) {
  const defAdj = (def.def - 58) * 0.0035;
  let pts = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const shooter = weightedPick(off.five, (g) => shotWeight(g, off.team), rng);

    let roll = rng() * (shooter.wIns + shooter.wMid + shooter.wThree);
    const type = (roll -= shooter.wIns) < 0 ? 'ins' : (roll - shooter.wMid) < 0 ? 'mid' : 'three';

    let makeP, shotPts, foulP;
    if (type === 'ins') { makeP = 0.541 + (shooter.ins - 58) * 0.004 - defAdj * 1.15; shotPts = 2; foulP = 0.21; }
    else if (type === 'mid') { makeP = 0.412 + (shooter.mid - 58) * 0.0035 - defAdj; shotPts = 2; foulP = 0.06; }
    else { makeP = 0.338 + (shooter.three - 58) * 0.003 - defAdj; shotPts = 3; foulP = 0.013; }
    if (home) makeP += 0.012;

    const made = rng() < clamp(makeP, 0.12, 0.85);
    const fouled = rng() < foulP;

    if (made) {
      shooter.line.fga += 1; shooter.line.fgm += 1;
      if (type === 'three') { shooter.line.tpa += 1; shooter.line.tpm += 1; }
      shooter.line.pts += shotPts;
      pts += shotPts;
      maybeAssist(off, shooter, type, rng);
      if (fouled) {
        chargeFoul(def, rng);
        pts += shootFreeThrows(shooter, 1, rng).made; // and-one
      }
      return pts;
    }
    if (fouled) {
      // missed but fouled: no FGA, shoot 2 (or 3 beyond the arc)
      chargeFoul(def, rng);
      const { made: ftPts, lastMissed } = shootFreeThrows(shooter, shotPts, rng);
      pts += ftPts;
      if (lastMissed && offenseRebounds(off, def, rng)) continue;
      return pts;
    }
    shooter.line.fga += 1;
    if (type === 'three') shooter.line.tpa += 1;
    const blockP = type === 'ins' ? 0.28 : type === 'mid' ? 0.08 : 0.02;
    if (rng() < blockP) {
      weightedPick(def.five, (g) => Math.pow(g.def * 0.6 + g.reb * 0.4, 2), rng).line.blk += 1;
    }
    if (!offenseRebounds(off, def, rng)) return pts;
  }
  return pts;
}

// Simulate one game between two teams. Returns box score + result.
// Every offense runs through its best scorer: the #1 option gets a usage
// bump beyond what his ratings alone earn, scaled by how clearly he's the
// alpha — a lone star with no co-star monopolizes the offense, twin stars
// split it. This keeps a real scoring leader emerging even in seasons when
// the league lacks a monster talent (those leaders are usually lone
// alphas), without inflating co-star scoring tallies. Chosen by form-free
// talent, not tonight's hot hand, so the bump compounds across a season.
function featureTopOption(players) {
  if (players.length < 2) return;
  let top = players[0];
  for (const gp of players) if (gp.score > top.score) top = gp;
  let second = null;
  for (const gp of players) if (gp !== top && (!second || gp.score > second.score)) second = gp;
  top.usage *= 1.02 + clamp(top.score - second.score, 0, 8) * 0.012;
}

export function simGame(homeTeam, awayTeam, rng = rand) {
  const homePlayers = getRotation(homeTeam).map((e) => gamePlayer(e, rng));
  const awayPlayers = getRotation(awayTeam).map((e) => gamePlayer(e, rng));
  featureTopOption(homePlayers);
  featureTopOption(awayPlayers);

  const poss = Math.round(clamp(gauss(99, 2.5, rng), 92, 106));
  const homeScore = { pts: 0 };
  const awayScore = { pts: 0 };

  const playStint = (minutes, possEach, ot) => {
    let h = floorContext(pickFive(homePlayers, rng, ot), homeScore);
    let a = floorContext(pickFive(awayPlayers, rng, ot), awayScore);
    for (const gp of [...h.five, ...a.five]) { gp.line.min += minutes; gp.remaining -= minutes; }
    // anyone who picks up his 6th foul leaves the floor before the next play
    for (let k = 0; k < possEach; k++) {
      homeScore.pts += playPossession(h, a, true, rng);
      a = replaceFouledOut(a, awayPlayers, rng);
      awayScore.pts += playPossession(a, h, false, rng);
      h = replaceFouledOut(h, homePlayers, rng);
      a = replaceFouledOut(a, awayPlayers, rng);
    }
  };

  let done = 0;
  for (let s = 0; s < SEGMENTS; s++) {
    const target = Math.round(((s + 1) / SEGMENTS) * poss);
    playStint(SEGMENT_MIN, target - done, false);
    done = target;
  }
  while (homeScore.pts === awayScore.pts) playStint(OT_MIN, OT_POSS, true); // overtime(s)

  return {
    homePts: homeScore.pts,
    awayPts: awayScore.pts,
    homeBox: homePlayers.map((gp) => gp.line),
    awayBox: awayPlayers.map((gp) => gp.line),
  };
}

// ---------- Box-score storage ----------
// Saves keep every game's box score, so lines are stored as flat number
// arrays in this column order instead of objects (roughly 4x smaller in
// localStorage). Decode before display.
export const BOX_COLS = ['playerId', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'tov', 'pf'];

export function encodeBox(box) {
  return box.map((line) => BOX_COLS.map((k) => line[k]));
}

export function decodeBox(box) {
  return box.map((arr) => Object.fromEntries(BOX_COLS.map((k, i) => [k, arr[i] ?? 0])));
}

export function applyBoxToStats(roster, box) {
  for (const line of box) {
    const p = roster.find((x) => x.id === line.playerId);
    if (!p || line.min === 0) continue;
    const s = p.stats;
    s.gp += 1; s.min += line.min; s.pts += line.pts; s.reb += line.reb;
    s.ast += line.ast; s.stl += line.stl; s.blk += line.blk;
    s.fgm += line.fgm; s.fga += line.fga; s.tpm += line.tpm; s.tpa += line.tpa;
    // old saves' stats objects predate these four
    s.ftm = (s.ftm || 0) + line.ftm;
    s.fta = (s.fta || 0) + line.fta;
    s.tov = (s.tov || 0) + line.tov;
    s.pf = (s.pf || 0) + line.pf;
  }
}
