/**
 * Mudbrick v2 -- Redaction Review Panel
 *
 * Lists matches grouped by page, allows selecting/deselecting individual matches,
 * and provides Apply All / Apply Selected / Skip controls.
 * Shows a confirmation dialog warning that redaction is permanent.
 */

import { useState, useCallback, useMemo } from 'react';
import { api } from '../../services/api';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import type { RedactionMatch, RedactionRegion } from '../../types/api';
import styles from './RedactionReview.module.css';

interface RedactionReviewProps {
  /** Matches from the search phase */
  matches: RedactionMatch[];
  /** Callback when a match is hovered (for highlighting on viewer) */
  onHighlightMatch: (match: RedactionMatch | null) => void;
  /** Callback when redaction is applied */
  onRedactionApplied: () => void;
  /** Callback to close/dismiss the review */
  onDismiss: () => void;
}

export function RedactionReview({
  matches,
  onHighlightMatch,
  onRedactionApplied,
  onDismiss,
}: RedactionReviewProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(matches.map((m) => m.id)),
  );
  const [applying, setApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Group matches by page
  const groupedByPage = useMemo(() => {
    const groups = new Map<number, RedactionMatch[]>();
    for (const match of matches) {
      const existing = groups.get(match.page) ?? [];
      existing.push(match);
      groups.set(match.page, existing);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [matches]);

  const toggleMatch = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(matches.map((m) => m.id)));
  }, [matches]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedMatches = useMemo(
    () => matches.filter((m) => selected.has(m.id)),
    [matches, selected],
  );

  const handleApply = useCallback(() => {
    if (selectedMatches.length === 0) {
      addToast({ type: 'warning', message: 'No matches selected' });
      return;
    }
    setShowConfirm(true);
  }, [selectedMatches, addToast]);

  const handleConfirmApply = useCallback(async () => {
    if (!document) return;
    setShowConfirm(false);
    setApplying(true);

    try {
      // Build regions from selected matches, grouped by page
      const regionMap = new Map<number, RedactionRegion>();
      for (const match of selectedMatches) {
        const existing = regionMap.get(match.page);
        if (existing) {
          existing.rects.push(...match.rects);
        } else {
          regionMap.set(match.page, {
            page: match.page,
            rects: [...match.rects],
          });
        }
      }

      const regions = Array.from(regionMap.values());
      const result = await api.applyRedaction(document.sessionId, regions);

      addToast({
        type: 'success',
        message: `Redacted ${result.regions_redacted} region(s) across ${result.pages_redacted} page(s)`,
      });
      onRedactionApplied();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Redaction failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setApplying(false);
    }
  }, [document, selectedMatches, addToast, onRedactionApplied]);

  if (matches.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>No matches to review.</p>
        <button className={styles.dismissBtn} onClick={onDismiss}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Review Matches</h3>
        <div className={styles.headerActions}>
          <button className={styles.linkBtn} onClick={selectAll}>
            Select All
          </button>
          <button className={styles.linkBtn} onClick={deselectAll}>
            Deselect All
          </button>
        </div>
      </div>

      <div className={styles.summary}>
        {selected.size} of {matches.length} selected
      </div>

      {/* Match list grouped by page */}
      <div className={styles.matchList}>
        {groupedByPage.map(([pageNum, pageMatches]) => (
          <div key={pageNum} className={styles.pageGroup}>
            <div className={styles.pageHeader}>Page {pageNum}</div>
            {pageMatches.map((match) => (
              <label
                key={match.id}
                className={`${styles.matchItem} ${selected.has(match.id) ? styles.matchSelected : ''}`}
                onMouseEnter={() => onHighlightMatch(match)}
                onMouseLeave={() => onHighlightMatch(null)}
              >
                <input
                  type="checkbox"
                  checked={selected.has(match.id)}
                  onChange={() => toggleMatch(match.id)}
                  disabled={applying}
                />
                <div className={styles.matchInfo}>
                  <span className={styles.matchText}>
                    &ldquo;{match.text}&rdquo;
                  </span>
                  <span className={styles.matchPattern}>{match.pattern}</span>
                </div>
              </label>
            ))}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          className={styles.applyBtn}
          onClick={handleApply}
          disabled={selected.size === 0 || applying}
        >
          {applying
            ? 'Applying...'
            : selected.size === matches.length
              ? 'Apply All'
              : `Apply ${selected.size} Selected`}
        </button>
        <button
          className={styles.skipBtn}
          onClick={onDismiss}
          disabled={applying}
        >
          Skip
        </button>
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmDialog}>
            <h4 className={styles.confirmTitle}>Confirm Redaction</h4>
            <p className={styles.confirmText}>
              This will permanently remove the content under{' '}
              <strong>{selected.size}</strong> redaction region(s). This action
              cannot be undone with standard PDF tools -- the underlying text,
              images, and vector content will be stripped from the PDF.
            </p>
            <p className={styles.confirmWarning}>
              Make sure you have saved a backup if needed.
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.confirmBtn}
                onClick={handleConfirmApply}
              >
                Apply Redaction
              </button>
              <button
                className={styles.confirmCancel}
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
