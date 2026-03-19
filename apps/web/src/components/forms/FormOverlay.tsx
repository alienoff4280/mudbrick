import { useCallback, useEffect, useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../services/api';
import type { FormField } from '../../types/api';
import type { CSSProperties } from 'react';

interface FormOverlayProps {
  /** The current page being viewed (1-indexed) */
  page: number;
  /** Scale factor from PDF coordinates to screen coordinates */
  scale: number;
  /** Whether the form overlay is active */
  active: boolean;
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};

const fieldOverlayStyle = (
  field: FormField,
  scale: number,
  focused: boolean,
): CSSProperties => ({
  position: 'absolute',
  left: `${field.rect[0] * scale}px`,
  top: `${field.rect[1] * scale}px`,
  width: `${field.rect[2] * scale}px`,
  height: `${field.rect[3] * scale}px`,
  pointerEvents: 'auto',
  border: focused ? '2px solid var(--mb-brand)' : '1px solid rgba(0, 100, 200, 0.4)',
  borderRadius: '2px',
  backgroundColor: focused ? 'rgba(0, 100, 200, 0.08)' : 'rgba(0, 100, 200, 0.04)',
  boxSizing: 'border-box',
});

/**
 * FormOverlay -- Renders interactive form fields over a PDF page.
 *
 * Positioned absolutely within the page container, this component draws
 * editable input controls at the locations where PDF form widgets exist.
 */
export function FormOverlay({ page, scale, active }: FormOverlayProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load form fields
  useEffect(() => {
    if (!active || !document) {
      setFields([]);
      return;
    }

    setLoading(true);
    api
      .getFormFields(document.sessionId)
      .then((result) => {
        setFields(result.fields);
        // Initialize values from existing field values
        const initial: Record<string, string> = {};
        for (const field of result.fields) {
          if (field.value != null) {
            initial[field.name] = String(field.value);
          }
        }
        setValues(initial);
      })
      .catch(() => {
        setFields([]);
      })
      .finally(() => setLoading(false));
  }, [active, document]);

  const pageFields = fields.filter((f) => f.page === page);

  const handleChange = useCallback((fieldName: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  if (!active || pageFields.length === 0) {
    return null;
  }

  return (
    <div style={overlayStyle} data-form-overlay>
      {pageFields.map((field) => (
        <div
          key={field.name}
          style={fieldOverlayStyle(field, scale, focusedField === field.name)}
        >
          {field.type === 'text' && (
            <input
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              onFocus={() => setFocusedField(field.name)}
              onBlur={() => setFocusedField(null)}
              disabled={field.read_only}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: 'transparent',
                fontSize: `${Math.max(10, field.rect[3] * scale * 0.6)}px`,
                padding: '2px 4px',
                outline: 'none',
                color: 'var(--mb-text)',
              }}
              title={field.name}
            />
          )}
          {field.type === 'checkbox' && (
            <input
              type="checkbox"
              checked={values[field.name] === 'Yes'}
              onChange={(e) => handleChange(field.name, e.target.checked ? 'Yes' : 'Off')}
              onFocus={() => setFocusedField(field.name)}
              onBlur={() => setFocusedField(null)}
              disabled={field.read_only}
              style={{
                width: '100%',
                height: '100%',
                margin: 0,
                cursor: field.read_only ? 'default' : 'pointer',
              }}
              title={field.name}
            />
          )}
          {field.type === 'dropdown' && (
            <select
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              onFocus={() => setFocusedField(field.name)}
              onBlur={() => setFocusedField(null)}
              disabled={field.read_only}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: 'transparent',
                fontSize: `${Math.max(10, field.rect[3] * scale * 0.6)}px`,
                outline: 'none',
              }}
              title={field.name}
            >
              <option value="">--</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
          {field.type === 'radio' && (
            <input
              type="radio"
              checked={values[field.name] === 'Yes'}
              onChange={(e) => handleChange(field.name, e.target.checked ? 'Yes' : 'Off')}
              onFocus={() => setFocusedField(field.name)}
              onBlur={() => setFocusedField(null)}
              disabled={field.read_only}
              style={{
                width: '100%',
                height: '100%',
                margin: 0,
                cursor: field.read_only ? 'default' : 'pointer',
              }}
              title={field.name}
            />
          )}
        </div>
      ))}
    </div>
  );
}
