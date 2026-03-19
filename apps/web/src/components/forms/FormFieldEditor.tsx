import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../shared/Modal';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../services/api';
import {
  actionsStyle,
  dialogBodyStyle,
  errorStyle,
  helperTextStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
  sectionTitleStyle,
} from '../legal/primitives';
import type { FormField } from '../../types/api';
import type { CSSProperties } from 'react';

interface FormFieldEditorProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => Promise<void> | void;
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px',
  borderBottom: '2px solid var(--mb-border)',
  color: 'var(--mb-text-secondary)',
  fontWeight: 600,
  fontSize: '12px',
};

const tdStyle: CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--mb-border)',
  verticalAlign: 'middle',
};

const inputCellStyle: CSSProperties = {
  width: '100%',
  minHeight: '28px',
  padding: '4px 8px',
  border: '1px solid var(--mb-border)',
  borderRadius: 'var(--mb-radius-sm)',
  backgroundColor: 'var(--mb-surface)',
  color: 'var(--mb-text)',
  fontSize: '13px',
};

const scrollContainerStyle: CSSProperties = {
  maxHeight: '400px',
  overflowY: 'auto',
};

const typeBadgeStyle = (type: string): CSSProperties => ({
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: '3px',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  backgroundColor:
    type === 'text'
      ? 'rgba(59, 130, 246, 0.1)'
      : type === 'checkbox' || type === 'radio'
        ? 'rgba(16, 185, 129, 0.1)'
        : type === 'dropdown'
          ? 'rgba(245, 158, 11, 0.1)'
          : 'rgba(107, 114, 128, 0.1)',
  color:
    type === 'text'
      ? 'rgb(59, 130, 246)'
      : type === 'checkbox' || type === 'radio'
        ? 'rgb(16, 185, 129)'
        : type === 'dropdown'
          ? 'rgb(245, 158, 11)'
          : 'rgb(107, 114, 128)',
});

export function FormFieldEditor({ open, onClose, onApplied }: FormFieldEditorProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Load fields when dialog opens
  useEffect(() => {
    if (!open || !document) return;

    setLoading(true);
    setErrorMessage('');

    api
      .getFormFields(document.sessionId)
      .then((result) => {
        setFields(result.fields);
        const initial: Record<string, string> = {};
        for (const field of result.fields) {
          initial[field.name] = field.value != null ? String(field.value) : '';
        }
        setValues(initial);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load form fields';
        setErrorMessage(message);
      })
      .finally(() => setLoading(false));
  }, [document, open]);

  const handleChange = useCallback((fieldName: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!document || submitting) return;

    setSubmitting(true);
    setErrorMessage('');

    try {
      // Convert checkbox/radio "Yes"/"Off" back to boolean for the API
      const apiFields: Record<string, unknown> = {};
      for (const field of fields) {
        const val = values[field.name] ?? '';
        if (field.type === 'checkbox' || field.type === 'radio') {
          apiFields[field.name] = val === 'Yes';
        } else {
          apiFields[field.name] = val;
        }
      }

      const result = await api.fillFormFields(document.sessionId, { fields: apiFields });
      addToast({
        type: 'success',
        message: `Updated ${result.fields_updated} form field${result.fields_updated !== 1 ? 's' : ''}`,
      });
      await onApplied?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fill form fields';
      setErrorMessage(message);
      addToast({ type: 'error', message });
    } finally {
      setSubmitting(false);
    }
  }, [addToast, document, fields, onApplied, onClose, submitting, values]);

  const handleFlatten = useCallback(async () => {
    if (!document) return;

    try {
      await api.flattenForm(document.sessionId);
      addToast({ type: 'success', message: 'Form fields flattened' });
      await onApplied?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to flatten form';
      setErrorMessage(message);
      addToast({ type: 'error', message });
    }
  }, [addToast, document, onApplied, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Form Fields">
      <div style={dialogBodyStyle}>
        {loading ? (
          <div style={helperTextStyle}>Loading form fields...</div>
        ) : fields.length === 0 ? (
          <div style={sectionStyle}>
            <div style={helperTextStyle}>No form fields detected in this document.</div>
          </div>
        ) : (
          <>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>
                {fields.length} field{fields.length !== 1 ? 's' : ''} detected
              </div>
              <div style={scrollContainerStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Page</th>
                      <th style={{ ...thStyle, minWidth: '180px' }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.name}>
                        <td style={tdStyle}>{field.name}</td>
                        <td style={tdStyle}>
                          <span style={typeBadgeStyle(field.type)}>{field.type}</span>
                        </td>
                        <td style={tdStyle}>{field.page}</td>
                        <td style={tdStyle}>
                          {field.type === 'checkbox' || field.type === 'radio' ? (
                            <input
                              type="checkbox"
                              checked={values[field.name] === 'Yes'}
                              onChange={(e) =>
                                handleChange(field.name, e.target.checked ? 'Yes' : 'Off')
                              }
                              disabled={field.read_only}
                            />
                          ) : field.type === 'dropdown' ? (
                            <select
                              value={values[field.name] ?? ''}
                              onChange={(e) => handleChange(field.name, e.target.value)}
                              disabled={field.read_only}
                              style={inputCellStyle}
                            >
                              <option value="">--</option>
                              {field.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={values[field.name] ?? ''}
                              onChange={(e) => handleChange(field.name, e.target.value)}
                              disabled={field.read_only}
                              style={inputCellStyle}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {errorMessage ? <div style={errorStyle}>{errorMessage}</div> : null}

            <div style={actionsStyle}>
              <button
                type="button"
                onClick={handleFlatten}
                disabled={submitting}
                style={secondaryButtonStyle}
                title="Convert form fields to static content (irreversible)"
              >
                Flatten
              </button>
              <button type="button" onClick={onClose} disabled={submitting} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting} style={primaryButtonStyle}>
                {submitting ? 'Saving...' : 'Save Fields'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
