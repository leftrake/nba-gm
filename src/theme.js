// Appearance preferences (dark theme palette + optional custom accent
// color). These are a browser preference, not part of the league save, so
// they live in their own localStorage keys and are applied as CSS variables
// on the document root.

export const THEME_KEY = 'nba-gm-theme';
export const ACCENT_KEY = 'nba-gm-accent';

export const THEMES = {
  default: { label: 'Default', bg: '#0d1117', panel: '#161b22', panel2: '#1f2630', border: '#2d333b' },
  midnight: { label: 'Midnight Blue', bg: '#0a0e1a', panel: '#121a2e', panel2: '#1a2540', border: '#2a3654' },
  forest: { label: 'Forest Green', bg: '#0d1410', panel: '#16201a', panel2: '#1f2e24', border: '#2d3f33' },
  purple: { label: 'Deep Purple', bg: '#120d1a', panel: '#1c1426', panel2: '#281c38', border: '#3a2c4f' },
  charcoal: { label: 'Charcoal', bg: '#121212', panel: '#1c1c1c', panel2: '#2a2a2a', border: '#3a3a3a' },
};

export const DEFAULT_ACCENT = '#f0883e';

export function loadTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v && THEMES[v] ? v : 'default';
  } catch {
    return 'default';
  }
}

export function loadAccent() {
  try {
    return localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

// Applies the palette + accent as CSS variables on <html>, so they cascade
// to every component without per-component changes.
export function applyTheme(themeKey, accent) {
  const t = THEMES[themeKey] || THEMES.default;
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--panel', t.panel);
  root.setProperty('--panel2', t.panel2);
  root.setProperty('--border', t.border);
  root.setProperty('--accent', accent || DEFAULT_ACCENT);
}
