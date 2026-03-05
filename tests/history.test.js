import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initPageState,
  pushState,
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
} from '../js/history.js';

beforeEach(() => {
  clearHistory(); // reset all pages between tests
});

describe('initPageState', () => {
  it('sets baseline state when undo stack is empty', () => {
    initPageState(1, { objects: [] });
    expect(canUndo(1)).toBe(false); // only 1 item, need 2 to undo
  });

  it('does not overwrite if undo stack already has entries', () => {
    initPageState(1, { objects: ['first'] });
    initPageState(1, { objects: ['second'] });
    // Push an action so we can undo and verify the baseline is still 'first'
    pushState(1, { objects: ['action1'] });
    const result = undo(1);
    expect(result).toEqual({ objects: ['first'] });
  });

  it('handles JSON stringify errors gracefully', () => {
    const circular = {};
    circular.self = circular;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initPageState(1, circular);
    expect(canUndo(1)).toBe(false);
    warnSpy.mockRestore();
  });

  it('works independently per page', () => {
    initPageState(1, { page: 1 });
    initPageState(2, { page: 2 });
    pushState(1, { page: 1, action: true });
    expect(canUndo(1)).toBe(true);
    expect(canUndo(2)).toBe(false);
  });
});

describe('pushState', () => {
  it('adds state to undo stack and enables undo', () => {
    initPageState(1, { objects: [] });
    pushState(1, { objects: ['rect'] });
    expect(canUndo(1)).toBe(true);
  });

  it('clears redo stack on new push', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    pushState(1, { v: 2 });
    undo(1); // v:2 goes to redo
    expect(canRedo(1)).toBe(true);
    pushState(1, { v: 3 }); // new branch — redo cleared
    expect(canRedo(1)).toBe(false);
  });

  it('caps history at MAX_HISTORY (30) entries', () => {
    initPageState(1, { i: 0 });
    for (let i = 1; i <= 35; i++) {
      pushState(1, { i });
    }
    // After 1 init + 35 pushes, should be trimmed to 30
    // Undo 29 times (need at least 2 to undo)
    let count = 0;
    while (undo(1) !== null) count++;
    expect(count).toBe(29); // 30 items minus 1 baseline = 29 undos
  });

  it('handles JSON stringify failure gracefully', () => {
    const circular = {};
    circular.self = circular;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initPageState(1, { v: 0 });
    pushState(1, circular);
    // Should still only have the init state
    expect(canUndo(1)).toBe(false);
    warnSpy.mockRestore();
  });

  it('works without prior initPageState', () => {
    pushState(5, { v: 1 });
    pushState(5, { v: 2 });
    expect(canUndo(5)).toBe(true);
    const result = undo(5);
    expect(result).toEqual({ v: 1 });
  });
});

describe('undo', () => {
  it('returns null when stack has fewer than 2 items', () => {
    expect(undo(1)).toBeNull();
    initPageState(1, { v: 0 });
    expect(undo(1)).toBeNull(); // only 1 item
  });

  it('returns the previous state', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    const result = undo(1);
    expect(result).toEqual({ v: 0 });
  });

  it('moves undone state to redo stack', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    expect(canRedo(1)).toBe(false);
    undo(1);
    expect(canRedo(1)).toBe(true);
  });

  it('can undo multiple times in sequence', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    pushState(1, { v: 2 });
    pushState(1, { v: 3 });
    expect(undo(1)).toEqual({ v: 2 });
    expect(undo(1)).toEqual({ v: 1 });
    expect(undo(1)).toEqual({ v: 0 });
    expect(undo(1)).toBeNull(); // at baseline
  });

  it('returns null for uninitialized page', () => {
    expect(undo(999)).toBeNull();
  });
});

describe('redo', () => {
  it('returns null when redo stack is empty', () => {
    expect(redo(1)).toBeNull();
  });

  it('restores the previously undone state', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    undo(1);
    const result = redo(1);
    expect(result).toEqual({ v: 1 });
  });

  it('can redo multiple times after multiple undos', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    pushState(1, { v: 2 });
    undo(1);
    undo(1);
    expect(redo(1)).toEqual({ v: 1 });
    expect(redo(1)).toEqual({ v: 2 });
    expect(redo(1)).toBeNull();
  });

  it('returns null for uninitialized page', () => {
    expect(redo(42)).toBeNull();
  });
});

describe('canUndo', () => {
  it('returns false for unknown page', () => {
    expect(canUndo(100)).toBe(false);
  });

  it('returns false with only baseline state', () => {
    initPageState(1, { v: 0 });
    expect(canUndo(1)).toBe(false);
  });

  it('returns true when there is an action beyond baseline', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    expect(canUndo(1)).toBe(true);
  });
});

describe('canRedo', () => {
  it('returns false for unknown page', () => {
    expect(canRedo(100)).toBe(false);
  });

  it('returns false when nothing has been undone', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    expect(canRedo(1)).toBe(false);
  });

  it('returns true after an undo', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    undo(1);
    expect(canRedo(1)).toBe(true);
  });
});

describe('clearHistory', () => {
  it('clears history for a specific page', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    initPageState(2, { v: 0 });
    pushState(2, { v: 1 });
    clearHistory(1);
    expect(canUndo(1)).toBe(false);
    expect(canUndo(2)).toBe(true); // page 2 unaffected
  });

  it('clears history for all pages when called without argument', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    initPageState(2, { v: 0 });
    pushState(2, { v: 1 });
    clearHistory();
    expect(canUndo(1)).toBe(false);
    expect(canUndo(2)).toBe(false);
  });

  it('is safe to call on non-existent page', () => {
    expect(() => clearHistory(999)).not.toThrow();
  });

  it('allows re-initialization after clearing', () => {
    initPageState(1, { v: 0 });
    pushState(1, { v: 1 });
    clearHistory(1);
    initPageState(1, { v: 'new' });
    pushState(1, { v: 'action' });
    const result = undo(1);
    expect(result).toEqual({ v: 'new' });
  });
});
