/**
 * Mudbrick v2 -- DrawTool
 *
 * Activates freehand drawing mode on the Fabric.js canvas.
 * Configurable brush color and width from tool properties.
 */

import { useEffect } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { PencilBrush } from 'fabric';
import { useAnnotationStore } from '../../../stores/annotationStore';

interface DrawToolProps {
  canvas: FabricCanvas | null;
  active: boolean;
}

export function DrawTool({ canvas, active }: DrawToolProps) {
  const color = useAnnotationStore((s) => s.toolProperties.color);
  const strokeWidth = useAnnotationStore((s) => s.toolProperties.strokeWidth);

  useEffect(() => {
    if (!canvas) return;

    if (active) {
      canvas.isDrawingMode = true;
      const brush = new PencilBrush(canvas);
      brush.color = color;
      brush.width = strokeWidth;
      canvas.freeDrawingBrush = brush;
    } else {
      canvas.isDrawingMode = false;
    }
  }, [canvas, active, color, strokeWidth]);

  // Update brush properties when they change while active
  useEffect(() => {
    if (!canvas || !active || !canvas.freeDrawingBrush) return;
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = strokeWidth;
  }, [canvas, active, color, strokeWidth]);

  // This component doesn't render anything -- it's a behavior hook
  return null;
}
