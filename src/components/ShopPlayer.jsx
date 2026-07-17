import React, { useState } from 'react';
import { getTeam } from '../engine/league.js';
import { shopPlayer } from '../engine/tradeOffers.js';
import { pickLabel, pickDraftSlot, pickSlotColor } from '../engine/draftPicks.js';
import { Ovr, Pot, PlayerLink } from './PlayerDisplay.jsx';
import { TeamBadge } from './TeamDisplay.jsx';
import { money } from './formatters.js';
import { Modal, Button } from './ui/index.js';

// "Shop this player": call around the league and collect the best packages
// rival front offices would actually agree to. Results are market soundings,
// not standing offers — the user hands one to the Trade Machine to complete
// it. Making the calls leaks, so the player takes a small morale hit.
export default function ShopPlayerModal({ league, player, onClose, commit, openPlayer, onOpenInMachine }) {
  const [result, setResult] = useState(null);

  const makeCalls = () => {
    const r = shopPlayer(league, player.id);
    commit();
    setResult(r);
  };

  return (
    <Modal open onClose={onClose} title={`Shop ${player.name}`} wide>
      {!result ? (
        <>
          <p style={{ marginBottom: 'var(--sp-3)' }}>
            Gauge the trade market for <b>{player.name}</b>. Rival front offices will
            put together the best package they'd actually agree to, and you can take
            any of them straight to the Trade Machine.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-4)' }}>
            Word always gets out — {player.name} won't love hearing his name in trade
            talks, and his morale will take a small hit whether or not you move him.
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button variant="primary" size="md" onClick={makeCalls}>Make the Calls</Button>
            <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          {result.offers.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>
              You made the calls, but no front office put a serious package together.
              His market is quiet right now — it may pick up as the deadline nears or
              team situations change.
            </p>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)' }}>
                The strongest packages teams would agree to right now. These are
                soundings, not standing offers — finish any of them in the Trade Machine.
              </p>
              {result.offers.map((offer, idx) => {
                const from = getTeam(league, offer.fromTeamId);
                const get = from.roster.filter((p) => offer.get.includes(p.id));
                const getPicks = offer.getPicks.map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
                const pct = result.targetValue > 0 ? Math.round((offer.value / result.targetValue) * 100) : null;
                return (
                  <div key={offer.id} style={idx > 0 ? { borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginTop: 'var(--sp-4)' } : undefined}>
                    <p style={{ marginBottom: 'var(--sp-1)' }}>
                      <TeamBadge team={from} size="small" /> <b>{from.city} {from.name}</b>
                      {pct != null && (
                        <span style={{ color: 'var(--text-muted)' }}> · package worth ≈{pct}% of his trade value</span>
                      )}
                    </p>
                    {offer.why && (
                      <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-2)' }}>{offer.why}</p>
                    )}
                    {get.length > 0 && (
                      <div className="ui-table-wrap">
                        <table className="ui-table">
                          <thead>
                            <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Salary</th></tr>
                          </thead>
                          <tbody>
                            {get.map((p) => (
                              <tr key={p.id}>
                                <td><Ovr p={p} league={league} fogged={!p.everOnUserTeam} /></td>
                                <td><Pot p={p} league={league} fogged={!p.everOnUserTeam} /></td>
                                <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
                                <td>{p.pos}</td>
                                <td className="num">{p.age}</td>
                                <td className="num">{money(p.contract.salary)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {getPicks.map((pick) => {
                      const slot = pickDraftSlot(league, pick);
                      return (
                        <div key={pick.id} className="tag" style={{ marginTop: 4 }}>
                          {pickLabel(pick)}
                          {' '}<span style={{ color: pickSlotColor(slot) }}>proj. {pick.round === 1 ? `#${slot}` : `~#${30 + slot}`}</span>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: 'var(--sp-3)' }}>
                      <Button variant="secondary" size="sm" onClick={() => onOpenInMachine(offer)}>Set Up in Trade Machine</Button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
