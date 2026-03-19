/**
 * Mudbrick v2 -- PDF.js Service Wrapper
 *
 * Manages PDF.js document loading and page rendering.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
export type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

class PdfService {
  private currentDoc: PDFDocumentProxy | null = null;

  /**
   * Load a PDF document from an ArrayBuffer or URL.
   */
  async load(source: ArrayBuffer | string): Promise<PDFDocumentProxy> {
    // Close any existing document
    await this.close();

    const loadingTask = pdfjsLib.getDocument({
      data: source instanceof ArrayBuffer ? source : undefined,
      url: typeof source === 'string' ? source : undefined,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/cmaps/',
      cMapPacked: true,
      enableXfa: false,
    });

    this.currentDoc = await loadingTask.promise;
    return this.currentDoc;
  }

  /**
   * Get the currently loaded document.
   */
  getDocument(): PDFDocumentProxy | null {
    return this.currentDoc;
  }

  /**
   * Get a specific page (1-indexed).
   */
  async getPage(pageNum: number): Promise<PDFPageProxy> {
    if (!this.currentDoc) throw new Error('No document loaded');
    return this.currentDoc.getPage(pageNum);
  }

  /**
   * Render a page to a canvas with HiDPI support.
   */
  async renderPage(
    pageNum: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<{ width: number; height: number }> {
    const page = await this.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2d context');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
    });

    await renderTask.promise;

    return {
      width: Math.floor(viewport.width),
      height: Math.floor(viewport.height),
    };
  }

  /**
   * Render the text layer for a page (for text selection).
   */
  async getTextContent(pageNum: number) {
    const page = await this.getPage(pageNum);
    return page.getTextContent();
  }

  /**
   * Get page count of the current document.
   */
  getPageCount(): number {
    return this.currentDoc?.numPages ?? 0;
  }

  /**
   * Close the current document and free resources.
   */
  async close(): Promise<void> {
    if (this.currentDoc) {
      await this.currentDoc.destroy();
      this.currentDoc = null;
    }
  }
}

/** Singleton PDF service */
export const pdfService = new PdfService();
