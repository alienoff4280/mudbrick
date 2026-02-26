/**
 * Mudbrick — Comment Summary & Annotation Flattening (Phase 3)
 * Export annotation/comment summaries as text, CSV, or JSON.
 * Flatten all annotations permanently into the PDF.
 *
 * Works with the per-page annotation data from annotations.js
 * and sticky note text from the Fabric.js objects.
 */

import {
  getAnnotations, getCanvas, savePageAnnotations,
  loadPageAnnotations, resizeOverlay,
} from './annotations.js';

const getPDFLib = () => window.PDFLib;
const getFabric = () => window.fabric;

/* ═══════════════════ Comment Summary Export ═══════════════════ */

/**
 * Collect all annotations and comments across pages.
 * @param {number} currentPage - Current page to save first
 * @returns {Array<Object>} Array of { page, type, text, author, date, color, position }
 */
export function collectComments(currentPage) {
  // Save current page before collecting
  if (currentPage > 0) savePageAnnotations(currentPage);

  const annotations = getAnnotations();
  const comments = [];

  for (const [pageNum, json] of Object.entries(annotations)) {
    if (!json || !json.objects) continue;

    for (const obj of json.objects) {
      const comment = {
        page: Number(pageNum),
        type: obj.mudbrickType || obj.type || 'unknown',
        position: {
          x: Math.round(obj.left || 0),
          y: Math.round(obj.top || 0),
        },
      };

      // Extract text content based on type
      switch (obj.mudbrickType) {
        case 'sticky-note':
          comment.text = obj.noteText || '';
          comment.color = obj.noteColor || 'yellow';
          break;
        case 'text':
          comment.text = obj.text || '';
          break;
        case 'stamp':
          // Group objects — find text child
          if (obj.objects) {
            const textObj = obj.objects.find(o => o.type === 'text' || o.type === 'i-text');
            comment.text = textObj?.text || 'Stamp';
          } else {
            comment.text = obj.text || 'Stamp';
          }
          break;
        case 'highlight':
          comment.text = '[Highlight]';
          comment.color = obj.stroke || '#ffff00';
          break;
        case 'underline':
          comment.text = '[Underline]';
          break;
        case 'strikethrough':
          comment.text = '[Strikethrough]';
          break;
        case 'cover':
          comment.text = '[Cover/Whiteout]';
          break;
        case 'redact':
          comment.text = '[Redaction]';
          break;
        case 'shape':
          comment.text = '[Shape]';
          break;
        case 'image':
          comment.text = '[Image]';
          break;
        default:
          if (obj.type === 'path') {
            comment.text = '[Drawing]';
          } else {
            comment.text = obj.text || `[${obj.type || 'Annotation'}]`;
          }
      }

      comment.date = obj.date || obj.created || new Date().toISOString();
      comments.push(comment);
    }
  }

  // Sort by page, then Y position (top to bottom)
  comments.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return a.position.y - b.position.y;
  });

  return comments;
}

/**
 * Export comments as plain text summary.
 * @param {number} currentPage
 * @returns {string}
 */
export function exportCommentsText(currentPage) {
  const comments = collectComments(currentPage);
  if (comments.length === 0) return 'No annotations found.';

  const lines = ['ANNOTATION SUMMARY', '═'.repeat(50), ''];
  let lastPage = -1;

  for (const c of comments) {
    if (c.page !== lastPage) {
      if (lastPage !== -1) lines.push('');
      lines.push(`── Page ${c.page} ${'─'.repeat(40)}`);
      lastPage = c.page;
    }

    const typeLabel = formatTypeName(c.type);
    const position = `(${c.position.x}, ${c.position.y})`;
    lines.push(`  [${typeLabel}] ${c.text}  ${position}`);
  }

  lines.push('', '═'.repeat(50));
  lines.push(`Total: ${comments.length} annotation(s)`);
  return lines.join('\n');
}

/**
 * Export comments as JSON.
 * @param {number} currentPage
 * @returns {string} JSON string
 */
export function exportCommentsJSON(currentPage) {
  const comments = collectComments(currentPage);
  return JSON.stringify({
    documentAnnotations: comments,
    exportDate: new Date().toISOString(),
    totalCount: comments.length,
  }, null, 2);
}

/**
 * Export comments as CSV.
 * @param {number} currentPage
 * @returns {string} CSV string
 */
