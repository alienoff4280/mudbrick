import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNextZoom,
  calculateFitWidth,
  calculateFitPage,
  getCleanupDistance,
  isMemoryPressured,
  DEFAULT_CLEANUP_DISTANCE,
} from '../js/pdf-engine.js';

/* ═══════════════════ getNextZoom ═══════════════════ */

describe('getNextZoom', () => {
  it('returns the next higher zoom level when direction > 0', () => {
    const next = getNextZoom(1.0, 1);
    expect(next).toBe(1.1);
  });

  it('returns the next lower zoom level when direction < 0', () => {
    const prev = getNextZoom(1.0, -1);
    expect(prev).toBe(0.9);
  });

  it('returns the maximum zoom level when already at max', () => {
    const max = getNextZoom(5.0, 1);
    expect(max).toBe(5.0);
  });

  it('returns the minimum zoom level when already at min', () => {
    const min = getNextZoom(0.25, -1);
    expect(min).toBe(0.25);
  });

  it('snaps to the next preset rather than incrementing by a fixed step', () => {
    // Starting at 0.67, next up should be 0.75
    const next = getNextZoom(0.67, 1);
    expect(next).toBe(0.75);
  });

  it('snaps down to the previous preset', () => {
    // Starting at 0.75, next down should be 0.67
    const prev = getNextZoom(0.75, -1);
    expect(prev).toBe(0.67);
  });

  it('handles zoom values between presets correctly (zoom in)', () => {
    // 1.3 is between 1.25 and 1.5
    const next = getNextZoom(1.3, 1);
    expect(next).toBe(1.5);
  });

  it('handles zoom values between presets correctly (zoom out)', () => {
    // 1.3 is between 1.25 and 1.5
    const prev = getNextZoom(1.3, -1);
    expect(prev).toBe(1.25);
  });
});

/* ═══════════════════ calculateFitWidth ═══════════════════ */

describe('calculateFitWidth', () => {
  it('returns the correct scale for a page to fit the container width', () => {
    // Container is 840px, page is 800px, padding 40 => (840-40)/800 = 1.0
    const scale = calculateFitWidth(800, 840, 40);
    expect(scale).toBe(1.0);
  });

  it('uses default padding of 40 when not specified', () => {
    const scale = calculateFitWidth(612, 652);
    // (652 - 40) / 612 = 1.0
    expect(scale).toBe(1.0);
  });

  it('returns a scale less than 1 for wide pages', () => {
    const scale = calculateFitWidth(1000, 540, 40);
    // (540 - 40) / 1000 = 0.5
    expect(scale).toBe(0.5);
  });

  it('returns a scale greater than 1 when container is much wider than page', () => {
    const scale = calculateFitWidth(300, 940, 40);
    // (940 - 40) / 300 = 3.0
    expect(scale).toBe(3.0);
  });

  it('respects custom padding values', () => {
    const scale = calculateFitWidth(500, 600, 100);
    // (600 - 100) / 500 = 1.0
    expect(scale).toBe(1.0);
  });
});

/* ═══════════════════ calculateFitPage ═══════════════════ */

describe('calculateFitPage', () => {
  it('returns the minimum of width and height scales', () => {
    // Width scale: (800-40)/612 = 1.2418..., Height scale: (600-40)/792 = 0.7070...
    const scale = calculateFitPage(612, 792, 800, 600, 40);
    const expectedW = (800 - 40) / 612;
    const expectedH = (600 - 40) / 792;
    expect(scale).toBeCloseTo(Math.min(expectedW, expectedH), 4);
  });

  it('uses default padding of 40', () => {
    const scale = calculateFitPage(612, 792, 800, 600);
    const expectedW = (800 - 40) / 612;
    const expectedH = (600 - 40) / 792;
    expect(scale).toBeCloseTo(Math.min(expectedW, expectedH), 4);
  });

  it('constrains by height for tall pages in a wide container', () => {
    // Very wide container, normal height
    const scale = calculateFitPage(612, 792, 2000, 400, 0);
    // Width scale: 2000/612 = 3.267, Height scale: 400/792 = 0.505
    expect(scale).toBeCloseTo(400 / 792, 4);
  });

  it('constrains by width for wide pages in a tall container', () => {
    // Normal width, very tall container
    const scale = calculateFitPage(612, 792, 400, 2000, 0);
    // Width scale: 400/612 = 0.653, Height scale: 2000/792 = 2.525
    expect(scale).toBeCloseTo(400 / 612, 4);
  });

  it('returns 1.0 when page exactly fits the container', () => {
    const scale = calculateFitPage(500, 700, 540, 740, 40);
    // Both: (540-40)/500 = 1.0, (740-40)/700 = 1.0
    expect(scale).toBe(1.0);
  });
});

/* ═══════════════════ getCleanupDistance ═══════════════════ */

describe('getCleanupDistance', () => {
  it('returns DEFAULT_CLEANUP_DISTANCE under normal conditions', () => {
    // jsdom does not define performance.memory, so isMemoryPressured returns false
    const distance = getCleanupDistance();
    expect(distance).toBe(DEFAULT_CLEANUP_DISTANCE);
  });

  it('returns a non-negative number', () => {
    expect(getCleanupDistance()).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when memory is pressured', () => {
    // Temporarily mock performance.memory
    const origMemory = performance.memory;
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 900, jsHeapSizeLimit: 1000 },
      configurable: true,
    });

    expect(isMemoryPressured()).toBe(true);
    expect(getCleanupDistance()).toBe(0);

    // Restore
    if (origMemory) {
      Object.defineProperty(performance, 'memory', { value: origMemory, configurable: true });
    } else {
      delete performance.memory;
    }
  });
});

/* ═══════════════════ isMemoryPressured ═══════════════════ */

describe('isMemoryPressured', () => {
  it('returns false when performance.memory is not available', () => {
    expect(isMemoryPressured()).toBe(false);
  });

  it('returns true when heap usage exceeds 80%', () => {
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 850, jsHeapSizeLimit: 1000 },
      configurable: true,
    });

    expect(isMemoryPressured()).toBe(true);

    delete performance.memory;
  });

  it('returns false when heap usage is under 80%', () => {
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 500, jsHeapSizeLimit: 1000 },
      configurable: true,
    });

    expect(isMemoryPressured()).toBe(false);

    delete performance.memory;
  });
});

/* ═══════════════════ DEFAULT_CLEANUP_DISTANCE ═══════════════════ */

describe('DEFAULT_CLEANUP_DISTANCE', () => {
  it('is exported as a constant', () => {
    expect(typeof DEFAULT_CLEANUP_DISTANCE).toBe('number');
  });

  it('equals 1', () => {
    expect(DEFAULT_CLEANUP_DISTANCE).toBe(1);
  });

  it('is a positive integer', () => {
    expect(DEFAULT_CLEANUP_DISTANCE).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_CLEANUP_DISTANCE)).toBe(true);
  });
});
