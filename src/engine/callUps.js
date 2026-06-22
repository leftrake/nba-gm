// G-League call-up prompts: simGLeagueGame already plays out a nightly box
// score for every two-way player (see league.js's simDay), but until now
// those numbers just accumulated silently into gLeagueStats. This tracks a
// hot stretch and, once it's notable, surfaces an interactive "call him up?"
// prompt for the user's own two-way roster — resolved by the UI, which
// performs the actual callUpTwoWay/decline so this module stays decoupled
// from league.js (avoiding a circular import).

import { ROSTER_MAX } from '../data/teams.js';
import { perGame } from './stats.js';
import { pushNews } from './save.js';

const HOT_GAME_PTS = 25; // a big enough G-League scoring night to count toward the streak
const HOT_STREAK_GAMES = 3; // consecutive hot nights before the affiliate calls
const COOLDOWN_DAYS = 14; // minimum gap between call-up prompts

function hasPendingInteractiveEvent(team) {
  return !!(team.pendingCoachTalk || team.pendingMilestoneAlert || team.pendingCallUpPrompt);
}

// Called right after simGLeagueGame for every two-way player, every night
// they have a G-League game (see league.js's simDay).
export function updateGLeagueHotStreak(p, box) {
  p.gLeagueHotStreak = box.pts >= HOT_GAME_PTS ? (p.gLeagueHotStreak ?? 0) + 1 : 0;
}

// Looks for a two-way player on a hot enough stretch to queue an interactive
// call-up prompt for the user's team.
export function maybeQueueCallUpPrompt(league, userTeam) {
  if (hasPendingInteractiveEvent(userTeam)) return;
  if (userTeam.roster.length >= ROSTER_MAX) return; // nowhere to put him anyway
  if (league.dayIndex - (userTeam.lastCallUpPromptDay ?? -Infinity) < COOLDOWN_DAYS) return;
  const candidates = (userTeam.twoWay || [])
    .filter((p) => (p.gLeagueHotStreak ?? 0) >= HOT_STREAK_GAMES)
    .sort((a, b) => (b.gLeagueHotStreak ?? 0) - (a.gLeagueHotStreak ?? 0));
  if (!candidates.length) return;
  const p = candidates[0];
  const ppg = perGame(p.gLeagueStats, 'pts');
  userTeam.pendingCallUpPrompt = {
    playerId: p.id,
    text: `Your G-League affiliate calls: "${p.name} has been unstoppable down there — ${ppg.toFixed(1)} points a game and he's torching every defense they throw at him. Worth a call-up?"`,
  };
  userTeam.lastCallUpPromptDay = league.dayIndex;
}

// Clears the prompt. The UI calls callUpTwoWay itself (from league.js)
// *before* this when the GM accepts — this just resets the streak and, on
// a decline, records it in the news feed.
export function resolveCallUpPrompt(league, userTeam, accept) {
  const prompt = userTeam.pendingCallUpPrompt;
  if (!prompt) return;
  const p = (userTeam.twoWay || []).find((x) => x.id === prompt.playerId)
    || userTeam.roster.find((x) => x.id === prompt.playerId);
  if (p) p.gLeagueHotStreak = 0;
  if (!accept && p) {
    pushNews(league, { day: league.dayIndex, category: 'signing', teamIds: [userTeam.id], text: `You leave ${p.name} with the G-League affiliate for now.` });
  }
  userTeam.pendingCallUpPrompt = null;
}
