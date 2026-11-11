import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamBadge } from './TeamDisplay.jsx';
import { safeAccent } from '../engine/colorUtils.js';

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

const BASE_MS = 350;        // per play at 1x — a median 398-play game runs ~2.3 min
const WINDOW = 60;          // plays kept on screen; the full log is in the box score after
const SPEEDS = [1, 2, 4];

export default function LiveGame({ game, home, away, onFinish }) {
  const plays = game?.playByPlay ?? [];
  const [idx, setIdx] = useState(0);     // plays revealed so far
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
        await delay(BASE_MS / s);
        // Re-check after the wait: a skip may have landed mid-delay.
        if (cancelled || posRef.current >= plays.length) return;
        posRef.current += 1;
        setIdx(posRef.current);
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

  const setSpeedBoth = (s) => { speedRef.current = s; setSpeed(s); };
  const skipToEnd = () => { posRef.current = plays.length; setIdx(plays.length); };

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
    <div className="ui-modal-overlay" style={{ background: 'var(--surface-0)' }}>
      <div className="ui-modal ui-modal--wide" role="dialog" aria-modal="true" style={{ display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>

        {/* Scoreboard */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-4)', paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flex: 1 }}>
            <TeamBadge team={away} />
            <div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{away.city}</div>
              <div style={{ fontWeight: 700 }}>{away.name}</div>
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, marginLeft: 'auto', color: leader === 'away' ? awayColor : 'var(--text-primary)' }}>
              {score.away}
            </div>
          </div>

          <div style={{ textAlign: 'center', minWidth: 96 }}>
            {done ? (
              <div style={{ fontWeight: 800, letterSpacing: 1, color: 'var(--text-primary)' }}>FINAL</div>
            ) : (
              <>
                <div style={{ fontWeight: 700 }}>{cur.q}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{cur.t}</div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flex: 1, justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 34, fontWeight: 800, marginRight: 'auto', color: leader === 'home' ? homeColor : 'var(--text-primary)' }}>
              {score.home}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{home.city}</div>
              <div style={{ fontWeight: 700 }}>{home.name}</div>
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

        {/* Feed */}
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
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {idx} / {plays.length} plays
          </span>
        </div>
      </div>
    </div>
  );
}
