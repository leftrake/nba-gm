import { randInt, pick, clamp } from './rng.js';
import { overall, supportedMinutes } from './players.js';
import { pushNews } from './save.js';

// ---------- Injuries ----------
// Rolled per player per simmed game (regular season and playoffs), with
// odds driven by hidden durability, age, the night's minutes, and current
// condition — a gassed 34-year-old logging 40 minutes runs several times
// the risk of a fresh 24-year-old. An injured player carries
//   p.injury = { type, tier, gamesLeft }
// counts down one per team game missed (the lineup/rotation code refuses to
// play him), and heals over the summer no matter what.

// Severity tiers, weighted heavily toward the short end. Durations are in
// team games: at ~3.3 games a week, "1-3 weeks" is about 4-10 games.
export const INJURY_TIERS = [
  { tier: 'dtd', w: 42, games: [1, 3], types: ['Bruised Knee', 'Sore Hamstring', 'Back Spasms', 'Rolled Ankle', 'Hip Soreness'] },
  { tier: 'minor', w: 42, games: [4, 10], types: ['Sprained Ankle', 'Hamstring Strain', 'Wrist Sprain', 'Knee Tendinitis', 'Calf Strain'] },
  { tier: 'significant', w: 14, games: [12, 27], types: ['MCL Sprain', 'Stress Fracture', 'Shoulder Separation', 'Groin Tear', 'Broken Hand'] },
  { tier: 'season', w: 2, games: null, types: ['Torn ACL', 'Achilles Tear', 'Ruptured Disc', 'Torn Labrum'] },
];
const TIER_W = INJURY_TIERS.reduce((s, t) => s + t.w, 0);

// "out 6 games" / "out for the season", shared by news and the UI
export function injuryTimeline(injury) {
  if (injury.tier === 'season') return 'out for the season';
  return `out ${injury.gamesLeft} game${injury.gamesLeft === 1 ? '' : 's'}`;
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
    gamesLeft: tier.games ? randInt(tier.games[0], tier.games[1], rng) : 400,
  };
  // bruise-level news only for players anyone has heard of
  if (tier.tier !== 'dtd' || overall(p) >= 70) {
    const t = p.injury.type;
    pushNews(league, {
      day: league.dayIndex,
      text: `🩹 ${p.name} (${team.city} ${team.name}) goes down with ${article(t)} ${t.toLowerCase()} — ${injuryTimeline(p.injury)}.`,
    });
  }
  return p.injury;
}

// Count down one missed game for a team's wounded; clear and announce
// anyone who's back. Call once per team per simmed game, before rolling
// new injuries (tonight's casualties shouldn't tick the game they played).
export function tickInjuries(league, team) {
  for (const p of team.roster) {
    if (!p.injury || p.injury.tier === 'season') continue;
    p.injury.gamesLeft -= 1;
    if (p.injury.gamesLeft <= 0) {
      const { type, tier } = p.injury;
      p.injury = null;
      if (tier !== 'dtd' || overall(p) >= 70) {
        pushNews(league, { day: league.dayIndex, text: `${p.name} (${team.city} ${team.name}) returns from his ${type.toLowerCase()}.` });
      }
    }
  }
}

// Roll tonight's injuries for everyone who logged minutes in this box.
export function rollGameInjuries(league, team, box, rng) {
  for (const line of box) {
    if (line.min === 0) continue;
    const p = team.roster.find((x) => x.id === line.playerId);
    if (!p || p.injury) continue;
    if (rng() < injuryChance(p, line.min)) injurePlayer(league, team, p, rng);
  }
}
