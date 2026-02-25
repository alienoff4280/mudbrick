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

let active = false;
let editContainer = null;
let toolbar = null;
let currentViewport = null;
let currentPageNum = 0;
let currentPdfDoc = null;

let _focusedLine = null; // currently focused text-edit-line div

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
    if (lower.includes('bold') && lower.includes('oblique')) return 'CourierBoldOblique';
    if (lower.includes('bold')) return 'CourierBold';
    if (lower.includes('oblique') || lower.includes('italic')) return 'CourierOblique';
    return 'Courier';
  }

  if (lower.includes('times') || lower.includes('serif') || lower.includes('roman')) {
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

/** Font family options for the toolbar selector */
const FONT_FAMILIES = [
  { label: 'Sans-serif (Helvetica)', css: 'Arial, Helvetica, sans-serif', pdf: 'Helvetica' },
  { label: 'Serif (Times)', css: '"Times New Roman", Times, serif', pdf: 'TimesRoman' },
  { label: 'Monospace (Courier)', css: '"Courier New", Courier, monospace', pdf: 'Courier' },
];

/* ═══════════════════ Text Grouping ═══════════════════ */

function groupIntoLines(items, viewport) {
  if (!items.length) return [];

  const mapped = items.map(item => {
    const tx = window.pdfjsLib
      ? window.pdfjsLib.Util.transform(viewport.transform, item.transform)
      : transformFallback(viewport, item.transform);

    const fontSize = Math.abs(tx[3]);
    const left = tx[4];
    const top = tx[5] - fontSize;

    return {
      str: item.str,
      fontName: item.fontName,
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

  mapped.sort((a, b) => a.top - b.top || a.left - b.left);

  const lines = [];
  let currentLine = null;

  for (const item of mapped) {
    if (!item.str.trim()) continue;

    if (!currentLine || Math.abs(item.top - currentLine.top) > 3) {
      currentLine = {
        top: item.top,
        left: item.left,
        items: [item],
      };
      lines.push(currentLine);
    } else {
      currentLine.items.push(item);
      if (item.left < currentLine.left) currentLine.left = item.left;
    }
  }

  return lines.map(line => {
    const text = line.items.map(i => i.str).join('');
    const minLeft = Math.min(...line.items.map(i => i.left));
    const maxRight = Math.max(...line.items.map(i => i.left + i.width));
    const fontSize = line.items[0].fontSize;
    const height = Math.max(...line.items.map(i => i.height));
    // Compute precise bounding box in PDF coordinates for accurate cover rects
    const pdfMinX = Math.min(...line.items.map(i => i.pdfX));
    const pdfMaxX = Math.max(...line.items.map(i => i.pdfX + (i.width / (viewport?.scale || 1))));
    const pdfMinY = Math.min(...line.items.map(i => i.pdfY));

    return {
      text,
      left: minLeft,
      top: line.top,
      width: maxRight - minLeft,
      height: height + 2,     // tighter fit for visual blending
      fontSize,
      fontName: line.items[0].fontName,
      pdfX: pdfMinX,
      pdfY: pdfMinY,
      pdfFontSize: line.items[0].pdfFontSize,
      pdfLineWidth: pdfMaxX - pdfMinX,  // precise width in PDF units
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

/* ═══════════════════ Enter / Exit Text Edit ═══════════════════ */

export async function enterTextEditMode(pageNum, pdfDoc, viewport, container) {
  if (active) exitTextEditMode();

  const page = await pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const lines = groupIntoLines(textContent.items, viewport);

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

  // Hide existing text layer spans
  container.querySelectorAll('span').forEach(s => s.style.visibility = 'hidden');

  // Create editable overlays for each line
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'text-edit-line';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.textContent = line.text;

    // Position & size
    div.style.left = line.left + 'px';
    div.style.top = line.top + 'px';
    div.style.minWidth = line.width + 'px';
    div.style.height = line.height + 'px';
    div.style.fontSize = line.fontSize + 'px';
    div.style.lineHeight = line.height + 'px';

    // Match PDF font visually
    const cssFont = mapToCSSFont(line.fontName);
    const fontStyle = detectFontStyle(line.fontName);
    div.style.fontFamily = cssFont;
    if (fontStyle.bold) div.style.fontWeight = 'bold';
    if (fontStyle.italic) div.style.fontStyle = 'italic';

    // Store original data
    div.dataset.original = line.text;
    div.dataset.pdfX = line.pdfX;
    div.dataset.pdfY = line.pdfY;
    div.dataset.pdfFontSize = line.pdfFontSize;
    div.dataset.pdfLineWidth = line.pdfLineWidth || '';
    div.dataset.fontName = line.fontName || '';
    div.dataset.cssFont = cssFont;
    div.dataset.width = line.width;
    div.dataset.height = line.height;

    // Track formatting changes per line
    div.dataset.fontSizeOverride = '';
    div.dataset.colorOverride = '';
    div.dataset.fontFamilyOverride = '';
    div.dataset.bold = fontStyle.bold ? 'true' : '';
    div.dataset.italic = fontStyle.italic ? 'true' : '';

    // Track changes for live preview indicator
    div.addEventListener('input', () => markDirty(div));
    div.addEventListener('focus', () => {
      _focusedLine = div;
      updateToolbarState(div);
    });
    div.addEventListener('blur', () => {
      if (_focusedLine === div) _focusedLine = null;
    });

    container.appendChild(div);
  }

  _focusedLine = null;

  // Create enhanced floating toolbar
  createToolbar(container);

  return true;
}

export function exitTextEditMode() {
  if (!active) return;
  active = false;

  if (editContainer) {
    editContainer.querySelectorAll('.text-edit-line').forEach(el => el.remove());
    editContainer.querySelectorAll('span').forEach(s => s.style.visibility = '');
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
}

export function isTextEditActive() {
  return active;
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

  toolbar.innerHTML = `
    <div class="text-edit-toolbar-group">
      <select class="text-edit-font-family" title="Font family">
        <option value="">Font</option>
        ${fontFamilyOptions}
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
    </div>
    <div class="text-edit-toolbar-sep"></div>
    <div class="text-edit-toolbar-group">
      <span class="text-edit-info">Click text to edit</span>
    </div>
    <div class="text-edit-toolbar-spacer"></div>
    <div class="text-edit-toolbar-group text-edit-actions">
      <button class="text-edit-commit" title="Apply changes to PDF">Apply</button>
      <button class="text-edit-cancel" title="Cancel editing">Cancel</button>
    </div>
  `;

  // Wire toolbar events — font family
  const fontFamilySelect = toolbar.querySelector('.text-edit-font-family');
  fontFamilySelect.addEventListener('change', () => {
    const val = fontFamilySelect.value;
    if (val) applyToFocused(div => {
      div.style.fontFamily = val;
      div.dataset.fontFamilyOverride = val;
      // Store the pdf-lib font name for commit
      const opt = fontFamilySelect.selectedOptions[0];
      div.dataset.fontNameOverride = opt?.dataset.pdf || '';
    });
  });

  // Wire toolbar events — font size
  const fontSizeSelect = toolbar.querySelector('.text-edit-font-size');
  fontSizeSelect.addEventListener('change', () => {
    const val = fontSizeSelect.value;
    if (val) applyToFocused(div => {
      div.style.fontSize = val + 'px';
      div.dataset.fontSizeOverride = val;
    });
  });

  toolbar.querySelector('.text-edit-bold').addEventListener('click', () => {
    applyToFocused(div => {
      const isBold = div.style.fontWeight === 'bold';
      div.style.fontWeight = isBold ? 'normal' : 'bold';
      div.dataset.bold = isBold ? '' : 'true';
      toolbar.querySelector('.text-edit-bold').classList.toggle('active', !isBold);
    });
  });

  toolbar.querySelector('.text-edit-italic').addEventListener('click', () => {
    applyToFocused(div => {
      const isItalic = div.style.fontStyle === 'italic';
      div.style.fontStyle = isItalic ? 'normal' : 'italic';
      div.dataset.italic = isItalic ? '' : 'true';
      toolbar.querySelector('.text-edit-italic').classList.toggle('active', !isItalic);
    });
  });

  toolbar.querySelector('.text-edit-color').addEventListener('input', (e) => {
    applyToFocused(div => {
      div.style.color = e.target.value;
      div.dataset.colorOverride = e.target.value;
    });
  });

  const parent = container.parentElement || container;
  parent.appendChild(toolbar);
}

/** Mark a line as changed for live preview indication */
function markDirty(div) {
  const hasTextChange = div.textContent !== div.dataset.original;
  const hasFormatChange = div.dataset.fontSizeOverride || div.dataset.colorOverride ||
    div.dataset.fontFamilyOverride || div.dataset.bold !== (detectFontStyle(div.dataset.fontName).bold ? 'true' : '') ||
    div.dataset.italic !== (detectFontStyle(div.dataset.fontName).italic ? 'true' : '');
  div.classList.toggle('text-edit-dirty', hasTextChange || !!hasFormatChange);
  updateEditCount();
}

/** Update the status text showing how many lines have been modified */
function updateEditCount() {
  if (!toolbar || !editContainer) return;
  const dirty = editContainer.querySelectorAll('.text-edit-line.text-edit-dirty').length;
  const info = toolbar.querySelector('.text-edit-info');
  if (info) {
    info.textContent = dirty > 0
      ? `${dirty} line${dirty > 1 ? 's' : ''} modified`
      : 'Click text to edit';
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
  colorInput.value = div.dataset.colorOverride || '#000000';
}

/* ═══════════════════ Commit Text Edits ═══════════════════ */

export async function commitTextEdits(pdfBytes, pageNum) {
  if (!editContainer) return null;

  const editedLines = editContainer.querySelectorAll('.text-edit-line');
  const changes = [];

  for (const div of editedLines) {
    const newText = div.textContent;
    const original = div.dataset.original;
    const fontSizeOverride = div.dataset.fontSizeOverride ? parseFloat(div.dataset.fontSizeOverride) : 0;
    const colorOverride = div.dataset.colorOverride || '';
    const fontFamilyOverride = div.dataset.fontFamilyOverride || '';
    const fontNameOverride = div.dataset.fontNameOverride || '';
    const bold = div.dataset.bold === 'true';
    const italic = div.dataset.italic === 'true';

    // Changed if text differs OR formatting was modified
    const hasTextChange = newText !== original;
    const origStyle = detectFontStyle(div.dataset.fontName);
    const hasFormatChange = fontSizeOverride || colorOverride || fontFamilyOverride ||
      bold !== origStyle.bold || italic !== origStyle.italic;

    if (!hasTextChange && !hasFormatChange) continue;

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
      colorOverride,
      bold,
      italic,
    });
  }

  if (changes.length === 0) return null;

  const PDFLib = window.PDFLib;
  if (!PDFLib) return null;

  const doc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(pageNum - 1);

  const fontCache = {};
  async function getFont(fontName, bold, italic) {
    // Build font variant name
    let variant = fontName;
    if (bold) variant += '-Bold';
    if (italic) variant += '-Italic';
    const stdName = mapToStandardFont(variant);
    if (!fontCache[stdName]) {
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
    const rectHeight = change.pdfFontSize * 1.3;  // 1.3x covers ascenders/descenders

    // White cover rectangle — precise positioning
    page.drawRectangle({
      x: x - 1,
      y: y - change.pdfFontSize * 0.25,  // extend below baseline for descenders
      width: rectWidth,
      height: rectHeight,
      color: PDFLib.rgb(1, 1, 1),
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

    page.drawText(change.newText, {
      x,
      y,
      size: fontSize,
      font,
      color,
    });
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
