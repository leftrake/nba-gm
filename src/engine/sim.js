import { rand, gauss, clamp } from './rng.js';
import { overall, ftRating, supportedMinutes } from './players.js';
import { moraleRatingMod } from './morale.js';
import { clutchMod } from './backstory.js';
import { POSITIONS, TOTAL_MINUTES, autoLineup, lineupErrors, playerFit, isInjured, minutesCap } from './lineup.js';

// A team's game rotation: the saved lineup when it's legal, otherwise a
// fresh auto lineup (AI teams never store one). Each entry carries the slot
// the player occupies so out-of-position starters get a fit penalty.
// Injured players never play: their minutes are redistributed to healthy
// teammates, best first, respecting stamina caps while that's possible —
// so an injury punches a hole in the rotation instead of voiding it.
export function getRotation(team) {
  const lineup = team.lineup && lineupErrors(team.lineup, team.roster).length === 0
    ? team.lineup
    : autoLineup(team.roster);
  const rot = [];
  for (const pos of POSITIONS) {
    const s = lineup.starters[pos];
    const p = s.id != null ? team.roster.find((x) => x.id === s.id) : null;
    if (p && s.min > 0 && !isInjured(p)) rot.push({ p, min: s.min, slot: pos });
  }
  for (const b of lineup.bench) {
    const p = team.roster.find((x) => x.id === b.id);
    if (p && b.min > 0 && !isInjured(p)) rot.push({ p, min: b.min, slot: p.pos }); // bench subs at natural position
  }

  let deficit = TOTAL_MINUTES - rot.reduce((s, r) => s + r.min, 0);
  if (deficit > 0) {
    const inRot = new Set(rot.map((r) => r.p.id));
    let fill = team.roster.filter((p) => !isInjured(p) && !inRot.has(p.id));
    // pathological case — nobody healthy left: the walking wounded play
    if (rot.length === 0 && fill.length === 0) fill = [...team.roster];
    for (const p of fill) rot.push({ p, min: 0, slot: p.pos });
    const order = [...rot].sort((a, b) => overall(b.p) - overall(a.p));
    for (let i = 0; deficit > 0 && order.length > 0 && i < 3000; i++) {
      const r = order[i % order.length];
      const cap = i < order.length * 25 ? minutesCap(r.p) : 48;
      if (r.min < cap) { r.min += 1; deficit -= 1; }
    }
    return rot.filter((r) => r.min > 0);
  }
  return rot;
}

function rotationStrength(rot) {
  if (rot.length === 0) return 30;
  const totalMin = rot.reduce((s, r) => s + r.min, 0);
  return rot.reduce((s, r) => s + overall(r.p) * playerFit(r.p, r.slot) * r.min, 0) / totalMin;
}

// ---------- Coaching style modifiers ----------
// All magnitudes are intentionally secondary to roster talent.
// A perfectly-fit scheme vs. a badly-mismatched roster of equal talent is ~2–3 pts/game.

// Per rating point above/below 70: teamStrength() scaling (previews & trade logic)
const COACH_STRENGTH_MULT = 0.0008;

// Fit curve: effect at normalized fit c = c * (1 + FIT_PENALTY) - FIT_PENALTY
//   fit=0 → -FIT_PENALTY  (scheme hurts a badly mismatched roster)
//   fit=1 → 1.0           (full style benefit)
const FIT_PENALTY = 0.4;
const FIT_BASE = 52;    // raw rating that maps to fit=0
const FIT_RANGE = 25;   // range above FIT_BASE for fit=1

// pace-and-space: more threes, faster pace
const PAS_THREE_BOOST = 0.28;  // wThree *= (1 + PAS_THREE_BOOST * effect)
const PAS_PACE = 2;            // possessions added per team at fit=1

// defensive: stronger defense, slower pace
const DEF_RATING_BOOST = 2.5;  // def rating added per player at fit=1
const DEF_PACE = -2;           // possessions subtracted at fit=1

// grind-it-out: more inside shots, modest defense, slowest pace
const GIO_INS_BOOST = 0.18;   // wIns *= (1 + GIO_INS_BOOST * effect)
const GIO_DEF_BOOST = 1.2;    // smaller def boost than pure defensive
const GIO_PACE = -4;           // possessions subtracted at fit=1

