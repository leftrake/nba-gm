import React from 'react';
import { getTeam, advanceOffseason, simFreeAgencyDay, startNewSeason } from '../engine/league.js';
import { overall } from '../engine/players.js';
import { onTheClock, simDraftToUser, simDraftPick, simDraftRound, finishDraft, COMBINE_WORKOUT_SLOTS_BASE } from '../engine/draft.js';
import { initCombinePhase } from '../engine/scoutingTrips.js';
import { bumpTurmoil } from '../engine/morale.js';
import { pushNews } from '../engine/save.js';
import { TeamLink } from './TeamDisplay.jsx';
import { PlayerLink } from './PlayerDisplay.jsx';
import FinalsMVP from './FinalsMVP.jsx';
import DevelopmentReport from './DevelopmentReport.jsx';
import CoachingDecisions from './CoachingDecisions.jsx';
import DraftLottery from './DraftLottery.jsx';
import DraftCombine from './DraftCombine.jsx';
import SeasonPreview from './SeasonPreview.jsx';

const STEPS = [
  { phase: 'offseason/finals-mvp',  label: 'Championship',      icon: '🏆', desc: 'Champion crowned & Finals MVP revealed' },
  { phase: 'offseason/development', label: 'Development',       icon: '📈', desc: 'Player development over the summer' },
  { phase: 'offseason/coaching',    label: 'Coaching',          icon: '📋', desc: 'Head coaching decisions' },
  { phase: 'offseason/lottery',     label: 'Draft Lottery',     icon: '🎰', desc: 'Draft order revealed' },
  { phase: 'offseason/combine',     label: 'Pre-Draft Combine', icon: '🏋', desc: 'Evaluate prospects, run private workouts' },
  { phase: 'offseason/draft',       label: 'Draft',             icon: '🎓', desc: 'Select next-generation talent' },
  { phase: 'offseason/freeagency',  label: 'Free Agency',       icon: '✍️', desc: 'Sign and shape the roster' },
  { phase: 'offseason/preview',     label: 'Season Preview',    icon: '🏀', desc: 'Ready for tip-off' },
];

function stepStatusOf(currentPhase, stepPhase) {
  const currentIdx = STEPS.findIndex((s) => s.phase === currentPhase);
  const stepIdx = STEPS.findIndex((s) => s.phase === stepPhase);
  if (currentIdx === -1) return 'complete';
  if (stepIdx < currentIdx) return 'complete';
  if (stepIdx === currentIdx) return 'active';
  return 'upcoming';
}

// ── Completed step summaries ─────────────────────────────────────────────────

function ChampionshipSummary({ league }) {
  const champ = league.playoffs?.champion ? getTeam(league, league.playoffs.champion) : null;
  const mvp = league.finalsMVP;
  return (
    <>
      {champ
        ? <strong>{champ.city} {champ.name}</strong>
        : <span style={{ color: 'var(--muted)' }}>–</span>}
      {mvp && (
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
          Finals MVP: {mvp.name} · {mvp.ppg} ppg
        </div>
      )}
    </>
  );
}

function DevelopmentSummary({ league }) {
  const report = league.devReport;
  if (!report?.entries?.length) return <span style={{ color: 'var(--muted)' }}>No data</span>;
  const active = report.entries.filter((e) => !e.retired);
  const avg = active.reduce((s, e) => s + (e.now[0] - e.old[0]), 0) / Math.max(1, active.length);
  const breakouts = active.filter((e) => e.now[0] - e.old[0] >= 4).length;
  const declines = active.filter((e) => e.now[0] - e.old[0] <= -5).length;
  const sign = avg >= 0 ? '+' : '';
  return (
    <>
      <span>Avg {sign}{avg.toFixed(1)} OVR</span>
      {breakouts > 0 && <span style={{ color: 'var(--green)', marginLeft: 6 }}>· 🚀 {breakouts}</span>}
      {declines > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>· 📉 {declines}</span>}
    </>
  );
}

