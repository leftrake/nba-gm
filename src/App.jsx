import React, { useState, useCallback, useEffect } from 'react';
import { TEAMS } from './data/teams.js';
import { createLeague, getTeam, simDay, simPlayoffRound, advanceOffseason, simFreeAgencyDay } from './engine/league.js';
import Dashboard from './components/Dashboard.jsx';
import Roster from './components/Roster.jsx';
import Standings from './components/Standings.jsx';
import Schedule from './components/Schedule.jsx';
import TradeMachine from './components/TradeMachine.jsx';
import FreeAgency from './components/FreeAgency.jsx';
import Playoffs from './components/Playoffs.jsx';
import PlayerCard from './components/PlayerCard.jsx';

const SAVE_KEY = 'nba-gm-save';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [league, setLeagueState] = useState(loadSave);
  const [screen, setScreen] = useState('dashboard');
  const [lastResults, setLastResults] = useState([]);
  const [rosterTeamId, setRosterTeamId] = useState(null);
  const [viewPlayer, setViewPlayer] = useState(null);

  const openTeam = useCallback((teamId) => {
    setViewPlayer(null);
    setRosterTeamId(teamId);
    setScreen('roster');
  }, []);

  const openPlayer = useCallback((p) => setViewPlayer(p), []);
  const closePlayer = useCallback(() => setViewPlayer(null), []);

  // The engine mutates the league object; this forces a re-render + saves.
  const commit = useCallback(() => {
    setLeagueState((l) => {
      const next = { ...l };
      return next;
    });
  }, []);

  useEffect(() => {
    if (league) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(league)); } catch {}
    }
  }, [league]);

  const newGame = (teamId) => {
    setLeagueState(createLeague(teamId));
    setScreen('dashboard');
  };

  const resetGame = () => {
    if (confirm('Start over? Your current save will be deleted.')) {
      localStorage.removeItem(SAVE_KEY);
      setLeagueState(null);
      setLastResults([]);
      setRosterTeamId(null);
      setViewPlayer(null);
    }
  };

  if (!league) {
    return (
      <div className="app">
        <main>
          <div className="center">
            <h1 style={{ fontSize: 28 }}>🏀 NBA GM</h1>
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>
              Pick your franchise. Run the front office. Win a ring.
            </p>
          </div>
          <div className="team-picker">
            {TEAMS.map((t) => (
              <button key={t.id} className="team-card" style={{ '--tc': t.color }} onClick={() => newGame(t.id)}>
                <div className="city">{t.city}</div>
                <div className="name">{t.name}</div>
                <div className="city">{t.conf} · {t.div}</div>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const userTeam = getTeam(league, league.userTeamId);

  const handleSimDay = () => {
    const results = simDay(league);
    setLastResults(results);
    commit();
  };
  const handleSimWeek = () => {
    let results = [];
    for (let i = 0; i < 4 && league.phase === 'regular'; i++) results = simDay(league);
    setLastResults(results);
    commit();
  };
  const handleSimToEnd = () => {
    while (league.phase === 'regular') simDay(league);
    setLastResults([]);
    commit();
  };

  const NAV = [
    ['dashboard', 'Dashboard'],
    ['roster', 'Roster'],
    ['standings', 'Standings'],
    ['schedule', 'Schedule'],
    ['trade', 'Trade'],
    ['freeagency', 'Free Agency'],
    ['playoffs', 'Playoffs'],
  ];

  return (
    <div className="app">
      <div className="topbar">
        <h1>🏀 {userTeam.city} {userTeam.name}</h1>
        <span className="meta">
          {league.season} · {userTeam.wins}-{userTeam.losses} ·{' '}
          {league.phase === 'regular' ? `Day ${league.dayIndex + 1}/${league.schedule.length}`
            : league.phase === 'playoffs' ? 'Playoffs'
            : league.phase === 'freeagency' ? `Free Agency (${league.faDaysLeft} rounds left)`
            : 'Offseason'}
        </span>
        <nav>
          {NAV.map(([key, label]) => (
            <button key={key} className={screen === key ? 'active' : ''} onClick={() => setScreen(key)}>
              {label}
            </button>
          ))}
          <button onClick={resetGame} style={{ color: 'var(--red)' }}>New Game</button>
        </nav>
      </div>
      <main>
        {league.phase === 'regular' && (
          <div className="controls">
            <button className="btn" onClick={handleSimDay}>Sim Day</button>
            <button className="btn secondary" onClick={handleSimWeek}>Sim Week</button>
            <button className="btn secondary" onClick={handleSimToEnd}>Sim to Playoffs</button>
          </div>
        )}
        {league.phase === 'playoffs' && (
          <div className="controls">
            <button className="btn" onClick={() => { simPlayoffRound(league); commit(); }}>Sim Playoff Round</button>
          </div>
        )}
        {league.phase === 'offseason' && (
          <div className="controls">
            <button className="btn" onClick={() => { advanceOffseason(league); commit(); setScreen('freeagency'); }}>
              Advance to Offseason (player development + free agency)
            </button>
          </div>
        )}
        {league.phase === 'freeagency' && (
          <div className="controls">
            <button className="btn" onClick={() => { simFreeAgencyDay(league); commit(); }}>
              {league.faDaysLeft > 1 ? `Next FA Round (${league.faDaysLeft} left)` : 'Finish FA & Start Season'}
            </button>
          </div>
        )}

        {screen === 'dashboard' && <Dashboard league={league} lastResults={lastResults} openTeam={openTeam} openPlayer={openPlayer} />}
        {screen === 'roster' && <Roster league={league} commit={commit} teamId={rosterTeamId ?? league.userTeamId} openTeam={openTeam} openPlayer={openPlayer} />}
        {screen === 'standings' && <Standings league={league} openTeam={openTeam} />}
        {screen === 'schedule' && <Schedule league={league} openTeam={openTeam} />}
        {screen === 'trade' && <TradeMachine league={league} commit={commit} openPlayer={openPlayer} />}
        {screen === 'freeagency' && <FreeAgency league={league} commit={commit} openPlayer={openPlayer} />}
        {screen === 'playoffs' && <Playoffs league={league} openTeam={openTeam} />}
        {viewPlayer && <PlayerCard league={league} player={viewPlayer} onClose={closePlayer} openTeam={openTeam} />}
      </main>
    </div>
  );
}
