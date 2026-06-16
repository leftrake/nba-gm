import React, { useState, useEffect } from 'react';
import { Card } from './ui/Card.jsx';
import { Button } from './ui/Button.jsx';
import { Badge, Pill } from './ui/Badge.jsx';
import { Stat } from './ui/Stat.jsx';
import { Section } from './ui/Section.jsx';
import { SectionHeader } from './ui/SectionHeader.jsx';
import { Divider } from './ui/Divider.jsx';
import { Tabs } from './ui/Tabs.jsx';
import { ProgressBar } from './ui/ProgressBar.jsx';
import { Tooltip } from './ui/Tooltip.jsx';
import { Modal } from './ui/Modal.jsx';
import { Table } from './ui/Table.jsx';
import { Ovr, Pot, Sta, TeamBadge, money } from './shared.jsx';
import { TEAMS } from '../data/teams.js';

// ── Google Fonts (preview only) ──────────────────────────────────────────────
const GFONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Anton&' +
  'family=Archivo+Narrow:wght@600;700&family=Saira+Condensed:wght@600;700&' +
  'family=Teko:wght@600;700&family=Rajdhani:wght@600;700&' +
  'family=Roboto:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600;700&' +
  'family=Manrope:wght@400;500;600;700&display=swap';

// ── Small local helpers ──────────────────────────────────────────────────────
function Swatch({ label, token, hex }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: token ? `var(${token})` : hex, border: '1px solid var(--border)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-mono)' }}>{token || hex}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{label}</div>
      </div>
    </div>
  );
}

function TypeRow({ label, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, alignItems: 'baseline', paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={style}>The quick brown fox jumps over the lazy dog</span>
    </div>
  );
}

// ── Demo data ────────────────────────────────────────────────────────────────
const demoTeam = TEAMS[3]; // Houston
const demoPlayer = {
  id: 9999, name: 'Demo Player', pos: 'PG', age: 26, stamina: 78,
  ratings: { inside: 70, mid: 75, three: 80, passing: 82, rebounding: 55, defense: 74, athleticism: 85 },
  potential: 84, draftYear: 2020, contract: { salary: 12_400_000, years: 2 },
  careerStats: [{ min: 2200 }], stats: { min: 800 }, condition: 91, morale: 75,
  nationality: 'USA', from: 'Duke',
};
const demoLeague = { scouting: { proWatching: {} }, season: 2025 };

const rosterRows = [
  { name: 'Marcus Webb',   pos: 'PG', ovr: 87, pts: 24.3, reb: 5.1, ast: 9.2 },
  { name: 'Devon Parish',  pos: 'SG', ovr: 82, pts: 20.7, reb: 4.2, ast: 3.8 },
  { name: 'Amir Solano',   pos: 'SF', ovr: 76, pts: 14.1, reb: 6.9, ast: 2.1 },
  { name: 'Tyrese Okafor', pos: 'PF', ovr: 79, pts: 16.5, reb: 8.4, ast: 1.7 },
  { name: 'Kendrick Voss', pos: 'C',  ovr: 73, pts: 11.2, reb: 9.8, ast: 1.3 },
];
const rosterCols = [
  { key: 'name', label: 'Player', sortable: true },
  { key: 'pos',  label: 'Pos', align: 'center' },
  { key: 'ovr',  label: 'OVR', numeric: true, sortable: true },
  { key: 'pts',  label: 'PTS', numeric: true, sortable: true },
  { key: 'reb',  label: 'REB', numeric: true },
  { key: 'ast',  label: 'AST', numeric: true },
];

