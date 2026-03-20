/**
 * Mudbrick v2 -- RibbonTabStrip
 *
 * Horizontal tab strip for the 6 ribbon tabs.
 * Double-click a tab to collapse/expand the ribbon panel.
 */

import { useCallback, useRef } from 'react';
import { RIBBON_TABS, type RibbonTabId } from '../../../services/commandRegistry';
import { useUIStore } from '../../../stores/uiStore';
import styles from './RibbonTabStrip.module.css';

export function RibbonTabStrip() {
  const ribbonTab = useUIStore((s) => s.ribbonTab);
  const setRibbonTab = useUIStore((s) => s.setRibbonTab);
  const ribbonCollapsed = useUIStore((s) => s.ribbonCollapsed);
  const toggleRibbonCollapsed = useUIStore((s) => s.toggleRibbonCollapsed);
  const setRibbonCollapsed = useUIStore((s) => s.setRibbonCollapsed);

  const lastClickRef = useRef<{ tab: RibbonTabId; time: number } | null>(null);

  const handleClick = useCallback(
    (tab: RibbonTabId) => {
      const now = Date.now();
      const last = lastClickRef.current;

      // Double-click detection (same tab within 400ms)
      if (last && last.tab === tab && now - last.time < 400) {
        toggleRibbonCollapsed();
        lastClickRef.current = null;
        return;
      }

      lastClickRef.current = { tab, time: now };

      if (ribbonCollapsed) {
        // Clicking any tab when collapsed should expand and select
        setRibbonCollapsed(false);
        setRibbonTab(tab);
      } else {
        setRibbonTab(tab);
      }
    },
    [ribbonCollapsed, setRibbonTab, setRibbonCollapsed, toggleRibbonCollapsed],
  );

  return (
    <div className={styles.strip} role="tablist" aria-label="Ribbon tabs">
      {RIBBON_TABS.map((tab) => (
        <button
          key={tab.id}
          className={styles.tab}
          data-active={ribbonTab === tab.id && !ribbonCollapsed}
          role="tab"
          aria-selected={ribbonTab === tab.id && !ribbonCollapsed}
          aria-controls={`ribbon-panel-${tab.id}`}
          onClick={() => handleClick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
