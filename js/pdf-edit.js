/**
 * Mudbrick — PDF Edit (Phase 2-3)
 * pdf-lib wrapper: merge, split, rotate, delete, reorder, watermark.
 * All operations mutate the internal pdfLibDoc, then call save() to
 * produce new bytes which the caller reloads into PDF.js.
 */

const getPDFLib = () => window.PDFLib;

let pdfLibDoc = null;

/* ── Lazy Initialization ── */

export async function ensurePdfLib(pdfBytes) {
  if (!pdfLibDoc) {
    const { PDFDocument } = getPDFLib();
    pdfLibDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  }
  return pdfLibDoc;
}

export function getPdfLibDoc() { return pdfLibDoc; }
export function setPdfLibDoc(doc) { pdfLibDoc = doc; }
export function resetPdfLib() { pdfLibDoc = null; }

/** Save current pdf-lib doc to bytes (for reloading into PDF.js) */
export async function saveToBytes() {
  if (!pdfLibDoc) throw new Error('No pdf-lib document loaded');
  return pdfLibDoc.save();
}

/* ═══════════════════ Phase 2: Page Operations ═══════════════════ */

/** Rotate a page by the given degrees (90, 180, 270, -90, etc.) */
export async function rotatePage(pdfBytes, pageIndex, degrees) {
  const doc = await ensurePdfLib(pdfBytes);
  const page = doc.getPage(pageIndex);
  const current = page.getRotation().angle;
  page.setRotation(getPDFLib().degrees((current + degrees) % 360));
  return doc.save();
}

/** Delete a page by index (0-based). Returns new bytes. */
export async function deletePage(pdfBytes, pageIndex) {
  const doc = await ensurePdfLib(pdfBytes);
  if (doc.getPageCount() <= 1) {
    throw new Error('Cannot delete the only remaining page');
  }
  doc.removePage(pageIndex);
  return doc.save();
}

/**
 * Reorder pages: move page at fromIndex to toIndex.
 * pdf-lib has no native move, so we rebuild the document.
 * Returns new bytes.
 */
export async function reorderPages(pdfBytes, fromIndex, toIndex) {
  const doc = await ensurePdfLib(pdfBytes);
  const count = doc.getPageCount();
  if (fromIndex === toIndex) return doc.save();

  // Build new page order
  const order = Array.from({ length: count }, (_, i) => i);
  const [removed] = order.splice(fromIndex, 1);
  order.splice(toIndex, 0, removed);

  // Create new document with reordered pages
  const { PDFDocument } = getPDFLib();
  const newDoc = await PDFDocument.create();
  const copiedPages = await newDoc.copyPages(doc, order);
  copiedPages.forEach(p => newDoc.addPage(p));

  // Replace internal doc reference
  pdfLibDoc = newDoc;
  return newDoc.save();
}

/* ═══════════════════ Phase 3: Merge & Split ═══════════════════ */

/**
 * Merge multiple PDFs. fileList = [{ bytes: Uint8Array }, ...]
 * Returns new bytes for the merged document.
 */
export async function mergePDFs(fileList) {
  const { PDFDocument } = getPDFLib();
  const merged = await PDFDocument.create();

  for (const { bytes } of fileList) {
    const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = donor.getPageIndices();
    const pages = await merged.copyPages(donor, indices);
    pages.forEach(p => merged.addPage(p));
  }

  pdfLibDoc = merged;
  return merged.save();
}

/**
 * Split PDF into multiple documents by page ranges.
 * ranges = [[0,1,2], [4], [6,7,8]] (0-indexed)
 * Returns array of { bytes: Uint8Array, label: string }
 */
export async function splitPDF(pdfBytes, ranges) {
  const doc = await ensurePdfLib(pdfBytes);
  const { PDFDocument } = getPDFLib();
  const results = [];

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(doc, range);
    pages.forEach(p => newDoc.addPage(p));
    const savedBytes = await newDoc.save();

    // Label: "pages 1-3" or "page 5"
    const first = range[0] + 1;
    const last = range[range.length - 1] + 1;
    const label = first === last ? `page-${first}` : `pages-${first}-${last}`;

    results.push({ bytes: savedBytes, label });
  }

  return results;
}

/* ═══════════════════ Append Pages (Inline Add) ═══════════════════ */

