/**
 * Mudbrick — Find Text (Phase 2)
 * Text search across all pages using PDF.js getTextContent().
 * Highlights matches with <mark> elements in the text layer.
 */

/* ── State ── */

let textIndex = null;       // sparse array: textIndex[pageNum] = {pageNum, text, items} | null
let _indexedDoc = null;     // pdfDoc reference so we can index on-demand
let _indexTotal = 0;        // total pages in current document
let _indexCancelled = false; // set to true when a new doc loads mid-index
let _indexProgressCb = null; // optional callback(indexedCount, totalPages)

let matches = [];         // [{pageNum, itemIndex, startOffset, endOffset, rects}]
let currentMatchIdx = -1;
let caseSensitive = false;
let query = '';
let isOpen = false;

/* ── Public API ── */

/**
 * Prepare the index for a new document.
 * Does NOT index pages eagerly — pages are indexed on-demand when searched.
 * Call once after opening a PDF (replaces the old eager buildTextIndex).
 * @param {PDFDocumentProxy} pdfDoc — PDF.js document
 * @param {function} [onProgress] — optional callback(indexedCount, totalPages)
 */
export async function buildTextIndex(pdfDoc, onProgress) {
  // Cancel any background indexing from the previous document
  _indexCancelled = true;

  textIndex = new Array(pdfDoc.numPages + 1).fill(null); // 1-based, slot 0 unused
  _indexedDoc = pdfDoc;
  _indexTotal = pdfDoc.numPages;
  _indexCancelled = false;
  _indexProgressCb = onProgress || null;
  matches = [];
  currentMatchIdx = -1;
  query = '';
  // Individual pages are indexed lazily inside ensurePageIndexed()
}

/**
 * Ensure a single page is indexed.  Called just-in-time before searching.
 * Safe to call multiple times — returns immediately if already indexed.
 * @param {number} pageNum — 1-based page number
 */
async function ensurePageIndexed(pageNum) {
  if (!textIndex || textIndex[pageNum]) return; // already done
  if (!_indexedDoc) return;
  try {
    const page = await _indexedDoc.getPage(pageNum);
    const content = await page.getTextContent();
    let fullText = '';
    const items = content.items.map(item => {
      const start = fullText.length;
      fullText += item.str;
      return { str: item.str, start, transform: item.transform, width: item.width, height: item.height };
    });
    if (!_indexCancelled && textIndex) {
      textIndex[pageNum] = { pageNum, text: fullText, items };
    }
  } catch (_) { /* page unavailable — leave as null */ }
}

/** Reset index (on doc close) */
export function clearTextIndex() {
  _indexCancelled = true;
  textIndex = null;
  _indexedDoc = null;
  _indexTotal = 0;
  _indexProgressCb = null;
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
    const pn = entry.pageNum;
    if (pn < 1 || pn >= textIndex.length) continue;
    const existing = textIndex[pn];
    if (!existing) {
      // Page not yet indexed — store OCR result directly
      textIndex[pn] = entry;
    } else if (existing.text.trim().length < 20) {
      // Native text is sparse — prefer OCR result
      textIndex[pn] = entry;
    }
  }
}

/**
 * Search for text across all pages, indexing them on-demand as needed.
 * Shows progress via the optional onProgress callback.
 * Returns a Promise so callers can await the full scan.
 * @param {string} searchQuery
 * @param {boolean} [matchCase=false]
 * @param {function} [onProgress] — called as (indexedCount, totalPages) during indexing
 * @returns {Promise<{matches: Array, total: number}>}
 */
export async function searchText(searchQuery, matchCase = false, onProgress) {
  if (!textIndex || !searchQuery) {
    matches = [];
    currentMatchIdx = -1;
    return { matches: [], total: 0 };
  }

  query = searchQuery;
  caseSensitive = matchCase;
  matches = [];

  const q = matchCase ? searchQuery : searchQuery.toLowerCase();
  let indexedSoFar = 0;

  for (let pageNum = 1; pageNum <= _indexTotal; pageNum++) {
    if (_indexCancelled) break; // new doc loaded — abort

    // Index this page on-demand if not already done
    if (!textIndex[pageNum]) {
      await ensurePageIndexed(pageNum);
      indexedSoFar++;
      const progressFn = onProgress || _indexProgressCb;
      if (progressFn) progressFn(indexedSoFar, _indexTotal);
    }

    const page = textIndex[pageNum];
    if (!page) continue; // indexing failed for this page — skip

    const haystack = matchCase ? page.text : page.text.toLowerCase();
    let pos = 0;

    while ((pos = haystack.indexOf(q, pos)) !== -1) {
      const matchEnd = pos + q.length;

      // Find which items overlap this match
      const rects = [];
      for (const item of page.items) {
        const itemEnd = item.start + item.str.length;
        if (itemEnd <= pos) continue;
        if (item.start >= matchEnd) break;

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
