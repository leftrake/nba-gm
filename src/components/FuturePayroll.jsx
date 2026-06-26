import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { extensionTypeAt, extensionWindowLabel } from '../engine/extensions.js';
import {
  PROJECTION_YEARS, FIRST_APRON, APRON, projectedSalary, isExpiringIn, projectedDeadMoney,
  isRfaCandidate, projectedPayroll, projectedCapSpace, payrollStatus,
} from '../engine/capProjection.js';
import { getTeamPicks, pickLabel, projectedSlot } from '../engine/draftPicks.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { personalitySummary, ownerStance, seatStatus, isRosterFrozen, directiveStatus, respondToExtension } from '../engine/owner.js';
import { SPECIALTY_INFO, STYLE_INFO, coachSalary } from '../engine/coach.js';
import { money, PlayerLink, GuideTooltip, ApprovalMeter, approvalColor } from './shared.jsx';
import { Section, Card } from './ui/index.js';

const STATUS_COLOR = { under: 'var(--green)', over: 'var(--yellow)', tax: 'var(--red)', 'first-apron': '#e05000', apron: '#c00' };
const EXT_LABEL = { rookie: 'RFX', veteran: 'EXT', final: 'FINAL' };

const SUBTABS = [
  { key: 'cap', label: 'Cap Projection' },
  { key: 'ownership', label: 'Ownership' },
];

