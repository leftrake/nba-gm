// Player role archetypes — assigned once a player's profile has settled
// (age ≥ 23, ≥ 2 quality seasons). Updated each offseason after development.
// Each archetype defines which positions it applies to and a score function
// over raw ratings; the highest-scoring archetype for the player's position wins.
//
// Differential bonus pattern: `Math.max(0, primaryStat - competingStat) * bonus`
// ensures specialized archetypes win only when their key stat clearly leads,
// preventing "generic" labels from dominating via balanced stats.

const A = (id, label, positions, score) => ({ id, label, positions, score });

export const ARCHETYPES = [
  // ─── Point Guards ───────────────────────────────────────────────────────────
  // Earns Floor General only when passing clearly exceeds scoring ability.
  A('floorGeneral', 'Floor General', ['PG'],
    (r) => {
      const offAvg = (r.threePoint + r.closeShot + r.midRange) / 3;
      return r.passing * 0.50 + r.ballHandling * 0.24 + r.perimeterDefense * 0.08 + r.speed * 0.08
        + Math.max(0, r.passing - offAvg) * 0.38;
    }),

  // Earns Scoring PG when scoring ability clearly exceeds passing.
  A('scoringPG', 'Scoring PG', ['PG'],
    (r) => {
      const offAvg = (r.threePoint + r.closeShot + r.midRange) / 3;
      return offAvg * 0.52 + r.ballHandling * 0.28 + r.speed * 0.10
        + Math.max(0, offAvg - r.passing) * 0.38;
    }),

  A('threeAndDPG', '3-and-D PG', ['PG'],
    (r) => r.threePoint * 0.45 + r.perimeterDefense * 0.40 + r.steal * 0.15),

  A('defensivePG', 'Defensive PG', ['PG'],
    (r) => r.steal * 0.46 + r.perimeterDefense * 0.38 + r.speed * 0.16),

  // Balanced PG/SG — neither scoring nor playmaking clearly dominates.
  A('comboGuard', 'Combo Guard', ['PG', 'SG'],
    (r) => {
      const offAvg = (r.threePoint + r.closeShot) / 2;
      return offAvg * 0.36 + r.passing * 0.30 + r.ballHandling * 0.24 + r.speed * 0.10;
    }),

  // ─── Shooting Guards ────────────────────────────────────────────────────────
  A('pureShooter', 'Pure Shooter', ['SG', 'SF'],
    (r) => r.threePoint * 0.52 + r.freeThrow * 0.24 + r.midRange * 0.24),

  A('threeAndD', '3-and-D', ['SG', 'SF', 'PF'],
    (r) => r.threePoint * 0.40 + r.perimeterDefense * 0.38 + r.steal * 0.12 + r.freeThrow * 0.10),

  A('scoringGuard', 'Scoring Guard', ['SG'],
    (r) => {
      const offAvg = (r.threePoint + r.closeShot + r.midRange) / 3;
      return offAvg * 0.55 + r.ballHandling * 0.20 + r.freeThrow * 0.15 + r.speed * 0.10;
    }),

  A('slasher', 'Slasher', ['PG', 'SG', 'SF'],
    (r) => r.closeShot * 0.44 + r.speed * 0.32 + r.ballHandling * 0.14 + r.strength * 0.10),

  A('twoWayGuard', 'Two-Way Guard', ['SG'],
    (r) => (r.threePoint + r.closeShot) / 2 * 0.28 + r.perimeterDefense * 0.30 + r.steal * 0.18 + r.passing * 0.12 + r.speed * 0.12),

  // Earns Playmaking Guard only when passing clearly exceeds scoring for an SG (8+ gap).
  A('playmakerGuard', 'Playmaking Guard', ['SG'],
    (r) => {
      const offAvg = (r.threePoint + r.closeShot) / 2;
      return r.passing * 0.42 + r.ballHandling * 0.28 + r.threePoint * 0.16 + r.speed * 0.14
        + Math.max(0, r.passing - offAvg - 8) * 0.55;
    }),

  // ─── Small Forwards ─────────────────────────────────────────────────────────
  A('twoWayWing', 'Two-Way Wing', ['SF'],
    (r) => (r.threePoint + r.closeShot) / 2 * 0.24 + r.perimeterDefense * 0.28 + r.steal * 0.14 + r.speed * 0.16 + r.strength * 0.10 + r.block * 0.08),

  A('slashingWing', 'Slashing Wing', ['SF'],
    (r) => r.closeShot * 0.42 + r.speed * 0.30 + r.strength * 0.18 + r.offensiveRebounding * 0.10),

  A('stretchForward', 'Stretch Forward', ['SF'],
    (r) => r.threePoint * 0.50 + r.midRange * 0.22 + r.freeThrow * 0.18 + r.speed * 0.10),

  A('defensiveWing', 'Defensive Wing', ['SF'],
    (r) => r.perimeterDefense * 0.34 + r.steal * 0.24 + r.interiorDefense * 0.18 + r.block * 0.14 + r.defensiveRebounding * 0.10),

  A('pointForward', 'Point Forward', ['SF'],
    (r) => r.passing * 0.40 + r.ballHandling * 0.22 + r.threePoint * 0.18 + r.closeShot * 0.12 + r.speed * 0.08),

  // ─── Power Forwards ─────────────────────────────────────────────────────────
  // Earns Stretch 4 when shooting clearly exceeds rebounding (truly a spacer).
  A('stretch4', 'Stretch 4', ['PF'],
    (r) => {
      const rebAvg = (r.offensiveRebounding + r.defensiveRebounding) / 2;
      return r.threePoint * 0.48 + r.midRange * 0.22 + r.freeThrow * 0.16 + r.speed * 0.14
        + Math.max(0, r.threePoint - rebAvg) * 0.28;
    }),

  A('postScorer', 'Post Scorer', ['PF', 'C'],
    (r) => r.closeShot * 0.40 + r.strength * 0.24 + r.offensiveRebounding * 0.22 + r.freeThrow * 0.14),

  A('defensiveBig', 'Defensive Big', ['PF', 'C'],
    (r) => r.interiorDefense * 0.34 + r.block * 0.30 + r.defensiveRebounding * 0.24 + r.strength * 0.12),

  // Rebounding Beast: rewarded by pure totals — both ends of the glass.
  A('reboundingBeast', 'Rebounding Beast', ['PF', 'C'],
    (r) => r.offensiveRebounding * 0.44 + r.defensiveRebounding * 0.42 + r.strength * 0.14),

  // Modern big — spaces the floor, defends multiple positions, smart rebounder.
  A('modernBig', 'Modern Big', ['PF'],
    (r) => r.threePoint * 0.26 + r.interiorDefense * 0.26 + r.defensiveRebounding * 0.22 + r.block * 0.14 + r.speed * 0.12),

  A('bruiser', 'Bruiser', ['PF'],
    (r) => r.strength * 0.38 + r.offensiveRebounding * 0.28 + r.closeShot * 0.20 + r.interiorDefense * 0.14),

  // ─── Centers ────────────────────────────────────────────────────────────────
  A('rimProtector', 'Rim Protector', ['C'],
    (r) => r.block * 0.40 + r.interiorDefense * 0.34 + r.defensiveRebounding * 0.18 + r.strength * 0.08),

  A('interiorForce', 'Interior Force', ['C'],
    (r) => r.closeShot * 0.34 + r.strength * 0.28 + r.offensiveRebounding * 0.24 + r.defensiveRebounding * 0.14),

  A('stretchCenter', 'Stretch Center', ['C'],
    (r) => r.threePoint * 0.50 + r.midRange * 0.22 + r.speed * 0.18 + r.freeThrow * 0.10),

  A('lobThreat', 'Lob Threat', ['C'],
    (r) => r.speed * 0.36 + r.closeShot * 0.28 + r.offensiveRebounding * 0.22 + r.block * 0.14),

  // Glass Eater: offensive rebounding specialist (offReb >> defReb is rewarded).
  A('glassEater', 'Glass Eater', ['C'],
    (r) => r.offensiveRebounding * 0.70 + r.strength * 0.20 + r.closeShot * 0.10),

  A('twowayCenter', 'Two-Way Center', ['C'],
    (r) => (r.closeShot + r.threePoint) / 2 * 0.20 + r.interiorDefense * 0.26 + r.block * 0.20 + r.defensiveRebounding * 0.20 + r.offensiveRebounding * 0.14),
];

// Build a lookup for label display
export const ARCHETYPE_LABELS = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.label]));

// Archetypes that represent clear "roster need" roles — used in trade valuation
// to give a small bonus when a team is missing one of these.
export const ROSTER_NEED_ARCHETYPES = new Set([
  'rimProtector', 'floorGeneral', 'pureShooter', 'defensiveBig', 'threeAndD',
]);

// Assign the archetype that best fits a player's current rating profile.
// Returns null until the player has settled (age ≥ 23, ≥ 2 quality seasons).
export function assignArchetype(p) {
  if (p.age < 23 || (p.qualitySeasons ?? 0) < 2) return null;
  const candidates = ARCHETYPES.filter((a) => a.positions.includes(p.pos));
  if (!candidates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const a of candidates) {
    const s = a.score(p.ratings);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best?.id ?? null;
}

// Returns true if a team's settled roster lacks any player with the given archetype id.
export function teamLacksArchetype(team, archetypeId) {
  return !team.roster.some((p) => p.archetype === archetypeId);
}
