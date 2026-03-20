/**
 * Mudbrick v2 -- TextTool
 *
 * Click on canvas to place an editable text box (Fabric.js IText).
 * Configurable font size, family, and color.
 */

import { useEffect, useRef } from 'react';
import { IText, type Canvas as FabricCanvas, type TPointerEvent } from 'fabric';
import { useAnnotationStore } from '../../../stores/annotationStore';

interface TextToolProps {
  canvas: FabricCanvas | null;
  active: boolean;
  onAnnotationAdded?: () => void;
}

export function TextTool({ canvas, active, onAnnotationAdded }: TextToolProps) {
  const color = useAnnotationStore((s) => s.toolProperties.color);
  const fontSize = useAnnotationStore((s) => s.toolProperties.fontSize);
  const fontFamily = useAnnotationStore((s) => s.toolProperties.fontFamily);
  const isPlacing = useRef(false);

  useEffect(() => {
    if (!canvas || !active) return;

    canvas.selection = false;
    canvas.defaultCursor = 'text';

    const handleMouseDown = (opt: { e: TPointerEvent }) => {
      // Don't place a new text if clicking on an existing object
      if (canvas.findTarget(opt.e)) return;
      if (isPlacing.current) return;

      isPlacing.current = true;
      const pointer = canvas.getScenePoint(opt.e);

      const text = new IText('Type here', {
        left: pointer.x,
        top: pointer.y,
        fontSize,
        fontFamily,
        fill: color,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        editable: true,
        selectable: true,
        mudbrickType: 'text',
        tool: 'text',
      });

      canvas.add(text);
      canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      canvas.renderAll();

      onAnnotationAdded?.();

      // Allow placing another text after a brief delay
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
  }, [canvas, active, color, fontSize, fontFamily, onAnnotationAdded]);

  return null;
}
