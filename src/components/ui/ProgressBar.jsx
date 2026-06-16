import React from 'react';

// value:   0–100
// variant: 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'elite'
// size:    'sm' | 'md' | 'lg'
// label:   optional — shows label left and value% right above the bar
export function ProgressBar({ value, variant = 'primary', size = 'md', label, className = '' }) {
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const barCls = `ui-progress ui-progress--${size} ${className}`;
  const fillCls = `ui-progress__fill ui-progress__fill--${variant}`;

  if (label) {
    return (
      <div className="ui-progress-wrap">
        <div className="ui-progress-meta">
          <span>{label}</span>
          <span>{clamped}%</span>
        </div>
        <div className={barCls}>
          <div className={fillCls} style={{ width: `${clamped}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className={barCls}>
      <div className={fillCls} style={{ width: `${clamped}%` }} />
    </div>
  );
}
