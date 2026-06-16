import React from 'react';

// variant: 'primary' | 'secondary' | 'ghost' | 'danger'
// size:    'sm' | 'md' | 'lg'
export function Button({ children, variant = 'primary', size = 'md', as: As = 'button', className = '', ...props }) {
  const cls = [
    'ui-btn',
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    className,
  ].filter(Boolean).join(' ');

  return <As className={cls} {...props}>{children}</As>;
}
