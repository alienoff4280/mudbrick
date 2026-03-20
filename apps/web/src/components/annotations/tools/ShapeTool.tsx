/**
 * Mudbrick v2 -- ShapeTool
 *
 * Draw rectangles, ellipses, and lines via mouse drag on the Fabric.js canvas.
 */

import { useEffect, useRef } from 'react';
import {
  Rect,
  Ellipse,
  Line,
  type Canvas as FabricCanvas,
  type FabricObject,
  type TPointerEvent,
} from 'fabric';
import { useAnnotationStore } from '../../../stores/annotationStore';
import type { ShapeId } from '@mudbrick/shared/src/constants';

interface ShapeToolProps {
  canvas: FabricCanvas | null;
  active: boolean;
  onAnnotationAdded?: () => void;
}

export function ShapeTool({ canvas, active, onAnnotationAdded }: ShapeToolProps) {
  const color = useAnnotationStore((s) => s.toolProperties.color);
  const strokeWidth = useAnnotationStore((s) => s.toolProperties.strokeWidth);
  const shapeType = useAnnotationStore((s) => s.toolProperties.shapeType);
  const opacity = useAnnotationStore((s) => s.toolProperties.opacity);

  const isDrawing = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const currentShape = useRef<FabricObject | null>(null);

  useEffect(() => {
    if (!canvas || !active) return;

    canvas.selection = false;
    canvas.defaultCursor = 'crosshair';

    const handleMouseDown = (opt: { e: TPointerEvent }) => {
      const pointer = canvas.getScenePoint(opt.e);
      isDrawing.current = true;
      startPoint.current = { x: pointer.x, y: pointer.y };

      const shape = createShape(shapeType, pointer.x, pointer.y, color, strokeWidth, opacity);
      if (shape) {
        currentShape.current = shape;
        canvas.add(shape);
      }
    };

    const handleMouseMove = (opt: { e: TPointerEvent }) => {
      if (!isDrawing.current || !startPoint.current || !currentShape.current) return;

      const pointer = canvas.getScenePoint(opt.e);
      const start = startPoint.current;

      updateShape(currentShape.current, shapeType, start, pointer);
      canvas.renderAll();
    };

    const handleMouseUp = () => {
      if (!isDrawing.current) return;
      isDrawing.current = false;

      // Remove tiny shapes
      if (currentShape.current) {
        const bounds = currentShape.current.getBoundingRect();
        if (bounds.width < 5 && bounds.height < 5) {
          canvas.remove(currentShape.current);
        } else {
          onAnnotationAdded?.();
        }
      }

      currentShape.current = null;
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
  }, [canvas, active, color, strokeWidth, shapeType, opacity, onAnnotationAdded]);

  return null;
}

function createShape(
  type: ShapeId,
  x: number,
  y: number,
  color: string,
  strokeWidth: number,
  opacity: number,
): FabricObject | null {
  const commonProps = {
    selectable: true,
    evented: true,
    opacity,
    mudbrickType: 'shape',
    shapeType: type,
  };

  switch (type) {
    case 'rect':
      return new Rect({
        left: x,
        top: y,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: color,
        strokeWidth,
        ...commonProps,
      });
    case 'ellipse':
      return new Ellipse({
        left: x,
        top: y,
        rx: 0,
        ry: 0,
        fill: 'transparent',
        stroke: color,
        strokeWidth,
        ...commonProps,
      });
    case 'line':
      return new Line([x, y, x, y], {
        stroke: color,
        strokeWidth,
        ...commonProps,
      });
    default:
      return null;
  }
}

function updateShape(
  shape: FabricObject,
  type: ShapeId,
  start: { x: number; y: number },
  current: { x: number; y: number },
): void {
  switch (type) {
    case 'rect': {
      const rect = shape as Rect;
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      rect.set({
        left,
        top,
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      });
      break;
    }
    case 'ellipse': {
      const ellipse = shape as Ellipse;
      const cx = (start.x + current.x) / 2;
      const cy = (start.y + current.y) / 2;
      ellipse.set({
        left: cx - Math.abs(current.x - start.x) / 2,
        top: cy - Math.abs(current.y - start.y) / 2,
        rx: Math.abs(current.x - start.x) / 2,
        ry: Math.abs(current.y - start.y) / 2,
      });
      break;
    }
    case 'line': {
      const line = shape as Line;
      line.set({
        x2: current.x,
        y2: current.y,
      });
      break;
    }
  }
}
