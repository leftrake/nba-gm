import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { extensionTypeAt, extensionWindowLabel } from '../engine/extensions.js';
import {
  PROJECTION_YEARS, APRON, projectedSalary, isExpiringIn, projectedDeadMoney,
  isRfaCandidate, projectedPayroll, projectedCapSpace, payrollStatus,
} from '../engine/capProjection.js';
import { getTeamPicks, pickLabel, projectedSlot } from '../engine/draftPicks.js';
import { SALARY_CAP, LUXURY_TAX } from '../data/teams.js';
import { money, PlayerLink } from './shared.jsx';

const STATUS_COLOR = { under: 'var(--green)', over: 'var(--yellow)', tax: 'var(--red)', apron: '#ff6666' };
const EXT_LABEL = { rookie: 'RFX', veteran: 'EXT', final: 'FINAL' };

export default function FuturePayroll({ league, openPlayer, onTradeFor, setScreen }) {
  const [includeExt, setIncludeExt] = useState(true);
  const [menu, setMenu] = useState(null); // { p, so }

  const team = getTeam(league, league.userTeamId);
  const years = Array.from({ length: PROJECTION_YEARS }, (_, i) => i);
  const seasonLabel = (so) => league.season + so;

  const roster = [...team.roster]
    .filter((p) => p.contract)
    .sort((a, b) => b.contract.salary - a.contract.salary);

  const deadMoney = team.deadMoney || [];

  const picksBySeason = years.map((so) => {
    const draftSeason = league.season + 1 + so;
    const pick = getTeamPicks(league, team.id).find((p) => p.round === 1 && p.season === draftSeason);
    if (!pick) return null;
    return { pick, slot: projectedSlot(league, pick.originalTeamId, so) };
  });

  return (
    <div className="card">
      <h2>Future Payroll Projection — {team.city} {team.name}</h2>
      <p style={{ color: 'var(--muted)' }}>
        Projected salaries for the next {PROJECTION_YEARS} seasons. The {seasonLabel(0)} column matches the Roster/Cap screen exactly.
      </p>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <input type="checkbox" checked={includeExt} onChange={(e) => setIncludeExt(e.target.checked)} />
        Include signed extensions (uncheck to model the worst case — current contracts only)
      </label>

      <table>
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

      <p style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>
        Cap {money(SALARY_CAP)} (<span style={{ color: STATUS_COLOR.under }}>green</span>) · Tax {money(LUXURY_TAX)} (<span style={{ color: STATUS_COLOR.over }}>yellow</span>/<span style={{ color: STATUS_COLOR.tax }}>red</span>) · Apron {money(APRON)} (<span style={{ color: STATUS_COLOR.apron }}>dark red</span>).{' '}
        Highlighted cells are a player's last guaranteed season — <span style={{ color: 'var(--yellow)' }}>RFX</span>/<span style={{ color: 'var(--yellow)' }}>EXT</span>/<span style={{ color: 'var(--yellow)' }}>FINAL</span> shows his extension window, <span style={{ color: 'var(--accent)' }}>RFA</span> flags a restricted free agent candidate.
      </p>

      {menu && (
        <div className="modal-overlay" onClick={() => setMenu(null)}>
          <div className="modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{menu.p.name} — {seasonLabel(menu.so)}</h3>
            <p style={{ color: 'var(--muted)' }}>
              Contract expires after this season.
              {extensionTypeAt(menu.p, menu.so) && <> {extensionWindowLabel(extensionTypeAt(menu.p, menu.so))}</>}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => { setMenu(null); openPlayer(menu.p); }}>View Profile</button>
              <button className="btn small secondary" onClick={() => { setMenu(null); setScreen('roster'); }}>Go to Roster (Extend)</button>
              <button className="btn small secondary" onClick={() => { setMenu(null); onTradeFor(menu.p); }}>Propose Trade</button>
              <button className="btn small secondary" onClick={() => setMenu(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
