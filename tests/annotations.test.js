import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the history module before importing annotations
vi.mock('../js/history.js', () => ({
  pushState: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  canUndo: vi.fn(() => false),
  canRedo: vi.fn(() => false),
  clearHistory: vi.fn(),
}));

import {
  initAnnotations,
  getCanvas,
  hasAnnotations,
  getAnnotations,
  savePageAnnotations,
  loadPageAnnotations,
  resizeOverlay,
  setTool,
  updateToolOptions,
  getToolOptions,
  deleteSelected,
  dispose,
  addAnnotationToPage,
  getAllStickyNotes,
} from '../js/annotations.js';

/* ── Helpers ── */

function setupFabricCanvasWrapper() {
  let wrapper = document.getElementById('fabric-canvas-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'fabric-canvas-wrapper';
    document.body.appendChild(wrapper);
  }

  let canvasEl = document.getElementById('fabric-canvas');
  if (!canvasEl) {
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'fabric-canvas';
    wrapper.appendChild(canvasEl);
  }
}

/* ── Tests ── */

describe('annotations.js', () => {
  beforeEach(() => {
    // Reset canvas state
    dispose();
    setupFabricCanvasWrapper();
  });

  /* ── hasAnnotations ── */

  describe('hasAnnotations', () => {
    it('returns false when no annotations exist', () => {
      expect(hasAnnotations()).toBe(false);
    });

    it('returns true after annotations are added to a page', () => {
      addAnnotationToPage(1, { type: 'rect', left: 10, top: 10 });
      expect(hasAnnotations()).toBe(true);
    });

    it('returns false when annotation page has empty objects array', () => {
      // Clean all existing annotations first
      const anns = getAnnotations();
      for (const key of Object.keys(anns)) {
        delete anns[key];
      }
      // Add a page with empty objects
      anns[50] = { version: '5.3.0', objects: [] };
      expect(hasAnnotations()).toBe(false);
      // Cleanup
      delete anns[50];
    });
  });

  /* ── getAnnotations ── */

  describe('getAnnotations', () => {
    it('returns the page annotations object', () => {
      const anns = getAnnotations();
      expect(typeof anns).toBe('object');
      expect(anns).not.toBeNull();
    });

    it('reflects added annotations', () => {
      addAnnotationToPage(5, { type: 'circle', left: 50, top: 50 });
      const anns = getAnnotations();
      expect(anns[5]).toBeDefined();
      expect(anns[5].objects).toHaveLength(1);
    });

    it('returns the same reference (mutable state)', () => {
      const a = getAnnotations();
      const b = getAnnotations();
      expect(a).toBe(b);
    });
  });

  /* ── addAnnotationToPage ── */

  describe('addAnnotationToPage', () => {
    it('creates page entry if it does not exist', () => {
      const anns = getAnnotations();
      // Clear any leftover
      delete anns[99];

      addAnnotationToPage(99, { type: 'rect' });
      expect(anns[99]).toBeDefined();
      expect(anns[99].objects).toHaveLength(1);
    });

    it('appends to existing page annotations', () => {
      addAnnotationToPage(3, { type: 'rect' });
      addAnnotationToPage(3, { type: 'circle' });
      const anns = getAnnotations();
      expect(anns[3].objects).toHaveLength(2);
    });

    it('stores the exact object JSON passed in', () => {
      const obj = { type: 'i-text', text: 'Hello', left: 100, top: 200, mudbrickType: 'text' };
      addAnnotationToPage(7, obj);
      const anns = getAnnotations();
      expect(anns[7].objects[0]).toEqual(obj);
    });
  });

  /* ── savePageAnnotations / loadPageAnnotations ── */

  describe('savePageAnnotations / loadPageAnnotations', () => {
    it('savePageAnnotations does not throw when canvas is null', () => {
      dispose();
      expect(() => savePageAnnotations(1)).not.toThrow();
    });

    it('loadPageAnnotations does not throw when canvas is null', () => {
      dispose();
      expect(() => loadPageAnnotations(1)).not.toThrow();
    });

    it('savePageAnnotations stores canvas state and loadPageAnnotations restores it', () => {
      initAnnotations('fabric-canvas');
      const canvas = getCanvas();
      expect(canvas).not.toBeNull();

      // Save state for page 1
      savePageAnnotations(1);

      // Load it back
      loadPageAnnotations(1);
      // Should not throw and canvas should still exist
      expect(getCanvas()).not.toBeNull();
    });

    it('savePageAnnotations deletes page entry when canvas has no objects', () => {
      initAnnotations('fabric-canvas');
      const canvas = getCanvas();

      // Canvas mock returns [] for getObjects
      savePageAnnotations(10);
      const anns = getAnnotations();
      expect(anns[10]).toBeUndefined();
    });
  });

  /* ── initAnnotations ── */

  describe('initAnnotations', () => {
    it('creates a fabric canvas', () => {
      const canvas = initAnnotations('fabric-canvas');
      expect(canvas).toBeDefined();
      expect(getCanvas()).toBe(canvas);
    });

    it('returns undefined when fabric is not available', () => {
      const saved = window.fabric;
      window.fabric = null;
      const result = initAnnotations('fabric-canvas');
      expect(result).toBeUndefined();
      window.fabric = saved;
    });

    it('can be called multiple times (reinitialize)', () => {
      initAnnotations('fabric-canvas');
      const c1 = getCanvas();
      initAnnotations('fabric-canvas');
      const c2 = getCanvas();
      // Both should be valid canvases
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();
    });
  });

  /* ── resizeOverlay ── */

  describe('resizeOverlay', () => {
    it('does not throw when canvas is null', () => {
      dispose();
      expect(() => resizeOverlay(800, 600, 1.5)).not.toThrow();
    });

    it('sets width and height on the canvas', () => {
      const canvas = initAnnotations('fabric-canvas');
      resizeOverlay(800, 600, 1.5);
      expect(canvas.setWidth).toHaveBeenCalledWith(800);
      expect(canvas.setHeight).toHaveBeenCalledWith(600);
    });

    it('calls renderAll after resizing', () => {
      const canvas = initAnnotations('fabric-canvas');
      resizeOverlay(400, 300, 1.0);
      expect(canvas.renderAll).toHaveBeenCalled();
    });
  });

  /* ── updateToolOptions / getToolOptions ── */

  describe('updateToolOptions / getToolOptions', () => {
    it('returns default tool options', () => {
      const opts = getToolOptions();
      expect(opts).toHaveProperty('color');
      expect(opts).toHaveProperty('strokeWidth');
      expect(opts).toHaveProperty('fontSize');
    });

    it('updates tool options with new values', () => {
      updateToolOptions({ color: '#ff0000', strokeWidth: 5 });
      const opts = getToolOptions();
      expect(opts.color).toBe('#ff0000');
      expect(opts.strokeWidth).toBe(5);
    });

    it('returns a copy, not the original', () => {
      const a = getToolOptions();
      const b = getToolOptions();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  /* ── deleteSelected ── */

  describe('deleteSelected', () => {
    it('does not throw when canvas is null', () => {
      dispose();
      expect(() => deleteSelected()).not.toThrow();
    });

    it('does not throw when no objects are selected', () => {
      const canvas = initAnnotations('fabric-canvas');
      canvas.getActiveObjects = vi.fn(() => []);
      expect(() => deleteSelected()).not.toThrow();
    });

    it('removes active objects from canvas', () => {
      const canvas = initAnnotations('fabric-canvas');
      const mockObj = { type: 'rect' };
      canvas.getActiveObjects = vi.fn(() => [mockObj]);
      canvas.discardActiveObject = vi.fn();

      deleteSelected();
      expect(canvas.remove).toHaveBeenCalledWith(mockObj);
      expect(canvas.discardActiveObject).toHaveBeenCalled();
    });
  });

  /* ── dispose ── */

  describe('dispose', () => {
    it('sets canvas to null', () => {
      initAnnotations('fabric-canvas');
      expect(getCanvas()).not.toBeNull();
      dispose();
      expect(getCanvas()).toBeNull();
    });

    it('does not throw when called twice', () => {
      dispose();
      expect(() => dispose()).not.toThrow();
    });

    it('calls dispose on the fabric canvas', () => {
      const canvas = initAnnotations('fabric-canvas');
      dispose();
      expect(canvas.dispose).toHaveBeenCalled();
    });
  });

  /* ── getAllStickyNotes ── */

  describe('getAllStickyNotes', () => {
    it('returns empty array when no sticky notes exist', () => {
      expect(getAllStickyNotes()).toEqual([]);
    });

    it('returns sticky notes from annotations', () => {
      addAnnotationToPage(1, { mudbrickType: 'sticky-note', noteText: 'Hello', noteColor: 'yellow' });
      addAnnotationToPage(1, { mudbrickType: 'rect' }); // not a sticky note
      addAnnotationToPage(2, { mudbrickType: 'sticky-note', noteText: 'World', noteColor: 'blue' });

      const notes = getAllStickyNotes();
      expect(notes).toHaveLength(2);
      expect(notes[0]).toMatchObject({ pageNum: 1, noteText: 'Hello', noteColor: 'yellow' });
      expect(notes[1]).toMatchObject({ pageNum: 2, noteText: 'World', noteColor: 'blue' });
    });

    it('uses default color when noteColor is missing', () => {
      addAnnotationToPage(4, { mudbrickType: 'sticky-note', noteText: 'Test' });
      const notes = getAllStickyNotes();
      expect(notes[0].noteColor).toBe('yellow');
    });
  });
});