// balanced: tiny fit-independent lift to everything; no penalty
const BAL_SHOT_BOOST = 0.03;  // wIns/wMid/wThree *= (1 + BAL_SHOT_BOOST)
const BAL_DEF_BOOST = 0.4;    // def rating added per player (flat)

// Normalized [0..1] fit: how well the rotation's raw ratings match the style.
function rotationFit(rot, style) {
  if (rot.length === 0) return 0.5;
  let sum = 0;
  for (const { p } of rot) {
    const r = p.ratings;
    if (style === 'pace-and-space')   sum += r.three;
    else if (style === 'defensive')   sum += r.defense;
    else if (style === 'grind-it-out') sum += (r.inside + r.rebounding) / 2;
  }
  return clamp((sum / rot.length - FIT_BASE) / FIT_RANGE, 0, 1);
}

// Maps fit [0..1] to an effect multiplier: negative at low fit, 1.0 at perfect fit.
function fitEffect(fit) {
  return fit * (1 + FIT_PENALTY) - FIT_PENALTY;
}

// Pre-game: mutates gamePlayer objects to apply shot-mix and defensive shifts.
// defBase is updated alongside def so applyFatigue tracks off the adjusted baseline.
function applyStyleAdjustments(coach, rot, players) {
  const style = coach?.style ?? 'balanced';
  if (style === 'balanced') {
    for (const gp of players) {
      gp.wIns   *= 1 + BAL_SHOT_BOOST;
      gp.wMid   *= 1 + BAL_SHOT_BOOST;
      gp.wThree *= 1 + BAL_SHOT_BOOST;
      gp.def    += BAL_DEF_BOOST;
      gp.defBase += BAL_DEF_BOOST;
    }
    return;
  }
  const eff = fitEffect(rotationFit(rot, style));
  for (const gp of players) {
    if (style === 'pace-and-space') {
      gp.wThree *= 1 + PAS_THREE_BOOST * eff;
    } else if (style === 'defensive') {
      gp.def    += DEF_RATING_BOOST * eff;
      gp.defBase += DEF_RATING_BOOST * eff;
    } else if (style === 'grind-it-out') {
      gp.wIns   *= 1 + GIO_INS_BOOST * eff;
      gp.def    += GIO_DEF_BOOST * eff;
      gp.defBase += GIO_DEF_BOOST * eff;
    }
  }
}

// Pace contribution from one team's coaching style (in possessions per team).
// Both teams' bonuses are summed in simGame to get the shared game pace.
function stylePaceBonus(coach, rot) {
  const style = coach?.style ?? 'balanced';
  if (style === 'pace-and-space') return PAS_PACE  * fitEffect(rotationFit(rot, style));
  if (style === 'defensive')      return DEF_PACE  * fitEffect(rotationFit(rot, style));
  if (style === 'grind-it-out')   return GIO_PACE  * fitEffect(rotationFit(rot, style));
  return 0;
}

