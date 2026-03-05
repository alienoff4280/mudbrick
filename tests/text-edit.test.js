import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enterTextEditMode,
  exitTextEditMode,
  isTextEditActive,
  hasTextEditChanges,
  enterImageEditMode,
  exitImageEditMode,
  isImageEditActive,
  hasImageEditChanges,
} from '../js/text-edit.js';

/* ── Helpers ── */

function makeMockContainer() {
  const container = document.createElement('div');
  container.classList.add('page-container');

  // Add a mock text layer
  const textLayer = document.createElement('div');
  textLayer.classList.add('textLayer');
  container.appendChild(textLayer);

  // Add a mock canvas
  const canvas = document.createElement('canvas');
  canvas.width = 612;
  canvas.height = 792;
  canvas.style.width = '612px';
  container.appendChild(canvas);

  document.body.appendChild(container);
  return container;
}

function makeMockViewport() {
  return {
    width: 612,
    height: 792,
    scale: 1.0,
    viewBox: [0, 0, 612, 792],
    // Identity-like transform matrix used by PDF.js
    transform: [1, 0, 0, -1, 0, 792],
    convertToViewportPoint: vi.fn((x, y) => [x, y]),
  };
}

function makeMockPdfDoc() {
  return {
    getPage: vi.fn(() => Promise.resolve({
      getTextContent: vi.fn(() => Promise.resolve({
        items: [],
        styles: {},
      })),
      getOperatorList: vi.fn(() => Promise.resolve({
        fnArray: [],
        argsArray: [],
      })),
      commonObjs: { get: vi.fn(), has: vi.fn(() => false) },
      getViewport: vi.fn(() => makeMockViewport()),
    })),
  };
}

function makeMockPdfCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 612;
  canvas.height = 792;
  canvas.style.width = '612px';
  return canvas;
}

/* ── Tests ── */

