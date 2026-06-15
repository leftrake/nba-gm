import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TEAMS } from './data/teams.js';
import { createLeague, getTeam, simPlayoffGame, simPlayoffRound, advanceOffseason, simFreeAgencyDay, backfillPlayers } from './engine/league.js';
import { onTheClock, simDraftPick, simDraftRound, simDraftToUser, finishDraft } from './engine/draft.js';
import { onFantasyClock, simFantasyPick, simFantasyRound, simFantasyToUser, autoFantasyPick, finishFantasyDraft } from './engine/fantasyDraft.js';
import Dashboard from './components/Dashboard.jsx';
import News from './components/News.jsx';
import Roster from './components/Roster.jsx';
import FuturePayroll from './components/FuturePayroll.jsx';
import Standings from './components/Standings.jsx';
import Leaders from './components/Leaders.jsx';
import Stats from './components/Stats.jsx';
import Schedule from './components/Schedule.jsx';
import AllStarScreen from './components/AllStarScreen.jsx';
import TradeMachine from './components/TradeMachine.jsx';
import FreeAgency from './components/FreeAgency.jsx';
import Draft from './components/Draft.jsx';
import Scouting from './components/Scouting.jsx';
import FantasyDraft from './components/FantasyDraft.jsx';
import Legacy from './components/Legacy.jsx';
import Playoffs from './components/Playoffs.jsx';
import PlayoffPostGame from './components/PlayoffPostGame.jsx';
import DevelopmentReport from './components/DevelopmentReport.jsx';
import PlayerCard from './components/PlayerCard.jsx';
import Settings from './components/Settings.jsx';
import GameModal from './components/BoxScore.jsx';
import Walkthrough from './components/Walkthrough.jsx';
import { isWalkthroughDone, markWalkthroughDone, resetTutorial } from './components/shared.jsx';
import { checkSave } from './engine/save.js';
import { readCrossSaveLegacy } from './engine/legacy.js';

const SAVE_KEY = 'nba-gm-save';

// Returns { league, warning }. An unreadable or incompatible save loads as
// null with a warning, and stays in localStorage untouched until the user
// starts a new game over it.
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { league: null, warning: null };
    const check = checkSave(JSON.parse(raw));
    if (check.error) return { league: null, warning: check.error };
    backfillPlayers(check.league); // saves predating newer fields
    return { league: check.league, warning: null };
  } catch {
    return { league: null, warning: 'Your saved game could not be read.' };
  }
}

const initialSave = loadSave();

// An existing save predates the walkthrough feature (or was loaded before
// the user ever saw it) — don't surface the first-session tour mid-game.
if (initialSave.league && !isWalkthroughDone()) markWalkthroughDone();

