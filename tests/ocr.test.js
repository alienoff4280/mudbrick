import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runOCR,
  hasOCRResults,
  renderOCRTextLayer,
  getOCRTextEntries,
  clearOCRResults,
  terminateOCR,
} from '../js/ocr.js';

/* ── Stub canvas getContext so jsdom doesn't return null ── */

const mockCtx = {
  fillStyle: '',
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(400), // 10x10 RGBA
  })),
  putImageData: vi.fn(),
  clearRect: vi.fn(),
};

const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ ...mockCtx }));
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

describe('ocr.js', () => {
  beforeEach(async () => {
    clearOCRResults();
    await terminateOCR();
    delete window.Tesseract;
  });

  /* ── hasOCRResults ── */

  describe('hasOCRResults', () => {
    it('returns false when no OCR has been run', () => {
      expect(hasOCRResults(1)).toBe(false);
    });

    it('returns false for a page that was not processed', () => {
      expect(hasOCRResults(99)).toBe(false);
    });

    it('returns false after results are cleared', () => {
      clearOCRResults();
      expect(hasOCRResults(1)).toBe(false);
    });
  });

  /* ── clearOCRResults ── */

  describe('clearOCRResults', () => {
    it('resets state so hasOCRResults returns false', () => {
      clearOCRResults();
      expect(hasOCRResults(1)).toBe(false);
      expect(hasOCRResults(2)).toBe(false);
    });

    it('does not throw when called multiple times', () => {
      expect(() => clearOCRResults()).not.toThrow();
      expect(() => clearOCRResults()).not.toThrow();
    });

    it('causes getOCRTextEntries to return empty array', () => {
      clearOCRResults();
      expect(getOCRTextEntries()).toEqual([]);
    });
  });

  /* ── getOCRTextEntries ── */

  describe('getOCRTextEntries', () => {
    it('returns an empty array when no OCR results exist', () => {
      expect(getOCRTextEntries()).toEqual([]);
    });

    it('returns an empty array after clearOCRResults', () => {
      clearOCRResults();
      const entries = getOCRTextEntries();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(0);
    });

    it('returns array type', () => {
      const entries = getOCRTextEntries();
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  /* ── terminateOCR ── */

  describe('terminateOCR', () => {
    it('resolves without error when no worker exists', async () => {
      await expect(terminateOCR()).resolves.toBeUndefined();
    });

    it('can be called multiple times safely', async () => {
      await terminateOCR();
      await terminateOCR();
      // Should not throw
    });

    it('does not affect stored OCR results', async () => {
      clearOCRResults();
      await terminateOCR();
      expect(getOCRTextEntries()).toEqual([]);
    });
  });

  /* ── renderOCRTextLayer ── */

  describe('renderOCRTextLayer', () => {
    it('does nothing when no OCR results exist for the page', () => {
      const container = document.createElement('div');
      const viewport = { scale: 1 };
      renderOCRTextLayer(1, container, viewport);
      expect(container.children.length).toBe(0);
    });

    it('does not add spans for a page without results', () => {
      const container = document.createElement('div');
      const viewport = { scale: 1.5 };
      renderOCRTextLayer(42, container, viewport);
      expect(container.querySelector('.ocr-text-span')).toBeNull();
    });

    it('does not throw with empty container and valid viewport', () => {
      const container = document.createElement('div');
      const viewport = { scale: 2 };
      expect(() => renderOCRTextLayer(1, container, viewport)).not.toThrow();
    });
  });

  /* ── runOCR ── */

  describe('runOCR', () => {
    it('calls onProgress with loading status before attempting Tesseract load', async () => {
      // Pre-set Tesseract on window so ensureTesseract resolves immediately
      const mockWorker = {
        recognize: vi.fn(() =>
          Promise.resolve({ data: { text: 'Hello', blocks: [] } }),
        ),
        terminate: vi.fn(),
      };
      window.Tesseract = {
        createWorker: vi.fn(() => Promise.resolve(mockWorker)),
      };

      const mockPage = {
        getViewport: vi.fn(({ scale }) => ({
          width: 100 * scale,
          height: 130 * scale,
        })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      };
      const mockPdfDoc = {
        getPage: vi.fn(() => Promise.resolve(mockPage)),
      };

      const onProgress = vi.fn();
      await runOCR(mockPdfDoc, [1], onProgress);

      // The first onProgress call should be the loading status
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          current: 0,
          status: expect.stringContaining('Loading'),
          progress: 0,
        }),
      );
    });

    it('handles Tesseract returning blocks with word data', async () => {
      const mockWorker = {
        recognize: vi.fn(() =>
          Promise.resolve({
            data: {
              blocks: [
                {
                  paragraphs: [
                    {
                      lines: [
                        {
                          words: [
                            {
                              text: 'Hello',
                              bbox: { x0: 0, y0: 0, x1: 50, y1: 12 },
                              confidence: 95,
                            },
                            {
                              text: 'World',
                              bbox: { x0: 55, y0: 0, x1: 110, y1: 12 },
                              confidence: 90,
                            },
                          ],
                          bbox: { x0: 0, y0: 0, x1: 110, y1: 12 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
        ),
        terminate: vi.fn(),
      };

      window.Tesseract = {
        createWorker: vi.fn(() => Promise.resolve(mockWorker)),
      };

      const mockPage = {
        getViewport: vi.fn(({ scale }) => ({
          width: 612 * scale,
          height: 792 * scale,
        })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      };

      const mockPdfDoc = {
        getPage: vi.fn(() => Promise.resolve(mockPage)),
      };

      const results = await runOCR(mockPdfDoc, [1]);

      expect(results[1]).toBeDefined();
      expect(results[1].words).toHaveLength(2);
      expect(results[1].words[0].text).toBe('Hello');
      expect(results[1].words[1].text).toBe('World');
      expect(results[1].fullText).toContain('Hello World');
      expect(hasOCRResults(1)).toBe(true);
    });

    it('reports OCR complete via onProgress when finished', async () => {
      const mockWorker = {
        recognize: vi.fn(() =>
          Promise.resolve({ data: { blocks: [], text: '' } }),
        ),
        terminate: vi.fn(),
      };

      window.Tesseract = {
        createWorker: vi.fn(() => Promise.resolve(mockWorker)),
      };

      const mockPage = {
        getViewport: vi.fn(({ scale }) => ({
          width: 100 * scale,
          height: 130 * scale,
        })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      };

      const mockPdfDoc = {
        getPage: vi.fn(() => Promise.resolve(mockPage)),
      };

      const onProgress = vi.fn();
      await runOCR(mockPdfDoc, [1, 2], onProgress);

      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
      expect(lastCall.status).toBe('OCR complete');
      expect(lastCall.progress).toBe(100);
      expect(lastCall.current).toBe(2);
      expect(lastCall.total).toBe(2);
    });
  });
});
