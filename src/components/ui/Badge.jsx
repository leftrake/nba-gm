import React from 'react';

// variant: 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'elite'
// pill:    true for fully rounded shape
export function Badge({ children, variant = 'default', pill, className = '', style, ...props }) {
  const base = pill ? 'ui-pill' : 'ui-badge';
  const cls = [`${base}`, `${base}--${variant}`, className].filter(Boolean).join(' ');
  return <span className={cls} style={style} {...props}>{children}</span>;
}

// Convenience alias
export function Pill({ children, variant = 'default', className = '', style, ...props }) {
  return <Badge pill variant={variant} className={className} style={style} {...props}>{children}</Badge>;
}
