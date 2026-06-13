import React, { useRef, useState } from 'react';
import {
  getTeam, dateForDay, dayIndexForDate, simDay, getLeagueEvents,
  CHRISTMAS_DAY, TRADE_DEADLINE_DAY, ALL_STAR_DAYS,
} from '../engine/league.js';
import { clamp } from '../engine/rng.js';
import { fmtDate, TeamLink, NewsText } from './shared.jsx';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const [flashDay, setFlashDay] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [openEvent, setOpenEvent] = useState(null);
  const [confirmDay, setConfirmDay] = useState(null);
  const skipRef = useRef(false);
  const animatingRef = useRef(false);

  const events = getLeagueEvents();
  const resultFor = (di, g) => (league.resultsByDay?.[di] || []).find((r) => r.home === g.home && r.away === g.away);
  const todayHasGame = league.dayIndex < league.schedule.length
    && league.schedule[league.dayIndex].some((g) => g.home === me || g.away === me);

  // Sim day-by-day toward `target` (exclusive), or indefinitely if null —
  // flashing each cell as it's simmed, fast enough that a week takes ~1-2s.
  const animatedSimTo = async (target, { stopAtGame = false } = {}) => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    setAnimating(true);
    skipRef.current = false;
    setConfirmDay(null);
    const current = leagueRef.current;
    const offersBefore = current.tradeOffers.length;
    const startDay = current.dayIndex;
    const steps = Math.max(1, (target ?? startDay + 1) - startDay);
    const stepDelay = clamp(1500 / steps, 40, 250);
    let results = [];
    while (leagueRef.current.phase === 'regular' && (target == null || leagueRef.current.dayIndex < target)) {
      results = simDay(leagueRef.current);
      const mine = results.find((r) => r.home === me || r.away === me);
      trackFeatured(results);
      commit();
      setFlashDay(leagueRef.current.dayIndex - 1);
      if (stopAtGame && mine) break;
      if (leagueRef.current.tradeOffers.length > offersBefore) break;
      if (leagueRef.current.allStar && !leagueRef.current.allStar.shown && leagueRef.current.dayIndex >= ALL_STAR_DAYS[0]) break;
      if (leagueRef.current.dayIndex >= leagueRef.current.schedule.length) break;
      if (!skipRef.current) await delay(stepDelay);
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
    if (animating || league.phase !== 'regular') return;
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

  return (
    <div>
      {league.phase === 'regular' && (
        <div className="controls">
          <button className="btn" disabled={animating} onClick={() => animatedSimTo(league.dayIndex + 1)}>
            {todayHasGame ? 'Simulate Game' : 'Next Day'}
          </button>
          <button className="btn secondary" disabled={animating} onClick={() => animatedSimTo(null, { stopAtGame: true })}>Sim Next Game</button>
          <button className="btn secondary" disabled={animating} onClick={() => animatedSimTo(nextEventDay())}>Sim to Next Event</button>
          <button className="btn secondary" disabled={animating} onClick={() => animatedSimTo(Math.min(league.dayIndex + 7, league.schedule.length))}>Sim Week</button>
          {animating && <button className="btn secondary" onClick={() => { skipRef.current = true; }}>Skip ▸▸</button>}
        </div>
      )}

      {league.phase !== 'regular' && (
        <div className="panel">
          <h2>Calendar</h2>
          <p style={{ color: 'var(--muted)' }}>{PHASE_BLURB[league.phase] || ''}</p>
        </div>
      )}

      <div className="panel calendar">
        <div className="calendar-header">
          <button className="btn small secondary" disabled={!canGoPrev} onClick={() => setView((v) => {
            const m = v.month === 0 ? 11 : v.month - 1;
            const y = v.month === 0 ? v.year - 1 : v.year;
            return { year: y, month: m };
          })}>◀ Prev</button>
          <h3 style={{ margin: 0 }}>{monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
          <button className="btn small secondary" disabled={!canGoNext} onClick={() => setView((v) => {
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
            const clickable = inRange && isFuture && !animating;

            const cls = [
              'calendar-cell',
              !inMonth ? 'outmonth' : '',
              !inRange ? 'muted' : '',
              isToday ? 'today' : '',
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
                        {userGame.home === me ? 'vs' : '@'} {userGame.home === me ? userGame.away : userGame.home}{' '}
                        <span style={{ color: (userGame.home === me ? result.homePts > result.awayPts : result.awayPts > result.homePts) ? 'var(--green)' : 'var(--red)' }}>
                          {userGame.home === me ? result.homePts : result.awayPts}-{userGame.home === me ? result.awayPts : result.homePts}
                        </span>
                      </a>
                    ) : (
                      <span className="calendar-game">
                        {userGame.home === me ? 'vs' : '@'}{' '}
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
                    <div className="controls" style={{ marginBottom: 0 }}>
                      <button className="btn small" onClick={(e) => { e.stopPropagation(); animatedSimTo(di); }}>Sim</button>
                      <button className="btn small secondary" onClick={(e) => { e.stopPropagation(); setConfirmDay(null); }}>Cancel</button>
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
                    <button className="btn small secondary" onClick={(e) => { e.stopPropagation(); setOpenEvent(null); }}>Close</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
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
    return <p style={{ color: 'var(--muted)' }}>No trades in the final 48 hours.</p>;
  }
  return (
    <div>
      <p style={{ color: 'var(--muted)' }}>Trades in the final 48 hours:</p>
      {recent.map((n, i) => (
        <p key={i}><NewsText text={n.text} openTeam={openTeam} /></p>
      ))}
    </div>
  );
}
