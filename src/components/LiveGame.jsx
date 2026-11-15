import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamBadge } from './TeamDisplay.jsx';
import { safeAccent, courtKit } from '../engine/colorUtils.js';
import {
  buildFrames, placeHighlights, periodBreaks, liveBox, pregame, teamFoulsByPlay, floorOrder,
} from './liveFrames.js';
import ArenaCourt, { KitSwatch } from './ArenaCourt.jsx';
import { TipOffCard, BreakCard, FinalCard, HighlightBanner } from './LiveCards.jsx';
import { BoxTable } from './BoxScore.jsx';

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

// Playback is paced on the game clock — real gaps between plays run from
// under a second to fifteen, and a flat beat per play reads as a slideshow —
// but with a floor for each kind of play, so every one stays on screen long
// enough to follow: a shot has to fly, a free throw has its routine.
//
// On the clock alone (45ms a game second, as it was) half of all plays were
// over in under 140ms, some shots in 70, and a whole game in two minutes:
// too fast to watch. This puts a game at about eight minutes at 1x, every
// shot on screen for at least a second, and 4x at about the old pace.
const MS_PER_GAME_SEC = 90;
const MAX_PLAY_MS = 2400;   // a dead-ball stretch shouldn't stall
const FLOOR_MS = { shot: 1100, ft: 950, reb: 650, blk: 650, stl: 700, tov: 700, foul: 800 };
const FLOOR_DEFAULT_MS = 500;
const WINDOW = 60;          // plays kept on screen; the full log is in the box score after
const SPEEDS = [1, 2, 4];

// A beat after a result lands, before the next play starts moving: long
// enough to watch a basket drop and the score change, and to register a
// miss or the end of a trip to the line.
const dwellMs = (p, next) => (
  p?.k === 'shot' ? (p.m ? 700 : 250)
    : p?.k === 'ft' && next?.k !== 'ft' ? 350
      : 0
);

// The beats around the play. Tip-off waits for you, but not forever; a break
// card is a breath, shorter at higher speeds; a highlight banner rides along
// without stopping play.
const TIPOFF_MS = 4500;
const BREAK_MS = 3000;
const BANNER_MS = 2600;

const playMs = (play, gapSec, speed) =>
  Math.max(FLOOR_MS[play?.k] ?? FLOOR_DEFAULT_MS, Math.min(MAX_PLAY_MS, (gapSec ?? 4) * MS_PER_GAME_SEC))
    / Math.max(speed, 0.25);

// Frames — who's where, who has it, the ball's route — come from liveFrames.js,
// kept free of React so headless checks can run the same code.

