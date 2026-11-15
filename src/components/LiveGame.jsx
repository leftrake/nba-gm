import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamBadge } from './TeamDisplay.jsx';
import { safeAccent, courtKit } from '../engine/colorUtils.js';
import { buildFrames } from './liveFrames.js';
import ArenaCourt, { KitSwatch } from './ArenaCourt.jsx';

// Watch a game unfold play by play.
//
// The game is already over by the time this mounts — simGame plays the whole
// thing synchronously and hands back the finished play-by-play (~400 plays).
// So this is a replay, not a live simulation, and nothing in the engine has
// to change for it. The seeded rng means the result was fixed the moment the
// day was simmed either way.
//
// What keeps it from being a spoiler is the mutate-then-commit model: the
// caller sims the day (which mutates the league in place) but does NOT
// commit, so React — and therefore every other screen — still shows the
// pre-game league. onFinish() is what finally reveals it.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Playback is paced on the game clock, not a fixed beat per play. Real gaps
// between plays run from under a second to fifteen, and half of them are over
// six — rendering all of them identically is what makes a flat beat read as a
// slideshow instead of basketball. 45ms per game second puts a median gap at
// ~350ms and a full game at a little over two minutes, the same as before.
const MS_PER_GAME_SEC = 45;
const MIN_PLAY_MS = 70;     // a scramble shouldn't flash past unreadably
const MAX_PLAY_MS = 900;    // nor should a dead-ball stretch stall
const WINDOW = 60;          // plays kept on screen; the full log is in the box score after
const SPEEDS = [1, 2, 4];

const playMs = (gapSec, speed) =>
  Math.max(MIN_PLAY_MS, Math.min(MAX_PLAY_MS, ((gapSec ?? 4) * MS_PER_GAME_SEC) / Math.max(speed, 0.25)));

// Frames — who's where, who has it, the ball's route — come from liveFrames.js,
// kept free of React so headless checks can run the same code.

