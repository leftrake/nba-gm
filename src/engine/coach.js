// Head coaches: one generated per team, with a specialty that nudges a
// small piece of that team's engine math. Re-signed or replaced each
// offseason on the Coaching Decisions screen (user team) or automatically
// (AI teams) — see advanceOffseason in league.js.

import { randInt, pick } from './rng.js';

export const COACH_SPECIALTIES = ['Development', 'Chemistry', 'Balanced'];

export const SPECIALTY_INFO = {
  Development: {
    label: 'Player Development',
    blurb: 'Squeezes extra growth out of young players during the offseason.',
  },
  Chemistry: {
    label: 'Team Chemistry',
    blurb: 'Keeps the locker room steady, nudging morale toward contentment.',
  },
  Balanced: {
    label: 'Balanced',
    blurb: 'A little of everything — modest gains to development and chemistry alike.',
  },
};

const FIRST_NAMES = ['Doug', 'Monty', 'Erik', 'Tyronn', 'Nate', 'Quin', 'Chauncey', 'Dawn', 'Becky', 'Ime', 'Wes', 'Frank', 'Mike', 'Steve', 'Darvin', 'J.B.', 'Taylor', 'Charlotte', 'Adrian', 'Billy'];
const LAST_NAMES = ['Rivers', 'Williams', 'Spoelstra', 'Lue', 'McMillan', 'Snyder', 'Billups', 'Staley', 'Hammon', 'Udoka', 'Unseld', 'Vogel', 'Malone', 'Kerr', 'Ham', 'Bickerstaff', 'Jenkins', 'Reid', 'Griffin', 'Donovan'];

function coachName(rng) {
  return `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`;
}

export function generateCoach(rng) {
  return {
    name: coachName(rng),
    age: randInt(38, 68, rng),
    specialty: pick(COACH_SPECIALTIES, rng),
    rating: randInt(45, 99, rng),
    seasonsWithTeam: 0,
  };
}

// Yearly ceiling (potential) nudge for players under 25 (see developPlayer),
// centered on a 70-rated coach so an average hire is a wash either way.
export function devBonus(coach) {
  if (!coach) return 0;
  if (coach.specialty === 'Development') return (coach.rating - 70) / 280;
  if (coach.specialty === 'Balanced') return (coach.rating - 70) / 560;
  return 0;
}

// Tiny daily morale drift applied alongside dailyMoraleUpdate.
export function chemistryBonus(coach) {
  if (!coach) return 0;
  if (coach.specialty === 'Chemistry') return (coach.rating - 70) * 0.001;
  if (coach.specialty === 'Balanced') return (coach.rating - 70) * 0.0005;
  return 0;
}
