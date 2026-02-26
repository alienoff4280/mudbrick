/**
 * Mudbrick — Find Text (Phase 2)
 * Text search across all pages using PDF.js getTextContent().
 * Highlights matches with <mark> elements in the text layer.
 */

/* ── State ── */

let textIndex = null;     // [{pageNum, text, items}]
let matches = [];         // [{pageNum, itemIndex, startOffset, endOffset, rects}]
let currentMatchIdx = -1;
let caseSensitive = false;
let query = '';
let isOpen = false;

/* ── Public API ── */

/**
 * Build a full-text index of the document.
 * Call once after opening a PDF.
 * @param {PDFDocumentProxy} pdfDoc — PDF.js document
 */
export async function buildTextIndex(pdfDoc) {
  textIndex = [];
  const numPages = pdfDoc.numPages;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    // Build full page text from items
    let fullText = '';
    const items = content.items.map(item => {
      const start = fullText.length;
      fullText += item.str;
      return { str: item.str, start, transform: item.transform, width: item.width, height: item.height };
    });
    textIndex.push({ pageNum: i, text: fullText, items });
  }
}

/** Reset index (on doc close) */
export function clearTextIndex() {
  textIndex = null;
  matches = [];
  currentMatchIdx = -1;
  query = '';
}

/**
 * Augment the text index with OCR results.
 * For pages where native text is sparse but OCR text is available,
 * replaces the index entry with OCR data so Find can search it.
 * @param {Array<{pageNum, text, items}>} ocrEntries — from ocr.js getOCRTextEntries()
 */
export function augmentTextIndex(ocrEntries) {
  if (!textIndex) return;

  for (const entry of ocrEntries) {
    // Find existing entry for this page
    const idx = textIndex.findIndex(e => e.pageNum === entry.pageNum);
    if (idx >= 0) {
      // Only replace if native text is sparse (< 20 chars)
      if (textIndex[idx].text.trim().length < 20) {
        textIndex[idx] = entry;
      }
    } else {
      // Page not indexed — shouldn't happen, but add it
      textIndex.push(entry);
      textIndex.sort((a, b) => a.pageNum - b.pageNum);
    }
  }
}

/**
 * Search for text across all indexed pages.
 * @param {string} searchQuery
 * @param {boolean} [matchCase=false]
 * @returns {{matches: Array, total: number}}
 */
export function searchText(searchQuery, matchCase = false) {
  if (!textIndex || !searchQuery) {
    matches = [];
    currentMatchIdx = -1;
    return { matches: [], total: 0 };
  }

  query = searchQuery;
  caseSensitive = matchCase;
  matches = [];

  const q = matchCase ? searchQuery : searchQuery.toLowerCase();

  for (const page of textIndex) {
    const haystack = matchCase ? page.text : page.text.toLowerCase();
    let pos = 0;

    while ((pos = haystack.indexOf(q, pos)) !== -1) {
      // Map the match offset back to text items
      const matchEnd = pos + q.length;

      // Find which items overlap this match
      const rects = [];
      for (const item of page.items) {
        const itemEnd = item.start + item.str.length;
        if (itemEnd <= pos) continue;
        if (item.start >= matchEnd) break;

        // This item overlaps with the match
        rects.push({
          itemStart: item.start,
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
        });
      }

      matches.push({
        pageNum: page.pageNum,
        startOffset: pos,
        endOffset: matchEnd,
        rects,
      });

      pos += 1; // move forward to find overlapping matches
    }
  }

  currentMatchIdx = matches.length > 0 ? 0 : -1;
  return { matches, total: matches.length };
}

/**
 * Navigate to next match.
 * @returns {{pageNum: number, matchIndex: number}|null}
 */
export function findNext() {
  if (matches.length === 0) return null;
  currentMatchIdx = (currentMatchIdx + 1) % matches.length;
  return { pageNum: matches[currentMatchIdx].pageNum, matchIndex: currentMatchIdx };
}

/**
 * Navigate to previous match.
 * @returns {{pageNum: number, matchIndex: number}|null}
 */
export function findPrevious() {
  if (matches.length === 0) return null;
  currentMatchIdx = (currentMatchIdx - 1 + matches.length) % matches.length;
  return { pageNum: matches[currentMatchIdx].pageNum, matchIndex: currentMatchIdx };
}

/**
 * Get current match info.
 * @returns {{current: number, total: number, pageNum: number|null}}
 */
export function getMatchInfo() {
  return {
    current: currentMatchIdx >= 0 ? currentMatchIdx + 1 : 0,
    total: matches.length,
    pageNum: currentMatchIdx >= 0 ? matches[currentMatchIdx].pageNum : null,
  };
}

/**
 * Render highlight marks for the current page in the text layer.
 * @param {number} pageNum — current page number (1-based)
 * @param {HTMLElement} textLayerEl — the #text-layer element
 * @param {object} viewport — PDF.js viewport for coordinate mapping
 */
