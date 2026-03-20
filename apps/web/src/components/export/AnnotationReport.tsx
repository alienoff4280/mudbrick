/**
 * Mudbrick v2 -- Annotation Summary Report
 *
 * Generates a summary of all annotations: listed by page, type, and content.
 * Supports export as JSON, CSV, or plain text.
 */

import { useCallback, useMemo } from 'react';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import type { Annotation } from '../../types/annotation';
import styles from './AnnotationReport.module.css';

interface AnnotationReportProps {
  open: boolean;
  onClose: () => void;
}

interface AnnotationEntry {
  page: number;
  type: string;
  content: string;
  tool?: string;
}

function describeAnnotation(annot: Annotation): AnnotationEntry {
  const base: AnnotationEntry = {
    page: annot.page,
    type: annot.type,
    content: '',
  };

  if ('tool' in annot) {
    base.tool = annot.tool as string;
  }

  switch (annot.type) {
    case 'textbox':
      base.type = 'text';
      base.content = (annot as { text?: string }).text ?? '';
      break;
    case 'path':
      base.type = 'drawing';
      base.content = 'Freehand drawing';
      break;
    case 'rect':
      if (base.tool === 'highlight') {
        base.type = 'highlight';
        base.content = 'Highlighted region';
      } else if (base.tool === 'redact') {
        base.type = 'redaction';
        base.content = 'Redacted region';
      } else {
        base.type = 'shape';
        base.content = 'Rectangle';
      }
      break;
    case 'ellipse':
      base.type = 'shape';
      base.content = 'Ellipse';
      break;
    case 'line':
      base.type = 'shape';
      base.content = 'Line';
      break;
    case 'image':
      if (base.tool === 'stamp') {
        base.type = 'stamp';
        base.content = 'Stamp image';
      } else {
        base.type = 'image';
        base.content = 'Image';
      }
      break;
    default:
      base.content = base.type;
  }

  return base;
}

function entriesToJson(entries: AnnotationEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function entriesToCsv(entries: AnnotationEntry[]): string {
  const header = 'Page,Type,Content';
  const rows = entries.map(
    (e) => `${e.page},"${e.type}","${e.content.replace(/"/g, '""')}"`,
  );
  return [header, ...rows].join('\n');
}

function entriesToText(entries: AnnotationEntry[], fileName: string): string {
  const lines = [
    `Annotation Summary Report`,
    `Document: ${fileName}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Total annotations: ${entries.length}`,
    '',
  ];

  const byPage = new Map<number, AnnotationEntry[]>();
  for (const e of entries) {
    const list = byPage.get(e.page) ?? [];
    list.push(e);
    byPage.set(e.page, list);
  }

  for (const [page, pageEntries] of Array.from(byPage.entries()).sort(
    (a, b) => a[0] - b[0],
  )) {
    lines.push(`--- Page ${page} ---`);
    for (const e of pageEntries) {
      lines.push(`  [${e.type.toUpperCase()}] ${e.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AnnotationReport({ open, onClose }: AnnotationReportProps) {
  const annotations = useAnnotationStore((s) => s.pageAnnotations);
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const entries = useMemo(() => {
    const result: AnnotationEntry[] = [];
    for (const [, pageAnnots] of Object.entries(annotations)) {
      if (pageAnnots?.objects) {
        for (const annot of pageAnnots.objects) {
          result.push(describeAnnotation(annot));
        }
      }
    }
    return result.sort((a, b) => a.page - b.page);
  }, [annotations]);

  const byPage = useMemo(() => {
    const map = new Map<number, AnnotationEntry[]>();
    for (const e of entries) {
      const list = map.get(e.page) ?? [];
      list.push(e);
      map.set(e.page, list);
    }
    return map;
  }, [entries]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return counts;
  }, [entries]);

  const handleExport = useCallback(
    (format: 'json' | 'csv' | 'text') => {
      const fileName = document?.fileName ?? 'document';
      const baseName = fileName.replace(/\.pdf$/i, '');

      switch (format) {
        case 'json':
          downloadBlob(entriesToJson(entries), `${baseName}_annotations.json`, 'application/json');
          break;
        case 'csv':
          downloadBlob(entriesToCsv(entries), `${baseName}_annotations.csv`, 'text/csv');
          break;
        case 'text':
          downloadBlob(entriesToText(entries, fileName), `${baseName}_annotations.txt`, 'text/plain');
          break;
      }
      addToast({ type: 'success', message: `Exported annotations as ${format.toUpperCase()}` });
    },
    [entries, document, addToast],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Annotation Summary</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className={styles.body}>
          {entries.length === 0 ? (
            <div className={styles.emptyState}>No annotations in this document</div>
          ) : (
            <>
              <div className={styles.summary}>
                <span className={styles.summaryItem}>
                  Total: <span className={styles.summaryCount}>{entries.length}</span>
                </span>
                {Object.entries(typeCounts).map(([type, count]) => (
                  <span key={type} className={styles.summaryItem}>
                    {type}: <span className={styles.summaryCount}>{count}</span>
                  </span>
                ))}
              </div>

              {Array.from(byPage.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([page, pageEntries]) => (
                  <div key={page} className={styles.pageSection}>
                    <div className={styles.pageHeader}>
                      Page {page} ({pageEntries.length} annotation{pageEntries.length !== 1 ? 's' : ''})
                    </div>
                    {pageEntries.map((entry, i) => (
                      <div key={i} className={styles.annotItem}>
                        <span className={styles.annotType}>{entry.type}</span>
                        <span className={styles.annotContent}>{entry.content || '(no content)'}</span>
                      </div>
                    ))}
                  </div>
                ))}
            </>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.exportBtn} onClick={() => handleExport('json')}>
            Export JSON
          </button>
          <button className={styles.exportBtn} onClick={() => handleExport('csv')}>
            Export CSV
          </button>
          <button className={styles.exportBtn} onClick={() => handleExport('text')}>
            Export Text
          </button>
          <button className={styles.cancelBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
