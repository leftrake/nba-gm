// How you like to watch: speed, condensed games, pausing at breaks, sound,
// watching your own games automatically, and reduced motion.
//
// Saved in this browser under its own key, like the theme (theme.js), not in
// the league: they're about the person watching, so they carry across every
// save and slot, and a phone can keep different ones from a laptop. Storage
// can be unavailable (private windows, a full quota) — then the defaults
// apply and nothing is saved.

import { useSyncExternalStore } from 'react';

export const LIVE_PREFS_KEY = 'nba-gm-live';
export const LIVE_SPEEDS = [1, 2, 4];

const DEFAULTS = {
  speed: 1,            // the speed a game starts at; the last one you picked
  condensed: false,    // only scoring plays and highlights, the rest skipped
  pauseAtBreaks: false, // wait at each break card for Continue
  sound: false,        // generated in the browser, never on until asked for
  autoWatch: false,    // sim a game of yours and the viewer opens on it
  reduceMotion: false, // on top of the system setting, never instead of it
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIVE_PREFS_KEY) || '{}');
    const prefs = { ...DEFAULTS, ...saved };
    if (!LIVE_SPEEDS.includes(prefs.speed)) prefs.speed = DEFAULTS.speed;
    return prefs;
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set();

export const getLivePrefs = () => current;

export function setLivePrefs(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(LIVE_PREFS_KEY, JSON.stringify(current)); } catch { /* defaults will do */ }
  for (const fn of listeners) fn();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLivePrefs() {
  return useSyncExternalStore(subscribe, getLivePrefs, getLivePrefs);
}

// Reduced motion: the system setting, or this app's own switch on top of it.
// Checked at the moment of moving, so turning either on takes effect on the
// very next play.
export function motionReduced() {
  if (current.reduceMotion) return true;
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
}
