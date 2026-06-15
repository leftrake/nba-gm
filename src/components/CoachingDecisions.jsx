import React from 'react';
import { getTeam } from '../engine/league.js';
import { SPECIALTY_INFO } from '../engine/coach.js';

function ratingLabel(rating) {
  if (rating >= 85) return 'Elite';
  if (rating >= 70) return 'Strong';
  if (rating >= 55) return 'Average';
  return 'Weak';
}

function CoachCard({ coach, selected, tag, onSelect }) {
  const info = SPECIALTY_INFO[coach.specialty];
  return (
    <div
      className="panel"
      style={{
        cursor: 'pointer',
        ...(selected ? { boxShadow: 'inset 0 0 0 2px var(--team-color)', background: 'var(--team-color-soft)' } : {}),
      }}
      onClick={onSelect}
    >
      {tag && <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{tag}</div>}
      <h3 style={{ marginBottom: 2 }}>{coach.name}</h3>
      <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>Age {coach.age}</div>
      <div style={{ marginBottom: 4 }}>
        <b>{info.label}</b> · {ratingLabel(coach.rating)} ({coach.rating})
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>{info.blurb}</p>
      {coach.seasonsWithTeam > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          {coach.seasonsWithTeam} season{coach.seasonsWithTeam === 1 ? '' : 's'} with the team.
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

  return (
    <div className="modal-overlay">
      <div className="modal-card wide offseason-gate">
        <h2>Coaching Decisions</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 10 }}>
          Re-sign {current.name} or bring in a new head coach for next season. Each coach brings a
          specialty that quietly shapes how your roster grows and gels.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {options.map(({ coach, tag }, i) => (
            <CoachCard key={i} coach={coach} tag={tag} selected={choice === i} onSelect={() => setChoice(i)} />
          ))}
        </div>
        <div className="controls" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button
            className="btn"
            onClick={() => {
              const picked = options[choice].coach;
              onContinue(choice === 0 ? { ...picked, seasonsWithTeam: picked.seasonsWithTeam + 1 } : { ...picked, seasonsWithTeam: 0 });
            }}
          >
            {choice === 0 ? `Re-sign ${current.name}` : `Hire ${options[choice].coach.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
