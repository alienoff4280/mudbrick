/**
 * Mudbrick — OCR via Tesseract.js (Phase 2, W5.1)
 * Lazy-loads Tesseract.js from CDN, renders pages at 300 DPI,
 * runs OCR, and creates synthetic text layer spans for search.
 */

let tesseractLoaded = false;
let ocrResults = {};   // pageNum → { words, lines, fullText }
let worker = null;

const OCR_DPI = 300;
const PDF_DPI = 72;
const SCALE_FACTOR = OCR_DPI / PDF_DPI;

/* ── Lazy-load Tesseract.js from CDN ── */

async function ensureTesseract() {
  if (tesseractLoaded && window.Tesseract) return;

  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      tesseractLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => {
      tesseractLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Tesseract.js from CDN'));
    document.head.appendChild(script);
  });
}

/* ── Render PDF page to offscreen canvas at high DPI ── */

async function renderPageToCanvas(pdfDoc, pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: SCALE_FACTOR });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return { canvas, viewport, nativeViewport: page.getViewport({ scale: 1 }) };
}

/* ── Public API ── */

/**
 * Run OCR on specified pages.
 * @param {PDFDocumentProxy} pdfDoc — PDF.js document
 * @param {number[]} pageNumbers — 1-based page numbers
 * @param {function} onProgress — callback({current, total, status, progress})
 * @returns {Object} ocrResults map
 */
export async function runOCR(pdfDoc, pageNumbers, onProgress, options = {}) {
  const { language = 'eng', confidenceThreshold = 60 } = options;

  // Load Tesseract.js
  onProgress?.({
    current: 0, total: pageNumbers.length,
    status: 'Loading OCR engine…', progress: 0,
  });
  await ensureTesseract();

  // Create / reuse worker (recreate if language changed)
  if (!worker) {
    worker = await window.Tesseract.createWorker(language);
    worker._lang = language;
  } else if (worker._lang !== language) {
    await worker.terminate();
    worker = await window.Tesseract.createWorker(language);
    worker._lang = language;
  }

  for (let i = 0; i < pageNumbers.length; i++) {
    const pageNum = pageNumbers[i];
    const pct = Math.round((i / pageNumbers.length) * 100);

    onProgress?.({
      current: i + 1, total: pageNumbers.length,
      pageNum,
      status: `OCR page ${pageNum} of ${pageNumbers.length}…`,
      progress: pct,
    });

    // Render page at 300 DPI
    const { canvas, nativeViewport } = await renderPageToCanvas(pdfDoc, pageNum);
    const pageHeight = nativeViewport.height; // in PDF pts (72 DPI)

    // Run OCR with blocks output for bounding boxes
    const result = await worker.recognize(canvas, {}, { blocks: true });

    // Parse results — extract words with bounding boxes
    const words = [];
    const lines = [];
    let fullText = '';

    if (result.data.blocks) {
      for (const block of result.data.blocks) {
        if (!block.paragraphs) continue;
        for (const para of block.paragraphs) {
          if (!para.lines) continue;
          for (const line of para.lines) {
            const lineWords = [];
            if (!line.words) continue;
            for (const word of line.words) {
              // Convert image coords (300 DPI) back to PDF coords (72 DPI)
              const pdfBbox = {
                x0: word.bbox.x0 / SCALE_FACTOR,
                y0: word.bbox.y0 / SCALE_FACTOR,
                x1: word.bbox.x1 / SCALE_FACTOR,
                y1: word.bbox.y1 / SCALE_FACTOR,
              };
              words.push({
                text: word.text,
                bbox: pdfBbox,
                confidence: word.confidence,
              });
              lineWords.push(word.text);
            }
            const lineText = lineWords.join(' ');
            lines.push({
              text: lineText,
              bbox: {
                x0: line.bbox.x0 / SCALE_FACTOR,
                y0: line.bbox.y0 / SCALE_FACTOR,
                x1: line.bbox.x1 / SCALE_FACTOR,
                y1: line.bbox.y1 / SCALE_FACTOR,
              },
            });
            fullText += lineText + '\n';
          }
        }
      }
    } else {
      // Fallback: just store the raw text without positions
      fullText = result.data.text || '';
    }

    const avgConfidence = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
    const lowConfidenceWords = words.filter(w => w.confidence < 70);

    ocrResults[pageNum] = {
      words,
      lines,
      fullText: fullText.trim(),
      pageHeight,
      avgConfidence,
      lowConfidenceWords,
    };
  }

  onProgress?.({
    current: pageNumbers.length, total: pageNumbers.length,
    status: 'OCR complete', progress: 100,
  });

  return ocrResults;
}

