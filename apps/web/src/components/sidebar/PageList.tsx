/**
 * Mudbrick v2 -- PageList Component
 *
 * Renders a vertical list of thumbnail items for page navigation.
 * Supports drag-to-reorder and right-click context menu for page operations.
 */

import { memo, useState, useCallback, useRef, type DragEvent, type MouseEvent } from 'react';

export interface PageListItem {
  pageNum: number;
  thumbnailUrl: string | null;
  label?: string;
}

interface PageListProps {
  pages: PageListItem[];
  currentPage: number;
  onPageClick: (pageNum: number) => void;
  /** Called when pages are reordered via drag. Returns new order array. */
  onReorder?: (newOrder: number[]) => void;
  /** Called when a page operation is requested via context menu */
  onPageOperation?: (operation: PageOperation) => void;
  /** Whether page operations (drag, context menu) are enabled */
  operationsEnabled?: boolean;
}

export interface PageOperation {
  type:
    | 'rotate-cw'
    | 'rotate-ccw'
    | 'duplicate'
    | 'insert-after'
    | 'insert-from-pdf'
    | 'replace-page'
    | 'delete';
  pageNum: number;
}

export const PageList = memo(function PageList({
  pages,
  currentPage,
  onPageClick,
  onReorder,
  onPageOperation,
  operationsEnabled = true,
}: PageListProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    pageNum: number;
  } | null>(null);
  const dragSourceIndex = useRef<number | null>(null);

  // Drag handlers
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLButtonElement>, index: number) => {
      if (!operationsEnabled) return;
      dragSourceIndex.current = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      (e.currentTarget as HTMLElement).style.opacity = '0.4';
    },
    [operationsEnabled],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLButtonElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(index);
    },
    [],
  );

  const handleDragEnd = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      (e.currentTarget as HTMLElement).style.opacity = '1';
      setDragOverIndex(null);
      dragSourceIndex.current = null;
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>, targetIndex: number) => {
      e.preventDefault();
      setDragOverIndex(null);
      const sourceIndex = dragSourceIndex.current;
      dragSourceIndex.current = null;

      if (sourceIndex === null || sourceIndex === targetIndex || !onReorder) return;

      // Build new order
      const newOrder = pages.map((p) => p.pageNum);
      const [moved] = newOrder.splice(sourceIndex, 1);
      if (moved !== undefined) {
        newOrder.splice(targetIndex, 0, moved);
        onReorder(newOrder);
      }
    },
    [pages, onReorder],
  );

  // Context menu
  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLButtonElement>, pageNum: number) => {
      if (!operationsEnabled) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, pageNum });
    },
    [operationsEnabled],
  );

  const handleContextAction = useCallback(
    (type: PageOperation['type']) => {
      if (contextMenu && onPageOperation) {
        onPageOperation({ type, pageNum: contextMenu.pageNum });
      }
      setContextMenu(null);
    },
    [contextMenu, onPageOperation],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <>
      <div
        role="listbox"
        aria-label="Page thumbnails"
        onClick={closeContextMenu}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '4px',
        }}
      >
        {pages.map((page, index) => {
          const isActive = page.pageNum === currentPage;
          const isDragTarget = dragOverIndex === index;
          return (
            <button
              key={page.pageNum}
              role="option"
              aria-selected={isActive}
              aria-label={`Page ${page.pageNum}`}
              onClick={() => onPageClick(page.pageNum)}
              onContextMenu={(e) => handleContextMenu(e, page.pageNum)}
              draggable={operationsEnabled}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, index)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '6px',
                background: 'none',
                border: `2px solid ${
                  isDragTarget
                    ? 'var(--mb-accent)'
                    : isActive
                      ? 'var(--mb-sidebar-thumb-active)'
                      : 'transparent'
                }`,
                borderRadius: 'var(--mb-radius-sm)',
                cursor: operationsEnabled ? 'grab' : 'pointer',
                transition: 'border-color var(--mb-transition), background-color var(--mb-transition)',
              }}
              onMouseOver={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--mb-surface-hover)';
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: '100%',
                  maxWidth: '160px',
                  aspectRatio: '8.5 / 11',
                  backgroundColor: 'var(--mb-sidebar-thumb-bg)',
                  border: `1px solid ${isActive ? 'var(--mb-sidebar-thumb-active)' : 'var(--mb-sidebar-thumb-border)'}`,
                  borderRadius: 'var(--mb-radius-xs)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {page.thumbnailUrl ? (
                  <img
                    src={page.thumbnailUrl}
                    alt={`Page ${page.pageNum} thumbnail`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                    loading="lazy"
                  />
                ) : (
                  <span style={{ fontSize: '11px', color: 'var(--mb-text-muted)' }}>
                    Loading...
                  </span>
                )}
              </div>

              {/* Page number */}
              <span
                style={{
                  fontSize: '11px',
                  color: isActive ? 'var(--mb-brand)' : 'var(--mb-text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {page.label ?? page.pageNum}
              </span>
            </button>
          );
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenuOverlay
          x={contextMenu.x}
          y={contextMenu.y}
          pageNum={contextMenu.pageNum}
          onAction={handleContextAction}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
});

function ContextMenuOverlay({
  x,
  y,
  pageNum,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  pageNum: number;
  onAction: (type: PageOperation['type']) => void;
  onClose: () => void;
}) {
  const menuItems: Array<{ label: string; type: PageOperation['type'] }> = [
    { label: 'Rotate clockwise', type: 'rotate-cw' },
    { label: 'Rotate counter-clockwise', type: 'rotate-ccw' },
    { label: 'Duplicate page', type: 'duplicate' },
    { label: 'Insert blank page after', type: 'insert-after' },
    { label: 'Insert pages from PDF...', type: 'insert-from-pdf' },
    { label: 'Replace page from file...', type: 'replace-page' },
    { label: 'Delete page', type: 'delete' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
        }}
      />
      {/* Menu */}
      <div
        role="menu"
        style={{
          position: 'fixed',
          left: `${x}px`,
          top: `${y}px`,
          zIndex: 1000,
          backgroundColor: 'var(--mb-surface)',
          border: '1px solid var(--mb-border)',
          borderRadius: 'var(--mb-radius-sm)',
          boxShadow: 'var(--mb-shadow-md)',
          padding: '4px 0',
          minWidth: '180px',
        }}
      >
        <div
          style={{
            padding: '4px 12px',
            fontSize: '11px',
            color: 'var(--mb-text-muted)',
            fontWeight: 600,
          }}
        >
          Page {pageNum}
        </div>
        {menuItems.map((item) => (
          <button
            key={item.type}
            role="menuitem"
            onClick={() => onAction(item.type)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              color: item.type === 'delete' ? 'var(--mb-danger)' : 'var(--mb-text)',
              transition: 'background-color var(--mb-transition)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--mb-surface-hover)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