export default function App() {
  const [league, setLeagueState] = useState(initialSave.league);
  const [screen, setScreen] = useState('dashboard');
  const [lastResults, setLastResults] = useState([]);
  const [featuredGame, setFeaturedGame] = useState(null);
  const [playoffDay, setPlayoffDay] = useState(null); // games from the last playoff sim
  const [rosterTeamId, setRosterTeamId] = useState(null);
  const [viewPlayer, setViewPlayer] = useState(null);
  const [viewGame, setViewGame] = useState(null); // { game, title }
  const [tradePrefill, setTradePrefill] = useState(null); // { otherId, give, get, key }
  const [pendingTeamId, setPendingTeamId] = useState(null); // new-game team selection, pending mode choice
  const [fantasyMode, setFantasyMode] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  const openTeam = useCallback((teamId) => {
    setViewPlayer(null);
    setViewGame(null); // a team link inside the game modal navigates away
    setRosterTeamId(teamId);
    setScreen('roster');
  }, []);

  const openPlayer = useCallback((p) => setViewPlayer(p), []);
  const closePlayer = useCallback(() => setViewPlayer(null), []);
  const openGame = useCallback((game, title) => setViewGame({ game, title }), []);

  // Hand an incoming trade offer to the Trade Machine, pre-filled so the
  // user can tweak it into a counter-offer.
  const openTradeOffer = useCallback((offer) => {
    setTradePrefill({ otherId: offer.fromTeamId, give: offer.give, get: offer.get, givePicks: offer.givePicks ?? [], getPicks: offer.getPicks ?? [], key: offer.id });
    setScreen('trade');
  }, []);

  // "Trade" button from a player row/profile: opens a 2-team trade with the
  // user's team and the player's team, with the player pre-loaded on the
  // appropriate side (give for the user's own players, receive otherwise).
  const proposeTradeFor = useCallback((p) => {
    const userId = league.userTeamId;
    const owner = league.teams.find((t) => t.roster.some((x) => x.id === p.id));
    if (!owner || owner.id === userId) {
      const otherId = league.teams.find((t) => t.id !== userId)?.id;
      setTradePrefill({ otherId, give: [p.id], get: [], givePicks: [], getPicks: [], key: `give-${p.id}-${Date.now()}` });
    } else {
      setTradePrefill({ otherId: owner.id, give: [], get: [p.id], givePicks: [], getPicks: [], key: `get-${p.id}-${Date.now()}` });
    }
    setViewPlayer(null);
    setScreen('trade');
  }, [league]);

  // leagueRef always points at the same object the engine is currently
  // mutating, so multiple commits in a row (e.g. an animated multi-day sim
  // loop) each snapshot the latest mutations rather than a stale render's
  // copy. Kept in sync with `league` state for the no-arg single-commit
  // case used throughout the app.
  const leagueRef = useRef(league);
  useEffect(() => { leagueRef.current = league; }, [league]);

  // The engine mutates the league object; this forces a re-render + saves.
  const commit = useCallback(() => {
    setLeagueState(() => {
      const next = { ...leagueRef.current };
      leagueRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (league) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(league)); } catch {}
    }
  }, [league]);

  const newGame = (teamId, fantasyDraft) => {
    setLeagueState(createLeague(teamId, Date.now(), { fantasyDraft }));
    setScreen(fantasyDraft ? 'fantasydraft' : 'dashboard');
    if (!isWalkthroughDone()) setShowWalkthrough(true);
  };

  const handleResetTutorial = () => {
    resetTutorial();
    setShowWalkthrough(true);
  };

  // Replace the running game with an imported save (already validated by Settings)
  const importLeague = (imported) => {
    backfillPlayers(imported);
    setLeagueState(imported);
    setLastResults([]);
    setFeaturedGame(null);
    setPlayoffDay(null);
    setRosterTeamId(null);
    setViewPlayer(null);
    setViewGame(null);
    setScreen('dashboard');
  };

  const resetGame = () => {
    if (confirm('Start over? Your current save will be deleted.')) {
      localStorage.removeItem(SAVE_KEY);
      setLeagueState(null);
      setLastResults([]);
      setFeaturedGame(null);
      setPlayoffDay(null);
      setRosterTeamId(null);
      setViewPlayer(null);
      setViewGame(null);
      setPendingTeamId(null);
      setFantasyMode(false);
    }
  };

  if (!league) {
    const pastLegacies = readCrossSaveLegacy();
    return (
      <div className="app">
        <main>
          <div className="center">
            <h1 style={{ fontSize: 28 }}>🏀 NBA GM</h1>
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>
              Pick your franchise. Run the front office. Win a ring.
            </p>
            {initialSave.warning && (
              <p style={{ color: 'var(--red)', marginTop: 12, maxWidth: 560, marginInline: 'auto' }}>
                ⚠️ {initialSave.warning} Picking a team below starts a new game over
                it. If you have an exported backup, you can import it from Settings
                after starting a new game.
              </p>
            )}
          </div>
          {pastLegacies.length > 0 && (
            <div className="panel" style={{ maxWidth: 560, marginInline: 'auto', marginBottom: 16, textAlign: 'left' }}>
              <h2>Your Legacy So Far</h2>
              <p style={{ color: 'var(--muted)' }}>
                {pastLegacies.length} franchise{pastLegacies.length === 1 ? '' : 's'} managed ·{' '}
                {pastLegacies.reduce((s, l) => s + l.championships, 0)} championship{pastLegacies.reduce((s, l) => s + l.championships, 0) === 1 ? '' : 's'} ·{' '}
                {pastLegacies.reduce((s, l) => s + l.hallOfFamers.length, 0)} Hall of Famer{pastLegacies.reduce((s, l) => s + l.hallOfFamers.length, 0) === 1 ? '' : 's'} drafted
              </p>
              <table>
                <thead><tr><th>Team</th><th className="num">Seasons</th><th className="num">Titles</th><th>Best Season</th></tr></thead>
                <tbody>
                  {pastLegacies.map((l) => (
                    <tr key={l.saveId}>
                      <td>{l.teamName}</td>
                      <td className="num">{l.seasons}</td>
                      <td className="num">{l.championships}</td>
                      <td>{l.bestSeasonRecord ? `${l.bestSeasonRecord.wins}-${l.bestSeasonRecord.losses} (${l.bestSeasonRecord.season})` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!pendingTeamId ? (
            <div className="team-picker">
              {TEAMS.map((t) => (
                <button key={t.id} className="team-card" style={{ '--tc': t.color }} onClick={() => setPendingTeamId(t.id)}>
                  <div className="city">{t.city}</div>
                  <div className="name">{t.name}</div>
                  <div className="city">{t.conf} · {t.div}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel" style={{ maxWidth: 480, marginInline: 'auto' }}>
              {(() => {
                const t = TEAMS.find((x) => x.id === pendingTeamId);
                return <h2 style={{ marginTop: 0 }}>{t.city} {t.name}</h2>;
              })()}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={fantasyMode} onChange={(e) => setFantasyMode(e.target.checked)} />
                <span>
                  Fantasy Draft — pool every player from all 30 teams plus free agents,
                  then draft your roster from scratch in a 15-round snake draft.
                </span>
              </label>
              <div className="controls" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => newGame(pendingTeamId, fantasyMode)}>Start</button>
                <button className="btn secondary" onClick={() => setPendingTeamId(null)}>Back</button>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  const userTeam = getTeam(league, league.userTeamId);

  // Remember the user team's most recent game (with box scores) for the dashboard
  const trackFeatured = (results) => {
    const mine = results.find((r) => r.home === league.userTeamId || r.away === league.userTeamId);
    if (mine) setFeaturedGame({ ...mine, day: leagueRef.current.dayIndex - 1 });
    return mine;
  };

  // Same idea for the playoffs: `played` entries are { series, game, round }
  // rather than flat results, and games have no schedule day.
  const trackFeaturedPlayoff = (played) => {
    const mine = [...played].reverse().find((e) => e.game.home === league.userTeamId || e.game.away === league.userTeamId);
    if (mine) setFeaturedGame({ ...mine.game, round: mine.round, gameNo: mine.series.games.indexOf(mine.game) + 1, isPlayoff: true });
    return mine;
  };


  // One playoff sim step lands on the post-game screen (the user's result in
  // full, or the day's scoreboard); a round fast-forward goes to the bracket.
  const handleSimPlayoffGame = () => {
    const played = simPlayoffGame(league);
    trackFeaturedPlayoff(played);
    commit();
    if (played.length > 0) {
      setPlayoffDay(played);
      setScreen('postgame');
    } else {
      setScreen('playoffs');
    }
  };
  const handleSimPlayoffRound = () => {
    const played = simPlayoffRound(league);
    trackFeaturedPlayoff(played);
    setPlayoffDay(null);
    commit();
    setScreen('playoffs');
  };

  // The Dev Report tab only shows while this offseason's report is fresh
  // (between development and the next season tipping off)
  const hasDevReport = !!league.devReport?.entries?.length
    && (league.phase === 'draft' || league.phase === 'freeagency');

  const NAV = [
    ['dashboard', 'Dashboard'],
    ['news', 'News'],
    ['roster', 'Roster'],
    ['futurecap', 'Cap Projection'],
    ['standings', 'Standings'],
    ['leaders', 'Leaders'],
    ['stats', 'Stats'],
    ['schedule', 'Schedule'],
    ['trade', 'Trade'],
    ...(league.phase === 'offseason' ? [['scouting', 'Scouting']] : []),
    ['draft', 'Draft'],
    ...(league.phase === 'fantasydraft' ? [['fantasydraft', 'Fantasy Draft']] : []),
    ['freeagency', 'Free Agency'],
    ['playoffs', 'Playoffs'],
    ['legacy', 'Legacy'],
    ...(hasDevReport ? [['devreport', 'Dev Report']] : []),
    ['settings', 'Settings'],
  ];

  return (
    <div className="app" style={{ '--team-color': userTeam.color }}>
      <div className="topbar">
        <h1>🏀 {userTeam.city} {userTeam.name}</h1>
        <span className="meta">
          {league.season} · {userTeam.wins}-{userTeam.losses} ·{' '}
          {league.phase === 'regular' ? `Day ${league.dayIndex + 1}/${league.schedule.length}`
            : league.phase === 'playoffs' ? 'Playoffs'
            : league.phase === 'draft' ? (onTheClock(league) ? `Draft (Pick ${league.draft.pickIndex + 1}/${league.draft.order.length})` : 'Draft complete')
            : league.phase === 'fantasydraft' ? (onFantasyClock(league) ? `Fantasy Draft (Pick ${league.fantasyDraft.pickIndex + 1}/${league.fantasyDraft.order.length})` : 'Fantasy Draft complete')
            : league.phase === 'freeagency' ? `Free Agency (${league.faDaysLeft} rounds left)`
            : 'Offseason'}
        </span>
        <nav>
          {NAV.map(([key, label]) => (
            <button
              key={key}
              className={screen === key ? 'active' : ''}
              data-tour={key === 'roster' ? 'roster-tab' : key === 'scouting' ? 'scouting-tab' : undefined}
              onClick={() => {
                // The Roster tab always opens on the user's team; only
                // explicit team links (openTeam) show another roster.
                if (key === 'roster') setRosterTeamId(null);
                setScreen(key);
              }}
            >
              {label}
            </button>
          ))}
          <button onClick={resetGame} style={{ color: 'var(--red)' }}>New Game</button>
        </nav>
      </div>
      <main>
        {league.phase === 'playoffs' && (
          <div className="controls">
            <button className="btn" onClick={handleSimPlayoffGame}>Sim Next Playoff Game</button>
            <button className="btn secondary" onClick={handleSimPlayoffRound}>Sim Playoff Round</button>
          </div>
        )}
        {league.phase === 'offseason' && (
          <div className="controls">
            <button className="btn" onClick={() => { advanceOffseason(league); commit(); setScreen(league.devReport?.entries?.length ? 'devreport' : 'draft'); }}>
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
        {league.phase === 'fantasydraft' && (
          <div className="controls">
            {!onFantasyClock(league) ? (
              <button className="btn" onClick={() => { finishFantasyDraft(league); commit(); setScreen('dashboard'); }}>
                Finish Draft & Start Season
              </button>
            ) : onFantasyClock(league) === league.userTeamId ? (
              <>
                <button className="btn" onClick={() => setScreen('fantasydraft')}>
                  You're on the clock — make your pick
                </button>
                <button className="btn secondary" onClick={() => { autoFantasyPick(league); commit(); setScreen('fantasydraft'); }}>
                  Auto-Pick for Me
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => { simFantasyToUser(league); commit(); setScreen('fantasydraft'); }}>
                  Sim to My Pick
                </button>
                <button className="btn secondary" onClick={() => { simFantasyPick(league); commit(); setScreen('fantasydraft'); }}>
                  Next Pick
                </button>
                <button className="btn secondary" onClick={() => { simFantasyRound(league); commit(); setScreen('fantasydraft'); }}>
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

        <div className="page-fade" key={screen}>
        {screen === 'dashboard' && (
          <Dashboard
            league={league}
            leagueRef={leagueRef}
            commit={commit}
            lastResults={lastResults}
            featuredGame={featuredGame}
            openTeam={openTeam}
            openPlayer={openPlayer}
            openGame={openGame}
            openNews={() => setScreen('news')}
            onCounterTradeOffer={openTradeOffer}
            setScreen={setScreen}
            trackFeatured={trackFeatured}
            setLastResults={setLastResults}
          />
        )}
        {screen === 'news' && <News league={league} openTeam={openTeam} />}
        {screen === 'roster' && <Roster league={league} commit={commit} teamId={rosterTeamId ?? league.userTeamId} openTeam={openTeam} openPlayer={openPlayer} onTradeFor={proposeTradeFor} />}
        {screen === 'futurecap' && <FuturePayroll league={league} openPlayer={openPlayer} onTradeFor={proposeTradeFor} setScreen={setScreen} />}
        {screen === 'standings' && <Standings league={league} openTeam={openTeam} />}
        {screen === 'leaders' && <Leaders league={league} openPlayer={openPlayer} openTeam={openTeam} />}
        {screen === 'stats' && <Stats league={league} openPlayer={openPlayer} openTeam={openTeam} />}
        {screen === 'schedule' && <Schedule league={league} openTeam={openTeam} openGame={openGame} />}
        {screen === 'allstar' && (
          <AllStarScreen
            league={league}
            openPlayer={openPlayer}
            openTeam={openTeam}
            onContinue={() => { league.allStar.shown = true; commit(); setScreen('dashboard'); }}
          />
        )}
        {screen === 'trade' && <TradeMachine league={league} commit={commit} openPlayer={openPlayer} prefill={tradePrefill} />}
        {screen === 'scouting' && <Scouting league={league} commit={commit} openPlayer={openPlayer} />}
        {screen === 'draft' && <Draft league={league} commit={commit} openPlayer={openPlayer} openTeam={openTeam} />}
        {screen === 'fantasydraft' && <FantasyDraft league={league} commit={commit} openPlayer={openPlayer} openTeam={openTeam} />}
        {screen === 'freeagency' && <FreeAgency league={league} commit={commit} openPlayer={openPlayer} />}
        {screen === 'playoffs' && <Playoffs league={league} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} />}
        {screen === 'postgame' && (playoffDay?.length
          ? <PlayoffPostGame league={league} played={playoffDay} onBack={() => setScreen('playoffs')} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} />
          : <Playoffs league={league} openTeam={openTeam} openPlayer={openPlayer} openGame={openGame} />)}
        {screen === 'legacy' && <Legacy league={league} openPlayer={openPlayer} openTeam={openTeam} />}
        {screen === 'devreport' && <DevelopmentReport league={league} openPlayer={openPlayer} onContinue={() => setScreen(league.phase === 'freeagency' ? 'freeagency' : 'draft')} />}
        {screen === 'settings' && <Settings league={league} importLeague={importLeague} onResetTutorial={handleResetTutorial} />}
        </div>
        {viewGame && <GameModal league={league} game={viewGame.game} title={viewGame.title} onClose={() => setViewGame(null)} openTeam={openTeam} openPlayer={openPlayer} />}
        {viewPlayer && <PlayerCard league={league} player={viewPlayer} onClose={closePlayer} openTeam={openTeam} openPlayer={openPlayer} onTradeFor={proposeTradeFor} />}
      </main>
      {showWalkthrough && <Walkthrough onDone={() => setShowWalkthrough(false)} />}
    </div>
  );
}
