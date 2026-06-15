import React, { useEffect, useState } from 'react';
import { markWalkthroughDone } from './shared.jsx';

// Five-step first-session tour. Each step spotlights a `[data-tour="..."]`
// element somewhere in the app; `fallback` is tried if the primary target
// isn't on screen (e.g. the Scouting tab only exists in the offseason).
const STEPS = [
  {
    tour: 'roster-tab',
    title: 'Your Roster',
    text: "This is your team. Your players' exact ratings are visible — but players on other teams and in free agency show rating ranges until you scout them. The better you scout, the tighter the range.",
  },
  {
    tour: 'cap-bar',
    title: 'The Salary Cap',
    text: 'Every team has a $141M salary cap. Go over it and you pay a luxury tax — manageable once, painful if repeated. Go way over the apron ($192M) and your moves get restricted. Build smart or pay the price.',
  },
  {
    tour: 'owner-card',
    title: 'Your Owner',
    text: 'Your owner has expectations based on your roster and market. Meet them and your budget grows. Miss them repeatedly and you get fired. Watch the approval rating — it tells you how much runway you have.',
  },
  {
    tour: 'sim-controls',
    title: 'Sim Controls',
    text: 'Use Sim to Next Game to watch your team play, or Sim Week to move faster. After the regular season comes the playoffs, then the offseason — extensions, free agency, and the draft.',
  },
  {
    tour: 'scouting-tab',
    fallback: 'news-feed',
    title: 'The Draft and Scouting',
    text: 'Every offseason you get a scouting budget. Spend it watching prospects before the draft — the more you scout a player, the more accurate his rating range becomes. Undrafted gems exist. Find them before other teams do.',
  },
];

const MARGIN = 8;

function findTarget(step) {
  return (
    document.querySelector(`[data-tour="${step.tour}"]`)
    || (step.fallback ? document.querySelector(`[data-tour="${step.fallback}"]`) : null)
  );
}

export default function Walkthrough({ onDone }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const done = step >= STEPS.length;

  useEffect(() => {
    if (done) { setRect(null); return; }
    let raf;
    const update = () => {
      const el = findTarget(STEPS[step]);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const el = findTarget(STEPS[step]);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    update();
    const t = setTimeout(update, 350); // after the smooth-scroll settles
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step, done]);

  const finish = () => {
    markWalkthroughDone();
    onDone();
  };

  const next = () => setStep((s) => s + 1);

  // Position the card just outside the spotlighted rect, clamped to the
  // viewport. Falls back to centered if there's nothing to point at.
  let cardStyle;
  if (rect) {
    const cardWidth = 320;
    let top = rect.bottom + 16;
    if (top + 180 > window.innerHeight) top = Math.max(MARGIN, rect.top - 180 - MARGIN);
    let left = rect.left;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - cardWidth - MARGIN);
    cardStyle = { top, left };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <>
      {rect ? (
        <div
          className="walkthrough-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div className="walkthrough-backdrop" />
      )}

      {!done && (
        <a className="walkthrough-skip" onClick={finish}>Skip tutorial</a>
      )}

      <div className="walkthrough-card" style={cardStyle}>
        {!done ? (
          <>
            <h3>{STEPS[step].title}</h3>
            <p>{STEPS[step].text}</p>
            <div className="controls" style={{ marginBottom: 0 }}>
              <button className="btn" onClick={next}>Got it →</button>
            </div>
          </>
        ) : (
          <>
            <h3>That's the basics</h3>
            <p>The rest you'll figure out — or find in tooltips as you go. Good luck, GM.</p>
            <div className="controls" style={{ marginBottom: 0 }}>
              <button className="btn" onClick={finish}>Start Managing</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
