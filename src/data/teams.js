// All 30 NBA teams with conference, division, colors, and market size
// (small | medium | large — drives owner revenue/budget, see engine/owner.js)
export const TEAMS = [
  { id: 'ATL', city: 'Atlanta', name: 'Hawks', conf: 'East', div: 'Southeast', color: '#E03A3E', market: 'medium' },
  { id: 'BOS', city: 'Boston', name: 'Celtics', conf: 'East', div: 'Atlantic', color: '#007A33', market: 'large' },
  { id: 'BKN', city: 'Brooklyn', name: 'Nets', conf: 'East', div: 'Atlantic', color: '#444444', market: 'large' },
  { id: 'CHA', city: 'Charlotte', name: 'Hornets', conf: 'East', div: 'Southeast', color: '#1D1160', market: 'small' },
  { id: 'CHI', city: 'Chicago', name: 'Bulls', conf: 'East', div: 'Central', color: '#CE1141', market: 'large' },
  { id: 'CLE', city: 'Cleveland', name: 'Cavaliers', conf: 'East', div: 'Central', color: '#860038', market: 'medium' },
  { id: 'DAL', city: 'Dallas', name: 'Mavericks', conf: 'West', div: 'Southwest', color: '#00538C', market: 'large' },
  { id: 'DEN', city: 'Denver', name: 'Nuggets', conf: 'West', div: 'Northwest', color: '#0E2240', market: 'medium' },
  { id: 'DET', city: 'Detroit', name: 'Pistons', conf: 'East', div: 'Central', color: '#C8102E', market: 'medium' },
  { id: 'GSW', city: 'Golden State', name: 'Warriors', conf: 'West', div: 'Pacific', color: '#1D428A', market: 'large' },
  { id: 'HOU', city: 'Houston', name: 'Rockets', conf: 'West', div: 'Southwest', color: '#CE1141', market: 'large' },
  { id: 'IND', city: 'Indiana', name: 'Pacers', conf: 'East', div: 'Central', color: '#002D62', market: 'small' },
  { id: 'LAC', city: 'LA', name: 'Clippers', conf: 'West', div: 'Pacific', color: '#C8102E', market: 'large' },
  { id: 'LAL', city: 'Los Angeles', name: 'Lakers', conf: 'West', div: 'Pacific', color: '#552583', market: 'large' },
  { id: 'MEM', city: 'Memphis', name: 'Grizzlies', conf: 'West', div: 'Southwest', color: '#5D76A9', market: 'small' },
  { id: 'MIA', city: 'Miami', name: 'Heat', conf: 'East', div: 'Southeast', color: '#98002E', market: 'medium' },
  { id: 'MIL', city: 'Milwaukee', name: 'Bucks', conf: 'East', div: 'Central', color: '#00471B', market: 'small' },
  { id: 'MIN', city: 'Minnesota', name: 'Timberwolves', conf: 'West', div: 'Northwest', color: '#0C2340', market: 'medium' },
  { id: 'NOP', city: 'New Orleans', name: 'Pelicans', conf: 'West', div: 'Southwest', color: '#0C2340', market: 'small' },
  { id: 'NYK', city: 'New York', name: 'Knicks', conf: 'East', div: 'Atlantic', color: '#006BB6', market: 'large' },
  { id: 'OKC', city: 'Oklahoma City', name: 'Thunder', conf: 'West', div: 'Northwest', color: '#007AC1', market: 'small' },
  { id: 'ORL', city: 'Orlando', name: 'Magic', conf: 'East', div: 'Southeast', color: '#0077C0', market: 'small' },
  { id: 'PHI', city: 'Philadelphia', name: '76ers', conf: 'East', div: 'Atlantic', color: '#006BB6', market: 'large' },
  { id: 'PHX', city: 'Phoenix', name: 'Suns', conf: 'West', div: 'Pacific', color: '#E56020', market: 'medium' },
  { id: 'POR', city: 'Portland', name: 'Trail Blazers', conf: 'West', div: 'Northwest', color: '#E03A3E', market: 'medium' },
  { id: 'SAC', city: 'Sacramento', name: 'Kings', conf: 'West', div: 'Pacific', color: '#5A2D81', market: 'small' },
  { id: 'SAS', city: 'San Antonio', name: 'Spurs', conf: 'West', div: 'Southwest', color: '#444444', market: 'small' },
  { id: 'TOR', city: 'Toronto', name: 'Raptors', conf: 'East', div: 'Atlantic', color: '#CE1141', market: 'medium' },
  { id: 'UTA', city: 'Utah', name: 'Jazz', conf: 'West', div: 'Northwest', color: '#002B5C', market: 'small' },
  { id: 'WAS', city: 'Washington', name: 'Wizards', conf: 'East', div: 'Southeast', color: '#002B5C', market: 'medium' },
];

export const SALARY_CAP = 141_000_000;
export const LUXURY_TAX = 172_000_000;
// First apron: teams above can only use the taxpayer MLE (not the full MLE).
export const FIRST_APRON = LUXURY_TAX + 6_000_000;
// Second apron (hard cap): AI teams won't exceed this; used for cap-screen color-coding.
export const APRON = LUXURY_TAX + 20_000_000;
export const MIN_SALARY = 1_200_000;
export const MAX_SALARY = 49_000_000;
export const ROSTER_MIN = 13;
export const ROSTER_MAX = 15;
// Non-taxpayer MLE: available below the first apron.
export const MLE_AMOUNT = 12_000_000;
// Taxpayer MLE: available to teams between the luxury tax and the first apron.
export const TAXPAYER_MLE = 5_200_000;
// Two-way contracts: a development slot alongside the standard roster.
// Fixed low salary, doesn't count against the cap, and is only open to
// players early in their career (real-NBA two-way eligibility).
export const TWO_WAY_MAX = 2;
export const TWO_WAY_SALARY = 600_000;
export const TWO_WAY_MAX_EXP = 4;
