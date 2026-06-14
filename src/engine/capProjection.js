// ---------- Future payroll projection ----------
// Pure helpers for the multi-season cap-projection screen. "seasonsOut"
// counts from the current season (0 = this season, matching the same
// numbers payroll()/deadMoneyTotal() report on the Roster/Cap screen).

import { SALARY_CAP, LUXURY_TAX, ROSTER_MIN, MIN_SALARY } from '../data/teams.js';

export const PROJECTION_YEARS = 4;

// No "apron" constant exists in teams.js yet — derive one in line with the
// real NBA's second-apron gap above the luxury tax line.
export const APRON = LUXURY_TAX + 17_500_000;

// A player's salary `seasonsOut` seasons from now, or null once his current
// contract (and any signed extension) has run out.
//   - includeExtensions=false models the worst case: only the current
//     contract counts, as if no extension had been signed.
export function projectedSalary(p, seasonsOut, includeExtensions = true) {
  if (!p.contract) return null;
  if (seasonsOut < p.contract.years) return p.contract.salary;
  if (includeExtensions && p.extension) {
    const extYearsOut = seasonsOut - p.contract.years;
    if (extYearsOut < p.extension.years) return p.extension.salary;
  }
  return null;
}

// True if the player is under contract this season but off the books the
// next — i.e. `seasonsOut` is his last guaranteed season.
export function isExpiringIn(p, seasonsOut, includeExtensions = true) {
  return (
    projectedSalary(p, seasonsOut, includeExtensions) !== null &&
    projectedSalary(p, seasonsOut + 1, includeExtensions) === null
  );
}

// Dead money still on the books `seasonsOut` seasons from now. Dead money
// entries decay by 1 year each offseason (years: 1 means it counts for the
// current season only), so an entry applies while years - seasonsOut > 0.
export function projectedDeadMoney(team, seasonsOut) {
  return (team.deadMoney || [])
    .filter((d) => d.years - seasonsOut > 0)
    .reduce((s, d) => s + d.salary, 0);
}

// Restricted-free-agency candidates: 1st-round picks whose rookie-scale deal
// expires in `seasonsOut` seasons, with no extension signed yet.
export function isRfaCandidate(p, seasonsOut, includeExtensions = true) {
  if (!p.draftPick || p.draftPick > 30 || p.extension) return false;
  if (!isExpiringIn(p, seasonsOut, includeExtensions)) return false;
  return (p.exp ?? 0) + seasonsOut <= 3;
}

// Total projected payroll for a team in season `seasonsOut`.
export function projectedPayroll(team, seasonsOut, includeExtensions = true) {
  const salaries = team.roster.reduce(
    (s, p) => s + (projectedSalary(p, seasonsOut, includeExtensions) || 0), 0
  );
  return salaries + projectedDeadMoney(team, seasonsOut);
}

// Cap space in season `seasonsOut`, accounting for a roster-minimum salary
// floor: if fewer than ROSTER_MIN players have a projected salary, the
// shortfall is assumed to be filled at MIN_SALARY each.
export function projectedCapSpace(team, seasonsOut, includeExtensions = true) {
  const total = projectedPayroll(team, seasonsOut, includeExtensions);
  const rosterCount = team.roster.filter((p) => projectedSalary(p, seasonsOut, includeExtensions) !== null).length;
  const shortfall = Math.max(0, ROSTER_MIN - rosterCount) * MIN_SALARY;
  return SALARY_CAP - (total + shortfall);
}

// Color-coded payroll status for a projected total, relative to cap/tax/apron.
export function payrollStatus(total) {
  if (total < SALARY_CAP) return 'under';
  if (total < LUXURY_TAX) return 'over';
  if (total < APRON) return 'tax';
  return 'apron';
}