export function teamStrength(team) {
  const base = rotationStrength(getRotation(team));
  const coachMult = team.coach ? 1 + (team.coach.rating - 70) * COACH_STRENGTH_MULT : 1;
  return base * coachMult;
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
  const fit = playerFit(p, slot);
  const form = gauss(0, 1, rng);
  const r = p.ratings;
  const sharp = form * 2.5; // shooting bump in rating points
  const moraleAdj = moraleRatingMod(p); // small +/- from happiness, see engine/morale.js
  const score = r.inside * 0.4 + r.mid * 0.25 + r.three * 0.35;
  return {
    name: p.name, // for the game-flow log
    targetMin: min,
    remaining: min,
    score, // form-free scoring talent — decides who the featured option is
    // The trailing term separates true superstars from everyday stars:
    // without it the league's top ~10 scorers bunch tightly around the
    // same ppg, and no one looks like a season-leading #1 option.
    usage: Math.pow(Math.max(score + sharp, 25) / 60, 2.36) * (1 + Math.max(0, score - 88) * 0.012),
    ins: r.inside + sharp + moraleAdj,
    mid: r.mid + sharp + moraleAdj,
    three: r.three + sharp + moraleAdj,
    pass: r.passing + moraleAdj,
    // playing out of position mostly bleeds defense and rebounding
    def: r.defense * (0.55 + 0.45 * fit),
    reb: r.rebounding * (0.55 + 0.45 * fit),
    // Fatigue bases: the fresh values above, restored each stint before the
    // current fatigue penalty is subtracted (see applyFatigue).
    insBase: r.inside + sharp + moraleAdj,
    midBase: r.mid + sharp + moraleAdj,
    threeBase: r.three + sharp + moraleAdj,
    passBase: r.passing + moraleAdj,
    defBase: r.defense * (0.55 + 0.45 * fit),
    rebBase: r.rebounding * (0.55 + 0.45 * fit),
    supported: supportedMinutes(p),
    // A workload assigned beyond what stamina supports costs pace all night
    // (he knows he's playing 44 and still wears down), on top of the
    // escalating late-game hit applyFatigue adds once the minutes are real.
    planPenalty: Math.max(0, min - supportedMinutes(p)) * 1.0,
    // arriving worn down (heavy recent minutes) costs ratings all night
    condPenalty: (100 - (p.condition ?? 100)) * 0.2,
    ftPct: clamp(0.465 + ftRating(p) * 0.005, 0.48, 0.95),
    // small make-probability bump in clutch situations for some backstories
    clutchMod: clutchMod(p),
    wIns: Math.pow(Math.max(r.inside - 25, 5), 2),
    wMid: Math.pow(Math.max(r.mid - 25, 5), 2) * 0.5,
    wThree: Math.pow(Math.max(r.three - 25, 5), 2) * 1.05,
    out: false, // fouled out
    cool: 0, // stints benched after picking up the 5th foul
    line: {
      playerId: p.id, min: 0, pts: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0,
      fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, pm: 0,
    },
  };
}

// In-game fatigue, recomputed each stint from minutes already played: free
// while a player stays inside the minutes his stamina supports, then
// increasingly expensive past them — a 44-minute night costs a high-stamina
// star several rating points by the fourth quarter and wrecks a low-stamina
// big. Arriving in poor condition (condPenalty) hurts from the opening tip.
// Shooting takes the full hit, defense/rebounding most of it, passing half.
function applyFatigue(gp) {
  const over = Math.max(0, gp.line.min - gp.supported);
  const f = gp.planPenalty + gp.condPenalty + over * 1.7 + over * over * 0.12;
  gp.ins = gp.insBase - f;
  gp.mid = gp.midBase - f;
  gp.three = gp.threeBase - f;
  gp.def = Math.max(20, gp.defBase - f * 0.8);
  gp.reb = Math.max(20, gp.rebBase - f * 0.8);
  gp.pass = Math.max(20, gp.passBase - f * 0.5);
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
  if (rng() < 0.93) {
    const gp = weightedPick(side, (g) => Math.pow(g.reb, 2.7), rng);
    gp.line.reb += 1;
    if (offensive) gp.line.oreb += 1;
    else gp.line.dreb += 1;
  }
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
// `clutch` is true in the final two minutes of the 4th or any OT — see
// backstory.js's clutchMod for the shooters this affects.
function playPossession(off, def, home, rng, clutch) {
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
    if (made > 0) off.team.last = { name: shooter.name, type: 'ft' };
    if (lastMissed && offenseRebounds(off, def, rng)) return made + playShots(off, def, home, rng, clutch);
    return made;
  }
  return playShots(off, def, home, rng, clutch);
}

