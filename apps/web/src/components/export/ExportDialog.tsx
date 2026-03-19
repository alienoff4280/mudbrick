/**
 * Mudbrick v2 -- ExportDialog Component
 *
 * Modal dialog for exporting the document with flattened annotations.
 * Sends annotations JSON to POST /api/export/{sid}, then saves via Tauri dialog.
 */

import { useState, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { ProgressBar } from '../welcome/ProgressBar';
import { useDocumentStore } from '../../stores/documentStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useUIStore } from '../../stores/uiStore';
import { useTauri } from '../../hooks/useTauri';
import { api } from '../../services/api';
import type { PageAnnotations } from '../../types/annotation';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ExportState = 'idle' | 'exporting' | 'success' | 'error';

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const pageAnnotations = useAnnotationStore((s) => s.pageAnnotations);
  const addToast = useUIStore((s) => s.addToast);
  const { chooseSavePath } = useTauri();

  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');
  const [exportedPath, setExportedPath] = useState('');

  const [flattenAnnotations, setFlattenAnnotations] = useState(true);

  const handleExport = useCallback(async () => {
    if (!document) return;

    // Choose save location
    const defaultName = document.fileName.replace(/\.pdf$/i, '_exported.pdf');
    const outputPath = await chooseSavePath(defaultName);
    if (!outputPath) return;

    setState('exporting');
    setProgress(undefined);
    setErrorMessage('');

    try {
      setProgress(30);

      // Build annotations payload
      const annotations: Record<number, PageAnnotations> = flattenAnnotations
        ? { ...pageAnnotations }
        : {};

      setProgress(60);

      // Call export endpoint
      const result = await api.exportDocument(
        document.sessionId,
        annotations,
        outputPath,
        { flatten_annotations: flattenAnnotations },
      );

      setProgress(100);
      setState('success');
      setExportedPath(result.file_path);
      addToast({ type: 'success', message: `Exported to ${result.file_path.split(/[/\\]/).pop()}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      setState('error');
      setErrorMessage(msg);
      addToast({ type: 'error', message: msg });
    }
  }, [document, pageAnnotations, flattenAnnotations, chooseSavePath, addToast]);

  const handleClose = useCallback(() => {
    setState('idle');
    setProgress(undefined);
    setErrorMessage('');
    setExportedPath('');
    onClose();
  }, [onClose]);

  const annotationCount = Object.values(pageAnnotations).reduce(
    (sum, page) => sum + (page.objects?.length ?? 0),
    0,
  );

  return (
    <Modal open={open} onClose={handleClose} title="Export Document">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '360px' }}>
        {/* Document info */}
        <div style={{ fontSize: '13px', color: 'var(--mb-text-secondary)' }}>
          <div>{document?.fileName}</div>
          <div>{document?.pageCount} pages</div>
          <div>{annotationCount} annotation{annotationCount !== 1 ? 's' : ''}</div>
        </div>

        {/* Options */}
        {state === 'idle' && (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={flattenAnnotations}
                onChange={(e) => setFlattenAnnotations(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              Flatten annotations into PDF
            </label>

            <button
              onClick={handleExport}
              disabled={!document}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--mb-brand)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--mb-radius-sm)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color var(--mb-transition)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--mb-brand-light)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--mb-brand)';
              }}
            >
              Choose Location and Export
            </button>
          </>
        )}

        {/* Progress */}
        {state === 'exporting' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '13px' }}>Exporting...</span>
            <ProgressBar value={progress} height={6} showLabel />
          </div>
        )}

        {/* Success */}
        {state === 'success' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--mb-toast-success)', fontWeight: 500 }}>
              Export complete
            </span>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--mb-text-secondary)',
                wordBreak: 'break-all',
              }}
            >
              {exportedPath}
            </span>
            <button
              onClick={handleClose}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--mb-surface-alt)',
                color: 'var(--mb-text)',
                border: '1px solid var(--mb-border)',
                borderRadius: 'var(--mb-radius-sm)',
                fontSize: '13px',
                cursor: 'pointer',
                alignSelf: 'flex-end',
              }}
            >
              Close
            </button>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--mb-danger)', fontWeight: 500 }}>
              Export failed
            </span>
            <span style={{ fontSize: '12px', color: 'var(--mb-text-secondary)' }}>
              {errorMessage}
            </span>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setState('idle')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--mb-surface-alt)',
                  color: 'var(--mb-text)',
                  border: '1px solid var(--mb-border)',
                  borderRadius: 'var(--mb-radius-sm)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
              <button
                onClick={handleClose}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--mb-surface-alt)',
                  color: 'var(--mb-text)',
                  border: '1px solid var(--mb-border)',
                  borderRadius: 'var(--mb-radius-sm)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
