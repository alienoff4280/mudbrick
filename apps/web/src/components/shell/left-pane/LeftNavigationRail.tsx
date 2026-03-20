/**
 * Mudbrick v2 -- LeftNavigationRail
 *
 * Vertical icon rail for switching left pane content:
 * Pages, Outline, Search, Attachments.
 */

import { useCallback } from 'react';
import { useUIStore, type LeftPaneMode } from '../../../stores/uiStore';
import styles from './LeftNavigationRail.module.css';

interface RailItem {
  id: LeftPaneMode;
  label: string;
  icon: string; // SVG path
  disabled?: boolean;
}

const RAIL_ITEMS: RailItem[] = [
  {
    id: 'pages',
    label: 'Pages',
    icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  },
  {
    id: 'outline',
    label: 'Outline',
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    id: 'search',
    label: 'Search',
    icon: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  },
  {
    id: 'attachments',
    label: 'Files',
    icon: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  },
];

export function LeftNavigationRail() {
  const leftPaneMode = useUIStore((s) => s.leftPaneMode);
  const setLeftPaneMode = useUIStore((s) => s.setLeftPaneMode);

  const handleClick = useCallback(
    (mode: LeftPaneMode) => {
      setLeftPaneMode(mode);
    },
    [setLeftPaneMode],
  );

  return (
    <nav
      className={styles.rail}
      role="tablist"
      aria-label="Left pane navigation"
      aria-orientation="vertical"
    >
      {RAIL_ITEMS.map((item) => (
        <button
          key={item.id}
          className={styles.railBtn}
          data-active={leftPaneMode === item.id}
          role="tab"
          aria-selected={leftPaneMode === item.id}
          aria-controls={`left-pane-${item.id}`}
          disabled={item.disabled}
          title={item.label}
          onClick={() => handleClick(item.id)}
        >
          <svg
            className={styles.railIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={item.icon} />
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