export function exportCommentsCSV(currentPage) {
  const comments = collectComments(currentPage);
  const header = 'Page,Type,Text,X,Y,Color,Date';
  const rows = comments.map(c => {
    return [
      c.page,
      csvEscape(formatTypeName(c.type)),
      csvEscape(c.text || ''),
      c.position.x,
      c.position.y,
      csvEscape(c.color || ''),
      csvEscape(c.date || ''),
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

/* ═══════════════════ Annotation Count & Stats ═══════════════════ */

/**
 * Get annotation statistics for the document.
 * @param {number} currentPage
 * @returns {Object}
 */
export function getAnnotationStats(currentPage) {
  const comments = collectComments(currentPage);
  const byType = {};
  const byPage = {};

  for (const c of comments) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byPage[c.page] = (byPage[c.page] || 0) + 1;
  }

  return {
    total: comments.length,
    byType,
    byPage,
    pages: Object.keys(byPage).length,
  };
}

/* ═══════════════════ Annotation Flattening ═══════════════════ */

/**
 * Flatten all annotations into the PDF permanently.
 * This bakes annotations as images into each page and removes
 * the Fabric.js annotation data.
 *
 * @param {Object} opts
 * @param {Uint8Array} opts.pdfBytes - Original PDF bytes
 * @param {number} opts.currentPage - Current page
 * @param {number} opts.totalPages - Total pages
 * @param {string} opts.fileName - Filename
 * @returns {Promise<{bytes: Uint8Array, fileName: string}>}
 */
export async function flattenAnnotations(opts) {
  const { pdfBytes, currentPage, totalPages, fileName } = opts;
  const PDFLib = getPDFLib();
  const fabric = getFabric();
  if (!PDFLib || !pdfBytes) throw new Error('PDF not loaded');

  // Save current page
  savePageAnnotations(currentPage);

  const pageAnnotations = getAnnotations();
  const annotatedPages = Object.keys(pageAnnotations)
    .map(Number)
    .filter(p => {
      const json = pageAnnotations[p];
      return json && json.objects && json.objects.length > 0;
    });

  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  if (annotatedPages.length === 0) {
    return { bytes: await pdfDoc.save(), fileName: makeFlatName(fileName) };
  }

  const fabricCanvas = getCanvas();
  if (!fabricCanvas) throw new Error('Annotation canvas not available');

  for (const pageNum of annotatedPages) {
    const pageIndex = pageNum - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

    const page = pdfDoc.getPage(pageIndex);
    const { width: pw, height: ph } = page.getSize();
    const json = pageAnnotations[pageNum];

    // All objects get baked as a single image overlay
    if (json.objects && json.objects.length > 0) {
      // Render covers/redacts as black rects first
      const covers = json.objects.filter(o => o.mudbrickType === 'cover' || o.mudbrickType === 'redact');
      for (const cover of covers) {
        const cx = cover.left || 0;
        const cy = cover.top || 0;
        const cw = (cover.width || 0) * (cover.scaleX || 1);
        const ch = (cover.height || 0) * (cover.scaleY || 1);
        const canvasW = fabricCanvas.width || pw;
        const canvasH = fabricCanvas.height || ph;
        const sx = pw / canvasW;
        const sy = ph / canvasH;

        page.drawRectangle({
          x: cx * sx,
          y: ph - (cy * sy) - (ch * sy),
          width: cw * sx,
          height: ch * sy,
          color: PDFLib.rgb(0, 0, 0),
        });
      }

      // Render non-cover annotations to image
      const visual = json.objects.filter(o => o.mudbrickType !== 'cover' && o.mudbrickType !== 'redact');
      if (visual.length > 0) {
        const tempEl = document.createElement('canvas');
        tempEl.width = pw * 2;
        tempEl.height = ph * 2;
        document.body.appendChild(tempEl);

        const tempCanvas = new fabric.StaticCanvas(tempEl, { width: pw * 2, height: ph * 2 });
        const renderJson = { ...json, objects: visual };

        await new Promise(resolve => {
          tempCanvas.loadFromJSON(renderJson, () => {
            const canvasW = fabricCanvas.width || pw;
            const canvasH = fabricCanvas.height || ph;
            const sx = (pw * 2) / canvasW;
            const sy = (ph * 2) / canvasH;

            tempCanvas.getObjects().forEach(obj => {
              obj.set({
                left: obj.left * sx,
                top: obj.top * sy,
                scaleX: (obj.scaleX || 1) * sx,
                scaleY: (obj.scaleY || 1) * sy,
              });
              obj.setCoords();
            });
            tempCanvas.renderAll();
            resolve();
          });
        });

        const dataUrl = tempCanvas.toDataURL({ format: 'png', multiplier: 1 });
        tempCanvas.dispose();
        tempEl.remove();

        const pngBytes = dataUrlToUint8Array(dataUrl);
        const pngImage = await pdfDoc.embedPng(pngBytes);
        page.drawImage(pngImage, { x: 0, y: 0, width: pw, height: ph });
      }
    }
  }

  return {
    bytes: await pdfDoc.save(),
    fileName: makeFlatName(fileName),
  };
}

/* ═══════════════════ Helpers ═══════════════════ */

function formatTypeName(type) {
  const names = {
    'sticky-note': 'Note',
    'text': 'Text',
    'highlight': 'Highlight',
    'underline': 'Underline',
    'strikethrough': 'Strikethrough',
    'cover': 'Cover',
    'redact': 'Redaction',
    'stamp': 'Stamp',
    'shape': 'Shape',
    'image': 'Image',
    'path': 'Drawing',
  };
  return names[type] || type;
}

function makeFlatName(fileName) {
  if (!fileName) return 'document_flattened.pdf';
  return fileName.replace(/\.pdf$/i, '') + '_flattened.pdf';
}

function csvEscape(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
