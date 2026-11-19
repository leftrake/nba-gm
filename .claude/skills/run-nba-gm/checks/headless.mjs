// Headless checks for the live game viewer: plain Node, importing the very
// modules the viewer runs (liveFrames.js, watchGame.js) and the engine, so
// what's checked is the code that ships, not a re-implementation of it.
//
// Each game is checked the moment it's simmed, against the league as it
// stands then — exactly what the viewer is handed when Watch opens it — and
// against a snapshot from just before, for what was true at tip-off.

import { readFileSync } from 'node:fs';
import {
  simDay, simPlayoffGame, simPlayInGame, getTeam, backfillPlayers,
} from '../../../../src/engine/league.js';
import { simCupGame, cupComplete } from '../../../../src/engine/cup.js';
import { simAllStarGame } from '../../../../src/engine/allstar.js';
import { BOX_COLS, decodeBox } from '../../../../src/engine/sim.js';
import { checkSave } from '../../../../src/engine/save.js';
import {
  buildFrames, liveBox, teamFoulsByPlay, placeHighlights, periodBreaks, pregame, lineupChange, flowLine,
} from '../../../../src/components/liveFrames.js';
import { canWatch, forViewer, asPlayed, playoffContext, REPLAY } from '../../../../src/components/watchGame.js';
import { Violations, assert } from './harness.mjs';

// ---- Loading ----------------------------------------------------------------------

// A built state, loaded the way the app loads a save.
function load(file) {
  const check = checkSave(JSON.parse(readFileSync(file, 'utf8')));
  if (check.error) throw new Error(`${file}: ${check.error}`);
  backfillPlayers(check.league);
  return check.league;
}

// What was true before tonight: records, season scoring, who was hurt, and
// who played for whom.
function snapshot(lg) {
  const teams = new Map();
  const players = new Map();
  for (const t of lg.teams) {
    teams.set(t.id, {
      wins: t.wins ?? 0,
      losses: t.losses ?? 0,
      injured: new Set(t.roster.filter((p) => p.injury).map((p) => p.id)),
    });
    for (const p of t.roster) players.set(p.id, { gp: p.stats?.gp ?? 0, pts: p.stats?.pts ?? 0, team: t.id });
  }
  return { teams, players };
}

// Players who were on a team before tonight and aren't on it now: traded or
// released after the night's games, by the AI moves simDay makes once the
// games are in.
//
// KNOWN ISSUE, not checked here: Watch hands the viewer each team as it
// stands after the day, so a player moved that night isn't on the roster it
// draws from. His name is blank on the tip-off card and his possessions can
// come out with offense and defense swapped. It's rare (one game in a
// 220-game month) and wants fixing in the viewer's inputs; until then the
// checks skip just what involves him, and say how much they skipped.
function movedSince(before, lg) {
  const now = new Map();
  for (const t of lg.teams) for (const p of t.roster) now.set(p.id, t.id);
  const moved = new Set();
  for (const [id, b] of before.players) if (now.get(id) !== b.team) moved.add(id);
  return moved;
}
const NOBODY = new Set();

// The score after each play, carried forward from the plays that scored.
function scoresAfter(plays) {
  let last = { home: 0, away: 0 };
  return plays.map((p) => (p.score ? (last = p.score) : last));
}

const lines = (box) => (box?.length && Array.isArray(box[0]) ? decodeBox(box) : box ?? []);
const otherSide = (s) => (s === 'home' ? 'away' : 'home');
const where = (label, plays, i) => `${label} play ${i} (${plays[i]?.q} ${plays[i]?.t} "${plays[i]?.text}")`;

// ---- Per-game invariants ----------------------------------------------------------

function newTally() {
  return {
    games: 0,
    plays: 0,
    fouls: 0,
    trips: 0,
    clutch: 0,
    runs: 0,
    injuries: 0,
    faced: 0,
    subs: 0,             // substitutions announced
    shortStints: 0,      // logged fives no play fell in (their change shows with the next)
    flows: 0,            // flow lines checked
    skippedPlays: 0,     // see movedSince
    skippedStarters: 0,
    V: {
      onCourt: new Violations('plays whose player is not among the ten on the court'),
      box: new Violations('live box lines that differ from the box score at the final whistle'),
      breaks: new Violations('breaks where the live box does not add up to the score'),
      fouls: new Violations('team-foul counts that differ from the T in the foul text'),
      bonus: new Violations('non-shooting fouls sent to the line below the bonus'),
      clutch: new Violations('clutch banners at a score other than the one they describe'),
      runs: new Violations('run banners not on the basket that ended the run'),
      injuries: new Violations('injury banners not at the player\'s last appearance'),
      unplaced: new Violations('in-game highlights that never reach the court'),
      defender: new Violations('defenders in the play more than 3.5ft from their man'),
      faced: new Violations('shots, blocks and fouls whose defender the court does not single out'),
      pregame: new Violations('pre-game numbers that still include tonight'),
      subs: new Violations('substitutions the court gets wrong'),
      flow: new Violations('flow lines that misdraw the game or read ahead of it'),
    },
  };
}

