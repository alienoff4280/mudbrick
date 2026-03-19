/**
 * Mudbrick v2 -- OCR Panel
 *
 * Language selector, page range selector, "Run OCR" button,
 * SSE progress bar showing page-by-page completion, results summary.
 */

import { useState, useCallback, useRef } from 'react';
import { api } from '../../services/api';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import type { OcrResults, OcrPageCompleteEvent, OcrDoneEvent } from '../../types/api';
import styles from './OcrPanel.module.css';

const LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
  { code: 'ara', label: 'Arabic' },
];

interface OcrPanelProps {
  /** Callback when OCR completes with results */
  onOcrComplete: (results: OcrResults) => void;
}

export function OcrPanel({ onOcrComplete }: OcrPanelProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [language, setLanguage] = useState('eng');
  const [pageRange, setPageRange] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number } | null>(null);
  const [results, setResults] = useState<OcrResults | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pageCount = document?.pageCount ?? 0;

  const handleRunOcr = useCallback(async () => {
    if (!document) return;

    setRunning(true);
    setProgress(null);
    setResults(null);

    // Parse pages from range
    let pages: number[] | undefined;
    if (pageRange.trim()) {
      pages = [];
      for (const part of pageRange.split(',')) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
          const [start, end] = trimmed.split('-').map((s) => parseInt(s.trim(), 10));
          if (!isNaN(start) && !isNaN(end)) {
            for (let p = start; p <= end; p++) {
              if (p >= 1 && p <= pageCount) pages.push(p);
            }
          }
        } else {
          const p = parseInt(trimmed, 10);
          if (!isNaN(p) && p >= 1 && p <= pageCount) pages.push(p);
        }
      }
      if (pages.length === 0) pages = undefined;
    }

    try {
      const response = await api.startOcrStream(document.sessionId, {
        pages,
        language,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'OCR failed' }));
        throw new Error(err.detail || 'OCR request failed');
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.slice(5).trim();
          } else if (line === '' && eventType && eventData) {
            // Process event
            try {
              const data = JSON.parse(eventData);

              if (eventType === 'page_complete') {
                const pageEvent = data as OcrPageCompleteEvent;
                setProgress({
                  page: pageEvent.page,
                  total: pageEvent.total,
                });
              } else if (eventType === 'done') {
                const doneEvent = data as OcrDoneEvent;
                // Fetch full results
                const fullResults = await api.getOcrResults(document.sessionId);
                setResults(fullResults);
                onOcrComplete(fullResults);
                addToast({
                  type: 'success',
                  message: `OCR complete: ${doneEvent.total_words} words across ${doneEvent.pages_processed} pages`,
                });
              } else if (eventType === 'error') {
                addToast({ type: 'error', message: data.message || 'OCR error' });
              }
            } catch {
              // Skip malformed events
            }
            eventType = '';
            eventData = '';
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OCR failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setRunning(false);
    }
  }, [document, language, pageRange, pageCount, addToast, onOcrComplete]);

  const progressPercent = progress
    ? Math.round((progress.page / progress.total) * 100)
    : 0;

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>OCR Processing</h3>
      <p className={styles.subtitle}>
        Extract text from scanned pages using optical character recognition.
      </p>

      {/* Language Selector */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="ocr-language">
          Language
        </label>
        <select
          id="ocr-language"
          className={styles.select}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={running}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>

      {/* Page Range */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="ocr-pages">
          Pages (optional)
        </label>
        <input
          id="ocr-pages"
          className={styles.input}
          type="text"
          placeholder={`All pages (1-${pageCount})`}
          value={pageRange}
          onChange={(e) => setPageRange(e.target.value)}
          disabled={running}
        />
        <span className={styles.hint}>Leave blank for all pages, or enter ranges like "1-5, 8"</span>
      </div>

      {/* Run Button */}
      <button
        className={styles.runBtn}
        onClick={handleRunOcr}
        disabled={running || !document}
      >
        {running ? 'Processing...' : 'Run OCR'}
      </button>

      {/* Progress Bar */}
      {running && progress && (
        <div className={styles.progressSection}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className={styles.progressText}>
            Page {progress.page} of {progress.total} ({progressPercent}%)
          </span>
        </div>
      )}

      {/* Results Summary */}
      {results && (
        <div className={styles.results}>
          <h4 className={styles.resultsTitle}>Results</h4>
          <div className={styles.resultsStat}>
            <span className={styles.statLabel}>Total Words:</span>
            <span className={styles.statValue}>{results.total_words.toLocaleString()}</span>
          </div>
          <div className={styles.resultsStat}>
            <span className={styles.statLabel}>Avg Confidence:</span>
            <span className={styles.statValue}>
              {(results.avg_confidence * 100).toFixed(1)}%
            </span>
          </div>
          <div className={styles.resultsStat}>
            <span className={styles.statLabel}>Pages Processed:</span>
            <span className={styles.statValue}>{results.pages.length}</span>
          </div>
          <div className={styles.resultsStat}>
            <span className={styles.statLabel}>Language:</span>
            <span className={styles.statValue}>
              {LANGUAGES.find((l) => l.code === results.language)?.label ?? results.language}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
