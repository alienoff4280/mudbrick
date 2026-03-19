/**
 * Mudbrick v2 -- PageCanvas Component
 *
 * Renders a single PDF page to a HiDPI canvas with text layer overlay.
 * Handles render lifecycle, cancellation, and cleanup.
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { TextLayer } from './TextLayer';
import { pdfService } from '../../services/pdfService';

interface PageCanvasProps {
  /** Page number (1-indexed) */
  pageNum: number;
  /** Current zoom scale */
  scale: number;
  /** Whether this page is currently visible in the viewport */
  isVisible?: boolean;
  /** Whether to show the text layer for selection */
  showTextLayer?: boolean;
  /** Called when page finishes rendering */
  onRenderComplete?: (pageNum: number, width: number, height: number) => void;
  /** Called on render error */
  onRenderError?: (pageNum: number, error: string) => void;
}

export const PageCanvas = memo(function PageCanvas({
  pageNum,
  scale,
  isVisible = true,
  showTextLayer = true,
  onRenderComplete,
  onRenderError,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [rendering, setRendering] = useState(false);
  const renderIdRef = useRef(0);

  const renderPage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !isVisible) return;

    const renderId = ++renderIdRef.current;
    setRendering(true);

    try {
      const result = await pdfService.renderPage(pageNum, canvas, scale);

      // Check if this render is still current (not superseded)
      if (renderId !== renderIdRef.current) return;

      setDimensions({ width: result.width, height: result.height });
      onRenderComplete?.(pageNum, result.width, result.height);
    } catch (err) {
      if (renderId !== renderIdRef.current) return;

      const message = err instanceof Error ? err.message : 'Render failed';
      onRenderError?.(pageNum, message);
    } finally {
      if (renderId === renderIdRef.current) {
        setRendering(false);
      }
    }
  }, [pageNum, scale, isVisible, onRenderComplete, onRenderError]);

  // Re-render when page number or scale changes
  useEffect(() => {
    if (isVisible) {
      renderPage();
    }
  }, [renderPage, isVisible]);

  return (
    <div
      className="page-canvas-container"
      data-page={pageNum}
      style={{
        position: 'relative',
        display: 'inline-block',
        backgroundColor: '#fff',
        boxShadow: 'var(--mb-shadow-md)',
        margin: '8px auto',
        // Prevent layout shift: use last known dimensions or placeholder
        minWidth: dimensions ? `${dimensions.width}px` : '200px',
        minHeight: dimensions ? `${dimensions.height}px` : '280px',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          zIndex: 'var(--z-pdf-canvas)' as unknown as number,
        }}
      />

      {/* Text selection layer */}
      {showTextLayer && dimensions && (
        <TextLayer
          pageNum={pageNum}
          scale={scale}
          width={dimensions.width}
          height={dimensions.height}
          visible={!rendering}
        />
      )}

      {/* Loading indicator */}
      {rendering && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.6)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: '12px', color: '#666' }}>
            Rendering...
          </span>
        </div>
      )}
    </div>
  );
});
