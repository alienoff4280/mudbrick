import { describe, it, expect } from 'vitest';
import { parsePageRanges, formatFileSize } from '../js/utils.js';

/* ── parsePageRanges ── */

describe('parsePageRanges', () => {
  it('parses a simple range "1-3" into 0-indexed arrays', () => {
    const result = parsePageRanges('1-3', 10);
    expect(result).toEqual([[0, 1, 2]]);
  });

  it('parses a single page number', () => {
    const result = parsePageRanges('5', 10);
    expect(result).toEqual([[4]]);
  });

  it('parses mixed ranges and singles "1-3,5,7-10"', () => {
    const result = parsePageRanges('1-3,5,7-10', 10);
    expect(result).toEqual([
      [0, 1, 2],
      [4],
      [6, 7, 8, 9],
    ]);
  });

  it('handles spaces around commas and dashes', () => {
    const result = parsePageRanges(' 1 - 3 , 5 ', 10);
    expect(result).toEqual([[0, 1, 2], [4]]);
  });

  it('returns null for empty string', () => {
    expect(parsePageRanges('', 10)).toBeNull();
  });

  it('returns null when range is out of bounds (end exceeds totalPages)', () => {
    expect(parsePageRanges('1-15', 10)).toBeNull();
  });

  it('returns null when page number exceeds totalPages', () => {
    expect(parsePageRanges('11', 10)).toBeNull();
  });

  it('returns null when page number is 0 (pages are 1-based)', () => {
    expect(parsePageRanges('0', 10)).toBeNull();
  });

  it('returns null when start > end in a range', () => {
    expect(parsePageRanges('5-3', 10)).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parsePageRanges('abc', 10)).toBeNull();
  });

  it('handles a single-page range like "3-3"', () => {
    const result = parsePageRanges('3-3', 10);
    expect(result).toEqual([[2]]);
  });

  it('handles the last page exactly at totalPages', () => {
    const result = parsePageRanges('10', 10);
    expect(result).toEqual([[9]]);
  });
});

/* ── formatFileSize ── */

describe('formatFileSize', () => {
  it('formats bytes (< 1024)', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  it('formats large files in MB (no GB tier in implementation)', () => {
    // The implementation only has B, KB, MB tiers
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2048.0 MB');
  });
});
