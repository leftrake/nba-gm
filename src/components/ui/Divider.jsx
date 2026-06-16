import React from 'react';

// Thin horizontal rule for separating content areas without boxing them.
// space: 'sm' | 'md' (default) | 'lg' — controls the vertical margin
// inset: true → indent left/right by --sp-4 (for use inside padded containers)
export function Divider({ space = 'md', inset, className = '', style }) {
  const cls = ['ui-divider', `ui-divider--${space}`, inset && 'ui-divider--inset', className]
    .filter(Boolean).join(' ');
  return <hr className={cls} style={style} />;
}
