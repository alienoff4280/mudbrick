/**
 * Mudbrick v2 -- useApi Hook
 *
 * Generic hook for API calls with loading/error state management.
 */

import { useState, useCallback } from 'react';
import type { ApiState } from '../types/api';
import { ApiError } from '../services/api';

/**
 * Hook for managing async API calls with loading and error state.
 *
 * @example
 * const { execute, data, loading, error } = useApi(
 *   (file: File) => api.uploadDocument(file)
 * );
 */
export function useApi<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): ApiState<TResult> & {
  execute: (...args: TArgs) => Promise<TResult | null>;
  reset: () => void;
} {
  const [data, setData] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn(...args);
        setData(result);
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'An unknown error occurred';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [fn],
  );

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, reset };
}
