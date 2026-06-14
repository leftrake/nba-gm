// ---------- Contract extensions ----------
// Three distinct extension windows, modeled on real NBA rules:
//
// - 'rookie' (RFX): a 1st-round pick in year 3 or 4 of his 4-year rookie
//   scale deal. Capped at the rookie max. If the window closes unsigned, he
//   enters restricted free agency (league.js advanceOffseason/simFreeAgencyDay).
// - 'veteran': 3+ years of experience, 2+ years left on his current deal.
//   Adds years at a salary within +/-20% of his current annual value.
// - 'final': anyone in the last year of his contract — the last chance
//   before free agency, at market rate.
//
// extensionType() resolves which window (if any) applies; 'rookie' takes
// priority over 'final' when a rookie-scale deal is in its last year.

import { SALARY_CAP, MIN_SALARY, MAX_SALARY } from '../data/teams.js';
import { clamp } from './rng.js';

export function extensionType(p) {
  return extensionTypeAt(p, 0);
}

// Same resolution as extensionType(), but projected `seasonsOut` seasons
// into the future (0 = this season) — used by the payroll projection screen
// to flag which window will apply when a player's current deal is up.
export function extensionTypeAt(p, seasonsOut) {
  if (!p.contract || p.extension) return null;
  const yearsLeft = p.contract.years - seasonsOut;
  if (yearsLeft < 1) return null;
  const exp = (p.exp ?? 0) + seasonsOut;
  const onRookieDeal = p.draftPick && p.draftPick <= 30 && exp <= 3;
  if (onRookieDeal && yearsLeft <= 2) return 'rookie';
  if (yearsLeft === 1) return 'final';
  if (exp >= 3 && yearsLeft >= 2) return 'veteran';
  return null;
}

// Rookie max: 25% of the cap, bumped to 30% for a "designated" rookie who
// earned an All-NBA/All-Defensive/MVP nod during his rookie deal.
export function rookieMax(p) {
  const elite = (p.awards || []).some((a) =>
    /All-NBA|All-Defensive|MVP/.test(a.award) && a.season <= (p.draftYear ?? a.season) + 4
  );
  return Math.round((SALARY_CAP * (elite ? 0.30 : 0.25)) / 100_000) * 100_000;
}

// Salary bounds an extension offer can land in, by type.
export function extensionSalaryRange(p, type) {
  if (type === 'rookie') return { min: MIN_SALARY, max: rookieMax(p) };
  if (type === 'veteran') {
    const cur = p.contract.salary;
    return {
      min: clamp(Math.round((cur * 0.8) / 100_000) * 100_000, MIN_SALARY, MAX_SALARY),
      max: clamp(Math.round((cur * 1.2) / 100_000) * 100_000, MIN_SALARY, MAX_SALARY),
    };
  }
  return { min: MIN_SALARY, max: MAX_SALARY }; // 'final': market rate
}

// Human-readable stakes for the roster screen — what happens if this window
// closes unsigned.
export function extensionWindowLabel(type) {
  if (type === 'rookie') return 'Rookie-scale extension — sign before the deal ends or he hits restricted free agency.';
  if (type === 'veteran') return 'Extension-eligible — add years at up to ±20% of his current salary.';
  if (type === 'final') return 'Final year — last chance to extend before he hits free agency.';
  return '';
}