/**
 * Check if a page has OCR results stored.
 */
export function hasOCRResults(pageNum) {
  return !!ocrResults[pageNum];
}

/**
 * Get OCR results for a page.
 */
export function getOCRResults(pageNum) {
  return ocrResults[pageNum] || null;
}

/**
 * Check if a page appears to be scanned (very little native text).
 * @param {PDFDocumentProxy} pdfDoc
 * @param {number} pageNum — 1-based
 * @returns {boolean}
 */
export async function isPageScanned(pdfDoc, pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const content = await page.getTextContent();
  const text = content.items.map(i => i.str).join('').trim();
  return text.length < 20;
}

/**
 * Render OCR text as invisible spans in the text layer container.
 * These spans enable text selection and make Find (Ctrl+F) highlights work.
 * @param {number} pageNum
 * @param {HTMLElement} container — the #text-layer div
 * @param {object} viewport — PDF.js viewport at current zoom
 */
export function renderOCRTextLayer(pageNum, container, viewport) {
  const result = ocrResults[pageNum];
  if (!result || !result.words.length) return;

  // Don't duplicate if already rendered
  if (container.querySelector('.ocr-text-span')) return;

  // Skip if the page already has native text from PDF.js (both 4.x and fallback)
  const existingSpans = container.querySelectorAll('span:not(.ocr-text-span)');
  const nativeTextLen = Array.from(existingSpans).reduce((sum, s) => sum + (s.textContent?.trim().length || 0), 0);
  if (nativeTextLen > 20) return;

  const scale = viewport.scale;

  for (let wordIndex = 0; wordIndex < result.words.length; wordIndex++) {
    const word = result.words[wordIndex];
    const span = document.createElement('span');
    span.className = 'ocr-text-span';
    span.textContent = word.text + ' ';
    span.dataset.wordIdx = String(wordIndex);

    // Confidence coloring classes
    if (word.confidence < 50) {
      span.classList.add('ocr-low-confidence');
    } else if (word.confidence < 70) {
      span.classList.add('ocr-medium-confidence');
    }

    // Position based on PDF coordinates scaled to current zoom
    const left = word.bbox.x0 * scale;
    const top = word.bbox.y0 * scale;
    const width = (word.bbox.x1 - word.bbox.x0) * scale;
    const height = (word.bbox.y1 - word.bbox.y0) * scale;

    span.style.cssText = [
      'position:absolute',
      `left:${left}px`,
      `top:${top}px`,
      `width:${width}px`,
      `height:${height}px`,
      `font-size:${Math.max(1, height * 0.8)}px`,
      'color:transparent',
      'white-space:nowrap',
      'overflow:hidden',
      'line-height:1',
      'pointer-events:auto',
    ].join(';');

    container.appendChild(span);
  }
}

/**
 * Build OCR text entries compatible with find.js text indexing.
 * Returns array of {pageNum, text, items} matching find.js format.
 */
export function getOCRTextEntries() {
  const entries = [];

  for (const [key, result] of Object.entries(ocrResults)) {
    const pageNum = parseInt(key);
    if (!result.fullText) continue;

    // Build contiguous text and items array (words separated by spaces)
    let offset = 0;
    const items = [];

    for (let i = 0; i < result.words.length; i++) {
      const word = result.words[i];
      const str = i < result.words.length - 1 ? word.text + ' ' : word.text;
      items.push({
        str,
        start: offset,
        // PDF.js-compatible transform: [scaleX, skew, skew, scaleY, tx, ty]
        // ty is from bottom-left in PDF coords, but our bbox is from top-left
        // We use a sentinel flag so renderHighlights can detect OCR transforms
        transform: [1, 0, 0, 1, word.bbox.x0, word.bbox.y0],
        width: word.bbox.x1 - word.bbox.x0,
        height: word.bbox.y1 - word.bbox.y0,
        _ocr: true, // flag for highlight positioning
      });
      offset += str.length;
    }

    const fullText = items.map(it => it.str).join('');
    entries.push({ pageNum, text: fullText, items });
  }

  return entries;
}

