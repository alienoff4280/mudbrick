import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyHeadersFooters, previewHeaderText } from '../js/headers.js';

/* ── Helpers ── */

const fakePdfBytes = new Uint8Array([37, 80, 68, 70]);

describe('headers.js', () => {

  beforeEach(() => {
    vi.clearAllMocks();

    // Ensure embedFont returns a mock font with widthOfTextAtSize
    const mockFont = {
      widthOfTextAtSize: vi.fn((text, size) => text.length * size * 0.5),
    };

    window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
      getPageCount: vi.fn(() => 3),
      getPage: vi.fn((idx) => ({
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn(),
        drawRectangle: vi.fn(),
        drawImage: vi.fn(),
      })),
      embedFont: vi.fn(() => Promise.resolve(mockFont)),
      save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
    }));
  });

  /* ── previewHeaderText ── */

  describe('previewHeaderText', () => {
    it('replaces {page} with "1"', () => {
      const result = previewHeaderText('Page {page}');
      expect(result).toBe('Page 1');
    });

    it('replaces {pages} with "10"', () => {
      const result = previewHeaderText('{page} of {pages}');
      expect(result).toBe('1 of 10');
    });

    it('replaces {filename} with the provided filename', () => {
      const result = previewHeaderText('File: {filename}', 'report.pdf');
      expect(result).toBe('File: report.pdf');
    });

    it('uses default filename "document.pdf" when not provided', () => {
      const result = previewHeaderText('{filename}');
      expect(result).toBe('document.pdf');
    });

    it('replaces {date} with a date string', () => {
      const result = previewHeaderText('Date: {date}');
      // Should contain a date in MM/DD/YYYY format
      expect(result).toMatch(/Date: \d{2}\/\d{2}\/\d{4}/);
    });

    it('handles multiple tokens in the same string', () => {
      const result = previewHeaderText('{filename} - Page {page} of {pages} - {date}', 'doc.pdf');
      expect(result).toContain('doc.pdf');
      expect(result).toContain('Page 1');
      expect(result).toContain('of 10');
    });

    it('returns empty string for empty template', () => {
      const result = previewHeaderText('');
      expect(result).toBe('');
    });

    it('is case-insensitive for tokens', () => {
      const result = previewHeaderText('{PAGE} of {PAGES}');
      expect(result).toBe('1 of 10');
    });
  });

  /* ── applyHeadersFooters ── */

  describe('applyHeadersFooters', () => {
    it('returns PDF bytes', async () => {
      const result = await applyHeadersFooters(fakePdfBytes, {
        topCenter: 'Header',
      });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('loads the PDF with ignoreEncryption', async () => {
      await applyHeadersFooters(fakePdfBytes, { topLeft: 'Hi' });
      expect(window.PDFLib.PDFDocument.load).toHaveBeenCalledWith(
        fakePdfBytes,
        { ignoreEncryption: true }
      );
    });

    it('draws text on each page when content is provided', async () => {
      const mockPage = {
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn(),
      };

      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getPageCount: vi.fn(() => 2),
        getPage: vi.fn(() => mockPage),
        embedFont: vi.fn(() => Promise.resolve({
          widthOfTextAtSize: vi.fn(() => 50),
        })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      await applyHeadersFooters(fakePdfBytes, { topCenter: 'Header' });
      // drawText should be called once per page
      expect(mockPage.drawText).toHaveBeenCalledTimes(2);
    });

    it('does not draw when all zones are empty', async () => {
      const mockPage = {
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn(),
      };

      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getPageCount: vi.fn(() => 2),
        getPage: vi.fn(() => mockPage),
        embedFont: vi.fn(() => Promise.resolve({
          widthOfTextAtSize: vi.fn(() => 50),
        })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      await applyHeadersFooters(fakePdfBytes, {});
      expect(mockPage.drawText).not.toHaveBeenCalled();
    });

    it('respects startPage and endPage', async () => {
      const mockPage = {
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn(),
      };

      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getPageCount: vi.fn(() => 5),
        getPage: vi.fn(() => mockPage),
        embedFont: vi.fn(() => Promise.resolve({
          widthOfTextAtSize: vi.fn(() => 50),
        })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      await applyHeadersFooters(fakePdfBytes, {
        topCenter: 'Header',
        startPage: 2,
        endPage: 4,
      });
      // Pages 2, 3, 4 → 3 pages stamped
      expect(mockPage.drawText).toHaveBeenCalledTimes(3);
    });

    it('replaces tokens in header/footer text', async () => {
      const drawCalls = [];
      const mockPage = {
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn((text, opts) => drawCalls.push(text)),
      };

      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getPageCount: vi.fn(() => 2),
        getPage: vi.fn(() => mockPage),
        embedFont: vi.fn(() => Promise.resolve({
          widthOfTextAtSize: vi.fn(() => 50),
        })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      await applyHeadersFooters(fakePdfBytes, {
        bottomCenter: 'Page {page} of {pages}',
        filename: 'test.pdf',
      });

      expect(drawCalls).toContain('Page 1 of 2');
      expect(drawCalls).toContain('Page 2 of 2');
    });

    it('supports all six zones', async () => {
      const drawCalls = [];
      const mockPage = {
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn((text) => drawCalls.push(text)),
      };

      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getPageCount: vi.fn(() => 1),
        getPage: vi.fn(() => mockPage),
        embedFont: vi.fn(() => Promise.resolve({
          widthOfTextAtSize: vi.fn(() => 50),
        })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      await applyHeadersFooters(fakePdfBytes, {
        topLeft: 'TL',
        topCenter: 'TC',
        topRight: 'TR',
        bottomLeft: 'BL',
        bottomCenter: 'BC',
        bottomRight: 'BR',
      });

      expect(drawCalls).toEqual(expect.arrayContaining(['TL', 'TC', 'TR', 'BL', 'BC', 'BR']));
      expect(mockPage.drawText).toHaveBeenCalledTimes(6);
    });

    it('parses hex color into rgb', async () => {
      const drawOpts = [];
      const mockPage = {
        getSize: () => ({ width: 612, height: 792 }),
        drawText: vi.fn((text, opts) => drawOpts.push(opts)),
      };

      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getPageCount: vi.fn(() => 1),
        getPage: vi.fn(() => mockPage),
        embedFont: vi.fn(() => Promise.resolve({
          widthOfTextAtSize: vi.fn(() => 50),
        })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      await applyHeadersFooters(fakePdfBytes, {
        topCenter: 'Red',
        color: '#ff0000',
      });

      expect(window.PDFLib.rgb).toHaveBeenCalledWith(1, 0, 0);
    });
  });
});
