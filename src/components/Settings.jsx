import React, { useRef, useState } from 'react';
import { SAVE_VERSION, checkSave } from '../engine/save.js';

export default function Settings({ league, importLeague, onResetTutorial }) {
  const fileRef = useRef(null);
  const [importError, setImportError] = useState(null);
  const [tutorialReset, setTutorialReset] = useState(false);

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
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>Settings</h2>
      <p style={{ color: 'var(--muted)', marginTop: 8 }}>
        Your game saves automatically in this browser. Export a file to back it
        up or move it to another browser; importing replaces the current game.
        Save format v{SAVE_VERSION}.
      </p>
      <div className="controls" style={{ marginTop: 12 }}>
        <button className="btn" onClick={exportSave}>Export Save</button>
        <button className="btn secondary" onClick={() => fileRef.current?.click()}>Import Save…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
      </div>
      {importError && <p style={{ color: 'var(--red)', marginTop: 12 }}>⚠️ {importError}</p>}

      <h2 style={{ marginTop: 24 }}>Tutorial</h2>
      <p style={{ color: 'var(--muted)', marginTop: 8 }}>
        Replay the first-session walkthrough and every first-encounter tooltip.
      </p>
      <div className="controls" style={{ marginTop: 12 }}>
        <button
          className="btn secondary"
          onClick={() => { onResetTutorial?.(); setTutorialReset(true); }}
        >
          Reset Tutorial
        </button>
      </div>
      {tutorialReset && <p style={{ color: 'var(--green)', marginTop: 12 }}>Tutorial reset — the walkthrough will start now, and tooltips will reappear as you encounter them.</p>}
    </div>
  );
}
