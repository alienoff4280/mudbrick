/**
 * Mudbrick — Renderer
 * Core page rendering pipeline, zoom controls, and icon replacement.
 */

import State from './state.js';
import { DOM } from './dom-refs.js';

import {
  renderPage, renderTextLayer, getNextZoom,
  calculateFitWidth, calculateFitPage,
  cleanupPage, getCleanupDistance,
} from './pdf-engine.js';

import { renderFormOverlay, clearFormOverlay } from './forms.js';
import { renderHighlights, hasMatches } from './find.js';
import { renderOCRTextLayer, hasOCRResults } from './ocr.js';
import {
  resizeOverlay, loadPageAnnotations, savePageAnnotations,
  getCanvas, getAnnotations,
} from './annotations.js';
import { extractLinksFromPage, createLinkRect } from './links.js';
import { initPageState } from './history.js';
import { icon } from './icons.js';
import {
  isTextEditActive, hasTextEditChanges, exitTextEditMode,
  isImageEditActive, hasImageEditChanges, exitImageEditMode,
} from './text-edit.js';

/* ═══════════════════ Callback bridge ═══════════════════ */

let _callbacks = {};

/**
 * Register callbacks for functions that live in app.js to avoid circular imports.
 * Called once during boot().
 */
export function setRendererCallbacks(cbs) { _callbacks = cbs; }

/* ═══════════════════ Module-level state ═══════════════════ */

// Render-pipeline state: generation counter for cancellation
let _renderGeneration = 0;

// Zoom throttle state — ensures Ctrl+scroll updates happen at most once per frame
let _zoomRafPending = false;
let _pendingZoom = null;

// Scroll restore state — preserves viewport position across zoom changes.
// Two modes:
//   { type: 'ratio', rx, ry }                          — ratio-based (button zoom)
//   { type: 'point', pageX, pageY, clientX, clientY }  — cursor-anchored (Ctrl+scroll)
let _pendingScrollRestore = null;

/* ═══════════════════ Icon replacement ═══════════════════ */

/** Replace all [data-icon] elements with inline SVGs from the icon system */
export function replaceIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.iconSize) || 16;
    el.innerHTML = icon(name, size);
  });
}

/* ═══════════════════ Core render ═══════════════════ */

export async function renderCurrentPage() {
  if (!State.pdfDoc) return;

  // Exit edit modes when navigating to a different page (warn if unsaved)
  if (isTextEditActive()) {
    if (hasTextEditChanges() && !confirm('You have unsaved text edits on this page. Discard changes?')) return;
    exitTextEditMode();
    DOM.btnEditText.classList.remove('active');
  }
  if (isImageEditActive()) {
    if (hasImageEditChanges() && !confirm('You have unsaved image edits on this page. Discard changes?')) return;
    exitImageEditMode();
    DOM.btnEditImage.classList.remove('active');
  }

  // Save annotations from the page we're leaving
  if (State._prevPage && State._prevPage !== State.currentPage) {
    savePageAnnotations(State._prevPage);
  }
  State._prevPage = State.currentPage;

  // Bump generation counter so any in-flight render knows it has been superseded
  const generation = ++_renderGeneration;

  const result = await renderPage(
    State.pdfDoc,
    State.currentPage,
    State.zoom,
    DOM.pdfCanvas
  );

  if (!result) return; // render was cancelled by pdf-engine (a newer render started)

  // If another renderCurrentPage() call started while we were awaiting, bail out
  if (generation !== _renderGeneration) return;

  const { viewport, page } = result;
  const renderedPage = State.currentPage; // snapshot page number in case of async race

  // Render text layer
  await renderTextLayer(page, viewport, DOM.textLayer);
  if (generation !== _renderGeneration) return;

  // Store viewport and render find highlights
  State._viewport = viewport;
  if (hasMatches()) {
    renderHighlights(renderedPage, DOM.textLayer, viewport);
  }

  // Inject OCR text layer if this page has been OCR'd
  if (hasOCRResults(renderedPage)) {
    renderOCRTextLayer(renderedPage, DOM.textLayer, viewport);
  }

  // Size the Fabric wrapper to match
  const w = Math.floor(viewport.width);
  const h = Math.floor(viewport.height);
  DOM.fabricWrapper.style.width = w + 'px';
  DOM.fabricWrapper.style.height = h + 'px';

  // Resize and reload annotation overlay
  resizeOverlay(w, h, State.zoom);
  loadPageAnnotations(renderedPage);

  // Extract existing PDF link annotations if no Fabric annotations are saved for this page
  const annotations = getAnnotations();
  if (!annotations[renderedPage] && State.pdfLibDoc) {
    try {
      const pdfPage = State.pdfLibDoc.getPage(renderedPage - 1);
      const { height: pageH } = pdfPage.getSize();
      const pdfLinks = extractLinksFromPage(pdfPage, pageH);
      if (pdfLinks.length > 0) {
        const fabCanvas = getCanvas();
        const { width: pageW } = pdfPage.getSize();
        const sx = w / pageW;
        const sy = h / pageH;
        for (const link of pdfLinks) {
          createLinkRect(fabCanvas, link.x * sx, link.y * sy, link.width * sx, link.height * sy, {
            linkType: link.type,
            linkURL: link.url,
            linkPage: link.page,
          });
        }
        fabCanvas.discardActiveObject();
        fabCanvas.renderAll();
        savePageAnnotations(renderedPage);
      }
    } catch (_) { /* ignore extraction errors */ }
  }

  // Ensure undo history has a baseline state for this page
  const canvas = getCanvas();
  if (canvas) {
    initPageState(renderedPage, canvas.toJSON());
  }

  // Render form field overlays
  clearFormOverlay();
  if (State.formFields.length > 0 && State.pdfLibDoc) {
    renderFormOverlay(
      DOM.pageContainer,
      State.formFields,
      State.pdfLibDoc,
      renderedPage - 1, // 0-based page index
      State.zoom,
      { width: viewport.width / State.zoom, height: viewport.height / State.zoom }
    );
  }

  // Size the page container
  DOM.pageContainer.style.width = Math.floor(viewport.width) + 'px';
  DOM.pageContainer.style.height = Math.floor(viewport.height) + 'px';

  // Restore scroll position after zoom-triggered resize
  if (_pendingScrollRestore) {
    const sr = _pendingScrollRestore;
    _pendingScrollRestore = null;
    const el = DOM.canvasArea;
    if (sr.type === 'point') {
      // Cursor-anchored: keep the same page point under the cursor
      el.scrollLeft = sr.pageX * State.zoom - sr.clientX;
      el.scrollTop = sr.pageY * State.zoom - sr.clientY;
    } else {
      // Ratio-based: preserve relative scroll position
      const maxX = el.scrollWidth - el.clientWidth;
      const maxY = el.scrollHeight - el.clientHeight;
      el.scrollLeft = sr.rx * maxX;
      el.scrollTop = sr.ry * maxY;
    }
  }

  // Refresh Notes sidebar
  _callbacks.refreshNotesSidebar?.();

  // Cleanup distant pages using a distance that adapts to memory pressure
  const _cleanupDist = getCleanupDistance();
  for (let i = 1; i <= State.totalPages; i++) {
    if (Math.abs(i - renderedPage) > _cleanupDist) {
      cleanupPage(State.pdfDoc, i);
    }
  }

  _callbacks.updateUndoRedoButtons?.();

  // Pre-warm adjacent pages during idle time so next/prev navigation feels instant.
  // Uses a detached off-screen canvas so the main canvas is never disturbed.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      if (!State.pdfDoc || generation !== _renderGeneration) return;
      const preWarm = (pNum) => {
        if (pNum < 1 || pNum > State.totalPages) return;
        const offCanvas = document.createElement('canvas');
        State.pdfDoc.getPage(pNum).then(pg => {
          const vp = pg.getViewport({ scale: State.zoom });
          offCanvas.width = Math.floor(vp.width);
          offCanvas.height = Math.floor(vp.height);
          const ctx = offCanvas.getContext('2d');
          return pg.render({ canvasContext: ctx, viewport: vp }).promise;
        }).catch(() => {}); // best-effort warm-up; ignore errors
      };
      preWarm(renderedPage - 1);
      preWarm(renderedPage + 1);
    }, { timeout: 2000 });
  }
}

