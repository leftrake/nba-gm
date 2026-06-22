import React, { useEffect, useRef, useState } from 'react';
import {
  getTeam, dateForDay, dayIndexForDate, simDay, getLeagueEvents, weeklyRecapNews,
  CHRISTMAS_DAY, TRADE_DEADLINE_DAY, ALL_STAR_DAYS,
} from '../engine/league.js';
import { clamp } from '../engine/rng.js';
import { fmtDate, TeamLink, TeamBadge, NewsText, InjuryAlertModal } from './shared.jsx';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// At most one interactive prompt blocks the sim at a time — see
// coachTalk.js / milestoneAlerts.js / callUps.js for what queues each one.
const hasPendingEvent = (team) => !!(team.pendingCoachTalk || team.pendingMilestoneAlert || team.pendingCallUpPrompt);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PHASE_BLURB = {
  playoffs: 'The playoffs are underway — head to the Playoffs tab to continue.',
  offseason: 'Offseason: player development is underway. The Draft Lottery (mid-May) and Draft (late June) are next, with Free Agency opening July 1.',
  draft: 'The Draft is underway.',
  fantasydraft: 'The Fantasy Draft is underway.',
  freeagency: 'Free Agency is open — sign players to fill out your roster before the season tips off.',
};

export default function Calendar({ league, leagueRef, commit, openTeam, openGame, setScreen, trackFeatured, setLastResults }) {
  const me = league.userTeamId;
  const lastDi = league.schedule.length - 1;
  const firstDate = dateForDay(league, 0);
  const lastDate = dateForDay(league, lastDi);
  const todayDate = dateForDay(league, clamp(league.dayIndex, 0, lastDi));

  const [view, setView] = useState(() => ({ year: todayDate.getFullYear(), month: todayDate.getMonth() }));

  // Keep the visible month in sync with the in-game date as days are simmed,
  // so the user doesn't have to manually page the calendar forward.
  useEffect(() => {
    setView({ year: todayDate.getFullYear(), month: todayDate.getMonth() });
  }, [todayDate.getFullYear(), todayDate.getMonth()]);
  const [flashDay, setFlashDay] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [openEvent, setOpenEvent] = useState(null);
  const [confirmDay, setConfirmDay] = useState(null);
  const [injuryAlert, setInjuryAlert] = useState(null); // { injured: [...], returned: [...] }
  const skipRef = useRef(false);
  const stopRef = useRef(false);
  const animatingRef = useRef(false);

  const events = getLeagueEvents();
  const resultFor = (di, g) => (league.resultsByDay?.[di] || []).find((r) => r.home === g.home && r.away === g.away);
  const todayHasGame = league.dayIndex < league.schedule.length
    && league.schedule[league.dayIndex].some((g) => g.home === me || g.away === me);
  // Was this the user's championship season? Colors win cells gold in hindsight.
  const championSeason = league.playoffs?.champion === me
    || league.history.some((h) => h.season === league.season && h.champion === me);

  // Sim day-by-day toward `target` (exclusive), or indefinitely if null —
  // flashing each cell as it's simmed, fast enough that a week takes ~1-2s.
  const animatedSimTo = async (target, { stopAtGame = false, weeklyRecap = false } = {}) => {
    if (animatingRef.current || hasPendingEvent(getTeam(leagueRef.current, me))) return;
    animatingRef.current = true;
    setAnimating(true);
    skipRef.current = false;
    stopRef.current = false;
    setConfirmDay(null);
    const current = leagueRef.current;
    const offersBefore = current.tradeOffers.length;
    const startDay = current.dayIndex;
    const steps = Math.max(1, (target ?? startDay + 1) - startDay);
    const stepDelay = clamp(1500 / steps, 40, 250);
    let results = [];
    while (leagueRef.current.phase === 'regular' && (target == null || leagueRef.current.dayIndex < target)) {
      const injuredBefore = new Map(getTeam(leagueRef.current, me).roster.filter((p) => p.injury).map((p) => [p.id, p.injury]));
      results = simDay(leagueRef.current);
      const mine = results.find((r) => r.home === me || r.away === me);
      trackFeatured(results);
      commit();
      setFlashDay(leagueRef.current.dayIndex - 1);
      // check injuries before the "stop on game day" break below — that
      // break used to fire first and skip this check on the very day (the
      // user's own game) an injury is most likely to happen
      const rosterAfter = getTeam(leagueRef.current, me).roster;
      const injured = rosterAfter.filter((p) => p.injury && !injuredBefore.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, pos: p.pos, injury: p.injury }));
      const returned = rosterAfter.filter((p) => !p.injury && injuredBefore.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, pos: p.pos }));
      if ((injured.length || returned.length) && !leagueRef.current.settings?.suppressInjuryAlerts) {
        setInjuryAlert({ injured, returned });
        break;
      }
      if (hasPendingEvent(getTeam(leagueRef.current, me))) break;
      if (stopAtGame && mine) break;
      if (leagueRef.current.tradeOffers.length > offersBefore) break;
      if (leagueRef.current.allStar && !leagueRef.current.allStar.shown && leagueRef.current.dayIndex >= ALL_STAR_DAYS[0]) break;
      if (leagueRef.current.dayIndex >= leagueRef.current.schedule.length) break;
      if (stopRef.current) break;
      // pause a little longer on a day with one of the user's games, so the
      // FeaturedGame card has time to register before sliding on
      if (!skipRef.current) await delay(mine ? Math.max(stepDelay, 700) : stepDelay);
    }
    if (weeklyRecap && leagueRef.current.dayIndex > startDay) {
      weeklyRecapNews(leagueRef.current, startDay);
      commit();
    }
    setLastResults(results);
    setFlashDay(null);
    setAnimating(false);
    animatingRef.current = false;
    if (leagueRef.current.allStar && !leagueRef.current.allStar.shown && leagueRef.current.dayIndex >= ALL_STAR_DAYS[0]) {
      setScreen('allstar');
    }
  };

  const nextEventDay = () => {
    const candidates = [CHRISTMAS_DAY, TRADE_DEADLINE_DAY, ALL_STAR_DAYS[0], league.schedule.length]
      .filter((d) => d > league.dayIndex);
    return Math.min(...candidates);
  };

  const handleCellClick = (di) => {
    if (simDisabled || league.phase !== 'regular') return;
    if (di == null || di <= league.dayIndex || di > lastDi) return;
    setConfirmDay(di);
  };

  // ---------- Month grid ----------
  const monthStart = new Date(view.year, view.month, 1);
  const startOffset = monthStart.getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => new Date(view.year, view.month, 1 - startOffset + i));

  const firstMonthStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  const lastMonthStart = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);
  const canGoPrev = monthStart > firstMonthStart;
  const canGoNext = monthStart < lastMonthStart;
  const myTeam = getTeam(league, me);
  const simDisabled = animating || hasPendingEvent(myTeam);

  return (
    <div>
      {league.phase === 'regular' && (
        <div className="controls" data-tour="sim-controls">
          <button className="ui-btn ui-btn--primary ui-btn--md" disabled={simDisabled} onClick={() => animatedSimTo(league.dayIndex + 1)}>
            {todayHasGame ? 'Simulate Game' : 'Next Day'}
          </button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" disabled={simDisabled} onClick={() => animatedSimTo(null, { stopAtGame: true })}>Sim Next Game</button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" disabled={simDisabled} onClick={() => animatedSimTo(nextEventDay())}>Sim to Next Event</button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" disabled={simDisabled} onClick={() => animatedSimTo(Math.min(league.dayIndex + 7, league.schedule.length), { weeklyRecap: true })}>Sim Week</button>
          {animating && <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => { skipRef.current = true; }}>Skip ▸▸</button>}
          {animating && <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => { stopRef.current = true; }}>Stop ⏹</button>}
        </div>
      )}

      {league.phase !== 'regular' && (
        <div className="ui-card" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ui-section-header">
            <div className="ui-section-title">Calendar</div>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>{PHASE_BLURB[league.phase] || ''}</p>
        </div>
      )}

      <div className="ui-card calendar">
        <div className="calendar-header">
          <button className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!canGoPrev} onClick={() => setView((v) => {
            const m = v.month === 0 ? 11 : v.month - 1;
            const y = v.month === 0 ? v.year - 1 : v.year;
            return { year: y, month: m };
          })}>◀ Prev</button>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
            {monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!canGoNext} onClick={() => setView((v) => {
            const m = v.month === 11 ? 0 : v.month + 1;
            const y = v.month === 11 ? v.year + 1 : v.year;
            return { year: y, month: m };
          })}>Next ▶</button>
        </div>

        <div className="calendar-grid calendar-dow">
          {DOW.map((d) => <div key={d} className="calendar-dow-cell">{d}</div>)}
        </div>
        <div className="calendar-grid">
          {cells.map((d, i) => {
            const di = dayIndexForDate(league, d);
            const inMonth = d.getMonth() === view.month;
            const inRange = di >= 0 && di <= lastDi;
            const isToday = league.phase === 'regular' && di === league.dayIndex;
            const isFuture = league.phase === 'regular' && di > league.dayIndex;
            const isBlackout = ALL_STAR_DAYS.includes(di);
            const dayEvents = events.filter((e) => e.dayIndex === di);
            const userGame = inRange ? league.schedule[di].find((g) => g.home === me || g.away === me) : null;
            const result = userGame ? resultFor(di, userGame) : null;
            const clickable = inRange && isFuture && !simDisabled;
            const isPastDay = inRange && di < league.dayIndex;
            const isFutureDay = inRange && di > league.dayIndex;
            const resultIsWin = result
              ? (userGame.home === me ? result.homePts > result.awayPts : result.awayPts > result.homePts)
              : false;

            const cls = [
              'calendar-cell',
              !inMonth ? 'outmonth' : '',
              !inRange ? 'muted' : '',
              isToday ? 'today' : '',
              isPastDay ? 'cal-past' : '',
              isFutureDay ? 'cal-future' : '',
              result ? (resultIsWin ? 'cal-win' : 'cal-loss') : '',
              result && resultIsWin && championSeason ? 'cal-champ' : '',
              flashDay === di ? 'flash' : '',
              clickable ? 'clickable' : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={i}
                className={cls}
                onClick={clickable ? () => handleCellClick(di) : undefined}
              >
                <div className="calendar-daynum">{d.getDate()}</div>
                {dayEvents.map((ev) => (
                  <span
                    key={ev.id}
                    className="calendar-event-icon"
                    title={ev.label}
                    onClick={(e) => { e.stopPropagation(); setOpenEvent(openEvent === ev.id ? null : ev.id); }}
                  >
                    {ev.icon}
                  </span>
                ))}
                {inRange && (
                  isBlackout ? (
                    <div className="calendar-note">All-Star break — no games</div>
                  ) : userGame ? (
                    result ? (
                      <a className="team-link calendar-game" onClick={(e) => { e.stopPropagation(); openGame(result, fmtDate(d)); }}>
                        {userGame.home === me ? 'vs' : '@'}{' '}
                        <TeamBadge team={getTeam(league, userGame.home === me ? userGame.away : userGame.home)} size="small" />{' '}
                        {userGame.home === me ? userGame.away : userGame.home}{' '}
                        <span style={{ color: (userGame.home === me ? result.homePts > result.awayPts : result.awayPts > result.homePts) ? 'var(--green)' : 'var(--red)' }}>
                          {userGame.home === me ? result.homePts : result.awayPts}-{userGame.home === me ? result.awayPts : result.homePts}
                        </span>
                      </a>
                    ) : (
                      <span className="calendar-game">
                        {userGame.home === me ? 'vs' : '@'}{' '}
                        <TeamBadge team={getTeam(league, userGame.home === me ? userGame.away : userGame.home)} size="small" />{' '}
                        <TeamLink team={getTeam(league, userGame.home === me ? userGame.away : userGame.home)} openTeam={(id) => { if (!animating) openTeam(id); }}>
                          {userGame.home === me ? userGame.away : userGame.home}
                        </TeamLink>
                      </span>
                    )
                  ) : (
                    <div className="calendar-note">—</div>
                  )
                )}
                {confirmDay === di && (
                  <div className="calendar-popover">
                    <p>Sim to {fmtDate(d)}?</p>
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                      <button className="ui-btn ui-btn--primary ui-btn--sm" onClick={(e) => { e.stopPropagation(); animatedSimTo(di); }}>Sim</button>
                      <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={(e) => { e.stopPropagation(); setConfirmDay(null); }}>Cancel</button>
                    </div>
                  </div>
                )}
                {dayEvents.some((e) => e.id === openEvent) && (
                  <div className="calendar-popover">
                    <strong>{events.find((e) => e.id === openEvent).label}</strong>
                    <p>{events.find((e) => e.id === openEvent).description}</p>
                    {openEvent === 'trade-deadline' && league.dayIndex > TRADE_DEADLINE_DAY && (
                      <TradeDeadlineSummary league={league} openTeam={openTeam} />
                    )}
                    {openEvent === 'all-star-game' && league.allStar?.season === league.season && league.allStar.game && (
                      <button className="ui-btn ui-btn--primary ui-btn--sm" style={{ marginBottom: 'var(--sp-2)' }} onClick={(e) => { e.stopPropagation(); setOpenEvent(null); setScreen('allstar'); }}>
                        View All-Star Game
                      </button>
                    )}
                    <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={(e) => { e.stopPropagation(); setOpenEvent(null); }}>Close</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <InjuryAlertModal
        alert={injuryAlert}
        onClose={() => setInjuryAlert(null)}
        onGoToRoster={() => { setInjuryAlert(null); setScreen('roster'); }}
      />
      {/* CoachTalkModal/MilestoneAlertModal/CallUpPromptModal render once,
          globally, in App.jsx — they're engine-state-driven (not local to
          this screen) and need to show during playoffs too. */}
    </div>
  );
}

// Trades completed in the final 48 hours before the deadline — pulled from
// the news feed (every trade pushes a 'trade' news item with the day it happened).
function TradeDeadlineSummary({ league, openTeam }) {
  const recent = (league.news || []).filter((n) =>
    n.category === 'trade' && n.season === league.season
    && n.day >= TRADE_DEADLINE_DAY - 1 && n.day <= TRADE_DEADLINE_DAY
  );
  if (recent.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>No trades in the final 48 hours.</p>;
  }
  return (
    <div>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>Trades in the final 48 hours:</p>
      {recent.map((n, i) => (
        <p key={i} style={{ marginBottom: 'var(--sp-1)' }}><NewsText text={n.text} openTeam={openTeam} /></p>
      ))}
    </div>
  );
}
