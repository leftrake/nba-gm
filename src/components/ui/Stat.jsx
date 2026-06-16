import React from 'react';

// Broadcast-style big number with a label beneath it.
// size:   'sm' | 'md' | 'lg' | 'xl'
// center: true to center-align value+label
// color:  optional CSS color override for the value
export function Stat({ value, label, size = 'md', center, color, className = '' }) {
  const cls = ['ui-stat', `ui-stat--${size}`, center && 'ui-stat--center', className]
    .filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <span className="ui-stat__value" style={color ? { color } : undefined}>{value}</span>
      {label && <span className="ui-stat__label">{label}</span>}
    </div>
  );
}