function CoachingSummary({ league }) {
  const team = getTeam(league, league.userTeamId);
  const coach = team?.coach;
  if (!coach) return <span style={{ color: 'var(--muted)' }}>–</span>;
  return (
    <>
      <strong>{coach.name}</strong>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
        Rating {coach.rating}
        {coach.seasonsWithTeam > 0 && ` · ${coach.seasonsWithTeam} season${coach.seasonsWithTeam !== 1 ? 's' : ''}`}
      </div>
    </>
  );
}

function LotterySummary({ league }) {
  const draft = league.draft;
  if (!draft) return <span style={{ color: 'var(--muted)' }}>–</span>;
  const userPick = draft.order ? draft.order.findIndex((id) => id === league.userTeamId) + 1 : 0;
  if (!userPick) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>No round-1 pick</span>;
  return <strong>Pick #{userPick}</strong>;
}

function CombineSummary({ league }) {
  const c = league.combine;
  if (!c) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>;
  const done = c.workoutsDone?.length ?? 0;
  return (
    <span style={{ fontSize: 12 }}>
      {done} workout{done !== 1 ? 's' : ''} · {c.risers?.length ?? 0} risers · {c.fallers?.length ?? 0} fallers
    </span>
  );
}

function DraftSummary({ league, openPlayer }) {
  const results = (league.draft?.results || []).filter((r) => r.teamId === league.userTeamId);
  if (!results.length) return <span style={{ color: 'var(--muted)' }}>No picks made</span>;
  const top = results[0];
  const player = [...league.teams.flatMap((t) => t.roster), ...(league.freeAgents || [])].find((p) => p.id === top.playerId);
  if (!player) return <span>{results.length} pick{results.length > 1 ? 's' : ''} made</span>;
  return (
    <>
      <PlayerLink p={player} openPlayer={openPlayer} />
      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
        {player.pos} · OVR {overall(player)} · Pick #{top.pick}
      </div>
    </>
  );
}

function FreeAgencySummary({ league }) {
  const snapshot = new Set(league.offseasonRosterSnapshot || []);
  const draftedIds = new Set((league.draft?.results || [])
    .filter((r) => r.teamId === league.userTeamId)
    .map((r) => r.playerId));
  const team = getTeam(league, league.userTeamId);
  const signings = (team?.roster || []).filter((p) => !snapshot.has(p.id) && !draftedIds.has(p.id));
  if (!signings.length) return <span style={{ color: 'var(--muted)' }}>No signings</span>;
  const top = signings.sort((a, b) => overall(b) - overall(a))[0];
  return (
    <>
      <strong>{signings.length} signing{signings.length !== 1 ? 's' : ''}</strong>
      {top && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>Top: {top.name} (OVR {overall(top)})</div>}
    </>
  );
}

// ── Active step content for Draft and Free Agency ───────────────────────────