// Every invariant that holds for any watchable game, however it's counted.
// `moved`: players to leave out of the roster-dependent checks (movedSince).
function checkGame(T, label, game, home, away, moved = NOBODY) {
  const { V } = T;
  const plays = game.playByPlay;
  // The possessions a moved player decides the side of: buildFrames tells
  // offense from defense by the team of the possession's first shot,
  // turnover or free throw, looked up in the rosters it's handed.
  const tainted = new Set();
  const decided = new Set();
  for (const p of plays) {
    if (decided.has(p.n) || !(p.k === 'shot' || p.k === 'tov' || p.k === 'ft')) continue;
    decided.add(p.n);
    if (moved.has(p.p)) tainted.add(p.n);
  }
  const frames = buildFrames(plays, game.lineups, home, away);
  const score = scoresAfter(plays);
  const homeLines = lines(game.homeBox);
  const awayLines = lines(game.awayBox);
  const sideOf = new Map([...homeLines.map((l) => [l.playerId, 'home']), ...awayLines.map((l) => [l.playerId, 'away'])]);
  T.games += 1;
  T.plays += plays.length;

  // Who's on the court: every player a play names is one of the ten drawn.
  frames.forEach((f, i) => {
    const on = new Set(f.players.map((x) => x.id));
    if (on.size !== 10) V.onCourt.add(`${where(label, plays, i)}: ${on.size} players on the court`);
    for (const role of ['p', 'a', 'v', 'd']) {
      const id = plays[i][role];
      if (id != null && !on.has(id)) V.onCourt.add(`${where(label, plays, i)}: ${role}=${id} is not on the court`);
    }
  });

  // Substitutions. Five a side at every play, and the fives come in the
  // order the sim logged them (game.lineups), none invented — one so short
  // that no play falls in it is skipped, its change showing with the next.
  // Each one the viewer announces (lineupChange) brings on as many as it
  // takes off, all of them that side's, on as the new frame has them.
  const fiveKey = (ids) => [...ids].sort((a, b) => a - b).join(',');
  for (const side of ['away', 'home']) {
    const logged = [];
    for (const ln of game.lineups ?? []) {
      const k = fiveKey(ln[side] ?? []);
      if (logged[logged.length - 1] !== k) logged.push(k);
    }
    let j = -1;
    let shown = null;
    frames.forEach((f, i) => {
      const ids = f.players.filter((x) => x.side === side).map((x) => x.id);
      if (ids.length !== 5) V.subs.add(`${where(label, plays, i)}: ${ids.length} ${side} players on the court`);
      const k = fiveKey(ids);
      if (k === shown) return;
      shown = k;
      const at = logged.indexOf(k, j + 1);
      if (at < 0) { V.subs.add(`${where(label, plays, i)}: the ${side} five [${k}] isn't a later one the sim logged`); return; }
      if (i === 0 && at !== 0) V.subs.add(`${label}: the ${side} five at tip-off isn't the first one logged`);
      T.shortStints += Math.max(0, at - (j + 1));
      j = at;
    });
  }
  for (let i = 1; i < frames.length; i++) {
    const c = lineupChange(frames[i - 1], frames[i]);
    if (!c) continue;
    T.subs += 1;
    const was = new Set(frames[i - 1].players.map((x) => x.id));
    const now = new Set(frames[i].players.map((x) => x.id));
    for (const side of ['away', 'home']) {
      if (!c[side]) continue;
      const { ins, outs } = c[side];
      const say = (msg) => V.subs.add(`${where(label, plays, i)}: ${side} in [${ins}] out [${outs}] — ${msg}`);
      if (!ins.length || ins.length !== outs.length) say('as many must come on as go off');
      if ([...ins, ...outs].some((id) => sideOf.has(id) && sideOf.get(id) !== side)) say('a player from the other team');
      if (ins.some((id) => !now.has(id) || was.has(id)) || outs.some((id) => now.has(id) || !was.has(id))) say('not who changed on the court');
    }
  }

  // The game's flow on the timeline, at the start, every 25 plays, each break
  // and the end: the step line lands on the margin after every play that
  // changed it, ends where the game is, and reads nothing past it — the same
  // with the rest of the game cut off, scale included.
  const at = new Set([0, plays.length, ...periodBreaks(plays).map((b) => b.i + 1)]);
  for (let v = 25; v < plays.length; v += 25) at.add(v);
  const margin = (v) => (v > 0 ? score[v - 1].away - score[v - 1].home : 0);
  for (const v of at) {
    T.flows += 1;
    const fl = flowLine(score, v);
    const blind = flowLine(score.slice(0, v), v);
    const say = (msg) => V.flow.add(`${label} after ${v} plays: ${msg}`);
    if (fl.d !== blind.d || fl.scale !== blind.scale) { say('changes when the plays after it are cut off'); continue; }
    let x = 0;
    let y = 0;
    let big = 0;
    let bad = null;
    for (const [, cmd, a, b] of fl.d.matchAll(/([MHV])(-?\d+)(?: (-?\d+))?/g)) {
      if (cmd === 'M') { x = +a; y = +b; } else if (cmd === 'H') {
        if (+a < x) bad ??= `runs backwards to x=${a}`;
        for (let u = x + 1; u < +a; u++) if (margin(u) !== -y) bad ??= `flat through play ${u}, where the margin is ${margin(u)}`;
        x = +a;
      } else {
        y = +a;
        if (margin(x) !== -y) bad ??= `steps to ${-y} at play ${x}, where the margin is ${margin(x)}`;
      }
    }
    for (let u = 1; u <= v; u++) big = Math.max(big, Math.abs(margin(u)));
    if (bad) say(bad);
    else if (x !== v || -y !== margin(v)) say(`ends at play ${x} on ${-y}, should end at ${v} on ${margin(v)}`);
    if (fl.scale < big || fl.scale < 10 || fl.scale % 5) say(`scale ±${fl.scale} for a biggest lead of ${big}`);
  }

  // The live box at the final whistle is the box score, column for column.
  const box = liveBox(plays, plays.length, { frames, lineups: game.lineups });
  for (const real of [...homeLines, ...awayLines]) {
    const live = box.get(real.playerId);
    const diffs = [];
    for (const k of BOX_COLS) {
      if (k === 'playerId') continue;
      const a = live?.[k] ?? 0;
      const b = real[k] ?? 0;
      if (k === 'min' ? Math.abs(a - b) > 1e-6 : a !== b) diffs.push(`${k} live ${a} vs box ${b}`);
    }
    if (diffs.length) V.box.add(`${label}: player ${real.playerId}: ${diffs.join(', ')}`);
  }
  for (const id of box.keys()) if (!sideOf.has(id)) V.box.add(`${label}: live box has player ${id}, the box score doesn't`);

  // ...and at every break it adds up to the score on the board then, and to
  // the line score.
  const qtrs = { home: game.homeQtrs ?? [], away: game.awayQtrs ?? [] };
  for (const b of periodBreaks(plays)) {
    const so = { home: 0, away: 0 };
    for (const [id, l] of liveBox(plays, b.i + 1)) if (sideOf.has(id)) so[sideOf.get(id)] += l.pts;
    const s = score[b.i];
    const linesUpTo = (side) => qtrs[side].slice(0, b.per + 1).reduce((x, y) => x + y, 0);
    if (so.home !== s.home || so.away !== s.away) V.breaks.add(`${label} end of ${b.q}: live box ${so.away}-${so.home}, scoreboard ${s.away}-${s.home}`);
    if (linesUpTo('home') !== s.home || linesUpTo('away') !== s.away) {
      V.breaks.add(`${label} end of ${b.q}: line score ${linesUpTo('away')}-${linesUpTo('home')}, scoreboard ${s.away}-${s.home}`);
    }
    if (b.final && (s.home !== game.homePts || s.away !== game.awayPts)) {
      V.breaks.add(`${label}: final play leaves ${s.away}-${s.home}, the result is ${game.awayPts}-${game.homePts}`);
    }
  }

  // Team fouls: the count after each foul is the T the sim wrote into it,
  // and a non-shooting foul only sends anyone to the line in the bonus.
  const tf = teamFoulsByPlay(plays);
  plays.forEach((p, i) => {
    if (p.k !== 'foul') return;
    T.fouls += 1;
    const m = /\(P\d+\.T(\d+)\)/.exec(p.text);
    if (!m) { V.fouls.add(`${where(label, plays, i)}: no team-foul count in the text`); return; }
    const t = +m[1];
    if (tf[i][p.side] !== t) V.fouls.add(`${where(label, plays, i)}: viewer counts ${tf[i][p.side]} ${p.side} fouls, the text says T${t}`);
    const toLine = plays[i + 1]?.k === 'ft' && plays[i + 1].p === p.v;
    if (/to the line/.test(p.text) && !toLine) V.bonus.add(`${where(label, plays, i)}: says "to the line", but no free throws follow`);
    if (!p.sf && toLine) {
      T.trips += 1;
      if (t < tf[i].bonusAt) V.bonus.add(`${where(label, plays, i)}: T${t} is below the bonus (${tf[i].bonusAt})`);
    }
  });

  // Highlights: on the play they describe.
  const { byPlay } = placeHighlights(plays, game.events);
  const placed = new Set();
  const firstOfPossession = new Map();
  plays.forEach((p, i) => { if (!firstOfPossession.has(p.n)) firstOfPossession.set(p.n, i); });
  const lastIn = (id) => {
    for (let i = plays.length - 1; i >= 0; i--) {
      const p = plays[i];
      if (p.p === id || p.a === id || p.v === id || p.d === id) return i;
    }
    return -1;
  };
  for (const [i, evs] of byPlay) {
    for (const e of evs) {
      placed.add(e);
      const s = score[i];
      if (e.k === 'clutch') {
        T.clutch += 1;
        let m;
        if ((m = /ties it at (\d+)/.exec(e.text))) {
          if (s.home !== +m[1] || s.away !== +m[1]) V.clutch.add(`${where(label, plays, i)}: "${e.text}" shown at ${s.away}-${s.home}`);
        } else if ((m = /up (\d+)-(\d+)\./.exec(e.text))) {
          const lead = s.home > s.away ? 'home' : s.away > s.home ? 'away' : null;
          if (Math.max(s.home, s.away) !== +m[1] || Math.min(s.home, s.away) !== +m[2] || lead !== e.side) {
            V.clutch.add(`${where(label, plays, i)}: "${e.text}" shown at ${s.away}-${s.home}`);
          }
        } else {
          V.clutch.add(`${label}: clutch text not understood: "${e.text}"`);
        }
      } else if (e.k === 'run') {
        // The sim stamps a run on the possession that ended it — the other
        // side's basket — so the banner lands as that basket does, with the
        // run's points scored unanswered just before it.
        T.runs += 1;
        const m = /(\d+)-0 run/.exec(e.text);
        const R = m ? +m[1] : NaN;
        const S = e.side;
        const O = otherSide(S);
        const start = firstOfPossession.get(e.n);
        const beforeIt = start > 0 ? score[start - 1] : { home: 0, away: 0 };
        let j = start - 1;
        while (j >= 0 && (j === 0 ? score[0][O] === 0 : score[j][O] === score[j - 1][O])) j--;
        const runFrom = j >= 0 ? score[j] : { home: 0, away: 0 };
        if (plays[i].n !== e.n || score[i][O] <= beforeIt[O]) {
          V.runs.add(`${where(label, plays, i)}: "${e.text}" is not on a ${O} basket`);
        } else if (beforeIt[S] - runFrom[S] !== R || beforeIt[O] !== runFrom[O]) {
          V.runs.add(`${where(label, plays, i)}: "${e.text}", but ${S} went ${runFrom[S]}→${beforeIt[S]} and ${O} ${runFrom[O]}→${beforeIt[O]} before it`);
        }
      } else if (e.k === 'injury') {
        T.injuries += 1;
        const last = lastIn(e.p);
        if (last >= 0 && last !== i) V.injuries.add(`${where(label, plays, i)}: injury to ${e.p}, whose last play is ${last}`);
      }
    }
  }
  // Every run and clutch moment reaches the court, and so does every injury
  // to a player who's in the feed (one who never is can only be placed at
  // the end of his last stint, which may fall between plays).
  for (const e of game.events ?? []) {
    const inGame = e.k === 'run' || e.k === 'clutch' || (e.k === 'injury' && lastIn(e.p) >= 0);
    if (inGame && !placed.has(e)) V.unplaced.add(`${label}: ${e.k} "${e.text}"`);
  }

  // The defender in each play is on the man he's playing against, and every
  // shot, block and foul has one.
  frames.forEach((f, i) => {
    const p = plays[i];
    if (tainted.has(p.n)) { T.skippedPlays += 1; return; }
    const want = p.k === 'shot' && p.d != null ? { actor: p.d, target: p.p, act: 'contest' }
      : p.k === 'blk' ? { actor: p.p, target: p.v, act: 'block' }
        : p.k === 'foul' && sideOf.get(p.p) === f.defSide ? { actor: p.p, target: p.v ?? null, act: 'foul' }
          : null;
    if (want) {
      T.faced += 1;
      if (f.actorId !== want.actor || f.targetId !== want.target || f.act !== want.act) {
        V.faced.add(`${where(label, plays, i)}: court shows ${f.act ?? 'nobody'} ${f.actorId}→${f.targetId}, expected ${want.act} ${want.actor}→${want.target}`);
      }
    }
    if (f.actorId == null || f.targetId == null) return;
    const a = f.players.find((x) => x.id === f.actorId);
    const t = f.players.find((x) => x.id === f.targetId);
    if (!a || !t) return; // reported above as off the court
    const d = Math.hypot(a.x - t.x, a.y - t.y);
    if (d > 3.5) V.defender.add(`${where(label, plays, i)}: ${f.act} defender ${f.actorId} is ${d.toFixed(1)}ft from ${f.targetId}`);
  });
}

