/**
 * Mudbrick — Document Comparison (Phase 3)
 * Side-by-side visual comparison of two PDF documents.
 * Highlights differences at the pixel level by overlaying pages.
 *
 * Uses PDF.js to render each page to canvas, then compares pixels.
 */

/* ═══════════════════ Compare Engine ═══════════════════ */

/**
 * Compare two PDF documents page by page.
 * @param {Object} docA - PDF.js document (original)
 * @param {Object} docB - PDF.js document (modified)
 * @param {Object} opts
 * @param {number} opts.dpi - Comparison DPI (default 96)
 * @param {number} opts.threshold - Pixel diff threshold 0-255 (default 30)
 * @param {Function} [onProgress] - (page, total)
 * @returns {Promise<Object>} Comparison results
 */
export async function compareDocuments(docA, docB, opts = {}, onProgress) {
  const { dpi = 96, threshold = 30 } = opts;

  const pagesA = docA.numPages;
  const pagesB = docB.numPages;
  const maxPages = Math.max(pagesA, pagesB);

  const results = {
    pagesA,
    pagesB,
    maxPages,
    pages: [],
    totalDiffPixels: 0,
    totalPixels: 0,
  };

  for (let i = 1; i <= maxPages; i++) {
    const pageResult = {
      pageNum: i,
      hasA: i <= pagesA,
      hasB: i <= pagesB,
      diffPercentage: 0,
      diffPixelCount: 0,
      totalPixels: 0,
      diffCanvas: null, // Will hold the diff visualization canvas
    };

    try {
      if (i <= pagesA && i <= pagesB) {
        // Compare both pages
        const canvasA = await renderPageToCanvas(docA, i, dpi);
        const canvasB = await renderPageToCanvas(docB, i, dpi);

        const diff = diffCanvases(canvasA, canvasB, threshold);
        pageResult.diffPercentage = diff.percentage;
        pageResult.diffPixelCount = diff.diffCount;
        pageResult.totalPixels = diff.totalPixels;
        pageResult.diffCanvas = diff.canvas;
        pageResult.canvasA = canvasA;
        pageResult.canvasB = canvasB;

        results.totalDiffPixels += diff.diffCount;
        results.totalPixels += diff.totalPixels;
      } else if (i <= pagesA) {
        // Only in A
        const canvasA = await renderPageToCanvas(docA, i, dpi);
        pageResult.canvasA = canvasA;
        pageResult.diffPercentage = 100;
      } else {
        // Only in B
        const canvasB = await renderPageToCanvas(docB, i, dpi);
        pageResult.canvasB = canvasB;
        pageResult.diffPercentage = 100;
      }
    } catch (err) {
      console.warn(`Failed to render page ${i} for comparison:`, err);
      pageResult.error = err.message || String(err);
    }

    results.pages.push(pageResult);
    onProgress?.(i, maxPages);
  }

  results.overallDiffPercentage = results.totalPixels > 0
    ? (results.totalDiffPixels / results.totalPixels * 100)
    : 0;

  return results;
}

/**
 * Render a single page to an offscreen canvas.
 * @param {Object} pdfDoc - PDF.js document
 * @param {number} pageNum - 1-based page number
 * @param {number} dpi - Render DPI
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderPageToCanvas(pdfDoc, pageNum, dpi) {
  const page = await pdfDoc.getPage(pageNum);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return canvas;
}

/**
 * Pixel-level diff of two canvases.
 * Returns a diff canvas where changed pixels are highlighted in red.
 */
function diffCanvases(canvasA, canvasB, threshold) {
  // Use the larger dimensions
  const w = Math.max(canvasA.width, canvasB.width);
  const h = Math.max(canvasA.height, canvasB.height);

  // Create canvases of uniform size
  const normA = normalizeCanvas(canvasA, w, h);
  const normB = normalizeCanvas(canvasB, w, h);

  const ctxA = normA.getContext('2d');
  const ctxB = normB.getContext('2d');

  const dataA = ctxA.getImageData(0, 0, w, h);
  const dataB = ctxB.getImageData(0, 0, w, h);

  // Create diff canvas
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = w;
  diffCanvas.height = h;
  const ctxDiff = diffCanvas.getContext('2d');

  // Start with a dimmed version of A
  ctxDiff.drawImage(normA, 0, 0);
  ctxDiff.globalAlpha = 0.3;
  ctxDiff.fillStyle = '#ffffff';
  ctxDiff.fillRect(0, 0, w, h);
  ctxDiff.globalAlpha = 1.0;

  const diffData = ctxDiff.getImageData(0, 0, w, h);
  const pixelsA = dataA.data;
  const pixelsB = dataB.data;
  const diffPixels = diffData.data;
  const totalPixels = w * h;
  let diffCount = 0;

  for (let i = 0; i < pixelsA.length; i += 4) {
    const dr = Math.abs(pixelsA[i] - pixelsB[i]);
    const dg = Math.abs(pixelsA[i + 1] - pixelsB[i + 1]);
    const db = Math.abs(pixelsA[i + 2] - pixelsB[i + 2]);

    if (dr > threshold || dg > threshold || db > threshold) {
      // Mark as red highlight
      diffPixels[i] = 255;     // R
      diffPixels[i + 1] = 60;  // G
      diffPixels[i + 2] = 60;  // B
      diffPixels[i + 3] = 200; // A
      diffCount++;
    }
  }

  ctxDiff.putImageData(diffData, 0, 0);

  return {
    canvas: diffCanvas,
    diffCount,
    totalPixels,
    percentage: totalPixels > 0 ? (diffCount / totalPixels * 100) : 0,
  };
}

