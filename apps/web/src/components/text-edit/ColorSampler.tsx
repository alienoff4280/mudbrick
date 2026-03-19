/**
 * Mudbrick v2 -- Color Sampler Component
 *
 * Click on the canvas to sample a color (background or text).
 * Shows an eyedropper cursor and a color preview.
 * Ported from v1 js/text-edit.js color sampling logic.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { samplePixelColor } from '../../utils/colorSampler';
import styles from './ColorSampler.module.css';

interface ColorSamplerProps {
  /** Reference to the PDF canvas to sample from */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Whether the sampler is currently active */
  active: boolean;
  /** Callback when a color is sampled */
  onColorSampled: (color: string) => void;
  /** Callback to deactivate the sampler */
  onDeactivate: () => void;
}

export function ColorSampler({
  canvasRef,
  active,
  onColorSampled,
  onDeactivate,
}: ColorSamplerProps) {
  const [previewColor, setPreviewColor] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!active || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;

      // Canvas pixel coordinates
      const canvasX = (e.clientX - rect.left) * dpr;
      const canvasY = (e.clientY - rect.top) * dpr;

      const color = samplePixelColor(canvas, canvasX, canvasY);
      setPreviewColor(color);
      setCursorPos({ x: e.clientX, y: e.clientY });
    },
    [active, canvasRef],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!active || !canvasRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;

      const canvasX = (e.clientX - rect.left) * dpr;
      const canvasY = (e.clientY - rect.top) * dpr;

      const color = samplePixelColor(canvas, canvasX, canvasY);
      if (color) {
        onColorSampled(color);
      }
      onDeactivate();
    },
    [active, canvasRef, onColorSampled, onDeactivate],
  );

  // Handle Escape to cancel
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDeactivate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onDeactivate]);

  if (!active) return null;

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    >
      {/* Color preview tooltip */}
      {cursorPos && previewColor && (
        <div
          className={styles.preview}
          style={{
            left: `${cursorPos.x + 16}px`,
            top: `${cursorPos.y + 16}px`,
          }}
        >
          <div
            className={styles.swatch}
            style={{ backgroundColor: previewColor }}
          />
          <span className={styles.hex}>{previewColor}</span>
        </div>
      )}
    </div>
  );
}
