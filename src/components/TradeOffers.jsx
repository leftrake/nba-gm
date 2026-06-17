import React from 'react';
import { getTeam } from '../engine/league.js';
import { acceptTradeOffer, declineTradeOffer } from '../engine/tradeOffers.js';
import { pickLabel } from '../engine/draftPicks.js';
import { Ovr, Pot, PlayerLink, TeamBadge, money } from './shared.jsx';
import { Section } from './ui/index.js';

function OfferSide({ league, players, fogged, openPlayer }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr><th>Ovr</th><th>Pot</th><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Salary</th></tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td><Ovr p={p} league={league} fogged={fogged} /></td>
              <td><Pot p={p} league={league} fogged={fogged} /></td>
              <td><PlayerLink p={p} openPlayer={openPlayer} /></td>
              <td>{p.pos}</td>
              <td className="num">{p.age}</td>
              <td className="num">{money(p.contract.salary)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Dashboard inbox of incoming AI trade offers: accept/decline on the spot,
// or hand the deal off to the Trade Machine to counter.
export default function TradeOffers({ league, commit, openPlayer, onCounter }) {
  if (!league.tradeOffers?.length) return null;
  const user = getTeam(league, league.userTeamId);
  const handleAccept = (offer) => {
    acceptTradeOffer(league, offer.id);
    commit();
  };
  const handleDecline = (offer) => {
    declineTradeOffer(league, offer.id);
    commit();
  };

  return (
    <Section title={`Trade Offers (${league.tradeOffers.length})`} spacing="sm">
      {league.tradeOffers.map((offer, idx) => {
        const from = getTeam(league, offer.fromTeamId);
        const give = user.roster.filter((p) => offer.give.includes(p.id));
        const get = from.roster.filter((p) => offer.get.includes(p.id));
        const givePicks = (offer.givePicks || []).map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
        const getPicks = (offer.getPicks || []).map((id) => league.draftPicks.find((p) => p.id === id)).filter(Boolean);
        const daysLeft = Math.max(1, offer.expiresDay - league.dayIndex);
        return (
          <div key={offer.id} style={{ ...(idx > 0 ? { borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginTop: 'var(--sp-4)' } : null) }}>
            <p style={{ marginBottom: 'var(--sp-2)' }}>
              <TeamBadge team={from} size="small" /> <b>{from.city} {from.name}</b> propose a trade
              <span style={{ color: 'var(--muted)' }}> · expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}</span>
            </p>
            {offer.why && <p style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-2)' }}>{offer.why}</p>}
            <div className="grid2">
              <div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>You send</p>
                <OfferSide league={league} players={give} fogged={false} openPlayer={openPlayer} />
                {givePicks.map((pick) => <div key={pick.id} className="tag" style={{ marginTop: 4 }}>{pickLabel(pick)}</div>)}
              </div>
              <div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>You receive</p>
                <OfferSide league={league} players={get} fogged openPlayer={openPlayer} />
                {getPicks.map((pick) => <div key={pick.id} className="tag" style={{ marginTop: 4 }}>{pickLabel(pick)}</div>)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <button className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => handleAccept(offer)}>Accept</button>
              <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => handleDecline(offer)}>Decline</button>
              <button className="ui-btn ui-btn--sm ui-btn--secondary" onClick={() => onCounter(offer)}>Counter in Trade Machine</button>
            </div>
          </div>
        );
      })}
    </Section>
  );
}
