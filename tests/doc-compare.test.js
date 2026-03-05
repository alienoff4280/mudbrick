import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compareDocuments,
  generateCompareReport,
  renderComparisonView,
} from '../js/doc-compare.js';

/* ── Stub canvas getContext so jsdom doesn't return null ── */

function makeMockCtx() {
  const pixelData = new Uint8ClampedArray(4 * 100 * 130); // RGBA for 100x130
  // Fill with white (255,255,255,255)
  for (let i = 0; i < pixelData.length; i += 4) {
    pixelData[i] = 255;
    pixelData[i + 1] = 255;
    pixelData[i + 2] = 255;
    pixelData[i + 3] = 255;
  }
  return {
    fillStyle: '',
    globalAlpha: 1.0,
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((x, y, w, h) => ({
      data: new Uint8ClampedArray(4 * w * h).fill(255),
    })),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
  };
}

const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => makeMockCtx());
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

/**
 * Helper: create a mock PDF.js document with the given number of pages.
 */
function createMockPdfDoc(numPages) {
  return {
    numPages,
    getPage: vi.fn((pageNum) => {
      if (pageNum > numPages) throw new Error(`Page ${pageNum} out of range`);
      return Promise.resolve({
        getViewport: vi.fn(({ scale }) => ({
          width: 100 * scale,
          height: 130 * scale,
        })),
        render: vi.fn(() => ({
          promise: Promise.resolve(),
        })),
      });
    }),
  };
}

