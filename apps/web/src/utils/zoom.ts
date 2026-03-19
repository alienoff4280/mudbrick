/**
 * Mudbrick v2 -- Zoom Utilities
 *
 * Ported from v1 js/pdf-engine.js zoom math.
 * 17 discrete zoom levels, fit-to-page/width calculations.
 */

import { ZOOM_LEVELS, MIN_ZOOM, MAX_ZOOM } from '@mudbrick/shared/src/constants';

/**
 * Get the next zoom level when zooming in (+1) or out (-1).
 * Snaps to the nearest discrete zoom level.
 */
export function getNextZoom(currentZoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    // Zoom in: find next level above current
    for (const z of ZOOM_LEVELS) {
      if (z > currentZoom + 0.01) return z;
    }
    return MAX_ZOOM;
  } else {
    // Zoom out: find next level below current
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      const z = ZOOM_LEVELS[i];
      if (z !== undefined && z < currentZoom - 0.01) return z;
    }
    return MIN_ZOOM;
  }
}

/**
 * Find the nearest discrete zoom level to a given value.
 */
export function snapToZoomLevel(zoom: number): number {
  let closest = ZOOM_LEVELS[0] ?? 1;
  let minDist = Math.abs(zoom - closest);

  for (const z of ZOOM_LEVELS) {
    const dist = Math.abs(zoom - z);
    if (dist < minDist) {
      minDist = dist;
      closest = z;
    }
  }

  return closest;
}

/**
 * Calculate the zoom level to fit the page width within the container.
 */
export function calculateFitWidth(
  pageWidth: number,
  containerWidth: number,
  padding = 40,
): number {
  return (containerWidth - padding) / pageWidth;
}

/**
 * Calculate the zoom level to fit the entire page within the container.
 */
export function calculateFitPage(
  pageWidth: number,
  pageHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding = 40,
): number {
  const scaleW = (containerWidth - padding) / pageWidth;
  const scaleH = (containerHeight - padding) / pageHeight;
  return Math.min(scaleW, scaleH);
}

/**
 * Clamp a zoom value to valid bounds.
 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Format a zoom level as a display percentage string.
 */
export function formatZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * Get the index of the current zoom level in the ZOOM_LEVELS array.
 * Returns the index of the closest level.
 */
export function getZoomLevelIndex(zoom: number): number {
  let closestIdx = 0;
  let minDist = Math.abs(zoom - (ZOOM_LEVELS[0] ?? 1));

  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    const z = ZOOM_LEVELS[i];
    if (z === undefined) continue;
    const dist = Math.abs(zoom - z);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }

  return closestIdx;
}
