import { useCallback, useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../services/api';
import {
  actionsStyle,
  helperTextStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
  sectionTitleStyle,
} from '../legal/primitives';
import type { CSSProperties } from 'react';

interface FormDataPanelProps {
  /** Whether the panel is visible */
  visible: boolean;
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '12px',
  borderLeft: '1px solid var(--mb-border)',
  backgroundColor: 'var(--mb-surface)',
  width: '280px',
  overflowY: 'auto',
};

const codeBlockStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '11px',
  padding: '12px',
  borderRadius: 'var(--mb-radius-sm)',
  backgroundColor: 'var(--mb-surface-alt)',
  border: '1px solid var(--mb-border)',
  maxHeight: '300px',
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const smallButtonStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: '12px',
  border: '1px solid var(--mb-border)',
  borderRadius: 'var(--mb-radius-sm)',
  backgroundColor: 'var(--mb-surface)',
  color: 'var(--mb-text)',
  cursor: 'pointer',
  fontWeight: 600,
};

/**
 * FormDataPanel -- Side panel for exporting / importing form data.
 *
 * Shows the current form data as JSON and provides buttons to
 * export to clipboard or import from a JSON file.
 */
export function FormDataPanel({ visible }: FormDataPanelProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [exportData, setExportData] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleExport = useCallback(async () => {
    if (!document) return;
    setLoading(true);

    try {
      const result = await api.exportFormData(document.sessionId);
      const json = JSON.stringify(result.data, null, 2);
      setExportData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export form data';
      addToast({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [addToast, document]);

  const handleCopy = useCallback(async () => {
    if (!exportData) return;

    try {
      await navigator.clipboard.writeText(exportData);
      addToast({ type: 'success', message: 'Form data copied to clipboard' });
    } catch {
      addToast({ type: 'error', message: 'Failed to copy to clipboard' });
    }
  }, [addToast, exportData]);

  const handleImport = useCallback(async () => {
    if (!document) return;

    // Create a hidden file input to select JSON
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        const result = await api.importFormData(document.sessionId, {
          format: 'json',
          data,
        });

        addToast({
          type: 'success',
          message: `Imported ${result.fields_updated} field${result.fields_updated !== 1 ? 's' : ''}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to import form data';
        addToast({ type: 'error', message });
      }
    };

    input.click();
  }, [addToast, document]);

  if (!visible) return null;

  return (
    <div style={panelStyle}>
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Form Data</div>
        <div style={helperTextStyle}>
          Export or import form field values as JSON.
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleExport}
            disabled={!document || loading}
            style={smallButtonStyle}
          >
            {loading ? 'Loading...' : 'Export JSON'}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!document}
            style={smallButtonStyle}
          >
            Import JSON
          </button>
        </div>

        {exportData && (
          <>
            <div style={codeBlockStyle}>{exportData}</div>
            <button type="button" onClick={handleCopy} style={smallButtonStyle}>
              Copy to clipboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
