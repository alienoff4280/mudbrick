import { describe, it, expect, beforeEach } from 'vitest';
import {
  toRoman,
  toAlpha,
  LABEL_FORMATS,
  setLabelRange,
  getPageLabel,
  getLabelRanges,
  clearLabels,
  removeLabelRange,
  previewLabels,
} from '../js/page-labels.js';

/* ── toRoman ── */

describe('toRoman', () => {
  it('converts basic numbers', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(5)).toBe('V');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(10)).toBe('X');
    expect(toRoman(14)).toBe('XIV');
    expect(toRoman(40)).toBe('XL');
    expect(toRoman(50)).toBe('L');
    expect(toRoman(90)).toBe('XC');
    expect(toRoman(100)).toBe('C');
    expect(toRoman(400)).toBe('CD');
    expect(toRoman(500)).toBe('D');
    expect(toRoman(900)).toBe('CM');
    expect(toRoman(1000)).toBe('M');
  });

  it('converts compound numbers', () => {
    expect(toRoman(2024)).toBe('MMXXIV');
    expect(toRoman(3999)).toBe('MMMCMXCIX');
    expect(toRoman(1776)).toBe('MDCCLXXVI');
  });

  it('returns the number as string for zero or negative', () => {
    expect(toRoman(0)).toBe('0');
    expect(toRoman(-1)).toBe('-1');
  });
});

/* ── toAlpha ── */

describe('toAlpha', () => {
  it('converts single-letter values', () => {
    expect(toAlpha(1)).toBe('A');
    expect(toAlpha(2)).toBe('B');
    expect(toAlpha(26)).toBe('Z');
  });

  it('wraps to double letters after 26', () => {
    expect(toAlpha(27)).toBe('AA');
    expect(toAlpha(28)).toBe('AB');
    expect(toAlpha(52)).toBe('AZ');
    expect(toAlpha(53)).toBe('BA');
  });

  it('returns the number as string for zero or negative', () => {
    expect(toAlpha(0)).toBe('0');
    expect(toAlpha(-1)).toBe('-1');
  });
});

/* ── LABEL_FORMATS ── */

describe('LABEL_FORMATS', () => {
  it('contains all expected format keys', () => {
    expect(LABEL_FORMATS).toContain('decimal');
    expect(LABEL_FORMATS).toContain('roman-upper');
    expect(LABEL_FORMATS).toContain('roman-lower');
    expect(LABEL_FORMATS).toContain('alpha-upper');
    expect(LABEL_FORMATS).toContain('alpha-lower');
    expect(LABEL_FORMATS).toHaveLength(5);
  });
});

/* ── Label Range Management ── */

describe('Label ranges', () => {
  beforeEach(() => {
    clearLabels();
  });

  it('returns raw page number when no ranges are set', () => {
    expect(getPageLabel(1)).toBe('1');
    expect(getPageLabel(5)).toBe('5');
  });

  it('formats pages with decimal range', () => {
    setLabelRange(1, 5, 'decimal', '', 1);
    expect(getPageLabel(1)).toBe('1');
    expect(getPageLabel(3)).toBe('3');
    expect(getPageLabel(5)).toBe('5');
  });

  it('formats pages with roman-upper range', () => {
    setLabelRange(1, 5, 'roman-upper', '', 1);
    expect(getPageLabel(1)).toBe('I');
    expect(getPageLabel(4)).toBe('IV');
    expect(getPageLabel(5)).toBe('V');
  });

  it('formats pages with roman-lower range', () => {
    setLabelRange(1, 3, 'roman-lower', '', 1);
    expect(getPageLabel(1)).toBe('i');
    expect(getPageLabel(3)).toBe('iii');
  });

  it('formats pages with alpha-upper range', () => {
    setLabelRange(1, 3, 'alpha-upper', '', 1);
    expect(getPageLabel(1)).toBe('A');
    expect(getPageLabel(3)).toBe('C');
  });

  it('formats pages with alpha-lower range', () => {
    setLabelRange(1, 3, 'alpha-lower', '', 1);
    expect(getPageLabel(1)).toBe('a');
    expect(getPageLabel(3)).toBe('c');
  });

  it('applies prefix to labels', () => {
    setLabelRange(1, 5, 'decimal', 'App-', 1);
    expect(getPageLabel(1)).toBe('App-1');
    expect(getPageLabel(3)).toBe('App-3');
  });

  it('uses custom startNum offset', () => {
    setLabelRange(3, 5, 'decimal', '', 10);
    expect(getPageLabel(3)).toBe('10');
    expect(getPageLabel(4)).toBe('11');
    expect(getPageLabel(5)).toBe('12');
  });

  it('falls back to raw number for pages outside any range', () => {
    setLabelRange(1, 3, 'roman-upper', '', 1);
    expect(getPageLabel(4)).toBe('4');
    expect(getPageLabel(10)).toBe('10');
  });

  it('getLabelRanges returns current ranges', () => {
    setLabelRange(1, 5, 'decimal', '', 1);
    setLabelRange(6, 10, 'roman-upper', 'App-', 1);
    const ranges = getLabelRanges();
    expect(ranges).toHaveLength(2);
    expect(ranges[0].startPage).toBe(1);
    expect(ranges[1].startPage).toBe(6);
  });

  it('getLabelRanges returns a copy, not the internal array', () => {
    setLabelRange(1, 5, 'decimal', '', 1);
    const ranges = getLabelRanges();
    ranges.push({ fake: true });
    expect(getLabelRanges()).toHaveLength(1);
  });

  it('removeLabelRange removes by index', () => {
    setLabelRange(1, 5, 'decimal', '', 1);
    setLabelRange(6, 10, 'roman-upper', '', 1);
    removeLabelRange(0);
    expect(getLabelRanges()).toHaveLength(1);
    expect(getLabelRanges()[0].startPage).toBe(6);
  });

  it('removeLabelRange ignores out-of-bounds index', () => {
    setLabelRange(1, 5, 'decimal', '', 1);
    removeLabelRange(5);
    removeLabelRange(-1);
    expect(getLabelRanges()).toHaveLength(1);
  });

  it('setLabelRange removes overlapping ranges', () => {
    setLabelRange(1, 10, 'decimal', '', 1);
    setLabelRange(3, 7, 'roman-upper', '', 1);
    // The original 1-10 range overlaps with 3-7, so it should be removed
    const ranges = getLabelRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].format).toBe('roman-upper');
  });

  it('previewLabels returns labels for all pages', () => {
    setLabelRange(1, 3, 'roman-upper', '', 1);
    const labels = previewLabels(5);
    expect(labels).toEqual([
      { page: 1, label: 'I' },
      { page: 2, label: 'II' },
      { page: 3, label: 'III' },
      { page: 4, label: '4' },
      { page: 5, label: '5' },
    ]);
  });
});
