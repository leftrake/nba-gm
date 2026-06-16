import React from 'react';

// title:    required — display-font uppercase label
// subtitle: optional secondary line beneath title
// action:   optional node rendered on the right (buttons, filters, etc.)
export function SectionHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`ui-section-header ${className}`}>
      <div className="ui-section-header__left">
        <div className="ui-section-title">{title}</div>
        {subtitle && <div className="ui-section-subtitle">{subtitle}</div>}
      </div>
      {action && <div className="ui-section-header__action">{action}</div>}
    </div>
  );
}