// The tip-off card's numbers, against `before`: what the card should show —
// the league from before tonight, or for a replay the league as it is now.
function checkPregame(T, label, game, home, away, opts, before, moved = NOBODY) {
  const { V } = T;
  const o = { records: 'subtract', tonightInStats: true, showOut: true, ...opts };
  const pre = pregame(game, home, away, opts);
  const played = new Set([...lines(game.homeBox), ...lines(game.awayBox)].filter((l) => l.min > 0).map((l) => l.playerId));
  for (const [key, team] of [['home', home], ['away', away]]) {
    const s = pre[key];
    const b = before.teams.get(team.id);
    if (!o.records) {
      if (s.record != null) V.pregame.add(`${label}: ${team.id} shows a record (${s.record}) where none belongs`);
    } else if (b && (s.w !== b.wins || s.l !== b.losses)) {
      V.pregame.add(`${label}: ${team.id} shows ${s.w}–${s.l} at tip-off, was ${b.wins}–${b.losses}`);
    }
    const five = game.lineups?.[0]?.[key] ?? [];
    if (s.starters.map((x) => x.id).join() !== five.join()) V.pregame.add(`${label}: ${team.id} starters ${s.starters.map((x) => x.id)} vs lineup ${five}`);
    for (const st of s.starters) {
      if (moved.has(st.id)) { T.skippedStarters += 1; continue; }
      if (!st.name) V.pregame.add(`${label}: ${team.id} starter ${st.id} has no name — not on the roster handed to the viewer`);
      const pb = before.players.get(st.id);
      if (!pb) continue; // not in the league before tonight (an All-Star roster is built for the game)
      const want = pb.gp > 0 ? pb.pts / pb.gp : null;
      if ((want == null) !== (st.ppg == null) || (want != null && Math.abs(want - st.ppg) > 1e-9)) {
        V.pregame.add(`${label}: ${st.name} (${st.id}) shows ${st.ppg?.toFixed(2) ?? '—'} ppg, was ${want?.toFixed(2) ?? '—'}`);
      }
    }
    if (!o.showOut) {
      if (s.out.length) V.pregame.add(`${label}: ${team.id} lists players out (${s.out}) where none belong`);
    } else if (b) {
      // Out at tip-off: hurt before tonight, still hurt, and never on the
      // floor. Anyone who played — hurt tonight or not — was fine at tip-off.
      const want = team.roster.filter((p) => p.injury && b.injured.has(p.id) && !played.has(p.id)).map((p) => p.name).sort();
      const got = [...s.out].sort();
      if (want.join('|') !== got.join('|')) V.pregame.add(`${label}: ${team.id} out list [${got}] — expected [${want}]`);
      for (const p of team.roster) if (s.out.includes(p.name) && played.has(p.id)) V.pregame.add(`${label}: ${p.name} is listed out but played`);
    }
  }
}

