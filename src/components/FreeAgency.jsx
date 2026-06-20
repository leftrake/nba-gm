import React, { useState } from 'react';
import { getTeam, payroll, makeOffer, askingPrice, midSeasonSignable, proratedMinSalary, signMidSeasonFA, signingException, matchOfferSheet, signToTwoWay, twoWayEligible } from '../engine/league.js';
import { scoutedOverall, isHidden } from '../engine/scouting.js';
import { overall } from '../engine/players.js';
import { traitSortValue } from '../engine/devTraits.js';
import { POSITIONS } from '../engine/lineup.js';
import { SALARY_CAP, MIN_SALARY, MAX_SALARY, MLE_AMOUNT, ROSTER_MAX, TWO_WAY_MAX } from '../data/teams.js';
import { Ovr, Pot, money, PlayerLink, GuideTooltip } from './shared.jsx';
import { Card, Button, Badge, Section, SectionHeader, Divider, Table } from './ui/index.js';

const OFFERS_PER_ROUND = 3;
const FILTERS_KEY = 'nba-gm-fa-filters';
const DEFAULT_FILTERS = { sortKey: 'ovr', sortDir: 'desc', pos: 'all', minAge: '', maxAge: '', maxAskingM: '' };

function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
    return saved ? { ...DEFAULT_FILTERS, ...saved } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function FreeAgency({ league, commit, openPlayer }) {
  const team = getTeam(league, league.userTeamId);
  const room = SALARY_CAP - payroll(team);
  const isOpen = league.phase === 'offseason/freeagency';
  const isSeason = league.phase === 'regular';
  const [negotiatingId, setNegotiatingId] = useState(null);
  const [salaryM, setSalaryM] = useState(5);
  const [years, setYears] = useState(2);
  const [responses, setResponses] = useState({});
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState(loadFilters);

  const setFilter = (patch) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      try { localStorage.setItem(FILTERS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const negotiations = league.negotiations;
  const offerSheets = league.offerSheets;

  const toggleNegotiation = (p) => {
    if (negotiatingId === p.id) { setNegotiatingId(null); return; }
    setNegotiatingId(p.id);
    setSalaryM(askingPrice(p) / 1e6);
    setYears(2);
  };

  const offer = (p, salM, yrs) => {
    const res = makeOffer(league, team.id, p.id, Math.round(salM * 10) * 100_000, yrs);
    if (res.ok && res.decision === 'accept') {
      setMessage({ type: 'ok', text: res.reason });
      setNegotiatingId(null);
    } else {
      setMessage(null);
    }
    setResponses((r) => ({ ...r, [p.id]: res }));
    commit();
  };

  const offersUsed = (p) => {
    const n = negotiations[p.id];
    return n && n.round === league.faDaysLeft ? n.offers : 0;
  };

  const signMin = (p) => {
    const res = signMidSeasonFA(league, team.id, p.id);
    setMessage(res.ok
      ? { type: 'ok', text: `${p.name} signed for the rest of the season (${money(res.player.contract.salary)}) — available for the next game.` }
      : { type: 'err', text: res.error });
    commit();
  };

  const signTwoWay = (p) => {
    const res = signToTwoWay(league, team.id, p.id);
    setMessage(res.ok
      ? { type: 'ok', text: `${p.name} signed to a two-way contract.` }
      : { type: 'err', text: res.error });
    commit();
  };

  const matchSheet = (p) => {
    const res = matchOfferSheet(league, p.id);
    setMessage(res.ok
      ? { type: 'ok', text: `${p.name} re-signed — offer sheet matched.` }
      : { type: 'err', text: res.error });
    commit();
  };

  // Sort + filter
  const SORT_VALUE = {
    ovr: (p) => {
      if (p.everOnUserTeam) return overall(p);
      const proGames = league.scouting?.proWatching?.[p.id] ?? 0;
      if (isHidden(p, league.userTeamId, proGames)) return -Infinity;
      return scoutedOverall(p, league.season, league.userTeamId, proGames);
    },
    pot: (p) => traitSortValue(p, league.season, league.userTeamId, league.scouting?.proWatching?.[p.id] ?? 0, true),
    age: (p) => p.age,
    asking: (p) => askingPrice(p),
    pos: (p) => POSITIONS.indexOf(p.pos),
  };
  const dirMul = filters.sortDir === 'asc' ? 1 : -1;
  const sortValue = SORT_VALUE[filters.sortKey] || SORT_VALUE.ovr;
  const minAge = filters.minAge !== '' ? Number(filters.minAge) : -Infinity;
  const maxAge = filters.maxAge !== '' ? Number(filters.maxAge) : Infinity;
  const maxAsking = filters.maxAskingM !== '' ? Number(filters.maxAskingM) * 1e6 : Infinity;
  const filtered = league.freeAgents.filter((p) =>
    (filters.pos === 'all' || p.pos === filters.pos || p.pos2 === filters.pos)
    && p.age >= minAge && p.age <= maxAge
    && askingPrice(p) <= maxAsking
  );
  const shown = [...filtered].sort((a, b) => (sortValue(b) - sortValue(a)) * dirMul);

  const handleSort = (key) => {
    if (filters.sortKey === key) {
      setFilter({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilter({ sortKey: key, sortDir: 'desc' });
    }
  };
  const arrow = (key) => filters.sortKey === key ? (filters.sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const myRfas = league.freeAgents.filter((p) => p.restrictedFA && p.formerTeamId === team.id);
  const negotiatingPlayer = negotiatingId != null ? shown.find((p) => p.id === negotiatingId) ?? null : null;

  // RFA table
  const rfaCols = [
    { key: 'name', label: 'Player', render: (row) => <PlayerLink p={row._p} openPlayer={openPlayer} /> },
    { key: 'pos', label: 'Pos' },
    { key: 'age', label: 'Age', numeric: true },
    { key: 'asking', label: 'Asking', numeric: true, render: (row) => money(askingPrice(row._p)) },
    { key: 'status', label: 'Status', render: (row) => {
      const sheet = offerSheets.find((s) => s.playerId === row._p.id);
      const roundsLeft = sheet ? sheet.deadlineRound + 1 - league.faDaysLeft : null;
      return sheet
        ? <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>Offer sheet: {money(sheet.salary)}/yr × {sheet.years}yr — {roundsLeft > 0 ? `match within ${roundsLeft} round${roundsLeft === 1 ? '' : 's'} or lose him` : 'last round to match'}</span>
        : <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>On the open market — no offer sheets yet</span>;
    }},
    { key: 'action', label: '', render: (row) => {
      const sheet = offerSheets.find((s) => s.playerId === row._p.id);
      if (!sheet) return null;
      return <Button size="sm" variant="secondary" disabled={team.roster.length >= ROSTER_MAX} onClick={() => matchSheet(row._p)}>Match Offer</Button>;
    }},
  ];
  const rfaRows = myRfas.map((p) => ({ _key: p.id, _p: p, pos: p.pos, age: p.age }));

  // FA table columns (sort arrows injected into labels; onSort toggles direction)
  const faCols = [
    { key: 'ovr', label: `Ovr${arrow('ovr')}`, numeric: true, sortable: true,
      render: (row) => <Ovr p={row._p} league={league} fogged={!row._p.everOnUserTeam} /> },
    { key: 'pot', label: `Pot${arrow('pot')}`, numeric: true, sortable: true,
      render: (row) => <Pot p={row._p} league={league} fogged={!row._p.everOnUserTeam} /> },
    { key: 'name', label: 'Player', render: (row) => <PlayerLink p={row._p} openPlayer={openPlayer} /> },
    { key: 'pos', label: `Pos${arrow('pos')}`, sortable: true },
    { key: 'age', label: `Age${arrow('age')}`, numeric: true, sortable: true },
    { key: 'asking', label: `Asking${arrow('asking')}`, numeric: true, sortable: true,
      render: (row) => money(askingPrice(row._p)) },
    { key: 'twoway', label: '', render: (row) => {
      if (!twoWayEligible(row._p) || row._p.restrictedFA) return null;
      return (
        <Button size="sm" variant="secondary"
          disabled={team.twoWay.length >= TWO_WAY_MAX}
          title={team.twoWay.length >= TWO_WAY_MAX ? `Two-way slots full (${TWO_WAY_MAX})` : 'Cap-exempt development slot'}
          onClick={() => signTwoWay(row._p)}
        >
          Sign 2-Way
        </Button>
      );
    }},
    { key: 'action', label: '', render: (row) => {
      if (isSeason) {
        if (!midSeasonSignable(row._p)) {
          return (
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}
                  title="Won't take a minimum deal — available in offseason free agency">
              Holding out
            </span>
          );
        }
        return (
          <Button size="sm" variant="secondary"
            disabled={team.roster.length >= ROSTER_MAX}
            title={team.roster.length >= ROSTER_MAX ? 'Roster full (15)' : `Rest-of-season min: ${money(proratedMinSalary(league))}`}
            onClick={() => signMin(row._p)}
          >
            Sign Min
          </Button>
        );
      }
      const isActive = negotiatingId === row._p.id;
      const counter = negotiations[row._p.id]?.counter;
      return (
        <Button size="sm" variant={isActive ? 'primary' : 'secondary'} disabled={!isOpen} onClick={() => toggleNegotiation(row._p)}>
          {isActive ? 'Close' : counter ? 'Counter…' : 'Negotiate'}
        </Button>
      );
    }},
  ];
  const faRows = shown.map((p) => ({ _key: p.id, _p: p, pos: p.pos, age: p.age }));

  return (
    <div className="page-fade">
      {isOpen && (
        <Card style={{ borderLeft: '3px solid var(--color-primary)', marginBottom: 'var(--sp-4)' }}>
          <strong>Free Agency is open</strong>
          <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--sp-2)' }}>
            {league.faDaysLeft} round{league.faDaysLeft === 1 ? '' : 's'} remaining
          </span>
        </Card>
      )}

      {message && (
        <Card
          style={{
            borderLeft: `3px solid var(--${message.type === 'ok' ? 'color-success' : 'color-danger'})`,
            color: `var(--${message.type === 'ok' ? 'color-success' : 'color-danger'})`,
            marginBottom: 'var(--sp-4)',
          }}
        >
          {message.text}
        </Card>
      )}

      {myRfas.length > 0 && (
        <>
          <Section title="Your Restricted Free Agents">
            <Table columns={rfaCols} rows={rfaRows} />
          </Section>
          <Divider />
        </>
      )}

      <Section>
        <GuideTooltip
          tipKey="fogged_ratings"
          text="Rating ranges reflect your scouting knowledge — tighter ranges mean more certainty. Scout players before the draft or trade deadline to get better information."
          block
        >
          <SectionHeader
            title="Free Agents"
            subtitle={
              <span>
                Cap room: <b style={{ color: room > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{money(room)}</b>
                {' · '}Roster: {team.roster.length}/{ROSTER_MAX}
                {' · '}2-Way: {team.twoWay.length}/{TWO_WAY_MAX}
                {room <= 0 && (
                  <> · MLE: <b style={{ color: team.usedMLE ? 'var(--color-danger)' : 'var(--color-success)' }}>
                    {team.usedMLE ? 'used' : `available (up to ${money(MLE_AMOUNT)})`}
                  </b></>
                )}
              </span>
            }
          />
        </GuideTooltip>

        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)' }}>
          {isOpen
            ? "Negotiate salary and years — players weigh money, your record, and their role. Other teams sign players every round, including ones you're talking to."
            : isSeason
            ? `In-season market: rest-of-season minimum deals only (${money(proratedMinSalary(league))}), and you need an open roster spot.`
            : 'Signings open during the Free Agency phase (after the offseason advance), but you can browse anytime.'}
        </p>

        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Pos</span>
            <select value={filters.pos} onChange={(e) => setFilter({ pos: e.target.value })}>
              <option value="all">All</option>
              {POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Age</span>
            <input type="number" min={18} max={45} value={filters.minAge} placeholder="min"
                   onChange={(e) => setFilter({ minAge: e.target.value })} style={{ width: 56 }} />
            <span style={{ color: 'var(--text-muted)' }}>–</span>
            <input type="number" min={18} max={45} value={filters.maxAge} placeholder="max"
                   onChange={(e) => setFilter({ maxAge: e.target.value })} style={{ width: 56 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Max Asking ($M)</span>
            <input type="number" min={0} value={filters.maxAskingM} placeholder="any"
                   onChange={(e) => setFilter({ maxAskingM: e.target.value })} style={{ width: 70 }} />
          </label>
          {(filters.pos !== 'all' || filters.minAge !== '' || filters.maxAge !== '' || filters.maxAskingM !== '') && (
            <Button size="sm" variant="ghost" onClick={() => setFilter({ pos: 'all', minAge: '', maxAge: '', maxAskingM: '' })}>
              Clear Filters
            </Button>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginLeft: 'auto' }}>
            {filtered.length}{filtered.length !== league.freeAgents.length ? ` of ${league.freeAgents.length}` : ''} free agents
          </span>
        </div>

        {/* Negotiation panel — appears above the table so it's visible without
            scrolling past a long free-agent list when a player is selected */}
        {negotiatingPlayer && isOpen && (
          <Card elevation="raised" style={{ borderLeft: '3px solid var(--color-primary)', marginBottom: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              <span style={{ fontWeight: 'var(--weight-semibold)' }}>
                Negotiating with <PlayerLink p={negotiatingPlayer} openPlayer={openPlayer} />
              </span>
              {negotiations[negotiatingPlayer.id]?.counter && (
                <Badge variant="warning">Counter on table</Badge>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Salary ($M)</span>
                <input
                  type="number"
                  min={MIN_SALARY / 1e6}
                  max={MAX_SALARY / 1e6}
                  step={0.5}
                  value={salaryM}
                  onChange={(e) => setSalaryM(Number(e.target.value))}
                  style={{ width: 80 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Years</span>
                <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              {(() => {
                const left = OFFERS_PER_ROUND - offersUsed(negotiatingPlayer);
                return (
                  <>
                    <Button size="sm" variant="primary" disabled={left <= 0} onClick={() => offer(negotiatingPlayer, salaryM, years)}>
                      Submit Offer
                    </Button>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                      {left > 0 ? `${left} offer${left === 1 ? '' : 's'} left this round` : 'Agent unavailable until next round'}
                    </span>
                  </>
                );
              })()}
              {(() => {
                const exc = signingException(league, team.id, Math.round(salaryM * 10) * 100_000);
                if (exc === 'mle') return <Badge variant="warning">Uses mid-level exception</Badge>;
                if (exc === 'minimum') return <Badge variant="info">Uses minimum-salary exception</Badge>;
                if (!exc) return <Badge variant="danger">Not enough cap room or exceptions</Badge>;
                return null;
              })()}
            </div>

            {(() => {
              const counter = negotiations[negotiatingPlayer.id]?.counter;
              if (!counter) return null;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                  <span style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
                    Counter: {money(counter.salary)} × {counter.years}yr
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => offer(negotiatingPlayer, counter.salary / 1e6, counter.years)}>
                    Accept Counter
                  </Button>
                </div>
              );
            })()}

            {(() => {
              const res = responses[negotiatingPlayer.id];
              if (!res || (res.ok && res.decision === 'accept')) return null;
              return (
                <p style={{ color: !res.ok || res.decision === 'reject' ? 'var(--color-danger)' : 'var(--color-primary)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-1)' }}>
                  {res.ok ? res.reason : res.error}
                </p>
              );
            })()}
          </Card>
        )}

        <Table columns={faCols} rows={faRows} onSort={handleSort} />
      </Section>
    </div>
  );
}
