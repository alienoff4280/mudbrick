import { describe, it, expect } from 'vitest';
import { previewBatesLabel } from '../js/bates.js';

describe('previewBatesLabel', () => {
  it('returns default label with no options', () => {
    expect(previewBatesLabel()).toBe('000001');
  });

  it('applies prefix', () => {
    expect(previewBatesLabel({ prefix: 'DOC-' })).toBe('DOC-000001');
  });

  it('applies suffix', () => {
    expect(previewBatesLabel({ suffix: '-R1' })).toBe('000001-R1');
  });

  it('applies both prefix and suffix', () => {
    expect(previewBatesLabel({ prefix: 'DOC-', suffix: '-R1' })).toBe('DOC-000001-R1');
  });

  it('respects custom startNumber', () => {
    expect(previewBatesLabel({ startNumber: 42 })).toBe('000042');
  });

  it('respects custom zeroPad', () => {
    expect(previewBatesLabel({ zeroPad: 3, startNumber: 1 })).toBe('001');
  });

  it('handles zeroPad of 0 (no padding)', () => {
    expect(previewBatesLabel({ zeroPad: 0, startNumber: 5 })).toBe('5');
  });

  it('handles large startNumber exceeding zeroPad width', () => {
    expect(previewBatesLabel({ zeroPad: 3, startNumber: 12345 })).toBe('12345');
  });

  it('combines all options', () => {
    const result = previewBatesLabel({
      prefix: 'EX-',
      suffix: '-CONF',
      startNumber: 100,
      zeroPad: 8,
    });
    expect(result).toBe('EX-00000100-CONF');
  });
});
