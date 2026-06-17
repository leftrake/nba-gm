import React, { useState, useEffect } from 'react';
import { getTeam } from '../engine/league.js';
import { LOTTERY_WEIGHTS } from '../engine/draft.js';
import { TeamLink } from './shared.jsx';

const REVEAL_DELAY_MS = 1400;

// Third offseason phase: league.draft.order (round 1) was already resolved
// by initDraft inside advanceOffseason, including the weighted lottery for
// picks 1-4. This screen just reveals that order dramatically — envelope
// style, pick 4 down to pick 1 — then shows the rest of round 1 instantly.
export default function DraftLottery({ league, openTeam, onContinue }) {
  const draft = league.draft;
  const order = draft?.order?.slice(0, 30) ?? [];
  const [revealed, setRevealed] = useState(0); // how many of picks 4..1 are shown

  useEffect(() => {
    if (revealed >= 4) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), REVEAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  if (!draft || order.length < 30) {
    return (
      <div className="modal-overlay">
        <div className="modal-card offseason-gate">
          <h2>Draft Lottery</h2>
          <p style={{ color: 'var(--muted)' }}>No draft order available yet.</p>
          <div className="controls"><button className="btn" onClick={onContinue}>Continue</button></div>
        </div>
      </div>
    );
  }

  const byRecord = [...league.teams].sort((a, b) => (a.lastWins ?? 41) - (b.lastWins ?? 41));
  const lotteryTeams = byRecord.slice(0, 14);
  const userInLottery = lotteryTeams.some((t) => t.id === league.userTeamId);

  const envelopes = order.slice(0, 4); // picks 1-4, in pick order
  const rest = order.slice(4, 30); // picks 5-30
  const allRevealed = revealed >= 4;

  return (
    <div className="modal-overlay">
      <div className="modal-card wide offseason-gate">
        <h2>Draft Lottery — {draft.season}</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 12 }}>
          The 14 lottery teams, weighted by record.{' '}
          {userInLottery && <strong style={{ color: 'var(--team-color-safe)' }}>You're in the lottery this year.</strong>}
        </p>

        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table>
            <thead><tr><th>Team</th><th className="num">Record</th><th className="num">Odds</th></tr></thead>
            <tbody>
              {lotteryTeams.map((t, i) => (
                <tr key={t.id} style={t.id === league.userTeamId ? { boxShadow: 'inset 3px 0 0 var(--team-color-safe)', background: 'var(--panel2)' } : undefined}>
                  <td><TeamLink team={t} openTeam={openTeam} /></td>
                  <td className="num">{t.lastWins ?? '–'}-{t.lastWins != null ? 82 - t.lastWins : '–'}</td>
                  <td className="num">{(LOTTERY_WEIGHTS[i] / 10).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBottom: 8 }}>The Envelopes</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {[3, 2, 1, 0].map((slotIdx, i) => {
            const pickNo = slotIdx + 1;
            const teamId = envelopes[slotIdx];
            const isRevealed = revealed > i;
            const team = teamId ? getTeam(league, teamId) : null;
            const isUser = teamId === league.userTeamId;
            return (
              <div
                key={pickNo}
                className="panel"
                style={{ textAlign: 'center', padding: 16, ...(isUser ? { boxShadow: 'inset 0 0 0 2px var(--team-color-safe)' } : {}) }}
              >
                <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>Pick #{pickNo}</div>
                {isRevealed && team ? (
                  <div style={{ fontWeight: 600 }}>
                    <TeamLink team={team} openTeam={openTeam}>{team.city} {team.name}</TeamLink>
                  </div>
                ) : (
                  <div style={{ fontSize: 28 }}>✉️</div>
                )}
              </div>
            );
          })}
        </div>

        {allRevealed && (
          <>
            <h3 style={{ marginBottom: 8 }}>Picks 5–30</h3>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table>
                <thead><tr><th className="num">Pick</th><th>Team</th></tr></thead>
                <tbody>
                  {rest.map((id, i) => {
                    const t = getTeam(league, id);
                    return (
                      <tr key={i} style={id === league.userTeamId ? { boxShadow: 'inset 3px 0 0 var(--team-color-safe)', background: 'var(--panel2)' } : undefined}>
                        <td className="num">{i + 5}</td>
                        <td><TeamLink team={t} openTeam={openTeam} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="controls" style={{ justifyContent: 'center' }}>
          {!allRevealed && <button className="btn secondary" onClick={() => setRevealed(4)}>Skip Animation</button>}
          <button className="btn" onClick={onContinue} disabled={!allRevealed}>Continue to Draft</button>
        </div>
      </div>
    </div>
  );
}
