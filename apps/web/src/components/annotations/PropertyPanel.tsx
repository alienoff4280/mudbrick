/**
 * Mudbrick v2 -- PropertyPanel Component
 *
 * Side panel for adjusting annotation tool properties:
 * color picker, stroke width, opacity, font settings.
 */

import { useAnnotationStore } from '../../stores/annotationStore';
import { TOOLS, SHAPES, type ShapeId } from '@mudbrick/shared/src/constants';

const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana',
];

const PRESET_COLORS = [
  '#000000', '#ff0000', '#ff6600', '#ffff00',
  '#00cc00', '#0066ff', '#9933ff', '#ffffff',
];

export function PropertyPanel() {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const toolProperties = useAnnotationStore((s) => s.toolProperties);
  const updateToolProperty = useAnnotationStore((s) => s.updateToolProperty);

  // Only show panel for tools that have properties
  const showPanel = activeTool !== TOOLS.SELECT;
  if (!showPanel) return null;

  const showColor = true;
  const showStrokeWidth = [TOOLS.DRAW, TOOLS.SHAPE].includes(activeTool as typeof TOOLS.DRAW);
  const showOpacity = [TOOLS.HIGHLIGHT, TOOLS.SHAPE, TOOLS.STAMP].includes(activeTool as typeof TOOLS.HIGHLIGHT);
  const showFont = activeTool === TOOLS.TEXT;
  const showShapeType = activeTool === TOOLS.SHAPE;

  return (
    <div
      style={{
        width: '100%',
        backgroundColor: 'var(--mb-surface)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        overflow: 'auto',
        flexShrink: 0,
      }}
    >
      <h3 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
        Properties
      </h3>

      {/* Color */}
      {showColor && (
        <PropertySection label="Color">
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateToolProperty('color', c)}
                aria-label={`Color ${c}`}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: 'var(--mb-radius-xs)',
                  backgroundColor: c,
                  border: `2px solid ${toolProperties.color === c ? 'var(--mb-brand)' : 'var(--mb-border)'}`,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
          <input
            type="color"
            value={toolProperties.color}
            onChange={(e) => updateToolProperty('color', e.target.value)}
            style={{
              width: '100%',
              height: '28px',
              padding: 0,
              border: '1px solid var(--mb-border)',
              borderRadius: 'var(--mb-radius-xs)',
              cursor: 'pointer',
              marginTop: '4px',
            }}
          />
        </PropertySection>
      )}

      {/* Stroke Width */}
      {showStrokeWidth && (
        <PropertySection label="Stroke Width">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="range"
              min={1}
              max={20}
              value={toolProperties.strokeWidth}
              onChange={(e) =>
                updateToolProperty('strokeWidth', parseInt(e.target.value, 10))
              }
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: '12px', color: 'var(--mb-text-secondary)', minWidth: '24px' }}>
              {toolProperties.strokeWidth}px
            </span>
          </div>
        </PropertySection>
      )}

      {/* Opacity */}
      {showOpacity && (
        <PropertySection label="Opacity">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.1}
              value={toolProperties.opacity}
              onChange={(e) =>
                updateToolProperty('opacity', parseFloat(e.target.value))
              }
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: '12px', color: 'var(--mb-text-secondary)', minWidth: '32px' }}>
              {Math.round(toolProperties.opacity * 100)}%
            </span>
          </div>
        </PropertySection>
      )}

      {/* Font Settings */}
      {showFont && (
        <>
          <PropertySection label="Font Family">
            <select
              value={toolProperties.fontFamily}
              onChange={(e) => updateToolProperty('fontFamily', e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: 'var(--mb-surface-sunken)',
                color: 'var(--mb-text)',
                border: '1px solid var(--mb-border)',
                borderRadius: 'var(--mb-radius-xs)',
                fontSize: '12px',
              }}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </PropertySection>

          <PropertySection label="Font Size">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                min={8}
                max={120}
                value={toolProperties.fontSize}
                onChange={(e) =>
                  updateToolProperty('fontSize', parseInt(e.target.value, 10) || 16)
                }
                style={{
                  width: '64px',
                  padding: '4px 8px',
                  backgroundColor: 'var(--mb-surface-sunken)',
                  color: 'var(--mb-text)',
                  border: '1px solid var(--mb-border)',
                  borderRadius: 'var(--mb-radius-xs)',
                  fontSize: '12px',
                }}
              />
              <span style={{ fontSize: '12px', color: 'var(--mb-text-secondary)' }}>
                px
              </span>
            </div>
          </PropertySection>
        </>
      )}

      {/* Shape Type */}
      {showShapeType && (
        <PropertySection label="Shape">
          <div style={{ display: 'flex', gap: '4px' }}>
            {([
              { id: SHAPES.RECT, label: 'Rectangle' },
              { id: SHAPES.ELLIPSE, label: 'Ellipse' },
              { id: SHAPES.LINE, label: 'Line' },
            ] as const).map((shape) => (
              <button
                key={shape.id}
                onClick={() => updateToolProperty('shapeType', shape.id as ShapeId)}
                aria-label={shape.label}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  backgroundColor:
                    toolProperties.shapeType === shape.id
                      ? 'var(--mb-brand-tint)'
                      : 'var(--mb-surface-alt)',
                  color:
                    toolProperties.shapeType === shape.id
                      ? 'var(--mb-brand)'
                      : 'var(--mb-text)',
                  border: `1px solid ${
                    toolProperties.shapeType === shape.id
                      ? 'var(--mb-brand)'
                      : 'var(--mb-border)'
                  }`,
                  borderRadius: 'var(--mb-radius-xs)',
                  cursor: 'pointer',
                }}
              >
                {shape.label}
              </button>
            ))}
          </div>
        </PropertySection>
      )}
    </div>
  );
}

function PropertySection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--mb-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