// `ctx` says what kind of game this is, for the cards around it — see
// watchGame.js. Left out, it's tonight's regular-season game.
export default function LiveGame({ game, home, away, onFinish, ctx = null }) {
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
  const [card, setCard] = useState(null);     // tip-off / break card holding play
  const [banner, setBanner] = useState(null); // a highlight riding along with play
  const speedRef = useRef(1);
  // Playback position lives in a ref, not just state: the loop and "skip to
  // final" both move it, and a loop counting on its own local would overwrite
  // a skip on its very next tick.
  const posRef = useRef(0);
  const feedRef = useRef(null);
  const holdRef = useRef(null);      // ends the current tip-off/break hold early
  const bannerTimer = useRef(null);
  const finishedRef = useRef(false);     // onFinish is idempotent — close and skip both route here

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish?.();
  };

  // A pause in playback that a button can cut short.
  const hold = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); holdRef.current = null; resolve(); };
    const timer = setTimeout(done, ms);
    holdRef.current = done;
  });
  const endHold = () => holdRef.current?.();

  // Running score after each play: plays only carry a score when someone
  // scored, so carry the last one forward. Precomputed once rather than
  // scanning backwards on every tick.
  const scoreAt = useMemo(() => {
    let last = { home: 0, away: 0 };
    return plays.map((p) => (p.score ? (last = p.score) : last));
  }, [plays]);

  const periodOrder = useMemo(() => [...new Set(plays.map((p) => p.q).filter(Boolean))], [plays]);

  const [view, setView] = useState('court'); // 'court' | 'box' | 'feed'
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

  // The sim's own highlights, placed on the plays they belong to, and the
  // breaks between periods — see liveFrames.js.
  const highlights = useMemo(() => placeHighlights(plays, game?.events), [plays, game]);
  const breaks = useMemo(() => periodBreaks(plays), [plays]);
  const breakAt = useMemo(() => new Map(breaks.map((b) => [b.i, b])), [breaks]);
  const breakAtRef = useRef(breakAt);
  breakAtRef.current = breakAt;
  const pre = useMemo(() => pregame(game, home, away, ctx?.pregame), [game, home, away, ctx]);
  const fouls = useMemo(() => teamFoulsByPlay(plays), [plays]);
  // The live box: the app's own box-score table, fed lines rebuilt from the
  // plays so far. It looks players up through a league; these two rosters are
  // all it needs, and handing it the real league — already simmed past
  // tonight — would only invite a spoiler.
  const boxLeague = useMemo(() => ({ teams: [home, away], freeAgents: [] }), [home, away]);
  const order = useMemo(
    () => ({ home: floorOrder(game?.lineups, 'home'), away: floorOrder(game?.lineups, 'away') }),
    [game],
  );

  // Playback loop. Mirrors Calendar's animatedSimTo: a local counter drives
  // the async loop so no tick reads a stale closure, and the cleanup flag
  // stops it if this unmounts mid-game.
  useEffect(() => {
    if (!plays.length) return undefined;
    let cancelled = false;
    (async () => {
      // The matchup first: until "Tip off", or a few seconds.
      if (posRef.current === 0) {
        setCard({ kind: 'tipoff' });
        await hold(TIPOFF_MS);
        if (cancelled) return;
        setCard(null);
      }
      while (!cancelled && posRef.current < plays.length) {
        const s = speedRef.current;
        if (s === 0) { await delay(120); continue; } // paused
        // The wait before a play is that play's own share of the game clock,
        // and the court spends it acting the play out; motion gets 90% so it
        // has landed by the reveal.
        const k = posRef.current;
        const wait = playMs(plays[k], framesRef.current[k]?.gap, s);
        setStage({ k, ms: wait * 0.9 });
        await delay(wait);
        // Re-check after the wait: a skip may have landed mid-delay.
        if (cancelled || posRef.current !== k) return;
        posRef.current = k + 1;
        setIdx(k + 1);
        // Let it land before the next play starts moving.
        const dwell = dwellMs(plays[k], plays[k + 1]) / Math.max(1, speedRef.current);
        if (dwell) {
          await delay(dwell);
          if (cancelled || posRef.current !== k + 1) return;
        }
        // End of a period: a beat before the next one starts.
        const brk = breakAtRef.current.get(k);
        if (brk && !brk.final) {
          setCard({ kind: 'break', brk });
          await hold(Math.max(900, BREAK_MS / Math.max(1, speedRef.current)));
          if (cancelled || posRef.current !== k + 1) return;
          setCard(null);
        }
      }
    })();
    return () => { cancelled = true; endHold(); };
  }, [plays]); // eslint-disable-line react-hooks/exhaustive-deps

  // A highlight rides along for a couple of seconds without stopping play.
  // Its timer isn't tied to `idx`: the next play usually lands well before
  // the banner should go.
  useEffect(() => {
    const evs = highlights.byPlay.get(idx - 1);
    if (!evs?.length) return;
    clearTimeout(bannerTimer.current);
    setBanner({ key: idx - 1, events: evs });
    bannerTimer.current = setTimeout(() => setBanner(null), Math.max(1200, BANNER_MS / Math.max(1, speedRef.current)));
  }, [idx, highlights]);
  useEffect(() => () => clearTimeout(bannerTimer.current), []);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [idx]);

  // Leaving without finishing would strand the day un-revealed.
  useEffect(() => finish, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The court for the play just shown. Positions off the ball are derived
  // rather than simulated — see courtPositions.js. (Above the early return:
  // a hook below one runs on some renders and not others.)
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

  // The box as of the last play revealed — built only while it's on screen.
  const liveLines = useMemo(() => {
    if (view !== 'box') return null;
    const box = liveBox(plays, idx, { frames, lineups: game?.lineups });
    // Whole minutes, like the box score: a clock that's run 2:40 shows 2.
    const side = (s) => order[s].filter((id) => box.has(id))
      .map((id) => ({ ...box.get(id), min: Math.floor(box.get(id).min + 1e-9) }));
    return { home: side('home'), away: side('away') };
  }, [view, plays, idx, frames, game, order]);
  // Injuries reach the box score as they happen, not before.
  const hurtSoFar = useMemo(() => {
    if (view !== 'box') return [];
    const seen = new Set();
    for (const [i, evs] of highlights.byPlay) if (i < idx) for (const e of evs) if (e.k === 'injury') seen.add(e.p);
    const over = idx >= plays.length;
    return (game?.injuryReport ?? []).filter((e) => over || seen.has(e.playerId));
  }, [view, highlights, idx, plays, game]);

  if (!plays.length) return null;

  const done = idx >= plays.length;
  const cur = plays[Math.max(0, idx - 1)];
  const score = idx > 0 ? scoreAt[idx - 1] : { home: 0, away: 0 };
  const shown = plays.slice(Math.max(0, idx - WINDOW), idx);
  const curPeriodIdx = idx > 0 ? periodOrder.indexOf(cur.q) : 0;

  const setSpeedBoth = (s) => { speedRef.current = s; setSpeed(s); };
  const skipToEnd = () => {
    posRef.current = plays.length;
    endHold();
    setCard(null);
    setStage({ k: plays.length - 1, ms: 320 });
    setIdx(plays.length);
  };

  const homeColor = safeAccent(home.color);
  const awayColor = safeAccent(away.color);
  const leader = score.home === score.away ? null : score.home > score.away ? 'home' : 'away';
  // Team fouls this period, and who's in the bonus: the side whose opponent
  // has reached the limit, so any common foul against it is shot.
  const tf = idx > 0 ? fouls[idx - 1] : { home: 0, away: 0, bonusAt: 5 };
  const foulLine = (s) => !done && (
    <div className="live-fouls">
      <span>Fouls {tf[s]}</span>
      {tf[s === 'home' ? 'away' : 'home'] >= tf.bonusAt && (
        <span className="live-bonus" title="In the bonus: common fouls against them go to the line">Bonus</span>
      )}
    </div>
  );
  const onFloor = new Set((frames[Math.max(0, idx - 1)]?.players ?? []).map((x) => x.id));
  const teamFor = (side) => (side === 'home' ? home : away);
  const sideOfPlayer = (id) => (home.roster.some((p) => p.id === id) ? 'home' : 'away');
  const nameOf = (id) => rosterById.get(id)?.name ?? '';

  // The play just revealed, if it was a shot landing: a make gets its swish
  // and points, a miss a glance off the rim — unless it was blocked, and
  // never reached the rim at all.
  const last = plays[idx - 1];
  const lastFrame = frames[idx - 1];
  const moment = last && lastFrame && (last.k === 'shot' || last.k === 'ft') && !(lastFrame.blocked)
    ? {
      key: idx - 1,
      made: !!last.m,
      pts: last.k === 'ft' ? 1 : last.pts,
      top: lastFrame.attackTop,
      color: safeAccent(teamFor(lastFrame.offSide).color),
    }
    : null;

  // Break card: the period's score and who's leading each side so far.
  const breakCard = card?.kind === 'break' && (() => {
    const { i, per, q } = card.brk;
    const box = liveBox(plays, i + 1);
    const lead = (side) => {
      let best = null;
      for (const [id, l] of box) {
        if (sideOfPlayer(id) !== side) continue;
        if (!best || l.pts > best.pts) best = { name: nameOf(id), ...l };
      }
      return best;
    };
    const s = scoreAt[i];
    // Only the final break goes untitled here (the final card has it), so a
    // break at the end of the 4th means a tie and more basketball.
    const title = per === 1 ? 'Halftime' : per === 3 ? 'End of regulation' : `End of ${q}`;
    return {
      title,
      score: s,
      period: { home: game.homeQtrs?.[per] ?? 0, away: game.awayQtrs?.[per] ?? 0 },
      leaders: { home: lead('home'), away: lead('away') },
      notes: (highlights.periodNotes.get(per) ?? []).map((e) => e.text),
    };
  })();

  // Final card: the whole box score is fair game now.
  const finalTop = (side) => (side === 'home' ? game.homeBox : game.awayBox)
    .map((l) => ({ id: l.playerId, name: nameOf(l.playerId), pts: l.pts, reb: l.reb, ast: l.ast }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3);

  const tdBase = { padding: '3px 6px', verticalAlign: 'top', fontSize: 13 };

  return (
    // Opaque, not the usual translucent scrim. simDay has already mutated the
    // league in place, so although nothing is committed or saved, any render
    // triggered while this is open would re-read those mutated team objects
    // and show tonight's result behind the viewer. Covering the app entirely
    // is what keeps the game unspoiled until Continue.
    <div className="ui-modal-overlay live-overlay" style={{ background: 'var(--surface-0)' }}>
      <div className="ui-modal ui-modal--wide live-modal" role="dialog" aria-modal="true">

        {/* Scoreboard. Each score is keyed by its value, so a basket remounts it
            and the pop plays. */}
        <div className="live-scoreboard">
          <div className="live-team live-team--away">
            <TeamBadge team={away} />
            <div className="live-team-text">
              <div className="live-city">{away.city}</div>
              <div className="live-name">{away.name}</div>
              {foulLine('away')}
            </div>
            <div
              key={`a${score.away}`}
              className={`live-score${score.away > 0 ? ' live-score--pop' : ''}`}
              style={{ color: leader === 'away' ? awayColor : 'var(--text-primary)' }}
            >
              {score.away}
            </div>
          </div>

          <div className="live-clock">
            {done ? (
              <div style={{ fontWeight: 800, letterSpacing: 1, color: 'var(--text-primary)' }}>FINAL</div>
            ) : (
              <>
                <div style={{ fontWeight: 700 }}>{idx > 0 ? cur.q : 'Q1'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{idx > 0 ? cur.t : '12:00'}</div>
              </>
            )}
          </div>

          <div className="live-team live-team--home">
            <div
              key={`h${score.home}`}
              className={`live-score${score.home > 0 ? ' live-score--pop' : ''}`}
              style={{ color: leader === 'home' ? homeColor : 'var(--text-primary)' }}
            >
              {score.home}
            </div>
            <div className="live-team-text">
              <div className="live-city">{home.city}</div>
              <div className="live-name">{home.name}</div>
              {foulLine('home')}
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

        <div className="live-stage">
          {/* Court */}
          {view === 'court' && court && (
            <div className="live-court-row">
              <div className="live-court">
                <ArenaCourt
                  players={court.players}
                  holderId={court.holderId}
                  actorId={court.actorId}
                  act={court.act}
                  // Held at its starting point until tip-off: the court is
                  // already staged on the opening play, and its flight would
                  // otherwise run (and finish) behind the tip-off card.
                  ballPath={card?.kind === 'tipoff' ? court.ballPath.slice(0, 1) : court.ballPath}
                  shot={court.shot}
                  attackTop={court.attackTop}
                  homeTeam={home}
                  awayTeam={away}
                  playerById={(id) => rosterById.get(id)}
                  moment={moment}
                  // The wait before the staged play: a long gap between
                  // possessions is the run up the floor.
                  moveMs={stage.ms}
                />
                {banner && !card && (
                  <HighlightBanner
                    key={banner.key}
                    events={banner.events}
                    color={safeAccent(teamFor(banner.events[0].side ?? (sideOfPlayer(banner.events[0].p)))?.color)}
                  />
                )}
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

          {/* Box score, live */}
          {view === 'box' && liveLines && (
            <div className="live-box">
              {[['away', away], ['home', home]].map(([s, team]) => (
                <div key={s} className="ui-table-wrap">
                  <BoxTable
                    league={boxLeague} teamId={team.id} pts={score[s]} box={liveLines[s]}
                    injuryReport={hurtSoFar} live={{ onFloor }}
                  />
                </div>
              ))}
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

          {/* The beats around play: tip-off, breaks, the result. */}
          {(card?.kind === 'tipoff' || breakCard || done) && (
            <div className="live-card-scrim">
              {card?.kind === 'tipoff' && (
                <TipOffCard home={home} away={away} pre={pre} onStart={endHold} kicker={ctx?.kicker} subtitle={ctx?.subtitle} />
              )}
              {breakCard && <BreakCard home={home} away={away} {...breakCard} onContinue={endHold} />}
              {done && !card && (
                <FinalCard
                  home={home} away={away} score={score}
                  top={{ home: finalTop('home'), away: finalTop('away') }}
                  notes={highlights.post.map((e) => e.text.replace(/^🩹\s*/, ''))}
                  note={ctx?.finalNote}
                />
              )}
            </div>
          )}
        </div>

        {/* Transport */}
        <div className="controls" style={{ paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--border)', marginBottom: 0 }}>
          {done ? (
            <button className="ui-btn ui-btn--primary ui-btn--md" onClick={finish}>{ctx?.replay ? 'Close' : 'Continue'}</button>
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
          <div className="live-views">
            {[['court', 'Court'], ['box', 'Box score'], ['feed', 'Play-by-play']].map(([v, label]) => (
              <button
                key={v}
                aria-pressed={view === v}
                className={`ui-btn ui-btn--md ${view === v ? 'ui-btn--primary' : 'ui-btn--secondary'}`}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {idx} / {plays.length} plays
          </span>
        </div>
      </div>
    </div>
  );
}
