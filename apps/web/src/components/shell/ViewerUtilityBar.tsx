/**
 * Mudbrick v2 -- ViewerUtilityBar
 *
 * Compact bar above the document canvas with page navigation,
 * zoom controls, fit modes, and find.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { TOOLS } from '@mudbrick/shared/src/constants';
import { formatZoomPercent } from '../../utils/zoom';
import styles from './ViewerUtilityBar.module.css';

interface ViewerUtilityBarProps {
  sessionId: string;
}

export function ViewerUtilityBar({ sessionId }: ViewerUtilityBarProps) {
  const currentPage = useDocumentStore((s) => s.currentPage);
  const pageCount = useDocumentStore((s) => s.document?.pageCount ?? 0);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const activeTool = useAnnotationStore((s) => s.activeTool);

  const [pageInputValue, setPageInputValue] = useState(String(currentPage));
  const pageInputRef = useRef<HTMLInputElement>(null);

  // Sync page input when currentPage changes externally
  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  const handlePagePrev = useCallback(() => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  }, [currentPage, setCurrentPage]);

  const handlePageNext = useCallback(() => {
    if (currentPage < pageCount) setCurrentPage(currentPage + 1);
  }, [currentPage, pageCount, setCurrentPage]);

  const handlePageInputSubmit = useCallback(() => {
    const num = parseInt(pageInputValue, 10);
    if (!isNaN(num) && num >= 1 && num <= pageCount) {
      setCurrentPage(num);
    } else {
      setPageInputValue(String(currentPage));
    }
  }, [pageInputValue, pageCount, currentPage, setCurrentPage]);

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handlePageInputSubmit();
        pageInputRef.current?.blur();
      } else if (e.key === 'Escape') {
        setPageInputValue(String(currentPage));
        pageInputRef.current?.blur();
      }
    },
    [handlePageInputSubmit, currentPage],
  );

  // Active tool label for mode badge
  const toolLabel =
    activeTool !== TOOLS.SELECT
      ? activeTool.charAt(0).toUpperCase() + activeTool.slice(1)
      : null;

  return (
    <div className={styles.bar} role="toolbar" aria-label="Viewer controls">
      {/* Page navigation */}
      <div className={styles.section}>
        <button
          className={styles.btn}
          onClick={handlePagePrev}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          title="Previous page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <label className="sr-only" htmlFor="page-input">Page number</label>
        <input
          id="page-input"
          ref={pageInputRef}
          className={styles.pageInput}
          type="text"
          value={pageInputValue}
          onChange={(e) => setPageInputValue(e.target.value)}
          onBlur={handlePageInputSubmit}
          onKeyDown={handlePageInputKeyDown}
          aria-label="Page number"
        />
        <span className={styles.pageLabel}>/ {pageCount}</span>

        <button
          className={styles.btn}
          onClick={handlePageNext}
          disabled={currentPage >= pageCount}
          aria-label="Next page"
          title="Next page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className={styles.divider} />

      {/* Zoom controls -- placeholder until PdfViewer exposes zoom via store/context */}
      <div className={styles.section}>
        <button className={styles.btn} aria-label="Zoom out" title="Zoom out (Ctrl+-)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <span className={styles.zoomText} title="Click to reset zoom">100%</span>

        <button className={styles.btn} aria-label="Zoom in" title="Zoom in (Ctrl+=)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>

      <div className={styles.divider} />

      {/* Fit modes */}
      <div className={styles.section}>
        <button className={styles.btn} aria-label="Fit width" title="Fit width">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" />
            <path d="M6 12h12M6 12l3-3M6 12l3 3M18 12l-3-3M18 12l-3 3" />
          </svg>
        </button>
        <button className={styles.btn} aria-label="Fit page" title="Fit page">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <rect x="7" y="7" width="10" height="10" rx="1" />
          </svg>
        </button>
      </div>

      <div className={styles.divider} />

      {/* Find */}
      <div className={styles.section}>
        <button className={styles.btn} aria-label="Find" title="Find (Ctrl+F)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      {/* Mode badge (right-aligned) */}
      {toolLabel && (
        <span className={styles.modeBadge}>{toolLabel} mode</span>
      )}
    </div>
  );
}
