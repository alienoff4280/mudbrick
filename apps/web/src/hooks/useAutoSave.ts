/**
 * Mudbrick v2 -- useAutoSave Hook
 *
 * Periodically saves annotation state to IndexedDB for crash recovery.
 * Debounces saves to avoid thrashing on rapid annotation changes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { indexedDbService } from '../services/indexedDb';
import { AUTO_SAVE_INTERVAL_MS } from '@mudbrick/shared/src/constants';

interface AutoSaveOptions {
  /** Session ID for the current document */
  sessionId: string | null;
  /** The annotation state to persist */
  data: Record<number, unknown>;
  /** Whether auto-save is enabled */
  enabled?: boolean;
  /** Interval in ms between auto-saves. Default from constants. */
  intervalMs?: number;
  /** Debounce delay in ms after a change before saving. Default: 2000. */
  debounceMs?: number;
  /** Callback after a successful save */
  onSave?: () => void;
  /** Callback on save error */
  onError?: (error: unknown) => void;
}

interface AutoSaveResult {
  /** Manually trigger an immediate save */
  saveNow: () => Promise<void>;
  /** Whether a save is currently in progress */
  isSaving: boolean;
  /** Timestamp of the last successful save */
  lastSavedAt: number | null;
}

export function useAutoSave({
  sessionId,
  data,
  enabled = true,
  intervalMs = AUTO_SAVE_INTERVAL_MS,
  debounceMs = 2000,
  onSave,
  onError,
}: AutoSaveOptions): AutoSaveResult {
  const isSavingRef = useRef(false);
  const lastSavedAtRef = useRef<number | null>(null);
  const dataRef = useRef(data);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Keep data ref current without triggering effect re-runs
  dataRef.current = data;

  const performSave = useCallback(async () => {
    if (!sessionId || isSavingRef.current) return;

    isSavingRef.current = true;
    try {
      await indexedDbService.saveAnnotations(sessionId, dataRef.current);
      if (isMountedRef.current) {
        lastSavedAtRef.current = Date.now();
        onSave?.();
      }
    } catch (err) {
      if (isMountedRef.current) {
        onError?.(err);
      }
    } finally {
      isSavingRef.current = false;
    }
  }, [sessionId, onSave, onError]);

  const saveNow = useCallback(async () => {
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await performSave();
  }, [performSave]);

  // Debounced save on data change
  useEffect(() => {
    if (!enabled || !sessionId) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [data, enabled, sessionId, debounceMs, performSave]);

  // Periodic interval save
  useEffect(() => {
    if (!enabled || !sessionId) return;

    intervalTimerRef.current = setInterval(() => {
      performSave();
    }, intervalMs);

    return () => {
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
    };
  }, [enabled, sessionId, intervalMs, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Save on beforeunload for crash recovery
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const handleBeforeUnload = () => {
      // Synchronous-ish: fire and forget the save
      if (sessionId) {
        indexedDbService.saveAnnotations(sessionId, dataRef.current).catch(() => {
          // Best effort on unload
        });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled, sessionId]);

  return {
    saveNow,
    isSaving: isSavingRef.current,
    lastSavedAt: lastSavedAtRef.current,
  };
}
