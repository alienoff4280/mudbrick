/**
 * Mudbrick v2 -- AnnotationCanvas Component
 *
 * Fabric.js 6.x canvas overlay per PDF page.
 * Manages tool activation, annotation serialization per page,
 * and integrates with draw/highlight tools.
 *
 * Architecture (from v1):
 * - One Fabric.js canvas instance that overlays the PDF canvas
 * - Per-page annotation serialization via toJSON/loadFromJSON
 * - Annotations stored in PDF coordinate space (scale 1.0)
 */

import { useEffect, useRef, useCallback } from 'react';
import { Canvas as FabricCanvas } from 'fabric';
import { DrawTool } from './tools/DrawTool';
import { HighlightTool } from './tools/HighlightTool';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useAnnotations } from '../../hooks/useAnnotations';
import { TOOLS } from '@mudbrick/shared/src/constants';

interface AnnotationCanvasProps {
  /** Page number (1-indexed) */
  pageNum: number;
  /** Current zoom scale */
  scale: number;
  /** Canvas width in CSS pixels */
  width: number;
  /** Canvas height in CSS pixels */
  height: number;
  /** Whether this canvas is for the active page */
  isActive?: boolean;
}

export function AnnotationCanvas({
  pageNum,
  scale,
  width,
  height,
  isActive = true,
}: AnnotationCanvasProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const activeTool = useAnnotationStore((s) => s.activeTool);

  const { setCanvas, saveCurrentPage, loadPage } = useAnnotations({
    currentPage: pageNum,
    scale,
  });

  // Initialize Fabric.js canvas
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const fabricCanvas = new FabricCanvas(el, {
      selection: activeTool === TOOLS.SELECT,
      preserveObjectStacking: true,
      renderOnAddRemove: true,
      width,
      height,
    });

    fabricCanvas.defaultCursor = 'default';
    fabricCanvas.hoverCursor = 'move';

    // Auto-save on modifications
    fabricCanvas.on('object:added', () => saveCurrentPage());
    fabricCanvas.on('object:modified', () => saveCurrentPage());
    fabricCanvas.on('object:removed', () => saveCurrentPage());

    fabricRef.current = fabricCanvas;
    setCanvas(fabricCanvas);

    // Load existing annotations for this page
    loadPage(pageNum);

    return () => {
      // Save before destroying
      saveCurrentPage();
      fabricCanvas.dispose();
      fabricRef.current = null;
      setCanvas(null);
    };
    // Only init/destroy on mount/unmount and page change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum]);

  // Resize canvas when dimensions change
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setDimensions({ width, height });
    canvas.renderAll();
  }, [width, height]);

  // Update selection mode based on active tool
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const isSelect = activeTool === TOOLS.SELECT;
    canvas.selection = isSelect;

    // Make objects selectable only in select mode
    canvas.getObjects().forEach((obj) => {
      obj.selectable = isSelect;
      obj.evented = isSelect;
    });

    if (!isSelect) {
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }, [activeTool]);

  const handleAnnotationAdded = useCallback(() => {
    saveCurrentPage();
  }, [saveCurrentPage]);

  // Determine pointer events based on tool
  const pointerEvents = activeTool === TOOLS.SELECT ? 'none' : 'auto';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 'var(--z-fabric-canvas)' as unknown as number,
        pointerEvents: isActive ? 'auto' : 'none',
      }}
    >
      <canvas ref={canvasElRef} />

      {/* Tool behavior components (render nothing, just wire up events) */}
      <DrawTool
        canvas={fabricRef.current}
        active={activeTool === TOOLS.DRAW}
      />
      <HighlightTool
        canvas={fabricRef.current}
        active={activeTool === TOOLS.HIGHLIGHT}
        onAnnotationAdded={handleAnnotationAdded}
      />

      {/* TextTool, ShapeTool, StampTool, RedactTool will be added by D2 */}
    </div>
  );
}
