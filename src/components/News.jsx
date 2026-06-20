import React, { useState } from 'react';
import { NewsText, fmtDate } from './shared.jsx';

const CATS = [
  ['all', '🗞️ All'],
  ['game', '🏀 Games'],
  ['trade', '🔄 Trades'],
  ['signing', '✍️ Signings'],
  ['injury', '🩹 Injuries'],
  ['draft', '🎓 Draft'],
  ['morale', '💬 Morale'],
  ['award', '🏆 Awards'],
  ['milestone', '📈 Milestones'],
  ['owner', '🏛️ Ownership'],
  ['league', '🌐 League'],
];

const PHASE_LABELS = { offseason: 'Offseason', draft: 'Draft', freeagency: 'Free Agency' };

// When a story happened: a calendar date in-season, the phase label in the
// offseason, nothing for items from saves predating the stamp.
function newsWhen(n) {
  if (n.phase === 'regular' || n.phase === 'playoffs') {
    return fmtDate(new Date(n.season - 1, 9, 21 + (n.day ?? 0)));
  }
  return PHASE_LABELS[n.phase] ?? '';
}

export function NewsItem({ n, openTeam, userTeamId }) {
  const when = newsWhen(n);
  const yours = userTeamId != null && (n.teamIds || []).includes(userTeamId);
  return (
    <div className={`news-item${n.major ? ' major' : ''}${yours ? ' your-team' : ''}${n.recordBreaker ? ' record-breaker' : ''}`}>
      <span className="news-text"><NewsText text={n.text} openTeam={openTeam} /></span>
      {when && <span className="news-when">{when}</span>}
    </div>
  );
}

export default function News({ league, openTeam }) {
  const [cat, setCat] = useState('all');
  const [teamId, setTeamId] = useState('all');

  const matches = (n) =>
    (cat === 'all' || n.category === cat) &&
    (teamId === 'all' || (n.teamIds || []).includes(teamId));

  const feed = league.news.filter(matches);
  // past seasons keep only their major headlines (see engine/save.js)
  const archive = Object.entries(league.newsArchive || {})
    .map(([season, items]) => ({ season: Number(season), items: items.filter(matches) }))
    .filter((s) => s.items.length > 0)
    .sort((a, b) => b.season - a.season);

  const teams = [...league.teams].sort((a, b) =>
    a.id === league.userTeamId ? -1 : b.id === league.userTeamId ? 1 : a.city.localeCompare(b.city));

  // Every executed trade, regardless of how "major" it was, going back
  // HISTORY_RETENTION_SEASONS (engine/save.js). Grouped by season, newest first.
  const tradesBySeason = [];
  for (const t of [...(league.tradeHistory || [])].reverse()) {
    if (teamId !== 'all' && !t.teamIds.includes(teamId)) continue;
    let bucket = tradesBySeason.find((b) => b.season === t.season);
    if (!bucket) { bucket = { season: t.season, items: [] }; tradesBySeason.push(bucket); }
    bucket.items.push(t);
  }

  return (
    <div>
      <div className="ui-card">
        <div className="ui-section-header">
          <div className="ui-section-header__left">
            <div className="ui-section-title">League News · {league.season}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <div className="ui-tabs" style={{ marginBottom: 0, flex: 1 }}>
            {CATS.map(([key, label]) => (
              <button key={key} className={`ui-tab${cat === key ? ' ui-tab--active' : ''}`} onClick={() => setCat(key)}>
                {label}
              </button>
            ))}
          </div>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} {t.name}{t.id === league.userTeamId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
        {feed.length === 0 && (
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-3)' }}>No stories match these filters yet.</p>
        )}
        {feed.map((n, i) => (
          <NewsItem n={n} openTeam={openTeam} userTeamId={league.userTeamId} key={i} />
        ))}
      </div>

      {archive.map(({ season, items }) => (
        <div className="ui-card" key={season}>
          <div className="ui-section-header">
            <div className="ui-section-title">{season} · Biggest Stories</div>
          </div>
          {items.map((n, i) => (
            <NewsItem n={n} openTeam={openTeam} userTeamId={league.userTeamId} key={i} />
          ))}
        </div>
      ))}

      {cat === 'trade' && (
        <div className="ui-card">
          <div className="ui-section-header">
            <div className="ui-section-title">Trade History</div>
          </div>
          {tradesBySeason.length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>No trades have been made yet.</p>
          )}
          {tradesBySeason.map(({ season, items }) => (
            <div key={season}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontWeight: 'var(--weight-semibold)', margin: 'var(--sp-4) 0 var(--sp-2)' }}>{season}</div>
              {items.map((t, i) => (
                <div className="news-item" key={i}>
                  <span className="news-text"><NewsText text={t.text} openTeam={openTeam} /></span>
                  <span className="news-when">{fmtDate(new Date(season - 1, 9, 21 + t.day))}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
