/**
 * Mudbrick v2 -- Redaction Panel
 *
 * Pattern selector with checkboxes for built-in patterns (SSN, email, phone, etc.),
 * custom regex input, and search button. Shows results count.
 */

import { useState, useCallback, useEffect } from 'react';
import { api } from '../../services/api';
import { useDocumentStore } from '../../stores/documentStore';
import { useUIStore } from '../../stores/uiStore';
import type { RedactionMatch, RedactionPattern } from '../../types/api';
import styles from './RedactionPanel.module.css';

interface RedactionPanelProps {
  /** Callback when search completes with matches */
  onSearchComplete: (matches: RedactionMatch[]) => void;
  /** Callback when redaction is applied */
  onRedactionApplied: () => void;
}

export function RedactionPanel({ onSearchComplete, onRedactionApplied }: RedactionPanelProps) {
  const document = useDocumentStore((s) => s.document);
  const addToast = useUIStore((s) => s.addToast);

  const [patterns, setPatterns] = useState<RedactionPattern[]>([]);
  const [selectedPatterns, setSelectedPatterns] = useState<Set<string>>(new Set());
  const [customRegex, setCustomRegex] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<RedactionMatch[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Load available patterns on mount
  useEffect(() => {
    api.getRedactionPatterns().then(setPatterns).catch(() => {
      // Use fallback patterns if API fails
      setPatterns([
        { name: 'ssn', label: 'Social Security Numbers', description: 'XXX-XX-XXXX format' },
        { name: 'credit_card', label: 'Credit Card Numbers', description: 'Visa, Mastercard, Amex, Discover' },
        { name: 'email', label: 'Email Addresses', description: 'user@domain.com' },
        { name: 'phone', label: 'Phone Numbers', description: 'US formats' },
        { name: 'date', label: 'Dates', description: 'MM/DD/YYYY, Month DD, YYYY' },
      ]);
    });
  }, []);

  const togglePattern = useCallback((name: string) => {
    setSelectedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleSearch = useCallback(async () => {
    if (!document) return;

    const patternList = Array.from(selectedPatterns);
    if (customRegex.trim()) {
      patternList.push('custom');
    }

    if (patternList.length === 0) {
      addToast({ type: 'warning', message: 'Select at least one pattern to search' });
      return;
    }

    setSearching(true);
    try {
      const resp = await api.searchRedactionPatterns(
        document.sessionId,
        patternList,
        customRegex.trim() || undefined,
      );
      setMatches(resp.matches);
      setHasSearched(true);
      onSearchComplete(resp.matches);

      if (resp.total === 0) {
        addToast({ type: 'info', message: 'No matches found' });
      } else {
        addToast({
          type: 'success',
          message: `Found ${resp.total} match${resp.total !== 1 ? 'es' : ''} across ${resp.pages_searched} page${resp.pages_searched !== 1 ? 's' : ''}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      addToast({ type: 'error', message: msg });
    } finally {
      setSearching(false);
    }
  }, [document, selectedPatterns, customRegex, addToast, onSearchComplete]);

  const handleClear = useCallback(() => {
    setMatches([]);
    setHasSearched(false);
    setSelectedPatterns(new Set());
    setCustomRegex('');
    onSearchComplete([]);
  }, [onSearchComplete]);

  const canSearch = selectedPatterns.size > 0 || customRegex.trim().length > 0;

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Redaction Search</h3>
      <p className={styles.subtitle}>
        Find and redact sensitive data patterns in the document.
      </p>

      {/* Pattern Checkboxes */}
      <div className={styles.patterns}>
        {patterns.map((pattern) => (
          <label key={pattern.name} className={styles.patternItem}>
            <input
              type="checkbox"
              checked={selectedPatterns.has(pattern.name)}
              onChange={() => togglePattern(pattern.name)}
              disabled={searching}
            />
            <div className={styles.patternInfo}>
              <span className={styles.patternLabel}>{pattern.label}</span>
              <span className={styles.patternDesc}>{pattern.description}</span>
            </div>
          </label>
        ))}
      </div>

      {/* Custom Regex */}
      <div className={styles.customField}>
        <label className={styles.customLabel} htmlFor="custom-regex">
          Custom Pattern (regex)
        </label>
        <input
          id="custom-regex"
          className={styles.customInput}
          type="text"
          placeholder="e.g., Case\s*#?\d{4,}"
          value={customRegex}
          onChange={(e) => setCustomRegex(e.target.value)}
          disabled={searching}
        />
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          className={styles.searchBtn}
          onClick={handleSearch}
          disabled={!canSearch || searching}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
        {hasSearched && (
          <button className={styles.clearBtn} onClick={handleClear}>
            Clear
          </button>
        )}
      </div>

      {/* Results Summary */}
      {hasSearched && (
        <div className={styles.summary}>
          <span className={styles.summaryCount}>
            {matches.length} match{matches.length !== 1 ? 'es' : ''} found
          </span>
          {matches.length > 0 && (
            <span className={styles.summaryPages}>
              across {new Set(matches.map((m) => m.page)).size} page(s)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
