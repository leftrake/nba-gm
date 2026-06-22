// Proactive heads-up for the user's own dramatic stat milestones — promotes
// the most notable cases out of the passive news feed into a brief blocking
// modal, mirroring coachTalk.js. Built on top of legacy.js's existing
// record-pace tracking (for all-time records) plus a new 50-40-90 season
// check (a famous shooting-line milestone the record book doesn't track).

import { fgPct, tpPct, ftPct } from './stats.js';
import { pushNews } from './save.js';

const FIFTY_FORTY_NINETY_MIN_GP = 20;
const FIFTY_FORTY_NINETY_MIN_FGA = 150;
const FIFTY_FORTY_NINETY_MIN_TPA = 50;
const FIFTY_FORTY_NINETY_MIN_FTA = 50;

// Any other interactive prompt already on screen takes priority — at most
// one nudge interrupts the sim per day.
function hasPendingInteractiveEvent(team) {
  return !!(team.pendingCoachTalk || team.pendingMilestoneAlert || team.pendingCallUpPrompt);
}

function maybeQueueRecordPaceAlert(league, userTeam, flaggedThisWeek) {
  if (hasPendingInteractiveEvent(userTeam)) return;
  const mine = (flaggedThisWeek || []).find((f) => f.teamId === userTeam.id);
  if (!mine) return;
  userTeam.pendingMilestoneAlert = { text: `🏆 ${mine.text}` };
}

function maybeQueueFiftyFortyNinetyAlert(league, userTeam) {
  if (hasPendingInteractiveEvent(userTeam)) return;
  for (const p of userTeam.roster) {
    const s = p.stats;
    if (s.gp < FIFTY_FORTY_NINETY_MIN_GP) continue;
    if (s.fga < FIFTY_FORTY_NINETY_MIN_FGA || s.tpa < FIFTY_FORTY_NINETY_MIN_TPA || s.fta < FIFTY_FORTY_NINETY_MIN_FTA) continue;
    if (fgPct(s) < 0.5 || tpPct(s) < 0.4 || ftPct(s) < 0.9) continue;
    if (p.fiftyFortyNinetyFlagged === league.season) continue;
    p.fiftyFortyNinetyFlagged = league.season;
    const text = `🎯 ${p.name} is shooting a 50-40-90 season so far `
      + `(${(fgPct(s) * 100).toFixed(1)}/${(tpPct(s) * 100).toFixed(1)}/${(ftPct(s) * 100).toFixed(1)}) `
      + `— one of the rarest shooting lines in basketball.`;
    pushNews(league, { day: league.dayIndex, category: 'milestone', major: true, teamIds: [userTeam.id], text });
    userTeam.pendingMilestoneAlert = { text };
    return;
  }
}

// Called weekly (alongside legacy.js's checkRecordPace) for the user's team only.
export function checkMilestoneAlerts(league, userTeam, flaggedThisWeek) {
  maybeQueueRecordPaceAlert(league, userTeam, flaggedThisWeek);
  maybeQueueFiftyFortyNinetyAlert(league, userTeam);
}