/**
 * Append pages from one or more PDFs to the current document.
 * @param {Uint8Array} basePdfBytes - The current document bytes
 * @param {Array<{bytes: Uint8Array}>} additions - PDFs to append
 * @param {number} [insertAfter] - 0-based page index to insert after.
 *   Defaults to end of document. Pass 0 to insert after page 1, etc.
 * @returns {Promise<Uint8Array>} New PDF bytes with pages appended
 */
export async function appendPages(basePdfBytes, additions, insertAfter) {
  const { PDFDocument } = getPDFLib();
  const baseDoc = await PDFDocument.load(basePdfBytes, { ignoreEncryption: true });
  const baseCount = baseDoc.getPageCount();
  const insertIdx = insertAfter !== undefined ? insertAfter + 1 : baseCount;

  let offset = 0;
  for (const { bytes } of additions) {
    const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = donor.getPageIndices();
    const pages = await baseDoc.copyPages(donor, indices);
    for (let i = 0; i < pages.length; i++) {
      baseDoc.insertPage(insertIdx + offset, pages[i]);
      offset++;
    }
  }

  pdfLibDoc = baseDoc;
  return baseDoc.save();
}

/* ═══════════════════ Replace Pages ═══════════════════ */

/**
 * Replace specific pages in the base document with pages from a source document.
 * @param {Uint8Array} basePdfBytes - Current document bytes
 * @param {Uint8Array} sourcePdfBytes - Source PDF bytes to copy pages from
 * @param {Array<{targetPage: number, sourcePage: number}>} mappings - 1-based page mappings
 * @returns {Promise<Uint8Array>} New PDF bytes with pages replaced
 */
export async function replacePages(basePdfBytes, sourcePdfBytes, mappings) {
  const { PDFDocument } = getPDFLib();
  const baseDoc = await PDFDocument.load(basePdfBytes, { ignoreEncryption: true });
  const sourceDoc = await PDFDocument.load(sourcePdfBytes, { ignoreEncryption: true });

  // Sort descending by target page to avoid index shifts
  const sorted = [...mappings].sort((a, b) => b.targetPage - a.targetPage);

  for (const { targetPage, sourcePage } of sorted) {
    const targetIdx = targetPage - 1;
    const sourceIdx = sourcePage - 1;

    if (targetIdx < 0 || targetIdx >= baseDoc.getPageCount()) continue;
    if (sourceIdx < 0 || sourceIdx >= sourceDoc.getPageCount()) continue;

    const [copiedPage] = await baseDoc.copyPages(sourceDoc, [sourceIdx]);
    baseDoc.removePage(targetIdx);
    baseDoc.insertPage(targetIdx, copiedPage);
  }

  pdfLibDoc = baseDoc;
  return baseDoc.save();
}

/* ═══════════════════ Insert Blank Page ═══════════════════ */

/**
 * Insert a blank page into the document.
 * @param {Uint8Array} pdfBytes - Source PDF bytes
 * @param {number} afterIndex - 0-based index to insert AFTER. -1 = insert at beginning.
 * @param {number} [width] - Page width in points (default: same as page at afterIndex, or Letter 612)
 * @param {number} [height] - Page height in points (default: same as page at afterIndex, or Letter 792)
 * @returns {Promise<Uint8Array>} New PDF bytes
 */
export async function insertBlankPage(pdfBytes, afterIndex, width, height) {
  const doc = await ensurePdfLib(pdfBytes);

  // Default to dimensions of the reference page (or Letter size)
  if (width == null || height == null) {
    const refIdx = Math.max(0, Math.min(afterIndex, doc.getPageCount() - 1));
    const refPage = doc.getPage(refIdx);
    const refSize = refPage.getSize();
    width = width ?? refSize.width;
    height = height ?? refSize.height;
  }

  const insertAt = afterIndex + 1; // insertPage is 0-based position
  doc.insertPage(insertAt, [width, height]);

  return doc.save();
}

/* ═══════════════════ Page Crop ═══════════════════ */

/**
 * Crop pages by setting the CropBox.
 * Margins specify how much to trim from each visual edge (in points, 72 pt = 1 inch).
 * Handles page rotation and existing CropBox correctly.
 * @param {Uint8Array} pdfBytes
 * @param {Object} opts
 * @param {number} opts.top    - Points to trim from visual top
 * @param {number} opts.bottom - Points to trim from visual bottom
 * @param {number} opts.left   - Points to trim from visual left
 * @param {number} opts.right  - Points to trim from visual right
 * @param {string} opts.pages  - 'all' | 'current'
 * @param {number} opts.currentPage - 1-based current page
 * @returns {Promise<Uint8Array>}
 */
