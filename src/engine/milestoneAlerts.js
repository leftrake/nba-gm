// Proactive heads-up for the user's own dramatic stat milestones — promotes
// the most notable cases out of the passive news feed into a brief blocking
// modal, mirroring coachTalk.js. Built on top of legacy.js's existing
// record-pace tracking (for all-time records) plus a new 50-40-90 season
// check (a famous shooting-line milestone the record book doesn't track),
// and, during the playoffs, series comeback/sweep moments.

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

// The user's own currently-active series, if any — reimplemented locally
// (rather than importing league.js's teamPlayoffStatus) to avoid a circular
// import, since league.js imports checkMilestoneAlerts from this module.
function activeSeriesFor(league, team) {
  const po = league.playoffs;
  if (!po) return null;
  if (po.finals && !po.finals.winner && (po.finals.high === team.id || po.finals.low === team.id)) return po.finals;
  for (const m of po[team.conf] || []) {
    if (!m.winner && (m.high === team.id || m.low === team.id)) return m;
  }
  return null;
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

// Down 0-2 in the user's active series, then won the next two to tie it at
// 2-2 — a genuine comeback, not just a series that started even.
function maybeQueueSeriesComebackAlert(league, userTeam) {
  if (hasPendingInteractiveEvent(userTeam)) return;
  const series = activeSeriesFor(league, userTeam);
  if (!series || (series.games?.length ?? 0) < 4) return;
  const isHigh = series.high === userTeam.id;
  const myWins = isHigh ? series.highWins : series.lowWins;
  const oppWins = isHigh ? series.lowWins : series.highWins;
  if (myWins !== 2 || oppWins !== 2) return;
  const lostFirstTwo = series.games.slice(0, 2).every((g) => {
    const homeWon = g.homePts > g.awayPts;
    const myTeamWasHome = g.home === userTeam.id;
    return myTeamWasHome ? !homeWon : homeWon;
  });
  if (!lostFirstTwo) return;
  const key = `${league.season}-${series.high}-${series.low}`;
  if (userTeam.lastComebackAlertKey === key) return;
  userTeam.lastComebackAlertKey = key;
  const text = `🔥 Down 0-2, the ${userTeam.city} ${userTeam.name} have won two straight to tie the series at 2-2.`;
  pushNews(league, { day: league.dayIndex, category: 'milestone', major: true, teamIds: [userTeam.id], text });
  userTeam.pendingMilestoneAlert = { text };
}

// The user's team just swept a series 4-0 — a statement result worth more
// than a line in the news feed.
function maybeQueueSweepAlert(league, userTeam) {
  if (hasPendingInteractiveEvent(userTeam)) return;
  const po = league.playoffs;
  if (!po) return;
  const latest = [...(po.completed || [])].reverse()
    .find((e) => e.series.high === userTeam.id || e.series.low === userTeam.id);
  if (!latest) return;
  const { series, round } = latest;
  if (series.winner !== userTeam.id) return;
  if (Math.min(series.highWins, series.lowWins) !== 0) return;
  if (userTeam.lastSweepAlertRound === round) return;
  userTeam.lastSweepAlertRound = round;
  const text = `🧹 The ${userTeam.city} ${userTeam.name} sweep their series 4-0.`;
  pushNews(league, { day: league.dayIndex, category: 'milestone', major: true, teamIds: [userTeam.id], text });
  userTeam.pendingMilestoneAlert = { text };
}

// Called weekly during the regular season (alongside legacy.js's
// checkRecordPace) or after every playoff game, for the user's team only.
export function checkMilestoneAlerts(league, userTeam, flaggedThisWeek) {
  if (league.phase === 'playoffs') {
    maybeQueueSeriesComebackAlert(league, userTeam);
    maybeQueueSweepAlert(league, userTeam);
    return;
  }
  maybeQueueRecordPaceAlert(league, userTeam, flaggedThisWeek);
  maybeQueueFiftyFortyNinetyAlert(league, userTeam);
}
