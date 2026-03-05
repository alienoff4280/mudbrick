import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock annotations module
vi.mock('../js/annotations.js', () => ({
  getAnnotations: vi.fn(() => ({})),
  getCanvas: vi.fn(() => null),
  savePageAnnotations: vi.fn(),
  loadPageAnnotations: vi.fn(),
  resizeOverlay: vi.fn(),
}));

// Mock error-handler module
vi.mock('../js/error-handler.js', () => ({
  showUserError: vi.fn(),
  clearRecoveryData: vi.fn(() => Promise.resolve()),
}));

import { exportAnnotatedPDF } from '../js/export.js';
import { getAnnotations, getCanvas, savePageAnnotations } from '../js/annotations.js';
import { clearRecoveryData } from '../js/error-handler.js';

/* ── Helpers ── */

function makePdfBytes() {
  return new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
}

/* ── Tests ── */

describe('export.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Ensure PDFLib mock is set up
    window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
      getPageCount: vi.fn(() => 3),
      getPage: vi.fn(() => ({
        getSize: () => ({ width: 612, height: 792 }),
        getRotation: () => ({ angle: 0 }),
        drawRectangle: vi.fn(),
        drawImage: vi.fn(),
      })),
      save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      embedPng: vi.fn(() => Promise.resolve({})),
      getForm: vi.fn(() => ({ getFields: vi.fn(() => []) })),
    }));
  });

  /* ── exportAnnotatedPDF ── */

  describe('exportAnnotatedPDF', () => {
    it('throws when pdfBytes is not provided', async () => {
      await expect(exportAnnotatedPDF({
        pdfBytes: null,
        currentPage: 1,
        totalPages: 3,
        fileName: 'test.pdf',
      })).rejects.toThrow('PDF not loaded');
    });

    it('throws when PDFLib is not available', async () => {
      const saved = window.PDFLib;
      window.PDFLib = null;

      await expect(exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'test.pdf',
      })).rejects.toThrow('PDF not loaded');

      window.PDFLib = saved;
    });

    it('returns original bytes with _edited suffix when no annotations exist', async () => {
      getAnnotations.mockReturnValue({});

      const result = await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'report.pdf',
      });

      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.fileName).toBe('report_edited.pdf');
    });

    it('saves current page annotations before export', async () => {
      getAnnotations.mockReturnValue({});

      await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 2,
        totalPages: 3,
        fileName: 'test.pdf',
      });

      expect(savePageAnnotations).toHaveBeenCalledWith(2);
    });

    it('clears recovery data on successful export', async () => {
      getAnnotations.mockReturnValue({});

      await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'test.pdf',
      });

      expect(clearRecoveryData).toHaveBeenCalled();
    });

    it('generates _edited filename for file without .pdf extension', async () => {
      getAnnotations.mockReturnValue({});

      const result = await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 1,
        fileName: 'document',
      });

      // makeExportName removes .pdf then appends _edited.pdf
      // "document" has no .pdf, so result is "document_edited.pdf"
      expect(result.fileName).toBe('document_edited.pdf');
    });

    it('generates default filename when fileName is null', async () => {
      getAnnotations.mockReturnValue({});

      const result = await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 1,
        fileName: null,
      });

      expect(result.fileName).toBe('document_edited.pdf');
    });

    it('calls onProgress for annotated pages with cover-only objects', async () => {
      // Only cover objects — no non-cover objects, so canvas is not needed for rendering
      getAnnotations.mockReturnValue({
        1: {
          objects: [
            { mudbrickType: 'cover', left: 10, top: 10, width: 100, height: 50, scaleX: 1, scaleY: 1 },
          ],
          _canvasWidth: 612,
          _canvasHeight: 792,
        },
      });

      // Provide a mock canvas so the null check passes
      const mockFabricCanvas = {
        width: 612,
        height: 792,
        getObjects: vi.fn(() => []),
        toJSON: vi.fn(() => ({ objects: [] })),
      };
      getCanvas.mockReturnValue(mockFabricCanvas);

      const onProgress = vi.fn();

      await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'test.pdf',
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledWith(1, 1);
    });

    it('handles annotated pages with only cover objects (no PNG rendering needed)', async () => {
      getAnnotations.mockReturnValue({
        1: {
          objects: [
            { mudbrickType: 'cover', left: 0, top: 0, width: 100, height: 50, scaleX: 1, scaleY: 1 },
          ],
          _canvasWidth: 612,
          _canvasHeight: 792,
        },
      });

      const mockFabricCanvas = { width: 612, height: 792 };
      getCanvas.mockReturnValue(mockFabricCanvas);

      const result = await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'test.pdf',
      });

      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.fileName).toBe('test_edited.pdf');
    });

    it('handles pages with only redact objects', async () => {
      getAnnotations.mockReturnValue({
        2: {
          objects: [
            { mudbrickType: 'redact', left: 50, top: 100, width: 200, height: 30, scaleX: 1, scaleY: 1 },
          ],
          _canvasWidth: 612,
          _canvasHeight: 792,
        },
      });

      const mockFabricCanvas = { width: 612, height: 792 };
      getCanvas.mockReturnValue(mockFabricCanvas);

      const result = await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'redacted.pdf',
      });

      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.fileName).toBe('redacted_edited.pdf');
    });

    it('skips annotated pages with invalid page indices', async () => {
      getAnnotations.mockReturnValue({
        // Page 0 would be pageIndex -1 (invalid)
        0: {
          objects: [{ mudbrickType: 'text', left: 10, top: 10 }],
        },
      });

      const mockFabricCanvas = { width: 612, height: 792 };
      getCanvas.mockReturnValue(mockFabricCanvas);

      const result = await exportAnnotatedPDF({
        pdfBytes: makePdfBytes(),
        currentPage: 1,
        totalPages: 3,
        fileName: 'test.pdf',
      });

      expect(result.bytes).toBeInstanceOf(Uint8Array);
    });
  });
});
