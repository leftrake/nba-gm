// ---------- All-Star Weekend ----------
// A mid-season event: "fan vote" starters and coach-selected reserves drawn
// from each conference's statistical leaders, a real possession-based
// exhibition game (relaxed defense — see RELAX_DEFENSE), and a First-Half
// Honors snapshot of the league's per-game leaders so far.
// Everything stored on league.allStar is plain data (serializable).

import { pg, valueScore, statLeaders, LEADER_CATS } from './awards.js';
import { simGame, encodeBox, starLines } from './sim.js';
import { autoLineup, TOTAL_MINUTES } from './lineup.js';
import { makeRng } from './rng.js';
import { pushNews } from './save.js';

const STARTERS_PER_CONF = 5;
const RESERVES_PER_CONF = 7;

// The two All-Star sides as teams the rest of the app can show (getTeam
// falls back to these).
export const ALLSTAR_TEAMS = {
  EAST: { id: 'EAST', city: 'Team', name: 'East', color: '#1d428a', conf: 'East' },
  WEST: { id: 'WEST', city: 'Team', name: 'West', color: '#c8102e', conf: 'West' },
};

// Everyone in the conference who has played this season, best first — those
// who've played at least half their team's games ahead of those who haven't.
//
// The minimum used to be half the *calendar* day, from when a day was a game
// day. With 82 games spread over 176 days, at the All-Star break (day 116)
// that asked for 58 games when no one had played more than 57: nobody was
// eligible, the rosters came out empty, and the game crashed on two teams
// with no players. Falling back to the rest of the conference, rather than
// dropping them, means a roster can never come out short again.
function eligiblePlayers(league, conf) {
  const rows = [];
  for (const team of league.teams) {
    if (team.conf !== conf) continue;
    const minGp = Math.max(1, Math.floor(((team.wins ?? 0) + (team.losses ?? 0)) * 0.5));
    for (const p of team.roster) {
      const gp = p.stats?.gp || 0;
      if (gp === 0) continue;
      rows.push({ playerId: p.id, teamId: team.id, enough: gp >= minGp, score: valueScore(p.stats) });
    }
  }
  return rows.sort((a, b) => (b.enough - a.enough) || (b.score - a.score));
}

// Top 5 per conference (by overall value, a stand-in for the fan vote) are
// "starters"; the next 7 (a stand-in for the coaches' reserve selections)
// are "reserves".
export function selectAllStars(league) {
  const out = {};
  for (const conf of ['East', 'West']) {
    const ranked = eligiblePlayers(league, conf);
    out[conf] = {
      starters: ranked.slice(0, STARTERS_PER_CONF).map(({ playerId, teamId }) => ({ playerId, teamId })),
      reserves: ranked.slice(STARTERS_PER_CONF, STARTERS_PER_CONF + RESERVES_PER_CONF).map(({ playerId, teamId }) => ({ playerId, teamId })),
    };
  }
  return out;
}

export function getPlayerById(league, playerId) {
  for (const team of league.teams) {
    const p = team.roster.find((x) => x.id === playerId);
    if (p) return { player: p, team };
  }
  return null;
}

// True if any of the user's players were selected as an All-Star (starter
// or reserve, either conference) — used to give the moment extra weight.
export function userHasAllStar(league) {
  if (!league.allStar || !league.userTeamId) return false;
  for (const conf of ['East', 'West']) {
    const roster = league.allStar.rosters[conf];
    for (const r of [...roster.starters, ...roster.reserves]) {
      if (r.teamId === league.userTeamId) return true;
    }
  }
  return false;
}

// Top-3 per category league-wide at the All-Star break.
export function firstHalfHonors(league) {
  return LEADER_CATS.map(([key, label, unit]) => ({
    key,
    label,
    unit,
    leaders: statLeaders(league, key, 3).map((r) => ({ playerId: r.p.id, teamId: r.team.id, value: r.value })),
  }));
}

function awardAllStars(league, rosters) {
  for (const conf of ['East', 'West']) {
    for (const r of [...rosters[conf].starters, ...rosters[conf].reserves]) {
      const found = getPlayerById(league, r.playerId);
      if (!found) continue;
      const p = found.player;
      if (!p.awards) p.awards = [];
      p.awards.push({ season: league.season, award: 'All-Star' });
    }
  }
}

// Rosters are announced and First-Half Honors locked in immediately; the
// game itself is simulated on demand from AllStarScreen (so the user can
// see the rosters first, especially if one of their own players is in it).
export function buildAllStarEvent(league) {
  const rosters = selectAllStars(league);
  awardAllStars(league, rosters);
  return {
    season: league.season,
    rosters,
    game: null,
    honors: firstHalfHonors(league),
    shown: false,
  };
}