// Shot attempts until the possession ends (score, defensive board, FTs).
function playShots(off, def, home, rng, clutch) {
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
    if (clutch) makeP += shooter.clutchMod;

    const made = rng() < clamp(makeP, 0.12, 0.85);
    const fouled = rng() < foulP;

    if (made) {
      shooter.line.fga += 1; shooter.line.fgm += 1;
      if (type === 'three') { shooter.line.tpa += 1; shooter.line.tpm += 1; }
      shooter.line.pts += shotPts;
      pts += shotPts;
      off.team.last = { name: shooter.name, type };
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
      if (ftPts > 0) off.team.last = { name: shooter.name, type: 'ft' };
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
  const homeRot = getRotation(homeTeam);
  const awayRot = getRotation(awayTeam);
  const homePlayers = homeRot.map((e) => gamePlayer(e, rng));
  const awayPlayers = awayRot.map((e) => gamePlayer(e, rng));
  applyStyleAdjustments(homeTeam.coach, homeRot, homePlayers);
  applyStyleAdjustments(awayTeam.coach, awayRot, awayPlayers);
  featureTopOption(homePlayers);
  featureTopOption(awayPlayers);

  // Both teams contribute to shared game pace; the sum reflects "pace negotiations"
  // (a p&s coach vs. a grind coach produce a middling tempo).
  const possMean = 99 + stylePaceBonus(homeTeam.coach, homeRot) + stylePaceBonus(awayTeam.coach, awayRot);
  const poss = Math.round(clamp(gauss(possMean, 2.5, rng), 88, 112));
  const homeScore = { pts: 0, last: null }; // .last: most recent scorer, for the log
  const awayScore = { pts: 0, last: null };

  // ---- Game log: quarter line score + highlight events ----
  // Detection reads scores and box lines but never the rng, so adding or
  // changing events can't perturb seeded sim results.
  const homeQtrs = [];
  const awayQtrs = [];
  const events = [];
  let period = 0; // 0-3 = Q1-Q4, 4+ = overtimes
  const sideName = (side) => (side === 0 ? homeTeam : awayTeam).name;
  const fmtClock = (rem) => {
    const t = Math.max(0, Math.round(rem * 60));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const addEv = (text, t = '', q = periodLabel(period)) => events.push({ q, t, text });

  let leadSign = 0; // sign of home - away while someone leads
  let leadChanges = 0;
  let run = { side: null, pts: 0 }; // current streak of unanswered points

  // Called after every scoring possession with minutes remaining in the period.
  const track = (side, pts, rem) => {
    if (pts === 0) return;
    if (run.side === side) {
      run.pts += pts;
    } else {
      if (run.side != null && run.pts >= 10) {
        addEv(`The ${sideName(run.side)} ripped off a ${run.pts}-0 run.`, fmtClock(rem));
      }
      run = { side, pts };
    }
    const diff = homeScore.pts - awayScore.pts;
    const sign = Math.sign(diff);
    // clutch time: final two minutes of the 4th or any OT, shot ties or flips the lead
    const last = (side === 0 ? homeScore : awayScore).last;
    if (period >= 3 && rem <= 2.05 && last) {
      const shot = { ins: 'layup', mid: 'jumper', three: 'three', ft: 'free throw' }[last.type];
      if (sign === 0) {
        addEv(`${last.name} ties it at ${homeScore.pts} with a ${shot}.`, fmtClock(rem));
      } else if (sign !== leadSign && sign === (side === 0 ? 1 : -1)) {
        addEv(`${last.name}'s ${shot} puts the ${sideName(side)} up ${Math.max(homeScore.pts, awayScore.pts)}-${Math.min(homeScore.pts, awayScore.pts)}.`, fmtClock(rem));
      }
    }
    if (sign !== 0 && sign !== leadSign) {
      if (leadSign !== 0) leadChanges += 1;
      leadSign = sign;
    }
  };

  let hPrev = 0;
  let aPrev = 0;
  const endPeriod = () => {
    const hq = homeScore.pts - hPrev;
    const aq = awayScore.pts - aPrev;
    homeQtrs.push(hq);
    awayQtrs.push(aq);
    hPrev = homeScore.pts;
    aPrev = awayScore.pts;
    if (hq >= 38) addEv(`The ${homeTeam.name} poured in ${hq} points in ${periodLabel(period)}.`);
    if (aq >= 38) addEv(`The ${awayTeam.name} poured in ${aq} points in ${periodLabel(period)}.`);
    // period markers carry no q/t prefix — the text says it all
    if (period < 3) {
      const [lead, trail] = homeScore.pts >= awayScore.pts ? [homeTeam, awayTeam] : [awayTeam, homeTeam];
      addEv(`End of ${periodLabel(period)}: ${lead.name} ${Math.max(homeScore.pts, awayScore.pts)}, ${trail.name} ${Math.min(homeScore.pts, awayScore.pts)}.`, '', '');
    } else if (homeScore.pts === awayScore.pts) {
      addEv(`Tied at ${homeScore.pts} — headed to ${period === 3 ? 'overtime' : 'another overtime'}.`, '', '');
    }
    period += 1;
  };

  const playStint = (minutes, possEach, ot, remStart) => {
    const hFive = pickFive(homePlayers, rng, ot);
    const aFive = pickFive(awayPlayers, rng, ot);
    // fatigue reflects minutes already in the books when the stint starts
    for (const gp of [...hFive, ...aFive]) { applyFatigue(gp); gp.line.min += minutes; gp.remaining -= minutes; }
    let h = floorContext(hFive, homeScore);
    let a = floorContext(aFive, awayScore);
    // anyone who picks up his 6th foul leaves the floor before the next play
    for (let k = 0; k < possEach; k++) {
      const rem = remStart - (minutes * (k + 1)) / Math.max(possEach, 1);
      const clutch = period >= 3 && rem <= 2.05;
      const hp = playPossession(h, a, true, rng, clutch);
      homeScore.pts += hp;
      track(0, hp, rem);
      a = replaceFouledOut(a, awayPlayers, rng);
      const ap = playPossession(a, h, false, rng, clutch);
      awayScore.pts += ap;
      track(1, ap, rem);
      h = replaceFouledOut(h, homePlayers, rng);
      a = replaceFouledOut(a, awayPlayers, rng);
    }
  };

  let done = 0;
  for (let s = 0; s < SEGMENTS; s++) {
    const target = Math.round(((s + 1) / SEGMENTS) * poss);
    playStint(SEGMENT_MIN, target - done, false, 12 - (s % 4) * SEGMENT_MIN);
    done = target;
    if (s % 4 === 3) endPeriod();
  }
  while (homeScore.pts === awayScore.pts) {
    playStint(OT_MIN, OT_POSS, true, OT_MIN); // overtime(s)
    endPeriod();
  }

  // Plus/minus approximation: the final score differential, weighted by each
  // player's share of the game's total minutes — not a true possession-by-
  // possession tally, but close for a season's worth of leaderboards.
  const gameMinutes = 48 + Math.max(0, period - 4) * OT_MIN;
  const diff = homeScore.pts - awayScore.pts;
  for (const gp of homePlayers) gp.line.pm = Math.round((diff * gp.line.min / gameMinutes) * 10) / 10;
  for (const gp of awayPlayers) gp.line.pm = Math.round((-diff * gp.line.min / gameMinutes) * 10) / 10;

  // post-game notes (q='' so the UI shows them unprefixed, after the action)
  if (run.side != null && run.pts >= 10) addEv(`The ${sideName(run.side)} closed the game on a ${run.pts}-0 run.`, '', '');
  if (leadChanges >= 12) addEv(`A back-and-forth battle: ${leadChanges} lead changes.`, '', '');
  for (const gp of [...homePlayers, ...awayPlayers]) {
    const l = gp.line;
    if (l.pts >= 40) addEv(`${gp.name} erupted for ${l.pts} points.`, '', '');
    if (l.pts >= 10 && l.reb >= 10 && l.ast >= 10) {
      addEv(`${gp.name} posted a triple-double: ${l.pts} pts, ${l.reb} reb, ${l.ast} ast.`, '', '');
    }
  }

  return {
    homePts: homeScore.pts,
    awayPts: awayScore.pts,
    homeBox: homePlayers.map((gp) => gp.line),
    awayBox: awayPlayers.map((gp) => gp.line),
    homeQtrs,
    awayQtrs,
    events,
  };
}

// "Q1"…"Q4", then "OT", "2OT", … — shared by the sim log and the line score.
export function periodLabel(i) {
  return i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`;
}

// The n best lines in a box by a crude game score — the "top performers"
// summaries, and what gets stored for games whose full box isn't kept.
export function starLines(box, n = 3) {
  const gameScore = (l) => l.pts + 0.7 * (l.reb + l.ast) + l.stl + l.blk - 0.7 * l.tov;
  return box.filter((l) => l.min > 0).sort((a, b) => gameScore(b) - gameScore(a)).slice(0, n);
}

// ---------- Box-score storage ----------
// Saves keep every game's box score, so lines are stored as flat number
// arrays in this column order instead of objects (roughly 4x smaller in
// localStorage). Decode before display.
export const BOX_COLS = ['playerId', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'tov', 'pf', 'oreb', 'dreb', 'pm'];

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
    // old saves' stats objects predate these three
    s.oreb = (s.oreb || 0) + (line.oreb || 0);
    s.dreb = (s.dreb || 0) + (line.dreb || 0);
    s.pm = (s.pm || 0) + (line.pm || 0);
  }
}
