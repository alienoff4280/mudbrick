/**
 * Mudbrick v2 -- usePdfDocument Hook
 *
 * Manages PDF.js document lifecycle: loading from backend URL,
 * page rendering, text content retrieval, cleanup.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { pdfService, type PDFDocumentProxy } from '../services/pdfService';
import { API_BASE } from '@mudbrick/shared/src/constants';

interface UsePdfDocumentOptions {
  /** Session ID from the backend */
  sessionId: string | null;
  /** Called when the document is loaded */
  onLoad?: (pageCount: number) => void;
  /** Called on error */
  onError?: (error: string) => void;
}

interface UsePdfDocumentResult {
  /** Whether the PDF is currently loading */
  loading: boolean;
  /** Total page count */
  pageCount: number;
  /** Render a page to a canvas */
  renderPage: (
    pageNum: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ) => Promise<{ width: number; height: number } | null>;
  /** Get text content for a page (for text layer) */
  getTextContent: (pageNum: number) => Promise<unknown>;
  /** Get page dimensions at scale 1 */
  getPageDimensions: (pageNum: number) => Promise<{ width: number; height: number }>;
  /** Reload the document (e.g., after page operations) */
  reload: () => Promise<void>;
  /** Close the document and free resources */
  close: () => Promise<void>;
}

export function usePdfDocument({
  sessionId,
  onLoad,
  onError,
}: UsePdfDocumentOptions): UsePdfDocumentResult {
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const isMountedRef = useRef(true);
  const currentSessionRef = useRef<string | null>(null);

  const loadDocument = useCallback(
    async (sid: string) => {
      setLoading(true);
      try {
        // Load PDF from the backend render endpoint
        // The backend serves the PDF bytes at /api/documents/{sid}/pdf
        const pdfUrl = `${API_BASE}/documents/${sid}/pdf`;
        const doc = await pdfService.load(pdfUrl);

        if (isMountedRef.current) {
          const count = doc.numPages;
          setPageCount(count);
          currentSessionRef.current = sid;
          onLoad?.(count);
        }
      } catch (err) {
        if (isMountedRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to load PDF';
          onError?.(message);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [onLoad, onError],
  );

  // Load when sessionId changes
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionRef.current) {
      loadDocument(sessionId);
    }
  }, [sessionId, loadDocument]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pdfService.close();
    };
  }, []);

  const renderPage = useCallback(
    async (
      pageNum: number,
      canvas: HTMLCanvasElement,
      scale: number,
    ): Promise<{ width: number; height: number } | null> => {
      try {
        return await pdfService.renderPage(pageNum, canvas, scale);
      } catch (err) {
        if (isMountedRef.current) {
          const message = err instanceof Error ? err.message : 'Render failed';
          onError?.(message);
        }
        return null;
      }
    },
    [onError],
  );

  const getTextContent = useCallback(async (pageNum: number) => {
    return pdfService.getTextContent(pageNum);
  }, []);

  const getPageDimensions = useCallback(
    async (pageNum: number): Promise<{ width: number; height: number }> => {
      const page = await pdfService.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    },
    [],
  );

  const reload = useCallback(async () => {
    if (currentSessionRef.current) {
      await loadDocument(currentSessionRef.current);
    }
  }, [loadDocument]);

  const close = useCallback(async () => {
    await pdfService.close();
    if (isMountedRef.current) {
      setPageCount(0);
      currentSessionRef.current = null;
    }
  }, []);

  return {
    loading,
    pageCount,
    renderPage,
    getTextContent,
    getPageDimensions,
    reload,
    close,
  };
}