export function renderHighlights(pageNum, textLayerEl, viewport) {
  // Remove existing highlights
  textLayerEl.querySelectorAll('.find-highlight').forEach(el => el.remove());

  if (!matches.length || !viewport) return;

  const pageMatches = matches.filter(m => m.pageNum === pageNum);
  if (!pageMatches.length) return;

  for (let i = 0; i < pageMatches.length; i++) {
    const match = pageMatches[i];
    const globalIdx = matches.indexOf(match);
    const isActive = globalIdx === currentMatchIdx;

    for (const rect of match.rects) {
      // OCR items use top-left coordinates directly (no PDF.js transform needed)
      if (rect._ocr) {
        const scale = viewport.scale;
        const itemLen = rect.str.length;
        const charWidth = itemLen > 0 ? rect.width / itemLen : rect.width;
        const clipStart = Math.max(0, match.startOffset - rect.itemStart);
        const clipEnd = Math.min(itemLen, match.endOffset - rect.itemStart);
        const matchChars = clipEnd - clipStart;

        const mark = document.createElement('mark');
        mark.className = 'find-highlight' + (isActive ? ' find-highlight-active' : '');
        mark.style.position = 'absolute';
        mark.style.left = (rect.transform[4] + clipStart * charWidth) * scale + 'px';
        mark.style.top = rect.transform[5] * scale + 'px';
        mark.style.width = matchChars * charWidth * scale + 'px';
        mark.style.height = rect.height * scale + 'px';
        mark.style.pointerEvents = 'none';

        if (isActive) mark.id = 'find-active-mark';
        textLayerEl.appendChild(mark);
        continue;
      }

      // Use PDF.js transform to compute screen position
      const tx = window.pdfjsLib
        ? window.pdfjsLib.Util.transform(viewport.transform, rect.transform)
        : null;

      if (!tx) continue;

      // Calculate sub-item offset for precise character-level highlighting
      const itemLen = rect.str.length;
      const charWidth = itemLen > 0 ? rect.width / itemLen : rect.width;

      // How many chars into this item does the match start?
      const clipStart = Math.max(0, match.startOffset - rect.itemStart);
      // How many chars from this item are part of the match?
      const clipEnd = Math.min(itemLen, match.endOffset - rect.itemStart);
      const matchChars = clipEnd - clipStart;

      const xOffset = clipStart * charWidth;
      const matchWidth = matchChars * charWidth;

      const mark = document.createElement('mark');
      mark.className = 'find-highlight' + (isActive ? ' find-highlight-active' : '');
      mark.style.position = 'absolute';
      mark.style.left = (tx[4] + xOffset * viewport.scale) + 'px';
      mark.style.top = (tx[5] - Math.abs(tx[3])) + 'px';
      mark.style.width = (matchWidth * viewport.scale) + 'px';
      mark.style.height = Math.abs(tx[3]) + 'px';
      mark.style.pointerEvents = 'none';

      if (isActive) {
        mark.id = 'find-active-mark';
      }

      textLayerEl.appendChild(mark);
    }
  }
}

/** Scroll the active highlight into view */
export function scrollToActiveHighlight() {
  const el = document.getElementById('find-active-mark');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

/** Check if find bar is open */
export function isFindOpen() {
  return isOpen;
}

export function setFindOpen(val) {
  isOpen = val;
}

/** Get current query for re-rendering after page change */
export function getCurrentQuery() {
  return query;
}

export function hasMatches() {
  return matches.length > 0;
}

/**
 * Get replacement info for the current match.
 * Returns the match details including PDF text item rects/transforms
 * needed to apply a cover-and-replace to the actual PDF.
 * @returns {{pageNum, rects, matchText}|null}
 */
export function getCurrentMatchInfo() {
  if (currentMatchIdx < 0 || currentMatchIdx >= matches.length) return null;
  const m = matches[currentMatchIdx];
  const page = textIndex ? textIndex.find(p => p.pageNum === m.pageNum) : null;
  const matchText = page ? page.text.slice(m.startOffset, m.endOffset) : '';
  return {
    pageNum: m.pageNum,
    startOffset: m.startOffset,
    endOffset: m.endOffset,
    rects: m.rects,
    matchText,
  };
}

/**
 * Collect replacement info for all current matches.
 * @returns {Array<{pageNum, rects, matchText, startOffset, endOffset}>}
 */
export function getAllMatchInfos() {
  if (!matches.length || !textIndex) return [];
  return matches.map(m => {
    const page = textIndex.find(p => p.pageNum === m.pageNum);
    const matchText = page ? page.text.slice(m.startOffset, m.endOffset) : '';
    return {
      pageNum: m.pageNum,
      startOffset: m.startOffset,
      endOffset: m.endOffset,
      rects: m.rects,
      matchText,
    };
  });
}

/**
 * Remove the current match from the results and advance.
 * Called after a single replacement has been applied to the PDF.
 */
export function removeCurrentMatch() {
  if (currentMatchIdx < 0 || currentMatchIdx >= matches.length) return;
  matches.splice(currentMatchIdx, 1);
  if (matches.length === 0) {
    currentMatchIdx = -1;
  } else if (currentMatchIdx >= matches.length) {
    currentMatchIdx = 0;
  }
}

/**
 * Clear all matches (called after replace-all has been applied to the PDF).
 */
export function clearMatches() {
  matches = [];
  currentMatchIdx = -1;
}