// ---- Scenarios --------------------------------------------------------------------

// A month of the regular season, every game, checked as it's simmed.
function simMonth(file, days = 30) {
  const lg = load(file);
  const T = newTally();
  const R = newTally(); // the user's games again, as replays from the save
  let watchableAtEnd = 0;
  for (let d = 0; d < days && lg.phase === 'regular'; d++) {
    const before = snapshot(lg);
    const day = lg.dayIndex;
    const results = simDay(lg);
    const moved = movedSince(before, lg);
    for (const r of results) {
      const label = `day ${day} ${r.away}@${r.home}`;
      const home = getTeam(lg, r.home);
      const away = getTeam(lg, r.away);
      if (!canWatch(r)) { T.V.onCourt.add(`${label}: canWatch() says a fresh simDay result can't be watched`); continue; }
      checkGame(T, label, r, home, away, moved);
      checkPregame(T, label, r, home, away, undefined, before, moved);
    }
    // The user's game, as the save keeps it, replayed from a box score.
    const saved = (lg.resultsByDay[day] ?? []).find((g) => g.home === lg.userTeamId || g.away === lg.userTeamId);
    if (saved) {
      const label = `replay day ${day} ${saved.away}@${saved.home}`;
      if (!canWatch(saved)) { R.V.onCourt.add(`${label}: the user's game can't be watched from the save`); continue; }
      const game = forViewer(saved);
      const home = asPlayed(lg, saved.home, saved.homeBox);
      const away = asPlayed(lg, saved.away, saved.awayBox);
      checkGame(R, label, game, home, away);
      // A replay shows season averages as they stand — tonight included.
      checkPregame(R, label, game, home, away, REPLAY.pregame, snapshot(lg));
    }
  }
  // Only the user's last few games keep their play-by-play; no one else's does.
  let others = 0;
  for (const dayRes of lg.resultsByDay ?? []) {
    for (const g of dayRes ?? []) {
      const mine = g.home === lg.userTeamId || g.away === lg.userTeamId;
      if (canWatch(g)) { if (mine) watchableAtEnd += 1; else others += 1; }
    }
  }
  return { lg, T, R, watchableAtEnd, others };
}

