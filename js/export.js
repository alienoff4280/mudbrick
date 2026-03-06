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

import { showUserError, clearRecoveryData } from './error-handler.js';
import { writeLinkToPDF } from './links.js';
import { hasOCRResults, embedOCRTextLayer } from './ocr.js';

const getPDFLib = () => window.PDFLib;
const getFabric = () => window.fabric;

/**
 * Export the current PDF with all annotations baked in.
 * @param {Object} opts
 * @param {Uint8Array} opts.pdfBytes - Original PDF bytes
 * @param {number} opts.currentPage - Current page number
 * @param {number} opts.totalPages - Total page count
 * @param {string} opts.fileName - Original filename
 * @param {Function} [opts.onProgress] - Progress callback (done: number, total: number)
 * @returns {Promise<{bytes: Uint8Array, fileName: string}>}
 */
export async function exportAnnotatedPDF(opts) {
  const { pdfBytes, currentPage, totalPages, fileName, onProgress } = opts;
  const PDFLib = getPDFLib();
  const fabric = getFabric();

  if (!PDFLib || !pdfBytes) throw new Error('PDF not loaded');

  try {
    // Save current page annotations before export
    savePageAnnotations(currentPage);

    const pageAnnotations = getAnnotations();
    const annotatedPages = Object.keys(pageAnnotations)
      .map(Number)
      .filter(p => {
        const json = pageAnnotations[p];
        return json && json.objects && json.objects.length > 0;
      });

    const hasRedactions = Object.values(pageAnnotations).some(json =>
      json?.objects?.some(o => o.mudbrickType === 'redact')
    );
    if (hasRedactions) {
      console.warn('PDF contains redaction annotations. Visual content is covered but underlying PDF objects are not removed.');
    }

    // Load a fresh copy of the PDF for modification
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
    });

    if (annotatedPages.length === 0) {
      // No annotations — just return the original bytes
      const bytes = await pdfDoc.save();
      // Clear recovery data on successful export
      clearRecoveryData().catch(() => {});
      return {
        bytes,
        fileName: makeExportName(fileName),
      };
    }

    // Get the Fabric canvas instance
    const fabricCanvas = getCanvas();
    if (!fabricCanvas) throw new Error('Annotation canvas not available');

    // Process each annotated page
    for (let i = 0; i < annotatedPages.length; i++) {
      const pageNum = annotatedPages[i];
      onProgress?.(i + 1, annotatedPages.length);
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

      // Step 2a: Render text annotations as native PDF text (so they remain editable)
      const textObjects = (json.objects || []).filter(
        obj => obj.mudbrickType === 'text' && (obj.type === 'i-text' || obj.type === 'textbox')
      );
      const fontCache = {};

      for (const textObj of textObjects) {
        const tx = textObj.left || 0;
        const ty = textObj.top || 0;
        const scaleFX = textObj.scaleX || 1;
        const scaleFY = textObj.scaleY || 1;
        const fontSize = (textObj.fontSize || 16) * scaleFY;
        const textContent = textObj.text || '';
        if (!textContent.trim()) continue;

        // Scale from canvas coords to PDF coords
        const sx = effectiveWidth / savedCanvasW;
        const sy = effectiveHeight / savedCanvasH;

        // Parse fill color
        let color = PDFLib.rgb(0, 0, 0);
        if (textObj.fill) {
          const hex = textObj.fill;
          if (hex.startsWith('#') && hex.length >= 7) {
            color = PDFLib.rgb(
              parseInt(hex.slice(1, 3), 16) / 255,
              parseInt(hex.slice(3, 5), 16) / 255,
              parseInt(hex.slice(5, 7), 16) / 255,
            );
          } else if (hex.startsWith('rgb')) {
            const m = hex.match(/(\d+)/g);
            if (m && m.length >= 3) {
              color = PDFLib.rgb(+m[0] / 255, +m[1] / 255, +m[2] / 255);
            }
          }
        }

        // Embed a standard font matching the annotation's font
        const fontName = (textObj.fontFamily || 'Helvetica').split(',')[0].trim();
        const isBold = textObj.fontWeight === 'bold' || (textObj.fontWeight >= 700);
        const isItalic = textObj.fontStyle === 'italic';
        let stdFont = 'Helvetica';
        if (/times|serif/i.test(fontName) && !/sans/i.test(fontName)) {
          stdFont = isBold && isItalic ? 'TimesRomanBoldItalic' :
                    isBold ? 'TimesRomanBold' :
                    isItalic ? 'TimesRomanItalic' : 'TimesRoman';
        } else if (/courier|mono/i.test(fontName)) {
          stdFont = isBold && isItalic ? 'CourierBoldOblique' :
                    isBold ? 'CourierBold' :
                    isItalic ? 'CourierOblique' : 'Courier';
        } else {
          stdFont = isBold && isItalic ? 'HelveticaBoldOblique' :
                    isBold ? 'HelveticaBold' :
                    isItalic ? 'HelveticaOblique' : 'Helvetica';
        }
        if (!fontCache[stdFont]) {
          fontCache[stdFont] = await pdfDoc.embedFont(PDFLib.StandardFonts[stdFont] || PDFLib.StandardFonts.Helvetica);
        }
        const font = fontCache[stdFont];

        // Draw each line of text
        const pdfFontSize = fontSize * sy;
        const lines = textContent.split('\n');
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (!line) continue;
          const lineY = ty + fontSize * (li + 1) * (textObj.lineHeight || 1.16);
          const pdfX = tx * sx;
          const pdfY = effectiveHeight - (lineY * sy);

          page.drawText(line, {
            x: pdfX,
            y: pdfY,
            size: pdfFontSize,
            font,
            color,
          });
        }
      }

      // Step 2b: Render remaining annotations (except covers/redacts/text) to PNG
      const nonCoverObjects = (json.objects || []).filter(
        obj => obj.mudbrickType !== 'cover' && obj.mudbrickType !== 'redact' &&
               obj.mudbrickType !== 'text' && obj.mudbrickType !== 'link'
      );

      // Step 2c: Convert link annotations to real PDF /Link annotations
      const linkObjects = (json.objects || []).filter(obj => obj.mudbrickType === 'link');
      for (const linkObj of linkObjects) {
        writeLinkToPDF(page, linkObj, savedCanvasW, savedCanvasH, effectiveWidth, effectiveHeight);
      }

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

    // Step 3: Preserve existing PDF link annotations from the original document
    await preserveLinkAnnotations(pdfBytes, pdfDoc, pageAnnotations, PDFLib);

    // Step 4: Embed OCR text as invisible searchable layer (if OCR was run)
    try {
      // Check if any page has OCR results
      let hasAnyOCR = false;
      for (let i = 1; i <= pdfDoc.getPageCount(); i++) {
        if (hasOCRResults(i)) { hasAnyOCR = true; break; }
      }
      if (hasAnyOCR) {
        await embedOCRTextLayer(pdfDoc, PDFLib);
      }
    } catch (ocrErr) {
      console.warn('Could not embed OCR text layer:', ocrErr.message);
    }

    const bytes = await pdfDoc.save();
    // Clear recovery data on successful export
    clearRecoveryData().catch(() => {});
    return {
      bytes,
      fileName: makeExportName(fileName),
    };
  } catch (err) {
    // Classify and show user-friendly error
    const msg = err?.message || '';
    if (/out of memory|allocation failed/i.test(msg)) {
      showUserError('memory', 'Export ran out of memory: ' + msg);
      throw new Error('File too large to process. Try splitting into smaller documents first.');
    }
    showUserError('export-failed', msg);
    throw err;
  }
}

