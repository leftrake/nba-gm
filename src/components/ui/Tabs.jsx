import React from 'react';

// tabs:        [{ key, label }]
// activeTab:   key of the active tab
// onTabChange: (key) => void
// noMargin:    suppress the bottom margin
export function Tabs({ tabs, activeTab, onTabChange, noMargin, className = '' }) {
  return (
    <div className={`ui-tabs${noMargin ? ' ui-tabs--no-margin' : ''} ${className}`}>
      {tabs.map(({ key, label, disabled }) => (
        <button
          key={key}
          className={`ui-tab${activeTab === key ? ' ui-tab--active' : ''}`}
          disabled={disabled}
          onClick={() => onTabChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
