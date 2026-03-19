import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../shared/Modal';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../services/api';
import {
  actionsStyle,
  dialogBodyStyle,
  errorStyle,
  fieldStyle,
  helperTextStyle,
  inputStyle,
  labelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
  sectionTitleStyle,
} from '../legal/primitives';
import type { CSSProperties } from 'react';

interface PageLabelEditorProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => Promise<void> | void;
}

interface LabelEntry {
  page: number;
  label: string;
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
};

const scrollContainerStyle: CSSProperties = {
  maxHeight: '300px',
  overflowY: 'auto',
};

export function PageLabelEditor({ open, onClose, onApplied }: PageLabelEditorProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [labels, setLabels] = useState<LabelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch current labels when dialog opens
  useEffect(() => {
    if (!open || !document) return;

    setLoading(true);
    setErrorMessage('');

    api
      .getPageLabels(document.sessionId)
      .then((result) => {
        const entries: LabelEntry[] = [];
        const pageCount = document.pageCount;
        for (let i = 1; i <= pageCount; i++) {
          entries.push({
            page: i,
            label: result.labels[i] ?? '',
          });
        }
        setLabels(entries);
      })
      .catch((err) => {
        // If endpoint doesn't return labels, initialize empty
        const entries: LabelEntry[] = [];
        const pageCount = document.pageCount;
        for (let i = 1; i <= pageCount; i++) {
          entries.push({ page: i, label: '' });
        }
        setLabels(entries);
      })
      .finally(() => setLoading(false));
  }, [document, open]);

  const updateLabel = useCallback((page: number, label: string) => {
    setLabels((prev) =>
      prev.map((entry) => (entry.page === page ? { ...entry, label } : entry)),
    );
  }, []);

  const applyPreset = useCallback(
    (preset: 'roman' | 'alpha' | 'numeric' | 'clear') => {
      setLabels((prev) =>
        prev.map((entry, idx) => {
          let label = '';
          switch (preset) {
            case 'roman':
              label = toRoman(idx + 1);
              break;
            case 'alpha':
              label = toAlpha(idx + 1);
              break;
            case 'numeric':
              label = String(idx + 1);
              break;
            case 'clear':
              label = '';
              break;
          }
          return { ...entry, label };
        }),
      );
    },
    [],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!document || submitting) return;

      const nonEmpty = labels.filter((e) => e.label.trim() !== '');
      if (nonEmpty.length === 0) {
        setErrorMessage('No labels to apply');
        return;
      }

      setSubmitting(true);
      setErrorMessage('');

      try {
        await api.setPageLabels(document.sessionId, {
          labels: nonEmpty.map((e) => ({ page: e.page, label: e.label })),
        });

        addToast({
          type: 'success',
          message: `Set labels on ${nonEmpty.length} page${nonEmpty.length !== 1 ? 's' : ''}`,
        });
        await onApplied?.();
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to set page labels';
        setErrorMessage(message);
        addToast({ type: 'error', message });
      } finally {
        setSubmitting(false);
      }
    },
    [addToast, document, labels, onApplied, onClose, submitting],
  );

  return (
    <Modal open={open} onClose={onClose} title="Page Labels">
      <form onSubmit={handleSubmit} style={dialogBodyStyle}>
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Presets</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(
              [
                ['roman', 'Roman (i, ii, iii...)'],
                ['alpha', 'Alphabetic (A, B, C...)'],
                ['numeric', 'Numeric (1, 2, 3...)'],
                ['clear', 'Clear all'],
              ] as const
            ).map(([key, text]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  border: '1px solid var(--mb-border)',
                  borderRadius: 'var(--mb-radius-sm)',
                  backgroundColor: 'var(--mb-surface)',
                  color: 'var(--mb-text)',
                  cursor: 'pointer',
                }}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Page Labels</div>
          {loading ? (
            <div style={helperTextStyle}>Loading current labels...</div>
          ) : (
            <div style={scrollContainerStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Page</th>
                    <th style={thStyle}>Label</th>
                  </tr>
                </thead>
                <tbody>
                  {labels.map((entry) => (
                    <tr key={entry.page}>
                      <td style={tdStyle}>{entry.page}</td>
                      <td style={tdStyle}>
                        <input
                          value={entry.label}
                          onChange={(e) => updateLabel(entry.page, e.target.value)}
                          placeholder={String(entry.page)}
                          style={{ ...inputStyle, minHeight: '28px', padding: '4px 8px' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={helperTextStyle}>
            Page labels appear in PDF readers and when printing. Leave blank to use default numbering.
          </div>
        </div>

        {errorMessage ? <div style={errorStyle}>{errorMessage}</div> : null}

        <div style={actionsStyle}>
          <button type="button" onClick={onClose} disabled={submitting} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button type="submit" disabled={!document || submitting || loading} style={primaryButtonStyle}>
            {submitting ? 'Applying...' : 'Apply Labels'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function toRoman(num: number): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const numerals = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let result = '';
  let remaining = num;
  for (let i = 0; i < values.length; i++) {
    while (remaining >= values[i]) {
      result += numerals[i];
      remaining -= values[i];
    }
  }
  return result;
}

function toAlpha(num: number): string {
  let result = '';
  let remaining = num;
  while (remaining > 0) {
    remaining--;
    result = String.fromCharCode(65 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}
