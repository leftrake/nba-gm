import React, { useState } from 'react';
import { scoutedOverallRange, scoutedOverall, scoutedPotential, scoutUncertainty, isHidden, getDraftPoints } from '../engine/scouting.js';
import { isDiscovered, runCombineWorkout, DRAFT_POINTS_MAX } from '../engine/scoutingTrips.js';
import { COMBINE_WORKOUT_SLOTS_BASE } from '../engine/draft.js';
import { Ovr, Pot, PlayerLink, Origin } from './PlayerDisplay.jsx';
import { Badge, Button, Section, SectionHeader, Tabs, ProgressBar } from './ui/index.js';

function feetIn(inches) {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function athleticTier(score) {
  if (score >= 75) return { label: 'Elite',      variant: 'success' };
  if (score >= 55) return { label: 'Good',       variant: 'warning' };
  if (score >= 35) return { label: 'Average',    variant: 'default' };
  return                  { label: 'Below Avg',  variant: 'danger'  };
}

function mockSlotLabel(rank) {
  const pick = rank + 1;
  if (pick <= 5)  return { label: 'Top 5',     color: '#c9a227' };
  if (pick <= 14) return { label: 'Lottery',   color: 'var(--color-warning)' };
  if (pick <= 20) return { label: 'Mid-1st',   color: 'var(--text-primary)' };
  if (pick <= 30) return { label: 'Late-1st',  color: 'var(--text-secondary)' };
  if (pick <= 45) return { label: 'Early 2nd', color: 'var(--text-muted)' };
  return                 { label: '2nd Round', color: 'var(--text-muted)' };
}

// ---- Risers / Fallers summary cards ----

function RiserFallerCards({ prospects, combine, league }) {
  const userId = league.userTeamId;
  const risers  = (combine.risers  ?? []).map((id) => prospects.find((p) => p.id === id)).filter(Boolean).slice(0, 5);
  const fallers = (combine.fallers ?? []).map((id) => prospects.find((p) => p.id === id)).filter(Boolean).slice(0, 5);

  if (!risers.length && !fallers.length) return null;

  const RiserRow = ({ p }) => {
    const m = combine.measurables?.[p.id];
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
        <div>
          <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>{p.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginLeft: 6 }}>{p.pos} · {combine.archetypes?.[p.id] ?? p.pos}</span>
        </div>
        {m && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{m.verticalIn}" vert</span>}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
      {risers.length > 0 && (
        <div style={{ background: 'var(--color-success-soft)', border: '1px solid var(--color-success-line)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)' }}>
          <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)', color: 'var(--color-success)', marginBottom: 'var(--sp-2)' }}>
            ▲ Combine Risers
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
            Athletic testing exceeded board expectations
          </div>
          {risers.map((p) => <RiserRow key={p.id} p={p} />)}
        </div>
      )}
      {fallers.length > 0 && (
        <div style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)' }}>
          <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)', color: 'var(--color-danger)', marginBottom: 'var(--sp-2)' }}>
            ▼ Combine Fallers
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
            Athletic testing below board expectations
          </div>
          {fallers.map((p) => <RiserRow key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}

// ---- Tab 1: Combine Measurables ----

function CombineTab({ prospects, combine, league }) {
  const userId = league.userTeamId;

  const sorted = [...prospects].sort((a, b) => {
    const aRank = combine.mockDraft?.indexOf(a.id) ?? 999;
    const bRank = combine.mockDraft?.indexOf(b.id) ?? 999;
    return aRank - bRank;
  });

  return (
    <>
      <RiserFallerCards prospects={prospects} combine={combine} league={league} />
      <div className="ui-table-wrap">
        <table className="ui-table zebra" style={{ fontSize: 'var(--text-xs)' }}>
          <thead>
            <tr>
              <th className="num" title="Consensus mock draft rank">#</th>
              <th>OVR</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Age</th>
              <th>Archetype</th>
              <th title="Height">Ht</th>
              <th title="Wingspan">Wing</th>
              <th title="Vertical jump">Vert</th>
              <th title="Bench press reps">Str</th>
              <th title="Athletic composite score">Ath</th>
              <th className="num">Scout%</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const m   = combine.measurables?.[p.id];
              const arc = combine.archetypes?.[p.id] ?? '—';
              const pts = getDraftPoints(p, userId);
              const pct = Math.round((pts / DRAFT_POINTS_MAX) * 100);
              const isRiser  = combine.risers?.includes(p.id);
              const isFaller = combine.fallers?.includes(p.id);
              const ath = m ? athleticTier(m.athleticComposite) : null;
              return (
                <tr key={p.id}>
                  <td className="num" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td><Ovr p={p} league={league} fogged /></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <PlayerLink p={p} />
                      {isRiser  && <Badge variant="success" pill style={{ fontSize: 10, padding: '1px 5px' }}>▲</Badge>}
                      {isFaller && <Badge variant="danger"  pill style={{ fontSize: 10, padding: '1px 5px' }}>▼</Badge>}
                    </span>
                  </td>
                  <td>{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{arc}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{m ? feetIn(m.heightIn) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{m ? feetIn(m.wingspanIn) : '—'}</td>
                  <td>{m ? `${m.verticalIn}"` : '—'}</td>
                  <td>{m ? `${m.strengthReps}` : '—'}</td>
                  <td>
                    {ath ? <Badge variant={ath.variant} pill style={{ fontSize: 10 }}>{ath.label}</Badge> : '—'}
                  </td>
                  <td className="num">
                    <span style={{ color: pct >= 80 ? 'var(--color-success)' : pct >= 40 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
                      {pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- Tab 2: Private Workouts ----

function WorkoutsTab({ prospects, combine, league, commit }) {
  const userId = league.userTeamId;
  const slotsUsed  = combine.workoutsDone?.length ?? 0;
  const slotsTotal = (combine.workoutSlots ?? 0) + slotsUsed;
  const reports    = (league.scouting?.reports?.[userId] ?? []).filter((r) => combine.workoutsDone?.includes(r.playerId));

  const invite = (p) => {
    const res = runCombineWorkout(league, userId, p.id);
    if (res.ok) commit();
    else alert(res.error);
  };

  const invitable = prospects.filter((p) =>
    isDiscovered(p, userId, league) && !combine.workoutsDone?.includes(p.id)
  );
  const done = prospects.filter((p) => combine.workoutsDone?.includes(p.id));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)', padding: 'var(--sp-3)', background: 'var(--panel-alt)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)' }}>
            {combine.workoutSlots} slot{combine.workoutSlots !== 1 ? 's' : ''} remaining
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {slotsUsed} of {slotsTotal} used · Private workouts reveal +{50} scouting points
            {slotsTotal > COMBINE_WORKOUT_SLOTS_BASE && (
              <span style={{ color: 'var(--color-warning)', marginLeft: 6 }}>+2 from Big Board Analyst</span>
            )}
          </div>
        </div>
      </div>

      {invitable.length > 0 && (
        <>
          <SectionHeader title="Available Invitations" />
          <div className="ui-table-wrap">
            <table className="ui-table zebra" style={{ fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr>
                  <th>OVR</th><th>Player</th><th>Pos</th><th>Age</th><th>Archetype</th><th className="num">Scout%</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invitable.map((p) => {
                  const pts = getDraftPoints(p, userId);
                  const pct = Math.round((pts / DRAFT_POINTS_MAX) * 100);
                  const arc = combine.archetypes?.[p.id] ?? '—';
                  return (
                    <tr key={p.id}>
                      <td><Ovr p={p} league={league} fogged /></td>
                      <td><PlayerLink p={p} /></td>
                      <td>{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{arc}</td>
                      <td className="num" style={{ color: pct >= 80 ? 'var(--color-success)' : 'var(--text-muted)' }}>{pct}%</td>
                      <td>
                        <Button
                          size="sm" variant="primary"
                          disabled={combine.workoutSlots <= 0}
                          onClick={() => invite(p)}
                        >
                          Invite
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {done.length > 0 && (
        <>
          <SectionHeader title="Completed Workouts" style={{ marginTop: 'var(--sp-4)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {done.map((p) => {
              const report = reports.find((r) => r.playerId === p.id);
              return (
                <div key={p.id} style={{ padding: 'var(--sp-3)', background: 'var(--panel-alt)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: report ? 'var(--sp-2)' : 0 }}>
                    <Badge variant="success" pill style={{ fontSize: 10 }}>✓</Badge>
                    <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>{p.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{p.pos} · {combine.archetypes?.[p.id] ?? ''}</span>
                  </div>
                  {report && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>{report.text}</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {invitable.length === 0 && done.length === 0 && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--sp-6)' }}>
          No discovered prospects available to invite. Scout additional regions to unlock more prospects.
        </p>
      )}
    </>
  );
}

// ---- Tab 3: Mock Draft Board ----

function MockDraftTab({ prospects, combine, league }) {
  const userId = league.userTeamId;
  const mockOrder = combine.mockDraft ?? [];

  // Build user's board ranking for comparison using the same formula as Draft.jsx big board
  const userRankByPid = {};
  [...prospects]
    .sort((a, b) =>
      (scoutedOverall(b, league.season, userId) + scoutedPotential(b, league.season, true, userId) * 0.5) -
      (scoutedOverall(a, league.season, userId) + scoutedPotential(a, league.season, true, userId) * 0.5)
    )
    .forEach((p, i) => { userRankByPid[p.id] = i + 1; });

  return (
    <>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
        Consensus board based on league-wide pre-draft evaluation. AI teams use true ratings — this approximates their collective big board, not yours.
      </p>
      <div className="ui-table-wrap">
        <table className="ui-table zebra" style={{ fontSize: 'var(--text-xs)' }}>
          <thead>
            <tr>
              <th className="num">Mock</th>
              <th>OVR</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Age</th>
              <th>Archetype</th>
              <th>Projected</th>
              <th className="num" title="Your big board rank based on your scouting">Your #</th>
            </tr>
          </thead>
          <tbody>
            {mockOrder.map((pid, i) => {
              const p = prospects.find((x) => x.id === pid);
              if (!p) return null;
              const slot = mockSlotLabel(i);
              const userRank = userRankByPid[pid];
              const isRiser  = combine.risers?.includes(pid);
              const isFaller = combine.fallers?.includes(pid);
              const diff     = userRank ? userRank - (i + 1) : null; // positive = user ranks lower (potential value)
              return (
                <tr key={pid}>
                  <td className="num" style={{ fontWeight: 'var(--weight-bold)', color: i < 5 ? '#c9a227' : i < 14 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
                    {i + 1}
                  </td>
                  <td><Ovr p={p} league={league} fogged /></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <PlayerLink p={p} />
                      {isRiser  && <Badge variant="success" pill style={{ fontSize: 9, padding: '1px 4px' }}>▲</Badge>}
                      {isFaller && <Badge variant="danger"  pill style={{ fontSize: 9, padding: '1px 4px' }}>▼</Badge>}
                    </span>
                  </td>
                  <td>{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{combine.archetypes?.[pid] ?? '—'}</td>
                  <td style={{ color: slot.color, fontWeight: i < 14 ? 'var(--weight-medium)' : undefined }}>
                    {slot.label}
                  </td>
                  <td className="num">
                    {userRank ? (
                      <span style={{ color: diff > 3 ? 'var(--color-success)' : diff < -3 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
                        #{userRank}
                        {diff > 3  && <span title="Value — you rate this prospect lower than consensus"> ↑</span>}
                        {diff < -3 && <span title="Reach — you rate this prospect higher than consensus"> ↓</span>}
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- Main Component ----

export default function DraftCombine({ league, commit, onContinue }) {
  const [tab, setTab] = useState('combine');
  const c = league.combine;
  const prospects = league.draft?.prospects ?? [];

  if (!c || c.season !== league.season) {
    return (
      <Section title="Pre-Draft Combine" spacing="sm">
        <p style={{ color: 'var(--text-muted)' }}>Combine data not available. Continue from the lottery to generate it.</p>
      </Section>
    );
  }

  const slotsUsed  = c.workoutsDone?.length ?? 0;
  const slotsTotal = (c.workoutSlots ?? 0) + slotsUsed;

  return (
    <Section title={`${league.season} Pre-Draft Combine`} spacing="sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {prospects.length} prospects · {c.risers?.length ?? 0} risers · {c.fallers?.length ?? 0} fallers ·{' '}
          <span style={{ color: c.workoutSlots > 0 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
            {c.workoutSlots} workout slot{c.workoutSlots !== 1 ? 's' : ''} remaining
          </span>
        </div>
        <button className="ui-btn ui-btn--primary" onClick={onContinue}>
          Continue to Draft →
        </button>
      </div>

      <Tabs
        tabs={[
          { key: 'combine',   label: `Combine Results (${prospects.length})` },
          { key: 'workouts',  label: `Workouts (${slotsUsed}/${slotsTotal})` },
          { key: 'mockdraft', label: 'Mock Draft' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'combine'   && <CombineTab  prospects={prospects} combine={c} league={league} />}
      {tab === 'workouts'  && <WorkoutsTab prospects={prospects} combine={c} league={league} commit={commit} />}
      {tab === 'mockdraft' && <MockDraftTab prospects={prospects} combine={c} league={league} />}
    </Section>
  );
}