export default function LiveGame({ game, home, away, onFinish }) {
  const plays = game?.playByPlay ?? [];
  const [idx, setIdx] = useState(0);     // plays revealed so far — ticker, score, clock
  // The play the court is acting out, and over how long. It runs one play
  // ahead of `idx`: during the wait before a play the players move into it and
  // the ball makes its way there, and the play is revealed as it lands. Moving
  // on reveal instead left the screen frozen through every gap and crammed the
  // motion into the time after — so the run between possessions (the longest
  // gaps) spilled into the next few plays, and free throws went up mid-pan.
  const [stage, setStage] = useState({ k: 0, ms: 320 });
  const [speed, setSpeed] = useState(1); // 0 = paused
  const speedRef = useRef(1);
  // Playback position lives in a ref, not just state: the loop and "skip to
  // final" both move it, and a loop counting on its own local would overwrite
  // a skip on its very next tick.
  const posRef = useRef(0);
  const feedRef = useRef(null);
  const finishedRef = useRef(false);     // onFinish is idempotent — close and skip both route here

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish?.();
  };

  // Running score after each play: plays only carry a score when someone
  // scored, so carry the last one forward. Precomputed once rather than
  // scanning backwards on every tick.
  const scoreAt = useMemo(() => {
    let last = { home: 0, away: 0 };
    return plays.map((p) => (p.score ? (last = p.score) : last));
  }, [plays]);

  const periodOrder = useMemo(() => [...new Set(plays.map((p) => p.q).filter(Boolean))], [plays]);

  const [view, setView] = useState('court'); // 'court' | 'feed'
  const frames = useMemo(
    () => buildFrames(plays, game?.lineups, home, away),
    [plays, game, home, away],
  );
  // Read inside the playback loop, which must not restart when frames change.
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const rosterById = useMemo(() => {
    const m = new Map();
    for (const p of [...home.roster, ...away.roster]) m.set(p.id, p);
    return m;
  }, [home, away]);

  // Playback loop. Mirrors Calendar's animatedSimTo: a local counter drives
  // the async loop so no tick reads a stale closure, and the cleanup flag
  // stops it if this unmounts mid-game.
  useEffect(() => {
    if (!plays.length) return undefined;
    let cancelled = false;
    (async () => {
      while (!cancelled && posRef.current < plays.length) {
        const s = speedRef.current;
        if (s === 0) { await delay(120); continue; } // paused
        // The wait before a play is that play's own share of the game clock,
        // and the court spends it acting the play out; motion gets 90% so it
        // has landed by the reveal.
        const k = posRef.current;
        const wait = playMs(framesRef.current[k]?.gap, s);
        setStage({ k, ms: wait * 0.9 });
        await delay(wait);
        // Re-check after the wait: a skip may have landed mid-delay.
        if (cancelled || posRef.current !== k) return;
        posRef.current = k + 1;
        setIdx(k + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [plays]);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [idx]);

  // Leaving without finishing would strand the day un-revealed.
  useEffect(() => finish, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plays.length) return null;

  const done = idx >= plays.length;
  const cur = plays[Math.max(0, idx - 1)];
  const score = idx > 0 ? scoreAt[idx - 1] : { home: 0, away: 0 };
  const shown = plays.slice(Math.max(0, idx - WINDOW), idx);
  const curPeriodIdx = idx > 0 ? periodOrder.indexOf(cur.q) : 0;

  // The court for the play just shown. Positions off the ball are derived
  // rather than simulated — see courtPositions.js.
  const court = useMemo(() => {
    const f = frames[Math.min(stage.k, frames.length - 1)];
    if (!f?.players?.length) return null;
    const teamFor = (side) => (side === 'home' ? home : away);
    return {
      ...f,
      // Made or missed is the play's result: it waits for the reveal.
      shot: frames[idx - 1]?.shot ?? null,
      offenseTeam: teamFor(f.offSide),
      defenseTeam: teamFor(f.defSide),
    };
  }, [frames, stage.k, idx, home, away]);

  const setSpeedBoth = (s) => { speedRef.current = s; setSpeed(s); };
  const skipToEnd = () => {
    posRef.current = plays.length;
    setStage({ k: plays.length - 1, ms: 320 });
    setIdx(plays.length);
  };

  const homeColor = safeAccent(home.color);
  const awayColor = safeAccent(away.color);
  const leader = score.home === score.away ? null : score.home > score.away ? 'home' : 'away';

  const tdBase = { padding: '3px 6px', verticalAlign: 'top', fontSize: 13 };

  return (
    // Opaque, not the usual translucent scrim. simDay has already mutated the
    // league in place, so although nothing is committed or saved, any render
    // triggered while this is open would re-read those mutated team objects
    // and show tonight's result behind the viewer. Covering the app entirely
    // is what keeps the game unspoiled until Continue.
    <div className="ui-modal-overlay live-overlay" style={{ background: 'var(--surface-0)' }}>
      <div className="ui-modal ui-modal--wide live-modal" role="dialog" aria-modal="true">

        {/* Scoreboard */}
        <div className="live-scoreboard">
          <div className="live-team live-team--away">
            <TeamBadge team={away} />
            <div className="live-team-text">
              <div className="live-city">{away.city}</div>
              <div className="live-name">{away.name}</div>
            </div>
            <div className="live-score" style={{ color: leader === 'away' ? awayColor : 'var(--text-primary)' }}>
              {score.away}
            </div>
          </div>

          <div className="live-clock">
            {done ? (
              <div style={{ fontWeight: 800, letterSpacing: 1, color: 'var(--text-primary)' }}>FINAL</div>
            ) : (
              <>
                <div style={{ fontWeight: 700 }}>{cur.q}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{cur.t}</div>
              </>
            )}
          </div>

          <div className="live-team live-team--home">
            <div className="live-score" style={{ color: leader === 'home' ? homeColor : 'var(--text-primary)' }}>
              {score.home}
            </div>
            <div className="live-team-text">
              <div className="live-city">{home.city}</div>
              <div className="live-name">{home.name}</div>
            </div>
            <TeamBadge team={home} />
          </div>
        </div>

        {/* Line score — a quarter fills in once play moves past it */}
        {periodOrder.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-2) 0', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-sm)' }}>
            {periodOrder.map((q, i) => (
              <div key={q} style={{ textAlign: 'center', opacity: i <= curPeriodIdx ? 1 : 0.3 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{q}</div>
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {i < curPeriodIdx || done
                    ? `${game.awayQtrs?.[i] ?? '–'}–${game.homeQtrs?.[i] ?? '–'}`
                    : i === curPeriodIdx ? '·' : '–'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Court */}
        {view === 'court' && court && (
          <div className="live-court-row">
            <div className="live-court">
              <ArenaCourt
                players={court.players}
                holderId={court.holderId}
                ballPath={court.ballPath}
                shot={court.shot}
                attackTop={court.attackTop}
                homeTeam={home}
                awayTeam={away}
                playerById={(id) => rosterById.get(id)}
                // The wait before the staged play: a long gap between
                // possessions is the run up the floor.
                moveMs={stage.ms}
              />
              <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--sp-4)', marginTop: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>
                <span style={{ fontWeight: 700 }}>
                  <KitSwatch kit={courtKit(court.offenseTeam.color, court.offenseTeam.id === home.id)} /> {court.offenseTeam.name} on offense
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  <KitSwatch kit={courtKit(court.defenseTeam.color, court.defenseTeam.id === home.id)} /> {court.defenseTeam.name}
                </span>
              </div>
            </div>
            {/* last few plays, so the court has a caption */}
            <div className="live-ticker">
              {plays.slice(Math.max(0, idx - 9), idx).reverse().map((e, i) => (
                <div
                  key={idx - i}
                  style={{
                    padding: '4px 0', fontSize: 13, opacity: i === 0 ? 1 : 0.5,
                    fontWeight: i === 0 ? 600 : 400,
                    borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>{e.q} {e.t}</span>
                  {e.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feed */}
        {view === 'feed' && (
        <div ref={feedRef} style={{ overflowY: 'auto', flex: 1, minHeight: 240 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {shown.map((e, i) => (
                <tr key={idx - shown.length + i} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)' }}>
                  <td style={{ ...tdBase, width: '44%', textAlign: 'left' }}>{e.side === 'away' && e.text}</td>
                  <td style={{ ...tdBase, width: '12%', textAlign: 'center', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {e.q}{e.t ? ` ${e.t}` : ''}
                    {e.score && (
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 11, marginTop: 2 }}>
                        {e.score.away}–{e.score.home}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdBase, width: '44%', textAlign: 'right' }}>{e.side === 'home' && e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* Transport */}
        <div className="controls" style={{ paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--border)', marginBottom: 0 }}>
          {done ? (
            <button className="ui-btn ui-btn--primary ui-btn--md" onClick={finish}>Continue</button>
          ) : (
            <>
              <button
                className="ui-btn ui-btn--secondary ui-btn--md"
                onClick={() => setSpeedBoth(speed === 0 ? 1 : 0)}
              >
                {speed === 0 ? '▶ Play' : '❙❙ Pause'}
              </button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className={`ui-btn ui-btn--md ${speed === s ? 'ui-btn--primary' : 'ui-btn--secondary'}`}
                  onClick={() => setSpeedBoth(s)}
                >
                  {s}x
                </button>
              ))}
              <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={skipToEnd}>Skip to final ▸▸</button>
            </>
          )}
          <button
            className="ui-btn ui-btn--secondary ui-btn--md"
            style={{ marginLeft: 'auto' }}
            onClick={() => setView((v) => (v === 'court' ? 'feed' : 'court'))}
          >
            {view === 'court' ? 'Play-by-play' : 'Court'}
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {idx} / {plays.length} plays
          </span>
        </div>
      </div>
    </div>
  );
}
