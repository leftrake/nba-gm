import React, { useState, useEffect, useRef } from 'react';

// Onboarding: Layer 1 walkthrough + Layer 2 first-encounter tooltips.
// Kept entirely separate from the main save: tooltip flags live under one
// flat object, the walkthrough under its own boolean.
export const TOOLTIPS_KEY = 'nba-gm-tooltips';
export const WALKTHROUGH_KEY = 'nba-gm-walkthrough-done';

function loadSeenTooltips() {
  try {
    return JSON.parse(localStorage.getItem(TOOLTIPS_KEY)) || {};
  } catch {
    return {};
  }
}

export function hasSeenTooltip(key) {
  return !!loadSeenTooltips()[`tt_${key}`];
}

export function markTooltipSeen(key) {
  try {
    const seen = loadSeenTooltips();
    seen[`tt_${key}`] = true;
    localStorage.setItem(TOOLTIPS_KEY, JSON.stringify(seen));
  } catch {}
}

export function isWalkthroughDone() {
  try {
    return localStorage.getItem(WALKTHROUGH_KEY) === 'true';
  } catch {
    return true;
  }
}

export function markWalkthroughDone() {
  try { localStorage.setItem(WALKTHROUGH_KEY, 'true'); } catch {}
}

// Clears both onboarding keys so the first-session walkthrough and every
// first-encounter tooltip fire again, as if this were a brand new save.
export function resetTutorial() {
  try {
    localStorage.removeItem(TOOLTIPS_KEY);
    localStorage.removeItem(WALKTHROUGH_KEY);
  } catch {}
}

// Wraps `children` with a small popover shown the first time `tipKey` is
// encountered. Dismissed via the ✕ or by clicking anywhere outside; once
// dismissed (this session or a previous one), renders just the children.
export function GuideTooltip({ tipKey, text, children, block }) {
  const [seen, setSeen] = useState(() => hasSeenTooltip(tipKey));
  const ref = useRef(null);

  useEffect(() => {
    if (seen) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) dismiss();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const dismiss = () => {
    markTooltipSeen(tipKey);
    setSeen(true);
  };

  if (seen) return <>{children}</>;

  return (
    <span ref={ref} className={`guide-tooltip-anchor${block ? ' block' : ''}`}>
      {children}
      <div className="guide-tooltip-popover">
        <button className="guide-tooltip-close" onClick={dismiss} aria-label="Dismiss">✕</button>
        <p>{text}</p>
      </div>
    </span>
  );
}
