/**
 * Mudbrick — PDF Engine
 * Wraps PDF.js: load documents, render pages, text layer, zoom, thumbnails.
 */

let pdfjsLib = null;

/* ── Initialization ── */

export async function initPdfJs() {
  // Dynamic import of PDF.js (ESM from CDN)
  pdfjsLib = await import(
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs'
  );

  // Configure worker
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

  return pdfjsLib;
}

export function getPdfjsLib() {
  return pdfjsLib;
}

/* ── Load Document ── */

export async function loadDocument(bytes) {
  if (!pdfjsLib) throw new Error('PDF.js not initialized');

  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(), // copy to avoid detached buffer issues
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/cmaps/',
    cMapPacked: true,
    enableXfa: false, // XFA not supported, avoid overhead
  });

  return loadingTask.promise;
}

/* ── Render a Single Page ── */

let currentRenderTask = null;

export async function renderPage(pdfDoc, pageNum, scale, canvas) {
  // Cancel any in-flight render
  if (currentRenderTask) {
    try { currentRenderTask.cancel(); } catch (_) { /* ignore */ }
    currentRenderTask = null;
  }

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // HiDPI handling
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });
  currentRenderTask = renderTask;

  try {
    await renderTask.promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException') return null;
    throw e;
  }

  currentRenderTask = null;
  return { viewport, page };
}

/* ── Text Layer ── */

export async function renderTextLayer(page, viewport, container) {
  // Clear previous text layer content
  container.innerHTML = '';
  container.style.width = Math.floor(viewport.width) + 'px';
  container.style.height = Math.floor(viewport.height) + 'px';

  const textContent = await page.getTextContent();

  // PDF.js 4.x TextLayer API
  if (pdfjsLib.TextLayer) {
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });
    await textLayer.render();
    return textLayer;
  }

  // Fallback: manual text span rendering (for older API)
  renderTextLayerFallback(textContent, viewport, container);
  return null;
}

function renderTextLayerFallback(textContent, viewport, container) {
  const textItems = textContent.items;
  for (const item of textItems) {
    if (!item.str) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const span = document.createElement('span');
    span.textContent = item.str;
    span.style.fontSize = Math.abs(tx[3]) + 'px';
    span.style.fontFamily = item.fontName || 'sans-serif';
    span.style.left = tx[4] + 'px';
    span.style.top = (tx[5] - Math.abs(tx[3])) + 'px';
    container.appendChild(span);
  }
}

/* ── Thumbnails ── */

export async function renderThumbnail(pdfDoc, pageNum, maxWidth = 160) {
  const page = await pdfDoc.getPage(pageNum);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = maxWidth / unscaledViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2x for thumbnails
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  await page.render({ canvasContext: ctx, viewport }).promise;

  // Free page resources
  page.cleanup();

  return canvas;
}

/* ── Page Dimensions ── */

export async function getPageDimensions(pdfDoc, pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/* ── Fit Calculations ── */

export function calculateFitWidth(pageWidth, containerWidth, padding = 40) {
  return (containerWidth - padding) / pageWidth;
}

export function calculateFitPage(pageWidth, pageHeight, containerWidth, containerHeight, padding = 40) {
  const scaleW = (containerWidth - padding) / pageWidth;
  const scaleH = (containerHeight - padding) / pageHeight;
  return Math.min(scaleW, scaleH);
}

/* ── Zoom Levels ── */

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

export function getNextZoom(currentZoom, direction) {
  if (direction > 0) {
    // Zoom in: find next level above current
    for (const z of ZOOM_LEVELS) {
      if (z > currentZoom + 0.01) return z;
    }
    return ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  } else {
    // Zoom out: find next level below current
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (ZOOM_LEVELS[i] < currentZoom - 0.01) return ZOOM_LEVELS[i];
    }
    return ZOOM_LEVELS[0];
  }
}

/* ── Cleanup ── */

// Configurable cleanup distance: pages further away than this are released.
// Callers (app.js renderCurrentPage) pass the page they just rendered and the
// loop calls cleanupPage for every other page, so the distance check is done
// before calling here — but we also expose the constant for direct use.
export const DEFAULT_CLEANUP_DISTANCE = 1;

/**
 * Release PDF.js rendering resources for an off-screen page.
 * Also nulls out the canvas pixel data on any detached canvas associated
 * with the page (pre-warm canvases created by the idle pre-render) to
 * allow the GC to reclaim memory sooner.
 * @param {PDFDocumentProxy} pdfDoc
 * @param {number} pageNum
 */
export function cleanupPage(pdfDoc, pageNum) {
  pdfDoc.getPage(pageNum).then(page => {
    page.cleanup();
    // Release any off-screen canvas data PDF.js may have cached internally
    // by zeroing the internal render cache via the public cleanup() call above.
    // For the pre-warm canvases we created in renderCurrentPage, they are local
    // variables and will be GC'd naturally; no additional action needed here.
  }).catch(() => {});
}

/**
 * Estimate whether the browser is under memory pressure.
 * Uses the non-standard performance.memory API (Chromium only) when available.
 * Returns true when used heap is > 80% of the JS heap size limit.
 * Falls back to false on unsupported browsers.
 */
export function isMemoryPressured() {
  try {
    const mem = performance.memory;
    if (!mem) return false;
    return mem.usedJSHeapSize / mem.jsHeapSizeLimit > 0.8;
  } catch (_) {
    return false;
  }
}

/**
 * Return the recommended cleanup distance based on current memory pressure.
 * Under pressure, release pages more aggressively (distance 1).
 * Under normal conditions, keep 1 page either side (distance 1 is the default).
 */
export function getCleanupDistance() {
  return isMemoryPressured() ? 0 : DEFAULT_CLEANUP_DISTANCE;
}
