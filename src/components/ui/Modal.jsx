import React, { useEffect } from 'react';

// open:    controlled open state
// onClose: called when overlay or ✕ is clicked
// title:   optional header title
// wide:    expands to 1040px max-width
export function Modal({ open, onClose, title, wide, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`ui-modal${wide ? ' ui-modal--wide' : ''}`} role="dialog" aria-modal="true">
        {(title || onClose) && (
          <div className="ui-modal-header">
            {title && <div className="ui-modal-title">{title}</div>}
            {onClose && (
              <button className="ui-modal-close" onClick={onClose} aria-label="Close">✕</button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
