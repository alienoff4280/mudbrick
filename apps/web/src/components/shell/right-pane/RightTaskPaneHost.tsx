/**
 * Mudbrick v2 -- RightTaskPaneHost
 *
 * Hosts context-sensitive task panes on the right side:
 * properties, redaction, security, compare, forms, ocr.
 *
 * Only one mode is visible at a time. Collapsible.
 * Renders existing feature components inside a consistent shell.
 */

import { PropertyPanel } from '../../annotations/PropertyPanel';
import { useUIStore, type RightPaneMode } from '../../../stores/uiStore';
import styles from './RightTaskPaneHost.module.css';

const MODE_LABELS: Record<NonNullable<RightPaneMode>, string> = {
  properties: 'Properties',
  redaction: 'Redaction',
  security: 'Security',
  compare: 'Compare',
  forms: 'Forms',
  ocr: 'OCR',
};

export function RightTaskPaneHost() {
  const rightPaneMode = useUIStore((s) => s.rightPaneMode);
  const closeRightPane = useUIStore((s) => s.closeRightPane);

  if (!rightPaneMode) {
    return (
      <div className={styles.pane}>
        <div className={styles.emptyState}>
          <span>No active task</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.pane}
      role="complementary"
      aria-label={`${MODE_LABELS[rightPaneMode]} panel`}
    >
      <div className={styles.paneHeader}>
        <span>{MODE_LABELS[rightPaneMode]}</span>
        <button
          className={styles.closeBtn}
          onClick={closeRightPane}
          aria-label="Close panel"
          title="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className={styles.paneContent}>
        {rightPaneMode === 'properties' && <PropertyPanel />}
        {rightPaneMode === 'redaction' && <PlaceholderContent label="Redaction tools" />}
        {rightPaneMode === 'security' && <PlaceholderContent label="Security tools" />}
        {rightPaneMode === 'compare' && <PlaceholderContent label="Compare documents" />}
        {rightPaneMode === 'forms' && <PlaceholderContent label="Form fields" />}
        {rightPaneMode === 'ocr' && <PlaceholderContent label="OCR processing" />}
      </div>
    </div>
  );
}

function PlaceholderContent({ label }: { label: string }) {
  return (
    <div className={styles.emptyState}>
      <span>{label}</span>
      <span style={{ fontSize: '11px', opacity: 0.7 }}>
        Open from ribbon or menu to use this tool
      </span>
    </div>
  );
}
