import { randInt, pick, clamp } from './rng.js';
import { overall, supportedMinutes } from './players.js';
import { pushNews } from './save.js';

// ---------- Injuries ----------
// Rolled per player per simmed game (regular season and playoffs), with
// odds driven by hidden durability, age, the night's minutes, and current
// condition — a gassed 34-year-old logging 40 minutes runs several times
// the risk of a fresh 24-year-old. An injured player carries
//   p.injury = { type, tier, daysLeft }
// counts down one per calendar day (whether or not he plays, or even has a
// game scheduled), and heals over the summer no matter what.

// Severity tiers, weighted heavily toward the short end. Durations are in
// calendar days, not games — a day off the same as a played night, so a
// team on a bye doesn't get free recovery relative to one playing nightly.
export const INJURY_TIERS = [
  { tier: 'dtd', w: 42, days: [1, 3], types: ['Bruised Knee', 'Sore Hamstring', 'Back Spasms', 'Rolled Ankle', 'Hip Soreness'] },
  { tier: 'minor', w: 42, days: [4, 10], types: ['Sprained Ankle', 'Hamstring Strain', 'Wrist Sprain', 'Knee Tendinitis', 'Calf Strain'] },
  { tier: 'significant', w: 14, days: [12, 27], types: ['MCL Sprain', 'Stress Fracture', 'Shoulder Separation', 'Groin Tear', 'Broken Hand'] },
  { tier: 'season', w: 2, days: null, types: ['Torn ACL', 'Achilles Tear', 'Ruptured Disc', 'Torn Labrum'] },
];
const TIER_W = INJURY_TIERS.reduce((s, t) => s + t.w, 0);

// "out 6 days" / "out for the season", shared by news and the UI
export function injuryTimeline(injury) {
  if (injury.tier === 'season') return 'out for the season';
  return `out ${injury.daysLeft} day${injury.daysLeft === 1 ? '' : 's'}`;
}

const article = (type) => (/^([AEIOU]|MCL)/i.test(type) ? 'an' : 'a');

// Chance this player gets hurt tonight. Base rate is calibrated so an
// average team logs roughly 8-10 injury stretches a season (see the
// injury checks in scripts/test-suite.mjs before re-tuning).
export function injuryChance(p, min) {
  let prob = 0.0115;
  prob *= 0.45 + (90 - (p.durability ?? 65)) * 0.022; // iron men ~0.5x, glassmen ~1.8x
  prob *= 1 + Math.max(0, p.age - 28) * 0.07;
  prob *= min / 32; // exposure
  prob *= 1 + Math.max(0, min - supportedMinutes(p)) * 0.05; // overworked tonight
  prob *= 1 + (100 - (p.condition ?? 100)) * 0.015; // worn down coming in
  return clamp(prob, 0, 0.25);
}

export function injurePlayer(league, team, p, rng) {
  let roll = rng() * TIER_W;
  const tier = INJURY_TIERS.find((t) => (roll -= t.w) < 0) ?? INJURY_TIERS[0];
  p.injury = {
    type: pick(tier.types, rng),
    tier: tier.tier,
    daysLeft: tier.days ? randInt(tier.days[0], tier.days[1], rng) : 400,
  };
  // bruise-level news only for players anyone has heard of
  if (tier.tier !== 'dtd' || overall(p) >= 70) {
    const t = p.injury.type;
    pushNews(league, {
      day: league.dayIndex,
      category: 'injury',
      teamIds: [team.id],
      // a season-ending injury changes a team's whole year
      major: tier.tier === 'season',
      text: `🩹 ${p.name} (${team.city} ${team.name}) goes down with ${article(t)} ${t.toLowerCase()} — ${injuryTimeline(p.injury)}.`,
    });
  }
  return p.injury;
}

// Count down one calendar day for a team's wounded; clear and announce
// anyone who's back. Call once per team per simulated day, before rolling
// new injuries (tonight's casualties shouldn't tick the day they got hurt).
export function tickInjuries(league, team) {
  for (const p of team.roster) {
    if (!p.injury || p.injury.tier === 'season') continue;
    p.injury.daysLeft -= 1;
    if (p.injury.daysLeft <= 0) {
      const { type, tier } = p.injury;
      p.injury = null;
      if (tier !== 'dtd' || overall(p) >= 70) {
        pushNews(league, { day: league.dayIndex, category: 'injury', teamIds: [team.id], text: `${p.name} (${team.city} ${team.name}) returns from his ${type.toLowerCase()}.` });
      }
    }
  }
}

// A player hurt mid-game only banks the minutes (and stats) he racked up
// before leaving — pick a cutoff before his final minute and scale his line
// down to it. Makes/attempts stay consistent (fgm<=fga, tpm<=tpa<=fga,
// ftm<=fta) and pts is rebuilt from the scaled makes (2/fgm + 1/tpm + 1/ftm).
// `frac` (0-1) is derived from the injury roll itself rather than drawing a
// fresh rng() call, so adding this doesn't shift the rng sequence for
// everything simmed after tonight's injuries.
function truncateForInjury(line, frac) {
  const oldMin = line.min;
  if (oldMin <= 1) return;
  const newMin = 1 + Math.floor(frac * (oldMin - 1));
  const ratio = newMin / oldMin;
  line.min = newMin;
  line.fga = Math.round(line.fga * ratio);
  line.fta = Math.round(line.fta * ratio);
  line.tpa = Math.min(line.fga, Math.round(line.tpa * ratio));
  line.fgm = Math.min(line.fgm, line.fga, Math.round(line.fgm * ratio));
  line.tpm = Math.min(line.tpm, line.tpa, line.fgm, Math.round(line.tpm * ratio));
  line.ftm = Math.min(line.ftm, line.fta, Math.round(line.ftm * ratio));
  line.pts = 2 * line.fgm + line.tpm + line.ftm;
  for (const k of ['reb', 'ast', 'stl', 'blk', 'tov', 'pf']) line[k] = Math.round(line[k] * ratio);
}

// Roll tonight's injuries for everyone who logged minutes in this box.
// Returns the players hurt tonight, so the game log can mention them and the
// box score can flag their truncated line.
export function rollGameInjuries(league, team, box, rng) {
  const injured = [];
  for (const line of box) {
    if (line.min === 0) continue;
    const p = team.roster.find((x) => x.id === line.playerId);
    if (!p || p.injury) continue;
    const chance = injuryChance(p, line.min);
    const roll = rng();
    if (roll < chance) {
      injurePlayer(league, team, p, rng);
      truncateForInjury(line, chance > 0 ? roll / chance : 0);
      injured.push(p);
    }
  }
  return injured;
}
