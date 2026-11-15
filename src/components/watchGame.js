// Turning a game the app already has into what the live viewer needs.
//
// Plain JS, like liveFrames.js, so headless checks run the same code.

import { getTeam } from '../engine/league.js';
import { decodeBox } from '../engine/sim.js';

// Box lines come as objects (a fresh sim) or as the save's compact arrays.
const lines = (box) => (box?.length && Array.isArray(box[0]) ? decodeBox(box) : box ?? []);

// Can this game be watched? It needs the structured play-by-play — every
// play's kind and actor — and the lineup log. Saves from before those
// existed don't have them, and only the user's games keep play-by-play once
// the day is over.
export function canWatch(game) {
  return !!(game?.playByPlay?.length && game.lineups?.length && game.playByPlay.some((p) => p.k));
}

// The game as the viewer reads it: box lines as objects.
export function forViewer(game) {
  return { injuryReport: [], ...game, homeBox: lines(game.homeBox), awayBox: lines(game.awayBox) };
}

// A team as it took the floor that night: today's name and colors, but the
// roster from the box score. A replay from before a trade has to find the
// players who were actually in it, wherever they are now.
export function asPlayed(league, teamId, box) {
  const index = new Map();
  for (const t of league.teams) for (const p of t.roster) index.set(p.id, p);
  for (const p of league.freeAgents ?? []) if (!index.has(p.id)) index.set(p.id, p);
  const roster = lines(box).map((l) => index.get(l.playerId)
    ?? { id: l.playerId, name: 'Unknown player', pos: 'SF', stats: {} });
  return { ...getTeam(league, teamId), roster };
}

// How a replay counts: nothing about the night survives except the game
// itself, so no records, no injury list, and season averages as they stand.
export const REPLAY = {
  kicker: 'Replay',
  replay: true,
  pregame: { records: false, tonightInStats: false, showOut: false },
};

const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

// "Lakers lead 2–1", "Series tied 1–1" — for the series between `a` and `b`
// with each side's wins.
function seriesLine(teamA, winsA, teamB, winsB, over) {
  if (winsA === winsB) return winsA === 0 ? null : `Series tied ${winsA}–${winsB}`;
  const [lead, lw, tw] = winsA > winsB ? [teamA, winsA, winsB] : [teamB, winsB, winsA];
  return over ? `${lead.name} win the series ${lw}–${tw}` : `${lead.name} lead the series ${lw}–${tw}`;
}

// A playoff game, from simPlayoffGame's entry for it: the round and game
// number up top, the series before tip-off, and where it stands after.
export function playoffContext(league, entry) {
  const { series: m, game, round } = entry;
  const n = m.games.indexOf(game) + 1;
  const high = getTeam(league, m.high);
  const low = getTeam(league, m.low);
  const highWonTonight = (game.homePts > game.awayPts) === (game.home === m.high);
  const before = [m.highWins - (highWonTonight ? 1 : 0), m.lowWins - (highWonTonight ? 0 : 1)];
  return {
    kicker: `${ROUND_NAMES[round] ?? 'Playoffs'} · Game ${n}`,
    subtitle: seriesLine(high, before[0], low, before[1], false),
    finalNote: seriesLine(high, m.highWins, low, m.lowWins, !!m.winner),
    pregame: { records: false, tonightInStats: false },
  };
}
