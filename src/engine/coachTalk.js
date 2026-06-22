// Coach-relayed locker room conversations (user team only): periodically the
// head coach flags a specific, named issue — good or bad — and the GM picks a
// response. Built on top of morale.js's existing per-player streaks, trade-
// demand tracking, and team turmoil; this module just decides when to surface
// one as an interactive moment and what each response actually does.

import { overall, salaryFor } from './players.js';
import { adjustMorale, bumpRosterMorale, MORALE_WARNING_STREAK, TRADE_DEMAND_STREAK } from './morale.js';
import { pushNews } from './save.js';

const ROLE_TALK_STREAK = 8; // consecutive underplayed nights before the coach brings it up
const SKID_TALK_LENGTH = 4; // consecutive losses before the coach brings it up
const WIN_STREAK_TALK_LENGTH = 5; // consecutive wins before the coach brings it up
const COOLDOWN_DAYS = 18; // minimum gap between coach conversations, any cause
const UNDERPAID_MORALE_CEILING = 45; // contract frustration only registers once morale's already sagging
const UNDERPAID_VALUE_RATIO = 0.75; // current salary vs. salaryFor() below this reads as "underpaid"
const BREAKOUT_MORALE_FLOOR = 78;
const BREAKOUT_MAX_AGE = 23;

export const COACH_TALK_OPTIONS = {
  minutes: [
    { id: 'promise', label: 'Promise him more minutes' },
    { id: 'reassure', label: 'Tell him to stay patient and earn it' },
    { id: 'dismiss', label: 'Say nothing for now' },
  ],
  losing_skid: [
    { id: 'address_team', label: 'Address the team yourself' },
    { id: 'stay_quiet', label: 'Let the coach handle it' },
  ],
  underpaid: [
    { id: 'reassure_extension', label: 'Tell him a new deal is coming' },
    { id: 'point_to_performance', label: 'Tell him to let his play speak for itself' },
    { id: 'dismiss', label: 'Say nothing for now' },
  ],
  star_unhappy: [
    { id: 'reassure', label: 'Sit down with him and address it directly' },
    { id: 'give_space', label: 'Give him space for now' },
  ],
  hot_streak: [
    { id: 'keep_it_going', label: 'Tell them to keep riding the wave' },
    { id: 'stay_grounded', label: 'Stay even-keeled, no big speech' },
  ],
  breakout_player: [
    { id: 'praise_publicly', label: 'Praise him publicly to the media' },
    { id: 'praise_privately', label: 'Praise him one-on-one, low-key' },
  ],
};

function coachName(team) {
  return team.coach?.name ?? 'Your coach';
}

export function coachTalkQuote(league, team, talk) {
  const p = talk.playerId ? team.roster.find((r) => r.id === talk.playerId) : null;
  if (talk.cause === 'minutes') {
    if (!p) return null;
    return `${coachName(team)} pulls you aside: "${p.name}'s not said much, but I can tell he's frustrated with his role — he thinks he deserves more run than he's getting."`;
  }
  if (talk.cause === 'losing_skid') {
    return `${coachName(team)} stops by your office: "The room's getting tense with the losing — might be worth saying something to the guys before it festers."`;
  }
  if (talk.cause === 'underpaid') {
    if (!p) return null;
    return p.contract.years <= 1
      ? `${coachName(team)} mentions it in passing: "${p.name}'s in the last year of his deal and starting to wonder where he stands with the front office."`
      : `${coachName(team)} flags it: "${p.name} doesn't think his contract reflects what he's bringing to this team. It's eating at him."`;
  }
  if (talk.cause === 'star_unhappy') {
    if (!p) return null;
    return `${coachName(team)} closes the door behind him: "${p.name} hasn't said anything publicly, but I'm hearing his frustration building. If this keeps up, he might ask out."`;
  }
  if (talk.cause === 'hot_streak') {
    return `${coachName(team)} catches you in good spirits: "The guys are feeling it right now — might be worth saying something while we're rolling."`;
  }
  if (talk.cause === 'breakout_player') {
    if (!p) return null;
    return `${coachName(team)} can't help but smile: "${p.name}'s been terrific lately. A kid his age playing with that kind of confidence — that's worth recognizing."`;
  }
  return null;
}

function findStarUnhappy(team) {
  const candidates = team.roster
    .filter((p) => overall(p) >= 75 && !p.tradeDemand
      && (p.moraleLowStreak ?? 0) >= MORALE_WARNING_STREAK && (p.moraleLowStreak ?? 0) < TRADE_DEMAND_STREAK)
    .sort((a, b) => (b.moraleLowStreak ?? 0) - (a.moraleLowStreak ?? 0));
  return candidates.length ? { cause: 'star_unhappy', playerId: candidates[0].id } : null;
}

function findLosingSkid(team) {
  return (team.streak?.result === 'L' && team.streak.count === SKID_TALK_LENGTH) ? { cause: 'losing_skid' } : null;
}

