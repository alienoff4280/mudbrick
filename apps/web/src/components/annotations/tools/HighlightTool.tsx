/**
 * Mudbrick v2 -- HighlightTool
 *
 * Creates semi-transparent yellow rectangles on mouse drag.
 * Used for highlighting text areas on the PDF.
 */

import { useEffect, useRef } from 'react';
import { Rect, type Canvas as FabricCanvas, type TPointerEvent } from 'fabric';
import { useAnnotationStore } from '../../../stores/annotationStore';

interface HighlightToolProps {
  canvas: FabricCanvas | null;
  active: boolean;
  onAnnotationAdded?: () => void;
}

export function HighlightTool({ canvas, active, onAnnotationAdded }: HighlightToolProps) {
  const opacity = useAnnotationStore((s) => s.toolProperties.opacity);
  const isDrawing = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const currentRect = useRef<Rect | null>(null);

  useEffect(() => {
    if (!canvas) return;

    if (!active) {
      canvas.selection = true;
      return;
    }

    // Disable object selection in highlight mode
    canvas.selection = false;
    canvas.defaultCursor = 'crosshair';

    const handleMouseDown = (opt: { e: TPointerEvent }) => {
      const pointer = canvas.getScenePoint(opt.e);
      isDrawing.current = true;
      startPoint.current = { x: pointer.x, y: pointer.y };

      const rect = new Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: '#ffff00',
        opacity: opacity * 0.4,
        selectable: true,
        evented: true,
        tool: 'highlight',
        mudbrickType: 'highlight',
      });

      currentRect.current = rect;
      canvas.add(rect);
    };

    const handleMouseMove = (opt: { e: TPointerEvent }) => {
      if (!isDrawing.current || !startPoint.current || !currentRect.current) return;

      const pointer = canvas.getScenePoint(opt.e);
      const start = startPoint.current;

      const left = Math.min(start.x, pointer.x);
      const top = Math.min(start.y, pointer.y);
      const width = Math.abs(pointer.x - start.x);
      const height = Math.abs(pointer.y - start.y);

      currentRect.current.set({ left, top, width, height });
      canvas.renderAll();
    };

    const handleMouseUp = () => {
      if (!isDrawing.current) return;
      isDrawing.current = false;

      // Remove tiny accidental highlights
      if (currentRect.current) {
        const w = currentRect.current.width ?? 0;
        const h = currentRect.current.height ?? 0;
        if (w < 5 && h < 5) {
          canvas.remove(currentRect.current);
        } else {
          onAnnotationAdded?.();
        }
      }

      currentRect.current = null;
      startPoint.current = null;
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.defaultCursor = 'default';
      canvas.selection = true;
    };
  }, [canvas, active, opacity, onAnnotationAdded]);

  return null;
}
