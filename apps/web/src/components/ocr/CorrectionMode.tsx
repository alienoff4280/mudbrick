/**
 * Mudbrick v2 -- OCR Correction Mode
 *
 * Overlay showing OCR text on the page with low-confidence words highlighted.
 * Click on a word to edit its text. Save corrections back to the cached results.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { OcrPageResult, OcrWord } from '../../types/api';
import styles from './CorrectionMode.module.css';

/** Confidence threshold below which words are highlighted for review */
const LOW_CONFIDENCE_THRESHOLD = 0.8;

interface CorrectionModeProps {
  /** OCR results for the current page */
  pageResult: OcrPageResult;
  /** Scale factor: CSS pixels per PDF point */
  scale: number;
  /** Callback when a word is corrected */
  onWordCorrected: (wordIndex: number, newText: string) => void;
  /** Callback to exit correction mode */
  onExit: () => void;
}

export function CorrectionMode({
  pageResult,
  scale,
  onWordCorrected,
  onExit,
}: CorrectionModeProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [showLowConfOnly, setShowLowConfOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const words = pageResult.words;

  const displayWords = useMemo(() => {
    if (showLowConfOnly) {
      return words
        .map((w, i) => ({ word: w, index: i }))
        .filter((item) => item.word.confidence < LOW_CONFIDENCE_THRESHOLD);
    }
    return words.map((w, i) => ({ word: w, index: i }));
  }, [words, showLowConfOnly]);

  const lowConfCount = useMemo(
    () => words.filter((w) => w.confidence < LOW_CONFIDENCE_THRESHOLD).length,
    [words],
  );

  const startEditing = useCallback(
    (index: number, word: OcrWord) => {
      setEditingIndex(index);
      setEditText(word.text);
    },
    [],
  );

  const commitEdit = useCallback(() => {
    if (editingIndex !== null && editText.trim()) {
      onWordCorrected(editingIndex, editText.trim());
    }
    setEditingIndex(null);
    setEditText('');
  }, [editingIndex, editText, onWordCorrected]);

  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditText('');
  }, []);

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingIndex]);

  const getConfidenceClass = (confidence: number): string => {
    if (confidence >= 0.9) return styles.confHigh;
    if (confidence >= LOW_CONFIDENCE_THRESHOLD) return styles.confMedium;
    return styles.confLow;
  };

  return (
    <div className={styles.overlay}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>OCR Correction Mode</span>
        <label className={styles.filterLabel}>
          <input
            type="checkbox"
            checked={showLowConfOnly}
            onChange={(e) => setShowLowConfOnly(e.target.checked)}
          />
          Show only low confidence ({lowConfCount})
        </label>
        <span className={styles.stats}>
          {words.length} words | Avg {(pageResult.avg_confidence * 100).toFixed(0)}%
        </span>
        <button className={styles.exitBtn} onClick={onExit}>
          Exit
        </button>
      </div>

      {/* Word overlays */}
      {displayWords.map(({ word, index }) => {
        const isEditing = editingIndex === index;

        return (
          <div
            key={index}
            className={`${styles.wordOverlay} ${getConfidenceClass(word.confidence)}`}
            style={{
              left: `${word.x * scale}px`,
              top: `${word.y * scale}px`,
              width: `${word.width * scale}px`,
              height: `${word.height * scale}px`,
            }}
            onClick={() => !isEditing && startEditing(index, word)}
            title={`"${word.text}" (${(word.confidence * 100).toFixed(0)}% confidence)`}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                className={styles.editInput}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
              />
            ) : (
              <span className={styles.wordText}>{word.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
