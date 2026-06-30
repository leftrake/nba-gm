import React, { useEffect } from 'react';
import { injuryTimeline } from '../engine/injuries.js';
import { coachTalkQuote, COACH_TALK_OPTIONS } from '../engine/coachTalk.js';

// Proactive "someone got hurt" popup — shared by the regular-season Calendar
// sim loop and the playoff sim handlers in App.jsx, since the user's own
// player getting hurt is the one result worth interrupting a fast-forward for.
export function InjuryAlertModal({ alert, onClose, onGoToRoster }) {
  if (!alert) return null;
  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">🩹 Injury Update</div>
        </div>
        {alert.injured.map((p) => (
          <p key={`hurt-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
            <b>{p.name}</b> ({p.pos}) goes down with {p.injury.type.toLowerCase()} —{' '}
            <span style={{ color: 'var(--color-danger)' }}>{injuryTimeline(p.injury)}</span>.
          </p>
        ))}
        {alert.returned.map((p) => (
          <p key={`back-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
            <b>{p.name}</b> ({p.pos}) is <span style={{ color: 'var(--color-success)' }}>back and available</span> for tonight's game.
          </p>
        ))}
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>You may want to adjust your rotation before the next game.</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button className="ui-btn ui-btn--primary ui-btn--md" onClick={onGoToRoster}>Go to Roster</button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={onClose}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

export function CoachTalkModal({ league, team, onResolve }) {
  const talk = team?.pendingCoachTalk;
  const quote = talk ? coachTalkQuote(league, team, talk) : null;
  // If the flagged player was traded/waived before the GM responded, the
  // conversation is moot — auto-clear it rather than leaving the sim
  // controls stuck disabled with no modal to resolve.
  useEffect(() => {
    if (talk && !quote) onResolve('dismiss');
  }, [talk, quote]);
  if (!talk || !quote) return null;
  return (
    <div className="ui-modal-overlay">
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">🗣️ A Word From the Coach</div>
        </div>
        <p style={{ marginBottom: 'var(--sp-4)' }}>{quote}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {COACH_TALK_OPTIONS[talk.cause].map((opt) => (
            <button key={opt.id} className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => onResolve(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MilestoneAlertModal({ team, onClose }) {
  const alert = team?.pendingMilestoneAlert;
  if (!alert) return null;
  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">📈 Heads Up</div>
        </div>
        <p style={{ marginBottom: 'var(--sp-4)' }}>{alert.text}</p>
        <button className="ui-btn ui-btn--primary ui-btn--md" onClick={onClose}>Nice!</button>
      </div>
    </div>
  );
}

export function CallUpPromptModal({ team, onResolve }) {
  const prompt = team?.pendingCallUpPrompt;
  if (!prompt) return null;
  return (
    <div className="ui-modal-overlay">
      <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">
          <div className="ui-modal-title">📞 Call From the G League</div>
        </div>
        <p style={{ marginBottom: 'var(--sp-4)' }}>{prompt.text}</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button className="ui-btn ui-btn--primary ui-btn--md" onClick={() => onResolve(true)}>Call him up</button>
          <button className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => onResolve(false)}>Leave him down</button>
        </div>
      </div>
    </div>
  );
}
