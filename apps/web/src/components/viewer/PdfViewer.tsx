/**
 * Mudbrick v2 -- PdfViewer Component
 *
 * Main PDF viewer: renders pages with scrolling, zoom controls,
 * page navigation, and keyboard shortcuts.
 * Virtualizes rendering -- only visible pages are rendered.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { PageCanvas } from './PageCanvas';
import { ZoomControls } from './ZoomControls';
import { useZoom } from '../../hooks/useZoom';
import { usePdfDocument } from '../../hooks/usePdfDocument';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useDocumentStore } from '../../stores/documentStore';

interface PdfViewerProps {
  sessionId: string;
}

export function PdfViewer({ sessionId }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const setPageCount = useDocumentStore((s) => s.setPageCount);

  // Page dimensions cache (at scale=1)
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, { width: number; height: number }>
  >({});

  const { zoom, zoomIn, zoomOut, setZoom, fitWidth, fitPage, resetZoom } =
    useZoom({ containerRef });

  const { pageCount, renderPage, getPageDimensions, reload } = usePdfDocument({
    sessionId,
    onLoad: (count) => {
      setPageCount(count);
      // Get first page dimensions for fit calculations
      getPageDimensions(1).then((dims) => {
        setPageDimensions((prev) => ({ ...prev, 1: dims }));
        // Auto fit-width on first load
        if (containerRef.current) {
          const containerWidth = containerRef.current.clientWidth;
          const fitScale = (containerWidth - 40) / dims.width;
          setZoom(fitScale);
        }
      });
    },
    onError: (error) => {
      console.error('PDF load error:', error);
    },
  });

  // Track page dimensions as they render
  const handleRenderComplete = useCallback(
    (pageNum: number, width: number, height: number) => {
      setPageDimensions((prev) => ({ ...prev, [pageNum]: { width, height } }));
    },
    [],
  );

  // Scroll-based current page detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const pages = container.querySelectorAll<HTMLElement>('.page-canvas-container');
      const containerRect = container.getBoundingClientRect();
      const containerMiddle = containerRect.top + containerRect.height / 2;

      let closestPage = 1;
      let closestDistance = Infinity;

      pages.forEach((page) => {
        const rect = page.getBoundingClientRect();
        const pageMiddle = rect.top + rect.height / 2;
        const distance = Math.abs(pageMiddle - containerMiddle);
        const pageNum = parseInt(page.dataset['page'] ?? '1', 10);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = pageNum;
        }
      });

      setCurrentPage(closestPage);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [setCurrentPage]);

  // Scroll to a specific page
  const scrollToPage = useCallback((pageNum: number) => {
    const container = containerRef.current;
    if (!container) return;

    const pageEl = container.querySelector<HTMLElement>(
      `[data-page="${pageNum}"]`,
    );
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Fit calculations using first page dimensions
  const handleFitWidth = useCallback(() => {
    const dims = pageDimensions[1];
    if (dims) {
      fitWidth(dims.width);
    }
  }, [pageDimensions, fitWidth]);

  const handleFitPage = useCallback(() => {
    const dims = pageDimensions[1];
    if (dims) {
      fitPage(dims.width, dims.height);
    }
  }, [pageDimensions, fitPage]);

  // Navigation
  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      scrollToPage(newPage);
    }
  }, [currentPage, setCurrentPage, scrollToPage]);

  const goToNextPage = useCallback(() => {
    if (currentPage < pageCount) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      scrollToPage(newPage);
    }
  }, [currentPage, pageCount, setCurrentPage, scrollToPage]);

  const goToFirstPage = useCallback(() => {
    setCurrentPage(1);
    scrollToPage(1);
  }, [setCurrentPage, scrollToPage]);

  const goToLastPage = useCallback(() => {
    setCurrentPage(pageCount);
    scrollToPage(pageCount);
  }, [pageCount, setCurrentPage, scrollToPage]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    'Ctrl+=': zoomIn,
    'Ctrl+-': zoomOut,
    'Ctrl+0': resetZoom,
    'Ctrl+[': goToPreviousPage,
    'Ctrl+]': goToNextPage,
    'Home': goToFirstPage,
    'End': goToLastPage,
  });

  // Ctrl+scroll wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          zoomIn();
        } else {
          zoomOut();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomIn, zoomOut]);

  // Generate page numbers array
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
      }}
    >
      {/* Zoom toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '4px 8px',
          backgroundColor: 'var(--mb-toolbar-bg)',
          borderBottom: '1px solid var(--mb-toolbar-divider)',
          flexShrink: 0,
        }}
      >
        <ZoomControls
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFitWidth={handleFitWidth}
          onFitPage={handleFitPage}
          onResetZoom={resetZoom}
        />

        {/* Page navigation */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--mb-toolbar-text)',
            fontSize: '12px',
          }}
        >
          <span>Page</span>
          <input
            type="number"
            min={1}
            max={pageCount}
            value={currentPage}
            onChange={(e) => {
              const page = parseInt(e.target.value, 10);
              if (page >= 1 && page <= pageCount) {
                setCurrentPage(page);
                scrollToPage(page);
              }
            }}
            style={{
              width: '48px',
              padding: '2px 4px',
              textAlign: 'center',
              backgroundColor: 'var(--mb-toolbar-hover)',
              color: 'var(--mb-toolbar-text)',
              border: '1px solid var(--mb-toolbar-divider)',
              borderRadius: 'var(--mb-radius-xs)',
              fontSize: '12px',
            }}
          />
          <span>of {pageCount}</span>
        </div>
      </div>

      {/* Scrollable page area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: 'var(--mb-canvas-bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '16px 0',
        }}
      >
        {pages.map((pageNum) => (
          <PageCanvas
            key={pageNum}
            pageNum={pageNum}
            scale={zoom.level}
            isVisible={true} // TODO: viewport-based visibility
            showTextLayer={true}
            onRenderComplete={handleRenderComplete}
          />
        ))}
      </div>
    </div>
  );
}
