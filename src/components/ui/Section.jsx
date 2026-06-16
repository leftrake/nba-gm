import React from 'react';
import { SectionHeader } from './SectionHeader.jsx';

// Borderless content group — the default way to organize screen content.
// Content sits directly on the base surface; hierarchy comes from whitespace
// and the SectionHeader, not from a border or background.
//
// title, subtitle, action: forwarded to SectionHeader (all optional)
// spacing: 'sm' | 'md' (default) | 'lg' — bottom margin between sections
export function Section({ title, subtitle, action, children, spacing = 'md', className = '', style }) {
  const marginMap = { sm: 'var(--sp-5)', md: 'var(--sp-8)', lg: 'var(--sp-12)' };
  return (
    <div
      className={`ui-section ${className}`}
      style={{ marginBottom: marginMap[spacing] ?? marginMap.md, ...style }}
    >
      {title && <SectionHeader title={title} subtitle={subtitle} action={action} />}
      {children}
    </div>
  );
}