function findMinutesFrustration(team) {
  const candidates = team.roster
    .filter((p) => overall(p) >= 60 && !p.tradeDemand && (p.roleLowStreak ?? 0) >= ROLE_TALK_STREAK)
    .sort((a, b) => (b.roleLowStreak ?? 0) - (a.roleLowStreak ?? 0));
  return candidates.length ? { cause: 'minutes', playerId: candidates[0].id } : null;
}

function findUnderpaid(team) {
  const candidates = team.roster
    .filter((p) => p.contract && overall(p) >= 65 && !p.tradeDemand && (p.morale ?? 50) < UNDERPAID_MORALE_CEILING
      && (p.contract.years <= 1 || p.contract.salary < salaryFor(overall(p), p.age) * UNDERPAID_VALUE_RATIO))
    .sort((a, b) => (a.morale ?? 50) - (b.morale ?? 50));
  return candidates.length ? { cause: 'underpaid', playerId: candidates[0].id } : null;
}

function findHotStreak(team) {
  return (team.streak?.result === 'W' && team.streak.count === WIN_STREAK_TALK_LENGTH) ? { cause: 'hot_streak' } : null;
}

function findBreakoutPlayer(team) {
  const candidates = team.roster
    .filter((p) => p.age <= BREAKOUT_MAX_AGE && overall(p) >= 60 && (p.morale ?? 50) >= BREAKOUT_MORALE_FLOOR)
    .sort((a, b) => (b.morale ?? 50) - (a.morale ?? 50));
  return candidates.length ? { cause: 'breakout_player', playerId: candidates[0].id } : null;
}

// Checked in this order so a brewing problem always wins out over flavor
// good news on a day where both happen to be true.
const FINDERS = [
  findStarUnhappy, findLosingSkid, findMinutesFrustration, findUnderpaid, findHotStreak, findBreakoutPlayer,
];

// Looks for one conversation-worthy issue on the user's team and queues it
// as team.pendingCoachTalk for the UI to surface; no-op if one is already
// pending or the cooldown since the last conversation hasn't elapsed.
export function maybeCoachConversation(league, team, rng) {
  if (team.pendingCoachTalk) return;
  if (league.dayIndex - (team.lastCoachTalkDay ?? -Infinity) < COOLDOWN_DAYS) return;
  for (const find of FINDERS) {
    const found = find(team);
    if (found) {
      team.pendingCoachTalk = { ...found, day: league.dayIndex };
      team.lastCoachTalkDay = league.dayIndex;
      return;
    }
  }
}

// Applies the GM's chosen response and clears the pending conversation.
export function resolveCoachTalk(league, team, optionId) {
  const talk = team.pendingCoachTalk;
  if (!talk) return;
  const p = talk.playerId ? team.roster.find((r) => r.id === talk.playerId) : null;
  const news = (text, major = false) => pushNews(league, { day: league.dayIndex, category: 'morale', major, teamIds: [team.id], text });

  if (talk.cause === 'minutes' && p) {
    if (optionId === 'promise') {
      p.minutesPromise = { untilDay: league.dayIndex + 14 };
      adjustMorale(p, 3);
      news(`You promise ${p.name} more playing time. He's watching for it.`);
    } else if (optionId === 'reassure') {
      adjustMorale(p, 1);
      news(`You tell ${p.name} to stay patient and keep earning it.`);
    } else {
      news(`You let ${p.name}'s playing-time concerns go unaddressed for now.`);
    }
    p.roleLowStreak = 0;
  } else if (talk.cause === 'losing_skid') {
    if (optionId === 'address_team') {
      bumpRosterMorale(team, 2);
      news(`You address the team directly during the slide. The room seems to respond.`);
    } else {
      news(`You leave it to ${coachName(team)} to settle the room during the slide.`);
    }
  } else if (talk.cause === 'underpaid' && p) {
    if (optionId === 'reassure_extension') {
      adjustMorale(p, 3);
      news(`You tell ${p.name} a new contract is coming when the time is right.`);
    } else if (optionId === 'point_to_performance') {
      adjustMorale(p, 1);
      news(`You tell ${p.name} to let his play on the court do the talking.`);
    } else {
      news(`You leave ${p.name}'s contract concerns unaddressed for now.`);
    }
  } else if (talk.cause === 'star_unhappy' && p) {
    if (optionId === 'reassure') {
      adjustMorale(p, 4);
      p.moraleLowStreak = Math.max(0, (p.moraleLowStreak ?? 0) - 10);
      news(`You sit down with ${p.name} and reassure him about the team's direction.`);
    } else {
      news(`You decide to give ${p.name} some space for now.`);
    }
  } else if (talk.cause === 'hot_streak') {
    if (optionId === 'keep_it_going') {
      bumpRosterMorale(team, 2);
      news(`You tell the team to keep riding the wave. The room responds.`);
    } else {
      news(`You keep things businesslike during the streak, not wanting the team to get complacent.`);
    }
  } else if (talk.cause === 'breakout_player' && p) {
    if (optionId === 'praise_publicly') {
      adjustMorale(p, 3);
      news(`${p.name} is glowing after public praise from the front office.`, true);
    } else {
      adjustMorale(p, 2);
      news(`You praise ${p.name} one-on-one. He appreciates the recognition.`);
    }
  }

  team.pendingCoachTalk = null;
}
