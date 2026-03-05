import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addExhibitStamp, setExhibitOptions, resetExhibitCount,
  countExistingExhibits, EXHIBIT_FORMATS, getExhibitCount,
} from '../js/exhibit-stamps.js';

/* ── Helpers ── */

function makeMockCanvas() {
  return {
    add: vi.fn(),
    setActiveObject: vi.fn(),
    renderAll: vi.fn(),
  };
}

describe('exhibit-stamps.js', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    resetExhibitCount();
    setExhibitOptions('letter', '', true);

    // The source uses fabric.Text (not fabric.IText). Add a Text constructor mock
    // with set() method used for positioning.
    window.fabric.Text = vi.fn((text, opts) => ({
      text,
      ...opts,
      type: 'text',
      width: text.length * 8,
      height: (opts?.fontSize || 14),
      set: vi.fn(function(props) { Object.assign(this, props); }),
      setCoords: vi.fn(),
    }));
  });

  /* ── EXHIBIT_FORMATS ── */

  describe('EXHIBIT_FORMATS', () => {
    it('includes letter, number, roman-upper, and roman-lower formats', () => {
      expect(EXHIBIT_FORMATS).toHaveProperty('letter');
      expect(EXHIBIT_FORMATS).toHaveProperty('number');
      expect(EXHIBIT_FORMATS).toHaveProperty('roman-upper');
      expect(EXHIBIT_FORMATS).toHaveProperty('roman-lower');
    });

    it('letter format generates A, B, C...', () => {
      expect(EXHIBIT_FORMATS.letter.fn(1)).toBe('A');
      expect(EXHIBIT_FORMATS.letter.fn(2)).toBe('B');
      expect(EXHIBIT_FORMATS.letter.fn(26)).toBe('Z');
    });

    it('number format generates 1, 2, 3...', () => {
      expect(EXHIBIT_FORMATS.number.fn(1)).toBe('1');
      expect(EXHIBIT_FORMATS.number.fn(42)).toBe('42');
    });

    it('roman-upper format generates I, II, III...', () => {
      expect(EXHIBIT_FORMATS.roman_upper || EXHIBIT_FORMATS['roman-upper']).toBeDefined();
      const fmt = EXHIBIT_FORMATS['roman-upper'];
      expect(fmt.fn(1)).toBe('I');
      expect(fmt.fn(4)).toBe('IV');
      expect(fmt.fn(9)).toBe('IX');
      expect(fmt.fn(14)).toBe('XIV');
    });

    it('roman-lower format generates i, ii, iii...', () => {
      const fmt = EXHIBIT_FORMATS['roman-lower'];
      expect(fmt.fn(1)).toBe('i');
      expect(fmt.fn(4)).toBe('iv');
      expect(fmt.fn(10)).toBe('x');
    });

    it('each format has a label property', () => {
      for (const key of Object.keys(EXHIBIT_FORMATS)) {
        expect(EXHIBIT_FORMATS[key]).toHaveProperty('label');
        expect(typeof EXHIBIT_FORMATS[key].label).toBe('string');
      }
    });
  });

  /* ── resetExhibitCount ── */

  describe('resetExhibitCount', () => {
    it('resets the counter to zero', () => {
      // Add a stamp to increment the counter
      const canvas = makeMockCanvas();
      addExhibitStamp(canvas, 100, 100, 1);
      expect(getExhibitCount()).toBe(1);

      resetExhibitCount();
      expect(getExhibitCount()).toBe(0);
    });
  });

  /* ── setExhibitOptions ── */

  describe('setExhibitOptions', () => {
    it('changes the numbering format', () => {
      setExhibitOptions('number', '', true);
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1);
      expect(stamp.exhibitLabel).toBe('1');
    });

    it('adds a custom prefix', () => {
      setExhibitOptions('letter', 'Exhibit ', true);
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1);
      expect(stamp.exhibitLabel).toBe('Exhibit A');
    });

    it('defaults format to letter when falsy', () => {
      setExhibitOptions(null, '', true);
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1);
      expect(stamp.exhibitLabel).toBe('A');
    });
  });

  /* ── countExistingExhibits ── */

  describe('countExistingExhibits', () => {
    it('returns 0 for empty annotations', () => {
      expect(countExistingExhibits({})).toBe(0);
      expect(countExistingExhibits(null)).toBe(0);
      expect(countExistingExhibits(undefined)).toBe(0);
    });

    it('counts exhibit-stamp objects across pages', () => {
      const annotations = {
        1: {
          objects: [
            { mudbrickType: 'exhibit-stamp' },
            { mudbrickType: 'sticky-note' },
          ],
        },
        2: {
          objects: [
            { mudbrickType: 'exhibit-stamp' },
            { mudbrickType: 'exhibit-stamp' },
          ],
        },
      };
      expect(countExistingExhibits(annotations)).toBe(3);
    });

    it('handles JSON string annotations', () => {
      const annotations = {
        1: JSON.stringify({
          objects: [
            { mudbrickType: 'exhibit-stamp' },
          ],
        }),
      };
      expect(countExistingExhibits(annotations)).toBe(1);
    });

    it('skips malformed JSON gracefully', () => {
      const annotations = {
        1: 'not valid json {{{',
        2: { objects: [{ mudbrickType: 'exhibit-stamp' }] },
      };
      expect(countExistingExhibits(annotations)).toBe(1);
    });

    it('skips null entries', () => {
      const annotations = { 1: null, 2: null };
      expect(countExistingExhibits(annotations)).toBe(0);
    });
  });

  /* ── addExhibitStamp ── */

  describe('addExhibitStamp', () => {
    it('returns null when canvas is null', () => {
      const result = addExhibitStamp(null, 100, 100, 1);
      expect(result).toBeNull();
    });

    it('creates a stamp group and adds it to canvas', () => {
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 200, 150, 1);

      expect(stamp).not.toBeNull();
      expect(canvas.add).toHaveBeenCalledWith(stamp);
      expect(canvas.setActiveObject).toHaveBeenCalledWith(stamp);
      expect(canvas.renderAll).toHaveBeenCalled();
    });

    it('auto-increments the exhibit count', () => {
      const canvas = makeMockCanvas();
      const stamp1 = addExhibitStamp(canvas, 100, 100, 1);
      const stamp2 = addExhibitStamp(canvas, 200, 200, 1);

      expect(stamp1.exhibitNumber).toBe(1);
      expect(stamp2.exhibitNumber).toBe(2);
      expect(stamp1.exhibitLabel).toBe('A');
      expect(stamp2.exhibitLabel).toBe('B');
    });

    it('sets mudbrickType to exhibit-stamp', () => {
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1);
      expect(stamp.mudbrickType).toBe('exhibit-stamp');
    });

    it('stores the exhibit format', () => {
      setExhibitOptions('roman-upper', '', true);
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1);
      expect(stamp.exhibitFormat).toBe('roman-upper');
      expect(stamp.exhibitLabel).toBe('I');
    });

    it('allows overriding number and label via opts', () => {
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1, {
        number: 5,
        label: 'Custom-5',
      });
      expect(stamp.exhibitNumber).toBe(5);
      expect(stamp.exhibitLabel).toBe('Custom-5');
    });

    it('uses number format correctly', () => {
      setExhibitOptions('number', '', true);
      const canvas = makeMockCanvas();
      const stamp1 = addExhibitStamp(canvas, 100, 100, 1);
      const stamp2 = addExhibitStamp(canvas, 200, 200, 1);
      expect(stamp1.exhibitLabel).toBe('1');
      expect(stamp2.exhibitLabel).toBe('2');
    });

    it('uses roman numeral format', () => {
      setExhibitOptions('roman-lower', '', true);
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 100, 100, 1);
      expect(stamp.exhibitLabel).toBe('i');
    });

    it('positions the stamp at given coordinates', () => {
      const canvas = makeMockCanvas();
      const stamp = addExhibitStamp(canvas, 300, 450, 1);
      expect(stamp.left).toBe(300);
      expect(stamp.top).toBe(450);
    });
  });
});
