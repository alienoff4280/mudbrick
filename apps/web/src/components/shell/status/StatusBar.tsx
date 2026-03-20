/**
 * Mudbrick v2 -- StatusBar
 *
 * Bottom status bar showing page info, save state, and background task state.
 */

import { useDocumentStore } from '../../../stores/documentStore';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { TOOLS } from '@mudbrick/shared/src/constants';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const document = useDocumentStore((s) => s.document);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const loading = useDocumentStore((s) => s.loading);
  const activeTool = useAnnotationStore((s) => s.activeTool);

  if (!document) {
    return (
      <div className={styles.bar} role="status" aria-label="Status bar">
        <span className={styles.item}>Ready</span>
      </div>
    );
  }

  return (
    <div className={styles.bar} role="status" aria-label="Status bar">
      <span className={styles.item}>
        Page {currentPage} of {document.pageCount}
      </span>

      <div className={styles.separator} />

      {activeTool !== TOOLS.SELECT && (
        <>
          <span className={styles.item}>
            Tool: {activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}
          </span>
          <div className={styles.separator} />
        </>
      )}

      <div className={styles.spacer} />

      {loading && (
        <span className={styles.item}>Processing...</span>
      )}

      <span className={styles.item}>
        {document.fileName}
      </span>
    </div>
  );
}