// A save that reached the break under the old eligibility rule holds this
// season's event with nobody on it — and since the calendar won't sim past
// the break until the game is played, that save was stuck there. Pick the
// rosters now (and name the All-Stars, which never happened). A no-op for
// any event that has players or has already been played. Returns whether
// it changed anything.
export function repairAllStarRosters(league) {
  const as = league.allStar;
  if (!as || as.game || as.season !== league.season) return false;
  const empty = ['East', 'West'].some((c) => !as.rosters?.[c]?.starters?.length);
  if (!empty) return false;
  as.rosters = selectAllStars(league);
  awardAllStars(league, as.rosters);
  return true;
}

// Exhibition-style defense: each player's defense rating is heavily damped,
// which (via the existing sim formulas) both raises shooting percentages and
// lowers turnover rates — a higher-scoring, sloppier-defense game without
// touching sim.js itself.
const RELAX_DEFENSE = 0.55;

function exhibitionRoster(league, roster) {
  return roster.map(({ playerId }) => {
    const { player: p } = getPlayerById(league, playerId);
    return {
      ...p,
      condition: 100,
      injury: null,
      ratings: {
        ...p.ratings,
        perimeterDefense: Math.max(25, Math.round(p.ratings.perimeterDefense * RELAX_DEFENSE)),
        interiorDefense: Math.max(25, Math.round(p.ratings.interiorDefense * RELAX_DEFENSE)),
        steal: Math.max(25, Math.round(p.ratings.steal * RELAX_DEFENSE)),
        block: Math.max(25, Math.round(p.ratings.block * RELAX_DEFENSE)),
      },
    };
  });
}

// Everyone plays. The voted starters start, each in the slot that suits him
// best, and the seven reserves split the rest of the minutes. Left to
// autoLineup — a regular-season rotation, ten deep — the 11th and 12th
// All-Stars on each side never got off the bench.
const ALL_STAR_STARTER_MIN = 26;
function allStarLineup(roster) {
  const { starters } = autoLineup(roster.slice(0, STARTERS_PER_CONF));
  for (const pos of Object.keys(starters)) starters[pos].min = ALL_STAR_STARTER_MIN;
  const reserves = roster.slice(STARTERS_PER_CONF);
  const left = TOTAL_MINUTES - ALL_STAR_STARTER_MIN * STARTERS_PER_CONF;
  const bench = reserves.map((p, i) => ({
    id: p.id,
    min: Math.floor(left / reserves.length) + (i < left % reserves.length ? 1 : 0),
  }));
  return { starters, bench };
}

// Runs the real possession sim for the All-Star Game, stores a full box
// score on league.allStar.game, and records the MVP award. Returns the stored
// game plus, for a caller that wants to watch it, the whole sim result
// (`full`) and both sides as teams with their exhibition rosters (`teams`) —
// neither of which is stored.
export function simAllStarGame(league) {
  const as = league.allStar;
  repairAllStarRosters(league);
  const rng = makeRng(league.seed + league.season * 67_867 + 444_001);
  const eastRoster = exhibitionRoster(league, [...as.rosters.East.starters, ...as.rosters.East.reserves]);
  const westRoster = exhibitionRoster(league, [...as.rosters.West.starters, ...as.rosters.West.reserves]);
  const eastTeam = { id: 'EAST', name: 'Team East', conf: 'East', roster: eastRoster, lineup: allStarLineup(eastRoster) };
  const westTeam = { id: 'WEST', name: 'Team West', conf: 'West', roster: westRoster, lineup: allStarLineup(westRoster) };

  const result = simGame(eastTeam, westTeam, rng);
  const allLines = [...result.homeBox, ...result.awayBox];
  const mvpLine = starLines(allLines, 1)[0];
  const mvpFound = mvpLine ? getPlayerById(league, mvpLine.playerId) : null;

  as.game = {
    home: 'EAST',
    away: 'WEST',
    homePts: result.homePts,
    awayPts: result.awayPts,
    homeBox: encodeBox(result.homeBox),
    awayBox: encodeBox(result.awayBox),
    homeQtrs: result.homeQtrs,
    awayQtrs: result.awayQtrs,
    events: result.events,
    winner: result.homePts >= result.awayPts ? 'East' : 'West',
    mvpPlayerId: mvpFound ? mvpFound.player.id : null,
  };

  if (mvpFound) {
    const p = mvpFound.player;
    if (!p.awards) p.awards = [];
    p.awards.push({ season: league.season, award: 'All-Star MVP' });
  }

  const winnerConf = as.game.winner;
  const mvpText = mvpFound ? ` ${mvpFound.player.name} (${mvpFound.team.name}) takes home All-Star Game MVP.` : '';
  pushNews(league, {
    day: league.dayIndex, category: 'award', major: true,
    teamIds: mvpFound ? [mvpFound.team.id] : undefined,
    text: `⭐ Team ${winnerConf} wins the All-Star Game, ${Math.max(result.homePts, result.awayPts)}-${Math.min(result.homePts, result.awayPts)}.${mvpText}`,
  });

  return {
    ...as.game,
    full: result,
    teams: { home: { ...ALLSTAR_TEAMS.EAST, roster: eastRoster }, away: { ...ALLSTAR_TEAMS.WEST, roster: westRoster } },
  };
}
