/**
 * Mudbrick v2 -- LeftPaneHost
 *
 * Renders the content for the active left pane mode:
 * Pages (thumbnails), Outline, Search, Attachments.
 * Reuses existing PageList and OutlinePanel components.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { PageList, type PageListItem, type PageOperation } from '../../sidebar/PageList';
import { OutlinePanel } from '../../sidebar/OutlinePanel';
import { AttachmentsPanel } from '../../sidebar/AttachmentsPanel';
import { useUIStore, type LeftPaneMode } from '../../../stores/uiStore';
import { useDocumentStore } from '../../../stores/documentStore';
import { api } from '../../../services/api';
import styles from './LeftPaneHost.module.css';

interface LeftPaneHostProps {
  sessionId: string;
  onNavigate: (pageNum: number) => void;
  onPageOperation?: (op: PageOperation) => void;
  onReorder?: (newOrder: number[]) => void;
  onDocumentUpdated?: () => void | Promise<void>;
}

const MODE_LABELS: Record<LeftPaneMode, string> = {
  pages: 'Pages',
  outline: 'Bookmarks',
  search: 'Search',
  attachments: 'Attachments',
};

export function LeftPaneHost({
  sessionId,
  onNavigate,
  onPageOperation,
  onReorder,
  onDocumentUpdated,
}: LeftPaneHostProps) {
  const leftPaneMode = useUIStore((s) => s.leftPaneMode);
  const pageCount = useDocumentStore((s) => s.document?.pageCount ?? 0);
  const currentPage = useDocumentStore((s) => s.currentPage);

  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  // Load thumbnails progressively
  useEffect(() => {
    if (!sessionId || pageCount === 0) return;

    let cancelled = false;

    async function loadThumbnails() {
      for (let i = 1; i <= pageCount; i++) {
        if (cancelled) break;
        try {
          const url = await api.getThumbnail(sessionId, i);
          if (!cancelled) {
            setThumbnails((prev) => ({ ...prev, [i]: url }));
          }
        } catch {
          // Skip failed thumbnails
        }
      }
    }

    loadThumbnails();

    return () => {
      cancelled = true;
    };
  }, [sessionId, pageCount]);

  const pages: PageListItem[] = useMemo(
    () =>
      Array.from({ length: pageCount }, (_, i) => ({
        pageNum: i + 1,
        thumbnailUrl: thumbnails[i + 1] ?? null,
      })),
    [pageCount, thumbnails],
  );

  const handlePageClick = useCallback(
    (pageNum: number) => {
      onNavigate(pageNum);
    },
    [onNavigate],
  );

  return (
    <div
      className={styles.pane}
      id={`left-pane-${leftPaneMode}`}
      role="tabpanel"
      aria-label={`${MODE_LABELS[leftPaneMode]} pane`}
    >
      <div className={styles.paneHeader}>
        {MODE_LABELS[leftPaneMode]}
      </div>

      <div className={styles.paneContent}>
        {leftPaneMode === 'pages' && (
          <PageList
            pages={pages}
            currentPage={currentPage}
            onPageClick={handlePageClick}
            onReorder={onReorder}
            onPageOperation={onPageOperation}
            operationsEnabled={true}
          />
        )}

        {leftPaneMode === 'outline' && (
          <OutlinePanel items={[]} onNavigate={handlePageClick} />
        )}

        {leftPaneMode === 'search' && (
          <SearchPane />
        )}

        {leftPaneMode === 'attachments' && (
          <AttachmentsPanel
            sessionId={sessionId}
            onDocumentUpdated={onDocumentUpdated}
          />
        )}
      </div>
    </div>
  );
}

/** Placeholder search pane -- wired to find bar in a later slice */
function SearchPane() {
  return (
    <div className={styles.emptyState}>
      <svg
        className={styles.emptyStateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span>Use Ctrl+F to search in the document</span>
    </div>
  );
}
