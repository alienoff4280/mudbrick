/**
 * Mudbrick v2 -- useUndoRedo Hook
 *
 * Generic undo/redo state management with configurable history depth.
 * Designed for annotation state but works with any serializable state.
 */

import { useCallback, useRef, useState } from 'react';

interface UndoRedoOptions {
  /** Maximum number of undo steps to keep. Default: 50. */
  maxHistory?: number;
}

interface UndoRedoResult<T> {
  /** Push a new state onto the history stack. Clears any redo states. */
  push: (state: T) => void;
  /** Undo: move back one step. Returns the restored state, or null if at beginning. */
  undo: () => T | null;
  /** Redo: move forward one step. Returns the restored state, or null if at end. */
  redo: () => T | null;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Number of undo steps available */
  undoCount: number;
  /** Number of redo steps available */
  redoCount: number;
  /** Reset all history */
  reset: (initialState?: T) => void;
  /** Get the current state without modifying history */
  current: () => T | null;
}

export function useUndoRedo<T>(
  initialState?: T,
  options: UndoRedoOptions = {},
): UndoRedoResult<T> {
  const maxHistory = options.maxHistory ?? 50;

  // Use refs for history stacks to avoid re-renders on internal changes.
  // Only the can-flags trigger re-renders.
  const pastRef = useRef<T[]>(initialState !== undefined ? [initialState] : []);
  const futureRef = useRef<T[]>([]);
  const indexRef = useRef(initialState !== undefined ? 0 : -1);

  // These state values trigger re-renders when undo/redo availability changes.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const updateFlags = useCallback(() => {
    const idx = indexRef.current;
    const newCanUndo = idx > 0;
    const newCanRedo = idx < pastRef.current.length - 1;
    setCanUndo(newCanUndo);
    setCanRedo(newCanRedo);
    setUndoCount(Math.max(0, idx));
    setRedoCount(Math.max(0, pastRef.current.length - 1 - idx));
  }, []);

  const push = useCallback(
    (state: T) => {
      const idx = indexRef.current;
      // Discard any future states (redo branch is lost on new action)
      pastRef.current = pastRef.current.slice(0, idx + 1);
      futureRef.current = [];

      // Add new state
      pastRef.current.push(state);

      // Trim if exceeding max history
      if (pastRef.current.length > maxHistory) {
        pastRef.current = pastRef.current.slice(pastRef.current.length - maxHistory);
      }

      indexRef.current = pastRef.current.length - 1;
      updateFlags();
    },
    [maxHistory, updateFlags],
  );

  const undo = useCallback((): T | null => {
    const idx = indexRef.current;
    if (idx <= 0) return null;

    indexRef.current = idx - 1;
    updateFlags();
    return pastRef.current[indexRef.current] ?? null;
  }, [updateFlags]);

  const redo = useCallback((): T | null => {
    const idx = indexRef.current;
    if (idx >= pastRef.current.length - 1) return null;

    indexRef.current = idx + 1;
    updateFlags();
    return pastRef.current[indexRef.current] ?? null;
  }, [updateFlags]);

  const reset = useCallback(
    (newInitial?: T) => {
      if (newInitial !== undefined) {
        pastRef.current = [newInitial];
        indexRef.current = 0;
      } else {
        pastRef.current = [];
        indexRef.current = -1;
      }
      futureRef.current = [];
      updateFlags();
    },
    [updateFlags],
  );

  const current = useCallback((): T | null => {
    const idx = indexRef.current;
    if (idx < 0 || idx >= pastRef.current.length) return null;
    return pastRef.current[idx] ?? null;
  }, []);

  return {
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    reset,
    current,
  };
}
