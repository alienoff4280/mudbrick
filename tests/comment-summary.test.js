import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/annotations.js', () => ({
  getAnnotations: vi.fn(() => ({})),
  getCanvas: vi.fn(() => null),
  savePageAnnotations: vi.fn(),
  loadPageAnnotations: vi.fn(),
  resizeOverlay: vi.fn(),
}));

import {
  exportCommentsText, exportCommentsJSON, exportCommentsCSV, getAnnotationStats,
} from '../js/comment-summary.js';
import { getAnnotations, savePageAnnotations } from '../js/annotations.js';

/* ── Sample annotation data ── */

const sampleAnnotations = {
  1: {
    objects: [
      {
        mudbrickType: 'sticky-note',
        noteText: 'Important note here',
        noteColor: 'yellow',
        left: 100,
        top: 50,
        date: '2025-01-15T10:00:00.000Z',
      },
      {
        mudbrickType: 'highlight',
        stroke: '#ffff00',
        left: 200,
        top: 120,
        date: '2025-01-15T11:00:00.000Z',
      },
    ],
  },
  3: {
    objects: [
      {
        mudbrickType: 'text',
        text: 'A text annotation',
        left: 50,
        top: 300,
        date: '2025-01-16T09:00:00.000Z',
      },
      {
        mudbrickType: 'stamp',
        objects: [
          { type: 'i-text', text: 'APPROVED' },
        ],
        left: 400,
        top: 400,
        date: '2025-01-16T10:00:00.000Z',
      },
    ],
  },
};

describe('comment-summary.js', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ── exportCommentsText ── */

  describe('exportCommentsText', () => {
    it('returns "No annotations found." when there are no annotations', () => {
      getAnnotations.mockReturnValue({});
      const result = exportCommentsText(1);
      expect(result).toBe('No annotations found.');
    });

    it('saves current page before collecting', () => {
      getAnnotations.mockReturnValue({});
      exportCommentsText(2);
      expect(savePageAnnotations).toHaveBeenCalledWith(2);
    });

    it('returns formatted text with annotations', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const result = exportCommentsText(1);
      expect(result).toContain('ANNOTATION SUMMARY');
      expect(result).toContain('Page 1');
      expect(result).toContain('Page 3');
      expect(result).toContain('Important note here');
      expect(result).toContain('[Highlight]');
      expect(result).toContain('A text annotation');
      expect(result).toContain('APPROVED');
      expect(result).toContain('Total: 4 annotation(s)');
    });

    it('includes type labels for different annotation types', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const result = exportCommentsText(1);
      expect(result).toContain('[Note]');
      expect(result).toContain('[Highlight]');
      expect(result).toContain('[Text]');
      expect(result).toContain('[Stamp]');
    });
  });

  /* ── exportCommentsJSON ── */

  describe('exportCommentsJSON', () => {
    it('returns valid JSON with empty annotations', () => {
      getAnnotations.mockReturnValue({});
      const result = exportCommentsJSON(1);
      const parsed = JSON.parse(result);
      expect(parsed.documentAnnotations).toEqual([]);
      expect(parsed.totalCount).toBe(0);
      expect(parsed).toHaveProperty('exportDate');
    });

    it('returns JSON with annotation details', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const result = exportCommentsJSON(1);
      const parsed = JSON.parse(result);
      expect(parsed.totalCount).toBe(4);
      expect(parsed.documentAnnotations).toHaveLength(4);
      expect(parsed.documentAnnotations[0].type).toBe('sticky-note');
      expect(parsed.documentAnnotations[0].text).toBe('Important note here');
    });

    it('sorts annotations by page then Y position', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const result = exportCommentsJSON(1);
      const parsed = JSON.parse(result);
      const pages = parsed.documentAnnotations.map(a => a.page);
      expect(pages).toEqual([1, 1, 3, 3]);
    });
  });

  /* ── exportCommentsCSV ── */

  describe('exportCommentsCSV', () => {
    it('returns only the header when there are no annotations', () => {
      getAnnotations.mockReturnValue({});
      const result = exportCommentsCSV(1);
      expect(result).toBe('Page,Type,Text,X,Y,Color,Date');
    });

    it('returns CSV rows for annotations', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const result = exportCommentsCSV(1);
      const lines = result.split('\n');
      expect(lines[0]).toBe('Page,Type,Text,X,Y,Color,Date');
      expect(lines.length).toBe(5); // header + 4 annotations
    });

    it('escapes commas and quotes in text', () => {
      getAnnotations.mockReturnValue({
        1: {
          objects: [
            {
              mudbrickType: 'text',
              text: 'Text with, comma and "quotes"',
              left: 10,
              top: 20,
              date: '2025-01-01',
            },
          ],
        },
      });
      const result = exportCommentsCSV(1);
      // The text field should be quoted with escaped inner quotes
      expect(result).toContain('"Text with, comma and ""quotes"""');
    });

    it('includes color for annotations that have it', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const result = exportCommentsCSV(1);
      expect(result).toContain('yellow'); // sticky-note color
      expect(result).toContain('#ffff00'); // highlight color
    });
  });

  /* ── getAnnotationStats ── */

  describe('getAnnotationStats', () => {
    it('returns zero stats for empty annotations', () => {
      getAnnotations.mockReturnValue({});
      const stats = getAnnotationStats(1);
      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.byPage).toEqual({});
      expect(stats.pages).toBe(0);
    });

    it('returns correct totals and breakdowns', () => {
      getAnnotations.mockReturnValue(sampleAnnotations);
      const stats = getAnnotationStats(1);
      expect(stats.total).toBe(4);
      expect(stats.pages).toBe(2);
      expect(stats.byType['sticky-note']).toBe(1);
      expect(stats.byType['highlight']).toBe(1);
      expect(stats.byType['text']).toBe(1);
      expect(stats.byType['stamp']).toBe(1);
      expect(stats.byPage[1]).toBe(2);
      expect(stats.byPage[3]).toBe(2);
    });
  });

  /* ── Annotation type coverage ── */

  describe('annotation type formatting', () => {
    const typeTests = [
      { mudbrickType: 'underline', expected: '[Underline]' },
      { mudbrickType: 'strikethrough', expected: '[Strikethrough]' },
      { mudbrickType: 'cover', expected: '[Cover/Whiteout]' },
      { mudbrickType: 'redact', expected: '[Redaction]' },
      { mudbrickType: 'shape', expected: '[Shape]' },
      { mudbrickType: 'image', expected: '[Image]' },
    ];

    for (const { mudbrickType, expected } of typeTests) {
      it(`formats ${mudbrickType} as "${expected}"`, () => {
        getAnnotations.mockReturnValue({
          1: {
            objects: [{ mudbrickType, left: 0, top: 0, date: '2025-01-01' }],
          },
        });
        const result = exportCommentsText(1);
        expect(result).toContain(expected);
      });
    }

    it('formats path objects as "[Drawing]"', () => {
      getAnnotations.mockReturnValue({
        1: {
          objects: [{ type: 'path', left: 0, top: 0, date: '2025-01-01' }],
        },
      });
      const result = exportCommentsText(1);
      expect(result).toContain('[Drawing]');
    });
  });
});
