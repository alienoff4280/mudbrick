/**
 * Mudbrick v2 -- StampTool
 *
 * Click on canvas to place a stamp image (e.g., "APPROVED", "DRAFT").
 * Stamps are placed as Fabric.js Image objects.
 */

import { useEffect, useRef } from 'react';
import { FabricText, type Canvas as FabricCanvas, type TPointerEvent } from 'fabric';

interface StampToolProps {
  canvas: FabricCanvas | null;
  active: boolean;
  onAnnotationAdded?: () => void;
}

/** Built-in stamp presets */
const STAMP_PRESETS = [
  { label: 'APPROVED', color: '#27ae60' },
  { label: 'DRAFT', color: '#f39c12' },
  { label: 'CONFIDENTIAL', color: '#e74c3c' },
  { label: 'COPY', color: '#3498db' },
  { label: 'VOID', color: '#95a5a6' },
] as const;

// Current stamp preset index
let currentPresetIndex = 0;

export function getStampPresets() {
  return STAMP_PRESETS;
}

export function setCurrentStamp(index: number) {
  currentPresetIndex = Math.max(0, Math.min(index, STAMP_PRESETS.length - 1));
}

export function StampTool({ canvas, active, onAnnotationAdded }: StampToolProps) {
  const isPlacing = useRef(false);

  useEffect(() => {
    if (!canvas || !active) return;

    canvas.selection = false;
    canvas.defaultCursor = 'copy';

    const handleMouseDown = (opt: { e: TPointerEvent }) => {
      if (canvas.findTarget(opt.e)) return;
      if (isPlacing.current) return;

      isPlacing.current = true;
      const pointer = canvas.getScenePoint(opt.e);
      const preset = STAMP_PRESETS[currentPresetIndex] ?? STAMP_PRESETS[0]!;

      // Create a text-based stamp
      const stamp = new FabricText(preset.label, {
        left: pointer.x,
        top: pointer.y,
        fontSize: 32,
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontWeight: 'bold',
        fill: preset.color,
        opacity: 0.7,
        angle: -15,
        padding: 8,
        selectable: true,
        evented: true,
        mudbrickType: 'stamp',
        tool: 'stamp',
      });

      canvas.add(stamp);
      canvas.setActiveObject(stamp);
      canvas.renderAll();

      onAnnotationAdded?.();

      setTimeout(() => {
        isPlacing.current = false;
      }, 300);
    };

    canvas.on('mouse:down', handleMouseDown);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.defaultCursor = 'default';
      canvas.selection = true;
      isPlacing.current = false;
    };
  }, [canvas, active, onAnnotationAdded]);

  return null;
}
