import { gauss } from './rng.js';
import { overall, salaryFor } from './players.js';
import { pushNews } from './save.js';

// ---------- Player backstories ----------
// Every player is assigned a hidden backstory archetype at generation. The
// archetype shapes how he develops, how his morale reacts to winning/losing
// and pay, his durability, his clutch shooting, and how the market (and the
// user) price him — but it adds no new rating fields, only modifiers on
// existing systems. The archetype itself is hidden: the player card shows
// only `personalityNote`, a vague trait. Scouting trips (engine/scoutingTrips.js)
// can reveal it pre-draft; once a player has logged a couple of NBA seasons,
// `maybeRevealBackstory` lets his reputation emerge league-wide.

export const BACKSTORIES = {
  bust: { weight: 8, note: 'chip on his shoulder' },
  provider: { weight: 10, note: 'team-first' },
  gem: { weight: 9, note: 'driven' },
  legend: { weight: 7, note: 'loyal' },
  international: { weight: 10, note: 'adjusting' },
  comeback: { weight: 9, note: 'resilient' },
  generational: { weight: 8, note: 'a physical specimen' },
  grinder: { weight: 36, note: 'competitive' },
};

const TOTAL_WEIGHT = Object.values(BACKSTORIES).reduce((s, b) => s + b.weight, 0);

export function assignBackstory(rng) {
  let roll = rng() * TOTAL_WEIGHT;
  for (const [key, b] of Object.entries(BACKSTORIES)) {
    roll -= b.weight;
    if (roll < 0) return key;
  }
  return 'grinder';
}

// Vague trait shown on the player card before any backstory is revealed.
// Lazily defaults old saves (players generated before this system existed)
// to 'grinder'.
export function personalityNote(p) {
  return BACKSTORIES[p.backstory ?? 'grinder'].note;
}

// ---------- Development ----------

// Applied to the season's base growth/decline delta, before the per-rating
// noise loop. `room` is potential - overall (pre-development).
export function adjustGrowthDelta(p, delta, room, rng) {
  let d = delta;
  switch (p.backstory) {
    case 'bust':
      // resists coaching: growth (not decline) comes slower
      if (d > 0) d *= 0.7;
      break;
    case 'gem':
      // late bloomer: accelerates between 24 and 27
      if (p.age >= 24 && p.age <= 27 && room > 0) d += 1.2;
      break;
    case 'international':
      // adjustment period: suppressed growth in his first two NBA seasons
      if ((p.exp ?? 0) <= 1) d -= 1.0;
      break;
    case 'comeback':
      // exceptional work ethic, but only while healthy
      if (d > 0 && room > 0 && p.injury == null) d += 0.6;
      break;
  }
  return d;
}

// Applied per-rating, after the shared delta + its own noise term.
export function adjustRatingDelta(p, d, key, room, rng) {
  switch (p.backstory) {
    case 'international':
      // higher variance once the adjustment period (first two seasons) ends
      if ((p.exp ?? 0) > 1) d += gauss(0, 0.7, rng);
      break;
    case 'generational':
      if (key === 'speed' || key === 'strength') {
        if (d < 0) d *= p.age < 33 ? 0.5 : 1.6; // ages slower, then a sharper cliff
      }
      break;
  }
  return d;
}

// ---------- Durability ----------

// Offset applied to the generated durability rating at player creation.
export function durabilityAdjust(backstory) {
  if (backstory === 'provider' || backstory === 'comeback') return -10;
  return 0;
}

// ---------- Clutch ----------

// Small bonus to shot-make probability in clutch situations (sim.js).
export function clutchMod(p) {
  return (p.backstory === 'bust' || p.backstory === 'comeback') ? 0.04 : 0;
}

// ---------- Morale ----------

function isWellPaid(p) {
  if (!p.contract) return false;
  return p.contract.salary >= salaryFor(overall(p), p.age) * 0.95;
}

// Multiplier on the daily win/loss morale term for a loss. "Family
// provider" types stay loyal when well paid; "busted prospect" types sour
// faster on losing teams.
export function lossMoraleMult(p) {
  if (p.backstory === 'bust') return 1.6;
  if (p.backstory === 'provider' && isWellPaid(p)) return 0.5;
  return 1;
}

// Small positive drift bonus for an entire roster that carries a
// long-tenured "one city legend" — his presence steadies the locker room.
export function legendTeammateBonus(team) {
  const hasLegend = team.roster.some(
    (p) => p.backstory === 'legend' && p.draftTeam === team.id && (p.exp ?? 0) >= 5
  );
  return hasLegend ? 0.03 : 0;
}

// Morale hit applied when a "one city legend" is traded away from the team
// that drafted him.
export function tradedAwayPenalty(p, sellerTeamId) {
  return (p.backstory === 'legend' && p.draftTeam === sellerTeamId) ? -12 : 0;
}

