import React, { useEffect, useState, useCallback } from 'react';
import { TEAMS } from '../data/teams.js';
import { markWalkthroughDone } from './shared.jsx';

function makeSteps(league) {
  const team = league ? TEAMS.find((t) => t.id === league.userTeamId) : null;
  const teamName = team ? `${team.city} ${team.name}` : 'your team';
  const fog = league?.settings?.difficulty?.scoutingFog;
  const fogNote = fog === 'off'
    ? 'You turned scouting fog off, so all ratings show exact values.'
    : fog === 'heavy'
    ? 'You chose heavy scouting fog — opponents show wide rating ranges until you invest in film and scouting trips.'
    : 'Players on other teams and in free agency show uncertain ranges until you scout them — more scouting narrows the window.';

  return [
    {
      tour: null,
      title: `Welcome to the ${teamName}`,
      text: `You're now GM. Build the roster, manage the cap, keep the owner happy, win a championship. Here's a quick tour of the six things you need to know.`,
    },
    {
      tour: 'sim-controls',
      title: 'Advance the Season',
      text: 'Sim Day plays to your next game result — watch the score come in. Sim Week moves faster when you want to cover ground. The regular season is 82 games; you control the pace.',
    },
    {
      tour: 'roster-tab',
      title: 'Your Roster',
      text: `Your own players always show exact ratings. ${fogNote} Use the Roster screen for lineup management, injury tracking, and contract details.`,
    },
    {
      tour: 'cap-bar',
      title: 'Salary Cap',
      text: 'The league cap is $141M. Go over it and you pay luxury tax — manageable once, painful repeatedly. Push past the second apron ($192M) and certain moves get blocked entirely.',
    },
    {
      tour: 'futurecap-nav',
      title: 'Front Office',
      text: "The Front Office tab shows your owner's approval rating, budget, and directives. Miss expectations too often and you get fired. Meet them and your budget grows — check it before spending big.",
    },
    {
      tour: 'trade-nav',
      title: 'Trades & Free Agency',
      text: 'Pitch deals in the Trade screen. Sign free agents from the Free Agency tab (active in the offseason). Other teams will also send you offers — they show up on the Dashboard as trade proposals.',
    },
    {
      tour: 'scouting-tab',
      fallback: 'news-feed',
      title: 'Draft & Scouting',
      text: 'Each offseason you get a budget to scout prospects before the draft. The more missions you run on a player, the tighter his rating window gets. Undrafted gems exist — find them before other GMs do.',
    },
  ];
}

function findTarget(step) {
  if (!step?.tour) return null;
  return (
    document.querySelector(`[data-tour="${step.tour}"]`)
    || (step.fallback ? document.querySelector(`[data-tour="${step.fallback}"]`) : null)
  );
}

const CARD_W = 340;
const MARGIN = 12;

export default function Walkthrough({ league, onDone }) {
  const steps = makeSteps(league);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const isDone = stepIdx >= steps.length;
  const current = steps[Math.min(stepIdx, steps.length - 1)];

  const measureTarget = useCallback(() => {
    if (stepIdx >= steps.length) { setRect(null); return; }
    const el = findTarget(steps[stepIdx]);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [stepIdx, steps.length]);

  useEffect(() => {
    if (stepIdx >= steps.length) { setRect(null); return; }
    const el = findTarget(steps[stepIdx]);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    measureTarget();
    const t = setTimeout(measureTarget, 350);
    window.addEventListener('resize', measureTarget);
    window.addEventListener('scroll', measureTarget, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measureTarget);
      window.removeEventListener('scroll', measureTarget, true);
    };
  }, [stepIdx, measureTarget]);

  const finish = () => { markWalkthroughDone(); onDone(); };
  const next = () => stepIdx < steps.length ? setStepIdx((s) => s + 1) : finish();
  const prev = () => setStepIdx((s) => Math.max(0, s - 1));

  // Position card below the spotlight; flip above if out of bounds
  let cardStyle;
  if (rect && !isDone) {
    let top = rect.bottom + 14;
    if (top + 210 > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, rect.top - 210 - 14);
    }
    let left = rect.left;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - CARD_W - MARGIN);
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: CARD_W };
  }

  return (
    <>
      {rect && !isDone ? (
        <div
          className="walkthrough-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div className="walkthrough-backdrop" />
      )}

      {!isDone && (
        <button className="walkthrough-skip" onClick={finish}>Skip tour</button>
      )}

      <div className="walkthrough-card" key={stepIdx} style={cardStyle}>
        {isDone ? (
          <>
            <div className="walkthrough-done-check">✓</div>
            <h3 style={{ margin: '0 0 8px' }}>You're ready, GM</h3>
            <p>Trade deadlines, extension windows, owner blowups — the rest reveals itself as you play. Check tooltips if you get stuck. Good luck.</p>
            <button className="btn" onClick={finish}>Start Managing</button>
          </>
        ) : (
          <>
            <div className="walkthrough-meta">
              <span className="walkthrough-counter">{stepIdx + 1} / {steps.length}</span>
              <div className="walkthrough-dots">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={`walkthrough-dot${i === stepIdx ? ' active' : i < stepIdx ? ' done' : ''}`}
                  />
                ))}
              </div>
            </div>
            <h3 style={{ margin: '0 0 8px' }}>{current.title}</h3>
            <p style={{ margin: '0 0 14px' }}>{current.text}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {stepIdx > 0 && (
                <button className="btn secondary" onClick={prev} style={{ fontSize: 12, padding: '4px 10px' }}>← Back</button>
              )}
              <button className="btn" onClick={next}>
                {stepIdx === steps.length - 1 ? 'Done →' : 'Next →'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
