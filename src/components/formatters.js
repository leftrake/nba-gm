export function money(n) {
  return `$${(n / 1e6).toFixed(1)}M`;
}

// Display-formatted per-game stat (returns a string like "25.3" or "–" for
// missing data). Distinct from stats.js's perGame(), which returns a number.
export function fmtPerGame(stats, key) {
  if (!stats.gp) return '–';
  return (stats[key] / stats.gp).toFixed(1);
}

// Display-formatted FG% (returns "45.2" or "–"). Distinct from stats.js's
// fgPct(), which returns a decimal like 0.452.
export function fmtFgPct(stats) {
  if (!stats.fga) return '–';
  return ((stats.fgm / stats.fga) * 100).toFixed(1);
}

export function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function condColor(c) {
  return c >= 85 ? 'var(--color-success)' : c >= 70 ? 'var(--color-warning)' : c >= 50 ? 'var(--color-primary)' : 'var(--color-danger)';
}

export function condLabel(c) {
  return c >= 85 ? 'Fresh' : c >= 70 ? 'Good' : c >= 50 ? 'Tired' : 'Exhausted';
}

export function moraleColor(m) {
  return m >= 70 ? 'var(--color-success)' : m >= 50 ? 'var(--color-primary)' : m >= 30 ? 'var(--color-warning)' : 'var(--color-danger)';
}

export function turmoilLabel(t) {
  return t >= 1.5 ? 'Volatile' : t >= 0.5 ? 'Tense' : 'Stable';
}

export function turmoilColor(t) {
  return t >= 1.5 ? 'var(--color-danger)' : t >= 0.5 ? 'var(--color-warning)' : 'var(--color-success)';
}

export function approvalColor(a) {
  return a >= 60 ? 'var(--color-success)' : a >= 40 ? 'var(--color-primary)' : a >= 25 ? 'var(--color-warning)' : 'var(--color-danger)';
}
