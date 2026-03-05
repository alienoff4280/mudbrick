import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushDocState,
  undoDoc,
  redoDoc,
  canUndoDoc,
  canRedoDoc,
  clearDocHistory,
} from '../js/doc-history.js';

beforeEach(() => {
  clearDocHistory();
});

describe('pushDocState', () => {
  it('adds bytes to undo stack', () => {
    pushDocState(new Uint8Array([1, 2, 3]));
    expect(canUndoDoc()).toBe(true);
  });

  it('makes a defensive copy of the bytes', () => {
    const original = new Uint8Array([1, 2, 3]);
    pushDocState(original);
    original[0] = 99; // mutate original
    const restored = undoDoc(new Uint8Array([4, 5]));
    expect(restored[0]).toBe(1); // copy should be unaffected
  });

  it('clears redo stack on new push', () => {
    pushDocState(new Uint8Array([1]));
    pushDocState(new Uint8Array([2]));
    undoDoc(new Uint8Array([3])); // move to redo
    expect(canRedoDoc()).toBe(true);
    pushDocState(new Uint8Array([4])); // new branch
    expect(canRedoDoc()).toBe(false);
  });

  it('caps undo stack at MAX_DOC_HISTORY (10)', () => {
    for (let i = 0; i < 15; i++) {
      pushDocState(new Uint8Array([i]));
    }
    // Should have at most 10 items
    let count = 0;
    while (undoDoc(new Uint8Array([99])) !== null) count++;
    expect(count).toBe(10);
  });

  it('ignores falsy input', () => {
    pushDocState(null);
    pushDocState(undefined);
    expect(canUndoDoc()).toBe(false);
  });
});

describe('undoDoc', () => {
  it('returns null when undo stack is empty', () => {
    expect(undoDoc(new Uint8Array([1]))).toBeNull();
  });

  it('returns the most recently pushed bytes', () => {
    pushDocState(new Uint8Array([10, 20]));
    const result = undoDoc(new Uint8Array([30]));
    expect(result).toEqual(new Uint8Array([10, 20]));
  });

  it('pushes currentBytes onto redo stack', () => {
    pushDocState(new Uint8Array([1]));
    const current = new Uint8Array([2]);
    undoDoc(current);
    expect(canRedoDoc()).toBe(true);
    const redone = redoDoc(new Uint8Array([99]));
    expect(redone).toEqual(new Uint8Array([2]));
  });

  it('makes a defensive copy of currentBytes for redo', () => {
    pushDocState(new Uint8Array([1]));
    const current = new Uint8Array([2, 3]);
    undoDoc(current);
    current[0] = 99; // mutate
    const redone = redoDoc(new Uint8Array([0]));
    expect(redone[0]).toBe(2); // should be the copy
  });

  it('handles null currentBytes without crashing', () => {
    pushDocState(new Uint8Array([1]));
    const result = undoDoc(null);
    expect(result).toEqual(new Uint8Array([1]));
    expect(canRedoDoc()).toBe(false); // null was not pushed
  });
});

describe('redoDoc', () => {
  it('returns null when redo stack is empty', () => {
    expect(redoDoc(new Uint8Array([1]))).toBeNull();
  });

  it('returns the previously undone bytes', () => {
    pushDocState(new Uint8Array([1]));
    pushDocState(new Uint8Array([2]));
    undoDoc(new Uint8Array([3])); // redo gets [3]
    const result = redoDoc(new Uint8Array([4]));
    expect(result).toEqual(new Uint8Array([3]));
  });

  it('pushes currentBytes onto undo stack', () => {
    pushDocState(new Uint8Array([1]));
    undoDoc(new Uint8Array([2]));
    redoDoc(new Uint8Array([3]));
    // Now undo stack should have [1] (from init) and [3] (from redo push)
    expect(canUndoDoc()).toBe(true);
  });

  it('handles null currentBytes without crashing', () => {
    pushDocState(new Uint8Array([1]));
    undoDoc(new Uint8Array([2]));
    const result = redoDoc(null);
    expect(result).toEqual(new Uint8Array([2]));
  });
});

describe('canUndoDoc', () => {
  it('returns false when stack is empty', () => {
    expect(canUndoDoc()).toBe(false);
  });

  it('returns true when there are entries', () => {
    pushDocState(new Uint8Array([1]));
    expect(canUndoDoc()).toBe(true);
  });
});

describe('canRedoDoc', () => {
  it('returns false when redo stack is empty', () => {
    expect(canRedoDoc()).toBe(false);
  });

  it('returns true after an undo', () => {
    pushDocState(new Uint8Array([1]));
    undoDoc(new Uint8Array([2]));
    expect(canRedoDoc()).toBe(true);
  });
});

describe('clearDocHistory', () => {
  it('resets both stacks', () => {
    pushDocState(new Uint8Array([1]));
    pushDocState(new Uint8Array([2]));
    undoDoc(new Uint8Array([3]));
    clearDocHistory();
    expect(canUndoDoc()).toBe(false);
    expect(canRedoDoc()).toBe(false);
  });

  it('is safe to call when already empty', () => {
    expect(() => clearDocHistory()).not.toThrow();
  });

  it('allows new state after clearing', () => {
    pushDocState(new Uint8Array([1]));
    clearDocHistory();
    pushDocState(new Uint8Array([2]));
    expect(canUndoDoc()).toBe(true);
    const result = undoDoc(new Uint8Array([3]));
    expect(result).toEqual(new Uint8Array([2]));
  });
});