function playoffNights(file) {
  const lg = load(file);
  const T = newTally();
  const series = new Violations('playoff cards that misstate the round, game or series');
  const ROUNDS = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];
  const kept = [];
  let nights = 0;
  for (let guard = 0; lg.playoffs && !lg.playoffs.champion && guard < 200; guard++) {
    const po = lg.playoffs;
    const open = (po.round < 3 ? [...po.East, ...po.West] : [po.finals]).filter((m) => m && !m.winner);
    if (!open.length) break;
    // A different user's team each night, so every series gets watched.
    const pick = open[nights % open.length];
    lg.userTeamId = nights % 2 ? pick.low : pick.high;
    const before = snapshot(lg);
    const played = simPlayoffGame(lg);
    nights += 1;
    const mine = played.find((x) => x.game.home === lg.userTeamId || x.game.away === lg.userTeamId);
    const label = `playoff night ${nights} ${mine ? `${mine.game.away}@${mine.game.home}` : lg.userTeamId}`;
    if (!mine || !canWatch(mine.game)) { T.V.onCourt.add(`${label}: the user's playoff game can't be watched`); continue; }
    kept.push(mine);
    const game = forViewer(mine.game);
    const home = getTeam(lg, game.home);
    const away = getTeam(lg, game.away);
    const ctx = playoffContext(lg, mine);
    checkGame(T, label, game, home, away);
    checkPregame(T, label, game, home, away, ctx.pregame, before);

    // The series as the cards tell it, against the games themselves.
    const m = mine.series;
    const n = m.games.indexOf(mine.game);
    const tally = (upto) => {
      let hi = 0;
      let lo = 0;
      for (const g of m.games.slice(0, upto)) {
        if ((g.homePts > g.awayPts) === (g.home === m.high)) hi += 1; else lo += 1;
      }
      return [hi, lo];
    };
    const name = (id) => getTeam(lg, id).name;
    const says = (text, [hi, lo], over) => {
      if (hi === 0 && lo === 0) return text == null;
      if (text == null) return false;
      const nums = `${Math.max(hi, lo)}–${Math.min(hi, lo)}`;
      if (!text.includes(nums)) return false;
      if (hi === lo) return /tied/.test(text);
      return text.startsWith(name(hi > lo ? m.high : m.low)) && (over ? /win the series/ : /lead the series/).test(text);
    };
    if (ctx.kicker !== `${ROUNDS[mine.round]} · Game ${n + 1}`) series.add(`${label}: kicker "${ctx.kicker}" for round ${mine.round}, game ${n + 1}`);
    if (!says(ctx.subtitle, tally(n), false)) series.add(`${label}: tip-off says "${ctx.subtitle}", the series stood ${tally(n)} (high–low)`);
    const over = !!m.winner && n === m.games.length - 1;
    if (!says(ctx.finalNote, tally(n + 1), over)) series.add(`${label}: final says "${ctx.finalNote}", the series is ${tally(n + 1)} (high–low)`);
  }
  return { lg, T, series, nights, kept };
}