function OwnershipSection({ league, team, commit }) {
  const owner = team.owner;
  if (!owner) return <p style={{ color: 'var(--text-muted)' }}>No ownership data available.</p>;
  const showProjected = league.phase !== 'regular' && league.phase !== 'playoffs' && owner.projectedBudget !== owner.budget;
  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p><b>{owner.name}</b>, Owner</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-1)' }}>{personalitySummary(owner)}</p>
          <p style={{ marginTop: 'var(--sp-2)' }}>
            {ownerStance(owner)} · <span style={{ color: approvalColor(owner.approval) }}>{seatStatus(owner)}</span>
          </p>
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <ApprovalMeter value={owner.approval} />
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>Approval {Math.round(owner.approval)}/100</p>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p>Budget: <b>{money(owner.budget)}</b>
            {showProjected && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}> (next season: {money(owner.projectedBudget)})</span>}
          </p>
        </div>
      </div>

      {team.coach && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-primary)', marginBottom: 'var(--sp-2)' }}>
            Head Coach
          </div>
          <Card elevation="raised" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '0 0 auto' }}>
                <p style={{ fontWeight: 'var(--weight-bold)' }}>{team.coach.name}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>Age {team.coach.age}</p>
                {team.coach.seasonsWithTeam > 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>
                    {team.coach.seasonsWithTeam} season{team.coach.seasonsWithTeam === 1 ? '' : 's'} with team
                  </p>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Specialty: </span>
                  <b>{SPECIALTY_INFO[team.coach.specialty]?.label ?? team.coach.specialty}</b>
                </p>
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Style: </span>
                  <b>{STYLE_INFO[team.coach.style ?? 'balanced'].label}</b>
                </p>
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Salary: </span>
                  <b>${((team.coach.salary ?? coachSalary(team.coach.rating)) / 1_000_000).toFixed(1)}M/yr</b>
                  <span style={{ color: 'var(--text-muted)' }}> · not cap-counted</span>
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {(isRosterFrozen(league, team) || owner.missedPlayoffsStreak > 0 || owner.champYears > 0 || owner.extensionOffered) && (
        <div style={{ marginTop: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {isRosterFrozen(league, team) && (
            <Card elevation="raised" style={{ borderLeft: '3px solid var(--color-danger)', padding: 'var(--sp-2) var(--sp-3)' }}>
              🔒 Roster frozen by ownership.
            </Card>
          )}
          {owner.missedPlayoffsStreak > 0 && (
            <Card elevation="raised" style={{ borderLeft: '3px solid var(--color-danger)', padding: 'var(--sp-2) var(--sp-3)' }}>
              📉 Missed the playoffs {owner.missedPlayoffsStreak} season{owner.missedPlayoffsStreak === 1 ? '' : 's'} in a row.
            </Card>
          )}
          {owner.champYears > 0 && (
            <Card elevation="raised" style={{ borderLeft: '3px solid #e3c567', padding: 'var(--sp-2) var(--sp-3)', color: '#e3c567' }}>
              🏆 Championship afterglow — goodwill boosted for {owner.champYears} more season{owner.champYears === 1 ? '' : 's'}.
            </Card>
          )}
          {owner.extensionOffered && (
            <Card elevation="raised" style={{ borderLeft: '3px solid var(--color-primary)', padding: 'var(--sp-2) var(--sp-3)' }}>
              ✉️ {owner.name} has offered you a contract extension.{' '}
              <button className="btn small" onClick={() => { respondToExtension(league, team, true); commit(); }}>Accept</button>{' '}
              <button className="btn small secondary" onClick={() => { respondToExtension(league, team, false); commit(); }}>Decline</button>
            </Card>
          )}
        </div>
      )}

      {owner.directives?.length > 0 && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <GuideTooltip
            tipKey="owner_directive"
            text="Your owner wants something specific. Ignoring it costs approval — and low approval leads to budget cuts, interference, and eventually getting fired."
            block
          >
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-primary)', marginBottom: 'var(--sp-2)' }}>
              Owner Directives
            </div>
          </GuideTooltip>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {owner.directives.map((d, i) => {
              const status = directiveStatus(league, team, d);
              const icon = status === 'done' ? '✅' : status === 'on-track' ? '🟡' : '📋';
              const borderColor = status === 'done' ? 'var(--color-success)' : 'var(--color-warning)';
              return (
                <Card key={i} elevation="raised" style={{ borderLeft: `3px solid ${borderColor}`, padding: 'var(--sp-2) var(--sp-3)' }}>
                  <div>{icon} {d.text}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 2 }}>
                    {d.deadline}
                    {status === 'done' && ' · on track'}
                    {status === 'on-track' && ' · in progress'}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export default function FuturePayroll({ league, commit, openPlayer, onTradeFor, setScreen }) {
  const [subTab, setSubTab] = useState('cap');
  const [includeExt, setIncludeExt] = useState(true);
  const [menu, setMenu] = useState(null); // { p, so }

  const team = getTeam(league, league.userTeamId);
  const years = Array.from({ length: PROJECTION_YEARS }, (_, i) => i);
  const seasonLabel = (so) => league.season + so;

  const roster = [...team.roster]
    .filter((p) => p.contract && !p.contract.twoWay)
    .sort((a, b) => b.contract.salary - a.contract.salary);

  const deadMoney = team.deadMoney;

  const picksBySeason = years.map((so) => {
    const draftSeason = league.season + 1 + so;
    const pick = getTeamPicks(league, team.id).find((p) => p.round === 1 && p.season === draftSeason);
    if (!pick) return null;
    return { pick, slot: projectedSlot(league, pick.originalTeamId, so) };
  });

  return (
    <Section
      title={`Front Office — ${team.city} ${team.name}`}
      spacing="sm"
    >
      <div style={{ display: 'flex', gap: 'var(--sp-1)', marginBottom: 'var(--sp-4)' }}>
        {SUBTABS.map(({ key, label }) => (
          <button key={key} className={`ui-tab${subTab === key ? ' ui-tab--active' : ''}`} onClick={() => setSubTab(key)}>{label}</button>
        ))}
      </div>

      {subTab === 'ownership' && (
        <OwnershipSection league={league} team={team} commit={commit} />
      )}

      {subTab === 'cap' && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-2)' }}>
            Next {PROJECTION_YEARS} seasons · {seasonLabel(0)} column matches Roster/Contracts exactly
          </p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={includeExt} onChange={(e) => setIncludeExt(e.target.checked)} />
            Include signed extensions
          </label>

          <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Player</th>
                {years.map((so) => <th key={so} className="num">{seasonLabel(so)}</th>)}
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => (
                <tr key={p.id}>
                  <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                  {years.map((so) => {
                    const sal = projectedSalary(p, so, includeExt);
                    const expiring = isExpiringIn(p, so, includeExt);
                    const extType = expiring ? extensionTypeAt(p, so) : null;
                    const rfa = isRfaCandidate(p, so, includeExt);
                    return (
                      <td
                        key={so}
                        className="num"
                        onClick={expiring ? () => setMenu({ p, so }) : undefined}
                        style={{
                          cursor: expiring ? 'pointer' : 'default',
                          background: expiring ? 'rgba(248, 81, 73, 0.15)' : undefined,
                        }}
                        title={expiring ? 'Contract expires this season — click for options' : undefined}
                      >
                        {sal != null ? money(sal) : '–'}
                        {extType && (
                          <span className="tag" style={{ marginLeft: 4, color: 'var(--yellow)' }}>{EXT_LABEL[extType]}</span>
                        )}
                        {rfa && (
                          <span className="tag" style={{ marginLeft: 4, color: 'var(--accent)' }} title="Restricted free agent candidate — rookie-scale deal ending">RFA</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {deadMoney.map((d, i) => (
                <tr key={`dead-${i}`} style={{ color: 'var(--muted)' }}>
                  <td>Dead money: {d.playerName}</td>
                  {years.map((so) => {
                    const active = d.years - so > 0;
                    return <td key={so} className="num" style={{ opacity: active ? 1 : 0.4 }}>{active ? money(d.salary) : '–'}</td>;
                  })}
                </tr>
              ))}

              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 'bold' }}>
                <td>Total Payroll</td>
                {years.map((so) => {
                  const total = projectedPayroll(team, so, includeExt);
                  const status = payrollStatus(total);
                  return <td key={so} className="num" style={{ color: STATUS_COLOR[status] }}>{money(total)}</td>;
                })}
              </tr>
              <tr>
                <td>Cap Space</td>
                {years.map((so) => {
                  const space = projectedCapSpace(team, so, includeExt);
                  return <td key={so} className="num" style={{ color: space >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(space)}</td>;
                })}
              </tr>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td>Projected 1st-Round Pick</td>
                {years.map((so) => {
                  const info = picksBySeason[so];
                  return (
                    <td key={so} className="num">
                      {info ? <span title={`${info.pick.season} draft`}>{pickLabel(info.pick)} — proj. #{info.slot}</span> : '–'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          </div>

          <p style={{ marginTop: 10, color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
            Cap {money(SALARY_CAP)} (<span style={{ color: STATUS_COLOR.under }}>green</span>) · Tax {money(LUXURY_TAX)} (<span style={{ color: STATUS_COLOR.over }}>yellow</span>/<span style={{ color: STATUS_COLOR.tax }}>red</span>) · 1st Apron {money(FIRST_APRON)} (<span style={{ color: STATUS_COLOR['first-apron'] }}>orange</span>, taxpayer MLE only) · 2nd Apron {money(APRON)} (<span style={{ color: STATUS_COLOR.apron }}>dark red</span>).{' '}
            Highlighted cells are a player's last guaranteed season — <span style={{ color: 'var(--yellow)' }}>RFX</span>/<span style={{ color: 'var(--yellow)' }}>EXT</span>/<span style={{ color: 'var(--yellow)' }}>FINAL</span> = extension window, <span style={{ color: 'var(--accent)' }}>RFA</span> = restricted FA candidate.
          </p>
        </>
      )}

      {menu && (
        <div className="ui-modal-overlay" onClick={() => setMenu(null)}>
          <div className="ui-modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="ui-modal-header">
              <div className="ui-modal-title">{menu.p.name} — {seasonLabel(menu.so)}</div>
              <button className="ui-modal-close" onClick={() => setMenu(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--muted)', marginBottom: 'var(--sp-4)' }}>
              Contract expires after this season.
              {extensionTypeAt(menu.p, menu.so) && <> {extensionWindowLabel(extensionTypeAt(menu.p, menu.so))}</>}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => { setMenu(null); openPlayer(menu.p); }}>View Profile</button>
              <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => { setMenu(null); setScreen('roster'); }}>Go to Roster</button>
              <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => { setMenu(null); onTradeFor(menu.p); }}>Propose Trade</button>
              <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => setMenu(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