/**
 * Normalize a canvas to target dimensions (padding with white).
 */
function normalizeCanvas(src, targetW, targetH) {
  if (src.width === targetW && src.height === targetH) return src;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

/* ═══════════════════ Comparison Report ═══════════════════ */

/**
 * Generate a text summary of comparison results.
 * @param {Object} results - From compareDocuments()
 * @returns {string}
 */
export function generateCompareReport(results) {
  const lines = [
    'DOCUMENT COMPARISON REPORT',
    '═'.repeat(50),
    '',
    `Document A: ${results.pagesA} page(s)`,
    `Document B: ${results.pagesB} page(s)`,
    `Overall Difference: ${results.overallDiffPercentage.toFixed(2)}%`,
    '',
    '── Page Details ' + '─'.repeat(34),
  ];

  for (const page of results.pages) {
    const status = !page.hasA ? '[Only in B]' :
                   !page.hasB ? '[Only in A]' :
                   page.diffPercentage < 0.01 ? '[Identical]' :
                   page.diffPercentage < 1 ? '[Minor changes]' :
                   page.diffPercentage < 10 ? '[Modified]' :
                   '[Significantly changed]';

    lines.push(`  Page ${page.pageNum}: ${status}  (${page.diffPercentage.toFixed(2)}% different)`);
  }

  lines.push('', '═'.repeat(50));
  return lines.join('\n');
}

/* ═══════════════════ Side-by-Side Rendering ═══════════════════ */

/**
 * Render a side-by-side comparison view into a container.
 * @param {HTMLElement} container - Target DOM element
 * @param {Object} pageResult - Single page from comparison results
 * @param {Object} opts
 * @param {string} opts.view - 'side-by-side', 'overlay', 'diff-only'
 */
export function renderComparisonView(container, pageResult, opts = {}) {
  const { view = 'side-by-side' } = opts;
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.gap = '8px';
  container.style.justifyContent = 'center';
  container.style.overflow = 'auto';

  const maxH = 600;

  if (view === 'side-by-side') {
    if (pageResult.canvasA) {
      const wrapA = document.createElement('div');
      wrapA.style.cssText = 'text-align:center;flex:1;min-width:0;';
      wrapA.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Original</div>';
      const imgA = scaleToMaxHeight(pageResult.canvasA, maxH);
      imgA.style.border = '1px solid var(--mb-border)';
      wrapA.appendChild(imgA);
      container.appendChild(wrapA);
    }

    if (pageResult.canvasB) {
      const wrapB = document.createElement('div');
      wrapB.style.cssText = 'text-align:center;flex:1;min-width:0;';
      wrapB.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Modified</div>';
      const imgB = scaleToMaxHeight(pageResult.canvasB, maxH);
      imgB.style.border = '1px solid var(--mb-border)';
      wrapB.appendChild(imgB);
      container.appendChild(wrapB);
    }

    if (pageResult.diffCanvas) {
      const wrapD = document.createElement('div');
      wrapD.style.cssText = 'text-align:center;flex:1;min-width:0;';
      wrapD.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Differences</div>';
      const imgD = scaleToMaxHeight(pageResult.diffCanvas, maxH);
      imgD.style.border = '1px solid #cc0000';
      wrapD.appendChild(imgD);
      container.appendChild(wrapD);
    }
  } else if (view === 'overlay') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;position:relative;';
    if (pageResult.canvasA) {
      const imgA = scaleToMaxHeight(pageResult.canvasA, maxH);
      imgA.style.border = '1px solid var(--mb-border)';
      wrap.appendChild(imgA);
    }
    if (pageResult.diffCanvas) {
      const imgD = scaleToMaxHeight(pageResult.diffCanvas, maxH);
      imgD.style.cssText = 'position:absolute;top:0;left:0;opacity:0.5;border:1px solid #cc0000;';
      wrap.appendChild(imgD);
    }
    container.style.justifyContent = 'center';
    container.appendChild(wrap);
  } else if (view === 'diff-only' && pageResult.diffCanvas) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;';
    wrap.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Differences (${pageResult.diffPercentage.toFixed(2)}%)</div>`;
    const imgD = scaleToMaxHeight(pageResult.diffCanvas, maxH);
    imgD.style.border = '1px solid #cc0000';
    wrap.appendChild(imgD);
    container.appendChild(wrap);
  }
}

function scaleToMaxHeight(canvas, maxH) {
  const img = document.createElement('canvas');
  const scale = Math.min(1, maxH / canvas.height);
  img.width = canvas.width * scale;
  img.height = canvas.height * scale;
  const ctx = img.getContext('2d');
  ctx.drawImage(canvas, 0, 0, img.width, img.height);
  img.style.maxWidth = '100%';
  return img;
}
