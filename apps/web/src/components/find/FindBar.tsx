/**
 * Mudbrick v2 -- Find Bar (Ctrl+F)
 *
 * Search input with next/prev match navigation, match count, and close button.
 * Connects to the text search API endpoint.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useDocumentStore } from '../../stores/documentStore';
import type { SearchMatch } from '../../types/api';
import styles from './FindBar.module.css';

interface FindBarProps {
  /** Whether the find bar is visible */
  visible: boolean;
  /** Callback to close the find bar */
  onClose: () => void;
  /** Callback when matches change (for highlighting) */
  onMatchesChange: (matches: SearchMatch[], currentIndex: number) => void;
  /** Callback to navigate to a page */
  onNavigateToPage: (page: number) => void;
}

export function FindBar({ visible, onClose, onMatchesChange, onNavigateToPage }: FindBarProps) {
  const document = useDocumentStore((s) => s.document);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [visible]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim() || !document) {
      setMatches([]);
      setCurrentIndex(0);
      onMatchesChange([], 0);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await api.searchText(document.sessionId, query);
        setMatches(resp.matches);
        setCurrentIndex(resp.matches.length > 0 ? 0 : -1);
        onMatchesChange(resp.matches, 0);

        // Navigate to the first match's page
        if (resp.matches.length > 0) {
          onNavigateToPage(resp.matches[0].page);
        }
      } catch {
        setMatches([]);
        setCurrentIndex(-1);
        onMatchesChange([], -1);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, document, onMatchesChange, onNavigateToPage]);

  const goToMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return;
      const wrapped = ((index % matches.length) + matches.length) % matches.length;
      setCurrentIndex(wrapped);
      onMatchesChange(matches, wrapped);
      onNavigateToPage(matches[wrapped].page);
    },
    [matches, onMatchesChange, onNavigateToPage],
  );

  const handleNext = useCallback(() => {
    goToMatch(currentIndex + 1);
  }, [currentIndex, goToMatch]);

  const handlePrev = useCallback(() => {
    goToMatch(currentIndex - 1);
  }, [currentIndex, goToMatch]);

  const handleClose = useCallback(() => {
    setQuery('');
    setMatches([]);
    setCurrentIndex(0);
    onMatchesChange([], 0);
    onClose();
  }, [onClose, onMatchesChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          handlePrev();
        } else {
          handleNext();
        }
      } else if (e.key === 'Escape') {
        handleClose();
      }
    },
    [handleNext, handlePrev, handleClose],
  );

  if (!visible) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.inputGroup}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder="Find in document..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {searching && <span className={styles.spinner} />}
      </div>

      {/* Match count */}
      <span className={styles.count}>
        {query.trim()
          ? matches.length > 0
            ? `${currentIndex + 1} of ${matches.length}`
            : 'No matches'
          : ''}
      </span>

      {/* Navigation */}
      <button
        className={styles.navBtn}
        onClick={handlePrev}
        disabled={matches.length === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        &#x25B2;
      </button>
      <button
        className={styles.navBtn}
        onClick={handleNext}
        disabled={matches.length === 0}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        &#x25BC;
      </button>

      {/* Close */}
      <button
        className={styles.closeBtn}
        onClick={handleClose}
        title="Close (Escape)"
        aria-label="Close find bar"
      >
        &times;
      </button>
    </div>
  );
}
