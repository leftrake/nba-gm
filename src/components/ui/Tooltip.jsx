import React, { useState } from 'react';

// content:  string or node shown in the floating tip
// position: 'top' (default) | 'bottom' | 'left' | 'right'
// children: the element that triggers the tooltip on hover
export function Tooltip({ content, position = 'top', children }) {
  const [show, setShow] = useState(false);

  if (!content) return <>{children}</>;

  return (
    <span
      className="ui-tooltip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span className={`ui-tooltip-content ui-tooltip-content--${position}`} role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
