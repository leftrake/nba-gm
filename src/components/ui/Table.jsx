import React from 'react';

// columns: [{ key, label, align?: 'left'|'right'|'center', numeric?, sortable?, render? }]
//   - render(row, i) overrides the default cell value (row[col.key])
// rows:        array of objects (key → value)
// onRowClick:  (row) => void
// sortKey:     current sort column key
// onSort:      (key) => void
// stickyHead:  true → sticky header
// zebra:       true → alternating row tint
// className:   extra class on the wrapper div
export function Table({ columns, rows, onRowClick, sortKey, onSort, stickyHead, zebra, className = '' }) {
  const tableCls = ['ui-table', stickyHead && 'sticky-head', zebra && 'zebra']
    .filter(Boolean).join(' ');

  return (
    <div className={`ui-table-wrap ${className}`}>
      <table className={tableCls}>
        <thead>
          <tr>
            {columns.map((col) => {
              const isNum = col.numeric ?? col.align === 'right';
              const isSorted = sortKey === col.key;
              const cls = [isNum && 'num', col.sortable && 'sortable', isSorted && 'sorted']
                .filter(Boolean).join(' ');
              return (
                <th
                  key={col.key}
                  className={cls || undefined}
                  style={col.align && !isNum ? { textAlign: col.align } : undefined}
                  onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                  title={col.title}
                >
                  {col.label}
                  {isSorted && <span style={{ marginLeft: 3 }}>▴</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row._key ?? i}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => {
                const isNum = col.numeric ?? col.align === 'right';
                const cls = isNum ? 'num' : undefined;
                const cell = col.render ? col.render(row, i) : row[col.key];
                return (
                  <td
                    key={col.key}
                    className={cls}
                    style={col.align && !isNum ? { textAlign: col.align } : undefined}
                  >
                    {cell ?? '—'}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--sp-8)' }}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
