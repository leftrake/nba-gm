// Career milestone events stored on p.milestones[] and derived at display time.
// Stored entry: { type, season, day?, text }
//
// Stored types (written by engine hooks):
//   'career-high-pts' / 'career-high-reb' / 'career-high-ast' — overwritten each time the high improves
//   'first-playoff'      — once per player; carries opponent context
//   'first-championship' — once per player; carries team context
//   'pts-<N>'            — once per threshold (1000, 5000, 10000, …)
//
// Derived types (getMilestones only, not stored):
//   'draft'       — from p.draftYear / p.draftPick / p.draftTeam
//   'first-allstar'  — collapsed from p.awards All-Star entries
//   'award'       — MVP, DPOY, ROY, etc. from p.awards

const PTS_THRESHOLDS = [1000, 5000, 10000, 15000, 20000, 25000];

// Replace the stored milestone for this type (career highs update in place).
function setMilestone(p, type, entry) {
  if (!p.milestones) p.milestones = [];
  const idx = p.milestones.findIndex((m) => m.type === type);
  if (idx >= 0) p.milestones.splice(idx, 1);
  p.milestones.push(entry);
}

// Push a milestone that should only ever be stored once.
function pushOnceMilestone(p, type, entry) {
  if (!p.milestones) p.milestones = [];
  if (p.milestones.some((m) => m.type === type)) return;
  p.milestones.push(entry);
}

// Check career-high pts / reb / ast for every player in a game's box scores.
// Skips low values that would clutter the list (pts < 15, reb < 10, ast < 8).
// Also records each player's first playoff appearance when isPlayoffs is true.
// gameNum: 1-indexed game number within the series (null for regular season).
export function checkPlayerCareerHighs(league, r, home, away, isPlayoffs = false, gameNum = null) {
  const sides = [
    { box: r.homeBox, team: home, opp: away },
    { box: r.awayBox, team: away, opp: home },
  ];
  for (const { box, team, opp } of sides) {
    for (const l of box) {
      if (!l.min) continue;
      const p = team.roster.find((x) => x.id === l.playerId);
      if (!p) continue;

      const ctx = isPlayoffs
        ? (gameNum ? `in Game ${gameNum} vs. ${opp.name} (${league.season} Playoffs)` : `vs. ${opp.name} (${league.season} Playoffs)`)
        : `vs. ${opp.name} (${league.season})`;

      if (l.pts > (p.careerHighPts ?? 0) && l.pts >= 15) {
        p.careerHighPts = l.pts;
        setMilestone(p, 'career-high-pts', { type: 'career-high-pts', season: league.season, text: `Career-high ${l.pts} pts ${ctx}.` });
      }
      if (l.reb > (p.careerHighReb ?? 0) && l.reb >= 10) {
        p.careerHighReb = l.reb;
        setMilestone(p, 'career-high-reb', { type: 'career-high-reb', season: league.season, text: `Career-high ${l.reb} reb ${ctx}.` });
      }
      if (l.ast > (p.careerHighAst ?? 0) && l.ast >= 8) {
        p.careerHighAst = l.ast;
        setMilestone(p, 'career-high-ast', { type: 'career-high-ast', season: league.season, text: `Career-high ${l.ast} ast ${ctx}.` });
      }

      if (isPlayoffs) {
        pushOnceMilestone(p, 'first-playoff', {
          type: 'first-playoff', season: league.season,
          text: `First playoff appearance (vs. ${opp.name}).`,
        });
      }
    }
  }
}

// Call after a season's stats are fully archived into p.careerStats, to record
// career scoring threshold crossings (1 K, 5 K, 10 K, …).
export function checkPtsThresholds(p, season) {
  if (!p.careerStats?.length) return;
  const total = p.careerStats.reduce((s, r) => s + (r.pts ?? 0), 0);
  for (const threshold of PTS_THRESHOLDS) {
    const key = `pts-${threshold}`;
    if (total >= threshold && !(p.milestones ?? []).some((m) => m.type === key)) {
      if (!p.milestones) p.milestones = [];
      p.milestones.push({ type: key, season, text: `Reached ${threshold.toLocaleString()} career points.` });
    }
  }
}

// Call when a player wins their first championship (p.championships was 0).
export function recordFirstChampionship(p, teamName, season) {
  pushOnceMilestone(p, 'first-championship', {
    type: 'first-championship', season,
    text: `Won NBA Championship with the ${teamName}.`,
  });
}

// ---- Display helpers ----

const MILESTONE_ICONS = {
  draft: '📋',
  'career-high-pts': '🔥',
  'career-high-reb': '💪',
  'career-high-ast': '🎯',
  'first-playoff': '🏀',
  'first-championship': '🏆',
  'first-allstar': '⭐',
  award: '🥇',
};

export function milestoneIcon(type) {
  if (type.startsWith('pts-')) return '📈';
  return MILESTONE_ICONS[type] ?? '•';
}

const NOTABLE_AWARDS = new Set(['MVP', 'DPOY', 'Sixth Man', 'ROY', 'Finals MVP', 'All-Star MVP']);

// Merge stored milestones with milestones derivable from existing player data
// (draft info, awards). Returns array sorted by season ascending.
export function getMilestones(p, league) {
  const all = [...(p.milestones ?? [])];

  // Draft or undrafted entry
  if (p.draftYear) {
    const draftTeam = league.teams.find((t) => t.id === p.draftTeam);
    const teamLabel = draftTeam ? `${draftTeam.city} ${draftTeam.name}` : 'an NBA team';
    all.push({
      type: 'draft', season: p.draftYear,
      text: `Drafted Round ${p.draftRound} (#${p.draftPick} overall) by the ${teamLabel}.`,
    });
  } else {
    const firstSeason = p.careerStats?.[0]?.season;
    if (firstSeason != null) {
      all.push({ type: 'draft', season: firstSeason, text: 'Entered the league as an undrafted free agent.' });
    }
  }

  // All-Star selections — collapsed into one entry
  const allStarSeasons = (p.awards ?? [])
    .filter((a) => a.award === 'All-Star')
    .map((a) => a.season)
    .sort((a, b) => a - b);
  if (allStarSeasons.length === 1) {
    all.push({ type: 'first-allstar', season: allStarSeasons[0], text: 'Named to the All-Star Game.' });
  } else if (allStarSeasons.length > 1) {
    all.push({ type: 'first-allstar', season: allStarSeasons[0], text: `${allStarSeasons.length}× All-Star (${allStarSeasons.join(', ')}).` });
  }

  // Notable individual awards
  for (const a of (p.awards ?? [])) {
    if (NOTABLE_AWARDS.has(a.award)) {
      all.push({ type: 'award', season: a.season, text: `Won ${a.award}.` });
    }
  }

  return all
    .filter((m) => m.season != null)
    .sort((a, b) => a.season - b.season);
}