// ── Font candidates ──────────────────────────────────────────────────────────
const DISPLAY_FONTS = [
  { name: 'Oswald (current)',  family: "'Oswald', sans-serif",           current: true  },
  { name: 'Bebas Neue',        family: "'Bebas Neue', sans-serif",        current: false },
  { name: 'Anton',             family: "'Anton', sans-serif",             current: false },
  { name: 'Archivo Narrow',    family: "'Archivo Narrow', sans-serif",    current: false },
  { name: 'Saira Condensed',   family: "'Saira Condensed', sans-serif",   current: false },
  { name: 'Teko',              family: "'Teko', sans-serif",              current: false },
  { name: 'Rajdhani',          family: "'Rajdhani', sans-serif",          current: false },
];
const UI_FONTS = [
  { name: 'Inter (current)',   family: "'Inter', sans-serif",             current: true  },
  { name: 'System Sans',       family: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", current: false },
  { name: 'Roboto',            family: "'Roboto', sans-serif",            current: false },
  { name: 'IBM Plex Sans',     family: "'IBM Plex Sans', sans-serif",     current: false },
  { name: 'Manrope',           family: "'Manrope', sans-serif",           current: false },
];

function DisplayFontCard({ name, family, current }) {
  return (
    <Card style={{ position: 'relative', borderColor: current ? 'var(--color-primary-line)' : undefined }}>
      {current && <Badge variant="primary" style={{ position: 'absolute', top: 'var(--sp-3)', right: 'var(--sp-3)' }}>current</Badge>}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-3)', textTransform: 'uppercase', letterSpacing: 1 }}>{name}</div>
      <div style={{ fontFamily: family, fontWeight: 700, fontSize: 22, letterSpacing: 1, color: 'var(--text-primary)', marginBottom: 2, textTransform: 'uppercase' }}>Dashboard · Atlanta Hawks</div>
      <div style={{ fontFamily: family, fontWeight: 600, fontSize: 16, color: 'var(--text-muted)', marginBottom: 'var(--sp-4)', letterSpacing: 0.5 }}>Marcus Webb · PG · Age 26</div>
      <div style={{ height: 1, background: 'var(--border)', marginBottom: 'var(--sp-4)' }} />
      <div style={{ display: 'flex', gap: 'var(--sp-6)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {[['28.4', 'PPG'], ['112–98', 'FINAL'], ['47–18', 'RECORD']].map(([val, lbl], i) => (
          <div key={lbl}>
            <div style={{ fontFamily: family, fontWeight: 700, fontSize: 38, fontVariantNumeric: 'tabular-nums', color: i === 2 ? 'var(--color-success)' : 'var(--text-primary)', lineHeight: 1 }}>{val}</div>
            <div style={{ fontFamily: family, fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontFamily: family, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-primary)' }}>League Leaders · Points Per Game</div>
      </div>
    </Card>
  );
}

function UIFontCard({ name, family, current }) {
  const rows = [
    { player: 'Marcus Webb',  pos: 'PG', pts: 28.4, reb: 5.1, ast: 9.2 },
    { player: 'Devon Parish', pos: 'SG', pts: 20.7, reb: 4.2, ast: 3.8 },
    { player: 'Amir Solano',  pos: 'SF', pts: 14.1, reb: 6.9, ast: 2.1 },
  ];
  return (
    <Card style={{ borderColor: current ? 'var(--color-primary-line)' : undefined, position: 'relative' }}>
      {current && <Badge variant="primary" style={{ position: 'absolute', top: 'var(--sp-3)', right: 'var(--sp-3)' }}>current</Badge>}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-3)', textTransform: 'uppercase', letterSpacing: 1 }}>{name}</div>
      <p style={{ fontFamily: family, fontSize: 14, lineHeight: 1.55, color: 'var(--text-primary)', marginBottom: 'var(--sp-3)' }}>
        Webb recorded his 8th triple-double with 26 pts, 11 ast, and 12 reb. The Hawks improved to <span style={{ fontWeight: 600 }}>47–18</span> and clinched the top seed.
      </p>
      <p style={{ fontFamily: family, fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>Day 65 of 82 · Luxury tax: $165.2M · Cap space: $4.1M</p>
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 32px 44px 44px 44px', padding: '4px 0', fontFamily: family, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <span>Player</span><span style={{ textAlign: 'center' }}>POS</span>
          <span style={{ textAlign: 'right' }}>PTS</span><span style={{ textAlign: 'right' }}>REB</span><span style={{ textAlign: 'right' }}>AST</span>
        </div>
        {rows.map((r) => (
          <div key={r.player} style={{ display: 'grid', gridTemplateColumns: '1fr 32px 44px 44px 44px', padding: '5px 0', fontFamily: family, fontSize: 13, borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <span style={{ fontWeight: 500 }}>{r.player}</span>
            <span style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>{r.pos}</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.pts}</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.reb}</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.ast}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {['Sim Day', 'Make Trade', 'Sign Player'].map((lbl) => (
          <span key={lbl} style={{ fontFamily: family, fontSize: 13, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{lbl}</span>
        ))}
      </div>
    </Card>
  );
}

// ── Recent games strip (for mock screen) ────────────────────────────────────
const recentGames = [
  { opp: 'BOS', result: 'W', score: '112–98' },
  { opp: 'MIL', result: 'W', score: '108–104' },
  { opp: 'NYK', result: 'L', score: '97–101' },
  { opp: 'MIA', result: 'W', score: '119–111' },
  { opp: 'CHI', result: 'W', score: '103–91' },
];

// ── Main component ───────────────────────────────────────────────────────────
export default function StyleGuide() {
  const [activeTab, setActiveTab] = useState('layout');
  const [activeRosterTab, setActiveRosterTab] = useState('stats');
  const [modalOpen, setModalOpen] = useState(false);
  const [sortKey, setSortKey] = useState('ovr');

  useEffect(() => {
    const id = 'sg-gfonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = GFONTS_URL;
    document.head.appendChild(link);
  }, []);

  return (
    <div className="page-fade" style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', letterSpacing: 1 }}>Design System</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>NBA GM — tokens, primitives, and shared components</div>
        </div>
        <Badge variant="info">v1.0</Badge>
      </div>

      <Tabs
        tabs={[
          { key: 'layout',     label: 'Layout Philosophy' },
          { key: 'palette',    label: 'Palette & Tokens' },
          { key: 'typography', label: 'Typography' },
          { key: 'fonts',      label: 'Font Options' },
          { key: 'primitives', label: 'Primitives' },
          { key: 'shared',     label: 'Shared Components' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* ═══════════════════════════════════════════════════════
          LAYOUT PHILOSOPHY
      ═══════════════════════════════════════════════════════ */}
      {activeTab === 'layout' && (
        <>
          {/* ── Info banner ── */}
          <Card elevation="flush" style={{ marginBottom: 'var(--sp-6)', padding: 'var(--sp-3) var(--sp-4)', borderLeft: '3px solid var(--color-info)', borderRadius: 0, background: 'var(--color-info-soft)' }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
              <strong>New default:</strong> content sits on the base surface, separated by whitespace and dividers.
              Cards are reserved for lifted/interactive elements. Use <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>Section</code> + <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>Divider</code> for everything else.
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-8)', alignItems: 'start' }}>

            {/* ── LEFT: Integrated (new philosophy) ── */}
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 'var(--sp-4)' }}>
                ✓ Integrated — new approach
              </div>

              {/* Fake screen title */}
              <div style={{ marginBottom: 'var(--sp-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <TeamBadge team={demoTeam} size="medium" />
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: 0.5 }}>
                      {demoTeam.city} {demoTeam.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>2026 Season · West · Southwest</div>
                  </div>
                  <Badge variant="success" style={{ marginLeft: 'auto' }}>47–18</Badge>
                </div>
              </div>

              {/* Key stats — bare surface, no card wrapper */}
              <Section title="Season at a Glance">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2) var(--sp-4)' }}>
                  <Stat value="47–18" label="Record"   size="md" />
                  <Stat value="114.2" label="Pts / G"  size="md" />
                  <Stat value="108.4" label="Opp / G"  size="md" />
                  <Stat value="+5.8"  label="Net RTG"  size="md" color="var(--color-success)" />
                </div>
              </Section>

              <Divider />

              {/* Recent form — inline, no card */}
              <Section title="Recent Form" subtitle="Last 5 games">
                <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                  {recentGames.map((g) => (
                    <div key={g.opp + g.score} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 3 }}>{g.opp}</div>
                      <div style={{
                        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-md)',
                        color: g.result === 'W' ? 'var(--color-success)' : 'var(--color-danger)',
                      }}>{g.result}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{g.score}</div>
                    </div>
                  ))}
                </div>
              </Section>

              <Divider />

              {/* Roster table — bare, no wrapping card */}
              <Section
                title="Roster"
                subtitle="Starters · Click a row to open"
                action={<Button size="sm" variant="ghost">Full roster →</Button>}
              >
                <Tabs tabs={[{ key: 'stats', label: 'Stats' }, { key: 'contract', label: 'Contract' }]} activeTab={activeRosterTab} onTabChange={setActiveRosterTab} noMargin />
                <div style={{ marginTop: 'var(--sp-3)' }}>
                  <Table columns={rosterCols} rows={rosterRows} sortKey={sortKey} onSort={setSortKey} />
                </div>
              </Section>

              {/* One genuine card: a highlighted callout */}
              <Divider />
              <Section title="Owner Standing">
                <Card elevation="raised" style={{ borderLeft: '3px solid var(--color-warning)', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Hot seat warning</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                      Win at least 50 games or a playoff series to secure your position.
                    </div>
                  </div>
                  <Badge variant="warning">38% approval</Badge>
                </Card>
              </Section>
            </div>

            {/* ── RIGHT: Old approach (for contrast) ── */}
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 'var(--sp-4)' }}>
                ✗ Paneled — old approach
              </div>

              {/* Same content wrapped in cards the old way */}
              <Card style={{ marginBottom: 'var(--sp-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <TeamBadge team={demoTeam} size="medium" />
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700 }}>{demoTeam.city} {demoTeam.name}</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>2026 Season · West</div>
                  </div>
                  <Badge variant="success" style={{ marginLeft: 'auto' }}>47–18</Badge>
                </div>
              </Card>

              <Card style={{ marginBottom: 'var(--sp-4)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-primary)', marginBottom: 'var(--sp-3)' }}>Season at a Glance</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2) var(--sp-4)' }}>
                  <Stat value="47–18" label="Record" size="md" />
                  <Stat value="114.2" label="Pts / G" size="md" />
                  <Stat value="108.4" label="Opp / G" size="md" />
                  <Stat value="+5.8" label="Net RTG" size="md" color="var(--color-success)" />
                </div>
              </Card>

              <Card style={{ marginBottom: 'var(--sp-4)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-primary)', marginBottom: 'var(--sp-3)' }}>Recent Form</div>
                <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                  {recentGames.map((g) => (
                    <div key={g.opp + g.score} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 3 }}>{g.opp}</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-md)', color: g.result === 'W' ? 'var(--color-success)' : 'var(--color-danger)' }}>{g.result}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{g.score}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card noPad style={{ marginBottom: 'var(--sp-4)' }}>
                <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-primary)' }}>Roster</div>
                <Table columns={rosterCols} rows={rosterRows.slice(0, 3)} />
              </Card>

              <Card style={{ borderLeft: '3px solid var(--color-warning)', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Hot seat warning</div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Win at least 50 games or a playoff series.</div>
                </div>
                <Badge variant="warning">38%</Badge>
              </Card>
            </div>

          </div>

          {/* ── Primitive reference ── */}
          <Divider space="lg" />
          <Section title="New Primitives Reference" subtitle="Section, Divider, Card flush/bare">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-2)' }}>&lt;Section title="..." &gt;</div>
                <div style={{ padding: 'var(--sp-4)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <Section title="Example Section" subtitle="No border, no bg — just space and a header">
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Content sits directly on the surface.</div>
                  </Section>
                  <Section title="Another Section" spacing="sm">
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Smaller spacing between these two.</div>
                  </Section>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-2)' }}>&lt;Divider /&gt; · space sm / md / lg</div>
                <div style={{ padding: 'var(--sp-4)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Content above</div>
                  <Divider space="sm" />
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>sm spacing</div>
                  <Divider space="md" />
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>md spacing (default)</div>
                  <Divider space="lg" />
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>lg spacing</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-2)' }}>Card elevation="flush"</div>
                <Card elevation="flush">
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Transparent bg and border. Keeps padding. Blends into surface — use for grouping without visual boxing.</div>
                </Card>
              </div>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 'var(--sp-2)' }}>Card elevation variants</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <Card elevation="sunken"><span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>sunken — recessed inputs, code</span></Card>
                  <Card elevation="flat"><span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>flat — interactive widgets, data panels</span></Card>
                  <Card elevation="raised"><span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>raised — callouts, highlighted rows</span></Card>
                </div>
              </div>

            </div>
          </Section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          PALETTE & TOKENS
      ═══════════════════════════════════════════════════════ */}
      {activeTab === 'palette' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <Card><SectionHeader title="Surfaces" /><Swatch label="Background" token="--bg" /><Swatch label="Panel" token="--panel" /><Swatch label="Panel 2" token="--panel2" /><Swatch label="Border" token="--border" /></Card>
          <Card><SectionHeader title="Text Scale" /><Swatch label="Primary" token="--text" hex="#e6edf3" /><Swatch label="Secondary" hex="#c9d1d9" /><Swatch label="Muted" token="--muted" hex="#8b949e" /><Swatch label="Disabled" hex="#484f58" /></Card>
          <Card><SectionHeader title="Semantic Colors" /><Swatch label="Primary / Accent" token="--accent" /><Swatch label="Success / Green" token="--green" /><Swatch label="Danger / Red" token="--red" /><Swatch label="Warning / Yellow" token="--yellow" /><Swatch label="Info / Blue" hex="#58a6ff" /><Swatch label="Elite / Purple" hex="#d2a8ff" /></Card>
          <Card><SectionHeader title="Semantic Soft" /><Swatch label="Primary soft" token="--color-primary-soft" /><Swatch label="Success soft" token="--color-success-soft" /><Swatch label="Danger soft" token="--color-danger-soft" /><Swatch label="Warning soft" token="--color-warning-soft" /><Swatch label="Info soft" token="--color-info-soft" /><Swatch label="Elite soft" token="--color-elite-soft" /></Card>
          <Card><SectionHeader title="Position Accents" /><Swatch label="PG – Point Guard" token="--pos-pg" /><Swatch label="SG – Shooting Guard" token="--pos-sg" /><Swatch label="SF – Small Forward" token="--pos-sf" /><Swatch label="PF – Power Forward" token="--pos-pf" /><Swatch label="C  – Center" token="--pos-c" /></Card>
          <Card><SectionHeader title="Spacing Scale" />{[1,2,3,4,5,6,8,10,12,16].map((n) => (<div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><div style={{ background: 'var(--color-primary)', height: 8, width: `var(--sp-${n})`, borderRadius: 2, flexShrink: 0 }} /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>--sp-{n}</span></div>))}</Card>
          <Card><SectionHeader title="Border Radius" />{['xs','sm','md','lg','xl','2xl','full'].map((k) => (<div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><div style={{ width: 40, height: 20, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: `var(--radius-${k})`, flexShrink: 0 }} /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>--radius-{k}</span></div>))}</Card>
          <Card><SectionHeader title="Shadow / Elevation" />{['sm','md','lg','xl'].map((s) => (<div key={s} style={{ background: 'var(--surface-1)', boxShadow: `var(--shadow-${s})`, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-2) var(--sp-4)', marginBottom: 'var(--sp-3)' }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>--shadow-{s}</span></div>))}</Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          TYPOGRAPHY
      ═══════════════════════════════════════════════════════ */}
      {activeTab === 'typography' && (
        <Card>
          <SectionHeader title="Type Scale" subtitle="Display: Oswald · UI: Inter · Mono: SF Mono / Fira Code" />
          <TypeRow label="--text-display / 40px" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-display)', fontWeight: 700 }} />
          <TypeRow label="--text-3xl / 28px"     style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700 }} />
          <TypeRow label="--text-2xl / 22px"     style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 700 }} />
          <TypeRow label="--text-xl / 18px"      style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }} />
          <TypeRow label="--text-lg / 16px"      style={{ fontSize: 'var(--text-lg)' }} />
          <TypeRow label="--text-md / 15px"      style={{ fontSize: 'var(--text-md)' }} />
          <TypeRow label="--text-base / 14px"    style={{ fontSize: 'var(--text-base)' }} />
          <TypeRow label="--text-sm / 12px"      style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }} />
          <TypeRow label="--text-xs / 11px"      style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }} />
          <SectionHeader title="Tabular Numerics" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
            {[['28.4','Points'],['11.2','Rebounds'],['9.7','Assists'],['52.1','FG%']].map(([v,l]) => <Stat key={l} value={v} label={l} size="lg" center />)}
          </div>
          <SectionHeader title="Stat Sizes" />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
            <Stat value="88"   label="sm · Overall" size="sm" />
            <Stat value="24.3" label="md · Points"  size="md" />
            <Stat value="9.7"  label="lg · Assists" size="lg" />
            <Stat value="28"   label="xl · Minutes" size="xl" />
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
          FONT OPTIONS
      ═══════════════════════════════════════════════════════ */}
      {activeTab === 'fonts' && (
        <>
          <Card style={{ marginBottom: 'var(--sp-5)', background: 'var(--color-info-soft)', borderColor: 'var(--color-info-line)' }}>
            <div style={{ fontSize: 'var(--text-sm)' }}><strong>Preview only</strong> — these fonts are loaded from Google Fonts for comparison. Active app fonts are unchanged.</div>
          </Card>
          <Section title="Display Font — headings, section titles, big stat numbers (7 candidates)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
              {DISPLAY_FONTS.map((f) => <DisplayFontCard key={f.name} {...f} />)}
            </div>
          </Section>
          <Section title="UI / Body Font — navigation, labels, body, buttons, tables (5 candidates)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
              {UI_FONTS.map((f) => <UIFontCard key={f.name} {...f} />)}
            </div>
          </Section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          PRIMITIVES
      ═══════════════════════════════════════════════════════ */}
      {activeTab === 'primitives' && (
        <>
          <Section title="Button — Variants × Sizes">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="primary" disabled>Disabled</Button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary" size="md">Medium</Button>
              <Button variant="primary" size="lg">Large</Button>
            </div>
          </Section>

          <Divider />

          <Section title="Badge & Pill — Variants">
            <div style={{ marginBottom: 'var(--sp-3)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', textTransform: 'uppercase', letterSpacing: 1 }}>Badges</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                {['default','primary','success','danger','warning','info','elite'].map((v) => <Badge key={v} variant={v}>{v}</Badge>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', textTransform: 'uppercase', letterSpacing: 1 }}>Pills</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                {['default','primary','success','danger','warning','info','elite'].map((v) => <Pill key={v} variant={v}>{v}</Pill>)}
              </div>
            </div>
          </Section>

          <Divider />

          <Section title="ProgressBar — Variants × Sizes">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', maxWidth: 480 }}>
              {['primary','success','danger','warning','info','elite'].map((v, i) => <ProgressBar key={v} value={30 + i * 12} variant={v} label={v} />)}
              <Divider space="sm" />
              <ProgressBar value={65} size="sm" />
              <ProgressBar value={65} size="md" />
              <ProgressBar value={65} size="lg" />
            </div>
          </Section>

          <Divider />

          <Section title="Tabs">
            <Tabs tabs={[{key:'a',label:'Overview'},{key:'b',label:'Stats'},{key:'c',label:'Contract'},{key:'d',label:'History'}]} activeTab="b" onTabChange={() => {}} noMargin />
          </Section>

          <Divider />

          <Section title="SectionHeader">
            <SectionHeader title="League Leaders" />
            <SectionHeader title="Trade Machine" subtitle="Build a trade proposal" action={<Button size="sm" variant="secondary">Reset</Button>} />
            <SectionHeader title="Free Agents" subtitle="42 available" action={<><Button size="sm" variant="ghost">Filter</Button><Button size="sm" variant="primary">Sort</Button></>} />
          </Section>

          <Divider />

          <Section title="Tooltip">
            <div style={{ display: 'flex', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
              {['top','bottom','left','right'].map((pos) => (
                <Tooltip key={pos} content={`Tooltip · ${pos}`} position={pos}><Button variant="secondary" size="sm">{pos}</Button></Tooltip>
              ))}
            </div>
          </Section>

          <Divider />

          <Section title="Modal">
            <Button variant="primary" onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Example Modal">
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>Closes on Escape, ✕, and backdrop click.</p>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>Confirm</Button>
              </div>
            </Modal>
          </Section>

          <Divider />

          <Section title="Table — Sortable, Sticky Header, Zebra">
            <Table columns={rosterCols} rows={rosterRows} sortKey={sortKey} onSort={setSortKey} stickyHead zebra />
          </Section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          SHARED COMPONENTS
      ═══════════════════════════════════════════════════════ */}
      {activeTab === 'shared' && (
        <>
          <Section title="Rating Components (Ovr / Pot / Sta)">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-8)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Own team</div>
                <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
                  <Ovr p={demoPlayer} league={demoLeague} fogged={false} />
                  <Pot p={demoPlayer} league={demoLeague} fogged={false} />
                  <Sta p={demoPlayer} league={demoLeague} fogged={false} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Opponent (fogged)</div>
                <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
                  <Ovr p={demoPlayer} league={demoLeague} fogged={true} />
                  <Pot p={demoPlayer} league={demoLeague} fogged={true} />
                  <Sta p={demoPlayer} league={demoLeague} fogged={true} />
                </div>
              </div>
            </div>
          </Section>

          <Divider />

          <Section title="TeamBadge — Sizes">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)', alignItems: 'center' }}>
              {['small','medium','large'].map((size) => (
                <div key={size} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <TeamBadge team={demoTeam} size={size} />
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{size}</span>
                </div>
              ))}
              {TEAMS.slice(0, 10).map((t) => <TeamBadge key={t.id} team={t} size="small" />)}
            </div>
          </Section>

          <Divider />

          <Section title="money() Formatter">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-6)' }}>
              {[['Rookie deal',2_500_000],['Mid-level',12_400_000],['Max contract',47_100_000],['League payroll',1_340_000_000]].map(([label,amount]) => (
                <Stat key={label} value={money(amount)} label={label} size="md" />
              ))}
            </div>
          </Section>

          <Divider />

          <Section title="OVR Tier Color Coding">
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'center' }}>
              {[{ovr:88,label:'Elite (85+)',cls:'elite'},{ovr:78,label:'Great (75–84)',cls:'great'},{ovr:68,label:'Good (65–74)',cls:'good'},{ovr:58,label:'OK (55–64)',cls:'ok'},{ovr:48,label:'Bad (<55)',cls:'bad'}].map(({ovr,label,cls}) => (
                <div key={cls} style={{ textAlign: 'center' }}>
                  <div className={`ovr ${cls}`} style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{ovr}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </Section>

          <Divider />

          <Section title="Team Color Accents (subtle use)">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
              {TEAMS.slice(0, 15).map((t) => (
                <div key={t.id} style={{ padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-md)', background: 'var(--surface-1)', border: '1px solid var(--border)', borderLeft: `3px solid ${t.color}`, fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: t.color, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{t.id}</span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>{t.name}</span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
