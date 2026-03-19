/**
 * Mudbrick v2 -- Search Highlights
 *
 * Renders yellow highlight rectangles overlaid on matching text regions
 * in the PDF viewer. The current match is highlighted in orange.
 */

import type { SearchMatch } from '../../types/api';
import styles from './SearchHighlights.module.css';

interface SearchHighlightsProps {
  /** All search matches */
  matches: SearchMatch[];
  /** Index of the currently active match */
  currentIndex: number;
  /** Current page being viewed (1-indexed) */
  currentPage: number;
  /** Scale factor: CSS pixels per PDF point */
  scale: number;
}

export function SearchHighlights({
  matches,
  currentIndex,
  currentPage,
  scale,
}: SearchHighlightsProps) {
  // Filter matches for the current page
  const pageMatches = matches.filter((m) => m.page === currentPage);

  if (pageMatches.length === 0) return null;

  // Find the global match that corresponds to the current index
  const currentMatch = currentIndex >= 0 && currentIndex < matches.length
    ? matches[currentIndex]
    : null;

  return (
    <div className={styles.container}>
      {pageMatches.map((match, matchIdx) => {
        const isCurrentMatch = currentMatch &&
          match.page === currentMatch.page &&
          match.text === currentMatch.text &&
          JSON.stringify(match.rects) === JSON.stringify(currentMatch.rects);

        return match.rects.map((rect, rectIdx) => (
          <div
            key={`${matchIdx}-${rectIdx}`}
            className={`${styles.highlight} ${isCurrentMatch ? styles.current : ''}`}
            style={{
              left: `${rect.x * scale}px`,
              top: `${rect.y * scale}px`,
              width: `${rect.width * scale}px`,
              height: `${rect.height * scale}px`,
            }}
          />
        ));
      })}
    </div>
  );
}
