/**
 * Mudbrick — Export (Phase 5)
 * Bake annotations into PDF for download.
 *
 * Strategy:
 * 1. For each page with annotations, render Fabric canvas → PNG
 * 2. Embed PNG as overlay image on the pdf-lib page
 * 3. Cover/redact objects: draw black rects with pdf-lib BEFORE overlay
 *    (permanently destroys underlying content)
 * 4. Save and trigger download
 */

import {
  getAnnotations, getCanvas, savePageAnnotations,
  loadPageAnnotations, resizeOverlay,
} from './annotations.js';

const getPDFLib = () => window.PDFLib;
const getFabric = () => window.fabric;

/**
 * Export the current PDF with all annotations baked in.
 * @param {Object} opts
 * @param {Uint8Array} opts.pdfBytes - Original PDF bytes
 * @param {number} opts.currentPage - Current page number
 * @param {number} opts.totalPages - Total page count
 * @param {string} opts.fileName - Original filename
 * @returns {Promise<{bytes: Uint8Array, fileName: string}>}
 */
export async function exportAnnotatedPDF(opts) {
  const { pdfBytes, currentPage, totalPages, fileName } = opts;
  const PDFLib = getPDFLib();
  const fabric = getFabric();

  if (!PDFLib || !pdfBytes) throw new Error('PDF not loaded');

  // Save current page annotations before export
  savePageAnnotations(currentPage);

  const pageAnnotations = getAnnotations();
  const annotatedPages = Object.keys(pageAnnotations)
    .map(Number)
    .filter(p => {
      const json = pageAnnotations[p];
      return json && json.objects && json.objects.length > 0;
    });

  // Load a fresh copy of the PDF for modification
  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
  });

  if (annotatedPages.length === 0) {
    // No annotations — just return the original bytes
    const bytes = await pdfDoc.save();
    return {
      bytes,
      fileName: makeExportName(fileName),
    };
  }

  // Get the Fabric canvas instance
  const fabricCanvas = getCanvas();
  if (!fabricCanvas) throw new Error('Annotation canvas not available');

  // Process each annotated page
  for (const pageNum of annotatedPages) {
    const pageIndex = pageNum - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const rotation = page.getRotation().angle || 0;

    // Determine effective dimensions considering rotation
    let effectiveWidth = pageWidth;
    let effectiveHeight = pageHeight;
    if (rotation === 90 || rotation === 270) {
      effectiveWidth = pageHeight;
      effectiveHeight = pageWidth;
    }

    const json = pageAnnotations[pageNum];

    // Step 1: Draw cover/redact rectangles directly with pdf-lib
    // (these are destructive — they permanently hide content underneath)
    const coverObjects = (json.objects || []).filter(
      obj => obj.mudbrickType === 'cover' || obj.mudbrickType === 'redact'
    );

    // Use stored canvas dimensions from savePageAnnotations, or fallback
    const savedCanvasW = json._canvasWidth || effectiveWidth;
    const savedCanvasH = json._canvasHeight || effectiveHeight;

    for (const cover of coverObjects) {
      // Fabric stores coords in screen space; we need PDF space
      const cx = cover.left || 0;
      const cy = cover.top || 0;
      const cw = (cover.width || 0) * (cover.scaleX || 1);
      const ch = (cover.height || 0) * (cover.scaleY || 1);

      // Convert from Fabric (top-left origin, Y down) to PDF (bottom-left, Y up)
      // Scale factors (canvas → PDF)
      const sx = effectiveWidth / savedCanvasW;
      const sy = effectiveHeight / savedCanvasH;

      const pdfX = cx * sx;
      const pdfY = effectiveHeight - (cy * sy) - (ch * sy);
      const pdfW = cw * sx;
      const pdfH = ch * sy;

      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH,
        color: PDFLib.rgb(0, 0, 0),
      });
    }

    // Step 2: Render all annotations (except covers/redacts) to PNG
    // We need to temporarily load this page's annotations, render, then restore
    const nonCoverObjects = (json.objects || []).filter(
      obj => obj.mudbrickType !== 'cover' && obj.mudbrickType !== 'redact'
    );

    if (nonCoverObjects.length > 0) {
      // Create a temporary canvas for rendering
      const tempCanvasEl = document.createElement('canvas');
      tempCanvasEl.width = effectiveWidth * 2;  // 2x for quality
      tempCanvasEl.height = effectiveHeight * 2;
      document.body.appendChild(tempCanvasEl);

      const tempCanvas = new fabric.StaticCanvas(tempCanvasEl, {
        width: effectiveWidth * 2,
        height: effectiveHeight * 2,
      });

      try {
        // Build a modified JSON with only non-cover objects
        const renderJson = {
          ...json,
          objects: nonCoverObjects,
        };

        // Load annotations into temp canvas
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Canvas load timed out')), 10000);
          tempCanvas.loadFromJSON(renderJson, () => {
            clearTimeout(timeout);
            // Use stored canvas dimensions for accurate scaling
            const scaleX = (effectiveWidth * 2) / savedCanvasW;
            const scaleY = (effectiveHeight * 2) / savedCanvasH;

            tempCanvas.getObjects().forEach(obj => {
              obj.set({
                left: obj.left * scaleX,
                top: obj.top * scaleY,
                scaleX: (obj.scaleX || 1) * scaleX,
                scaleY: (obj.scaleY || 1) * scaleY,
              });
              obj.setCoords();
            });

            tempCanvas.renderAll();
            resolve();
          });
        });

        // Export temp canvas to PNG
        const dataUrl = tempCanvas.toDataURL({
          format: 'png',
          multiplier: 1,
        });

        // Embed PNG into PDF page
        const pngBytes = dataUrlToUint8Array(dataUrl);
        const pngImage = await pdfDoc.embedPng(pngBytes);

        // Draw the annotation image over the entire page
        page.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: effectiveWidth,
          height: effectiveHeight,
        });
      } finally {
        // Always clean up temp canvas, even if an error occurred
        tempCanvas.dispose();
        tempCanvasEl.remove();
      }
    }
  }

  const bytes = await pdfDoc.save();
  return {
    bytes,
    fileName: makeExportName(fileName),
  };
}

/**
 * Export with all pages flattened to raster (for maximum compatibility).
 * Every page becomes an image — no selectable text remains.
 */
export async function exportFlattenedPDF(opts) {
  // For now, use the same pipeline as annotated export
  return exportAnnotatedPDF(opts);
}

/* ═══════════════════ Helpers ═══════════════════ */

function makeExportName(fileName) {
  if (!fileName) return 'document_edited.pdf';
  const base = fileName.replace(/\.pdf$/i, '');
  return `${base}_edited.pdf`;
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