describe('text-edit.js', () => {
  beforeEach(() => {
    // Ensure clean state
    exitTextEditMode();
    exitImageEditMode();
  });

  /* ── isTextEditActive ── */

  describe('isTextEditActive', () => {
    it('returns false initially', () => {
      expect(isTextEditActive()).toBe(false);
    });

    it('returns false after exitTextEditMode', () => {
      exitTextEditMode();
      expect(isTextEditActive()).toBe(false);
    });

    it('returns false when called multiple times without entering', () => {
      expect(isTextEditActive()).toBe(false);
      expect(isTextEditActive()).toBe(false);
    });
  });

  /* ── hasTextEditChanges ── */

  describe('hasTextEditChanges', () => {
    it('returns false when not in edit mode', () => {
      expect(hasTextEditChanges()).toBe(false);
    });

    it('returns false after exiting edit mode', () => {
      exitTextEditMode();
      expect(hasTextEditChanges()).toBe(false);
    });

    it('returns false when editContainer is null', () => {
      // editContainer is null by default
      expect(hasTextEditChanges()).toBe(false);
    });
  });

  /* ── isImageEditActive ── */

  describe('isImageEditActive', () => {
    it('returns false initially', () => {
      expect(isImageEditActive()).toBe(false);
    });

    it('returns false after exitImageEditMode', () => {
      exitImageEditMode();
      expect(isImageEditActive()).toBe(false);
    });

    it('returns false when called repeatedly', () => {
      expect(isImageEditActive()).toBe(false);
      expect(isImageEditActive()).toBe(false);
      expect(isImageEditActive()).toBe(false);
    });
  });

  /* ── hasImageEditChanges ── */

  describe('hasImageEditChanges', () => {
    it('returns false when no overlays have pending actions', () => {
      expect(hasImageEditChanges()).toBe(false);
    });

    it('returns false after exiting image edit mode', () => {
      exitImageEditMode();
      expect(hasImageEditChanges()).toBe(false);
    });

    it('returns false on initial state', () => {
      // imageOverlays is [] initially, .some() returns false on empty
      expect(hasImageEditChanges()).toBe(false);
    });
  });

  /* ── exitTextEditMode ── */

  describe('exitTextEditMode', () => {
    it('does not throw when not in edit mode', () => {
      expect(() => exitTextEditMode()).not.toThrow();
    });

    it('resets isTextEditActive to false', () => {
      exitTextEditMode();
      expect(isTextEditActive()).toBe(false);
    });

    it('can be called multiple times safely', () => {
      exitTextEditMode();
      exitTextEditMode();
      exitTextEditMode();
      expect(isTextEditActive()).toBe(false);
    });

    it('clears hasTextEditChanges', () => {
      exitTextEditMode();
      expect(hasTextEditChanges()).toBe(false);
    });
  });

  /* ── exitImageEditMode ── */

  describe('exitImageEditMode', () => {
    it('does not throw when not in edit mode', () => {
      expect(() => exitImageEditMode()).not.toThrow();
    });

    it('resets isImageEditActive to false', () => {
      exitImageEditMode();
      expect(isImageEditActive()).toBe(false);
    });

    it('can be called multiple times safely', () => {
      exitImageEditMode();
      exitImageEditMode();
      exitImageEditMode();
      expect(isImageEditActive()).toBe(false);
    });

    it('clears image overlays so hasImageEditChanges returns false', () => {
      exitImageEditMode();
      expect(hasImageEditChanges()).toBe(false);
    });
  });

  /* ── enterTextEditMode ── */

  describe('enterTextEditMode', () => {
    it('returns false when page has no text content (no editable text)', async () => {
      const container = makeMockContainer();
      const viewport = makeMockViewport();
      const pdfDoc = makeMockPdfDoc();
      const pdfCanvas = makeMockPdfCanvas();

      // enterTextEditMode returns false when no text is found
      const result = await enterTextEditMode(1, pdfDoc, viewport, container, pdfCanvas);
      expect(result).toBe(false);

      // Should NOT be active since there was no text
      expect(isTextEditActive()).toBe(false);

      container.remove();
    });

    it('activates when text content is present', async () => {
      const container = makeMockContainer();
      const viewport = makeMockViewport();
      const pdfCanvas = makeMockPdfCanvas();

      // Create a mock with actual text items
      const pdfDoc = {
        getPage: vi.fn(() => Promise.resolve({
          getTextContent: vi.fn(() => Promise.resolve({
            items: [{
              str: 'Hello World',
              transform: [12, 0, 0, 12, 72, 720], // fontSize=12, x=72, y=720
              width: 60,
              height: 12,
              fontName: 'Helvetica',
            }],
            styles: {
              Helvetica: { fontFamily: 'Helvetica', ascent: 0.9, descent: -0.1 },
            },
          })),
          commonObjs: { get: vi.fn(), has: vi.fn(() => false) },
        })),
      };

      await enterTextEditMode(1, pdfDoc, viewport, container, pdfCanvas);
      expect(isTextEditActive()).toBe(true);

      // Cleanup
      exitTextEditMode();
      container.remove();
    });

    it('exits previous edit mode before entering new one', async () => {
      const container = makeMockContainer();
      const viewport = makeMockViewport();
      const pdfCanvas = makeMockPdfCanvas();
      const pdfDoc = makeMockPdfDoc();

      // First call — returns false due to no text, but should not throw
      await enterTextEditMode(1, pdfDoc, viewport, container, pdfCanvas);
      // Call again — should handle re-entry gracefully
      await enterTextEditMode(2, pdfDoc, viewport, container, pdfCanvas);
      expect(() => exitTextEditMode()).not.toThrow();

      container.remove();
    });
  });

  /* ── Mode transition integrity ── */

  describe('mode transitions', () => {
    it('entering then exiting text edit resets all state', async () => {
      const container = makeMockContainer();
      const viewport = makeMockViewport();
      const pdfCanvas = makeMockPdfCanvas();

      const pdfDoc = {
        getPage: vi.fn(() => Promise.resolve({
          getTextContent: vi.fn(() => Promise.resolve({
            items: [{
              str: 'Test text',
              transform: [12, 0, 0, 12, 72, 720],
              width: 50,
              height: 12,
              fontName: 'Helvetica',
            }],
            styles: { Helvetica: { fontFamily: 'Helvetica', ascent: 0.9, descent: -0.1 } },
          })),
          commonObjs: { get: vi.fn(), has: vi.fn(() => false) },
        })),
      };

      await enterTextEditMode(1, pdfDoc, viewport, container, pdfCanvas);
      expect(isTextEditActive()).toBe(true);

      exitTextEditMode();
      expect(isTextEditActive()).toBe(false);
      expect(hasTextEditChanges()).toBe(false);

      container.remove();
    });

    it('text and image edit modes are independent', () => {
      // Both should be inactive
      expect(isTextEditActive()).toBe(false);
      expect(isImageEditActive()).toBe(false);

      // Exiting one should not affect the other
      exitTextEditMode();
      expect(isImageEditActive()).toBe(false);

      exitImageEditMode();
      expect(isTextEditActive()).toBe(false);
    });

    it('exiting text edit mode removes toolbar from DOM', async () => {
      const container = makeMockContainer();
      const viewport = makeMockViewport();
      const pdfCanvas = makeMockPdfCanvas();

      const pdfDoc = {
        getPage: vi.fn(() => Promise.resolve({
          getTextContent: vi.fn(() => Promise.resolve({
            items: [{
              str: 'Some text',
              transform: [12, 0, 0, 12, 72, 720],
              width: 50,
              height: 12,
              fontName: 'Helvetica',
            }],
            styles: { Helvetica: { fontFamily: 'Helvetica', ascent: 0.9, descent: -0.1 } },
          })),
          commonObjs: { get: vi.fn(), has: vi.fn(() => false) },
        })),
      };

      await enterTextEditMode(1, pdfDoc, viewport, container, pdfCanvas);
      expect(document.querySelector('.text-edit-toolbar')).not.toBeNull();

      exitTextEditMode();
      expect(document.querySelector('.text-edit-toolbar')).toBeNull();

      container.remove();
    });
  });
});
