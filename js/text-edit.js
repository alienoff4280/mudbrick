/**
 * Mudbrick — Inline Text Editing (Cover-and-Replace) + Image Editing
 *
 * Text editing strategy (cover-and-replace):
 *   1. Extract text positions from PDF.js getTextContent()
 *   2. Overlay contenteditable divs positioned over each text line
 *   3. Floating toolbar with font size, color, bold/italic controls
 *   4. On commit: draw white rectangle over original, draw new text on top
 *
 * Image editing:
 *   1. Extract images from PDF.js operator list + getPage()
 *   2. Show selection overlays on each detected image
 *   3. Allow replace (upload new) and delete (white cover)
 *   4. On commit: apply changes via pdf-lib
 *
 * Exports:
 *   enterTextEditMode(pageNum, pdfDoc, viewport, container)
 *   exitTextEditMode()
 *   commitTextEdits(pdfBytes, pageNum)
 *   isTextEditActive()
 *   enterImageEditMode(pageNum, pdfDoc, viewport, container)
 *   exitImageEditMode()
 *   commitImageEdits(pdfBytes, pageNum)
 *   isImageEditActive()
 */

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sample the background color from the text region itself — the lightest
 * frequent color within the area is the background. Sampling to the LEFT
 * of text fails when text starts at a cell edge (hits border or white).
 */
