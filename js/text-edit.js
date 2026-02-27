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

function getReadbackContext(canvas) {
  if (!canvas) return null;
  return canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
}

function normalizeInlineHtml(html) {
  return String(html || '')
    .replace(/\u00a0/g, ' ')
    .replace(/<span style=""><\/span>/gi, '')
    .trim();
}

function getSelectionRangeInDiv(div) {
  const sel = window.getSelection ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const host = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement;
  if (!host || !div.contains(host)) return null;
  return range;
}

function toggleInlineStyleOnSelection(div, styleType) {
  const range = getSelectionRangeInDiv(div);
  if (!range) return false;
  if (styleType === 'bold') document.execCommand('bold');
  else if (styleType === 'italic') document.execCommand('italic');
  else return false;
  return true;
}

function collectTextRuns(node, state, out) {
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue || '';
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.bold === state.bold && last.italic === state.italic) {
      last.text += text;
    } else {
      out.push({ text, bold: state.bold, italic: state.italic });
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node;
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  let next = { ...state };
  if (tag === 'b' || tag === 'strong') next.bold = true;
  if (tag === 'i' || tag === 'em') next.italic = true;
  const w = String(el.style?.fontWeight || '').toLowerCase();
  const s = String(el.style?.fontStyle || '').toLowerCase();
  if (w === 'bold' || w === '700' || w === '800' || w === '900') next.bold = true;
  if (w === 'normal' || w === '400') next.bold = false;
  if (s === 'italic' || s === 'oblique') next.italic = true;
  if (s === 'normal') next.italic = false;
  if (tag === 'br') {
    const last = out[out.length - 1];
    if (last && last.bold === next.bold && last.italic === next.italic) last.text += '\n';
    else out.push({ text: '\n', bold: next.bold, italic: next.italic });
    return;
  }
  for (const child of el.childNodes) collectTextRuns(child, next, out);
}

function extractRunsFromDiv(div) {
  const base = {
    bold: div.dataset.bold === 'true',
    italic: div.dataset.italic === 'true',
  };
  const runs = [];
  for (const child of div.childNodes) collectTextRuns(child, base, runs);
  return runs.filter(r => r.text.length > 0);
}

function buildInitialHtmlFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map(it => {
    const style = detectFontStyleWithMeta(it.fontName, it.styleInfo);
    let open = '';
    let close = '';
    if (style.bold && style.italic) {
      open = '<b><i>';
      close = '</i></b>';
    } else if (style.bold) {
      open = '<b>';
      close = '</b>';
    } else if (style.italic) {
      open = '<i>';
      close = '</i>';
    }
    return `${open}${escapeHtml(it.str || '')}${close}`;
  }).join('');
}

/**
 * Sample the background color from the text region itself — the lightest
 * frequent color within the area is the background. Sampling to the LEFT
 * of text fails when text starts at a cell edge (hits border or white).
 */