/**
 * Enter OCR correction mode — make OCR text spans editable.
 */
export function enableCorrectionMode(pageNum, container) {
  // Don't enable correction mode if page has native text — OCR overlay not needed
  const existingSpans = container.querySelectorAll('span:not(.ocr-text-span)');
  const nativeTextLen = Array.from(existingSpans).reduce((sum, s) => sum + (s.textContent?.trim().length || 0), 0);
  if (nativeTextLen > 20) return;

  const spans = container.querySelectorAll('.ocr-text-span');
  spans.forEach(span => {
    span.style.color = 'rgba(0,0,0,0.7)';
    span.style.background = 'rgba(255,255,200,0.5)';
    span.style.cursor = 'text';
    span.contentEditable = 'true';
    span.spellcheck = true;

    span.addEventListener('blur', () => {
      const wordIdx = parseInt(span.dataset.wordIdx);
      if (!isNaN(wordIdx) && ocrResults[pageNum]?.words[wordIdx]) {
        ocrResults[pageNum].words[wordIdx].text = span.textContent.trim();
        ocrResults[pageNum].words[wordIdx].confidence = 100;
        ocrResults[pageNum].fullText = ocrResults[pageNum].words.map(w => w.text).join(' ');
      }
    });
  });
}

/**
 * Exit correction mode — make spans invisible again.
 */
export function disableCorrectionMode(container) {
  const spans = container.querySelectorAll('.ocr-text-span');
  spans.forEach(span => {
    span.style.color = 'transparent';
    span.style.background = 'none';
    span.style.cursor = 'default';
    span.contentEditable = 'false';
  });
}

/**
 * Export all OCR results as plain text.
 */
export function exportOCRText() {
  const pages = Object.keys(ocrResults).sort((a, b) => +a - +b);
  let text = '';
  for (const pageNum of pages) {
    text += `--- Page ${pageNum} ---\n`;
    text += ocrResults[pageNum].fullText + '\n\n';
  }
  return text;
}

/**
 * Get OCR stats for display.
 */
export function getOCRStats() {
  const pages = Object.keys(ocrResults);
  if (!pages.length) return null;
  const totalWords = pages.reduce((s, p) => s + ocrResults[p].words.length, 0);
  const avgConfidence = pages.reduce((s, p) => s + ocrResults[p].avgConfidence, 0) / pages.length;
  const lowConfCount = pages.reduce((s, p) => s + (ocrResults[p].lowConfidenceWords?.length || 0), 0);
  return {
    pagesProcessed: pages.length,
    totalWords,
    avgConfidence: Math.round(avgConfidence),
    lowConfidenceWords: lowConfCount,
  };
}

/**
 * Embed OCR text as invisible text layer in a pdf-lib document.
 * Makes exported PDFs permanently searchable in any viewer.
 */
export async function embedOCRTextLayer(pdfDoc, PDFLib) {
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const pageNum = i + 1;
    if (!ocrResults[pageNum]?.words?.length) continue;

    const result = ocrResults[pageNum];
    const page = pdfDoc.getPage(i);
    const { height: pageHeight } = page.getSize();

    for (const word of result.words) {
      if (!word.text.trim()) continue;

      const wordHeight = word.bbox.y1 - word.bbox.y0;
      const fontSize = Math.max(1, wordHeight * 0.85);

      page.drawText(word.text, {
        x: word.bbox.x0,
        y: pageHeight - word.bbox.y1 + (wordHeight * 0.15),
        size: fontSize,
        font,
        opacity: 0,
      });
    }
  }
}

/**
 * Terminate the Tesseract worker.
 */
export async function terminateOCR() {
  if (worker) {
    try { await worker.terminate(); } catch (_) { /* ignore */ }
    worker = null;
  }
}

/**
 * Clear all stored OCR results.
 */
export function clearOCRResults() {
  ocrResults = {};
}
