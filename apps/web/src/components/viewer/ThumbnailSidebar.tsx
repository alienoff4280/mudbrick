/**
 * Mudbrick v2 -- ThumbnailSidebar Component
 *
 * Sidebar with tabbed view: page thumbnails and document outline.
 * Loads thumbnails from GET /api/pages/{sid}/{page}/thumbnail.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { PageList, type PageListItem, type PageOperation } from '../sidebar/PageList';
import { OutlinePanel } from '../sidebar/OutlinePanel';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../services/api';

interface ThumbnailSidebarProps {
  sessionId: string;
  onNavigate: (pageNum: number) => void;
  onPageOperation?: (op: PageOperation) => void;
  onReorder?: (newOrder: number[]) => void;
}

export function ThumbnailSidebar({ sessionId, onNavigate, onPageOperation, onReorder }: ThumbnailSidebarProps) {
  const pageCount = useDocumentStore((s) => s.document?.pageCount ?? 0);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const sidebarTab = useUIStore((s) => s.sidebarTab);
  const setSidebarTab = useUIStore((s) => s.setSidebarTab);

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
          // Skip failed thumbnails silently
        }
      }
    }

    loadThumbnails();

    return () => {
      cancelled = true;
      // Revoke any created object URLs
      Object.values(thumbnails).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
    };
    // Only re-run when session or page count changes, not on thumbnails change
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--mb-border)',
          flexShrink: 0,
        }}
      >
        <TabButton
          active={sidebarTab === 'pages'}
          onClick={() => setSidebarTab('pages')}
          label="Pages"
        />
        <TabButton
          active={sidebarTab === 'outline'}
          onClick={() => setSidebarTab('outline')}
          label="Outline"
        />
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
        }}
      >
        {sidebarTab === 'pages' && (
          <PageList
            pages={pages}
            currentPage={currentPage}
            onPageClick={handlePageClick}
            onReorder={onReorder}
            onPageOperation={onPageOperation}
            operationsEnabled={true}
          />
        )}
        {sidebarTab === 'outline' && (
          <OutlinePanel items={[]} onNavigate={handlePageClick} />
        )}
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: '4px 8px',
          borderTop: '1px solid var(--mb-border)',
          fontSize: '11px',
          color: 'var(--mb-text-muted)',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {pageCount} pages
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 4px',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--mb-brand)' : 'transparent'}`,
        color: active ? 'var(--mb-brand)' : 'var(--mb-text-secondary)',
        fontSize: '12px',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'color var(--mb-transition), border-color var(--mb-transition)',
      }}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--mb-text)';
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--mb-text-secondary)';
        }
      }}
    >
      {label}
    </button>
  );
}