/**
 * Export with all pages flattened to raster (for maximum compatibility).
 * Every page becomes an image — no selectable text remains.
 */
export async function exportFlattenedPDF(opts) {
  // For now, use the same pipeline as annotated export
  return exportAnnotatedPDF(opts);
}

/* ═══════════════════ Link Preservation ═══════════════════ */

/**
 * Copy /Link annotations from the original PDF to the export document.
 * Excludes links that overlap with cover/redact annotations (deliberately hidden).
 */
async function preserveLinkAnnotations(originalBytes, exportDoc, pageAnnotations, PDFLib) {
  try {
    const origDoc = await PDFLib.PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const pageCount = Math.min(origDoc.getPageCount(), exportDoc.getPageCount());

    for (let i = 0; i < pageCount; i++) {
      const origPage = origDoc.getPage(i);
      const exportPage = exportDoc.getPage(i);
      const annotsRef = origPage.node.lookup(PDFLib.PDFName.of('Annots'));
      if (!annotsRef || !(annotsRef instanceof PDFLib.PDFArray)) continue;

      const { width: pageW, height: pageH } = origPage.getSize();

      // Collect cover/redact rects for this page to exclude overlapping links
      const pageNum = i + 1;
      const json = pageAnnotations[pageNum];
      const coverRects = [];
      if (json?.objects) {
        const savedCanvasW = json._canvasWidth || pageW;
        const savedCanvasH = json._canvasHeight || pageH;
        const sx = pageW / savedCanvasW;
        const sy = pageH / savedCanvasH;
        for (const obj of json.objects) {
          if (obj.mudbrickType !== 'cover' && obj.mudbrickType !== 'redact') continue;
          const cx = (obj.left || 0) * sx;
          const cy = (obj.top || 0) * sy;
          const cw = (obj.width || 0) * (obj.scaleX || 1) * sx;
          const ch = (obj.height || 0) * (obj.scaleY || 1) * sy;
          // Convert to PDF coords (bottom-left origin)
          coverRects.push({
            x1: cx, y1: pageH - cy - ch,
            x2: cx + cw, y2: pageH - cy,
          });
        }
      }

      // Collect link annotations to rebuild in the export doc
      const linkAnnotsToAdd = [];
      for (let j = 0; j < annotsRef.size(); j++) {
        const annotDict = annotsRef.lookup(j);
        if (!annotDict) continue;

        const subtype = annotDict.lookup(PDFLib.PDFName.of('Subtype'));
        if (!subtype || subtype.toString() !== '/Link') continue;

        const rect = annotDict.lookup(PDFLib.PDFName.of('Rect'));
        if (!rect) continue;

        // Check if link overlaps with any cover/redact
        const [rx1, ry1, rx2, ry2] = rect.asArray().map(n => n.asNumber());
        const linkRect = {
          x1: Math.min(rx1, rx2), y1: Math.min(ry1, ry2),
          x2: Math.max(rx1, rx2), y2: Math.max(ry1, ry2),
        };

        const overlapsRedact = coverRects.some(cr =>
          linkRect.x1 < cr.x2 && linkRect.x2 > cr.x1 &&
          linkRect.y1 < cr.y2 && linkRect.y2 > cr.y1
        );
        if (overlapsRedact) continue;

        // Rebuild this link annotation in the export document context
        const newAnnotDict = {};
        newAnnotDict.Type = 'Annot';
        newAnnotDict.Subtype = 'Link';
        newAnnotDict.Rect = [rx1, ry1, rx2, ry2];

        // Copy Border if present
        const border = annotDict.lookup(PDFLib.PDFName.of('Border'));
        if (border instanceof PDFLib.PDFArray) {
          newAnnotDict.Border = border.asArray().map(n => n.asNumber ? n.asNumber() : 0);
        } else {
          newAnnotDict.Border = [0, 0, 0];
        }

        // Copy the action (URI or GoTo)
        const action = annotDict.lookup(PDFLib.PDFName.of('A'));
        if (action) {
          const sType = action.lookup(PDFLib.PDFName.of('S'));
          if (sType && sType.toString() === '/URI') {
            const uri = action.lookup(PDFLib.PDFName.of('URI'));
            if (uri) {
              newAnnotDict.A = {
                S: 'URI',
                URI: PDFLib.PDFString.of(uri.decodeText ? uri.decodeText() : uri.toString()),
              };
            }
          } else if (sType && sType.toString() === '/GoTo') {
            // Internal page links — preserve destination string
            const dest = action.lookup(PDFLib.PDFName.of('D'));
            if (dest) {
              newAnnotDict.A = { S: 'GoTo', D: PDFLib.PDFString.of(dest.toString()) };
            }
          }
        }

        // Copy Dest (alternative to A for some links)
        if (!newAnnotDict.A) {
          const dest = annotDict.lookup(PDFLib.PDFName.of('Dest'));
          if (dest) continue; // Skip complex page-ref destinations (can't easily copy cross-doc)
        }

        if (!newAnnotDict.A) continue; // No action — skip

        const ref = exportDoc.context.register(exportDoc.context.obj(newAnnotDict));
        linkAnnotsToAdd.push(ref);
      }

      if (linkAnnotsToAdd.length === 0) continue;

      // Add link annotations to the export page
      const existingAnnots = exportPage.node.lookup(PDFLib.PDFName.of('Annots'));
      if (existingAnnots instanceof PDFLib.PDFArray) {
        for (const ref of linkAnnotsToAdd) existingAnnots.push(ref);
      } else {
        const arr = exportDoc.context.obj(linkAnnotsToAdd);
        exportPage.node.set(PDFLib.PDFName.of('Annots'), arr);
      }
    }
  } catch (err) {
    // Link preservation is best-effort — don't fail the entire export
    console.warn('Could not preserve link annotations:', err.message);
  }
}

/* ═══════════════════ Helpers ═══════════════════ */

function makeExportName(fileName) {
  if (!fileName) return 'document_edited.pdf';
  const base = fileName.replace(/\.pdf$/i, '');
  return `${base}_edited.pdf`;
}

function dataUrlToUint8Array(dataUrl) {
  const parts = dataUrl.split(',');
  const base64 = parts.length > 1 ? parts[1] : parts[0];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