export async function cropPages(pdfBytes, opts = {}) {
  const doc = await ensurePdfLib(pdfBytes);
  const {
    top = 0, bottom = 0, left = 0, right = 0,
    pages = 'all',
    currentPage = 1,
  } = opts;

  const pageCount = doc.getPageCount();
  const startIdx = pages === 'current' ? currentPage - 1 : 0;
  const endIdx = pages === 'current' ? currentPage : pageCount;

  for (let i = startIdx; i < endIdx; i++) {
    const page = doc.getPage(i);
    const rotation = page.getRotation().angle % 360;

    // Use existing CropBox as reference (defaults to MediaBox if none set)
    const ref = page.getCropBox();
    const rx = ref.x, ry = ref.y, rw = ref.width, rh = ref.height;

    // Map visual margins to MediaBox coordinates based on rotation.
    // Visual margins are relative to the rendered (rotation-aware) page.
    let cx, cy, cw, ch;
    if (rotation === 90) {
      cx = rx + top;    cy = ry + left;
      cw = rw - top - bottom;  ch = rh - left - right;
    } else if (rotation === 180) {
      cx = rx + right;  cy = ry + top;
      cw = rw - left - right;  ch = rh - top - bottom;
    } else if (rotation === 270) {
      cx = rx + bottom;  cy = ry + right;
      cw = rw - top - bottom;  ch = rh - left - right;
    } else {
      // 0° (default)
      cx = rx + left;   cy = ry + bottom;
      cw = rw - left - right;  ch = rh - top - bottom;
    }

    if (cw < 36 || ch < 36) {
      throw new Error(`Crop margins too large for page ${i + 1} (${Math.round(rw)}×${Math.round(rh)} pt). Remaining area would be ${Math.round(cw)}×${Math.round(ch)} pt.`);
    }

    page.setCropBox(cx, cy, cw, ch);
  }

  return doc.save();
}

/**
 * Get page dimensions in points (for showing in crop modal).
 * @param {Uint8Array} pdfBytes
 * @param {number} pageIndex - 0-based
 * @returns {Promise<{width: number, height: number}>}
 */
export async function getPageDimensions(pdfBytes, pageIndex) {
  const doc = await ensurePdfLib(pdfBytes);
  const page = doc.getPage(pageIndex);
  return page.getSize();
}

/* ═══════════════════ Phase 7: Watermark ═══════════════════ */

/**
 * Add a text watermark to PDF pages.
 * @param {Uint8Array} pdfBytes - Source PDF bytes
 * @param {Object} opts
 * @param {string} opts.text - Watermark text
 * @param {number} opts.fontSize - Font size (default 60)
 * @param {number} opts.rotation - Rotation degrees (default -45)
 * @param {number} opts.opacity - Opacity 0-1 (default 0.15)
 * @param {string} opts.color - Hex color (default '#888888')
 * @param {string} opts.pages - 'all' or 'current'
 * @param {number} opts.currentPage - Current page (1-based, for 'current' mode)
 * @returns {Promise<Uint8Array>} New PDF bytes
 */
export async function addWatermark(pdfBytes, opts = {}) {
  const PDFLib = getPDFLib();
  const doc = await ensurePdfLib(pdfBytes);

  const {
    text = 'CONFIDENTIAL',
    fontSize = 60,
    rotation = -45,
    opacity = 0.15,
    color = '#888888',
    pages = 'all',
    currentPage = 1,
  } = opts;

  // Parse hex color to RGB
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;

  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const radians = (rotation * Math.PI) / 180;

  const pageCount = doc.getPageCount();
  const startIdx = pages === 'current' ? currentPage - 1 : 0;
  const endIdx = pages === 'current' ? currentPage : pageCount;

  for (let i = startIdx; i < endIdx; i++) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();

    // Measure text to center it
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;

    // Center of page
    const cx = width / 2;
    const cy = height / 2;

    // Offset so text is centered at page center after rotation
    const x = cx - (textWidth / 2) * Math.cos(radians) + (textHeight / 2) * Math.sin(radians);
    const y = cy - (textWidth / 2) * Math.sin(radians) - (textHeight / 2) * Math.cos(radians);

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: PDFLib.rgb(r, g, b),
      opacity,
      rotate: PDFLib.degrees(rotation),
    });
  }

  return doc.save();
}