// ---------- Market pricing ----------

// "Undrafted gem" types are systematically underpriced in free agency until
// his reputation becomes public.
export function askingPriceMult(p) {
  return (p.backstory === 'gem' && !p.backstoryRevealed) ? 0.85 : 1;
}

// "Family provider" types sign extensions cheaper.
export function extensionDemandMult(p) {
  return p.backstory === 'provider' ? 0.92 : 1;
}

// Once a backstory is public, AI teams' trade valuations adjust for it.
export function reputationMult(p) {
  if (!p.backstoryRevealed) return 1;
  if (p.backstory === 'gem') return 1.05;
  if (p.backstory === 'bust') return 0.93;
  return 1;
}

// ---------- Reputation reveal ----------

const REVEAL_NEWS = {
  bust: (p) => `Sources around the league describe ${p.name} as a coach's nightmare — rival staffers say he resists instruction and bristles at criticism.`,
  provider: (p) => `${p.name}'s teammates call him the most reliable pro in the locker room — he shows up early, plays through bumps and bruises, and looks out for the rookies.`,
  gem: (p) => `Rival executives are taking a second look at ${p.name} — "We missed on that one," one admits.`,
  legend: (p) => `${p.name}'s bond with his original team runs deep — league insiders say moving him would be a citywide gut punch.`,
  international: (p) => `${p.name}'s transition from overseas is complete — "The adjustment took a year or two, but the talent was always there," says one scout.`,
  comeback: (p) => `${p.name}'s comeback continues to turn heads — "His work ethic in practice is drawing league-wide attention," says a team trainer.`,
  generational: (p) => `${p.name}'s rare physical gifts are drawing comparisons league-wide — "You don't see athletes like that very often."`,
};

// Once a player has logged a couple of NBA seasons, his backstory becomes
// part of his public reputation — AI teams' valuations start to account for
// it (trade.js, league.js), and a news item marks the moment for the user.
export function maybeRevealBackstory(league, p, team) {
  if (p.backstoryRevealed || (p.exp ?? 0) < 2) return;
  p.backstoryRevealed = true;
  const text = REVEAL_NEWS[p.backstory];
  if (text) {
    pushNews(league, { day: 0, category: 'league', teamIds: [team.id], text: text(p) });
  }
}

// Full backstory description revealed by an "extended watch" (3 scouting
// assignments on the same prospect) — see engine/scoutingTrips.js.
const SCOUT_NOTES = {
  bust: () => `He carries himself like a former lottery pick with a chip on his shoulder — flashes star talent in big moments, but our staff hears he can be difficult to coach.`,
  provider: () => `Mature beyond his years — by every account he's playing for his family's future, which usually means a durable, low-drama pro who signs team-friendly deals.`,
  gem: () => `We think the industry is undervaluing him. If he slips in the draft, he could be the steal of the class.`,
  legend: () => `He's a hometown story — wherever he ends up, expect him to dig in and become the face of that franchise.`,
  international: (p) => `Coming over from ${p.nationality}, expect an adjustment period before his talent fully translates — but the tools are there.`,
  comeback: () => `He's already battled back from a significant injury — scouts love his mental toughness, but durability is a real question mark.`,
  generational: () => `A rare physical talent — the kind of athlete who ages gracefully until the cliff comes fast.`,
  grinder: () => `A no-frills evaluation: what you see is what you get, no red flags, no hidden upside.`,
};

export function scoutBackstoryNote(p) {
  return (SCOUT_NOTES[p.backstory] ?? SCOUT_NOTES.grinder)(p);
}

// ---------- Scouting regions ----------

const REGION_MAP = {
  USA: 'Domestic', Canada: 'Domestic',
  France: 'Europe', Germany: 'Europe', Serbia: 'Europe', Slovenia: 'Europe', Spain: 'Europe',
  Greece: 'Europe', Turkey: 'Europe', Latvia: 'Europe', Lithuania: 'Europe', Croatia: 'Europe',
  Italy: 'Europe', Georgia: 'Europe', Finland: 'Europe', Israel: 'Europe',
  Nigeria: 'Africa', Cameroon: 'Africa', 'South Sudan': 'Africa', Senegal: 'Africa', Egypt: 'Africa',
  Brazil: 'Latin America', Argentina: 'Latin America', 'Dominican Republic': 'Latin America', Bahamas: 'Latin America',
  Australia: 'Asia-Pacific', Japan: 'Asia-Pacific',
};

export const SCOUT_REGIONS = ['Domestic', 'Europe', 'Africa', 'Latin America', 'Asia-Pacific'];

export function regionFor(p) {
  return REGION_MAP[p.nationality] ?? 'Domestic';
}