/* ═══════════════════ Zoom ═══════════════════ */

export function _captureScrollRatio() {
  const el = DOM.canvasArea;
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  _pendingScrollRestore = {
    type: 'ratio',
    rx: maxX > 0 ? el.scrollLeft / maxX : 0.5,
    ry: maxY > 0 ? el.scrollTop / maxY : 0.5,
  };
}

export function setZoom(newZoom) {
  _captureScrollRatio();
  State.zoom = Math.max(0.25, Math.min(5.0, newZoom));
  updateZoomDisplay();
  renderCurrentPage();
}

/**
 * Throttled zoom setter for Ctrl+scroll — batches rapid wheel events to 60fps.
 * The display is updated immediately for smooth visual feedback; the expensive
 * re-render only fires once per animation frame.
 */
export function setZoomThrottled(newZoom) {
  // Scroll restore is set by the wheel handler (cursor-anchored), not here
  _pendingZoom = Math.max(0.25, Math.min(5.0, newZoom));
  State.zoom = _pendingZoom;   // update state immediately so display feels snappy
  updateZoomDisplay();

  if (!_zoomRafPending) {
    _zoomRafPending = true;
    requestAnimationFrame(() => {
      _zoomRafPending = false;
      if (_pendingZoom !== null) {
        const zoom = _pendingZoom;
        _pendingZoom = null;
        State.zoom = zoom;
        renderCurrentPage();
      }
    });
  }
}

export function zoomIn() { setZoom(getNextZoom(State.zoom, 1)); }
export function zoomOut() { setZoom(getNextZoom(State.zoom, -1)); }

export function fitWidth() {
  if (!State.pdfDoc) return;
  State.pdfDoc.getPage(State.currentPage).then(page => {
    const viewport = page.getViewport({ scale: 1 });
    const container = DOM.canvasArea;
    const newZoom = calculateFitWidth(viewport.width, container.clientWidth);
    setZoom(newZoom);
  }).catch(() => {});
}

export function fitPage() {
  if (!State.pdfDoc) return;
  State.pdfDoc.getPage(State.currentPage).then(page => {
    const viewport = page.getViewport({ scale: 1 });
    const container = DOM.canvasArea;
    const newZoom = calculateFitPage(
      viewport.width, viewport.height,
      container.clientWidth, container.clientHeight
    );
    setZoom(newZoom);
  }).catch(() => {});
}

export function updateZoomDisplay() {
  const pct = Math.round(State.zoom * 100) + '%';
  DOM.zoomBtn.textContent = pct;
  DOM.statusZoom.textContent = pct;
}

/**
 * Set the pending scroll restore from outside (used by wheel handler for cursor-anchored zoom).
 */
export function setPendingScrollRestore(value) {
  _pendingScrollRestore = value;
}
