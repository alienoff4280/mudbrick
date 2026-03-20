/**
 * Mudbrick v2 -- useAnnotations Hook
 *
 * Manages per-page annotation state with Fabric.js canvas integration.
 * Handles page switching (save current → load target), tool changes,
 * and state synchronization with the annotation store.
 */

import { useCallback, useRef } from 'react';
import { useAnnotationStore } from '../stores/annotationStore';
import type { PageAnnotations } from '../types/annotation';
import type { Canvas as FabricCanvas } from 'fabric';

/** Custom Fabric.js properties to persist in JSON serialization */
const CUSTOM_PROPS = [
  'mudbrickType',
  'tool',
  'shapeType',
];

interface UseAnnotationsOptions {
  /** Current page number (1-indexed) */
  currentPage: number;
  /** Current zoom scale */
  scale: number;
}

interface UseAnnotationsResult {
  /** Register the Fabric.js canvas instance */
  setCanvas: (canvas: FabricCanvas | null) => void;
  /** Save current page annotations to the store */
  saveCurrentPage: () => void;
  /** Load annotations for a page onto the canvas */
  loadPage: (pageNum: number) => void;
  /** Clear all annotations on the current page */
  clearCurrentPage: () => void;
  /** Get all page annotations (for export) */
  getAllAnnotations: () => Record<number, PageAnnotations>;
  /** Delete the currently selected annotation(s) */
  deleteSelected: () => void;
}

export function useAnnotations({
  currentPage,
  scale,
}: UseAnnotationsOptions): UseAnnotationsResult {
  const canvasRef = useRef<FabricCanvas | null>(null);

  const setPageAnnotations = useAnnotationStore((s) => s.setPageAnnotations);
  const clearPageAnnotations = useAnnotationStore((s) => s.clearPageAnnotations);
  const pageAnnotations = useAnnotationStore((s) => s.pageAnnotations);
  const setHasSelection = useAnnotationStore((s) => s.setHasSelection);

  const setCanvas = useCallback(
    (canvas: FabricCanvas | null) => {
      canvasRef.current = canvas;

      if (canvas) {
        // Listen for selection changes
        canvas.on('selection:created', () => setHasSelection(true));
        canvas.on('selection:updated', () => setHasSelection(true));
        canvas.on('selection:cleared', () => setHasSelection(false));
      }
    },
    [setHasSelection],
  );

  const saveCurrentPage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const json = canvas.toObject(CUSTOM_PROPS) as PageAnnotations;
    setPageAnnotations(currentPage, json);
  }, [currentPage, setPageAnnotations]);

  const loadPage = useCallback(
    (pageNum: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const stored = pageAnnotations[pageNum];
      if (stored) {
        canvas.loadFromJSON(stored).then(() => {
          canvas.renderAll();
        });
      } else {
        canvas.clear();
      }
    },
    [pageAnnotations],
  );

  const clearCurrentPage = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.clear();
    }
    clearPageAnnotations(currentPage);
  }, [currentPage, clearPageAnnotations]);

  const getAllAnnotations = useCallback((): Record<number, PageAnnotations> => {
    // Save current page first
    saveCurrentPage();
    return { ...pageAnnotations };
  }, [saveCurrentPage, pageAnnotations]);

  const deleteSelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length > 0) {
      activeObjects.forEach((obj) => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
      saveCurrentPage();
    }
  }, [saveCurrentPage]);

  return {
    setCanvas,
    saveCurrentPage,
    loadPage,
    clearCurrentPage,
    getAllAnnotations,
    deleteSelected,
  };
}
