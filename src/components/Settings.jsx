import React, { useRef, useState } from 'react';
import { SAVE_VERSION, checkSave } from '../engine/save.js';
import { THEMES, DEFAULT_ACCENT } from '../theme.js';
import { useLivePrefs, setLivePrefs, LIVE_SPEEDS } from './livePrefs.js';
import { primeSound } from './liveSound.js';

const labelStyle = { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--text-base)', color: 'var(--text-secondary)', cursor: 'pointer' };

// A checkbox with a line of explanation under it.
function Toggle({ checked, onChange, label, hint }) {
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <label style={labelStyle}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="ui-section-subtitle" style={{ marginTop: 'var(--sp-1)', marginBottom: 0 }}>{hint}</p>}
    </div>
  );
}

export default function Settings({ league, commit, importLeague, onResetTutorial, theme, setTheme, accentColor, setAccentColor }) {
  const fileRef = useRef(null);
  const [importError, setImportError] = useState(null);
  const [tutorialReset, setTutorialReset] = useState(false);
  const live = useLivePrefs();

  const exportSave = () => {
    const blob = new Blob([JSON.stringify(league)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nba-gm-save-${league.season}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let check;
      try {
        check = checkSave(JSON.parse(reader.result));
      } catch {
        check = { error: 'This file is not valid JSON.' };
      }
      if (check.error) {
        setImportError(check.error);
        return;
      }
      if (!confirm('Load this save? Your current game will be replaced.')) return;
      setImportError(null);
      importLeague(check.league);
    };
    reader.readAsText(file);
  };

  return (
    <div className="ui-card" style={{ maxWidth: 560 }}>
      <div className="ui-section-header">
        <div className="ui-section-title">Save &amp; Export</div>
      </div>
      <p className="ui-section-subtitle" style={{ marginBottom: 'var(--sp-4)' }}>
        Your game saves automatically in this browser. Export a file to back it
        up or move it to another browser; importing replaces the current game.
        Save format v{SAVE_VERSION}.
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <button className="ui-btn ui-btn--primary ui-btn--md" onClick={exportSave}>Export Save</button>
        <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => fileRef.current?.click()}>Import Save…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
      </div>
      {importError && <p style={{ color: 'var(--color-danger)', marginTop: 'var(--sp-3)' }}>⚠️ {importError}</p>}

      <div className="ui-divider ui-divider--lg" />

      <div className="ui-section-header">
        <div className="ui-section-title">Appearance</div>
      </div>
      <p className="ui-section-subtitle" style={{ marginBottom: 'var(--sp-4)' }}>
        Choose a dark theme palette and an optional custom accent color.
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
          Theme:
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            {Object.entries(THEMES).map(([key, t]) => (
              <option key={key} value={key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
          Accent color:
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            style={{ verticalAlign: 'middle' }}
          />
        </label>
        {accentColor.toLowerCase() !== DEFAULT_ACCENT && (
          <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setAccentColor(DEFAULT_ACCENT)}>Reset Accent</button>
        )}
      </div>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <Toggle
          checked={live.reduceMotion}
          onChange={(v) => setLivePrefs({ reduceMotion: v })}
          label="Reduce motion"
          hint="Animations become instant changes across the app — in a live game, players cut between spots instead of running and the ball appears where it lands. Always on when your device's own reduce-motion setting is."
        />
      </div>

      <div className="ui-divider ui-divider--lg" />

      <div className="ui-section-header">
        <div className="ui-section-title">Gameplay</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--text-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!league.settings?.suppressInjuryAlerts}
          onChange={(e) => {
            if (!league.settings) league.settings = {};
            league.settings.suppressInjuryAlerts = e.target.checked;
            commit?.();
          }}
        />
        Suppress injury alerts during simulation
      </label>
      <p className="ui-section-subtitle" style={{ marginTop: 'var(--sp-1)', marginBottom: 0 }}>
        Injuries still happen — you just won't be interrupted mid-sim. Check your roster after simming to see who went down.
      </p>

      <div className="ui-divider ui-divider--lg" />

      <div className="ui-section-header">
        <div className="ui-section-title">Live Games</div>
      </div>
      <p className="ui-section-subtitle" style={{ marginBottom: 'var(--sp-4)' }}>
        How games play when you watch them. Saved in this browser, for every save.
      </p>
      <label style={{ ...labelStyle, marginBottom: 'var(--sp-3)', cursor: 'default' }}>
        Starting speed:
        <select value={live.speed} onChange={(e) => setLivePrefs({ speed: Number(e.target.value) })}>
          {LIVE_SPEEDS.map((sp) => <option key={sp} value={sp}>{sp}x</option>)}
        </select>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>(about {Math.round(8 / live.speed)} min a game; the speed you last picked)</span>
      </label>
      <Toggle
        checked={live.autoWatch}
        onChange={(v) => setLivePrefs({ autoWatch: v })}
        label="Auto-watch your games"
        hint="A sim never runs past one of your games: it stops there and plays the game in the viewer."
      />
      <Toggle
        checked={live.condensed}
        onChange={(v) => setLivePrefs({ condensed: v })}
        label="Condensed games"
        hint="Only baskets and highlights are played out; everything between lands at once. Also a switch in the viewer."
      />
      <Toggle
        checked={live.pauseAtBreaks}
        onChange={(v) => setLivePrefs({ pauseAtBreaks: v })}
        label="Pause at the end of each quarter"
        hint="Break cards wait for Continue instead of moving on after a few seconds."
      />
      <Toggle
        checked={live.sound}
        onChange={(v) => { if (v) primeSound(); setLivePrefs({ sound: v }); }}
        label="Sound"
        hint="The swish, the rim, the buzzer and the crowd, made in your browser — no audio files. Also M in the viewer."
      />

      <div className="ui-divider ui-divider--lg" />

      <div className="ui-section-header">
        <div className="ui-section-title">Tutorial</div>
      </div>
      <p className="ui-section-subtitle" style={{ marginBottom: 'var(--sp-4)' }}>
        Replay the first-session walkthrough and every first-encounter tooltip.
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        <button
          className="ui-btn ui-btn--secondary ui-btn--md"
          onClick={() => { onResetTutorial?.(); setTutorialReset(true); }}
        >
          Reset Tutorial
        </button>
      </div>
      {tutorialReset && <p style={{ color: 'var(--color-success)', marginTop: 'var(--sp-3)' }}>Tutorial reset — the walkthrough will start now, and tooltips will reappear as you encounter them.</p>}
    </div>
  );
}