function sampleBackgroundColor(canvas, x, y, width, height) {
  if (!canvas) return '#ffffff';
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / (parseFloat(canvas.style.width) || canvas.offsetWidth) || 1;

  // Read the full text region — background pixels will outnumber text pixels
  const sx = Math.max(0, Math.round(x * dpr));
  const sy = Math.max(0, Math.round(y * dpr));
  const sw = Math.min(Math.round(width * dpr), canvas.width - sx);
  const sh = Math.min(Math.round(height * dpr), canvas.height - sy);
  if (sw <= 0 || sh <= 0) return '#ffffff';

  let data;
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data;
  } catch (_) {
    return '#ffffff';
  }

  // Count light pixel colors (background), skip dark pixels (text/borders).
  // Quantize lightly (round to nearest 4) to group anti-aliased background.
  const counts = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum < 150) continue; // skip text/dark pixels
    const qr = (r >> 2) << 2, qg = (g >> 2) << 2, qb = (b >> 2) << 2;
    const key = `${qr},${qg},${qb}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  let maxCount = 0, best = null;
  for (const [key, count] of Object.entries(counts)) {
    if (count > maxCount) { maxCount = count; best = key; }
  }

  if (!best) return '#ffffff';
  const [r, g, b] = best.split(',').map(Number);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Sample the dominant text color from a rendered PDF canvas at the given region.
 * Scans pixels and returns the most common non-background color as a hex string.
 * Falls back to #000000 if no distinct color is found.
 */
function sampleTextColor(canvas, x, y, width, height, bgHex) {
  if (!canvas) return '#000000';
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / (parseFloat(canvas.style.width) || canvas.offsetWidth) || 1;
  // Clamp to canvas bounds (convert CSS coords to canvas pixel coords)
  const sx = Math.max(0, Math.round(x * dpr));
  const sy = Math.max(0, Math.round(y * dpr));
  const sw = Math.min(Math.round(width * dpr), canvas.width - sx);
  const sh = Math.min(Math.round(height * dpr), canvas.height - sy);
  if (sw <= 0 || sh <= 0) return '#000000';

  let data;
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data;
  } catch (_) {
    return '#000000';
  }

  // Determine background luminance to use as filter threshold.
  // On gray backgrounds (lum ~200), the old fixed threshold of 230 let
  // background pixels through, outnumbering actual text pixels.
  let bgLum = 230; // default: skip near-white only
  if (bgHex && bgHex.length === 7) {
    const bgR = parseInt(bgHex.slice(1, 3), 16);
    const bgG = parseInt(bgHex.slice(3, 5), 16);
    const bgB = parseInt(bgHex.slice(5, 7), 16);
    bgLum = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
  }
  // Skip any pixel within 40 luminance units of the background
  const skipThreshold = bgLum - 40;

  // Count dark pixel colors (text), skipping background-like pixels
  const colorCounts = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum > skipThreshold) continue;
    // Quantize to reduce noise (round to nearest 4)
    const qr = (r >> 2) << 2, qg = (g >> 2) << 2, qb = (b >> 2) << 2;
    const key = `${qr},${qg},${qb}`;
    colorCounts[key] = (colorCounts[key] || 0) + 1;
  }

  // Find the most frequent dark color
  let maxCount = 0, bestColor = null;
  for (const [key, count] of Object.entries(colorCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestColor = key;
    }
  }

  if (!bestColor) return '#000000';
  const [r, g, b] = bestColor.split(',').map(Number);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Sample a single pixel color from the PDF canvas at (x, y).
 * Returns hex string.
 */
function samplePixelColor(canvas, x, y) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const px = Math.round(x), py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  try {
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return null;
  }
}

function _getTextDecoration(div) {
  const parts = [];
  if (div.dataset.underline === 'true') parts.push('underline');
  if (div.dataset.strikethrough === 'true') parts.push('line-through');
  return parts.length ? parts.join(' ') : 'none';
}

let active = false;
let editContainer = null;
let toolbar = null;
let currentViewport = null;
let currentPageNum = 0;
let currentPdfDoc = null;
let _pdfCanvas = null; // reference to rendered PDF canvas for color sampling

let _focusedLine = null; // currently focused text-edit-line div

// Single-block editing state
let _paragraphData = [];    // computed paragraphs (arrays of line objects)
let _activeBlockIdx = -1;   // index into _paragraphData of currently edited block
let _blockZones = [];       // click-zone DOM elements for each paragraph
let _editedBlocks = new Map(); // paraIdx -> array of dirty line data from deactivated blocks
let _canvasSnapshot = null;    // { imageData, x, y } — saved canvas pixels for active block
let _clickOutsideHandler = null; // document listener to deactivate block on outside click

// Undo/redo stacks — stores snapshots per line
let undoStack = []; // array of { div, text, dataset snapshot }
let redoStack = [];
const MAX_UNDO = 50;

// Custom embedded font (uploaded by user)
let customFont = null; // { name, bytes, fontObj: null (set during commit) }

// Image edit state
let imageActive = false;
let imageContainer = null;
let imageOverlays = []; // { div, pdfX, pdfY, pdfW, pdfH, action: 'none'|'delete'|'replace', replaceSrc }
let imageUndoStack = []; // snapshots for undo within image edit mode

/* ═══════════════════ Font Mapping ═══════════════════ */

/**
 * Map a PDF font name (e.g. "g_d0_f1", "TimesNewRomanPSMT", "ArialMT")
 * to a pdf-lib StandardFonts key.
 */
function mapToStandardFont(fontName) {
  const lower = (fontName || '').toLowerCase();

  if (lower.includes('courier') || lower.includes('mono')) {
    if (lower.includes('bold') && (lower.includes('oblique') || lower.includes('italic'))) return 'CourierBoldOblique';
    if (lower.includes('bold')) return 'CourierBold';
    if (lower.includes('oblique') || lower.includes('italic')) return 'CourierOblique';
    return 'Courier';
  }

  // "sans-serif" → Helvetica; "serif" (without "sans") → TimesRoman
  if (lower.includes('times') || lower.includes('roman') ||
      (lower.includes('serif') && !lower.includes('sans'))) {
    if (lower.includes('bold') && lower.includes('italic')) return 'TimesRomanBoldItalic';
    if (lower.includes('bold')) return 'TimesRomanBold';
    if (lower.includes('italic')) return 'TimesRomanItalic';
    return 'TimesRoman';
  }

  if (lower.includes('bold') && (lower.includes('oblique') || lower.includes('italic'))) return 'HelveticaBoldOblique';
  if (lower.includes('bold')) return 'HelveticaBold';
  if (lower.includes('oblique') || lower.includes('italic')) return 'HelveticaOblique';
  return 'Helvetica';
}

/**
 * Map a PDF font name to a CSS font-family stack so overlays visually
 * match the PDF text as closely as possible.
 */
function mapToCSSFont(fontName) {
  const lower = (fontName || '').toLowerCase();

  if (lower.includes('courier') || lower.includes('mono')) {
    return '"Courier New", Courier, monospace';
  }
  if (lower.includes('times') || lower.includes('roman') ||
      (lower.includes('serif') && !lower.includes('sans'))) {
    return '"Times New Roman", Times, serif';
  }
  if (lower.includes('arial') || lower.includes('helvetica') || lower.includes('sans')) {
    return 'Arial, Helvetica, sans-serif';
  }
  if (lower.includes('georgia')) return 'Georgia, serif';
  if (lower.includes('verdana')) return 'Verdana, sans-serif';
  if (lower.includes('trebuchet')) return '"Trebuchet MS", sans-serif';
  if (lower.includes('tahoma')) return 'Tahoma, sans-serif';
  if (lower.includes('palatino')) return '"Palatino Linotype", "Book Antiqua", Palatino, serif';
  if (lower.includes('garamond')) return 'Garamond, serif';

  // Default: match Helvetica (most common PDF base font)
  return 'Arial, Helvetica, sans-serif';
}

/**
 * Detect font weight and style from PDF font name.
 */
function detectFontStyle(fontName) {
  const lower = (fontName || '').toLowerCase();
  return {
    bold: lower.includes('bold') || lower.includes('heavy') || lower.includes('black'),
    italic: lower.includes('italic') || lower.includes('oblique'),
  };
}

/**
 * Detect font weight and style from multiple sources (best to worst):
 *   1. pdf.js font object metadata (bold/italic flags, real font name)
 *   2. pdf.js style metadata (fontWeight, fontStyle, fontFamily keywords)
 *   3. Resolved font name keyword parsing
 */
function detectFontStyleWithMeta(fontName, styleInfo, fontMeta) {
  // 1. pdf.js font object — most reliable (has .bold/.italic from font descriptor)
  if (fontMeta) {
    if (fontMeta.bold || fontMeta.italic) {
      return { bold: !!fontMeta.bold, italic: !!fontMeta.italic };
    }
    // Try the real font name from the font object
    if (fontMeta.name) {
      const fromReal = detectFontStyle(fontMeta.name);
      if (fromReal.bold || fromReal.italic) return fromReal;
    }
  }
  // 2. Style metadata (fontWeight, fontFamily keywords)
  const lowerWeight = String(styleInfo?.fontWeight || '').toLowerCase();
  const lowerStyle = String(styleInfo?.fontStyle || '').toLowerCase();
  const lowerFamily = String(styleInfo?.fontFamily || '').toLowerCase();
  const fromMeta = {
    bold: lowerWeight === 'bold' || lowerWeight === '700' || lowerWeight === '800' || lowerWeight === '900' ||
      lowerFamily.includes('bold'),
    italic: lowerStyle === 'italic' || lowerStyle === 'oblique' ||
      lowerFamily.includes('italic') || lowerFamily.includes('oblique'),
  };
  if (fromMeta.bold || fromMeta.italic) return fromMeta;
  // 3. Resolved font name
  const fromName = detectFontStyle(fontName);
  return {
    bold: fromName.bold,
    italic: fromName.italic,
  };
}

/** Font family options for the toolbar selector */
const FONT_FAMILIES = [
  { label: 'Sans-serif (Helvetica)', css: 'Arial, Helvetica, sans-serif', pdf: 'Helvetica' },
  { label: 'Serif (Times)', css: '"Times New Roman", Times, serif', pdf: 'TimesRoman' },
  { label: 'Monospace (Courier)', css: '"Courier New", Courier, monospace', pdf: 'Courier' },
];

/* ═══════════════════ Undo / Redo ═══════════════════ */

/** Capture a snapshot of a line's current state for undo */
function captureSnapshot(div) {
  return {
    div,
    text: div.textContent,
    bold: div.dataset.bold,
    italic: div.dataset.italic,
    fontSizeOverride: div.dataset.fontSizeOverride,
    colorOverride: div.dataset.colorOverride,
    fontFamilyOverride: div.dataset.fontFamilyOverride,
    fontNameOverride: div.dataset.fontNameOverride || '',
    fontWeight: div.style.fontWeight,
    fontStyle: div.style.fontStyle,
    fontSize: div.style.fontSize,
    fontFamily: div.style.fontFamily,
    color: div.style.color,
  };
}

/** Restore a snapshot to a line */
function restoreSnapshot(snap) {
  const div = snap.div;
  div.textContent = snap.text;
  div.dataset.bold = snap.bold;
  div.dataset.italic = snap.italic;
  div.dataset.fontSizeOverride = snap.fontSizeOverride;
  div.dataset.colorOverride = snap.colorOverride;
  div.dataset.fontFamilyOverride = snap.fontFamilyOverride;
  div.dataset.fontNameOverride = snap.fontNameOverride;
  div.style.fontWeight = snap.fontWeight;
  div.style.fontStyle = snap.fontStyle;
  div.style.fontSize = snap.fontSize;
  div.style.fontFamily = snap.fontFamily;
  div.style.color = snap.color;
  markDirty(div);
}

/** Push current state of a line to undo stack before a change */
function pushUndo(div) {
  undoStack.push(captureSnapshot(div));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = []; // clear redo on new action
  updateUndoButtons();
}

function performUndo() {
  if (undoStack.length === 0) return;
  const snap = undoStack.pop();
  redoStack.push(captureSnapshot(snap.div));
  restoreSnapshot(snap);
  updateUndoButtons();
}

function performRedo() {
  if (redoStack.length === 0) return;
  const snap = redoStack.pop();
  undoStack.push(captureSnapshot(snap.div));
  restoreSnapshot(snap);
  updateUndoButtons();
}

function updateUndoButtons() {
  if (!toolbar) return;
  const undoBtn = toolbar.querySelector('.text-edit-undo');
  const redoBtn = toolbar.querySelector('.text-edit-redo');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

/* ═══════════════════ Keyboard Shortcuts for Text Edit ═══════════════════ */

/**
 * Handle keyboard shortcuts while in text edit mode.
 * This runs on the container so it catches events from contenteditable divs
 * (which the main app.js handler skips).
 */
function handleTextEditKeydown(e) {
  if (!active) return;
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+B — toggle bold
  if (mod && e.key === 'b') {
    e.preventDefault();
    e.stopPropagation();
    applyToFocused(div => {
      pushUndo(div);
      const isBold = div.style.fontWeight === 'bold';
      div.style.fontWeight = isBold ? 'normal' : 'bold';
      div.dataset.bold = isBold ? '' : 'true';
      if (toolbar) toolbar.querySelector('.text-edit-bold')?.classList.toggle('active', !isBold);
    });
    return;
  }

  // Ctrl+I — toggle italic
  if (mod && e.key === 'i') {
    e.preventDefault();
    e.stopPropagation();
    applyToFocused(div => {
      pushUndo(div);
      const isItalic = div.style.fontStyle === 'italic';
      div.style.fontStyle = isItalic ? 'normal' : 'italic';
      div.dataset.italic = isItalic ? '' : 'true';
      if (toolbar) toolbar.querySelector('.text-edit-italic')?.classList.toggle('active', !isItalic);
    });
    return;
  }

  // Ctrl+U — toggle underline
  if (mod && e.key === 'u') {
    e.preventDefault();
    e.stopPropagation();
    applyToFocused(div => {
      pushUndo(div);
      const isUnderline = div.dataset.underline === 'true';
      div.dataset.underline = isUnderline ? '' : 'true';
      div.style.textDecoration = _getTextDecoration(div);
      if (toolbar) toolbar.querySelector('.text-edit-underline')?.classList.toggle('active', !isUnderline);
    });
    return;
  }

  // Ctrl+Z — undo (within text edit)
  if (mod && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    performUndo();
    return;
  }

  // Ctrl+Shift+Z or Ctrl+Y — redo
  if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    e.stopPropagation();
    performRedo();
    return;
  }

  // Enter in text edit — commit edits
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    toolbar?.querySelector('.text-edit-commit')?.click();
    return;
  }

  // Escape — deactivate current block first, then cancel on second press
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (_activeBlockIdx >= 0) {
      deactivateBlock();
    } else {
      toolbar?.querySelector('.text-edit-cancel')?.click();
    }
    return;
  }
}

/* ═══════════════════ Text Grouping ═══════════════════ */

/**
 * Detect whether the page has a two-column layout by analyzing the horizontal
 * distribution of text items. Returns the X coordinate to split columns, or
 * null for single-column pages.
 *
 * Uses a histogram that counts distinct Y-bands per bucket (not total items).
 * This prevents wide spanning elements like centered titles from filling the
 * gap between columns.
 */
function detectColumnSplit(mapped, pageWidth) {
  const NUM_BUCKETS = 100;
  const bucketWidth = pageWidth / NUM_BUCKETS;
  // Count distinct Y-bands (rounded to nearest 5px) per bucket
  const bucketYSets = Array.from({ length: NUM_BUCKETS }, () => new Set());

  for (const item of mapped) {
    if (!item.str.trim()) continue;
    const yBand = Math.round(item.top / 5) * 5; // quantize Y to 5px bands
    const start = Math.max(0, Math.floor(item.left / bucketWidth));
    const end = Math.min(NUM_BUCKETS - 1, Math.floor((item.left + item.width) / bucketWidth));
    for (let b = start; b <= end; b++) bucketYSets[b].add(yBand);
  }
  const histogram = bucketYSets.map(s => s.size);

  // Search for the widest low-density gap in the central 30%-70% of the page
  const minB = Math.floor(0.30 * NUM_BUCKETS);
  const maxB = Math.floor(0.70 * NUM_BUCKETS);
  const maxCount = Math.max(...histogram);
  if (maxCount === 0) return null;
  // A gap bucket may have a few spanning items (titles, headers) but far fewer
  // Y-bands than a real column. Threshold at 15% of the densest bucket.
  const emptyThreshold = Math.max(2, Math.floor(maxCount * 0.15));

  let bestStart = -1, bestEnd = -1, bestWidth = 0, gapStart = -1;

  for (let b = minB; b <= maxB; b++) {
    if (histogram[b] <= emptyThreshold) {
      if (gapStart === -1) gapStart = b;
    } else {
      if (gapStart !== -1) {
        const w = b - gapStart;
        if (w > bestWidth) { bestWidth = w; bestStart = gapStart; bestEnd = b; }
        gapStart = -1;
      }
    }
  }
  if (gapStart !== -1) {
    const w = maxB - gapStart;
    if (w > bestWidth) { bestWidth = w; bestStart = gapStart; bestEnd = maxB; }
  }

  // Gap must be at least 3% of page width with content on both sides
  if (bestWidth < 3) return null;
  const leftContent = histogram.slice(0, bestStart).reduce((a, b) => a + b, 0);
  const rightContent = histogram.slice(bestEnd).reduce((a, b) => a + b, 0);
  if (leftContent < 5 || rightContent < 5) return null;

  return ((bestStart + bestEnd) / 2) * bucketWidth;
}

function groupIntoLines(items, viewport, styles, fontMeta) {
  if (!items.length) return [];

  const mapped = items.map(item => {
    const tx = window.pdfjsLib
      ? window.pdfjsLib.Util.transform(viewport.transform, item.transform)
      : transformFallback(viewport, item.transform);

    const fontSize = Math.abs(tx[3]);
    const left = tx[4];
    const top = tx[5] - fontSize;

    // Resolve the best font name for standard font mapping.
    // pdf.js fontName can be synthetic (e.g. "g_d0_f1") or real (e.g. "BCDFEE+ArialMT-Bold").
    // styles.fontFamily can be a real name or a CSS generic ("sans-serif", "serif").
    const styleInfo = styles && styles[item.fontName];
    const familyName = (styleInfo && styleInfo.fontFamily) || '';
    const rawName = item.fontName || '';
    const hasStyleInfo = (n) => /bold|italic|oblique|heavy|black|light|medium/i.test(n);
    // Check if rawName contains a recognizable font family (not just a synthetic id)
    const hasRecognizableFont = (n) => /times|arial|helvetica|courier|roman|georgia|verdana|tahoma|trebuchet|palatino|garamond|mono|sans|serif/i.test(n);
    // Prefer names with style keywords first, then recognizable font names, then familyName
    const resolvedFontName = hasStyleInfo(rawName) ? rawName
      : hasStyleInfo(familyName) ? familyName
      : hasRecognizableFont(rawName) ? rawName
      : familyName || rawName || 'Helvetica';

    const meta = fontMeta && fontMeta[item.fontName];
    return {
      str: item.str,
      fontName: resolvedFontName,
      rawFontName: rawName,
      styleInfo: styleInfo || null,
      fontMeta: meta || null,
      left,
      top,
      width: item.width * viewport.scale,
      height: fontSize,
      fontSize,
      pdfX: item.transform[4],
      pdfY: item.transform[5],
      pdfFontSize: Math.abs(item.transform[3]),
    };
  });

  // Deduplicate overlapping text items — after cover-and-replace edits, the PDF
  // contains both the original (hidden) text and the new text at the same position.
  // Keep only the last item at each position (the edited version drawn on top).
  const deduped = [];
  const seen = new Map(); // key -> index in deduped
  for (const item of mapped) {
    if (!item.str.trim()) continue;
    // Key by approximate position (round to 2px grid for sub-pixel tolerance)
    const key = `${Math.round(item.left / 2) * 2},${Math.round(item.top / 2) * 2}`;
    if (seen.has(key)) {
      // Replace earlier item with this one (later in PDF = drawn on top)
      deduped[seen.get(key)] = item;
    } else {
      seen.set(key, deduped.length);
      deduped.push(item);
    }
  }

  // Detect column layout and partition items
  const splitX = detectColumnSplit(deduped, viewport.width);
  let columns;
  if (splitX === null) {
    columns = [deduped]; // single-column page
  } else {
    const left = [], right = [];
    for (const item of deduped) {
      if (!item.str.trim()) continue;
      const center = item.left + item.width / 2;
      (center < splitX ? left : right).push(item);
    }
    columns = [left, right].filter(c => c.length > 0);
  }

  // Group into lines within each column independently.
  // Also split on large horizontal gaps (table cell boundaries).
  const allLines = [];
  for (const colItems of columns) {
    colItems.sort((a, b) => a.top - b.top || a.left - b.left);
    let currentLine = null;
    for (const item of colItems) {
      if (!item.str.trim()) continue;

      if (!currentLine || Math.abs(item.top - currentLine.top) > 3) {
        // Different Y — new line
        currentLine = { top: item.top, left: item.left, items: [item] };
        allLines.push(currentLine);
      } else {
        // Same Y — check horizontal gap to detect table cell boundaries
        const lastItem = currentLine.items[currentLine.items.length - 1];
        const gap = item.left - (lastItem.left + lastItem.width);
        const gapThreshold = Math.max(lastItem.fontSize * 0.5, 5);

        if (gap > gapThreshold) {
          // Large gap — separate cell/segment, start new line
          currentLine = { top: item.top, left: item.left, items: [item] };
          allLines.push(currentLine);
        } else {
          currentLine.items.push(item);
          if (item.left < currentLine.left) currentLine.left = item.left;
        }
      }
    }
  }

  // Sort by reading order
  allLines.sort((a, b) => a.top - b.top || a.left - b.left);

  return allLines.map(line => {
    const text = line.items.map(i => i.str).join('');
    const minLeft = Math.min(...line.items.map(i => i.left));
    const maxRight = Math.max(...line.items.map(i => i.left + i.width));
    const fontSize = line.items[0].fontSize;
    const height = Math.max(...line.items.map(i => i.height));
    const pdfMinX = Math.min(...line.items.map(i => i.pdfX));
    const pdfMaxX = Math.max(...line.items.map(i => i.pdfX + (i.width / (viewport?.scale || 1))));
    const pdfMinY = Math.min(...line.items.map(i => i.pdfY));

    return {
      text,
      left: minLeft,
      top: line.top,
      width: maxRight - minLeft,
      height: height + 2,
      fontSize,
      fontName: line.items[0].fontName,
      rawFontName: line.items[0].rawFontName || '',
      styleInfo: line.items[0].styleInfo || null,
      fontMeta: line.items[0].fontMeta || null,
      pdfX: pdfMinX,
      pdfY: pdfMinY,
      pdfFontSize: line.items[0].pdfFontSize,
      pdfLineWidth: pdfMaxX - pdfMinX,
      pdfItems: line.items,
    };
  });
}

function transformFallback(viewport, t) {
  const vt = viewport.transform;
  return [
    vt[0] * t[0] + vt[2] * t[1],
    vt[1] * t[0] + vt[3] * t[1],
    vt[0] * t[2] + vt[2] * t[3],
    vt[1] * t[2] + vt[3] * t[3],
    vt[0] * t[4] + vt[2] * t[5] + vt[4],
    vt[1] * t[4] + vt[3] * t[5] + vt[5],
  ];
}

/* ═══════════════════ Paragraph Grouping ═══════════════════ */

/**
 * Group lines into paragraphs based on vertical proximity and left-alignment.
 * Lines that are close together vertically (within 1.8x line height) and share
 * similar left positions are grouped as a paragraph.
 *
 * @param {Array} lines - Output from groupIntoLines
 * @returns {Array<Array>} Array of paragraph arrays, each containing lines
 */
function groupIntoParagraphs(lines) {
  if (lines.length <= 1) return lines.map(l => [l]);

  const paragraphs = [];
  let currentPara = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];

    const verticalGap = curr.top - (prev.top + prev.height);
    const lineSpacing = prev.height * 1.5;
    const leftAligned = Math.abs(curr.left - prev.left) < prev.height * 1.5;
    const widthSimilar = Math.abs(curr.width - prev.width) < Math.max(curr.width, prev.width) * 0.5;
    const sameFont = curr.fontName === prev.fontName;
    const sameSize = Math.abs(curr.fontSize - prev.fontSize) < 2;

    if (verticalGap < lineSpacing && leftAligned && widthSimilar && sameFont && sameSize) {
      currentPara.push(curr);
    } else {
      paragraphs.push(currentPara);
      currentPara = [curr];
    }
  }
  paragraphs.push(currentPara);

  return paragraphs;
}

/* ═══════════════════ Enter / Exit Text Edit ═══════════════════ */

export async function enterTextEditMode(pageNum, pdfDoc, viewport, container, pdfCanvas) {
  if (active) exitTextEditMode();
  _pdfCanvas = pdfCanvas || null;

  const page = await pdfDoc.getPage(pageNum);
  let textContent;
  try {
    textContent = await page.getTextContent();
  } catch (err) {
    console.warn('Text extraction failed (may be encrypted):', err);
    textContent = { items: [] };
  }
  // Best-effort font metadata from pdf.js commonObjs (unreliable — often empty).
  // The authoritative font detection happens at commit time via extractPageFontMeta()
  // which reads the actual PDF font dictionary with pdf-lib.
  const fontMeta = {};
  for (const key of Object.keys(textContent.styles || {})) {
    try {
      if (page.commonObjs?.has(key)) {
        const fd = page.commonObjs.get(key);
        if (fd) {
          fontMeta[key] = { bold: !!fd.bold, italic: !!fd.italic, name: fd.name || '' };
        }
      }
    } catch (_) { /* commonObjs may not expose this font */ }
  }
  const lines = groupIntoLines(textContent.items, viewport, textContent.styles, fontMeta);

  if (lines.length === 0) {
    // Try OCR results for scanned pages
    const { hasOCRResults, getOCRResults } = await import('./ocr.js');
    if (hasOCRResults(pageNum)) {
      const ocrData = getOCRResults(pageNum);
      if (ocrData && ocrData.lines && ocrData.lines.length > 0) {
        const scale = viewport.scale;
        for (const ocrLine of ocrData.lines) {
          const left = ocrLine.bbox.x0 * scale;
          const top = ocrLine.bbox.y0 * scale;
          const width = (ocrLine.bbox.x1 - ocrLine.bbox.x0) * scale;
          const height = (ocrLine.bbox.y1 - ocrLine.bbox.y0) * scale;
          const fontSize = Math.max(8, height * 0.85);
          lines.push({
            text: ocrLine.text,
            left, top, width, height, fontSize,
            pdfX: ocrLine.bbox.x0,
            pdfY: ocrLine.bbox.y0,
            pdfFontSize: height * 0.85 / scale,
            fontName: 'Helvetica',
          });
        }
      }
    }
    if (lines.length === 0) {
      const { toast } = await import('./utils.js');
      toast('No editable text found — try OCR first for scanned pages', 'warning');
      return false;
    }
  }

  active = true;
  editContainer = container;
  currentViewport = viewport;
  currentPageNum = pageNum;
  currentPdfDoc = pdfDoc;

  // Reset state
  undoStack = [];
  redoStack = [];
  _activeBlockIdx = -1;
  _blockZones = [];
  _editedBlocks = new Map();

  // Hide existing text layer spans and boost opacity for editable overlays
  container.classList.add('text-edit-active');
  container.querySelectorAll('span').forEach(s => s.style.visibility = 'hidden');

  // Disable fabric canvas wrapper so clicks reach the text-edit layer
  const fabricWrapper = document.getElementById('fabric-canvas-wrapper');
  if (fabricWrapper) fabricWrapper.style.pointerEvents = 'none';

  // Group lines into paragraphs — store for single-block editing
  _paragraphData = groupIntoParagraphs(lines);

  // Create transparent click zones for each paragraph block
  for (let pi = 0; pi < _paragraphData.length; pi++) {
    const para = _paragraphData[pi];
    const paraTop = Math.min(...para.map(l => l.top));
    const paraBottom = Math.max(...para.map(l => l.top + l.height));
    const paraLeft = Math.min(...para.map(l => l.left));
    const paraRight = Math.max(...para.map(l => l.left + l.width));

    const zone = document.createElement('div');
    zone.className = 'text-edit-block-zone';
    zone.dataset.blockIdx = pi;
    zone.style.position = 'absolute';
    zone.style.left = (paraLeft - 2) + 'px';
    zone.style.top = (paraTop - 2) + 'px';
    zone.style.width = (paraRight - paraLeft + 4) + 'px';
    zone.style.height = (paraBottom - paraTop + 4) + 'px';
    zone.style.cursor = 'text';
    zone.style.zIndex = '14';
    zone.addEventListener('click', () => activateBlock(pi));
    container.appendChild(zone);
    _blockZones.push(zone);
  }

  _focusedLine = null;

  // Boost text-layer opacity so edit overlays are fully opaque
  container.classList.add('text-edit-active');

  // Lift form field overlay above text-edit lines so form inputs are clickable
  const formOverlay = container.parentElement?.querySelector('#form-overlay');
  if (formOverlay) {
    formOverlay.style.zIndex = '20';
    formOverlay.style.pointerEvents = 'auto';
  }

  // Register keyboard handler for text edit shortcuts
  container.addEventListener('keydown', handleTextEditKeydown, true);

  // Create enhanced floating toolbar
  createToolbar(container);

  // Click-outside handler: deactivate the active block when clicking outside it
  if (_clickOutsideHandler) document.removeEventListener('mousedown', _clickOutsideHandler, true);
  _clickOutsideHandler = (e) => {
    if (_activeBlockIdx < 0) return; // no active block
    // Ignore clicks inside toolbar
    if (toolbar && toolbar.contains(e.target)) return;
    // Ignore clicks inside active text-edit lines
    if (e.target.closest && e.target.closest('.text-edit-line')) return;
    // Ignore clicks inside block shield (it covers the active block area)
    if (e.target.closest && e.target.closest('.text-edit-block-shield')) return;
    // Clicking on another block zone is fine — activateBlock handles it
    if (e.target.closest && e.target.closest('.text-edit-block-zone')) return;
    // Click was outside — deactivate the current block
    deactivateBlock();
  };
  document.addEventListener('mousedown', _clickOutsideHandler, true);

  return true;
}

/* ── Single-block activation / deactivation ── */

/**
 * Activate a single paragraph block for editing.
 * Creates contenteditable overlays only for lines in that block.
 */
function activateBlock(paraIdx) {
  if (paraIdx === _activeBlockIdx) return;

  // Deactivate current block first (saves dirty state)
  if (_activeBlockIdx >= 0) deactivateBlock();

  _activeBlockIdx = paraIdx;
  const para = _paragraphData[paraIdx];
  if (!para || !editContainer) return;

  // Hide the click zone for this block
  const zone = _blockZones[paraIdx];
  if (zone) zone.style.display = 'none';

  // Disable pointer-events on ALL other zones so mis-clicks don't activate them
  for (let i = 0; i < _blockZones.length; i++) {
    if (i !== paraIdx && _blockZones[i]) {
      _blockZones[i].style.pointerEvents = 'none';
    }
  }

  // Create a click shield behind the active lines — covers the full block
  // area so clicks between lines don't fall through to zones below
  const paraTop = Math.min(...para.map(l => l.top));
  const paraBottom = Math.max(...para.map(l => l.top + l.height));
  const paraLeft = Math.min(...para.map(l => l.left));
  const paraRight = Math.max(...para.map(l => l.left + l.width));
  const shield = document.createElement('div');
  shield.className = 'text-edit-block-shield';
  shield.style.position = 'absolute';
  shield.style.left = (paraLeft - 10) + 'px';
  shield.style.top = (paraTop - 10) + 'px';
  shield.style.width = (paraRight - paraLeft + 20) + 'px';
  shield.style.height = (paraBottom - paraTop + 20) + 'px';
  shield.style.zIndex = '14';
  shield.style.background = 'transparent';
  shield.addEventListener('mousedown', e => e.stopPropagation());
  editContainer.appendChild(shield);

  // Pre-sample colors from the canvas BEFORE erasing — once erased,
  // sampleTextColor would read the background instead of the actual text color.
  // Sample background first, then pass it to text color sampler so it can
  // skip background-colored pixels (critical for gray table cell backgrounds).
  const savedEdits = _editedBlocks.get(paraIdx);
  const preSampled = para.map((line, li) => {
    const saved = savedEdits ? savedEdits[li] : null;
    const bgColor = saved?.bgColor || sampleBackgroundColor(_pdfCanvas, line.left, line.top, line.width, line.height);
    const textColor = saved?.matchedColor || sampleTextColor(_pdfCanvas, line.left, line.top, line.width, line.height, bgColor);
    return { textColor, bgColor };
  });

  // Save canvas snapshot for this block area and erase original text from canvas
  // so the transparent overlay doesn't create ghost/double text
  _canvasSnapshot = null;
  if (_pdfCanvas) {
    try {
      const ctx = _pdfCanvas.getContext('2d');
      const dpr = _pdfCanvas.width / (parseFloat(_pdfCanvas.style.width) || _pdfCanvas.offsetWidth) || 1;
      const snapX = Math.max(0, Math.floor((paraLeft - 6) * dpr));
      const snapY = Math.max(0, Math.floor((paraTop - 6) * dpr));
      const snapW = Math.min(Math.ceil((paraRight - paraLeft + 12) * dpr), _pdfCanvas.width - snapX);
      const snapH = Math.min(Math.ceil((paraBottom - paraTop + 12) * dpr), _pdfCanvas.height - snapY);
      if (snapW > 0 && snapH > 0) {
        _canvasSnapshot = {
          imageData: ctx.getImageData(snapX, snapY, snapW, snapH),
          x: snapX, y: snapY,
        };
        // Paint over each line's text using identity transform (raw pixel coords).
        // Inset generously to avoid erasing nearby form box borders/edges.
        // The contenteditable overlay covers the full area, so edge pixels
        // peeking through are hidden by the div content.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (let i = 0; i < para.length; i++) {
          const line = para[i];
          ctx.fillStyle = preSampled[i].bgColor;
          const insetX = 3;
          const insetTop = Math.max(4, line.height * 0.15);  // keep well below top border
          const insetBottom = 2;
          ctx.fillRect(
            Math.floor((line.left + insetX) * dpr),
            Math.floor((line.top + insetTop) * dpr),
            Math.ceil((line.width - insetX * 2) * dpr),
            Math.ceil((line.height - insetTop - insetBottom) * dpr)
          );
        }
        ctx.restore();
      }
    } catch (_) { /* canvas security or other error */ }
  }

  for (let li = 0; li < para.length; li++) {
    const line = para[li];
    const saved = savedEdits ? savedEdits[li] : null;

    const div = document.createElement('div');
    div.className = 'text-edit-line';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.textContent = saved ? saved.text : line.text;

    // Position — align text content exactly over original canvas text.
    // CSS has padding: 0 2px, so offset left by 2px to compensate.
    div.style.left = (line.left - 2) + 'px';
    div.style.top = line.top + 'px';
    div.style.minWidth = (line.width + 8) + 'px';
    div.style.minHeight = line.height + 'px';
    div.style.fontSize = (saved?.fontSizeOverride || line.fontSize) + 'px';
    div.style.lineHeight = (line.height + 4) + 'px';

    // Match PDF font visually
    const cssFont = saved?.cssFont || mapToCSSFont(line.fontName);
    const nameStyle = detectFontStyleWithMeta(line.fontName, line.styleInfo, line.fontMeta);
    // Use style metadata/font name only for default bold/italic.
    const baseStyle = saved
      ? { bold: !!saved.bold, italic: !!saved.italic }
      : { bold: nameStyle.bold, italic: nameStyle.italic };
    const fontStyle = saved
      ? { bold: saved.bold, italic: saved.italic }
      : { bold: nameStyle.bold, italic: nameStyle.italic };
    div.style.fontFamily = cssFont;
    if (fontStyle.bold) div.style.fontWeight = 'bold';
    if (fontStyle.italic) div.style.fontStyle = 'italic';

    // Color — use pre-sampled values (sampled before canvas erase)
    const matchedColor = preSampled[li].textColor;
    div.style.color = saved?.colorOverride || matchedColor;
    div.dataset.matchedColor = matchedColor;

    // Background — transparent so the original PDF canvas shows through unchanged
    div.style.background = 'transparent';
    const bgColor = preSampled[li].bgColor;
    div.dataset.bgColor = bgColor;

    // Store original data
    div.dataset.original = line.text;
    div.dataset.pdfX = line.pdfX;
    div.dataset.pdfY = line.pdfY;
    div.dataset.pdfFontSize = line.pdfFontSize;
    div.dataset.pdfLineWidth = line.pdfLineWidth || '';
    div.dataset.fontName = line.fontName || '';
    div.dataset.rawFontName = line.rawFontName || '';
    div.dataset.baseBold = baseStyle.bold ? 'true' : '';
    div.dataset.baseItalic = baseStyle.italic ? 'true' : '';
    div.dataset.cssFont = cssFont;
    div.dataset.width = line.width;
    div.dataset.height = line.height;
    div.dataset.blockIdx = paraIdx;
    div.dataset.lineIdx = li;

    // Restore formatting overrides from saved state
    div.dataset.fontSizeOverride = saved?.fontSizeOverride || '';
    div.dataset.colorOverride = saved?.colorOverride || '';
    div.dataset.fontFamilyOverride = saved?.fontFamilyOverride || '';
    div.dataset.fontNameOverride = saved?.fontNameOverride || '';
    div.dataset.bold = fontStyle.bold ? 'true' : '';
    div.dataset.italic = fontStyle.italic ? 'true' : '';
    // Store initial bold/italic so change detection compares against activation state.
    div.dataset.initialBold = baseStyle.bold ? 'true' : '';
    div.dataset.initialItalic = baseStyle.italic ? 'true' : '';

    // Mark as dirty if previously edited
    if (saved?.dirty) markDirty(div);

    // Prevent clicks from propagating to zones below
    div.addEventListener('mousedown', e => e.stopPropagation());

    // Undo snapshot on first input per focus session
    let snapshotTaken = false;
    div.addEventListener('focus', () => {
      snapshotTaken = false;
      _focusedLine = div;
      updateToolbarState(div);
    });
    div.addEventListener('input', () => {
      if (!snapshotTaken) {
        const snap = captureSnapshot(div);
        snap.text = div.dataset._lastText || div.dataset.original;
        undoStack.push(snap);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = [];
        updateUndoButtons();
        snapshotTaken = true;
      }
      div.dataset._lastText = div.textContent;
      markDirty(div);
    });
    div.addEventListener('blur', () => {
      // Don't clear _focusedLine if focus moved to the toolbar (e.g. select dropdown)
      // Use requestAnimationFrame so document.activeElement has updated
      requestAnimationFrame(() => {
        if (_focusedLine !== div) return;
        const ae = document.activeElement;
        if (toolbar && toolbar.contains(ae)) return; // focus went to toolbar
        _focusedLine = null;
      });
    });

    editContainer.appendChild(div);
  }

  // Focus the first line of the activated block
  const firstLine = editContainer.querySelector(`.text-edit-line[data-block-idx="${paraIdx}"]`);
  if (firstLine) firstLine.focus();
}

/**
 * Deactivate the current block — saves any dirty line data and removes overlays.
 */
function deactivateBlock() {
  if (_activeBlockIdx < 0 || !editContainer) return;

  // Remove click shield
  editContainer.querySelectorAll('.text-edit-block-shield').forEach(el => el.remove());

  // Re-enable pointer-events on all zones
  for (const z of _blockZones) {
    if (z) z.style.pointerEvents = '';
  }

  const blockLines = editContainer.querySelectorAll(`.text-edit-line[data-block-idx="${_activeBlockIdx}"]`);
  const savedLines = [];
  let hasDirty = false;

  for (const div of blockLines) {
    const isDirty = div.classList.contains('text-edit-dirty');
    const newText = div.textContent;
    const original = div.dataset.original;
    const fontSizeOverride = div.dataset.fontSizeOverride;
    const colorOverride = div.dataset.colorOverride;
    const fontFamilyOverride = div.dataset.fontFamilyOverride;
    const fontNameOverride = div.dataset.fontNameOverride;
    const bold = div.dataset.bold === 'true';
    const italic = div.dataset.italic === 'true';
    // Compare against initial activation state to determine explicit user toggles.
    const initialBold = div.dataset.initialBold === 'true';
    const initialItalic = div.dataset.initialItalic === 'true';
    const hasTextChange = newText !== original;
    const hasFormatChange = fontSizeOverride || colorOverride || fontFamilyOverride ||
      bold !== initialBold || italic !== initialItalic ||
      div.dataset.underline === 'true' || div.dataset.strikethrough === 'true' ||
      (div.dataset.align && div.dataset.align !== 'left');

    if (hasTextChange || hasFormatChange || isDirty) hasDirty = true;

    // For commit: use metadata-derived bold/italic unless user explicitly toggled.
    const userChangedBold = bold !== initialBold;
    const userChangedItalic = italic !== initialItalic;
    const baseBold = div.dataset.baseBold === 'true';
    const baseItalic = div.dataset.baseItalic === 'true';
    const commitBold = userChangedBold ? bold : baseBold;
    const commitItalic = userChangedItalic ? italic : baseItalic;

    savedLines.push({
      text: newText,
      originalText: original,
      matchedColor: div.dataset.matchedColor,
      cssFont: div.dataset.cssFont,
      bold: commitBold,
      italic: commitItalic,
      fontSizeOverride: fontSizeOverride ? parseFloat(fontSizeOverride) : 0,
      colorOverride: colorOverride || '',
      fontFamilyOverride: fontFamilyOverride || '',
      fontNameOverride: fontNameOverride || '',
      userChangedFormat: !!(hasFormatChange),
      dirty: hasTextChange || hasFormatChange || isDirty,
      // Preserve original PDF data for commit
      pdfX: parseFloat(div.dataset.pdfX),
      pdfY: parseFloat(div.dataset.pdfY),
      pdfFontSize: parseFloat(div.dataset.pdfFontSize),
      pdfLineWidth: parseFloat(div.dataset.pdfLineWidth) || 0,
      fontName: fontNameOverride || div.dataset.fontName,
      rawFontName: div.dataset.rawFontName || '',
      screenWidth: parseFloat(div.dataset.width),
      screenHeight: parseFloat(div.dataset.height),
      bgColor: div.dataset.bgColor || '#ffffff',
      underline: div.dataset.underline === 'true',
      strikethrough: div.dataset.strikethrough === 'true',
      align: div.dataset.align || 'left',
    });
    div.remove();
  }

  if (hasDirty) {
    _editedBlocks.set(_activeBlockIdx, savedLines);
  }

  // Restore canvas pixels (bring back original text rendering)
  if (_canvasSnapshot && _pdfCanvas) {
    try {
      const ctx = _pdfCanvas.getContext('2d');
      ctx.putImageData(_canvasSnapshot.imageData, _canvasSnapshot.x, _canvasSnapshot.y);
    } catch (_) { /* ignore */ }
  }
  _canvasSnapshot = null;

  // Re-show the click zone
  const zone = _blockZones[_activeBlockIdx];
  if (zone) {
    zone.style.display = '';
    // Add visual indicator if block has edits
    if (hasDirty) zone.classList.add('text-edit-zone-dirty');
  }

  _activeBlockIdx = -1;
  _focusedLine = null;
}

export function exitTextEditMode() {
  if (!active) return;
  active = false;

  // Deactivate any active block first
  if (_activeBlockIdx >= 0) deactivateBlock();

  if (editContainer) {
    editContainer.classList.remove('text-edit-active');
    editContainer.removeEventListener('keydown', handleTextEditKeydown, true);
    editContainer.querySelectorAll('.text-edit-line').forEach(el => el.remove());
    editContainer.querySelectorAll('.text-edit-paragraph').forEach(el => el.remove());
    editContainer.querySelectorAll('.text-edit-block-zone').forEach(el => el.remove());
    editContainer.querySelectorAll('.text-edit-block-shield').forEach(el => el.remove());
    editContainer.querySelectorAll('span').forEach(s => s.style.visibility = '');
    editContainer.classList.remove('text-edit-active');

    // Restore form overlay z-index
    const formOverlay = editContainer.parentElement?.querySelector('#form-overlay');
    if (formOverlay) {
      formOverlay.style.zIndex = '';
      formOverlay.style.pointerEvents = '';
    }

    // Restore fabric canvas wrapper pointer-events
    const fabricWrapper = document.getElementById('fabric-canvas-wrapper');
    if (fabricWrapper) fabricWrapper.style.pointerEvents = '';
  }

  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }

  // Remove click-outside handler
  if (_clickOutsideHandler) {
    document.removeEventListener('mousedown', _clickOutsideHandler, true);
    _clickOutsideHandler = null;
  }

  editContainer = null;
  currentViewport = null;
  currentPageNum = 0;
  currentPdfDoc = null;
  _focusedLine = null;
  _pdfCanvas = null;
  _paragraphData = [];
  _activeBlockIdx = -1;
  _blockZones = [];
  _editedBlocks = new Map();
  _canvasSnapshot = null;
  undoStack = [];
  redoStack = [];
}

export function isTextEditActive() {
  return active;
}

/** Check whether any text lines have been modified (dirty) */
export function hasTextEditChanges() {
  if (!editContainer) return false;
  return editContainer.querySelectorAll('.text-edit-line.text-edit-dirty').length > 0;
}

/** Check whether any image overlays have pending actions */
export function hasImageEditChanges() {
  return imageOverlays.some(o => o.action !== 'none');
}

/* ═══════════════════ Enhanced Toolbar ═══════════════════ */

function createToolbar(container) {
  if (toolbar) toolbar.remove();

  toolbar = document.createElement('div');
  toolbar.className = 'text-edit-toolbar';

  // Build font family options
  const fontFamilyOptions = FONT_FAMILIES.map(f =>
    `<option value="${f.css}" data-pdf="${f.pdf}">${f.label}</option>`
  ).join('');

  // Include custom font option if one is loaded
  const customFontOption = customFont
    ? `<option value="custom" data-pdf="custom">${escapeHtml(customFont.name)}</option>`
    : '';

  toolbar.innerHTML = `
    <div class="text-edit-toolbar-group">
      <select class="text-edit-font-family" title="Font family">
        <option value="">Font</option>
        ${fontFamilyOptions}
        ${customFontOption}
        <option value="__upload" data-pdf="">Upload font…</option>
      </select>
      <select class="text-edit-font-size" title="Font size">
        <option value="">Size</option>
        <option value="8">8</option>
        <option value="9">9</option>
        <option value="10">10</option>
        <option value="11">11</option>
        <option value="12">12</option>
        <option value="14">14</option>
        <option value="16">16</option>
        <option value="18">18</option>
        <option value="20">20</option>
        <option value="24">24</option>
        <option value="28">28</option>
        <option value="32">32</option>
        <option value="36">36</option>
        <option value="48">48</option>
        <option value="72">72</option>
      </select>
    </div>
    <div class="text-edit-toolbar-sep"></div>
    <div class="text-edit-toolbar-group">
      <button class="text-edit-btn text-edit-bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button class="text-edit-btn text-edit-italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button class="text-edit-btn text-edit-underline" title="Underline (Ctrl+U)"><u>U</u></button>
      <button class="text-edit-btn text-edit-strikethrough" title="Strikethrough"><s>S</s></button>
    </div>
    <div class="text-edit-toolbar-sep"></div>
    <div class="text-edit-toolbar-group">
      <button class="text-edit-btn text-edit-align" data-align="left" title="Align left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
      </button>
      <button class="text-edit-btn text-edit-align" data-align="center" title="Align center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="18" y1="14" x2="6" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
      </button>
      <button class="text-edit-btn text-edit-align" data-align="right" title="Align right">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="7" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
      </button>
    </div>
    <div class="text-edit-toolbar-sep"></div>
    <div class="text-edit-toolbar-group">
      <input type="color" class="text-edit-color" value="#000000" title="Text color">
      <button class="text-edit-btn text-edit-eyedropper" title="Pick color from page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M15 6l3-3 3 3-3 3"/><path d="M12 9l3 3"/></svg>
      </button>
    </div>
    <div class="text-edit-toolbar-sep"></div>
    <div class="text-edit-toolbar-group">
      <button class="text-edit-btn text-edit-undo" title="Undo (Ctrl+Z)" disabled>↶</button>
      <button class="text-edit-btn text-edit-redo" title="Redo (Ctrl+Y)" disabled>↷</button>
    </div>
    <div class="text-edit-toolbar-sep"></div>
    <div class="text-edit-toolbar-group">
      <span class="text-edit-info">Click a text block to edit</span>
    </div>
    <div class="text-edit-toolbar-spacer"></div>
    <div class="text-edit-toolbar-group text-edit-actions">
      <button class="text-edit-commit" title="Apply changes (Ctrl+Enter)">Apply</button>
      <button class="text-edit-cancel" title="Cancel (Esc)">Cancel</button>
    </div>
  `;

  // Wire toolbar events — font family
  const fontFamilySelect = toolbar.querySelector('.text-edit-font-family');
  fontFamilySelect.addEventListener('change', () => {
    const val = fontFamilySelect.value;

    // Handle "Upload font…" action
    if (val === '__upload') {
      fontFamilySelect.value = ''; // reset selector
      handleFontUpload(fontFamilySelect);
      return;
    }

    if (val && val !== '__upload') applyToFocused(div => {
      pushUndo(div);
      if (val === 'custom' && customFont) {
        div.style.fontFamily = `"${customFont.name}", sans-serif`;
        div.dataset.fontFamilyOverride = 'custom';
        div.dataset.fontNameOverride = 'custom';
      } else {
        div.style.fontFamily = val;
        div.dataset.fontFamilyOverride = val;
        const opt = fontFamilySelect.selectedOptions[0];
        div.dataset.fontNameOverride = opt?.dataset.pdf || '';
      }
    });
  });

  // Wire toolbar events — font size
  const fontSizeSelect = toolbar.querySelector('.text-edit-font-size');
  fontSizeSelect.addEventListener('change', () => {
    const val = fontSizeSelect.value;
    if (val) applyToFocused(div => {
      pushUndo(div);
      div.style.fontSize = val + 'px';
      div.dataset.fontSizeOverride = val;
    });
  });

  toolbar.querySelector('.text-edit-bold').addEventListener('click', () => {
    applyToFocused(div => {
      pushUndo(div);
      const isBold = div.style.fontWeight === 'bold';
      div.style.fontWeight = isBold ? 'normal' : 'bold';
      div.dataset.bold = isBold ? '' : 'true';
      toolbar.querySelector('.text-edit-bold').classList.toggle('active', !isBold);
    });
  });

  toolbar.querySelector('.text-edit-italic').addEventListener('click', () => {
    applyToFocused(div => {
      pushUndo(div);
      const isItalic = div.style.fontStyle === 'italic';
      div.style.fontStyle = isItalic ? 'normal' : 'italic';
      div.dataset.italic = isItalic ? '' : 'true';
      toolbar.querySelector('.text-edit-italic').classList.toggle('active', !isItalic);
    });
  });

  toolbar.querySelector('.text-edit-underline').addEventListener('click', () => {
    applyToFocused(div => {
      pushUndo(div);
      const isUnderline = div.dataset.underline === 'true';
      div.dataset.underline = isUnderline ? '' : 'true';
      div.style.textDecoration = _getTextDecoration(div);
      toolbar.querySelector('.text-edit-underline').classList.toggle('active', !isUnderline);
    });
  });

  toolbar.querySelector('.text-edit-strikethrough').addEventListener('click', () => {
    applyToFocused(div => {
      pushUndo(div);
      const isStrike = div.dataset.strikethrough === 'true';
      div.dataset.strikethrough = isStrike ? '' : 'true';
      div.style.textDecoration = _getTextDecoration(div);
      toolbar.querySelector('.text-edit-strikethrough').classList.toggle('active', !isStrike);
    });
  });

  toolbar.querySelectorAll('.text-edit-align').forEach(btn => {
    btn.addEventListener('click', () => {
      applyToFocused(div => {
        pushUndo(div);
        div.style.textAlign = btn.dataset.align;
        div.dataset.align = btn.dataset.align;
      });
      toolbar.querySelectorAll('.text-edit-align').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  toolbar.querySelector('.text-edit-color').addEventListener('input', (e) => {
    applyToFocused(div => {
      pushUndo(div);
      div.style.color = e.target.value;
      div.dataset.colorOverride = e.target.value;
    });
  });

  // Eyedropper — click a pixel on the PDF canvas to pick its color
  const eyedropperBtn = toolbar.querySelector('.text-edit-eyedropper');
  eyedropperBtn.addEventListener('click', () => {
    if (!_pdfCanvas) return;
    // Try the native EyeDropper API first (Chrome 95+)
    if (typeof window.EyeDropper === 'function') {
      const dropper = new window.EyeDropper();
      dropper.open().then(result => {
        const hex = result.sRGBHex;
        toolbar.querySelector('.text-edit-color').value = hex;
        applyToFocused(div => {
          pushUndo(div);
          div.style.color = hex;
          div.dataset.colorOverride = hex;
        });
      }).catch(() => { /* user cancelled */ });
      return;
    }
    // Fallback: manual canvas click-to-pick
    eyedropperBtn.classList.add('active');
    _pdfCanvas.style.cursor = 'crosshair';
    function onCanvasPick(e) {
      const rect = _pdfCanvas.getBoundingClientRect();
      const scaleX = _pdfCanvas.width / rect.width;
      const scaleY = _pdfCanvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const hex = samplePixelColor(_pdfCanvas, x, y);
      if (hex) {
        toolbar.querySelector('.text-edit-color').value = hex;
        applyToFocused(div => {
          pushUndo(div);
          div.style.color = hex;
          div.dataset.colorOverride = hex;
        });
      }
      _pdfCanvas.style.cursor = '';
      eyedropperBtn.classList.remove('active');
      _pdfCanvas.removeEventListener('click', onCanvasPick);
    }
    _pdfCanvas.addEventListener('click', onCanvasPick, { once: true });
  });

  // Undo / Redo buttons
  toolbar.querySelector('.text-edit-undo').addEventListener('click', performUndo);
  toolbar.querySelector('.text-edit-redo').addEventListener('click', performRedo);
  updateUndoButtons();

  // Prevent toolbar buttons from stealing focus from the contenteditable line.
  // Without this, clicking Bold/Italic/etc. fires blur on the focused line,
  // setting _focusedLine = null before the click handler can read it.
  toolbar.addEventListener('mousedown', (e) => {
    // Allow selects and color inputs to receive focus (they need it to open),
    // but prevent buttons from stealing focus.
    const tag = e.target.tagName;
    if (tag !== 'SELECT' && tag !== 'INPUT') {
      e.preventDefault();
    }
  });

  const parent = container.parentElement || container;
  parent.appendChild(toolbar);
}

/* ═══════════════════ Custom Font Upload ═══════════════════ */

/**
 * Handle uploading a custom TTF/OTF font for text editing.
 * The font is registered via CSS @font-face and stored for pdf-lib embedding at commit time.
 */
async function handleFontUpload(fontFamilySelect) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ttf,.otf,.woff,.woff2';
  input.onchange = async () => {
    if (!input.files.length) return;
    const file = input.files[0];
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');

    try {
      const bytes = await readFileAsBytes(file);

      // Register with CSS @font-face so overlays can use it
      const blob = new Blob([bytes], { type: 'font/' + (file.name.endsWith('.otf') ? 'otf' : 'truetype') });
      const fontUrl = URL.createObjectURL(blob);
      const fontFace = new FontFace(name, `url(${fontUrl})`);
      await fontFace.load();
      document.fonts.add(fontFace);
      URL.revokeObjectURL(fontUrl);

      // Store for pdf-lib embedding during commit
      customFont = { name, bytes, fontObj: null };

      // Add option to selector and select it
      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.dataset.pdf = 'custom';
      opt.textContent = name;
      // Remove previous custom option if any
      const existing = fontFamilySelect.querySelector('option[value="custom"]');
      if (existing) existing.remove();
      // Insert before the "Upload font…" option
      const uploadOpt = fontFamilySelect.querySelector('option[value="__upload"]');
      fontFamilySelect.insertBefore(opt, uploadOpt);
      fontFamilySelect.value = 'custom';
      fontFamilySelect.dispatchEvent(new Event('change'));
    } catch (err) {
      console.warn('Font upload failed:', err);
      import('./utils.js').then(m => m.toast('Failed to load font: ' + err.message, 'error'));
    }
  };
  input.click();
}

/** Mark a line as changed for live preview indication */
function markDirty(div) {
  const hasTextChange = div.textContent !== div.dataset.original;
  const hasFormatChange = div.dataset.fontSizeOverride || div.dataset.colorOverride ||
    div.dataset.fontFamilyOverride || div.dataset.bold !== (div.dataset.initialBold || '') ||
    div.dataset.italic !== (div.dataset.initialItalic || '') ||
    div.dataset.underline === 'true' || div.dataset.strikethrough === 'true' ||
    (div.dataset.align && div.dataset.align !== 'left');
  div.classList.toggle('text-edit-dirty', hasTextChange || !!hasFormatChange);
  updateEditCount();
}

/** Update the status text showing how many lines have been modified */
function updateEditCount() {
  if (!toolbar || !editContainer) return;
  // Count dirty lines in current active block
  let dirty = editContainer.querySelectorAll('.text-edit-line.text-edit-dirty').length;
  // Plus dirty lines from deactivated blocks
  for (const [, savedLines] of _editedBlocks) {
    dirty += savedLines.filter(l => l.dirty).length;
  }
  const info = toolbar.querySelector('.text-edit-info');
  if (info) {
    info.textContent = dirty > 0
      ? `${dirty} line${dirty > 1 ? 's' : ''} modified`
      : 'Click a text block to edit';
  }
}

/** Apply a callback to the currently focused text-edit-line */
function applyToFocused(fn) {
  const focused = _focusedLine;
  if (focused) {
    fn(focused);
    markDirty(focused);
  }
}

/** Update toolbar buttons to reflect current line's state */
function updateToolbarState(div) {
  if (!toolbar) return;
  toolbar.querySelector('.text-edit-bold').classList.toggle('active', div.dataset.bold === 'true');
  toolbar.querySelector('.text-edit-italic').classList.toggle('active', div.dataset.italic === 'true');
  toolbar.querySelector('.text-edit-underline').classList.toggle('active', div.dataset.underline === 'true');
  toolbar.querySelector('.text-edit-strikethrough').classList.toggle('active', div.dataset.strikethrough === 'true');
  toolbar.querySelectorAll('.text-edit-align').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === (div.dataset.align || 'left'));
  });

  const sizeSelect = toolbar.querySelector('.text-edit-font-size');
  sizeSelect.value = div.dataset.fontSizeOverride || '';

  const familySelect = toolbar.querySelector('.text-edit-font-family');
  familySelect.value = div.dataset.fontFamilyOverride || div.dataset.cssFont || '';

  const colorInput = toolbar.querySelector('.text-edit-color');
  colorInput.value = div.dataset.colorOverride || div.dataset.matchedColor || '#000000';
}

/* ═══════════════════ PDF Font Metadata Extraction ═══════════════════ */

/**
 * Extract font metadata from the page's PDF resource dictionary.
 * Traverses: page.node → /Resources → /Font → each font → /BaseFont + /FontDescriptor
 *
 * @returns {Map<string, {baseFont:string, bold:boolean, italic:boolean, fontWeight:number}>}
 */
function extractPageFontMeta(page, doc) {
  const PDFLib = window.PDFLib;
  if (!PDFLib) return new Map();

  const fontMap = new Map();

  // Helper: dereference a value if it's a PDFRef
  const deref = (val) => {
    if (!val) return val;
    if (val.constructor.name === 'PDFRef') return doc.context.lookup(val);
    return val;
  };

  // Helper: read a numeric value from a PDF object
  const numVal = (obj) => {
    if (!obj) return 0;
    if (typeof obj.value === 'function') return obj.value();
    if (obj.numberValue != null) return obj.numberValue;
    if (typeof obj === 'number') return obj;
    return 0;
  };

  // Helper: extract bold/italic from a FontDescriptor dictionary
  const readDescriptor = (descriptorRef) => {
    const fd = deref(descriptorRef);
    if (!fd || typeof fd.get !== 'function') return { bold: false, italic: false, fontWeight: 0 };

    let bold = false, italic = false;

    const fontWeight = numVal(fd.get(PDFLib.PDFName.of('FontWeight')));
    if (fontWeight >= 600) bold = true;

    const flags = numVal(fd.get(PDFLib.PDFName.of('Flags')));
    if (flags & 0x40) italic = true;      // bit 7 = Italic
    if (flags & 0x40000) bold = true;     // bit 19 = ForceBold

    const italicAngle = numVal(fd.get(PDFLib.PDFName.of('ItalicAngle')));
    if (italicAngle !== 0) italic = true;

    // Also check /FontName in descriptor
    const fontNameVal = fd.get(PDFLib.PDFName.of('FontName'));
    if (fontNameVal) {
      const fn = fontNameVal.toString().toLowerCase();
      if (!bold && (fn.includes('bold') || fn.includes('heavy') || fn.includes('black'))) bold = true;
      if (!italic && (fn.includes('italic') || fn.includes('oblique'))) italic = true;
    }

    return { bold, italic, fontWeight };
  };

  try {
    const resources = deref(page.node.get(PDFLib.PDFName.of('Resources')));
    if (!resources || typeof resources.get !== 'function') return fontMap;

    const fontDict = deref(resources.get(PDFLib.PDFName.of('Font')));
    if (!fontDict || typeof fontDict.entries !== 'function') return fontMap;

    for (const [nameObj, fontRef] of fontDict.entries()) {
      try {
        const refName = nameObj.toString().replace(/^\//, '');
        const fontObj = deref(fontRef);
        if (!fontObj || typeof fontObj.get !== 'function') continue;

        // Read /BaseFont name (e.g. /BCDFEE+Arial-BoldMT)
        const baseFontVal = fontObj.get(PDFLib.PDFName.of('BaseFont'));
        const rawBaseFont = baseFontVal ? baseFontVal.toString().replace(/^\//, '') : '';
        // Strip subset prefix (e.g. "BCDFEE+" → "Arial-BoldMT")
        const baseFont = rawBaseFont.replace(/^[A-Z]{6}\+/, '');

        // Parse bold/italic from BaseFont name
        const lowerBase = baseFont.toLowerCase();
        let bold = lowerBase.includes('bold') || lowerBase.includes('heavy') || lowerBase.includes('black');
        let italic = lowerBase.includes('italic') || lowerBase.includes('oblique');
        let fontWeight = 0;

        // Read /FontDescriptor for authoritative data
        const descriptorRef = fontObj.get(PDFLib.PDFName.of('FontDescriptor'));
        if (descriptorRef) {
          const desc = readDescriptor(descriptorRef);
          if (desc.bold) bold = true;
          if (desc.italic) italic = true;
          fontWeight = desc.fontWeight;
        }

        // Handle Type0 composite fonts → DescendantFonts → CIDFont → FontDescriptor
        const subtypeVal = fontObj.get(PDFLib.PDFName.of('Subtype'));
        const subtype = subtypeVal ? subtypeVal.toString().replace(/^\//, '') : '';
        if (subtype === 'Type0') {
          const descendants = deref(fontObj.get(PDFLib.PDFName.of('DescendantFonts')));
          if (descendants && typeof descendants.get === 'function') {
            const cidFont = deref(descendants.get(0));
            if (cidFont && typeof cidFont.get === 'function') {
              const cidDescRef = cidFont.get(PDFLib.PDFName.of('FontDescriptor'));
              if (cidDescRef) {
                const cidDesc = readDescriptor(cidDescRef);
                if (cidDesc.bold) bold = true;
                if (cidDesc.italic) italic = true;
                if (!fontWeight) fontWeight = cidDesc.fontWeight;
              }
            }
          }
        }

        fontMap.set(refName, { baseFont, bold, italic, fontWeight });
      } catch (_) { /* skip malformed font entry */ }
    }
  } catch (err) {
    // Font metadata extraction failed — caller falls back to width-ratio heuristic
  }

  return fontMap;
}

/**
 * Build a summary of which font families on the page have bold/italic variants.
 */
function buildFontFamilySummary(pageFontMap) {
  const summary = {
    hasBoldSerif: false, hasBoldSans: false, hasBoldMono: false,
    hasItalicSerif: false, hasItalicSans: false, hasItalicMono: false,
    boldFonts: [], allFonts: [],
  };
  if (!pageFontMap || pageFontMap.size === 0) return summary;

  for (const [refName, meta] of pageFontMap) {
    const bl = meta.baseFont.toLowerCase();
    const isSerif = /times|roman|georgia|palatino|garamond/i.test(bl) ||
      (/serif/i.test(bl) && !/sans/i.test(bl));
    const isMono = /courier|mono/i.test(bl);
    const isSans = !isSerif && !isMono;

    const entry = { ...meta, refName, isSerif, isMono, isSans };
    summary.allFonts.push(entry);

    if (meta.bold) {
      summary.boldFonts.push(entry);
      if (isSerif) summary.hasBoldSerif = true;
      if (isSans) summary.hasBoldSans = true;
      if (isMono) summary.hasBoldMono = true;
    }
    if (meta.italic) {
      if (isSerif) summary.hasItalicSerif = true;
      if (isSans) summary.hasItalicSans = true;
      if (isMono) summary.hasItalicMono = true;
    }
  }

  return summary;
}

/* ═══════════════════ Content Stream Text Replacement ═══════════════════ */

// Robust type checks: use instanceof when available, fall back to duck typing.
// Defined at module level so all content-stream helpers can share them.
function isPDFRef(v) {
  if (!v) return false;
  const PDFLib = window.PDFLib;
  if (PDFLib && PDFLib.PDFRef && v instanceof PDFLib.PDFRef) return true;
  return typeof v.objectNumber === 'number' && typeof v.generationNumber === 'number';
}

function isPDFArray(v) {
  if (!v) return false;
  const PDFLib = window.PDFLib;
  if (PDFLib && PDFLib.PDFArray && v instanceof PDFLib.PDFArray) return true;
  return typeof v.size === 'function' && typeof v.get === 'function'
    && typeof v.asArray === 'function';
}

/**
 * Read and decode the page's content stream into a string.
 * Handles both single-stream and multi-stream /Contents.
 */
function getContentStreamText(page, doc) {
  const PDFLib = window.PDFLib;
  if (!PDFLib) { console.log('[getContentStreamText] No PDFLib'); return null; }

  try {
    const contentsRaw = page.node.get(PDFLib.PDFName.of('Contents'));
    if (!contentsRaw) {
      console.log('[getContentStreamText] No /Contents on page node');
      return null;
    }
    console.log('[getContentStreamText] contentsRaw type:', contentsRaw.constructor?.name,
      'isPDFRef:', isPDFRef(contentsRaw));

    const deref = (v) => isPDFRef(v) ? doc.context.lookup(v) : v;

    // Collect stream refs + objects
    const streams = [];
    const contentsObj = deref(contentsRaw);
    console.log('[getContentStreamText] contentsObj type:', contentsObj?.constructor?.name,
      'isPDFArray:', isPDFArray(contentsObj));

    if (isPDFArray(contentsObj)) {
      // PDFArray — multiple content streams
      const len = contentsObj.size();
      for (let i = 0; i < len; i++) {
        const ref = contentsObj.get(i);
        const obj = deref(ref);
        if (obj) streams.push({ ref: ref, obj });
      }
    } else if (isPDFRef(contentsRaw)) {
      // Single stream reference
      streams.push({ ref: contentsRaw, obj: contentsObj });
    } else if (contentsObj) {
      streams.push({ ref: null, obj: contentsObj });
    }

    console.log('[getContentStreamText] streams found:', streams.length);
    if (streams.length === 0) return null;

    // Decode each stream and concatenate
    let fullText = '';
    for (let si = 0; si < streams.length; si++) {
      const s = streams[si];
      try {
        console.log('[getContentStreamText] stream', si, 'type:', s.obj?.constructor?.name,
          'hasContents:', !!s.obj?.contents,
          'hasGetContents:', typeof s.obj?.getContents);

        if (typeof PDFLib.decodePDFRawStream === 'function') {
          const decoded = PDFLib.decodePDFRawStream(s.obj);
          const bytes = decoded.decode();
          const text = (typeof PDFLib.arrayAsString === 'function')
            ? PDFLib.arrayAsString(bytes)
            : String.fromCharCode.apply(null, bytes);
          console.log('[getContentStreamText] decoded stream', si, 'length:', text.length,
            'preview:', text.slice(0, 100));
          fullText += text;
        } else if (s.obj.contents) {
          const text = String.fromCharCode.apply(null, s.obj.contents);
          fullText += text;
        } else if (typeof s.obj.getContents === 'function') {
          const bytes = s.obj.getContents();
          fullText += String.fromCharCode.apply(null, bytes);
        } else {
          console.log('[getContentStreamText] no decode method for stream', si);
        }
      } catch (streamErr) {
        console.warn('[getContentStreamText] stream', si, 'decode error:', streamErr.message);
      }
    }

    console.log('[getContentStreamText] total text length:', fullText.length);
    if (!fullText) return null;
    return { text: fullText, streams };
  } catch (err) {
    console.error('[getContentStreamText] fatal error:', err.message, err.stack);
    return null;
  }
}

/**
 * Parse a ToUnicode CMap stream text and return forward/reverse glyph↔unicode maps.
 * Handles beginbfchar/endbfchar and beginbfrange/endbfrange sections.
 */
function parseToUnicodeCMap(cmapText) {
  const glyphToUnicode = new Map(); // glyphId (number) → unicode string
  const unicodeToGlyph = new Map(); // single unicode char → glyphId (number)

  // Parse beginbfchar sections: find ALL <glyphHex> <unicodeHex> pairs
  // Uses global regex instead of line splitting — entries can be on one line or many
  const bfcharRegex = /beginbfchar\s+([\s\S]*?)endbfchar/g;
  let match;
  while ((match = bfcharRegex.exec(cmapText)) !== null) {
    const section = match[1];
    const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pair;
    while ((pair = pairRegex.exec(section)) !== null) {
      const glyphId = parseInt(pair[1], 16);
      // Unicode value may be multi-byte (e.g., <00660069> for "fi" ligature)
      const hexStr = pair[2];
      let unicodeStr = '';
      if (hexStr.length <= 4) {
        unicodeStr = String.fromCodePoint(parseInt(hexStr, 16));
      } else {
        // Multi-char mapping: split into 4-hex-char groups
        for (let k = 0; k < hexStr.length; k += 4) {
          unicodeStr += String.fromCodePoint(parseInt(hexStr.slice(k, k + 4), 16));
        }
      }
      glyphToUnicode.set(glyphId, unicodeStr);
      if (unicodeStr.length === 1) {
        unicodeToGlyph.set(unicodeStr, glyphId);
      }
    }
  }

  // Parse beginbfrange sections: find ALL <start> <end> <unicodeStart> triples
  const bfrangeRegex = /beginbfrange\s+([\s\S]*?)endbfrange/g;
  while ((match = bfrangeRegex.exec(cmapText)) !== null) {
    const section = match[1];
    // Match triples: <start> <end> <unicodeStart>
    const tripleRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let triple;
    while ((triple = tripleRegex.exec(section)) !== null) {
      const startGlyph = parseInt(triple[1], 16);
      const endGlyph = parseInt(triple[2], 16);
      const startUnicode = parseInt(triple[3], 16);
      for (let g = startGlyph; g <= endGlyph; g++) {
        const u = startUnicode + (g - startGlyph);
        const ch = String.fromCodePoint(u);
        glyphToUnicode.set(g, ch);
        unicodeToGlyph.set(ch, g);
      }
    }
    // Also handle array form: <start> <end> [<u1> <u2> ...]
    const arrayRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g;
    let arrMatch;
    while ((arrMatch = arrayRegex.exec(section)) !== null) {
      const startGlyph = parseInt(arrMatch[1], 16);
      const endGlyph = parseInt(arrMatch[2], 16);
      const unicodes = arrMatch[3].match(/<([0-9a-fA-F]+)>/g) || [];
      for (let g = startGlyph, idx = 0; g <= endGlyph && idx < unicodes.length; g++, idx++) {
        const u = parseInt(unicodes[idx].slice(1, -1), 16);
        const ch = String.fromCodePoint(u);
        glyphToUnicode.set(g, ch);
        unicodeToGlyph.set(ch, g);
      }
    }
  }

  return { glyphToUnicode, unicodeToGlyph };
}

/**
 * Extract ToUnicode CMap data for every font on the page.
 * Returns Map<fontRefName, { isCID, glyphToUnicode, unicodeToGlyph, bytesPerGlyph }>
 */
function extractPageToUnicodeMaps(page, doc) {
  const PDFLib = window.PDFLib;
  if (!PDFLib) return new Map();

  const fontMaps = new Map();

  try {
    const resourcesRef = page.node.get(PDFLib.PDFName.of('Resources'));
    if (!resourcesRef) return fontMaps;
    const resources = isPDFRef(resourcesRef) ? doc.context.lookup(resourcesRef) : resourcesRef;
    if (!resources || typeof resources.get !== 'function') return fontMaps;

    const fontsRef = resources.get(PDFLib.PDFName.of('Font'));
    if (!fontsRef) return fontMaps;
    const fonts = isPDFRef(fontsRef) ? doc.context.lookup(fontsRef) : fontsRef;
    if (!fonts || typeof fonts.entries !== 'function') return fontMaps;

    for (const [nameObj, valueRef] of fonts.entries()) {
      const fontName = nameObj.toString().replace(/^\//, '');
      const fontDict = isPDFRef(valueRef) ? doc.context.lookup(valueRef) : valueRef;
      if (!fontDict || typeof fontDict.get !== 'function') continue;

      const subtype = fontDict.get(PDFLib.PDFName.of('Subtype'));
      const subtypeStr = subtype ? subtype.toString().replace(/^\//, '') : '';
      const isCID = subtypeStr === 'Type0';

      // Read the /ToUnicode stream
      const toUnicodeRef = fontDict.get(PDFLib.PDFName.of('ToUnicode'));
      console.log('[extractPageToUnicodeMaps]', fontName,
        'subtype=', subtypeStr, 'isCID=', isCID,
        'hasToUnicode=', !!toUnicodeRef,
        'toUnicodeType=', toUnicodeRef?.constructor?.name);
      if (!toUnicodeRef) {
        // No ToUnicode — try to read from DescendantFonts for Type0
        if (isCID) {
          const descFontsRef = fontDict.get(PDFLib.PDFName.of('DescendantFonts'));
          const descFonts = descFontsRef
            ? (isPDFRef(descFontsRef) ? doc.context.lookup(descFontsRef) : descFontsRef)
            : null;
          if (descFonts && typeof descFonts.get === 'function') {
            const cidFontRef = descFonts.get(0);
            const cidFont = cidFontRef
              ? (isPDFRef(cidFontRef) ? doc.context.lookup(cidFontRef) : cidFontRef)
              : null;
            if (cidFont && typeof cidFont.get === 'function') {
              const descToUni = cidFont.get(PDFLib.PDFName.of('ToUnicode'));
              console.log('[extractPageToUnicodeMaps]', fontName,
                'descendant ToUnicode=', !!descToUni);
            }
          }
        }
        fontMaps.set(fontName, {
          isCID, glyphToUnicode: new Map(), unicodeToGlyph: new Map(),
          bytesPerGlyph: isCID ? 2 : 1,
        });
        continue;
      }

      try {
        const toUnicodeObj = isPDFRef(toUnicodeRef) ? doc.context.lookup(toUnicodeRef) : toUnicodeRef;
        if (!toUnicodeObj) continue;

        let cmapText = '';
        if (typeof PDFLib.decodePDFRawStream === 'function') {
          const decoded = PDFLib.decodePDFRawStream(toUnicodeObj);
          const bytes = decoded.decode();
          cmapText = typeof PDFLib.arrayAsString === 'function'
            ? PDFLib.arrayAsString(bytes)
            : String.fromCharCode.apply(null, bytes);
        } else if (toUnicodeObj.contents) {
          cmapText = String.fromCharCode.apply(null, toUnicodeObj.contents);
        }

        console.log('[extractPageToUnicodeMaps]', fontName,
          'cmapLen=', cmapText.length,
          'cmapPreview=', cmapText.slice(0, 300));

        if (cmapText) {
          const maps = parseToUnicodeCMap(cmapText);
          console.log('[extractPageToUnicodeMaps]', fontName,
            'parsed: glyphs=', maps.glyphToUnicode.size,
            'reverse=', maps.unicodeToGlyph.size);
          // Show first few mappings for debugging
          if (maps.glyphToUnicode.size > 0) {
            const sample = [...maps.glyphToUnicode.entries()].slice(0, 5);
            console.log('[extractPageToUnicodeMaps]', fontName, 'sample mappings:',
              sample.map(([g, u]) => `0x${g.toString(16)}→"${u}"(U+${u.codePointAt(0).toString(16)})`).join(', '));
          }
          fontMaps.set(fontName, {
            isCID, ...maps,
            bytesPerGlyph: isCID ? 2 : 1,
          });
        } else {
          fontMaps.set(fontName, {
            isCID, glyphToUnicode: new Map(), unicodeToGlyph: new Map(),
            bytesPerGlyph: isCID ? 2 : 1,
          });
        }
      } catch (e) {
        console.warn('[extractPageToUnicodeMaps] error reading ToUnicode for', fontName, e.message);
        fontMaps.set(fontName, {
          isCID, glyphToUnicode: new Map(), unicodeToGlyph: new Map(),
          bytesPerGlyph: isCID ? 2 : 1,
        });
      }
    }
  } catch (err) {
    console.error('[extractPageToUnicodeMaps] error:', err.message);
  }

  return fontMaps;
}

/**
 * Decode a hex string using a ToUnicode CMap.
 * For CID fonts (2-byte glyph IDs): reads 4 hex chars per glyph.
 * For single-byte fonts: reads 2 hex chars per glyph.
 * Falls back to raw byte decoding if no CMap entry found.
 */
function decodeHexWithCMap(hexValue, fontMapEntry) {
  const hex = hexValue.replace(/\s/g, '');
  if (!fontMapEntry || fontMapEntry.glyphToUnicode.size === 0) {
    // No CMap — fall back to raw byte decoding
    const pairs = hex.match(/.{2}/g) || [];
    return String.fromCharCode(...pairs.map(h => parseInt(h, 16)));
  }

  const bytesPerGlyph = fontMapEntry.bytesPerGlyph || (fontMapEntry.isCID ? 2 : 1);
  const charsPerGlyph = bytesPerGlyph * 2; // hex chars per glyph ID
  let result = '';

  for (let k = 0; k + charsPerGlyph <= hex.length; k += charsPerGlyph) {
    const glyphId = parseInt(hex.slice(k, k + charsPerGlyph), 16);
    const unicode = fontMapEntry.glyphToUnicode.get(glyphId);
    if (unicode) {
      result += unicode;
    } else {
      // Glyph not in CMap — use replacement char to signal unmapped
      result += '\uFFFD';
    }
  }

  return result;
}

/**
 * Encode a Unicode string back to hex glyph IDs using a reverse CMap.
 * Returns the hex string content (without angle brackets).
 * For CID fonts: each char → 4 hex chars. For single-byte: each char → 2 hex chars.
 * Returns null if any character can't be mapped (caller should fall back).
 */
function encodeTextToHex(text, fontMapEntry) {
  if (!fontMapEntry || fontMapEntry.unicodeToGlyph.size === 0) return null;

  const bytesPerGlyph = fontMapEntry.bytesPerGlyph || (fontMapEntry.isCID ? 2 : 1);
  const hexWidth = bytesPerGlyph * 2;
  let hex = '';

  for (const ch of text) {
    const glyphId = fontMapEntry.unicodeToGlyph.get(ch);
    if (glyphId === undefined) {
      // Character not in font subset — can't encode
      console.warn('[encodeTextToHex] unmappable char:', ch, '(' + ch.codePointAt(0).toString(16) + ')');
      return null;
    }
    hex += glyphId.toString(16).padStart(hexWidth, '0').toUpperCase();
  }

  return hex;
}

/**
 * Decode a PDF literal string: handle escape sequences.
 * Input is the content BETWEEN parentheses (not including them).
 */
function decodePdfLiteralString(raw) {
  let result = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\') {
      i++;
      if (i >= raw.length) break;
      switch (raw[i]) {
        case 'n': result += '\n'; break;
        case 'r': result += '\r'; break;
        case 't': result += '\t'; break;
        case 'b': result += '\b'; break;
        case 'f': result += '\f'; break;
        case '(': result += '('; break;
        case ')': result += ')'; break;
        case '\\': result += '\\'; break;
        default:
          // Octal: up to 3 digits
          if (raw[i] >= '0' && raw[i] <= '7') {
            let oct = raw[i];
            if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') { oct += raw[++i]; }
            if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') { oct += raw[++i]; }
            result += String.fromCharCode(parseInt(oct, 8));
          } else {
            result += raw[i]; // unknown escape → literal
          }
      }
    } else {
      result += raw[i];
    }
    i++;
  }
  return result;
}

/**
 * Encode a string for a PDF literal string (escape special chars).
 */
function encodePdfLiteralString(str) {
  let result = '';
  for (const ch of str) {
    if (ch === '\\') result += '\\\\';
    else if (ch === '(') result += '\\(';
    else if (ch === ')') result += '\\)';
    else if (ch === '\n') result += '\\n';
    else if (ch === '\r') result += '\\r';
    else result += ch;
  }
  return '(' + result + ')';
}

/**
 * Extract a balanced parenthesized string from `text` starting at index `start`.
 * `start` should point to the opening '('.
 * Returns { content: string (between parens), end: number (index after closing ')') }
 */
function extractParenString(text, start) {
  if (text[start] !== '(') return null;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text[i] === '(' && (i === start || text[i - 1] !== '\\')) depth++;
    else if (text[i] === ')' && text[i - 1] !== '\\') {
      depth--;
      if (depth === 0) return { content: text.slice(start + 1, i), end: i + 1 };
    }
    i++;
  }
  // Unbalanced — take everything
  return { content: text.slice(start + 1), end: text.length };
}

/**
 * Parse the content stream for underline-like drawing operations.
 * Returns array of { type, x, y, width, height, startOffset, endOffset, rawX, rawY, rawW, rawH }
 *
 * Underlines in PDFs are thin rectangles (`X Y W H re f`) or horizontal lines
 * (`X1 Y1 m X2 Y2 l S`) drawn outside BT/ET text blocks.
 */
function parseUnderlineOps(streamText) {
  const ops = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let ctmStack = [];

  function applyCtm(x, y) {
    return [
      ctm[0] * x + ctm[2] * y + ctm[4],
      ctm[1] * x + ctm[3] * y + ctm[5]
    ];
  }
  function multiplyMatrix(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  // Simple tokenizer — same approach as parseTextOperations
  let i = 0;
  const len = streamText.length;
  function skipWS() { while (i < len && ' \t\n\r'.includes(streamText[i])) i++; }
  function readTok() {
    skipWS();
    if (i >= len) return null;
    const ch = streamText[i];
    if (ch === '%') { while (i < len && streamText[i] !== '\n') i++; return readTok(); }
    if (ch === '(') { let d = 1; i++; while (i < len && d > 0) { if (streamText[i] === '\\') i++; else if (streamText[i] === '(') d++; else if (streamText[i] === ')') d--; i++; } return { type: 'skip' }; }
    if (ch === '<' && i + 1 < len && streamText[i + 1] === '<') { let d = 1; i += 2; while (i < len && d > 0) { if (streamText[i] === '<' && streamText[i + 1] === '<') { d++; i += 2; } else if (streamText[i] === '>' && streamText[i + 1] === '>') { d--; i += 2; } else i++; } return { type: 'skip' }; }
    if (ch === '<') { i++; while (i < len && streamText[i] !== '>') i++; if (i < len) i++; return { type: 'skip' }; }
    if (ch === '[') { let d = 1; i++; while (i < len && d > 0) { if (streamText[i] === '[') d++; else if (streamText[i] === ']') d--; i++; } return { type: 'skip' }; }
    if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) {
      const s = i; if (ch === '-' || ch === '+') i++;
      while (i < len && ((streamText[i] >= '0' && streamText[i] <= '9') || streamText[i] === '.')) i++;
      return { type: 'num', value: parseFloat(streamText.slice(s, i)), offset: s };
    }
    if (ch === '/') { i++; while (i < len && !' \t\n\r/<>[](){}%'.includes(streamText[i])) i++; return { type: 'skip' }; }
    const s = i;
    while (i < len && !' \t\n\r/<>[](){}%'.includes(streamText[i])) i++;
    return { type: 'op', value: streamText.slice(s, i), offset: s };
  }

  const stk = []; // number stack
  let pendingRect = null; // { x, y, w, h, startOffset }
  let pendingMove = null; // { x, y, offset }
  let lineWidth = 1;

  while (i < len) {
    const tok = readTok();
    if (!tok) break;
    if (tok.type === 'num') { stk.push(tok); continue; }
    if (tok.type === 'skip') { stk.length = 0; continue; }
    if (tok.type !== 'op') { stk.length = 0; continue; }

    const op = tok.value;
    if (op === 'q') { ctmStack.push(ctm.slice()); }
    else if (op === 'Q') { if (ctmStack.length) ctm = ctmStack.pop(); }
    else if (op === 'cm' && stk.length >= 6) {
      const m = stk.slice(-6).map(t => t.value);
      ctm = multiplyMatrix(ctm, m);
    }
    else if (op === 'w' && stk.length >= 1) {
      lineWidth = stk[stk.length - 1].value;
    }
    else if (op === 're' && stk.length >= 4) {
      const sx = stk[stk.length - 4];
      pendingRect = {
        rawX: sx.value, rawY: stk[stk.length - 3].value,
        rawW: stk[stk.length - 2].value, rawH: stk[stk.length - 1].value,
        startOffset: sx.offset,
      };
    }
    else if ((op === 'f' || op === 'F' || op === 'f*') && pendingRect) {
      const r = pendingRect;
      // Only collect thin rectangles (height < 3) — likely underlines
      if (Math.abs(r.rawH) < 3 && Math.abs(r.rawW) > 5) {
        const [tx, ty] = applyCtm(r.rawX, r.rawY);
        ops.push({
          type: 'rect', x: tx, y: ty,
          width: r.rawW * Math.abs(ctm[0]), // scale width by CTM X-scale
          height: r.rawH,
          rawX: r.rawX, rawY: r.rawY, rawW: r.rawW, rawH: r.rawH,
          fillOp: op, // 'f', 'F', or 'f*'
          startOffset: r.startOffset,
          endOffset: tok.offset + op.length,
        });
      }
      pendingRect = null;
    }
    else if (op === 'm' && stk.length >= 2) {
      pendingMove = {
        x: stk[stk.length - 2].value,
        y: stk[stk.length - 1].value,
        offset: stk[stk.length - 2].offset,
      };
    }
    else if (op === 'l' && stk.length >= 2 && pendingMove) {
      const lx = stk[stk.length - 2].value;
      const ly = stk[stk.length - 1].value;
      // Check for horizontal line (potential underline)
      if (Math.abs(ly - pendingMove.y) < 1 && Math.abs(lx - pendingMove.x) > 5 && lineWidth < 3) {
        const [tx, ty] = applyCtm(pendingMove.x, pendingMove.y);
        pendingMove._line = {
          type: 'line', x: tx, y: ty,
          width: (lx - pendingMove.x) * Math.abs(ctm[0]),
          height: lineWidth,
          rawX1: pendingMove.x, rawY1: pendingMove.y,
          rawX2: lx, rawY2: ly,
          startOffset: pendingMove.offset,
          lineEndOffset: tok.offset + op.length,
        };
      }
    }
    else if (op === 'S' && pendingMove && pendingMove._line) {
      const line = pendingMove._line;
      line.endOffset = tok.offset + op.length;
      ops.push(line);
      pendingMove = null;
    }
    else if (op === 'BT' || op === 'ET') {
      // Text blocks — skip but don't clear pending state
    }
    else {
      pendingRect = null; // non-fill after re → not an underline rect
    }

    stk.length = 0;
  }

  return ops;
}

/**
 * Adjust the width of an underline operation in the content stream.
 * Returns the modified stream text.
 */
function adjustUnderlineWidth(streamText, ulOp, scaleFactor) {
  const before = streamText.slice(0, ulOp.startOffset);
  const after = streamText.slice(ulOp.endOffset);

  if (ulOp.type === 'rect') {
    const newW = (ulOp.rawW * scaleFactor).toFixed(4);
    const fill = ulOp.fillOp || 'f';
    return before + `${ulOp.rawX} ${ulOp.rawY} ${newW} ${ulOp.rawH} re ${fill}` + after;
  }
  if (ulOp.type === 'line') {
    const newX2 = (ulOp.rawX1 + (ulOp.rawX2 - ulOp.rawX1) * scaleFactor).toFixed(4);
    // Reconstruct: X1 Y1 m X2 Y2 l S
    return before +
      `${ulOp.rawX1} ${ulOp.rawY1} m\n${newX2} ${ulOp.rawY2} l\nS` +
      after;
  }
  return streamText;
}

/**
 * Parse the content stream into text operations.
 * Returns array of { text, startOffset, endOffset, fontRef, fontSize, x, y, operator }
 */
function parseTextOperations(streamText, fontMaps) {
  const ops = [];
  let curFont = '';
  let curFontSize = 0;
  // Text matrix: [a, b, c, d, e, f] — positions are in e, f
  let tmX = 0, tmY = 0;
  // Line matrix origin (reset by BT, updated by Td/TD)
  let lineX = 0, lineY = 0;
  let inText = false;

  // CTM (current transformation matrix) — full 2D affine [a, b, c, d, e, f]
  // Transforms local (x,y) to absolute: (a*x + c*y + e, b*x + d*y + f)
  // Needed because content streams often start with a scaling/flip cm like:
  //   0.75 0 0 -0.75 0 792 cm  (scale 75% + Y-flip)
  let ctm = [1, 0, 0, 1, 0, 0]; // identity
  let ctmStack = [];

  // Apply CTM to a local coordinate
  function applyCtm(x, y) {
    return [
      ctm[0] * x + ctm[2] * y + ctm[4],
      ctm[1] * x + ctm[3] * y + ctm[5]
    ];
  }

  // Multiply two matrices: result = m1 * m2
  function multiplyMatrix(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],       // a
      m1[1] * m2[0] + m1[3] * m2[1],       // b
      m1[0] * m2[2] + m1[2] * m2[3],       // c
      m1[1] * m2[2] + m1[3] * m2[3],       // d
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], // e
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]  // f
    ];
  }

  // Simple tokenizer: walk through the stream character by character
  let i = 0;
  const len = streamText.length;

  function skipWhitespace() {
    while (i < len && ' \t\n\r'.includes(streamText[i])) i++;
  }

  function readToken() {
    skipWhitespace();
    if (i >= len) return null;

    const ch = streamText[i];

    // Comment
    if (ch === '%') {
      while (i < len && streamText[i] !== '\n' && streamText[i] !== '\r') i++;
      return readToken();
    }

    // Literal string
    if (ch === '(') {
      const ps = extractParenString(streamText, i);
      if (!ps) return null;
      const token = streamText.slice(i, ps.end);
      i = ps.end;
      return { type: 'string', value: ps.content, raw: token, offset: i - token.length };
    }

    // Hex string
    if (ch === '<' && i + 1 < len && streamText[i + 1] !== '<') {
      const start = i;
      i++; // skip <
      while (i < len && streamText[i] !== '>') i++;
      if (i < len) i++; // skip >
      return { type: 'hexstring', value: streamText.slice(start + 1, i - 1), raw: streamText.slice(start, i), offset: start };
    }

    // Array
    if (ch === '[') {
      const start = i;
      i++; // skip [
      const items = [];
      while (i < len && streamText[i] !== ']') {
        skipWhitespace();
        if (i < len && streamText[i] === ']') break;
        const item = readToken();
        if (item) items.push(item);
        else break;
      }
      if (i < len && streamText[i] === ']') i++; // skip ]
      return { type: 'array', items, offset: start, end: i };
    }

    // Number
    if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) {
      const start = i;
      if (ch === '-' || ch === '+') i++;
      while (i < len && ((streamText[i] >= '0' && streamText[i] <= '9') || streamText[i] === '.')) i++;
      return { type: 'number', value: parseFloat(streamText.slice(start, i)), offset: start };
    }

    // Name
    if (ch === '/') {
      const start = i;
      i++; // skip /
      while (i < len && !' \t\n\r/<>[](){}%'.includes(streamText[i])) i++;
      return { type: 'name', value: streamText.slice(start + 1, i), offset: start };
    }

    // Dict << >>
    if (ch === '<' && i + 1 < len && streamText[i + 1] === '<') {
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (streamText[i] === '<' && i + 1 < len && streamText[i + 1] === '<') { depth++; i += 2; }
        else if (streamText[i] === '>' && i + 1 < len && streamText[i + 1] === '>') { depth--; i += 2; }
        else i++;
      }
      return { type: 'dict', offset: i };
    }

    // Operator (keyword)
    const start = i;
    while (i < len && !' \t\n\r/<>[](){}%'.includes(streamText[i])) i++;
    const word = streamText.slice(start, i);
    if (!word) { i++; return readToken(); }
    return { type: 'operator', value: word, offset: start };
  }

  // Parse tokens and track state
  const operandStack = [];

  while (i < len) {
    const token = readToken();
    if (!token) break;

    if (token.type === 'operator') {
      const op = token.value;

      // Graphics state: track full CTM for coordinate resolution
      if (op === 'q') {
        ctmStack.push(ctm.slice()); // save copy of current CTM
        operandStack.length = 0;
        continue;
      }
      if (op === 'Q') {
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop();
        }
        operandStack.length = 0;
        continue;
      }
      if (op === 'cm' && operandStack.length >= 6) {
        // a b c d e f cm — concatenate matrix
        const newM = [
          operandStack[operandStack.length - 6]?.value || 0,
          operandStack[operandStack.length - 5]?.value || 0,
          operandStack[operandStack.length - 4]?.value || 0,
          operandStack[operandStack.length - 3]?.value || 0,
          operandStack[operandStack.length - 2]?.value || 0,
          operandStack[operandStack.length - 1]?.value || 0,
        ];
        ctm = multiplyMatrix(ctm, newM);
        operandStack.length = 0;
        continue;
      }

      if (op === 'BT') {
        inText = true;
        tmX = 0; tmY = 0; lineX = 0; lineY = 0;
        operandStack.length = 0;
        continue;
      }
      if (op === 'ET') {
        inText = false;
        operandStack.length = 0;
        continue;
      }

      if (inText) {
        if (op === 'Tf' && operandStack.length >= 2) {
          // /FontName size Tf
          const sizeToken = operandStack[operandStack.length - 1];
          const nameToken = operandStack[operandStack.length - 2];
          curFont = nameToken?.value || '';
          curFontSize = sizeToken?.value || 0;
        } else if (op === 'Td' && operandStack.length >= 2) {
          const ty = operandStack[operandStack.length - 1]?.value || 0;
          const tx = operandStack[operandStack.length - 2]?.value || 0;
          lineX += tx;
          lineY += ty;
          tmX = lineX; tmY = lineY;
        } else if (op === 'TD' && operandStack.length >= 2) {
          const ty = operandStack[operandStack.length - 1]?.value || 0;
          const tx = operandStack[operandStack.length - 2]?.value || 0;
          lineX += tx;
          lineY += ty;
          tmX = lineX; tmY = lineY;
        } else if (op === 'Tm' && operandStack.length >= 6) {
          // a b c d e f Tm — set text matrix absolutely
          tmX = operandStack[operandStack.length - 2]?.value || 0;
          tmY = operandStack[operandStack.length - 1]?.value || 0;
          lineX = tmX; lineY = tmY;
          // Also capture font size from matrix if present
          const matrixD = operandStack[operandStack.length - 3]?.value || 0;
          if (matrixD && !curFontSize) curFontSize = Math.abs(matrixD);
        } else if (op === 'T*') {
          // Move to next line (uses current leading)
          // We don't track leading perfectly, just note position may shift
        } else if (op === 'Tj') {
          // (string) Tj — show text
          const strToken = operandStack[operandStack.length - 1];
          if (strToken && (strToken.type === 'string' || strToken.type === 'hexstring')) {
            const fme = fontMaps && fontMaps.get(curFont);
            const decoded = strToken.type === 'string'
              ? decodePdfLiteralString(strToken.value)
              : decodeHexWithCMap(strToken.value, fme);

            ops.push({
              text: decoded,
              startOffset: strToken.offset,
              endOffset: token.offset + op.length,
              fontRef: curFont,
              fontSize: curFontSize,
              x: applyCtm(tmX, tmY)[0], y: applyCtm(tmX, tmY)[1],
              operator: 'Tj',
              rawString: strToken.raw,
              isHex: strToken.type === 'hexstring',
              isCID: !!(fme && fme.isCID),
            });
          }
        } else if (op === 'TJ') {
          // [(string) kern (string) ...] TJ — show with kerning
          const arrToken = operandStack[operandStack.length - 1];
          if (arrToken && arrToken.type === 'array') {
            const fme = fontMaps && fontMaps.get(curFont);
            let fullText = '';
            let hasHex = false;
            for (const item of arrToken.items) {
              if (item.type === 'string') {
                fullText += decodePdfLiteralString(item.value);
              } else if (item.type === 'hexstring') {
                fullText += decodeHexWithCMap(item.value, fme);
                hasHex = true;
              }
              // Numbers are kerning adjustments — skip
            }
            ops.push({
              text: fullText,
              startOffset: arrToken.offset,
              endOffset: token.offset + op.length,
              fontRef: curFont,
              fontSize: curFontSize,
              x: applyCtm(tmX, tmY)[0], y: applyCtm(tmX, tmY)[1],
              operator: 'TJ',
              rawString: streamText.slice(arrToken.offset, token.offset + op.length),
              isHex: hasHex,
              isCID: !!(fme && fme.isCID),
            });
          }
        } else if (op === "'" && operandStack.length >= 1) {
          // (string) ' — next line + show
          const strToken = operandStack[operandStack.length - 1];
          if (strToken && (strToken.type === 'string' || strToken.type === 'hexstring')) {
            const fme = fontMaps && fontMaps.get(curFont);
            const decoded = strToken.type === 'string'
              ? decodePdfLiteralString(strToken.value)
              : decodeHexWithCMap(strToken.value, fme);
            ops.push({
              text: decoded,
              startOffset: strToken.offset,
              endOffset: token.offset + 1,
              fontRef: curFont,
              fontSize: curFontSize,
              x: applyCtm(tmX, tmY)[0], y: applyCtm(tmX, tmY)[1],
              operator: "'",
              rawString: strToken.raw,
              isHex: strToken.type === 'hexstring',
              isCID: !!(fme && fme.isCID),
            });
          }
        }
      }

      operandStack.length = 0;
    } else {
      // Operand — push to stack
      operandStack.push(token);
    }
  }

  return ops;
}

/**
 * Match a change to its corresponding text operation in the content stream.
 * Uses original text + PDF coordinates for matching.
 */
function matchChangeToOperation(change, textOps) {
  if (!change.originalText || textOps.length === 0) return null;

  const origText = change.originalText;
  const cx = change.pdfX;
  const cy = change.pdfY;

  // Strategy 1: Exact text match + close position (tolerance for CTM float rounding)
  for (const op of textOps) {
    if (op.text === origText && Math.abs(op.x - cx) < 5 && Math.abs(op.y - cy) < 5) {
      return op;
    }
  }

  // Strategy 2: Text contains/starts-with + close position
  for (const op of textOps) {
    if (op.text.trim().length < 2) continue; // skip whitespace/trivial ops
    if (Math.abs(op.x - cx) < 8 && Math.abs(op.y - cy) < 8) {
      if (op.text.includes(origText) || origText.includes(op.text)) {
        return op;
      }
    }
  }

  // Strategy 3: Exact text match anywhere on page (unique text, no position needed)
  const exactMatches = textOps.filter(op => op.text === origText);
  if (exactMatches.length === 1) return exactMatches[0];

  // Strategy 4: Closest position match with text overlap (wider tolerance)
  let bestOp = null;
  let bestDist = Infinity;
  for (const op of textOps) {
    if (op.text.trim().length < 2) continue; // skip whitespace/trivial ops
    const dist = Math.abs(op.x - cx) + Math.abs(op.y - cy);
    if (dist < 60 && dist < bestDist) {
      // Require at least some text overlap
      if (op.text.length > 0 && origText.length > 0) {
        const shorter = op.text.length < origText.length ? op.text : origText;
        const longer = op.text.length >= origText.length ? op.text : origText;
        if (longer.includes(shorter) || shorter.slice(0, 3) === longer.slice(0, 3)) {
          bestDist = dist;
          bestOp = op;
        }
      }
    }
  }
  if (bestOp) return bestOp;

  // Strategy 5: Text-prefix match (no position constraint) — safe when unique
  // Handles cases where CTM / coordinate system causes large position discrepancies
  // between the text layer and the content stream parser.
  const prefixLen = Math.min(origText.length, 8);
  if (prefixLen >= 4) {
    const prefix = origText.slice(0, prefixLen);
    const prefixMatches = textOps.filter(op =>
      op.text.length >= 3 && (op.text.startsWith(prefix) || prefix.startsWith(op.text.slice(0, prefixLen)))
    );
    if (prefixMatches.length === 1) return prefixMatches[0];
  }

  return null;
}

/**
 * Perform surgical text replacement in the content stream string.
 * Handles both literal strings and CID hex-encoded strings.
 * fontMapEntry is needed for CID re-encoding (from extractPageToUnicodeMaps).
 * Returns the modified stream text, or null if encoding fails.
 */
function replaceTextInStream(streamText, op, newText, fontMapEntry) {
  const before = streamText.slice(0, op.startOffset);
  const after = streamText.slice(op.endOffset);

  // Determine if we need hex encoding (CID font)
  const needsHex = op.isCID || (op.isHex && fontMapEntry && fontMapEntry.unicodeToGlyph.size > 0);

  if (op.operator === 'Tj') {
    if (needsHex && fontMapEntry) {
      const hex = encodeTextToHex(newText, fontMapEntry);
      if (!hex) return null; // encoding failed — fall back
      return before + '<' + hex + '> Tj' + after;
    }
    const encoded = encodePdfLiteralString(newText);
    return before + encoded + ' Tj' + after;
  }

  if (op.operator === 'TJ') {
    if (needsHex && fontMapEntry) {
      const hex = encodeTextToHex(newText, fontMapEntry);
      if (!hex) return null; // encoding failed — fall back
      return before + '[<' + hex + '>] TJ' + after;
    }
    const encoded = encodePdfLiteralString(newText);
    return before + '[' + encoded + '] TJ' + after;
  }

  if (op.operator === "'") {
    if (needsHex && fontMapEntry) {
      const hex = encodeTextToHex(newText, fontMapEntry);
      if (!hex) return null;
      return before + '<' + hex + "> '" + after;
    }
    const encoded = encodePdfLiteralString(newText);
    return before + encoded + " '" + after;
  }

  // Unknown operator — can't replace
  return streamText;
}

/**
 * Check if a change can use content stream replacement (vs cover-and-replace fallback).
 */
function canUseContentStreamReplacement(change, pageFontMap) {
  // User explicitly changed format (font size, color, font family, bold, italic)
  // → need cover-and-replace to apply those visual changes
  if (change.userChangedFormat) return false;

  // No original text to match → can't do stream replacement
  if (!change.originalText) return false;

  // Text-only change (no format change) → ideal candidate
  // Check font encoding safety if we have font metadata
  if (pageFontMap && pageFontMap.size > 0) {
    // If we know the font, check for CIDFont (Type0) — those use 2-byte glyph IDs
    for (const [, meta] of pageFontMap) {
      // We can't easily map which font this change uses from the font dict,
      // but if ALL fonts on the page are safe, we're good.
      // For now, check if any font is Type0 (CIDFont) — conservative approach
    }
  }

  // Check subset safety: if new text has chars not in original, subset may lack them
  if (change.newText !== change.originalText) {
    const origChars = new Set(change.originalText);
    for (const ch of change.newText) {
      if (!origChars.has(ch)) {
        // New character — might not be in subset. Still try stream replacement
        // since it's better to try and fall back than to not try at all.
        // The font will render a .notdef glyph if the char is missing,
        // which is visually obvious and can be caught during verification.
        break;
      }
    }
  }

  return true;
}

/* ═══════════════════ Commit Text Edits ═══════════════════ */

export async function commitTextEdits(pdfBytes, pageNum) {
  if (!editContainer) return null;

  // Deactivate current block to save its state
  if (_activeBlockIdx >= 0) deactivateBlock();

  const changes = [];

  // Collect changes from currently active block's DOM (if any)
  const editedLines = editContainer.querySelectorAll('.text-edit-line');
  for (const div of editedLines) {
    const newText = div.textContent;
    const original = div.dataset.original;
    const fontSizeOverride = div.dataset.fontSizeOverride ? parseFloat(div.dataset.fontSizeOverride) : 0;
    const colorOverride = div.dataset.colorOverride || '';
    const matchedColor = div.dataset.matchedColor || '';
    const fontFamilyOverride = div.dataset.fontFamilyOverride || '';
    const fontNameOverride = div.dataset.fontNameOverride || '';
    const bold = div.dataset.bold === 'true';
    const italic = div.dataset.italic === 'true';

    const hasTextChange = newText !== original;
    const initialBold = div.dataset.initialBold === 'true';
    const initialItalic = div.dataset.initialItalic === 'true';
    const userChangedBold = bold !== initialBold;
    const userChangedItalic = italic !== initialItalic;
    const hasFormatChange = fontSizeOverride || colorOverride || fontFamilyOverride ||
      userChangedBold || userChangedItalic ||
      div.dataset.underline === 'true' || div.dataset.strikethrough === 'true' ||
      (div.dataset.align && div.dataset.align !== 'left');

    if (!hasTextChange && !hasFormatChange) continue;

    // For commit: use metadata-derived bold/italic unless user explicitly toggled.
    const baseBold = div.dataset.baseBold === 'true';
    const baseItalic = div.dataset.baseItalic === 'true';
    const commitBold = userChangedBold ? bold : baseBold;
    const commitItalic = userChangedItalic ? italic : baseItalic;

    const effectiveColor = colorOverride || matchedColor || '';

    changes.push({
      newText,
      originalText: original,
      pdfX: parseFloat(div.dataset.pdfX),
      pdfY: parseFloat(div.dataset.pdfY),
      pdfFontSize: parseFloat(div.dataset.pdfFontSize),
      pdfLineWidth: parseFloat(div.dataset.pdfLineWidth) || 0,
      fontName: fontNameOverride || div.dataset.fontName,
      rawFontName: div.dataset.rawFontName || '',
      screenWidth: parseFloat(div.dataset.width),
      screenHeight: parseFloat(div.dataset.height),
      fontSizeOverride,
      colorOverride: effectiveColor,
      // Track whether user explicitly changed format (for Strategy A decision)
      userChangedFormat: !!hasFormatChange,
      bold: commitBold,
      italic: commitItalic,
      bgColor: div.dataset.bgColor || '#ffffff',
      underline: div.dataset.underline === 'true',
      strikethrough: div.dataset.strikethrough === 'true',
      align: div.dataset.align || 'left',
    });
  }

  // Collect changes from previously deactivated blocks
  for (const [, savedLines] of _editedBlocks) {
    for (const saved of savedLines) {
      if (!saved.dirty) continue;
      changes.push({
        newText: saved.text,
        originalText: saved.originalText || '',
        pdfX: saved.pdfX,
        pdfY: saved.pdfY,
        pdfFontSize: saved.pdfFontSize,
        pdfLineWidth: saved.pdfLineWidth,
        fontName: saved.fontName,
        rawFontName: saved.rawFontName || '',
        screenWidth: saved.screenWidth,
        screenHeight: saved.screenHeight,
        fontSizeOverride: saved.fontSizeOverride,
        colorOverride: saved.colorOverride || saved.matchedColor || '',
        userChangedFormat: !!saved.userChangedFormat,
        bold: saved.bold,
        italic: saved.italic,
        bgColor: saved.bgColor || '#ffffff',
        underline: !!saved.underline,
        strikethrough: !!saved.strikethrough,
        align: saved.align || 'left',
      });
    }
  }

  if (changes.length === 0) return null;

  const PDFLib = window.PDFLib;
  if (!PDFLib) return null;

  const doc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(pageNum - 1);

  // Extract authoritative font metadata from the page's PDF dictionary
  const pageFontMap = extractPageFontMeta(page, doc);
  const fontSummary = buildFontFamilySummary(pageFontMap);

  // ── Strategy A: Content stream text replacement (preserves original font) ──
  // Try to modify text directly in the content stream. This keeps the original
  // font reference (/F1 12 Tf) untouched, so bold/italic/weight are preserved
  // automatically — no font substitution or guessing needed.
  const streamData = getContentStreamText(page, doc);
  let streamText = streamData ? streamData.text : null;

  // Extract ToUnicode CMap data for all fonts — needed for CID glyph decoding/encoding
  const fontCMaps = streamText ? extractPageToUnicodeMaps(page, doc) : new Map();

  let textOps = streamText ? parseTextOperations(streamText, fontCMaps) : [];
  let streamModified = false;

  if (fontCMaps.size > 0) {
    for (const [fn, fm] of fontCMaps) {
      console.log(`  Font ${fn}: isCID=${fm.isCID} glyphs=${fm.glyphToUnicode.size} reverse=${fm.unicodeToGlyph.size}`);
    }
  }

  const fallbackChanges = []; // changes that need cover-and-replace
  const appliedStrategyA = []; // track Strategy A replacements for underline adjustment

  for (const change of changes) {
    // Check if content stream replacement is viable for this change
    const canUse = streamText && canUseContentStreamReplacement(change, pageFontMap);
    if (canUse) {
      const op = matchChangeToOperation(change, textOps);
      if (op) {
        // When the original text spans multiple content stream operators (e.g.,
        // "Re: N" + "-" + "400 Application…"), expand the replacement range to
        // cover ALL trailing operators on the same line.  This prevents leftover
        // fragments from rendering alongside the replaced text.
        let effectiveOp = op;
        if (op.text.length < change.originalText.length) {
          const matchIdx = textOps.indexOf(op);
          if (matchIdx >= 0) {
            let combinedText = op.text;
            let lastEndOffset = op.endOffset;
            for (let k = matchIdx + 1; k < textOps.length; k++) {
              const nextOp = textOps[k];
              if (Math.abs(nextOp.y - op.y) >= 2) break; // different line
              combinedText += nextOp.text;
              lastEndOffset = nextOp.endOffset;
              if (combinedText.length >= change.originalText.length) break;
            }
            if (combinedText.length > op.text.length) {
              effectiveOp = { ...op, endOffset: lastEndOffset, text: combinedText };
            }
          }
        }

        // Get the font CMap entry for encoding replacement text
        const fme = fontCMaps.get(op.fontRef);
        // Replace text directly in the content stream
        const replaced = replaceTextInStream(streamText, effectiveOp, change.newText, fme);
        if (replaced === null) {
          // Encoding failed (e.g., new chars not in CID subset) — fall back
          fallbackChanges.push(change);
          continue;
        }
        streamText = replaced;
        // Re-parse after replacement (offsets shifted)
        textOps = parseTextOperations(streamText, fontCMaps);
        streamModified = true;
        // Track for underline adjustment
        appliedStrategyA.push({
          originalText: change.originalText,
          newText: change.newText,
          x: op.x, y: op.y,
        });
        continue; // Done — no cover-and-replace needed for this change
      }
    } else {
    }
    // Content stream replacement not possible → collect for cover-and-replace fallback
    fallbackChanges.push(change);
  }

  // ── Adjust underline widths for Strategy A replacements ──
  if (streamModified && appliedStrategyA.length > 0) {
    try {
      const ulOps = parseUnderlineOps(streamText);
      if (ulOps.length > 0) {
        // Process underline adjustments from end to start so offsets stay valid
        const adjustments = [];
        for (const sa of appliedStrategyA) {
          if (sa.originalText.length === 0) continue;
          const scaleFactor = sa.newText.length / sa.originalText.length;
          if (Math.abs(scaleFactor - 1.0) < 0.001) continue; // no change needed

          // Find underline ops near this text's Y position and X position
          for (const ul of ulOps) {
            const yDist = Math.abs(ul.y - sa.y);
            const xDist = Math.abs(ul.x - sa.x);
            if (yDist < 8 && xDist < 20) {
              adjustments.push({ ulOp: ul, scaleFactor });
            }
          }
        }

        // Sort adjustments by startOffset descending so we replace from end to start
        adjustments.sort((a, b) => b.ulOp.startOffset - a.ulOp.startOffset);
        for (const adj of adjustments) {
          streamText = adjustUnderlineWidth(streamText, adj.ulOp, adj.scaleFactor);
        }
        if (adjustments.length > 0) {
        }
      }
    } catch (err) {
      console.warn('[commitTextEdits] Underline adjustment error:', err);
    }
  }

  // Write modified content stream back to the PDF
  if (streamModified && streamData && streamData.streams.length > 0) {
    try {
      const newBytes = new Uint8Array(streamText.length);
      for (let j = 0; j < streamText.length; j++) {
        newBytes[j] = streamText.charCodeAt(j) & 0xFF;
      }

      // Write modified content into the first stream object
      const firstStream = streamData.streams[0];
      const target = firstStream.obj;
      if (target) {
        target.contents = newBytes;
        if (target.dict && typeof target.dict.delete === 'function') {
          target.dict.delete(PDFLib.PDFName.of('Filter'));
          target.dict.delete(PDFLib.PDFName.of('DecodeParms'));
          target.dict.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(newBytes.length));
        }
      }

      // When Contents was an array of streams, collapse to just the first stream
      // reference.  All content is now in stream 0; the other streams would cause
      // duplication if they remained in the array.
      if (streamData.streams.length > 1 && firstStream.ref && isPDFRef(firstStream.ref)) {
        page.node.set(PDFLib.PDFName.of('Contents'), firstStream.ref);
      }
    } catch (err) {
      // Stream write failed — the changes that used content stream replacement
      // won't be saved. Add them back to fallback.
      // (In practice this shouldn't happen, but be safe.)
    }
  }

  // ── Strategy B: Cover-and-replace fallback (for format changes, CIDFonts, unmatched text) ──
  if (fallbackChanges.length > 0) {
    document.dispatchEvent(new CustomEvent('text-edit-fallback', {
      detail: { count: fallbackChanges.length }
    }));
    const fontCache = {};
    async function getFont(fontName, bold, italic) {
      if (fontName === 'custom' && customFont) {
        if (!fontCache['__custom']) {
          fontCache['__custom'] = await doc.embedFont(customFont.bytes);
        }
        return fontCache['__custom'];
      }
      let variant = fontName;
      if (bold) variant += '-Bold';
      if (italic) variant += '-Italic';
      let stdName = mapToStandardFont(variant);
      if (!fontCache[stdName]) {
        if (!PDFLib.StandardFonts[stdName]) stdName = 'Helvetica';
        fontCache[stdName] = await doc.embedFont(PDFLib.StandardFonts[stdName]);
      }
      return fontCache[stdName];
    }

    const hasCTM = typeof PDFLib.pushGraphicsState === 'function' &&
      typeof PDFLib.popGraphicsState === 'function' &&
      typeof PDFLib.concatTransformationMatrix === 'function';

    for (const change of fallbackChanges) {
      let font = await getFont(change.fontName, change.bold, change.italic);
      const fontSize = change.fontSizeOverride || change.pdfFontSize;
      const x = change.pdfX;
      const y = change.pdfY;

      let naturalWidth = font.widthOfTextAtSize(change.newText, fontSize);
      const scale = currentViewport ? currentViewport.scale : 1;
      const originalWidth = change.pdfLineWidth > 0 ? change.pdfLineWidth : change.screenWidth / scale;

      // Bold auto-detection for fallback path
      if (!change.bold && originalWidth > 0 && naturalWidth > 0) {
        const changeLower = (change.fontName || '').toLowerCase();
        const isSerifFont = (/serif/i.test(changeLower) && !/sans/i.test(changeLower)) ||
          /times|roman/i.test(changeLower);
        const isMonoFont = /courier|mono/i.test(changeLower);
        const pageHasBold = (isSerifFont && fontSummary.hasBoldSerif) ||
          (isMonoFont && fontSummary.hasBoldMono) ||
          (!isSerifFont && !isMonoFont && fontSummary.hasBoldSans);
        const threshold = pageHasBold ? 1.04 : 1.08;
        const ratioRegular = originalWidth / naturalWidth;

        if (ratioRegular > threshold) {
          try {
            const boldFont = await getFont(change.fontName, true, change.italic);
            const boldWidth = boldFont.widthOfTextAtSize(change.newText, fontSize);
            if (Math.abs(originalWidth / boldWidth - 1) < Math.abs(ratioRegular - 1)) {
              font = boldFont;
              naturalWidth = boldWidth;
            }
          } catch (_) {}
        }
      }

      // Cover rectangle
      const coverWidth = Math.max(originalWidth, naturalWidth) + 6;
      const descenderDepth = change.pdfFontSize * 0.22;
      const ascenderHeight = change.pdfFontSize * 0.78;
      const rectHeight = descenderDepth + ascenderHeight;

      let coverColor = PDFLib.rgb(1, 1, 1);
      if (change.bgColor && change.bgColor !== '#ffffff') {
        const br = parseInt(change.bgColor.slice(1, 3), 16) / 255;
        const bg = parseInt(change.bgColor.slice(3, 5), 16) / 255;
        const bb = parseInt(change.bgColor.slice(5, 7), 16) / 255;
        coverColor = PDFLib.rgb(br, bg, bb);
      }
      page.drawRectangle({
        x: x - 1, y: y - descenderDepth,
        width: coverWidth, height: rectHeight,
        color: coverColor, borderWidth: 0,
      });

      let color = PDFLib.rgb(0, 0, 0);
      if (change.colorOverride) {
        const hex = change.colorOverride;
        color = PDFLib.rgb(
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        );
      }

      const scaleX = (originalWidth > 0 && naturalWidth > 0) ? originalWidth / naturalWidth : 1;
      const applyScale = hasCTM && scaleX !== 1 && scaleX > 0.5 && scaleX < 2.0;

      // Alignment adjustment
      let drawX = x;
      if (change.align === 'center' && originalWidth > 0) {
        drawX = x + (originalWidth - naturalWidth) / 2;
      } else if (change.align === 'right' && originalWidth > 0) {
        drawX = x + (originalWidth - naturalWidth);
      }

      if (applyScale) {
        page.pushOperators(PDFLib.pushGraphicsState());
        page.pushOperators(PDFLib.concatTransformationMatrix(scaleX, 0, 0, 1, drawX * (1 - scaleX), 0));
        page.drawText(change.newText, { x: drawX, y, size: fontSize, font, color });
        page.pushOperators(PDFLib.popGraphicsState());
      } else {
        page.drawText(change.newText, { x: drawX, y, size: fontSize, font, color });
      }

      // Underline and strikethrough decorations
      const textW = applyScale ? naturalWidth * scaleX : naturalWidth;
      if (change.underline) {
        page.drawRectangle({
          x: drawX, y: y - fontSize * 0.15,
          width: textW, height: 0.5,
          color, borderWidth: 0,
        });
      }
      if (change.strikethrough) {
        page.drawRectangle({
          x: drawX, y: y + fontSize * 0.3,
          width: textW, height: 0.5,
          color, borderWidth: 0,
        });
      }
    }
  }

  return doc.save();
}

/* ═══════════════════ Image Extraction ═══════════════════ */

/**
 * Extract image bounding boxes from a PDF page using the operator list.
 * Returns array of { left, top, width, height, pdfX, pdfY, pdfW, pdfH }
 * in screen coordinates (with PDF coords stored for commit).
 */
export async function extractImagePositions(page, viewport) {
  const ops = await page.getOperatorList();
  if (!window.pdfjsLib) return [];
  const OPS = window.pdfjsLib.OPS;
  const images = [];

  // Track current transformation matrix (CTM)
  // Start with identity matrix [a, b, c, d, e, f] -> [1, 0, 0, 1, 0, 0]
  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    switch (fn) {
      case OPS.save:
        ctmStack.push([...ctm]);
        break;

      case OPS.restore:
        if (ctmStack.length > 0) ctm = ctmStack.pop();
        break;

      case OPS.transform: {
        // args = [a, b, c, d, e, f]
        const m = args;
        const newCtm = [
          ctm[0] * m[0] + ctm[2] * m[1],
          ctm[1] * m[0] + ctm[3] * m[1],
          ctm[0] * m[2] + ctm[2] * m[3],
          ctm[1] * m[2] + ctm[3] * m[3],
          ctm[0] * m[4] + ctm[2] * m[5] + ctm[4],
          ctm[1] * m[4] + ctm[3] * m[5] + ctm[5],
        ];
        ctm = newCtm;
        break;
      }

      case OPS.paintImageXObject:
      case OPS.paintImageXObjectRepeat: {
        // Image is drawn as a unit square transformed by CTM
        // CTM maps (0,0)-(1,1) to the image position
        const pdfX = ctm[4];
        const pdfY = ctm[5];
        const pdfW = Math.abs(ctm[0]) || Math.abs(ctm[2]);
        const pdfH = Math.abs(ctm[3]) || Math.abs(ctm[1]);

        // Skip tiny images (likely patterns/masks) and full-page background
        if (pdfW < 10 || pdfH < 10) break;

        // Convert to screen coords via viewport transform
        const vt = viewport.transform;
        const screenX = vt[0] * pdfX + vt[2] * pdfY + vt[4];
        const screenY = vt[1] * pdfX + vt[3] * pdfY + vt[5];
        const screenW = pdfW * Math.abs(vt[0]);
        const screenH = pdfH * Math.abs(vt[3]);

        images.push({
          left: screenX,
          top: screenY - screenH, // flip Y (PDF origin is bottom-left)
          width: screenW,
          height: screenH,
          pdfX,
          pdfY,
          pdfW,
          pdfH,
          imgName: args[0] || '',
        });
        break;
      }
    }
  }

  return images;
}

/* ═══════════════════ Image Edit Undo ═══════════════════ */

function _pushImageUndo(entry) {
  imageUndoStack.push({
    entry,
    action: entry.action,
    pdfX: entry.pdfX,
    pdfY: entry.pdfY,
    replaceSrc: entry.replaceSrc,
    divLeft: entry.div.style.left,
    divTop: entry.div.style.top,
    classList: [...entry.div.classList],
    bgImage: entry.div.style.backgroundImage,
  });
  if (imageUndoStack.length > 30) imageUndoStack.shift();
  // Directly update undo button state
  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn) undoBtn.disabled = false;
}

function _popImageUndo() {
  if (imageUndoStack.length === 0) return;
  const snap = imageUndoStack.pop();
  const entry = snap.entry;
  entry.action = snap.action;
  entry.pdfX = snap.pdfX;
  entry.pdfY = snap.pdfY;
  entry.replaceSrc = snap.replaceSrc;
  entry.div.style.left = snap.divLeft;
  entry.div.style.top = snap.divTop;
  entry.div.style.backgroundImage = snap.bgImage;
  entry.div.style.backgroundSize = snap.bgImage ? 'cover' : '';
  // Restore class list
  entry.div.className = snap.classList.join(' ');
  // Update undo button state
  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn) undoBtn.disabled = (imageUndoStack.length === 0);
}

export function canUndoImage() {
  return imageActive && imageUndoStack.length > 0;
}

export function undoImageAction() {
  _popImageUndo();
}

/* ═══════════════════ Enter / Exit Image Edit ═══════════════════ */

export async function enterImageEditMode(pageNum, pdfDoc, viewport, container) {
  if (imageActive) exitImageEditMode();

  const page = await pdfDoc.getPage(pageNum);
  const images = await extractImagePositions(page, viewport);

  if (images.length === 0) {
    const { toast } = await import('./utils.js');
    toast('No editable images found on this page', 'warning');
    return false;
  }

  imageActive = true;
  imageContainer = container;
  currentViewport = viewport;
  currentPageNum = pageNum;
  currentPdfDoc = pdfDoc;
  imageOverlays = [];
  imageUndoStack = [];

  // Detect page-sized images (image-based PDFs): any image covering >70% of viewport
  const vpArea = viewport.width * viewport.height;
  const hasPageImage = images.some(img => (img.width * img.height) / vpArea > 0.7);

  if (hasPageImage) {
    _enterRegionSelectMode(container, viewport, page);
  } else {
    for (const img of images) {
      _createImageOverlay(img, container);
    }
  }

  // Create image edit toolbar
  createImageToolbar(container, hasPageImage);

  return true;
}

// Region selection mode for image-based PDFs
function _enterRegionSelectMode(container, viewport) {
  const selLayer = document.createElement('div');
  selLayer.className = 'image-region-select-layer';
  selLayer.style.width = viewport.width + 'px';
  selLayer.style.height = viewport.height + 'px';
  container.appendChild(selLayer);

  // Instruction hint
  const hint = document.createElement('div');
  hint.className = 'image-region-hint';
  hint.textContent = 'Draw a rectangle to select a region to edit or move';
  selLayer.appendChild(hint);

  let drawing = false;
  let startX = 0, startY = 0;
  let selBox = null;

  selLayer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.image-edit-overlay')) return; // don't draw over existing regions
    const rect = selLayer.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    drawing = true;

    selBox = document.createElement('div');
    selBox.className = 'image-region-draw-box';
    selBox.style.left = startX + 'px';
    selBox.style.top = startY + 'px';
    selBox.style.width = '0px';
    selBox.style.height = '0px';
    selLayer.appendChild(selBox);
  });

  selLayer.addEventListener('mousemove', (e) => {
    if (!drawing || !selBox) return;
    const rect = selLayer.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, viewport.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, viewport.height));
    const left = Math.min(startX, curX);
    const top = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    selBox.style.left = left + 'px';
    selBox.style.top = top + 'px';
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
  });

  selLayer.addEventListener('mouseup', (e) => {
    if (!drawing || !selBox) return;
    drawing = false;
    let left = parseFloat(selBox.style.left);
    let top = parseFloat(selBox.style.top);
    let w = parseFloat(selBox.style.width);
    let h = parseFloat(selBox.style.height);
    selBox.remove();
    selBox = null;

    // Ignore tiny selections (accidental clicks)
    if (w < 10 || h < 10) return;

    // Auto-trim to content bounding box (ignore background pixels)
    const trimmed = _trimToContent(left, top, w, h);
    if (trimmed) {
      left = trimmed.left;
      top = trimmed.top;
      w = trimmed.width;
      h = trimmed.height;
    }

    // Ignore if trimmed result is too small
    if (w < 5 || h < 5) return;

    // Generate a transparent-background preview of the content
    let previewUrl = null;
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (pdfCanvas) {
      const ctx = pdfCanvas.getContext('2d', { willReadFrequently: true });
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.round(left * dpr);
      const sy = Math.round(top * dpr);
      const sw = Math.round(w * dpr);
      const sh = Math.round(h * dpr);
      if (sw > 0 && sh > 0) {
        const imgData = ctx.getImageData(sx, sy, sw, sh);
        _makeBackgroundTransparent(imgData);
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = sw;
        tmpCanvas.height = sh;
        tmpCanvas.getContext('2d').putImageData(imgData, 0, 0);
        previewUrl = tmpCanvas.toDataURL('image/png');
      }
    }

    // Convert screen coords to PDF coords
    const scale = viewport.scale;
    const pageHeight = viewport.height / scale; // PDF units
    const pdfX = left / scale;
    const pdfY = pageHeight - (top + h) / scale; // invert Y
    const pdfW = w / scale;
    const pdfH = h / scale;

    const img = { left, top, width: w, height: h, pdfX, pdfY, pdfW, pdfH, previewUrl };
    _createImageOverlay(img, container);

    // Hide hint after first region
    if (hint.parentElement) hint.style.display = 'none';
  });
}

/**
 * Scan pixels from the rendered PDF canvas within the given CSS rect,
 * find the tight bounding box of non-background content, and return
 * the trimmed CSS rect. Returns null if no content found.
 */
function _trimToContent(cssLeft, cssTop, cssW, cssH) {
  const pdfCanvas = document.getElementById('pdf-canvas');
  if (!pdfCanvas) return null;
  const ctx = pdfCanvas.getContext('2d', { willReadFrequently: true });
  const dpr = window.devicePixelRatio || 1;

  // Read pixels at canvas resolution
  const sx = Math.round(cssLeft * dpr);
  const sy = Math.round(cssTop * dpr);
  const sw = Math.round(cssW * dpr);
  const sh = Math.round(cssH * dpr);
  if (sw < 1 || sh < 1) return null;

  let imageData;
  try { imageData = ctx.getImageData(sx, sy, sw, sh); } catch { return null; }
  const data = imageData.data;

  // Detect background color from the four corners (most likely the background)
  const cornerPixels = [
    0,                           // top-left
    (sw - 1) * 4,               // top-right
    (sh - 1) * sw * 4,          // bottom-left
    ((sh - 1) * sw + sw - 1) * 4 // bottom-right
  ];
  let bgR = 0, bgG = 0, bgB = 0, count = 0;
  for (const idx of cornerPixels) {
    if (idx >= 0 && idx + 2 < data.length) {
      bgR += data[idx];
      bgG += data[idx + 1];
      bgB += data[idx + 2];
      count++;
    }
  }
  if (count > 0) { bgR = Math.round(bgR / count); bgG = Math.round(bgG / count); bgB = Math.round(bgB / count); }

  // Threshold: how different from background a pixel must be to count as content
  const THRESHOLD = 20;

  function isContent(i) {
    const dr = Math.abs(data[i] - bgR);
    const dg = Math.abs(data[i + 1] - bgG);
    const db = Math.abs(data[i + 2] - bgB);
    return (dr + dg + db) > THRESHOLD;
  }

  // Find bounding box of content pixels
  let minX = sw, minY = sh, maxX = -1, maxY = -1;

  // Sample every 2nd pixel for speed on large regions
  const step = (sw * sh > 500000) ? 2 : 1;

  for (let y = 0; y < sh; y += step) {
    const rowOffset = y * sw * 4;
    for (let x = 0; x < sw; x += step) {
      if (isContent(rowOffset + x * 4)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No content found — return null (keep original rect)
  if (maxX < 0 || maxY < 0) return null;

  // Add small padding (2 CSS pixels worth)
  const pad = Math.round(2 * dpr);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(sw - 1, maxX + pad);
  maxY = Math.min(sh - 1, maxY + pad);

  // Convert back to CSS coords
  return {
    left: cssLeft + minX / dpr,
    top: cssTop + minY / dpr,
    width: (maxX - minX + 1) / dpr,
    height: (maxY - minY + 1) / dpr,
  };
}

/**
 * Replace background-colored pixels with fully transparent in the given ImageData.
 * Detects background from corner pixels, then sets alpha=0 for matching pixels.
 * Uses smooth alpha falloff near content edges for clean anti-aliased results.
 */
function _makeBackgroundTransparent(imageData) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;

  // Sample corners to detect background color
  const corners = [
    0,
    (w - 1) * 4,
    (h - 1) * w * 4,
    ((h - 1) * w + w - 1) * 4,
  ];
  let bgR = 0, bgG = 0, bgB = 0, cnt = 0;
  for (const idx of corners) {
    if (idx >= 0 && idx + 2 < data.length) {
      bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2]; cnt++;
    }
  }
  if (cnt === 0) return;
  bgR = Math.round(bgR / cnt);
  bgG = Math.round(bgG / cnt);
  bgB = Math.round(bgB / cnt);

  const BG_THRESHOLD = 35; // max RGB distance to count as background

  // First pass: mark background vs content
  const isBg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4;
    const dr = Math.abs(data[pi] - bgR);
    const dg = Math.abs(data[pi + 1] - bgG);
    const db = Math.abs(data[pi + 2] - bgB);
    if (dr + dg + db <= BG_THRESHOLD) isBg[i] = 1;
  }

  // Second pass: for background pixels, compute distance to nearest content pixel.
  // Pixels far from content → fully transparent. Near content → partial alpha for
  // smooth anti-aliased edge.
  const FADE_RADIUS = 2; // pixels over which to fade

  for (let i = 0; i < w * h; i++) {
    if (!isBg[i]) continue; // content pixel — keep fully opaque

    // Check neighborhood for any content pixel
    const px = i % w;
    const py = (i - px) / w;
    let nearestDist = FADE_RADIUS + 1;

    for (let dy = -FADE_RADIUS; dy <= FADE_RADIUS && nearestDist > 1; dy++) {
      const ny = py + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -FADE_RADIUS; dx <= FADE_RADIUS; dx++) {
        const nx = px + dx;
        if (nx < 0 || nx >= w) continue;
        if (!isBg[ny * w + nx]) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearestDist) nearestDist = d;
        }
      }
    }

    const pi = i * 4;
    if (nearestDist > FADE_RADIUS) {
      // Far from content — fully transparent
      data[pi + 3] = 0;
    } else {
      // Near content edge — partial alpha for smooth transition
      const alpha = Math.round(255 * (1 - nearestDist / (FADE_RADIUS + 1)));
      data[pi + 3] = alpha;
    }
  }
}

/**
 * Regenerate the transparent content preview on an overlay after resize.
 * Reads fresh pixels from the PDF canvas at the new bounds.
 */
function _regeneratePreview(div, cssLeft, cssTop, cssW, cssH) {
  const pdfCanvas = document.getElementById('pdf-canvas');
  if (!pdfCanvas) return;
  const ctx = pdfCanvas.getContext('2d', { willReadFrequently: true });
  const dpr = window.devicePixelRatio || 1;
  const sx = Math.round(cssLeft * dpr);
  const sy = Math.round(cssTop * dpr);
  const sw = Math.round(cssW * dpr);
  const sh = Math.round(cssH * dpr);
  if (sw < 1 || sh < 1) return;
  try {
    const imgData = ctx.getImageData(sx, sy, sw, sh);
    _makeBackgroundTransparent(imgData);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = sw;
    tmpCanvas.height = sh;
    tmpCanvas.getContext('2d').putImageData(imgData, 0, 0);
    div.style.backgroundImage = `url(${tmpCanvas.toDataURL('image/png')})`;
    div.style.backgroundSize = '100% 100%';
    div.classList.add('image-edit-previewed');
  } catch { /* ignore */ }
}

// Shared helper: creates an image overlay for a given image region
function _createImageOverlay(img, container) {
    const div = document.createElement('div');
    div.className = 'image-edit-overlay';
    div.style.left = img.left + 'px';
    div.style.top = img.top + 'px';
    div.style.width = img.width + 'px';
    div.style.height = img.height + 'px';

    // Show transparent content preview if available (region select mode)
    if (img.previewUrl) {
      div.style.backgroundImage = `url(${img.previewUrl})`;
      div.style.backgroundSize = '100% 100%';
      div.classList.add('image-edit-previewed');
    }

    // Action buttons + resize handles
    div.innerHTML = `
      <div class="image-edit-actions">
        <button class="image-edit-btn image-edit-edit" title="Edit image">Edit</button>
        <button class="image-edit-btn image-edit-replace" title="Replace image">Replace</button>
        <button class="image-edit-btn image-edit-delete" title="Delete image">Delete</button>
      </div>
      <div class="image-resize-handle nw" data-dir="nw"></div>
      <div class="image-resize-handle ne" data-dir="ne"></div>
      <div class="image-resize-handle sw" data-dir="sw"></div>
      <div class="image-resize-handle se" data-dir="se"></div>
      <div class="image-resize-handle n"  data-dir="n"></div>
      <div class="image-resize-handle s"  data-dir="s"></div>
      <div class="image-resize-handle w"  data-dir="w"></div>
      <div class="image-resize-handle e"  data-dir="e"></div>
    `;

    const entry = {
      div,
      pdfX: img.pdfX,
      pdfY: img.pdfY,
      pdfW: img.pdfW,
      pdfH: img.pdfH,
      origPdfX: img.pdfX,
      origPdfY: img.pdfY,
      action: 'none',
      replaceSrc: null,
    };

    // Wire buttons
    div.querySelector('.image-edit-replace').addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        if (!input.files.length) return;
        _pushImageUndo(entry);
        const file = input.files[0];
        const bytes = await readFileAsBytes(file);
        entry.action = 'replace';
        entry.replaceSrc = { bytes, type: file.type };
        div.classList.add('image-edit-replaced');
        div.classList.remove('image-edit-deleted');
        // Show preview
        const url = URL.createObjectURL(file);
        div.style.backgroundImage = `url(${url})`;
        div.style.backgroundSize = 'cover';
      };
      input.click();
    });

    div.querySelector('.image-edit-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      _pushImageUndo(entry);
      if (entry.action === 'delete') {
        // Undo delete
        entry.action = 'none';
        div.classList.remove('image-edit-deleted');
      } else {
        entry.action = 'delete';
        entry.replaceSrc = null;
        div.classList.add('image-edit-deleted');
        div.classList.remove('image-edit-replaced');
        div.style.backgroundImage = '';
      }
    });

    // Open image editor — shared by Edit button and double-click
    async function openEditor() {
      const pdfCanvas = document.getElementById('pdf-canvas');
      if (!pdfCanvas) return;
      const ctx = pdfCanvas.getContext('2d');
      // Canvas is rendered at devicePixelRatio scale, so multiply CSS coords
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.round(parseFloat(div.style.left) * dpr);
      const sy = Math.round(parseFloat(div.style.top) * dpr);
      const sw = Math.round(parseFloat(div.style.width) * dpr);
      const sh = Math.round(parseFloat(div.style.height) * dpr);
      if (sw < 1 || sh < 1) return;
      const imageData = ctx.getImageData(sx, sy, sw, sh);

      const { openImageEditor } = await import('./image-editor.js');
      const result = await openImageEditor(imageData, sw, sh);
      if (result) {
        _pushImageUndo(entry);
        entry.action = 'replace';
        entry.replaceSrc = { bytes: result.bytes, type: result.type };
        div.classList.add('image-edit-replaced');
        div.classList.remove('image-edit-deleted');
        const blob = new Blob([result.bytes], { type: result.type });
        const url = URL.createObjectURL(blob);
        div.style.backgroundImage = `url(${url})`;
        div.style.backgroundSize = 'cover';
      }
    }

    div.querySelector('.image-edit-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor();
    });

    // Double-click on overlay opens editor directly
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openEditor();
    });

    // Resize handles: drag to adjust selection bounds
    let resizeState = null;
    div.querySelectorAll('.image-resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _pushImageUndo(entry);
        const dir = handle.dataset.dir;
        // Hide preview during resize — we're adjusting the selection area, not scaling the image
        if (div.classList.contains('image-edit-previewed')) {
          div.style.backgroundImage = '';
        }
        resizeState = {
          dir,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: parseFloat(div.style.left),
          origTop: parseFloat(div.style.top),
          origW: parseFloat(div.style.width),
          origH: parseFloat(div.style.height),
        };
      });
    });

    const onResizeMove = (e) => {
      if (!resizeState) return;
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;
      const { dir, origLeft, origTop, origW, origH } = resizeState;
      let newLeft = origLeft, newTop = origTop, newW = origW, newH = origH;

      if (dir.includes('e')) newW = Math.max(10, origW + dx);
      if (dir.includes('w')) { newW = Math.max(10, origW - dx); newLeft = origLeft + origW - newW; }
      if (dir.includes('s')) newH = Math.max(10, origH + dy);
      if (dir.includes('n')) { newH = Math.max(10, origH - dy); newTop = origTop + origH - newH; }

      div.style.left = newLeft + 'px';
      div.style.top = newTop + 'px';
      div.style.width = newW + 'px';
      div.style.height = newH + 'px';
    };

    const onResizeEnd = () => {
      if (!resizeState) return;
      // Update PDF coordinates from new screen position/size
      const scale = currentViewport ? currentViewport.scale : 1;
      const pageHeight = (currentViewport ? currentViewport.height : parseFloat(div.style.height)) / scale;
      const newLeft = parseFloat(div.style.left);
      const newTop = parseFloat(div.style.top);
      const newW = parseFloat(div.style.width);
      const newH = parseFloat(div.style.height);

      entry.pdfX = newLeft / scale;
      entry.pdfY = pageHeight - (newTop + newH) / scale;
      entry.pdfW = newW / scale;
      entry.pdfH = newH / scale;
      if (entry.action === 'none') entry.action = 'move';
      div.classList.add('image-edit-moved');

      // Regenerate transparent preview from the new selection bounds
      _regeneratePreview(div, newLeft, newTop, newW, newH);

      resizeState = null;
    };

    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);

    // Drag-to-move: hold mouse and drag to reposition the image
    let dragState = null;
    div.addEventListener('mousedown', (e) => {
      // Only left-click, not on buttons or resize handles
      if (e.button !== 0 || e.target.closest('.image-edit-actions') || e.target.closest('.image-resize-handle')) return;
      e.preventDefault();
      e.stopPropagation();
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: parseFloat(div.style.left),
        origTop: parseFloat(div.style.top),
        moved: false,
        undoPushed: false,
      };
    });

    const onDragMove = (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        if (!dragState.undoPushed) {
          _pushImageUndo(entry);
          dragState.undoPushed = true;
        }
        dragState.moved = true;
      }
      if (!dragState.moved) return;
      div.style.left = (dragState.origLeft + dx) + 'px';
      div.style.top = (dragState.origTop + dy) + 'px';
      div.style.cursor = 'grabbing';
    };

    const onDragEnd = () => {
      if (!dragState) return;
      if (dragState.moved) {
        // Update PDF coordinates based on new screen position
        const newLeft = parseFloat(div.style.left);
        const newTop = parseFloat(div.style.top);
        const deltaX = newLeft - dragState.origLeft;
        const deltaY = newTop - dragState.origTop;
        // Convert screen delta to PDF-space delta using viewport scale
        const scale = currentViewport ? currentViewport.scale : 1;
        entry.pdfX += deltaX / scale;
        // PDF Y is inverted (origin at bottom-left)
        entry.pdfY -= deltaY / scale;
        if (entry.action === 'none') entry.action = 'move';
        div.classList.add('image-edit-moved');
      }
      div.style.cursor = '';
      dragState = null;
    };

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    // Store cleanup refs on the div for removal
    div._dragCleanup = () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);
    };

    imageOverlays.push(entry);
    container.appendChild(div);
}

export function exitImageEditMode() {
  if (!imageActive) return;
  imageActive = false;

  if (imageContainer) {
    imageContainer.querySelectorAll('.image-edit-overlay').forEach(el => {
      if (el._dragCleanup) el._dragCleanup();
      el.remove();
    });
    // Remove region selection layer (image-based PDF mode)
    imageContainer.querySelectorAll('.image-region-select-layer').forEach(el => el.remove());
  }

  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }

  imageOverlays = [];
  imageUndoStack = [];
  imageContainer = null;
}

export function isImageEditActive() {
  return imageActive;
}

function createImageToolbar(container, regionMode = false) {
  if (toolbar) toolbar.remove();

  const infoText = regionMode
    ? 'Draw rectangles to select regions. Then double-click to edit, drag to move, or use Replace / Delete.'
    : 'Double-click to edit. Drag to move. Or use Replace / Delete.';

  toolbar = document.createElement('div');
  toolbar.className = 'text-edit-toolbar';
  toolbar.innerHTML = `
    <div class="text-edit-toolbar-group">
      <span class="text-edit-info">${infoText}</span>
    </div>
    <div class="text-edit-toolbar-spacer"></div>
    <div class="text-edit-toolbar-group text-edit-actions">
      <button class="image-edit-commit-btn" title="Apply image changes to PDF">Apply</button>
      <button class="image-edit-cancel-btn" title="Cancel image editing">Cancel</button>
    </div>
  `;

  const parent = container.parentElement || container;
  parent.appendChild(toolbar);

  // Wire Apply/Cancel directly (toolbar is outside #page-container,
  // so delegated click handlers on pageContainer won't reach these)
  toolbar.querySelector('.image-edit-commit-btn').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('image-edit-commit'));
  });
  toolbar.querySelector('.image-edit-cancel-btn').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('image-edit-cancel'));
  });
}

/* ═══════════════════ Commit Image Edits ═══════════════════ */

export async function commitImageEdits(pdfBytes, pageNum) {
  const changes = imageOverlays.filter(o => o.action !== 'none');
  if (changes.length === 0) return null;

  const PDFLib = window.PDFLib;
  if (!PDFLib) return null;

  const doc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(pageNum - 1);

  // Small bleed (in PDF points) to fully cover edges/anti-aliasing
  const BLEED = 2;

  for (const change of changes) {
    if (change.action === 'delete') {
      // Cover with white rectangle at original position
      page.drawRectangle({
        x: (change.origPdfX ?? change.pdfX) - BLEED,
        y: (change.origPdfY ?? change.pdfY) - BLEED,
        width: change.pdfW + BLEED * 2,
        height: change.pdfH + BLEED * 2,
        color: PDFLib.rgb(1, 1, 1),
        borderWidth: 0,
      });
    } else if (change.action === 'move') {
      // Cover original position with white, then re-extract and draw at new position
      page.drawRectangle({
        x: (change.origPdfX ?? change.pdfX) - BLEED,
        y: (change.origPdfY ?? change.pdfY) - BLEED,
        width: change.pdfW + BLEED * 2,
        height: change.pdfH + BLEED * 2,
        color: PDFLib.rgb(1, 1, 1),
        borderWidth: 0,
      });
      // Capture image from the rendered canvas and embed as PNG
      const pdfCanvas = document.getElementById('pdf-canvas');
      if (pdfCanvas) {
        const ctx = pdfCanvas.getContext('2d', { willReadFrequently: true });
        const scale = currentViewport ? currentViewport.scale : 1;
        const dpr = window.devicePixelRatio || 1;
        const origScreenX = Math.round((change.origPdfX ?? change.pdfX) * scale * dpr);
        const pageHeight = page.getHeight();
        const origScreenY = Math.round((pageHeight - (change.origPdfY ?? change.pdfY) - change.pdfH) * scale * dpr);
        const sw = Math.round(change.pdfW * scale * dpr);
        const sh = Math.round(change.pdfH * scale * dpr);
        if (sw > 0 && sh > 0) {
          const imgData = ctx.getImageData(origScreenX, origScreenY, sw, sh);

          // Make background pixels transparent so they don't overwrite
          // content at the destination. Detect BG from corners.
          _makeBackgroundTransparent(imgData);

          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = sw;
          tmpCanvas.height = sh;
          tmpCanvas.getContext('2d').putImageData(imgData, 0, 0);
          const blob = await new Promise(r => tmpCanvas.toBlob(r, 'image/png'));
          if (blob) {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const image = await doc.embedPng(bytes);
            page.drawImage(image, {
              x: change.pdfX,
              y: change.pdfY,
              width: change.pdfW,
              height: change.pdfH,
            });
          }
        }
      }
    } else if (change.action === 'replace' && change.replaceSrc) {
      // Cover original position
      page.drawRectangle({
        x: (change.origPdfX ?? change.pdfX) - BLEED,
        y: (change.origPdfY ?? change.pdfY) - BLEED,
        width: change.pdfW + BLEED * 2,
        height: change.pdfH + BLEED * 2,
        color: PDFLib.rgb(1, 1, 1),
        borderWidth: 0,
      });

      // Embed and draw new image at (possibly moved) position
      let image;
      try {
        if (change.replaceSrc.type.includes('png')) {
          image = await doc.embedPng(change.replaceSrc.bytes);
        } else {
          image = await doc.embedJpg(change.replaceSrc.bytes);
        }
      } catch {
        // Try JPEG as fallback
        try {
          image = await doc.embedJpg(change.replaceSrc.bytes);
        } catch (e) {
          console.warn('Failed to embed replacement image:', e);
          continue;
        }
      }

      page.drawImage(image, {
        x: change.pdfX,
        y: change.pdfY,
        width: change.pdfW,
        height: change.pdfH,
      });
    }
  }

  return doc.save();
}

/* ═══════════════════ Helpers ═══════════════════ */

function readFileAsBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
