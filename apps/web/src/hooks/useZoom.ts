/**
 * Mudbrick v2 -- useZoom Hook
 *
 * Manages zoom state with discrete levels, fit modes, and keyboard shortcuts.
 */

import { useState, useCallback, useRef } from 'react';
import { DEFAULT_ZOOM } from '@mudbrick/shared/src/constants';
import type { ZoomState } from '../types/pdf';
import {
  getNextZoom,
  calculateFitWidth,
  calculateFitPage,
  clampZoom,
  snapToZoomLevel,
} from '../utils/zoom';

interface UseZoomOptions {
  initialZoom?: number;
  /** Reference to the container element for fit calculations */
  containerRef?: React.RefObject<HTMLElement | null>;
}

interface UseZoomResult {
  zoom: ZoomState;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (level: number) => void;
  fitWidth: (pageWidth: number) => void;
  fitPage: (pageWidth: number, pageHeight: number) => void;
  resetZoom: () => void;
}

export function useZoom(options: UseZoomOptions = {}): UseZoomResult {
  const { initialZoom = DEFAULT_ZOOM, containerRef } = options;

  const [zoom, setZoomState] = useState<ZoomState>({
    level: initialZoom,
    fitMode: 'none',
  });

  const zoomIn = useCallback(() => {
    setZoomState((prev) => ({
      level: getNextZoom(prev.level, 1),
      fitMode: 'none',
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((prev) => ({
      level: getNextZoom(prev.level, -1),
      fitMode: 'none',
    }));
  }, []);

  const setZoom = useCallback((level: number) => {
    setZoomState({
      level: clampZoom(level),
      fitMode: 'none',
    });
  }, []);

  const fitWidth = useCallback(
    (pageWidth: number) => {
      const container = containerRef?.current;
      if (!container) return;

      const newZoom = calculateFitWidth(pageWidth, container.clientWidth);
      setZoomState({
        level: clampZoom(newZoom),
        fitMode: 'width',
      });
    },
    [containerRef],
  );

  const fitPage = useCallback(
    (pageWidth: number, pageHeight: number) => {
      const container = containerRef?.current;
      if (!container) return;

      const newZoom = calculateFitPage(
        pageWidth,
        pageHeight,
        container.clientWidth,
        container.clientHeight,
      );
      setZoomState({
        level: clampZoom(newZoom),
        fitMode: 'page',
      });
    },
    [containerRef],
  );

  const resetZoom = useCallback(() => {
    setZoomState({
      level: DEFAULT_ZOOM,
      fitMode: 'none',
    });
  }, []);

  return {
    zoom,
    zoomIn,
    zoomOut,
    setZoom,
    fitWidth,
    fitPage,
    resetZoom,
  };
}
