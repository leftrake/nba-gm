import React, { useState, useCallback, useEffect } from 'react';
import { TEAMS } from './data/teams.js';
import { createLeague, getTeam, simDay, simPlayoffGame, simPlayoffRound, advanceOffseason, simFreeAgencyDay, backfillPlayers } from './engine/league.js';
import { onTheClock, simDraftPick, simDraftRound, simDraftToUser, finishDraft } from './engine/draft.js';
import Dashboard from './components/Dashboard.jsx';
import Roster from './components/Roster.jsx';
import Standings from './components/Standings.jsx';
import Schedule from './components/Schedule.jsx';
import TradeMachine from './components/TradeMachine.jsx';
import FreeAgency from './components/FreeAgency.jsx';
import Draft from './components/Draft.jsx';
import Playoffs from './components/Playoffs.jsx';
import PlayerCard from './components/PlayerCard.jsx';

const SAVE_KEY = 'nba-gm-save';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const league = raw ? JSON.parse(raw) : null;
    if (league) backfillPlayers(league); // saves predating origins/experience
    return league;
  } catch {
    return null;
  }
}

export default function App() {
  const [league, setLeagueState] = useState(loadSave);
  const [screen, setScreen] = useState('dashboard');
  const [lastResults, setLastResults] = useState([]);
  const [featuredGame, setFeaturedGame] = useState(null);
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
      setFeaturedGame(null);
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

  // Remember the user team's most recent game (with box scores) for the dashboard
  const trackFeatured = (results) => {
    const mine = results.find((r) => r.home === league.userTeamId || r.away === league.userTeamId);
    if (mine) setFeaturedGame({ ...mine, day: league.dayIndex - 1 });
    return mine;
  };

  const handleSimDay = () => {
    const results = simDay(league);
    setLastResults(results);
    trackFeatured(results);
    commit();
  };
  const handleSimWeek = () => {
    let results = [];
    for (let i = 0; i < 4 && league.phase === 'regular'; i++) {
      results = simDay(league);
      trackFeatured(results);
    }
    setLastResults(results);
    commit();
  };
  const handleSimToNextGame = () => {
    let results = [];
    let mine = null;
    while (league.phase === 'regular' && !mine) {
      results = simDay(league);
      mine = trackFeatured(results);
    }
    setLastResults(results);
    setScreen('dashboard');
    commit();
  };
  const handleSimToEnd = () => {
    let results = [];
    while (league.phase === 'regular') {
      results = simDay(league);
      trackFeatured(results);
    }
    setLastResults(results);
    commit();
  };

  const NAV = [
    ['dashboard', 'Dashboard'],
    ['roster', 'Roster'],
    ['standings', 'Standings'],
    ['schedule', 'Schedule'],
    ['trade', 'Trade'],
    ['draft', 'Draft'],
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
            : league.phase === 'draft' ? (onTheClock(league) ? `Draft (Pick ${league.draft.pickIndex + 1}/${league.draft.order.length})` : 'Draft complete')
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
            <button className="btn" onClick={handleSimToNextGame}>Sim to Next Game</button>
            <button className="btn secondary" onClick={handleSimDay}>Sim Day</button>
            <button className="btn secondary" onClick={handleSimWeek}>Sim Week</button>
            <button className="btn secondary" onClick={handleSimToEnd}>Sim to Playoffs</button>
          </div>
        )}
        {league.phase === 'playoffs' && (
          <div className="controls">
            <button className="btn" onClick={() => { simPlayoffGame(league); commit(); setScreen('playoffs'); }}>Sim Next Playoff Game</button>
            <button className="btn secondary" onClick={() => { simPlayoffRound(league); commit(); setScreen('playoffs'); }}>Sim Playoff Round</button>
          </div>
        )}
        {league.phase === 'offseason' && (
          <div className="controls">
            <button className="btn" onClick={() => { advanceOffseason(league); commit(); setScreen('draft'); }}>
              Advance to Offseason (player development + draft)
            </button>
          </div>
        )}
        {league.phase === 'draft' && (
          <div className="controls">
            {!onTheClock(league) ? (
              <button className="btn" onClick={() => { finishDraft(league); commit(); setScreen('freeagency'); }}>
                Finish Draft & Open Free Agency
              </button>
            ) : onTheClock(league) === league.userTeamId ? (
              <button className="btn" onClick={() => setScreen('draft')}>
                You're on the clock — make your pick
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => { simDraftToUser(league); commit(); setScreen('draft'); }}>
                  Sim to My Pick
                </button>
                <button className="btn secondary" onClick={() => { simDraftPick(league); commit(); setScreen('draft'); }}>
                  Next Pick
                </button>
                <button className="btn secondary" onClick={() => { simDraftRound(league); commit(); setScreen('draft'); }}>
                  Sim Round
                </button>
              </>
            )}
          </div>
        )}
        {league.phase === 'freeagency' && (
          <div className="controls">
            <button className="btn" onClick={() => { simFreeAgencyDay(league); commit(); }}>
              {league.faDaysLeft > 1 ? `Next FA Round (${league.faDaysLeft} left)` : 'Finish FA & Start Season'}
            </button>
          </div>
        )}

        {screen === 'dashboard' && <Dashboard league={league} lastResults={lastResults} featuredGame={featuredGame} openTeam={openTeam} openPlayer={openPlayer} />}
        {screen === 'roster' && <Roster league={league} commit={commit} teamId={rosterTeamId ?? league.userTeamId} openTeam={openTeam} openPlayer={openPlayer} />}
        {screen === 'standings' && <Standings league={league} openTeam={openTeam} />}
        {screen === 'schedule' && <Schedule league={league} openTeam={openTeam} openPlayer={openPlayer} />}
        {screen === 'trade' && <TradeMachine league={league} commit={commit} openPlayer={openPlayer} />}
        {screen === 'draft' && <Draft league={league} commit={commit} openPlayer={openPlayer} openTeam={openTeam} />}
        {screen === 'freeagency' && <FreeAgency league={league} commit={commit} openPlayer={openPlayer} />}
        {screen === 'playoffs' && <Playoffs league={league} openTeam={openTeam} />}
        {viewPlayer && <PlayerCard league={league} player={viewPlayer} onClose={closePlayer} openTeam={openTeam} />}
      </main>
    </div>
  );
}
