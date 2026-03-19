/**
 * Mudbrick v2 -- Text Edit Toolbar
 *
 * Font family, size, color controls for text editing mode.
 * Appears as a floating toolbar when text editing is active.
 */

import { useCallback } from 'react';
import styles from './TextEditToolbar.module.css';

/** Available PDF fonts (PyMuPDF built-in names) */
const FONTS = [
  { value: 'helv', label: 'Helvetica' },
  { value: 'tiro', label: 'Times Roman' },
  { value: 'cour', label: 'Courier' },
  { value: 'hebo', label: 'Helvetica Bold' },
  { value: 'tibo', label: 'Times Bold' },
  { value: 'cobo', label: 'Courier Bold' },
  { value: 'heit', label: 'Helvetica Italic' },
  { value: 'tiit', label: 'Times Italic' },
];

/** Common font sizes */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

interface TextEditToolbarProps {
  font: string;
  size: number;
  color: string;
  bgColor: string;
  onFontChange: (font: string) => void;
  onSizeChange: (size: number) => void;
  onColorChange: (color: string) => void;
  onBgColorChange: (bgColor: string) => void;
}

export function TextEditToolbar({
  font,
  size,
  color,
  bgColor,
  onFontChange,
  onSizeChange,
  onColorChange,
  onBgColorChange,
}: TextEditToolbarProps) {
  const handleSizeInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 1 && val <= 200) {
        onSizeChange(val);
      }
    },
    [onSizeChange],
  );

  return (
    <div className={styles.toolbar}>
      {/* Font Family */}
      <div className={styles.group}>
        <label className={styles.label}>Font</label>
        <select
          className={styles.fontSelect}
          value={font}
          onChange={(e) => onFontChange(e.target.value)}
        >
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size */}
      <div className={styles.group}>
        <label className={styles.label}>Size</label>
        <div className={styles.sizeGroup}>
          <select
            className={styles.sizeSelect}
            value={FONT_SIZES.includes(size) ? size : ''}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) onSizeChange(val);
            }}
          >
            {!FONT_SIZES.includes(size) && (
              <option value="">{size}</option>
            )}
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            className={styles.sizeInput}
            type="number"
            value={size}
            onChange={handleSizeInput}
            min={1}
            max={200}
            step={0.5}
            title="Custom size"
          />
        </div>
      </div>

      {/* Text Color */}
      <div className={styles.group}>
        <label className={styles.label}>Text</label>
        <input
          className={styles.colorInput}
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          title="Text color"
        />
      </div>

      {/* Background Color */}
      <div className={styles.group}>
        <label className={styles.label}>BG</label>
        <input
          className={styles.colorInput}
          type="color"
          value={bgColor}
          onChange={(e) => onBgColorChange(e.target.value)}
          title="Background color"
        />
      </div>
    </div>
  );
}
