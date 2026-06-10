import React from 'react';
import { overall } from '../engine/players.js';

export function Ovr({ p }) {
  const o = overall(p);
  const cls = o >= 85 ? 'elite' : o >= 75 ? 'great' : o >= 65 ? 'good' : o >= 55 ? 'ok' : 'bad';
  return <span className={`ovr ${cls}`}>{o}</span>;
}

export function money(n) {
  return `$${(n / 1e6).toFixed(1)}M`;
}

export function perGame(stats, key) {
  if (!stats.gp) return '–';
  return (stats[key] / stats.gp).toFixed(1);
}

export function fgPct(stats) {
  if (!stats.fga) return '–';
  return ((stats.fgm / stats.fga) * 100).toFixed(1);
}
