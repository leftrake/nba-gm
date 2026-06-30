import React, { useState, useEffect } from 'react';
import { NewsText } from './TeamDisplay.jsx';

// Horizontal headline ticker: the 10 most recent news items, auto-advancing
// every few seconds (paused once a headline is expanded), with prev/next
// arrows and dot navigation. Clicking a headline toggles its full text.
export default function NewsTicker({ league, openTeam }) {
  const items = league.news.slice(0, 10);
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded || items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [items.length, expanded]);

  useEffect(() => { setExpanded(false); }, [idx]);

  if (items.length === 0) return null;
  const cur = items[idx % items.length];

  return (
    <div className="ticker">
      <span className="ticker-tag">News</span>
      <div className="ticker-body">
        <div className={`ticker-item${expanded ? ' expanded' : ''}`} onClick={() => setExpanded((e) => !e)} key={idx}>
          <NewsText text={cur.text} openTeam={openTeam} />
        </div>
      </div>
      <div className="ticker-nav">
        <button onClick={() => setIdx((i) => (i - 1 + items.length) % items.length)} aria-label="Previous">◂</button>
        <button onClick={() => setIdx((i) => (i + 1) % items.length)} aria-label="Next">▸</button>
      </div>
      <div className="ticker-dots">
        {items.map((_, i) => (
          <span key={i} className={`ticker-dot${i === idx ? ' active' : ''}`} onClick={() => setIdx(i)} />
        ))}
      </div>
    </div>
  );
}
