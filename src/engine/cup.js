// ---------- NBA Cup (In-Season Tournament) ----------
// Group stage: all division games in the first CUP_GROUP_DAYS of the season
// count toward cup standings. Top 4 per conference advance to a single-elim
// knockout bracket (QF → SF → Final). Winner earns the NBA Cup award and
// a morale/approval boost.

import { simGame } from './sim.js';
import { makeRng } from './rng.js';
import { pushNews } from './save.js';
import { bumpRosterMorale } from './morale.js';

export const CUP_GROUP_DAYS = 45; // group stage runs days 0-44

function getTeam(league, id) {
  return league.teams.find((t) => t.id === id);
}

function cupSimGame(league, home, away, rng) {
  const homeTeam = getTeam(league, home);
  const awayTeam = getTeam(league, away);
  const r = simGame(homeTeam, awayTeam, rng);
  const rawHomeWon = r.homePts > r.awayPts;
  const homePts = r.homeBox.reduce((s, l) => s + l.pts, 0);
  const awayPts = r.awayBox.reduce((s, l) => s + l.pts, 0);
  const homeWon = homePts !== awayPts ? homePts > awayPts : rawHomeWon;
  return { home, away, homePts, awayPts, homeWon, winner: homeWon ? home : away };
}

export function initCup(season) {
  return { season, bracket: null, champion: null };
}

// Called from simDay for any division game during the group stage window.
export function updateCupGroupGame(league, homeTeam, awayTeam, homeWon) {
  if (!league.cup || league.cup.bracket) return; // bracket already seeded
  if (homeTeam.div !== awayTeam.div) return;
  if (homeWon) {
    homeTeam.cupWins = (homeTeam.cupWins || 0) + 1;
    awayTeam.cupLosses = (awayTeam.cupLosses || 0) + 1;
  } else {
    awayTeam.cupWins = (awayTeam.cupWins || 0) + 1;
    homeTeam.cupLosses = (homeTeam.cupLosses || 0) + 1;
  }
}

// Seed the 8-team bracket: division leader from each division (3 auto berths)
// + 1 wild card per conference (best runner-up). Ties broken by cupWins,
// then fewest cupLosses, then regular-season wins.
export function determineCupBracket(league) {
  const cupRank = (a, b) =>
    (b.cupWins || 0) - (a.cupWins || 0) ||
    (a.cupLosses || 0) - (b.cupLosses || 0) ||
    b.wins - a.wins;

  const top4 = (conf) => {
    const confTeams = league.teams.filter((t) => t.conf === conf);
    const divs = [...new Set(confTeams.map((t) => t.div))];
    const divWinners = divs
      .map((div) => confTeams.filter((t) => t.div === div).sort(cupRank)[0])
      .sort(cupRank);
    const winnerIds = new Set(divWinners.map((t) => t.id));
    const wildCard = confTeams
      .filter((t) => !winnerIds.has(t.id))
      .sort(cupRank)[0];
    return [...divWinners, wildCard].map((t) => t.id);
  };

  const mk = (home, away) => ({ home, away, winner: null, homePts: null, awayPts: null });
  const eastSeeds = top4('East');
  const westSeeds = top4('West');

  league.cup.bracket = {
    round: 0, // 0=QF, 1=SF, 2=Final, 3=done
    East: [mk(eastSeeds[0], eastSeeds[3]), mk(eastSeeds[1], eastSeeds[2])],
    West: [mk(westSeeds[0], westSeeds[3]), mk(westSeeds[1], westSeeds[2])],
    semis: null,
    final: null,
    eastSeeds,
    westSeeds,
  };
}

// Sim the next round of cup knockout games. Returns played games.
export function simCupGame(league) {
  const cup = league.cup;
  if (!cup?.bracket || cup.champion) return [];

  const b = cup.bracket;
  const gamesPlayed =
    (b.East?.filter((g) => g.winner).length || 0) +
    (b.West?.filter((g) => g.winner).length || 0) +
    (b.semis?.filter((g) => g.winner).length || 0) +
    (b.final?.winner ? 1 : 0);
  const rng = makeRng(league.seed + 888_001 + gamesPlayed * 41);

  const played = [];

  if (b.round === 0) {
    // Quarterfinals: all 4 games at once
    for (const conf of ['East', 'West']) {
      for (const g of b[conf]) {
        if (g.winner) continue;
        const r = cupSimGame(league, g.home, g.away, rng);
        Object.assign(g, r);
        played.push({ label: `${conf} Quarterfinal`, ...r });
      }
    }
    const allDone = ['East', 'West'].every((c) => b[c].every((g) => g.winner));
    if (allDone) {
      const mk = (home, away) => ({ home, away, winner: null, homePts: null, awayPts: null });
      b.semis = [
        mk(b.East[0].winner, b.East[1].winner),
        mk(b.West[0].winner, b.West[1].winner),
      ];
      b.round = 1;
    }
  } else if (b.round === 1) {
    // Semifinals: East SF then West SF
    for (let i = 0; i < b.semis.length; i++) {
      const g = b.semis[i];
      if (g.winner) continue;
      const r = cupSimGame(league, g.home, g.away, rng);
      Object.assign(g, r);
      played.push({ label: i === 0 ? 'East Semifinal' : 'West Semifinal', ...r });
    }
    const allDone = b.semis.every((g) => g.winner);
    if (allDone) {
      b.final = { home: b.semis[1].winner, away: b.semis[0].winner, winner: null, homePts: null, awayPts: null };
      b.round = 2;
    }
  } else if (b.round === 2 && b.final && !b.final.winner) {
    // Cup Final
    const r = cupSimGame(league, b.final.home, b.final.away, rng);
    Object.assign(b.final, r);
    played.push({ label: 'NBA Cup Final', ...r });
    cup.champion = b.final.winner;
    b.round = 3;

    const winner = getTeam(league, cup.champion);
    pushNews(league, {
      day: league.dayIndex,
      category: 'award',
      major: true,
      teamIds: [cup.champion],
      text: `🏆 ${winner.city} ${winner.name} win the NBA Cup!`,
    });
    for (const p of winner.roster) {
      if (!p.awards) p.awards = [];
      p.awards.push({ season: league.season, award: 'NBA Cup' });
    }
    bumpRosterMorale(winner, 3);
    if (!league.cupHistory) league.cupHistory = [];
    league.cupHistory.push({ season: league.season, champion: cup.champion });
  }

  // Add game-result news items
  for (const g of played) {
    const homeT = getTeam(league, g.home);
    const awayT = getTeam(league, g.away);
    if (!homeT || !awayT) continue;
    const win = g.homeWon ? homeT : awayT;
    const lose = g.homeWon ? awayT : homeT;
    const ws = g.homeWon ? g.homePts : g.awayPts;
    const ls = g.homeWon ? g.awayPts : g.homePts;
    pushNews(league, {
      day: league.dayIndex,
      category: 'game',
      teamIds: [g.home, g.away],
      text: `NBA Cup ${g.label}: ${win.city} ${win.name} ${ws}-${ls} over ${lose.city} ${lose.name}.`,
    });
  }

  return played;
}

export function cupComplete(league) {
  return !!league.cup?.champion;
}
