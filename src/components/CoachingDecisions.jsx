import React from 'react';
import { getTeam } from '../engine/league.js';
import { SPECIALTY_INFO, STYLE_INFO, coachSalary } from '../engine/coach.js';
import { rosterFit } from '../engine/sim.js';

function ratingLabel(rating) {
  if (rating >= 85) return 'Elite';
  if (rating >= 70) return 'Strong';
  if (rating >= 55) return 'Average';
  return 'Weak';
}

function fmtSalary(salary) {
  return `$${(salary / 1_000_000).toFixed(1)}M`;
}

// Returns a { label, color } descriptor for a [0..1] fit value.
function fitDesc(fit) {
  if (fit === null) return { label: 'Universal', color: 'var(--text-muted)', pct: null };
  if (fit >= 0.75) return { label: 'Excellent', color: 'var(--color-success)', pct: Math.round(fit * 100) };
  if (fit >= 0.5)  return { label: 'Good',      color: 'var(--green)',         pct: Math.round(fit * 100) };
  if (fit >= 0.25) return { label: 'Below avg',  color: 'var(--yellow)',        pct: Math.round(fit * 100) };
  return                   { label: 'Poor',      color: 'var(--color-danger)',  pct: Math.round(fit * 100) };
}

function FitBar({ fit }) {
  const { label, color, pct } = fitDesc(fit);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Roster fit</span>
        <span style={{ fontSize: 'var(--text-sm)', color, fontWeight: 'var(--weight-bold)' }}>
          {label}{pct !== null ? ` (${pct}%)` : ''}
        </span>
      </div>
      {pct !== null && (
        <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.15s' }} />
        </div>
      )}
    </div>
  );
}

function CoachCard({ coach, fit, selected, tag, onSelect }) {
  const specInfo = SPECIALTY_INFO[coach.specialty];
  const styleInfo = STYLE_INFO[coach.style ?? 'balanced'];
  const salary = coach.salary ?? coachSalary(coach.rating);
  return (
    <div
      className="panel"
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-2)',
        ...(selected ? { boxShadow: 'inset 0 0 0 2px var(--team-color-safe)', background: 'var(--team-color-soft)' } : {}),
      }}
      onClick={onSelect}
    >
      {tag && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {tag}
        </div>
      )}
      <div>
        <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-base)' }}>{coach.name}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Age {coach.age}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Specialty: </span>
          <b>{specInfo.label}</b>
        </div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Style: </span>
          <b>{styleInfo.label}</b>
        </div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Rating: </span>
          <b>{ratingLabel(coach.rating)} ({coach.rating})</b>
        </div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Salary: </span>
          <b>{fmtSalary(salary)}/yr</b>
          <span style={{ color: 'var(--text-muted)' }}> · not cap-counted</span>
        </div>
      </div>

      <FitBar fit={fit} />

      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>{styleInfo.blurb}</p>

      {coach.seasonsWithTeam > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
          {coach.seasonsWithTeam} season{coach.seasonsWithTeam === 1 ? '' : 's'} with the team
        </p>
      )}
    </div>
  );
}

// Offseason phase between the Development Report and the Draft Lottery: the
// user re-signs their current head coach or hires one of two fresh
// candidates (league.coachCandidates, generated in advanceOffseason).
// AI teams make this call automatically.
export default function CoachingDecisions({ league, onContinue }) {
  const team = getTeam(league, league.userTeamId);
  const current = team.coach;
  const candidates = league.coachCandidates || [];
  const options = [
    { coach: current, tag: 'Retain' },
    ...candidates.map((c) => ({ coach: c, tag: 'Candidate' })),
  ];
  const [choice, setChoice] = React.useState(0);

  // Pre-compute fit for every option against the current roster.
  const fits = options.map(({ coach }) => rosterFit(team, coach.style ?? 'balanced'));

  // Find which non-balanced style the roster is best suited for (for context display).
  const activeStyles = ['pace-and-space', 'defensive', 'grind-it-out'];
  const styleFits = activeStyles.map((s) => ({ style: s, fit: rosterFit(team, s) }));
  const bestStyle = styleFits.reduce((best, curr) => curr.fit > best.fit ? curr : best);
  const bestStyleFitDesc = fitDesc(bestStyle.fit);

  return (
    <div className="modal-overlay">
      <div className="modal-card wide offseason-gate">
        <h2>Coaching Decisions</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
          Re-sign {current.name} or bring in a new head coach for next season.
          Scheme fit affects in-game shot selection and pace — but talent dominates.
        </p>

        {/* Roster profile context */}
        <div className="panel" style={{ marginBottom: 'var(--sp-4)', background: 'var(--bg-1)' }}>
          <div style={{ fontWeight: 'var(--weight-bold)', marginBottom: 'var(--sp-1)' }}>Your roster profile</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
            Best-suited scheme:{' '}
            <b style={{ color: bestStyleFitDesc.color }}>{STYLE_INFO[bestStyle.style].label}</b>
            {' '}({bestStyleFitDesc.pct}% fit)
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            {styleFits.map(({ style, fit }) => {
              const fd = fitDesc(fit);
              return (
                <div key={style} style={{ fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{STYLE_INFO[style].label}: </span>
                  <b style={{ color: fd.color }}>{fd.pct}%</b>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--sp-3)' }}>
          {options.map(({ coach, tag }, i) => (
            <CoachCard
              key={i}
              coach={coach}
              fit={fits[i]}
              tag={tag}
              selected={choice === i}
              onSelect={() => setChoice(i)}
            />
          ))}
        </div>
        <div className="controls" style={{ justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
          <button
            className="btn"
            onClick={() => {
              const picked = options[choice].coach;
              onContinue(choice === 0
                ? { ...picked, seasonsWithTeam: picked.seasonsWithTeam + 1 }
                : { ...picked, seasonsWithTeam: 0 });
            }}
          >
            {choice === 0 ? `Re-sign ${current.name}` : `Hire ${options[choice].coach.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
