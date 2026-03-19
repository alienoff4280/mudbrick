/**
 * Mudbrick v2 -- Split PDF Dialog
 *
 * Modal dialog for splitting a PDF into multiple files by page ranges.
 * Uses Tauri file dialog for output directory selection.
 */

import { useState, useCallback } from 'react';
import { api } from '../../services/api';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import styles from './SplitDialog.module.css';

import type { SplitPart } from '../../types/api';

interface SplitDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to close the dialog */
  onClose: () => void;
}

export function SplitDialog({ open, onClose }: SplitDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [rangeInput, setRangeInput] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [filenamePrefix, setFilenamePrefix] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [results, setResults] = useState<SplitPart[] | null>(null);

  const pageCount = document?.pageCount ?? 0;

  // Parse ranges for preview
  const parsedRanges = rangeInput
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  const getPageCountForRange = (range: string): number => {
    if (range.includes('-')) {
      const [start, end] = range.split('-').map((s) => parseInt(s.trim(), 10));
      if (isNaN(start) || isNaN(end)) return 0;
      return Math.max(0, Math.min(end, pageCount) - Math.max(start, 1) + 1);
    }
    const p = parseInt(range, 10);
    return !isNaN(p) && p >= 1 && p <= pageCount ? 1 : 0;
  };

  const handleChooseOutputDir = useCallback(async () => {
    try {
      // Use Tauri dialog if available, otherwise prompt
      if (window.__TAURI__) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
          setOutputDir(selected as string);
        }
      } else {
        // Fallback for browser dev mode
        const dir = prompt('Enter output directory path:');
        if (dir) setOutputDir(dir);
      }
    } catch {
      // Tauri dialog not available
      const dir = prompt('Enter output directory path:');
      if (dir) setOutputDir(dir);
    }
  }, []);

  const handleSplit = useCallback(async () => {
    if (!document || !outputDir || parsedRanges.length === 0) return;

    setSplitting(true);
    setResults(null);

    try {
      const resp = await api.splitPdf(
        document.sessionId,
        parsedRanges,
        outputDir,
        filenamePrefix || undefined,
      );

      setResults(resp.parts);
      addToast({
        type: 'success',
        message: `Split into ${resp.total_parts} file(s)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Split failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setSplitting(false);
    }
  }, [document, outputDir, parsedRanges, filenamePrefix, addToast]);

  const handleClose = useCallback(() => {
    setResults(null);
    onClose();
  }, [onClose]);

  if (!open) return null;

  const canSplit =
    parsedRanges.length > 0 &&
    outputDir.length > 0 &&
    !splitting &&
    parsedRanges.some((r) => getPageCountForRange(r) > 0);

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Split PDF</h2>
          <button className={styles.closeBtn} onClick={handleClose}>
            &times;
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.info}>
            Total pages: <strong>{pageCount}</strong>
          </p>

          {/* Page Ranges */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="split-ranges">
              Page Ranges
            </label>
            <input
              id="split-ranges"
              className={styles.input}
              type="text"
              placeholder="e.g., 1-3, 4-6, 7-10"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              disabled={splitting}
            />
            <span className={styles.hint}>
              Separate ranges with commas. Each range becomes a separate file.
            </span>
          </div>

          {/* Preview */}
          {parsedRanges.length > 0 && (
            <div className={styles.preview}>
              <span className={styles.previewLabel}>Preview:</span>
              {parsedRanges.map((range, i) => {
                const count = getPageCountForRange(range);
                return (
                  <span
                    key={i}
                    className={`${styles.previewPart} ${count === 0 ? styles.invalid : ''}`}
                  >
                    Part {i + 1}: pages {range} ({count} page{count !== 1 ? 's' : ''})
                  </span>
                );
              })}
            </div>
          )}

          {/* Output Directory */}
          <div className={styles.field}>
            <label className={styles.label}>Output Directory</label>
            <div className={styles.dirPicker}>
              <input
                className={styles.input}
                type="text"
                placeholder="Choose output directory..."
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                disabled={splitting}
              />
              <button
                className={styles.browseBtn}
                onClick={handleChooseOutputDir}
                disabled={splitting}
              >
                Browse
              </button>
            </div>
          </div>

          {/* Filename Prefix */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="split-prefix">
              Filename Prefix (optional)
            </label>
            <input
              id="split-prefix"
              className={styles.input}
              type="text"
              placeholder={document?.fileName?.replace('.pdf', '') ?? 'document'}
              value={filenamePrefix}
              onChange={(e) => setFilenamePrefix(e.target.value)}
              disabled={splitting}
            />
          </div>

          {/* Results */}
          {results && (
            <div className={styles.results}>
              <h3 className={styles.resultsTitle}>Split Complete</h3>
              {results.map((part, i) => (
                <div key={i} className={styles.resultPart}>
                  <span className={styles.resultFile}>
                    {part.file_path.split(/[/\\]/).pop()}
                  </span>
                  <span className={styles.resultMeta}>
                    {part.page_count} page{part.page_count !== 1 ? 's' : ''} |{' '}
                    {(part.file_size / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={handleClose}>
            {results ? 'Done' : 'Cancel'}
          </button>
          {!results && (
            <button
              className={styles.splitBtn}
              onClick={handleSplit}
              disabled={!canSplit}
            >
              {splitting ? 'Splitting...' : `Split into ${parsedRanges.length} file(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