describe('doc-compare.js', () => {
  /* ── compareDocuments ── */

  describe('compareDocuments', () => {
    it('returns correct structure for two single-page docs', async () => {
      const docA = createMockPdfDoc(1);
      const docB = createMockPdfDoc(1);

      const results = await compareDocuments(docA, docB);

      expect(results.pagesA).toBe(1);
      expect(results.pagesB).toBe(1);
      expect(results.maxPages).toBe(1);
      expect(results.pages).toHaveLength(1);
      expect(results.pages[0].pageNum).toBe(1);
      expect(results.pages[0].hasA).toBe(true);
      expect(results.pages[0].hasB).toBe(true);
      expect(typeof results.overallDiffPercentage).toBe('number');
    });

    it('reports 0% difference for identical documents', async () => {
      const docA = createMockPdfDoc(2);
      const docB = createMockPdfDoc(2);

      const results = await compareDocuments(docA, docB);

      expect(results.overallDiffPercentage).toBe(0);
      for (const page of results.pages) {
        expect(page.diffPercentage).toBe(0);
      }
    });

    it('handles docA having more pages than docB', async () => {
      const docA = createMockPdfDoc(3);
      const docB = createMockPdfDoc(1);

      const results = await compareDocuments(docA, docB);

      expect(results.maxPages).toBe(3);
      expect(results.pages).toHaveLength(3);

      // Page 1: both docs have it
      expect(results.pages[0].hasA).toBe(true);
      expect(results.pages[0].hasB).toBe(true);

      // Pages 2-3: only in A
      expect(results.pages[1].hasA).toBe(true);
      expect(results.pages[1].hasB).toBe(false);
      expect(results.pages[1].diffPercentage).toBe(100);

      expect(results.pages[2].hasA).toBe(true);
      expect(results.pages[2].hasB).toBe(false);
    });

    it('handles docB having more pages than docA', async () => {
      const docA = createMockPdfDoc(1);
      const docB = createMockPdfDoc(3);

      const results = await compareDocuments(docA, docB);

      expect(results.maxPages).toBe(3);
      expect(results.pages[1].hasA).toBe(false);
      expect(results.pages[1].hasB).toBe(true);
      expect(results.pages[1].diffPercentage).toBe(100);

      expect(results.pages[2].hasA).toBe(false);
      expect(results.pages[2].hasB).toBe(true);
    });

    it('invokes onProgress callback for each page', async () => {
      const docA = createMockPdfDoc(3);
      const docB = createMockPdfDoc(3);
      const onProgress = vi.fn();

      await compareDocuments(docA, docB, {}, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenCalledWith(1, 3);
      expect(onProgress).toHaveBeenCalledWith(2, 3);
      expect(onProgress).toHaveBeenCalledWith(3, 3);
    });

    it('accepts custom dpi and threshold options', async () => {
      const docA = createMockPdfDoc(1);
      const docB = createMockPdfDoc(1);

      const results = await compareDocuments(docA, docB, { dpi: 72, threshold: 0 });

      expect(results.pages).toHaveLength(1);
      // With identical mock rendering and threshold 0, still 0 diff
      expect(results.overallDiffPercentage).toBe(0);
    });

    it('accumulates totalDiffPixels and totalPixels across pages', async () => {
      const docA = createMockPdfDoc(2);
      const docB = createMockPdfDoc(2);

      const results = await compareDocuments(docA, docB);

      expect(typeof results.totalDiffPixels).toBe('number');
      expect(typeof results.totalPixels).toBe('number');
      // Two identical pages — totalPixels should be positive, diffs 0
      expect(results.totalPixels).toBeGreaterThan(0);
      expect(results.totalDiffPixels).toBe(0);
    });
  });

  /* ── generateCompareReport ── */

  describe('generateCompareReport', () => {
    it('includes document page counts in the report', () => {
      const results = {
        pagesA: 5,
        pagesB: 3,
        maxPages: 5,
        overallDiffPercentage: 12.5,
        pages: [],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('Document A: 5 page(s)');
      expect(report).toContain('Document B: 3 page(s)');
    });

    it('includes overall diff percentage', () => {
      const results = {
        pagesA: 1,
        pagesB: 1,
        maxPages: 1,
        overallDiffPercentage: 3.14,
        pages: [
          { pageNum: 1, hasA: true, hasB: true, diffPercentage: 3.14 },
        ],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('3.14%');
      expect(report).toContain('DOCUMENT COMPARISON REPORT');
    });

    it('labels identical pages correctly', () => {
      const results = {
        pagesA: 1,
        pagesB: 1,
        maxPages: 1,
        overallDiffPercentage: 0,
        pages: [
          { pageNum: 1, hasA: true, hasB: true, diffPercentage: 0.001 },
        ],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('[Identical]');
    });

    it('labels pages only in A', () => {
      const results = {
        pagesA: 2,
        pagesB: 1,
        maxPages: 2,
        overallDiffPercentage: 50,
        pages: [
          { pageNum: 1, hasA: true, hasB: true, diffPercentage: 0 },
          { pageNum: 2, hasA: true, hasB: false, diffPercentage: 100 },
        ],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('[Only in A]');
    });

    it('labels pages only in B', () => {
      const results = {
        pagesA: 1,
        pagesB: 2,
        maxPages: 2,
        overallDiffPercentage: 50,
        pages: [
          { pageNum: 1, hasA: true, hasB: true, diffPercentage: 0 },
          { pageNum: 2, hasA: false, hasB: true, diffPercentage: 100 },
        ],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('[Only in B]');
    });

    it('labels minor changes, modified, and significantly changed', () => {
      const results = {
        pagesA: 3,
        pagesB: 3,
        maxPages: 3,
        overallDiffPercentage: 10,
        pages: [
          { pageNum: 1, hasA: true, hasB: true, diffPercentage: 0.5 },
          { pageNum: 2, hasA: true, hasB: true, diffPercentage: 5 },
          { pageNum: 3, hasA: true, hasB: true, diffPercentage: 25 },
        ],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('[Minor changes]');
      expect(report).toContain('[Modified]');
      expect(report).toContain('[Significantly changed]');
    });

    it('includes page numbers for each page entry', () => {
      const results = {
        pagesA: 2,
        pagesB: 2,
        maxPages: 2,
        overallDiffPercentage: 0,
        pages: [
          { pageNum: 1, hasA: true, hasB: true, diffPercentage: 0 },
          { pageNum: 2, hasA: true, hasB: true, diffPercentage: 0 },
        ],
      };
      const report = generateCompareReport(results);

      expect(report).toContain('Page 1:');
      expect(report).toContain('Page 2:');
    });
  });

  /* ── renderComparisonView ── */

  describe('renderComparisonView', () => {
    function createMockCanvas(w = 100, h = 130) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas;
    }

    it('renders side-by-side view with canvasA, canvasB, and diffCanvas', () => {
      const container = document.createElement('div');
      const pageResult = {
        canvasA: createMockCanvas(),
        canvasB: createMockCanvas(),
        diffCanvas: createMockCanvas(),
        diffPercentage: 5.0,
      };

      renderComparisonView(container, pageResult, { view: 'side-by-side' });

      // Should have 3 wrapper divs (Original, Modified, Differences)
      expect(container.children.length).toBe(3);
      expect(container.innerHTML).toContain('Original');
      expect(container.innerHTML).toContain('Modified');
      expect(container.innerHTML).toContain('Differences');
    });

    it('renders overlay view', () => {
      const container = document.createElement('div');
      const pageResult = {
        canvasA: createMockCanvas(),
        diffCanvas: createMockCanvas(),
        diffPercentage: 2.0,
      };

      renderComparisonView(container, pageResult, { view: 'overlay' });

      // Should have 1 wrapper with overlaid canvases
      expect(container.children.length).toBe(1);
    });

    it('renders diff-only view', () => {
      const container = document.createElement('div');
      const pageResult = {
        diffCanvas: createMockCanvas(),
        diffPercentage: 10.0,
      };

      renderComparisonView(container, pageResult, { view: 'diff-only' });

      expect(container.children.length).toBe(1);
      expect(container.innerHTML).toContain('Differences');
      expect(container.innerHTML).toContain('10.00%');
    });

    it('defaults to side-by-side when no view option given', () => {
      const container = document.createElement('div');
      const pageResult = {
        canvasA: createMockCanvas(),
        canvasB: createMockCanvas(),
        diffCanvas: createMockCanvas(),
        diffPercentage: 1.0,
      };

      renderComparisonView(container, pageResult);

      expect(container.innerHTML).toContain('Original');
      expect(container.innerHTML).toContain('Modified');
    });

    it('clears existing container content before rendering', () => {
      const container = document.createElement('div');
      container.innerHTML = '<p>Old content</p>';

      const pageResult = {
        canvasA: createMockCanvas(),
        diffPercentage: 0,
      };

      renderComparisonView(container, pageResult, { view: 'side-by-side' });

      expect(container.innerHTML).not.toContain('Old content');
    });

    it('handles page result with only canvasA (page only in doc A)', () => {
      const container = document.createElement('div');
      const pageResult = {
        canvasA: createMockCanvas(),
        diffPercentage: 100,
      };

      renderComparisonView(container, pageResult, { view: 'side-by-side' });

      expect(container.innerHTML).toContain('Original');
      expect(container.innerHTML).not.toContain('Modified');
    });
  });
});