function DraftActiveContent({ league, commit, setScreen }) {
  const clock = onTheClock(league);
  const draftDone = !clock;

  return (
    <div>
      <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
        {draftDone
          ? 'All picks are in. Finish the draft to open free agency.'
          : clock === league.userTeamId
            ? "You're on the clock — head to the Draft Room to make your selection."
            : 'Simulate picks until your turn, or jump to the Draft Room.'}
      </p>
      <div className="controls">
        {draftDone ? (
          <button className="btn" onClick={() => { finishDraft(league); commit(); setScreen('freeagency'); }}>
            Finish Draft &amp; Open Free Agency
          </button>
        ) : clock === league.userTeamId ? (
          <button className="btn" onClick={() => setScreen('draft')}>
            You're on the clock — Make Your Pick
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
            <button className="btn secondary" onClick={() => setScreen('draft')}>
              Open Draft Room
            </button>
          </>
        )}
      </div>

      {/* Show user's picks so far */}
      {(league.draft?.results || []).filter((r) => r.teamId === league.userTeamId).length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Your Picks So Far</h3>
          {(league.draft.results || []).filter((r) => r.teamId === league.userTeamId).map((r) => {
            const player = [...league.teams.flatMap((t) => t.roster), ...(league.freeAgents || [])].find((p) => p.id === r.playerId);
            return (
              <div key={r.pick} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                <span style={{ color: 'var(--muted)', minWidth: 50, fontSize: 12 }}>Pick #{r.pick}</span>
                <span>{player ? player.name : '–'}</span>
                {player && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{player.pos} · OVR {overall(player)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FreeAgencyActiveContent({ league, commit, setScreen }) {
  const daysLeft = league.faDaysLeft ?? 0;
  const isLast = daysLeft <= 1;

  return (
    <div>
      <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
        {daysLeft > 0
          ? `${daysLeft} signing period${daysLeft !== 1 ? 's' : ''} remaining. Browse available players and make offers, then sim to the next round.`
          : 'Free agency is wrapping up.'}
      </p>
      <div className="controls">
        <button className="btn" onClick={() => { simFreeAgencyDay(league); commit(); }}>
          {isLast ? 'Finish Free Agency' : `Next FA Round (${daysLeft} left)`}
        </button>
        <button className="btn secondary" onClick={() => setScreen('freeagency')}>
          Browse Free Agents
        </button>
      </div>
    </div>
  );
}

// ── Step Stepper ─────────────────────────────────────────────────────────────

function Stepper({ currentPhase }) {
  return (
    <div className="offseason-stepper">
      {STEPS.map((step, i) => {
        const status = stepStatusOf(currentPhase, step.phase);
        return (
          <React.Fragment key={step.phase}>
            <div className={`offseason-step offseason-step--${status}`}>
              <div className="offseason-step-bubble">
                {status === 'complete' ? '✓' : step.icon}
              </div>
              <div className="offseason-step-name">{step.label}</div>
            </div>
            {i < STEPS.length - 1 && (() => {
              const nextStatus = stepStatusOf(currentPhase, STEPS[i + 1].phase);
              const connClass = status === 'complete' && nextStatus === 'complete'
                ? 'offseason-step-connector--done'
                : status === 'complete'
                  ? 'offseason-step-connector--partial'
                  : 'offseason-step-connector--pending';
              return <div className={`offseason-step-connector ${connClass}`} />;
            })()}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Main Hub ─────────────────────────────────────────────────────────────────

export default function OffseasonHub({ league, commit, openPlayer, openTeam, setScreen }) {
  const userTeam = getTeam(league, league.userTeamId);
  const currentIdx = STEPS.findIndex((s) => s.phase === league.phase);

  const handleFinalsMVPContinue = () => {
    advanceOffseason(league);
    commit();
  };

  const handleDevelopmentContinue = () => {
    league.phase = 'offseason/coaching';
    commit();
  };

  const handleCoachingContinue = (coach) => {
    const team = getTeam(league, league.userTeamId);
    if (team.coach && coach.name !== team.coach.name) {
      bumpTurmoil(team, 2);
      pushNews(league, {
        day: league.dayIndex, season: league.season, phase: league.phase,
        category: 'coaching', teamIds: [team.id],
        text: `${team.city} ${team.name} part ways with coach ${team.coach.name} and hire ${coach.name} as the new head coach.`,
      });
    }
    team.coach = coach;
    league.phase = 'offseason/lottery';
    commit();
  };

  const handleLotteryContinue = () => {
    initCombinePhase(league);
    league.phase = 'offseason/combine';
    commit();
  };

  const handleCombineContinue = () => {
    league.phase = 'offseason/draft';
    commit();
    setScreen('draft');
  };

  const handlePreviewStart = () => {
    startNewSeason(league);
    commit();
    setScreen('dashboard');
  };

  const completedSteps = STEPS.slice(0, Math.max(0, currentIdx));
  const activeStep = currentIdx >= 0 ? STEPS[currentIdx] : null;
  const upcomingSteps = currentIdx >= 0 ? STEPS.slice(currentIdx + 1) : [];

  return (
    <div className="offseason-hub">
      {/* Header */}
      <div className="offseason-hub-header">
        <div>
          <div className="offseason-hub-title">{league.season} Offseason</div>
          <div className="offseason-hub-meta">
            {userTeam.city} {userTeam.name} · {userTeam.wins}–{userTeam.losses}
          </div>
        </div>
        <div className="offseason-hub-record">{userTeam.wins}–{userTeam.losses}</div>
      </div>

      {/* Step stepper */}
      <Stepper currentPhase={league.phase} />

      {/* Completed step summaries */}
      {completedSteps.length > 0 && (
        <div className="offseason-completed-grid">
          {completedSteps.map((step) => (
            <div key={step.phase} className="offseason-summary-card">
              <div className="offseason-summary-header">
                <span style={{ fontSize: 13 }}>{step.icon}</span>
                <span className="offseason-summary-label">{step.label}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--color-success)', fontSize: 11 }}>✓</span>
              </div>
              <div className="offseason-summary-content">
                {step.phase === 'offseason/finals-mvp'  && <ChampionshipSummary league={league} />}
                {step.phase === 'offseason/development' && <DevelopmentSummary league={league} />}
                {step.phase === 'offseason/coaching'    && <CoachingSummary league={league} />}
                {step.phase === 'offseason/lottery'     && <LotterySummary league={league} />}
                {step.phase === 'offseason/combine'     && <CombineSummary league={league} />}
                {step.phase === 'offseason/draft'       && <DraftSummary league={league} openPlayer={openPlayer} />}
                {step.phase === 'offseason/freeagency'  && <FreeAgencySummary league={league} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active step */}
      {activeStep && (
        <div className="offseason-active-card">
          <div className="offseason-active-header">
            <span className="offseason-active-icon">{activeStep.icon}</span>
            <span className="offseason-active-title">{activeStep.label}</span>
            <span className="offseason-active-badge">Now</span>
          </div>
          <div className="offseason-active-body">
            {league.phase === 'offseason/finals-mvp' && (
              <FinalsMVP
                league={league}
                openPlayer={openPlayer}
                openTeam={openTeam}
                onContinue={handleFinalsMVPContinue}
                embedded
              />
            )}
            {league.phase === 'offseason/development' && (
              <DevelopmentReport
                league={league}
                openPlayer={openPlayer}
                onContinue={handleDevelopmentContinue}
                embedded
              />
            )}
            {league.phase === 'offseason/coaching' && (
              <CoachingDecisions
                league={league}
                onContinue={handleCoachingContinue}
                embedded
              />
            )}
            {league.phase === 'offseason/lottery' && (
              <DraftLottery
                league={league}
                openTeam={openTeam}
                onContinue={handleLotteryContinue}
                embedded
              />
            )}
            {league.phase === 'offseason/combine' && (
              <DraftCombine
                league={league}
                commit={commit}
                onContinue={handleCombineContinue}
              />
            )}
            {league.phase === 'offseason/draft' && (
              <DraftActiveContent league={league} commit={commit} setScreen={setScreen} />
            )}
            {league.phase === 'offseason/freeagency' && (
              <FreeAgencyActiveContent league={league} commit={commit} setScreen={setScreen} />
            )}
            {league.phase === 'offseason/preview' && (
              <SeasonPreview
                league={league}
                openPlayer={openPlayer}
                onStart={handlePreviewStart}
                embedded
              />
            )}
          </div>
        </div>
      )}

      {/* Upcoming steps */}
      {upcomingSteps.length > 0 && (
        <div className="offseason-upcoming-row">
          {upcomingSteps.map((step) => (
            <div key={step.phase} className="offseason-upcoming-badge">
              <span>{step.icon}</span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