function sampleBackgroundColor(canvas, x, y, width, height) {
  if (!canvas) return '#ffffff';
  const ctx = getReadbackContext(canvas);
  if (!ctx) return '#ffffff';
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
  const ctx = getReadbackContext(canvas);
  if (!ctx) return '#000000';
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
  const ctx = getReadbackContext(canvas);
  if (!ctx) return null;
  const px = Math.round(x), py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  try {
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return null;
  }
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
 * Detect font weight and style from PDF style metadata and font name.
 * Prefer explicit style metadata when available, then fall back to name parsing.
 */
function detectFontStyleWithMeta(fontName, styleInfo) {
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
    html: div.innerHTML,
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
  div.innerHTML = snap.html ?? escapeHtml(snap.text || '');
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
      const applied = toggleInlineStyleOnSelection(div, 'bold');
      if (!applied) {
        const isBold = div.style.fontWeight === 'bold';
        div.style.fontWeight = isBold ? 'normal' : 'bold';
        div.dataset.bold = isBold ? '' : 'true';
        if (toolbar) toolbar.querySelector('.text-edit-bold')?.classList.toggle('active', !isBold);
      }
    });
    return;
  }

  // Ctrl+I — toggle italic
  if (mod && e.key === 'i') {
    e.preventDefault();
    e.stopPropagation();
    applyToFocused(div => {
      pushUndo(div);
      const applied = toggleInlineStyleOnSelection(div, 'italic');
      if (!applied) {
        const isItalic = div.style.fontStyle === 'italic';
        div.style.fontStyle = isItalic ? 'normal' : 'italic';
        div.dataset.italic = isItalic ? '' : 'true';
        if (toolbar) toolbar.querySelector('.text-edit-italic')?.classList.toggle('active', !isItalic);
      }
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

function groupIntoLines(items, viewport, styles) {
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

    return {
      str: item.str,
      fontName: resolvedFontName,
      styleInfo: styleInfo || null,
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
    // Key by approximate position (round to 1px)
    const key = `${Math.round(item.left)},${Math.round(item.top)}`;
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
    const initialHtml = buildInitialHtmlFromItems(line.items);
    const minLeft = Math.min(...line.items.map(i => i.left));
    const maxRight = Math.max(...line.items.map(i => i.left + i.width));
    const fontSize = line.items[0].fontSize;
    const height = Math.max(...line.items.map(i => i.height));
    const pdfMinX = Math.min(...line.items.map(i => i.pdfX));
    const pdfMaxX = Math.max(...line.items.map(i => i.pdfX + (i.width / (viewport?.scale || 1))));
    const pdfMinY = Math.min(...line.items.map(i => i.pdfY));

    return {
      text,
      initialHtml,
      left: minLeft,
      top: line.top,
      width: maxRight - minLeft,
      height: height + 2,
      fontSize,
      fontName: line.items[0].fontName,
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
  const lines = groupIntoLines(textContent.items, viewport, textContent.styles);

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
        // Paint over each line's text using identity transform (raw pixel coords)
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (let i = 0; i < para.length; i++) {
          const line = para[i];
          ctx.fillStyle = preSampled[i].bgColor;
          ctx.fillRect(
            Math.floor((line.left - 1) * dpr),
            Math.floor((line.top - 1) * dpr),
            Math.ceil((line.width + 2) * dpr),
            Math.ceil((line.height + 2) * dpr)
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
    if (saved?.html) div.innerHTML = saved.html;
    else if (line.initialHtml) div.innerHTML = line.initialHtml;
    else div.textContent = saved ? saved.text : line.text;

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
    const nameStyle = detectFontStyleWithMeta(line.fontName, line.styleInfo);
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
    div.dataset.originalHtml = saved?.originalHtml || normalizeInlineHtml(line.initialHtml || escapeHtml(line.text));
    div.dataset.pdfX = line.pdfX;
    div.dataset.pdfY = line.pdfY;
    div.dataset.pdfFontSize = line.pdfFontSize;
    div.dataset.pdfLineWidth = line.pdfLineWidth || '';
    div.dataset.fontName = line.fontName || '';
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
    const hasInlineFormatChange = normalizeInlineHtml(div.innerHTML) !== (div.dataset.originalHtml || '');
    const hasFormatChange = fontSizeOverride || colorOverride || fontFamilyOverride ||
      bold !== initialBold || italic !== initialItalic || hasInlineFormatChange;

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
      matchedColor: div.dataset.matchedColor,
      cssFont: div.dataset.cssFont,
      bold: commitBold,
      italic: commitItalic,
      fontSizeOverride: fontSizeOverride ? parseFloat(fontSizeOverride) : 0,
      colorOverride: colorOverride || '',
      fontFamilyOverride: fontFamilyOverride || '',
      fontNameOverride: fontNameOverride || '',
      dirty: hasTextChange || hasFormatChange || isDirty,
      html: div.innerHTML,
      originalHtml: div.dataset.originalHtml || normalizeInlineHtml(escapeHtml(original || '')),
      runs: extractRunsFromDiv(div),
      // Preserve original PDF data for commit
      pdfX: parseFloat(div.dataset.pdfX),
      pdfY: parseFloat(div.dataset.pdfY),
      pdfFontSize: parseFloat(div.dataset.pdfFontSize),
      pdfLineWidth: parseFloat(div.dataset.pdfLineWidth) || 0,
      fontName: fontNameOverride || div.dataset.fontName,
      screenWidth: parseFloat(div.dataset.width),
      screenHeight: parseFloat(div.dataset.height),
      bgColor: div.dataset.bgColor || '#ffffff',
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
  }

  if (toolbar) {
    toolbar.remove();
    toolbar = null;
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
    `<option value="${escapeHtml(f.css)}" data-pdf="${escapeHtml(f.pdf)}">${escapeHtml(f.label)}</option>`
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
      const applied = toggleInlineStyleOnSelection(div, 'bold');
      if (!applied) {
        const isBold = div.style.fontWeight === 'bold';
        div.style.fontWeight = isBold ? 'normal' : 'bold';
        div.dataset.bold = isBold ? '' : 'true';
        toolbar.querySelector('.text-edit-bold').classList.toggle('active', !isBold);
      }
    });
  });

  toolbar.querySelector('.text-edit-italic').addEventListener('click', () => {
    applyToFocused(div => {
      pushUndo(div);
      const applied = toggleInlineStyleOnSelection(div, 'italic');
      if (!applied) {
        const isItalic = div.style.fontStyle === 'italic';
        div.style.fontStyle = isItalic ? 'normal' : 'italic';
        div.dataset.italic = isItalic ? '' : 'true';
        toolbar.querySelector('.text-edit-italic').classList.toggle('active', !isItalic);
      }
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
  const hasInlineFormatChange = normalizeInlineHtml(div.innerHTML) !== (div.dataset.originalHtml || '');
  const hasFormatChange = div.dataset.fontSizeOverride || div.dataset.colorOverride ||
    div.dataset.fontFamilyOverride || div.dataset.bold !== (div.dataset.initialBold || '') ||
    div.dataset.italic !== (div.dataset.initialItalic || '') || hasInlineFormatChange;
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

  const sizeSelect = toolbar.querySelector('.text-edit-font-size');
  sizeSelect.value = div.dataset.fontSizeOverride || '';

  const familySelect = toolbar.querySelector('.text-edit-font-family');
  familySelect.value = div.dataset.fontFamilyOverride || div.dataset.cssFont || '';

  const colorInput = toolbar.querySelector('.text-edit-color');
  colorInput.value = div.dataset.colorOverride || div.dataset.matchedColor || '#000000';
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
    const hasInlineFormatChange = normalizeInlineHtml(div.innerHTML) !== (div.dataset.originalHtml || '');
    const initialBold = div.dataset.initialBold === 'true';
    const initialItalic = div.dataset.initialItalic === 'true';
    const userChangedBold = bold !== initialBold;
    const userChangedItalic = italic !== initialItalic;
    const hasFormatChange = fontSizeOverride || colorOverride || fontFamilyOverride ||
      userChangedBold || userChangedItalic || hasInlineFormatChange;

    if (!hasTextChange && !hasFormatChange) continue;

    // For commit: use metadata-derived bold/italic unless user explicitly toggled.
    const baseBold = div.dataset.baseBold === 'true';
    const baseItalic = div.dataset.baseItalic === 'true';
    const commitBold = userChangedBold ? bold : baseBold;
    const commitItalic = userChangedItalic ? italic : baseItalic;

    const effectiveColor = colorOverride || matchedColor || '';

    changes.push({
      newText,
      pdfX: parseFloat(div.dataset.pdfX),
      pdfY: parseFloat(div.dataset.pdfY),
      pdfFontSize: parseFloat(div.dataset.pdfFontSize),
      pdfLineWidth: parseFloat(div.dataset.pdfLineWidth) || 0,
      fontName: fontNameOverride || div.dataset.fontName,
      screenWidth: parseFloat(div.dataset.width),
      screenHeight: parseFloat(div.dataset.height),
      fontSizeOverride,
      colorOverride: effectiveColor,
      bold: commitBold,
      italic: commitItalic,
      runs: extractRunsFromDiv(div),
      bgColor: div.dataset.bgColor || '#ffffff',
    });
  }

  // Collect changes from previously deactivated blocks
  for (const [, savedLines] of _editedBlocks) {
    for (const saved of savedLines) {
      if (!saved.dirty) continue;
      changes.push({
        newText: saved.text,
        pdfX: saved.pdfX,
        pdfY: saved.pdfY,
        pdfFontSize: saved.pdfFontSize,
        pdfLineWidth: saved.pdfLineWidth,
        fontName: saved.fontName,
        screenWidth: saved.screenWidth,
        screenHeight: saved.screenHeight,
        fontSizeOverride: saved.fontSizeOverride,
        colorOverride: saved.colorOverride || saved.matchedColor || '',
        bold: saved.bold,
        italic: saved.italic,
        runs: saved.runs || [],
        bgColor: saved.bgColor || '#ffffff',
      });
    }
  }

  if (changes.length === 0) return null;

  const PDFLib = window.PDFLib;
  if (!PDFLib) return null;

  const doc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(pageNum - 1);

  const fontCache = {};
  async function getFont(fontName, bold, italic) {
    // Custom font embedding
    if (fontName === 'custom' && customFont) {
      if (!fontCache['__custom']) {
        fontCache['__custom'] = await doc.embedFont(customFont.bytes);
      }
      return fontCache['__custom'];
    }

    // Build font variant name
    let variant = fontName;
    if (bold) variant += '-Bold';
    if (italic) variant += '-Italic';
    let stdName = mapToStandardFont(variant);
    if (!fontCache[stdName]) {
      if (!PDFLib.StandardFonts[stdName]) {
        stdName = 'Helvetica'; // safe fallback
      }
      fontCache[stdName] = await doc.embedFont(PDFLib.StandardFonts[stdName]);
    }
    return fontCache[stdName];
  }

  for (const change of changes) {
    const font = await getFont(change.fontName, change.bold, change.italic);
    const fontSize = change.fontSizeOverride || change.pdfFontSize;
    const x = change.pdfX;
    const y = change.pdfY;


    // Use precise PDF line width when available, fall back to screen-based estimate
    const scale = currentViewport ? currentViewport.scale : 1;
    const rectWidth = (change.pdfLineWidth > 0 ? change.pdfLineWidth : change.screenWidth / scale) + 4;
    const pdfLineHeight = Math.max(change.screenHeight / scale, change.pdfFontSize);
    const rectHeight = Math.max(change.pdfFontSize * 1.08, pdfLineHeight * 1.12);
    const rectY = y - Math.max(change.pdfFontSize * 0.18, pdfLineHeight * 0.18);

    // Cover rectangle — match sampled background color so it blends in
    let coverColor = PDFLib.rgb(1, 1, 1);
    if (change.bgColor && change.bgColor !== '#ffffff') {
      const br = parseInt(change.bgColor.slice(1, 3), 16) / 255;
      const bg = parseInt(change.bgColor.slice(3, 5), 16) / 255;
      const bb = parseInt(change.bgColor.slice(5, 7), 16) / 255;
      coverColor = PDFLib.rgb(br, bg, bb);
    }
    page.drawRectangle({
      x: x - 1,
      y: rectY,
      width: rectWidth,
      height: rectHeight,
      color: coverColor,
      borderWidth: 0,
    });

    // Parse color
    let color = PDFLib.rgb(0, 0, 0);
    if (change.colorOverride) {
      const hex = change.colorOverride;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      color = PDFLib.rgb(r, g, b);
    }

    const runs = Array.isArray(change.runs) ? change.runs : [];
    if (runs.length > 0) {
      let cursorX = x;
      for (const run of runs) {
        if (!run.text) continue;
        const runFont = await getFont(change.fontName, !!run.bold, !!run.italic);
        page.drawText(run.text, {
          x: cursorX,
          y,
          size: fontSize,
          font: runFont,
          color,
        });
        cursorX += runFont.widthOfTextAtSize(run.text, fontSize);
      }
    } else {
      page.drawText(change.newText, {
        x,
        y,
        size: fontSize,
        font,
        color,
      });
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
async function extractImagePositions(page, viewport) {
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

  // Create selection overlay for each image
  for (const img of images) {
    const div = document.createElement('div');
    div.className = 'image-edit-overlay';
    div.style.left = img.left + 'px';
    div.style.top = img.top + 'px';
    div.style.width = img.width + 'px';
    div.style.height = img.height + 'px';

    // Action buttons
    div.innerHTML = `
      <div class="image-edit-actions">
        <button class="image-edit-btn image-edit-replace" title="Replace image">Replace</button>
        <button class="image-edit-btn image-edit-delete" title="Delete image">Delete</button>
      </div>
    `;

    const entry = {
      div,
      pdfX: img.pdfX,
      pdfY: img.pdfY,
      pdfW: img.pdfW,
      pdfH: img.pdfH,
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

    imageOverlays.push(entry);
    container.appendChild(div);
  }

  // Create image edit toolbar
  createImageToolbar(container);

  return true;
}

export function exitImageEditMode() {
  if (!imageActive) return;
  imageActive = false;

  if (imageContainer) {
    imageContainer.querySelectorAll('.image-edit-overlay').forEach(el => el.remove());
  }

  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }

  imageOverlays = [];
  imageContainer = null;
}

export function isImageEditActive() {
  return imageActive;
}

function createImageToolbar(container) {
  if (toolbar) toolbar.remove();

  toolbar = document.createElement('div');
  toolbar.className = 'text-edit-toolbar';
  toolbar.innerHTML = `
    <div class="text-edit-toolbar-group">
      <span class="text-edit-info">Click images to select. Use Replace or Delete.</span>
    </div>
    <div class="text-edit-toolbar-spacer"></div>
    <div class="text-edit-toolbar-group text-edit-actions">
      <button class="image-edit-commit-btn text-edit-commit" title="Apply image changes to PDF">Apply</button>
      <button class="image-edit-cancel-btn text-edit-cancel" title="Cancel image editing">Cancel</button>
    </div>
  `;

  const parent = container.parentElement || container;
  parent.appendChild(toolbar);
}

/* ═══════════════════ Commit Image Edits ═══════════════════ */

export async function commitImageEdits(pdfBytes, pageNum) {
  const changes = imageOverlays.filter(o => o.action !== 'none');
  if (changes.length === 0) return null;

  const PDFLib = window.PDFLib;
  if (!PDFLib) return null;

  const doc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(pageNum - 1);

  for (const change of changes) {
    if (change.action === 'delete') {
      // Cover with white rectangle
      page.drawRectangle({
        x: change.pdfX,
        y: change.pdfY,
        width: change.pdfW,
        height: change.pdfH,
        color: PDFLib.rgb(1, 1, 1),
        borderWidth: 0,
      });
    } else if (change.action === 'replace' && change.replaceSrc) {
      // Cover original
      page.drawRectangle({
        x: change.pdfX,
        y: change.pdfY,
        width: change.pdfW,
        height: change.pdfH,
        color: PDFLib.rgb(1, 1, 1),
        borderWidth: 0,
      });

      // Embed and draw new image
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
