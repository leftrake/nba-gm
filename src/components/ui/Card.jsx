import React from 'react';

// elevation: 'flat' (default) | 'raised' | 'sunken' | 'flush' | 'bare'
//   flat   — panel bg + border. Reserve for genuinely distinct interactive widgets.
//   raised — subtly above the surface (shadow-sm). Callouts, highlighted rows.
//   sunken — recessed input areas, code blocks.
//   flush  — transparent bg/border, keeps padding. Blends into the surface.
//   bare   — fully transparent, no padding. Pure structural wrapper.
// noPad: strips padding regardless of elevation (e.g. tables that bleed to edges)
export function Card({ children, elevation = 'flat', noPad, noBorder, as: As = 'div', className = '', style, ...props }) {
  const cls = [
    'ui-card',
    elevation !== 'flat' && `ui-card--${elevation}`,
    noPad && 'ui-card--no-pad',
    noBorder && 'ui-card--no-border',
    className,
  ].filter(Boolean).join(' ');

  return <As className={cls} style={style} {...props}>{children}</As>;
}
