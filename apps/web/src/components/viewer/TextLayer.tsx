/**
 * Mudbrick v2 -- TextLayer Component
 *
 * Renders the PDF.js text layer over the page canvas for text selection.
 * Uses PDF.js 4.x TextLayer API.
 */

import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { pdfService } from '../../services/pdfService';

interface TextLayerProps {
  /** Page number (1-indexed) */
  pageNum: number;
  /** Current zoom scale */
  scale: number;
  /** CSS dimensions of the rendered page */
  width: number;
  height: number;
  /** Whether the text layer is visible */
  visible?: boolean;
}

export function TextLayer({
  pageNum,
  scale,
  width,
  height,
  visible = true,
}: TextLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<pdfjsLib.TextLayer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visible) return;

    let cancelled = false;

    async function renderTextLayer() {
      if (!container) return;

      // Clear previous
      container.innerHTML = '';
      if (textLayerRef.current) {
        textLayerRef.current.cancel();
        textLayerRef.current = null;
      }

      try {
        const page = await pdfService.getPage(pageNum);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const textContent = await page.getTextContent();
        if (cancelled) return;

        // PDF.js 4.x TextLayer API
        if (pdfjsLib.TextLayer) {
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container,
            viewport,
          });
          textLayerRef.current = textLayer;
          await textLayer.render();
        }
      } catch (err) {
        // Cancelled or page not available -- ignore
        if (!cancelled) {
          console.warn('TextLayer render failed:', err);
        }
      }
    }

    renderTextLayer();

    return () => {
      cancelled = true;
      if (textLayerRef.current) {
        textLayerRef.current.cancel();
        textLayerRef.current = null;
      }
    };
  }, [pageNum, scale, visible]);

  return (
    <div
      ref={containerRef}
      className="textLayer"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 'var(--z-text-layer)' as unknown as number,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        // PDF.js text layer standard styles
        overflow: 'hidden',
        lineHeight: 1,
      }}
    />
  );
}