// Shared by the play-in, the Cup and the All-Star Game: each hands back its
// games whole (`full`), with the box lines as objects.
function checkFull(T, label, entry, home, away, opts, before) {
  if (!canWatch(entry.full)) { T.V.onCourt.add(`${label}: can't be watched`); return; }
  const game = forViewer({ ...entry.full, home: entry.home, away: entry.away });
  assert(game.homeBox.length && !Array.isArray(game.homeBox[0]), `${label}: forViewer left the box encoded`);
  checkGame(T, label, game, home, away);
  checkPregame(T, label, game, home, away, opts, before);
}

// ---- The checks -------------------------------------------------------------------

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const knownGap = (n, w) => (n ? `; skipped ${plural(n, w)} involving players moved after playing that night (known issue, see movedSince)` : '');

export function headlessChecks(states) {
  // The month is shared by several checks; sim it once, when first needed.
  let month = null;
  const getMonth = () => (month ??= simMonth(states.month.file));
  const m = (fn) => () => fn(getMonth());

  return [
    {
      name: 'live box = box score at the final whistle, every BOX_COLS column (a month of games)',
      run: m(({ T }) => {
        T.V.box.assertNone();
        T.V.breaks.assertNone();
        return `${T.games} games, ${T.plays} plays; totals match the scoreboard at every break`;
      }),
    },
    {
      name: 'team fouls = the T in each foul\'s text; non-shooting fouls to the line are in the bonus',
      run: m(({ T }) => {
        T.V.fouls.assertNone();
        T.V.bonus.assertNone();
        assert(T.fouls > 1000 && T.trips > 50, `too few fouls to mean anything: ${T.fouls} fouls, ${T.trips} bonus trips`);
        return `${T.fouls} fouls, ${T.trips} non-shooting trips to the line`;
      }),
    },
    {
      name: 'placeHighlights: clutch banners at the score they describe, runs on the basket that ended them',
      run: m(({ T }) => {
        T.V.clutch.assertNone();
        T.V.runs.assertNone();
        T.V.injuries.assertNone();
        T.V.unplaced.assertNone();
        assert(T.clutch > 5 && T.runs > 20, `too few highlights to mean anything: ${T.clutch} clutch, ${T.runs} runs`);
        return `${T.clutch} clutch, ${T.runs} runs, ${T.injuries} injuries — all placed`;
      }),
    },
    {
      name: 'buildFrames: the defender in each play (actorId) is within 3.5ft of his targetId',
      run: m(({ T }) => {
        T.V.faced.assertNone();
        T.V.defender.assertNone();
        T.V.onCourt.assertNone();
        return `${T.faced} contests, blocks and fouls; every play's players on the court${knownGap(T.skippedPlays, 'play')}`;
      }),
    },
    {
      name: 'substitutions (lineupChange): five a side, the sim\'s fives in order, as many on as off',
      run: m(({ T }) => {
        T.V.subs.assertNone();
        assert(T.subs > T.games * 10, `too few substitutions to mean anything: ${T.subs} in ${T.games} games`);
        return `${T.subs} substitutions in ${T.games} games${T.shortStints ? `; ${plural(T.shortStints, 'stint')} too short for a play, shown with the next change` : ''}`;
      }),
    },
    {
      name: 'flowLine: the timeline\'s margin line lands on every margin, ends where the game is, reads nothing past it',
      run: m(({ T }) => {
        T.V.flow.assertNone();
        return `${T.flows} positions in ${T.games} games`;
      }),
    },
    {
      name: 'pregame takes tonight back out of records, averages and the injury list',
      run: m(({ T }) => {
        T.V.pregame.assertNone();
        return `${T.games * 2} records, ${T.games * 10 - T.skippedStarters} starters${knownGap(T.skippedStarters, 'starter')}`;
      }),
    },
    {
      name: 'replays from the save (canWatch, forViewer, asPlayed, REPLAY): on court, live box = box score',
      run: m(({ R, watchableAtEnd, others }) => {
        for (const v of Object.values(R.V)) v.assertNone();
        assert(R.games >= 8, `only ${R.games} of the user's games could be replayed`);
        assert(watchableAtEnd >= 1, 'no user game is watchable from the save at the end of the month');
        assert(others === 0, `${others} other teams' saved games claim to be watchable (they keep no play-by-play)`);
        return `${plural(R.games, 'replay')}; ${watchableAtEnd} still watchable at the month's end, as kept`;
      }),
    },
    {
      name: 'playoffs (canWatch, forViewer, playoffContext): on court, live box = box score, series on the cards',
      run: () => {
        const { lg, T, series, nights, kept } = playoffNights(states.playoffs.file);
        for (const v of Object.values(T.V)) v.assertNone();
        series.assertNone();
        assert(lg.playoffs?.champion, `the playoffs never finished (${nights} nights)`);
        // Replayed afterwards, from the save: the box scores are encoded now.
        const R = newTally();
        for (const e of kept.filter((x) => canWatch(x.game))) {
          checkGame(R, `playoff replay ${e.game.away}@${e.game.home}`, forViewer(e.game),
            asPlayed(lg, e.game.home, e.game.homeBox), asPlayed(lg, e.game.away, e.game.awayBox));
        }
        for (const v of Object.values(R.V)) v.assertNone();
        return `${plural(T.games, 'game')} across every round, ${plural(R.games, 'replay')} after`;
      },
    },
    {
      name: 'play-in (simPlayInGame full, forViewer): on court, live box = box score, records before tip-off',
      run: () => {
        const lg = load(states.playin.file);
        const T = newTally();
        for (let guard = 0; !lg.playIn.complete && guard < 5; guard++) {
          const before = snapshot(lg);
          for (const g of simPlayInGame(lg)) {
            // As App.jsx's handleWatchPlayIn counts it: in the standings, not in stats.
            checkFull(T, `play-in ${g.conf} ${g.game} ${g.away}@${g.home}`, g, getTeam(lg, g.home), getTeam(lg, g.away),
              { records: 'subtract', tonightInStats: false }, before);
          }
        }
        for (const v of Object.values(T.V)) v.assertNone();
        assert(T.games === 6, `expected 6 play-in games, checked ${T.games}`);
        return `${T.games} games`;
      },
    },
    {
      name: 'NBA Cup knockouts (simCupGame full, forViewer): on court, live box = box score, records as they are',
      run: () => {
        const lg = load(states.cup.file);
        const T = newTally();
        for (let guard = 0; !cupComplete(lg) && guard < 5; guard++) {
          const before = snapshot(lg);
          for (const g of simCupGame(lg)) {
            // As handleWatchCupGame counts it: in neither the standings nor stats.
            checkFull(T, `Cup ${g.label} ${g.away}@${g.home}`, g, getTeam(lg, g.home), getTeam(lg, g.away),
              { records: 'asis', tonightInStats: false }, before);
          }
        }
        for (const v of Object.values(T.V)) v.assertNone();
        assert(T.games === 7, `expected 7 Cup knockout games, checked ${T.games}`);
        return `${T.games} games`;
      },
    },
    {
      name: 'All-Star Game (simAllStarGame full, exhibition rosters): on court, live box = box score',
      run: () => {
        const lg = load(states.allstar.file);
        const T = newTally();
        const before = snapshot(lg);
        const g = simAllStarGame(lg);
        // As AllStarScreen's watch() counts it: an exhibition, in nobody's numbers.
        checkFull(T, 'All-Star Game', g, g.teams.home, g.teams.away,
          { records: false, tonightInStats: false, showOut: false }, before);
        for (const v of Object.values(T.V)) v.assertNone();
        return `${T.plays} plays`;
      },
    },
  ];
}
