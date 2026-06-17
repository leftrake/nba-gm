// WCAG contrast-safety helpers — pure color math, no React/game imports.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function linearize(c) {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function luminance(r, g, b) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const l1 = luminance(r1, g1, b1);
  const l2 = luminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return '#' + [h + 1 / 3, h, h - 1 / 3]
    .map(t => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, '0'))
    .join('');
}

// Dark app background used as the contrast reference.
const BG = '#0d1117';

// Returns the team color adjusted to meet minContrast against the dark BG.
// Hue is always preserved; only saturation (clamped) and lightness are changed.
export function safeAccent(hex, minContrast = 4.5) {
  if (!hex || !hex.startsWith('#')) return hex ?? '#f0883e';
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  if (s > 88) s = 88;
  while (contrastRatio(hslToHex(h, s, l), BG) < minContrast && l < 96) {
    l += 2;
  }
  return hslToHex(h, s, Math.min(l, 96));
}

// Returns '#ffffff' or '#000000' — whichever has better contrast on bgHex.
export function textOnColor(bgHex) {
  if (!bgHex || !bgHex.startsWith('#')) return '#ffffff';
  const lum = luminance(...hexToRgb(bgHex));
  const onWhite = (1.05) / (lum + 0.05);
  const onBlack = (lum + 0.05) / (0.05);
  return onWhite >= onBlack ? '#ffffff' : '#000000';
}
