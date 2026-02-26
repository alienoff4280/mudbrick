/**
 * Mudbrick — App Entry Point
 * State management, initialization, event wiring, navigation, zoom.
 *
 * This is an ES module. It dynamically imports PDF.js (ESM) and
 * uses static imports for app modules. UMD globals (PDFLib, fabric)
 * are available via window.
 */

import {
  initPdfJs, loadDocument, renderPage, renderTextLayer,
  renderThumbnail, getNextZoom, calculateFitWidth, calculateFitPage,
  cleanupPage,
} from './pdf-engine.js';

import {
  toast, showLoading, hideLoading, readFileAsArrayBuffer,
  formatFileSize, initDragDrop, debounce, downloadBlob, parsePageRanges,
} from './utils.js';

import {
  resetPdfLib, ensurePdfLib, rotatePage, deletePage,
  reorderPages, mergePDFs, splitPDF, addWatermark, appendPages,
  insertBlankPage, cropPages, replacePages,
} from './pdf-edit.js';

import {
  initAnnotations, setTool, savePageAnnotations,
  loadPageAnnotations, resizeOverlay, deleteSelected,
  updateToolOptions, getCanvas, hasAnnotations, getAnnotations, insertImage,
  undoAnnotation, redoAnnotation,
  bringToFront, sendToBack, bringForward, sendBackward,
  duplicateSelected, copySelected, pasteClipboard,
  lockSelected, unlockSelected, isSelectionLocked,
  getAllStickyNotes, updateSelectedNoteText, setOnStickyNoteSelected,
  addAnnotationToPage,
} from './annotations.js';

import { exportAnnotatedPDF } from './export.js';

import { icon } from './icons.js';

import {
  detectFormFields, renderFormOverlay, clearFormOverlay,
  writeFormValues, hasFormFields, resetFormState,
} from './forms.js';

import {
  buildTextIndex, clearTextIndex, searchText, findNext as findNextMatch,
  findPrevious as findPrevMatch, getMatchInfo, renderHighlights,
  scrollToActiveHighlight, isFindOpen, setFindOpen, hasMatches,
  augmentTextIndex,
} from './find.js';

import { applyBatesNumbers, previewBatesLabel } from './bates.js';
import { applyHeadersFooters, previewHeaderText } from './headers.js';
import { openSignatureModal, closeSignatureModal, initSignatureEvents } from './signatures.js';
import {
  runOCR, hasOCRResults, renderOCRTextLayer, getOCRTextEntries,
  clearOCRResults, terminateOCR,
} from './ocr.js';

import { encryptPDF, removeMetadata, getMetadata, setMetadata, sanitizeDocument } from './security.js';
import { REDACTION_PATTERNS, searchPatterns } from './redact-patterns.js';
import { exportPagesToImages, createPDFFromImages, optimizePDF } from './export-image.js';
import {
  addFormField, removeFormField, getTabOrder, setTabOrder,
  exportFormDataJSON, importFormDataJSON, exportFormDataXFDF,
  importFormDataXFDF, exportFormDataCSV, importFormDataCSV,
  flattenFormFields,
} from './form-creator.js';
import {
  exportCommentsText, exportCommentsJSON, exportCommentsCSV,
  getAnnotationStats, flattenAnnotations,
} from './comment-summary.js';
import { compareDocuments, generateCompareReport, renderComparisonView } from './doc-compare.js';
import { pushDocState, undoDoc, redoDoc, canUndoDoc, canRedoDoc, clearDocHistory } from './doc-history.js';
import { canUndo, canRedo, initPageState } from './history.js';
import { enterTextEditMode, exitTextEditMode, commitTextEdits, isTextEditActive, enterImageEditMode, exitImageEditMode, commitImageEdits, isImageEditActive } from './text-edit.js';
import { addExhibitStamp, setExhibitOptions, resetExhibitCount, countExistingExhibits, EXHIBIT_FORMATS } from './exhibit-stamps.js';
import { setLabelRange, getPageLabel, getLabelRanges, clearLabels, removeLabelRange, previewLabels, LABEL_FORMATS } from './page-labels.js';

/* ═══════════════════ State ═══════════════════ */

const State = {
  pdfDoc: null,
  pdfBytes: null,
  fileName: '',
  fileSize: 0,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  pageAnnotations: {},
  activeTool: 'select',
  sidebarOpen: true,
  panelOpen: false,
  formFields: [],  // detected form field descriptors
  pdfLibDoc: null,  // pdf-lib document for form support
  _viewport: null,  // cached viewport for find highlights
};

/* ═══════════════════ DOM References ═══════════════════ */

const $ = id => document.getElementById(id);

const DOM = {
  welcomeScreen: $('welcome-screen'),
  app: $('app'),
  pdfCanvas: $('pdf-canvas'),
  textLayer: $('text-layer'),
  fabricWrapper: $('fabric-canvas-wrapper'),
  canvasArea: $('canvas-area'),
  pageContainer: $('page-container'),
  thumbnailList: $('thumbnail-list'),
  sidebar: $('sidebar'),
  pageInput: $('page-input'),
  totalPages: $('total-pages'),
  zoomBtn: $('btn-zoom-level'),
  statusFilename: $('status-filename'),
  statusBarFilename: $('statusbar-filename'),
  statusPagesSize: $('status-pages-size'),
  statusZoom: $('status-zoom'),
  statusBates: $('status-bates'),
  statusBadgeEncrypted: $('status-badge-encrypted'),
  statusBadgeTagged: $('status-badge-tagged'),
  statusZoomIn: $('status-zoom-in'),
  statusZoomOut: $('status-zoom-out'),
  fileInput: $('file-input'),
  btnPrev: $('btn-prev-page'),
  btnNext: $('btn-next-page'),
  btnFirst: $('btn-first-page'),
  btnLast: $('btn-last-page'),
  propertiesPanel: $('properties-panel'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
  btnEditText: $('btn-edit-text'),
  btnEditImage: $('btn-edit-image'),
};

/* ═══════════════════ Initialization ═══════════════════ */

/** Replace all [data-icon] elements with inline SVGs from the icon system */
function replaceIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.iconSize) || 16;
    el.innerHTML = icon(name, size);
  });
}

async function boot() {
  try {
    // Initialize PDF.js (async CDN import)
    await initPdfJs();

    // Set up drag-and-drop on welcome screen
    initDragDrop('drop-zone', handleFiles);

    // Initialize Fabric.js annotation overlay
    initAnnotations('fabric-canvas');

    // Initialize signature modal events
    initSignatureEvents();

    // Set up sticky note selection callback
    setOnStickyNoteSelected((noteObj) => {
      showNotePropsPanel(noteObj);
      refreshNotesSidebar();
    });

    // Wire up all UI events
    wireEvents();
    initDropdownMenus();
    initModalFocusTrapping();

    // Replace emoji placeholders with SVG icons
    replaceIcons();

    // Restore dark mode preference
    if (localStorage.getItem('mudbrick-dark') === 'true' ||
        (!localStorage.getItem('mudbrick-dark') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      const btn = $('btn-dark-mode');
      if (btn) btn.innerHTML = icon('sun', 16);
    }

    // Auto-collapse sidebar on narrow screens
    if (window.innerWidth < 768) {
      State.sidebarOpen = false;
      DOM.sidebar.classList.add('collapsed');
      $('btn-toggle-sidebar').innerHTML = icon('panel-left-open', 16);
    }

    // Render recent files on welcome screen
    renderRecentFiles();

    // Clear recent files button
    $('btn-clear-recent')?.addEventListener('click', () => {
      clearRecentFiles();
    });

    // Offline detection
    initOfflineIndicator();

    // Warn before closing/navigating away when work might be lost
    window.addEventListener('beforeunload', (e) => {
      if (State.pdfDoc && hasAnnotations && hasAnnotations()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  } catch (e) {
    console.error('Boot failed:', e);
    toast('Failed to initialize PDF engine. Please refresh.', 'error');
  }
}

/* ═══════════════════ Recent Files ═══════════════════ */

const RECENT_FILES_KEY = 'mudbrick-recent-files';
const MAX_RECENT_FILES = 8;

function getRecentFiles() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY)) || [];
  } catch { return []; }
}

function addRecentFile(name, size, pageCount) {
  const recent = getRecentFiles();
  // Remove existing entry with same name
  const filtered = recent.filter(f => f.name !== name);
  // Add new entry at the top
  filtered.unshift({
    name,
    size,
    pageCount,
    openedAt: Date.now(),
  });
  // Keep only the last N
  const trimmed = filtered.slice(0, MAX_RECENT_FILES);
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(trimmed));
}

function clearRecentFiles() {
  localStorage.removeItem(RECENT_FILES_KEY);
  const container = $('recent-files');
  if (container) container.classList.add('hidden');
}

function renderRecentFiles() {
  const recent = getRecentFiles();
  const container = $('recent-files');
  const list = $('recent-files-list');
  if (!container || !list) return;

  if (recent.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  list.innerHTML = '';

  for (const file of recent) {
    const li = document.createElement('li');
    li.className = 'recent-file-item';

    const ago = formatTimeAgo(file.openedAt);
    const sizeStr = file.size ? formatFileSize(file.size) : '';
    const pagesStr = file.pageCount ? `${file.pageCount} pg` : '';
    const meta = [sizeStr, pagesStr, ago].filter(Boolean).join(' · ');

    li.innerHTML = `
      <span class="recent-file-icon">${icon('file', 16)}</span>
      <div class="recent-file-info">
        <div class="recent-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <div class="recent-file-meta">${meta}</div>
      </div>
    `;

    li.title = 'Click to learn more';
    list.appendChild(li);
    li.addEventListener('click', () => {
      toast('Use "Open a PDF" to reopen files — file data is not stored in browser', 'info');
    });
    li.style.cursor = 'pointer';
  }
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ═══════════════════ File Handling ═══════════════════ */

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  const file = files[0]; // Open first file
  const name = file.name.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name) ||
                  file.type.startsWith('image/');

  if (!name.endsWith('.pdf') && !isImage) {
    toast('Please select a PDF or image file.', 'warning');
    return;
  }

  showLoading('Opening file…');
  try {
    if (isImage) {
      const pdfBytes = await createPDFFromImages([file], { pageSize: 'fit' });
      const pdfName = file.name.replace(/\.[^.]+$/, '.pdf');
      await openPDF(pdfBytes, pdfName, pdfBytes.length);
      toast(`Opened ${file.name} as PDF`, 'success');
    } else {
      const bytes = await readFileAsArrayBuffer(file);
      await openPDF(bytes, file.name, file.size);
      toast(`Opened ${file.name}`, 'success');
    }
  } catch (e) {
    console.error('Failed to open file:', e);
    toast('Failed to open file. It may be corrupted or unsupported.', 'error');
  } finally {
    hideLoading();
  }
}

async function openPDF(bytes, fileName, fileSize) {
  // Reset previous state
  resetPdfLib();
  resetFormState();
  clearTextIndex();
  clearOCRResults();
  clearDocHistory();
  State.pageAnnotations = {};
  State.formFields = [];
  State.pdfLibDoc = null;

  // Destroy old PDF.js document to release resources
  if (State.pdfDoc) {
    try { State.pdfDoc.destroy(); } catch (_) { /* ignore */ }
    State.pdfDoc = null;
  }

  // Load with PDF.js
  const pdfDoc = await loadDocument(bytes);

  // Update state
  State.pdfDoc = pdfDoc;
  State.pdfBytes = bytes;
  State.fileName = fileName;
  State.fileSize = fileSize || bytes.length;
  State.totalPages = pdfDoc.numPages;
  State.currentPage = 1;
  State.zoom = 1.0;

  // Switch from welcome screen to app
  DOM.welcomeScreen.classList.add('hidden');
  DOM.app.classList.remove('hidden');

  // Enable toolbar buttons
  $('btn-merge').disabled = false;
  $('btn-split').disabled = false;
  $('btn-text').disabled = false;
  $('btn-draw').disabled = false;
  $('btn-highlight').disabled = false;
  $('btn-shape').disabled = false;
  $('btn-stamp').disabled = false;
  $('btn-cover').disabled = false;
  $('btn-redact').disabled = false;
  $('btn-watermark').disabled = false;
  $('btn-insert-image').disabled = false;
  $('btn-signature').disabled = false;
  $('btn-sticky-note').disabled = false;
  $('btn-underline').disabled = false;
  $('btn-strikethrough').disabled = false;
  $('btn-export').disabled = false;

  // Edit ribbon buttons
  $('btn-edit-text').disabled = false;
  if ($('btn-edit-image')) $('btn-edit-image').disabled = false;
  $('btn-insert-blank').disabled = false;
  $('btn-bates').disabled = false;
  $('btn-headers-footers').disabled = false;
  $('btn-crop-page').disabled = false;
  $('btn-page-labels').disabled = false;
  $('btn-replace-pages').disabled = false;
  $('btn-ocr').disabled = false;

  // Annotate ribbon — exhibit stamp
  $('btn-exhibit-stamp').disabled = false;
  if ($('btn-anno-image')) $('btn-anno-image').disabled = false;

  // Security ribbon buttons
  $('btn-encrypt').disabled = false;
  $('btn-metadata').disabled = false;
  $('btn-redact-search').disabled = false;
  $('btn-sanitize').disabled = false;

  // Tools ribbon buttons
  $('btn-export-image').disabled = false;
  $('btn-optimize').disabled = false;
  $('btn-compare').disabled = false;
  $('btn-comment-summary').disabled = false;
  $('btn-flatten-annotations').disabled = false;

  // Forms ribbon buttons
  $('btn-form-text').disabled = false;
  $('btn-form-checkbox').disabled = false;
  $('btn-form-dropdown').disabled = false;
  $('btn-form-radio').disabled = false;
  $('btn-form-signature').disabled = false;
  $('btn-form-button').disabled = false;
  $('btn-form-import').disabled = false;
  $('btn-form-export').disabled = false;
  $('btn-form-tab-order').disabled = false;
  $('btn-form-flatten').disabled = false;

  // Enable all tool-btn instances across ribbons (Annotate ribbon has duplicates without IDs)
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => { btn.disabled = false; });
  document.querySelectorAll('.sig-open-btn').forEach(btn => { btn.disabled = false; });

  // Detect form fields via pdf-lib
  try {
    const PDFLib = window.PDFLib;
    if (PDFLib) {
      State.pdfLibDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      State.formFields = detectFormFields(State.pdfLibDoc);
      if (State.formFields.length > 0) {
        toast(`Detected ${State.formFields.length} form field${State.formFields.length !== 1 ? 's' : ''}`, 'info');
      }
    }
  } catch (e) {
    console.warn('Form detection failed:', e);
  }

  // Add to recent files
  addRecentFile(fileName, fileSize || bytes.length, pdfDoc.numPages);

  // Update UI
  updateStatusBar();
  updatePageNav();
  updatePanelDocInfo();
  togglePropertiesPanel(true);
  $('floating-toolbar').classList.remove('hidden');

  // Render first page
  await renderCurrentPage();

  // Generate thumbnails lazily
  generateThumbnails();

  // Load document outline / bookmarks
  loadBookmarks();

  // Build text index for Find (async, non-blocking)
  buildTextIndex(State.pdfDoc);

  // Calculate initial fit-width zoom
  requestAnimationFrame(() => {
    fitWidth();
  });
}

/* ═══════════════════ Page Rendering ═══════════════════ */

async function renderCurrentPage() {
  if (!State.pdfDoc) return;

  // Exit edit modes when navigating to a different page
  if (isTextEditActive()) exitTextEditMode();
  if (isImageEditActive()) exitImageEditMode();

  // Save annotations from the page we're leaving
  if (State._prevPage && State._prevPage !== State.currentPage) {
    savePageAnnotations(State._prevPage);
  }
  State._prevPage = State.currentPage;

  const result = await renderPage(
    State.pdfDoc,
    State.currentPage,
    State.zoom,
    DOM.pdfCanvas
  );

  if (!result) return; // render was cancelled

  const { viewport, page } = result;

  // Render text layer
  await renderTextLayer(page, viewport, DOM.textLayer);

  // Store viewport and render find highlights
  State._viewport = viewport;
  if (hasMatches()) {
    renderHighlights(State.currentPage, DOM.textLayer, viewport);
  }

  // Inject OCR text layer if this page has been OCR'd
  if (hasOCRResults(State.currentPage)) {
    renderOCRTextLayer(State.currentPage, DOM.textLayer, viewport);
  }

  // Size the Fabric wrapper to match
  const w = Math.floor(viewport.width);
  const h = Math.floor(viewport.height);
  DOM.fabricWrapper.style.width = w + 'px';
  DOM.fabricWrapper.style.height = h + 'px';

  // Resize and reload annotation overlay
  resizeOverlay(w, h, State.zoom);
  loadPageAnnotations(State.currentPage);

  // Ensure undo history has a baseline state for this page
  const canvas = getCanvas();
  if (canvas) {
    initPageState(State.currentPage, canvas.toJSON());
  }

  // Render form field overlays
  clearFormOverlay();
  if (State.formFields.length > 0 && State.pdfLibDoc) {
    renderFormOverlay(
      DOM.pageContainer,
      State.formFields,
      State.pdfLibDoc,
      State.currentPage - 1, // 0-based page index
      State.zoom,
      { width: viewport.width / State.zoom, height: viewport.height / State.zoom }
    );
  }

  // Size the page container
  DOM.pageContainer.style.width = Math.floor(viewport.width) + 'px';
  DOM.pageContainer.style.height = Math.floor(viewport.height) + 'px';

  // Refresh Notes sidebar
  refreshNotesSidebar();

  // Cleanup distant pages
  for (let i = 1; i <= State.totalPages; i++) {
    if (Math.abs(i - State.currentPage) > 2) {
      cleanupPage(State.pdfDoc, i);
    }
  }

  updateUndoRedoButtons();
}

/* ═══════════════════ Navigation ═══════════════════ */

function goToPage(pageNum) {
  const clamped = Math.max(1, Math.min(pageNum, State.totalPages));
  if (clamped === State.currentPage) return;

  State.currentPage = clamped;
  updatePageNav();
  renderCurrentPage();
  highlightActiveThumbnail();

  // Scroll thumbnail into view
  const thumb = DOM.thumbnailList.querySelector(`[data-page="${clamped}"]`);
  if (thumb) thumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // Scroll canvas area to top on page change
  DOM.canvasArea.scrollTo({ top: 0, behavior: 'smooth' });
}

function prevPage() { goToPage(State.currentPage - 1); }
function nextPage() { goToPage(State.currentPage + 1); }
function firstPage() { goToPage(1); }
function lastPage() { goToPage(State.totalPages); }

function updatePageNav() {
  const label = typeof getPageLabel === 'function' ? getPageLabel(State.currentPage) : null;
  DOM.pageInput.value = label || State.currentPage;
  DOM.pageInput.max = State.totalPages;
  DOM.totalPages.textContent = State.totalPages;
  const atFirst = State.currentPage <= 1;
  const atLast = State.currentPage >= State.totalPages;
  DOM.btnFirst.disabled = atFirst;
  DOM.btnPrev.disabled = atFirst;
  DOM.btnNext.disabled = atLast;
  DOM.btnLast.disabled = atLast;
}

/* ═══════════════════ Zoom ═══════════════════ */

function setZoom(newZoom) {
  State.zoom = Math.max(0.25, Math.min(5.0, newZoom));
  updateZoomDisplay();
  renderCurrentPage();
}

function zoomIn() { setZoom(getNextZoom(State.zoom, 1)); }
function zoomOut() { setZoom(getNextZoom(State.zoom, -1)); }

function fitWidth() {
  if (!State.pdfDoc) return;
  State.pdfDoc.getPage(State.currentPage).then(page => {
    const viewport = page.getViewport({ scale: 1 });
    const container = DOM.canvasArea;
    const newZoom = calculateFitWidth(viewport.width, container.clientWidth);
    setZoom(newZoom);
  }).catch(() => {});
}

function fitPage() {
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

function updateZoomDisplay() {
  const pct = Math.round(State.zoom * 100) + '%';
  DOM.zoomBtn.textContent = pct;
  DOM.statusZoom.textContent = pct;
}

/* ═══════════════════ Thumbnails ═══════════════════ */

function generateThumbnails() {
  DOM.thumbnailList.innerHTML = '';

  // Create placeholder items for all pages
  for (let i = 1; i <= State.totalPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item' + (i === State.currentPage ? ' active' : '');
    item.dataset.page = i;
    item.innerHTML = `
      <div class="thumbnail-placeholder">${i}</div>
      <span class="page-number">${getPageLabel(i)}</span>
    `;
    item.addEventListener('click', () => goToPage(i));
    item.addEventListener('contextmenu', e => showContextMenu(e, i));
    DOM.thumbnailList.appendChild(item);
  }

  // Lazy-render thumbnails as they scroll into view
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const item = entry.target;
        const pageNum = parseInt(item.dataset.page);
        if (item.querySelector('.thumbnail-placeholder')) {
          renderThumbnailForItem(item, pageNum);
        }
        observer.unobserve(item);
      }
    });
  }, {
    root: DOM.thumbnailList,
    rootMargin: '200px', // pre-render 200px before visible
  });

  DOM.thumbnailList.querySelectorAll('.thumbnail-item').forEach(item => {
    observer.observe(item);
  });
}

async function renderThumbnailForItem(item, pageNum) {
  try {
    const thumbWidth = DOM.sidebar.clientWidth - 24; // minus padding
    const canvas = await renderThumbnail(State.pdfDoc, pageNum, thumbWidth);

    // Replace placeholder with rendered canvas
    const placeholder = item.querySelector('.thumbnail-placeholder');
    if (placeholder) {
      item.replaceChild(canvas, placeholder);
    }
  } catch (e) {
    console.warn(`Thumbnail render failed for page ${pageNum}:`, e);
  }
}

function highlightActiveThumbnail() {
  DOM.thumbnailList.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.page) === State.currentPage);
  });
}

/* ═══════════════════ Reload After Edit ═══════════════════ */

/**
 * After pdf-lib modifies the document and returns new bytes,
 * reload into PDF.js so the user sees the changes.
 */
async function reloadAfterEdit(newBytes, { skipHistory = false } = {}) {
  // Save current bytes for document-level undo (unless this IS an undo/redo)
  if (!skipHistory && State.pdfBytes) {
    pushDocState(State.pdfBytes);
  }

  resetPdfLib(); // clear cached pdf-lib doc so next edit re-loads
  clearFormOverlay();

  // Destroy old PDF.js document to release cached pages & prevent stale renders
  if (State.pdfDoc) {
    try { State.pdfDoc.destroy(); } catch (_) { /* ignore */ }
    State.pdfDoc = null;
  }

  const pdfDoc = await loadDocument(newBytes);

  State.pdfDoc = pdfDoc;
  State.pdfBytes = newBytes;
  State.fileSize = newBytes.length;
  State.totalPages = pdfDoc.numPages;

  // Re-detect form fields
  try {
    const PDFLib = window.PDFLib;
    if (PDFLib) {
      State.pdfLibDoc = await PDFLib.PDFDocument.load(newBytes, { ignoreEncryption: true });
      State.formFields = detectFormFields(State.pdfLibDoc);
    }
  } catch (e) {
    State.formFields = [];
  }

  // Clamp current page if it was deleted
  if (State.currentPage > State.totalPages) {
    State.currentPage = State.totalPages;
  }

  updateStatusBar();
  updatePageNav();
  await renderCurrentPage();

  // Defer thumbnail generation so it doesn't race with the main canvas render
  // (renderThumbnail calls page.cleanup() which could interfere)
  setTimeout(() => generateThumbnails(), 50);

  // Rebuild text index for Find
  buildTextIndex(State.pdfDoc);
  updateUndoRedoButtons();
}

/* ═══════════════════ Undo / Redo (unified) ═══════════════════ */

function updateUndoRedoButtons() {
  if (DOM.btnUndo) {
    DOM.btnUndo.disabled = !(canUndoDoc() || canUndo(State.currentPage));
  }
  if (DOM.btnRedo) {
    DOM.btnRedo.disabled = !(canRedoDoc() || canRedo(State.currentPage));
  }
}

async function handleUndo() {
  // Try document-level undo first (more impactful: text edits, insert page, crop…)
  if (canUndoDoc()) {
    const prevBytes = undoDoc(State.pdfBytes);
    if (prevBytes) {
      await reloadAfterEdit(prevBytes, { skipHistory: true });
      toast('Undo successful');
    }
    updateUndoRedoButtons();
    return;
  }
  // Fall back to annotation undo
  if (canUndo(State.currentPage)) {
    undoAnnotation();
    updateUndoRedoButtons();
  }
}

async function handleRedo() {
  // Try document-level redo first
  if (canRedoDoc()) {
    const nextBytes = redoDoc(State.pdfBytes);
    if (nextBytes) {
      await reloadAfterEdit(nextBytes, { skipHistory: true });
      toast('Redo successful');
    }
    updateUndoRedoButtons();
    return;
  }
  // Fall back to annotation redo
  if (canRedo(State.currentPage)) {
    redoAnnotation();
    updateUndoRedoButtons();
  }
}

/* ═══════════════════ Text Editing ═══════════════════ */

function handleEditText() {
  if (!State.pdfDoc) return;
  if (isTextEditActive()) {
    exitTextEditMode();
    DOM.btnEditText.classList.remove('active');
    return;
  }
  enterTextEditMode(State.currentPage, State.pdfDoc, State._viewport, DOM.textLayer)
    .then(ok => {
      if (ok) DOM.btnEditText.classList.add('active');
    }).catch(err => console.warn('Text edit failed:', err));
}

async function handleCommitTextEdits() {
  if (!isTextEditActive()) return;
  try {
    showLoading('Applying text edits…');
    const newBytes = await commitTextEdits(State.pdfBytes, State.currentPage);
    if (newBytes) {
      await reloadAfterEdit(newBytes);
      toast('Text edits applied');
    } else {
      toast('No changes to apply', 'info');
    }
  } catch (err) {
    console.error('Text edit commit failed:', err);
    toast('Text edit failed: ' + err.message, 'error');
  } finally {
    exitTextEditMode();
    DOM.btnEditText.classList.remove('active');
    hideLoading();
  }
}

function handleCancelTextEdits() {
  exitTextEditMode();
  DOM.btnEditText.classList.remove('active');
}

/* ═══════════════════ Image Editing ═══════════════════ */

function handleEditImage() {
  if (!State.pdfDoc) return;
  if (isImageEditActive()) {
    exitImageEditMode();
    DOM.btnEditImage.classList.remove('active');
    return;
  }
  enterImageEditMode(State.currentPage, State.pdfDoc, State._viewport, DOM.textLayer)
    .then(ok => {
      if (ok) DOM.btnEditImage.classList.add('active');
    }).catch(err => console.warn('Image edit failed:', err));
}

async function handleCommitImageEdits() {
  if (!isImageEditActive()) return;
  try {
    showLoading('Applying image edits…');
    const newBytes = await commitImageEdits(State.pdfBytes, State.currentPage);
    if (newBytes) {
      await reloadAfterEdit(newBytes);
      toast('Image edits applied');
    } else {
      toast('No changes to apply', 'info');
    }
  } catch (err) {
    console.error('Image edit commit failed:', err);
    toast('Image edit failed: ' + err.message, 'error');
  } finally {
    exitImageEditMode();
    DOM.btnEditImage.classList.remove('active');
    hideLoading();
  }
}

function handleCancelImageEdits() {
  exitImageEditMode();
  DOM.btnEditImage.classList.remove('active');
}

/* ═══════════════════ Find Bar ═══════════════════ */

function openFindBar() {
  const bar = $('find-bar');
  if (!bar || !State.pdfDoc) return;
  bar.classList.remove('hidden');
  setFindOpen(true);
  const input = $('find-input');
  input.focus();
  input.select();
  replaceIcons();
}

function closeFindBar() {
  const bar = $('find-bar');
  if (!bar) return;
  bar.classList.add('hidden');
  setFindOpen(false);
  $('find-input').value = '';
  $('find-match-count').textContent = '';
  // Clear search state and highlights
  searchText('', false);
  DOM.textLayer.querySelectorAll('.find-highlight').forEach(el => el.remove());
}

function performSearch() {
  const input = $('find-input');
  const cs = $('find-case-sensitive').checked;
  const q = input.value.trim();

  const { total } = searchText(q, cs);
  const countEl = $('find-match-count');

  if (!q) {
    countEl.textContent = '';
  } else if (total === 0) {
    countEl.textContent = '0 of 0';
  } else {
    const info = getMatchInfo();
    countEl.textContent = `${info.current} of ${info.total}`;
  }

  // Render highlights on current page
  if (State._viewport) {
    renderHighlights(State.currentPage, DOM.textLayer, State._viewport);
  }

  // Navigate to first match page if needed
  if (total > 0) {
    const info = getMatchInfo();
    if (info.pageNum !== State.currentPage) {
      goToPage(info.pageNum);
    }
    setTimeout(scrollToActiveHighlight, 100);
  }
}

function navigateMatch(direction) {
  const result = direction === 'next' ? findNextMatch() : findPrevMatch();
  if (!result) return;

  const info = getMatchInfo();
  $('find-match-count').textContent = `${info.current} of ${info.total}`;

  if (result.pageNum !== State.currentPage) {
    goToPage(result.pageNum);
  } else if (State._viewport) {
    renderHighlights(State.currentPage, DOM.textLayer, State._viewport);
  }
  setTimeout(scrollToActiveHighlight, 100);
}

/* ═══════════════════ Bookmarks / Document Outline ═══════════════════ */

async function loadBookmarks() {
  const panel = $('sidebar-bookmarks');
  if (!panel || !State.pdfDoc) return;

  try {
    const outline = await State.pdfDoc.getOutline();

    if (!outline || outline.length === 0) {
      panel.innerHTML = `
        <div class="sidebar-empty">
          <span data-icon="bookmark" data-icon-size="24"></span>
          <p>No bookmarks</p>
          <p class="sidebar-empty-hint">This PDF has no document outline.</p>
        </div>`;
      replaceIcons(); // re-render the data-icon
      return;
    }

    // Recursively build bookmark tree
    async function buildTree(items) {
      const ul = document.createElement('ul');
      ul.className = 'bookmark-tree';

      for (const item of items) {
        const li = document.createElement('li');
        li.className = 'bookmark-item';

        const hasChildren = item.items && item.items.length > 0;

        // Resolve destination to page number
        let pageNum = null;
        try {
          if (item.dest) {
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await State.pdfDoc.getDestination(dest);
            }
            if (Array.isArray(dest) && dest[0]) {
              const pageIndex = await State.pdfDoc.getPageIndex(dest[0]);
              pageNum = pageIndex + 1;
            }
          }
        } catch { /* broken destination — still show title */ }

        const row = document.createElement('div');
        row.className = 'bookmark-row';

        if (hasChildren) {
          const toggle = document.createElement('button');
          toggle.className = 'bookmark-toggle';
          toggle.innerHTML = icon('chevron-right', 12);
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('expanded');
          });
          row.appendChild(toggle);
        } else {
          const spacer = document.createElement('span');
          spacer.className = 'bookmark-spacer';
          row.appendChild(spacer);
        }

        const link = document.createElement('button');
        link.className = 'bookmark-link';
        link.textContent = item.title || 'Untitled';
        if (pageNum !== null) {
          link.title = `Go to page ${pageNum}`;
          link.addEventListener('click', () => {
            goToPage(pageNum);
            // Highlight active bookmark
            panel.querySelectorAll('.bookmark-link.active').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
          });
        } else {
          link.classList.add('disabled');
          link.title = 'Destination unavailable';
        }
        row.appendChild(link);

        if (pageNum !== null) {
          const badge = document.createElement('span');
          badge.className = 'bookmark-page-badge';
          badge.textContent = pageNum;
          row.appendChild(badge);
        }

        li.appendChild(row);

        if (hasChildren) {
          const childTree = await buildTree(item.items);
          li.appendChild(childTree);
        }

        ul.appendChild(li);
      }
      return ul;
    }

    const tree = await buildTree(outline);
    panel.innerHTML = '';
    panel.appendChild(tree);

  } catch (err) {
    console.warn('Failed to load bookmarks:', err);
    panel.innerHTML = `
      <div class="sidebar-empty">
        <span data-icon="bookmark" data-icon-size="24"></span>
        <p>No bookmarks</p>
        <p class="sidebar-empty-hint">Could not read document outline.</p>
      </div>`;
    replaceIcons();
  }
}

/* ═══════════════════ Thumbnail Context Menu ═══════════════════ */

let contextMenu = null;

function showContextMenu(e, pageNum) {
  e.preventDefault();
  hideContextMenu();

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.innerHTML = `
    <button data-action="insert-before">${icon('file-plus', 14)} Insert Page Before</button>
    <button data-action="insert-after">${icon('file-plus', 14)} Insert Page After</button>
    <button data-action="insert-blank">${icon('file-plus', 14)} Insert Blank Page</button>
    <button data-action="duplicate">${icon('files', 14)} Duplicate Page</button>
    <div class="context-menu-separator"></div>
    <button data-action="rotate-cw">${icon('rotate-cw', 14)} Rotate Right</button>
    <button data-action="rotate-ccw">${icon('rotate-ccw', 14)} Rotate Left</button>
    <button data-action="rotate-180">${icon('flip-vertical', 14)} Rotate 180°</button>
    <div class="context-menu-separator"></div>
    <button data-action="delete" ${State.totalPages <= 1 ? 'disabled' : ''}>${icon('trash', 14)} Delete Page</button>
    <button data-action="extract">${icon('file-output', 14)} Extract Page</button>
  `;

  // Position at mouse
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  document.body.appendChild(contextMenu);

  // Clamp to viewport
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  // Handle clicks
  contextMenu.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    hideContextMenu();

    const action = btn.dataset.action;
    const idx = pageNum - 1; // 0-based

    // Insert blank page
    if (action === 'insert-blank') {
      showLoading('Inserting page…');
      try {
        const newBytes = await insertBlankPage(State.pdfBytes, idx);
        State.currentPage = pageNum + 1; // navigate to the new blank page
        await reloadAfterEdit(newBytes);
        toast('Inserted blank page', 'success');
      } catch (err) {
        console.error('Insert blank page failed:', err);
        toast('Insert blank page failed: ' + err.message, 'error');
      } finally {
        hideLoading();
      }
      return;
    }

    // Insert page needs a file picker — not a loading operation
    if (action === 'insert-before' || action === 'insert-after') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.multiple = true;
      input.addEventListener('change', e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const insertAfter = action === 'insert-before' ? idx - 1 : idx;
        handleAddPages(files, insertAfter);
      });
      input.click();
      return;
    }

    // Duplicate page via pdf-lib
    if (action === 'duplicate') {
      showLoading('Duplicating page…');
      try {
        const PDFLib = window.PDFLib;
        const doc = await PDFLib.PDFDocument.load(State.pdfBytes, { ignoreEncryption: true });
        const [copied] = await doc.copyPages(doc, [idx]);
        doc.insertPage(idx + 1, copied);
        const newBytes = await doc.save();
        State.currentPage = pageNum + 1;
        await reloadAfterEdit(newBytes);
        toast(`Duplicated page ${pageNum}`, 'success');
      } catch (err) {
        console.error('Duplicate page failed:', err);
        toast('Duplicate failed: ' + err.message, 'error');
      } finally {
        hideLoading();
      }
      return;
    }

    showLoading('Editing page…');
    try {
      let newBytes;
      switch (action) {
        case 'rotate-cw':
          newBytes = await rotatePage(State.pdfBytes, idx, 90);
          await reloadAfterEdit(newBytes);
          toast('Rotated page right', 'success');
          break;
        case 'rotate-ccw':
          newBytes = await rotatePage(State.pdfBytes, idx, -90);
          await reloadAfterEdit(newBytes);
          toast('Rotated page left', 'success');
          break;
        case 'rotate-180':
          newBytes = await rotatePage(State.pdfBytes, idx, 180);
          await reloadAfterEdit(newBytes);
          toast('Rotated page 180°', 'success');
          break;
        case 'delete':
          if (State.totalPages <= 1) return;
          newBytes = await deletePage(State.pdfBytes, idx);
          // If we deleted the current page or a page before it, adjust
          if (pageNum <= State.currentPage && State.currentPage > 1) {
            State.currentPage--;
          }
          await reloadAfterEdit(newBytes);
          toast(`Deleted page ${pageNum}`, 'success');
          break;
        case 'extract': {
          const extracted = await splitPDF(State.pdfBytes, [[idx]]);
          const part = extracted[0];
          const name = State.fileName.replace('.pdf', '') + `_${part.label}.pdf`;
          downloadBlob(part.bytes, name);
          toast(`Extracted ${part.label}`, 'success');
          break;
        }
      }
    } catch (err) {
      console.error('Page operation failed:', err);
      toast('Operation failed: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

  // Close on click outside or Escape
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
    document.addEventListener('keydown', function onKey(ev) {
      if (ev.key === 'Escape') {
        hideContextMenu();
        document.removeEventListener('keydown', onKey);
      }
    });
  }, 0);
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

/* ═══════════════════ Annotation Context Menu ═══════════════════ */

function showAnnotationContextMenu(e, target) {
  e.preventDefault();
  e.stopPropagation();
  hideContextMenu();

  const canvas = getCanvas();
  if (!canvas) return;

  const locked = target ? !!target.lockMovementX : false;
  const hasSelection = !!target;

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.innerHTML = `
    <button data-action="anno-copy" ${!hasSelection ? 'disabled' : ''}>${icon('copy', 14)} Copy</button>
    <button data-action="anno-paste">${icon('clipboard-paste', 14)} Paste</button>
    <button data-action="anno-duplicate" ${!hasSelection ? 'disabled' : ''}>${icon('files', 14)} Duplicate</button>
    <div class="context-menu-separator"></div>
    <button data-action="anno-front" ${!hasSelection ? 'disabled' : ''}>${icon('arrow-up-to-line', 14)} Bring to Front</button>
    <button data-action="anno-forward" ${!hasSelection ? 'disabled' : ''}>${icon('chevron-up', 14)} Bring Forward</button>
    <button data-action="anno-backward" ${!hasSelection ? 'disabled' : ''}>${icon('chevron-down', 14)} Send Backward</button>
    <button data-action="anno-back" ${!hasSelection ? 'disabled' : ''}>${icon('arrow-down-to-line', 14)} Send to Back</button>
    <div class="context-menu-separator"></div>
    <button data-action="anno-lock" ${!hasSelection ? 'disabled' : ''}>${locked ? icon('lock', 14) + ' Unlock' : icon('lock-open', 14) + ' Lock'}</button>
    <button data-action="anno-delete" ${!hasSelection ? 'disabled' : ''}>${icon('trash', 14)} Delete</button>
  `;

  // Position at mouse
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  document.body.appendChild(contextMenu);

  // Clamp to viewport
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  // Handle clicks
  contextMenu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    hideContextMenu();

    switch (btn.dataset.action) {
      case 'anno-copy':      copySelected(); break;
      case 'anno-paste':     pasteClipboard(); break;
      case 'anno-duplicate': duplicateSelected(); break;
      case 'anno-front':     bringToFront(); break;
      case 'anno-forward':   bringForward(); break;
      case 'anno-backward':  sendBackward(); break;
      case 'anno-back':      sendToBack(); break;
      case 'anno-lock':
        if (locked) unlockSelected();
        else lockSelected();
        break;
      case 'anno-delete':    deleteSelected(); break;
    }
  });

  // Close on click outside or Escape
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
    document.addEventListener('keydown', function onKey(ev) {
      if (ev.key === 'Escape') {
        hideContextMenu();
        document.removeEventListener('keydown', onKey);
      }
    });
  }, 0);
}

/* ═══════════════════ Merge Modal ═══════════════════ */

let mergeFiles = []; // [{ file: File, bytes: Uint8Array, name, size }]

function openMergeModal() {
  mergeFiles = [];
  renderMergeFileList();
  $('merge-modal-backdrop').classList.remove('hidden');
  $('btn-merge-execute').disabled = true;
}

function closeMergeModal() {
  $('merge-modal-backdrop').classList.add('hidden');
  mergeFiles = [];
}

async function addMergeFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    const bytes = await readFileAsArrayBuffer(file);
    mergeFiles.push({ file, bytes, name: file.name, size: file.size });
  }
  renderMergeFileList();
  $('btn-merge-execute').disabled = mergeFiles.length < 2;
}

function renderMergeFileList() {
  const list = $('merge-file-list');
  list.innerHTML = '';
  mergeFiles.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'file-list-item';
    li.innerHTML = `
      <span class="file-list-name">${icon('file', 14)} ${item.name}</span>
      <span class="file-list-size">${formatFileSize(item.size)}</span>
      <div class="file-list-actions">
        <button class="file-list-btn" data-move="up" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
        <button class="file-list-btn" data-move="down" ${i === mergeFiles.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
        <button class="file-list-btn" data-remove="${i}" title="Remove">✕</button>
      </div>
    `;

    // Move up
    li.querySelector('[data-move="up"]')?.addEventListener('click', () => {
      if (i > 0) { [mergeFiles[i - 1], mergeFiles[i]] = [mergeFiles[i], mergeFiles[i - 1]]; renderMergeFileList(); }
    });
    // Move down
    li.querySelector('[data-move="down"]')?.addEventListener('click', () => {
      if (i < mergeFiles.length - 1) { [mergeFiles[i], mergeFiles[i + 1]] = [mergeFiles[i + 1], mergeFiles[i]]; renderMergeFileList(); }
    });
    // Remove
    li.querySelector('[data-remove]')?.addEventListener('click', () => {
      mergeFiles.splice(i, 1);
      renderMergeFileList();
      $('btn-merge-execute').disabled = mergeFiles.length < 2;
    });

    list.appendChild(li);
  });
}

async function executeMerge() {
  if (mergeFiles.length < 2) return;
  showLoading('Merging PDFs…');
  try {
    const fileList = mergeFiles.map(f => ({ bytes: f.bytes }));
    const mergedBytes = await mergePDFs(fileList);
    closeMergeModal();
    await openPDF(mergedBytes, 'merged.pdf', mergedBytes.length);
    toast(`Merged ${fileList.length} files`, 'success');
  } catch (err) {
    console.error('Merge failed:', err);
    toast('Merge failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Split Modal ═══════════════════ */

function openSplitModal() {
  $('split-range-input').value = '';
  $('split-preview').textContent = '';
  $('btn-split-execute').disabled = true;
  $('split-modal-backdrop').classList.remove('hidden');
}

function closeSplitModal() {
  $('split-modal-backdrop').classList.add('hidden');
}

function updateSplitPreview() {
  const input = $('split-range-input').value.trim();
  const preview = $('split-preview');

  if (!input) {
    preview.textContent = '';
    $('btn-split-execute').disabled = true;
    return;
  }

  const ranges = parsePageRanges(input, State.totalPages);
  if (!ranges) {
    preview.textContent = `Invalid range. Pages are 1-${State.totalPages}.`;
    preview.style.color = 'var(--mb-danger)';
    $('btn-split-execute').disabled = true;
    return;
  }

  const desc = ranges.map(r => {
    const first = r[0] + 1;
    const last = r[r.length - 1] + 1;
    return first === last ? `Page ${first}` : `Pages ${first}-${last}`;
  }).join(', ');

  preview.textContent = `Will create ${ranges.length} file${ranges.length > 1 ? 's' : ''}: ${desc}`;
  preview.style.color = 'var(--mb-text-secondary)';
  $('btn-split-execute').disabled = false;
}

async function executeSplit() {
  const input = $('split-range-input').value.trim();
  const ranges = parsePageRanges(input, State.totalPages);
  if (!ranges) return;

  showLoading('Splitting PDF…');
  try {
    const results = await splitPDF(State.pdfBytes, ranges);
    closeSplitModal();

    // Download each split file
    const baseName = State.fileName.replace('.pdf', '');
    for (const { bytes, label } of results) {
      downloadBlob(bytes, `${baseName}_${label}.pdf`);
    }
    toast(`Split into ${results.length} file${results.length > 1 ? 's' : ''}`, 'success');
  } catch (err) {
    console.error('Split failed:', err);
    toast('Split failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Status Bar ═══════════════════ */

function updateStatusBar() {
  const fname = State.fileName || 'No file loaded';
  DOM.statusFilename.textContent = fname;
  if (DOM.statusBarFilename) DOM.statusBarFilename.textContent = fname;

  // Pages · Size combined
  const parts = [];
  if (State.totalPages > 0) {
    parts.push(`${State.totalPages} page${State.totalPages !== 1 ? 's' : ''}`);
  }
  if (State.fileSize > 0) {
    parts.push(formatFileSize(State.fileSize));
  }
  DOM.statusPagesSize.textContent = parts.join(' · ');

  updateZoomDisplay();
}

/* ═══════════════════ Print ═══════════════════ */

async function handlePrint() {
  if (!State.pdfDoc) return;

  showLoading('Preparing to print…');
  try {
    // Save current page annotations before printing
    savePageAnnotations(State.currentPage);

    const totalPages = State.totalPages;
    const printScale = 1.5; // Higher resolution for print

    // Render each page to a data URL
    const pageImages = [];
    for (let p = 1; p <= totalPages; p++) {
      const page = await State.pdfDoc.getPage(p);
      const viewport = page.getViewport({ scale: printScale });

      // Render PDF page
      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      const ctx = pdfCanvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Overlay annotations if any exist for this page
      const annoJSON = getAnnotations()[p];
      if (annoJSON && annoJSON.objects && annoJSON.objects.length > 0) {
        const fabric = window.fabric;
        if (fabric) {
          const offscreen = document.createElement('canvas');
          offscreen.width = viewport.width;
          offscreen.height = viewport.height;
          const fCanvas = new fabric.StaticCanvas(offscreen, {
            width: viewport.width,
            height: viewport.height,
          });
          await new Promise(resolve => {
            fCanvas.loadFromJSON(annoJSON, () => {
              fCanvas.setZoom(printScale);
              fCanvas.renderAll();
              resolve();
            });
          });
          ctx.drawImage(offscreen, 0, 0);
        }
      }

      pageImages.push(pdfCanvas.toDataURL('image/png'));
    }

    // Build print document in a hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:0;height:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><title>Print — ' + (State.fileName || 'Document') + '</title>');
    doc.write('<style>@media print{@page{margin:0;}body{margin:0;}}');
    doc.write('body{margin:0;padding:0;}img{display:block;width:100%;height:auto;page-break-after:always;}');
    doc.write('img:last-child{page-break-after:avoid;}</style></head><body>');
    for (const src of pageImages) {
      doc.write('<img src="' + src + '"/>');
    }
    doc.write('</body></html>');
    doc.close();

    // Wait for images to load, then print
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        // Remove iframe after print dialog closes
        setTimeout(() => document.body.removeChild(iframe), 1000);
        hideLoading();
      }, 300);
    };
  } catch (err) {
    console.error('Print failed:', err);
    hideLoading();
    toast('Print failed: ' + err.message, 'error');
  }
}

/* ═══════════════════ Export ═══════════════════ */

async function handleExport() {
  if (!State.pdfBytes) return;
  showLoading('Exporting PDF…');
  try {
    // Write form field values into the source bytes before export
    let exportBytes = State.pdfBytes;
    if (State.pdfLibDoc && State.formFields.length > 0) {
      const wrote = writeFormValues(State.pdfLibDoc);
      if (wrote) {
        // Save the pdf-lib doc with form values baked in
        exportBytes = await State.pdfLibDoc.save();
      }
    }

    const result = await exportAnnotatedPDF({
      pdfBytes: exportBytes,
      currentPage: State.currentPage,
      totalPages: State.totalPages,
      fileName: State.fileName,
    });
    downloadBlob(
      new Blob([result.bytes], { type: 'application/pdf' }),
      result.fileName
    );
    toast(`Exported ${result.fileName}`, 'success');
  } catch (err) {
    console.error('Export failed:', err);
    toast('Export failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Watermark Modal ═══════════════════ */

function openWatermarkModal() {
  $('watermark-modal-backdrop').classList.remove('hidden');
}

function closeWatermarkModal() {
  $('watermark-modal-backdrop').classList.add('hidden');
}

async function executeWatermark() {
  if (!State.pdfBytes) return;

  const text = $('watermark-text').value.trim();
  if (!text) { toast('Enter watermark text', 'warning'); return; }

  showLoading('Applying watermark…');
  try {
    const newBytes = await addWatermark(State.pdfBytes, {
      text,
      fontSize: parseInt($('watermark-size').value) || 60,
      rotation: parseInt($('watermark-rotation').value) || -45,
      opacity: parseFloat($('watermark-opacity').value) || 0.15,
      color: $('watermark-color').value || '#888888',
      pages: $('watermark-pages').value || 'all',
      currentPage: State.currentPage,
    });

    closeWatermarkModal();
    await reloadAfterEdit(newBytes);
    toast('Watermark applied', 'success');
  } catch (err) {
    console.error('Watermark failed:', err);
    toast('Watermark failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Bates Numbering Modal ═══════════════════ */

function openBatesModal() {
  $('bates-modal-backdrop').classList.remove('hidden');
  updateBatesPreview();
  replaceIcons();
}

function closeBatesModal() {
  $('bates-modal-backdrop').classList.add('hidden');
}

function updateBatesPreview() {
  const label = previewBatesLabel({
    prefix: $('bates-prefix').value,
    suffix: $('bates-suffix').value,
    startNumber: parseInt($('bates-start').value) || 1,
    zeroPad: parseInt($('bates-pad').value) || 6,
  });
  $('bates-preview').textContent = label;
}

async function executeBates() {
  if (!State.pdfBytes) return;

  const pageRange = $('bates-page-range').value;
  let startPage = 1;
  let endPage = 0; // 0 = all

  if (pageRange === 'custom') {
    const rangeText = $('bates-range-input').value.trim();
    if (!rangeText) {
      toast('Enter a page range', 'warning');
      return;
    }
    // Parse custom range — use first and last page of the range
    try {
      const pages = parsePageRanges(rangeText, State.totalPages);
      if (pages.length === 0) {
        toast('Invalid page range', 'warning');
        return;
      }
      // pages are 0-based from parsePageRanges, convert to 1-based
      startPage = pages[0] + 1;
      endPage = pages[pages.length - 1] + 1;
    } catch (e) {
      toast('Invalid page range: ' + e.message, 'warning');
      return;
    }
  }

  showLoading('Applying Bates numbers…');
  try {
    const { bytes, firstLabel, lastLabel } = await applyBatesNumbers(State.pdfBytes, {
      prefix: $('bates-prefix').value,
      suffix: $('bates-suffix').value,
      startNumber: parseInt($('bates-start').value) || 1,
      zeroPad: parseInt($('bates-pad').value) || 6,
      position: $('bates-position').value,
      fontSize: parseInt($('bates-font-size').value) || 10,
      color: $('bates-color').value || '#000000',
      startPage,
      endPage,
    });

    closeBatesModal();
    await reloadAfterEdit(bytes);

    // Show Bates range in status bar
    const batesStatus = $('status-bates');
    if (batesStatus) {
      batesStatus.textContent = `Bates: ${firstLabel} – ${lastLabel}`;
      batesStatus.classList.remove('hidden');
    }

    toast(`Bates numbers applied (${firstLabel} – ${lastLabel})`, 'success');
  } catch (err) {
    console.error('Bates numbering failed:', err);
    toast('Bates numbering failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Headers & Footers Modal ═══════════════════ */

let lastFocusedHfZone = null; // track which zone input was last focused

function openHfModal() {
  $('hf-modal-backdrop').classList.remove('hidden');
  updateHfPreview();
  replaceIcons();
}

function closeHfModal() {
  $('hf-modal-backdrop').classList.add('hidden');
}

function updateHfPreview() {
  const fname = State.filename || 'document.pdf';
  const zones = {
    'hf-prev-tl': $('hf-top-left').value,
    'hf-prev-tc': $('hf-top-center').value,
    'hf-prev-tr': $('hf-top-right').value,
    'hf-prev-bl': $('hf-bottom-left').value,
    'hf-prev-bc': $('hf-bottom-center').value,
    'hf-prev-br': $('hf-bottom-right').value,
  };
  for (const [spanId, template] of Object.entries(zones)) {
    const text = previewHeaderText(template, fname);
    $(spanId).textContent = text || '—';
    $(spanId).style.color = text ? 'var(--mb-text)' : 'var(--mb-text-secondary)';
  }
}

function insertHfToken(token) {
  // Insert token at cursor position in the last-focused zone input
  const input = lastFocusedHfZone;
  if (!input) {
    // Default to bottom-center if no zone was focused
    const bc = $('hf-bottom-center');
    bc.value += token;
    bc.focus();
    updateHfPreview();
    return;
  }
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + token + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + token.length, start + token.length);
  updateHfPreview();
}

async function executeHeadersFooters() {
  if (!State.pdfBytes) return;

  const pageRange = $('hf-page-range').value;
  let startPage = 1;
  let endPage = 0;

  if (pageRange === 'custom') {
    const rangeText = $('hf-range-input').value.trim();
    if (!rangeText) {
      toast('Enter a page range', 'warning');
      return;
    }
    try {
      const pages = parsePageRanges(rangeText, State.totalPages);
      if (pages.length === 0) {
        toast('Invalid page range', 'warning');
        return;
      }
      startPage = pages[0] + 1;
      endPage = pages[pages.length - 1] + 1;
    } catch (e) {
      toast('Invalid page range: ' + e.message, 'warning');
      return;
    }
  }

  // Check at least one zone has content
  const zoneIds = ['hf-top-left', 'hf-top-center', 'hf-top-right',
                   'hf-bottom-left', 'hf-bottom-center', 'hf-bottom-right'];
  const hasContent = zoneIds.some(id => $(id).value.trim());
  if (!hasContent) {
    toast('Enter text in at least one zone', 'warning');
    return;
  }

  showLoading('Applying headers & footers…');
  try {
    const bytes = await applyHeadersFooters(State.pdfBytes, {
      topLeft: $('hf-top-left').value,
      topCenter: $('hf-top-center').value,
      topRight: $('hf-top-right').value,
      bottomLeft: $('hf-bottom-left').value,
      bottomCenter: $('hf-bottom-center').value,
      bottomRight: $('hf-bottom-right').value,
      fontSize: parseInt($('hf-font-size').value) || 10,
      color: $('hf-color').value || '#000000',
      filename: State.filename || 'document.pdf',
      startPage,
      endPage,
    });

    closeHfModal();
    await reloadAfterEdit(bytes);
    toast('Headers & footers applied', 'success');
  } catch (err) {
    console.error('Headers & footers failed:', err);
    toast('Headers & footers failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Visual Page Crop ═══════════════════ */

// Crop state
const cropState = {
  active: false,
  pageW: 0,       // page width in CSS px (at current zoom)
  pageH: 0,       // page height in CSS px
  pdfW: 0,        // page width in PDF points
  pdfH: 0,        // page height in PDF points
  // Selection rect in CSS px (relative to page-container)
  x: 0, y: 0, w: 0, h: 0,
};

async function openCropModal() {
  if (!State.pdfBytes || cropState.active) return;

  // Get effective page dimensions via PDF.js viewport (handles rotation & CropBox)
  const pdfPage = await State.pdfDoc.getPage(State.currentPage);
  const vp1 = pdfPage.getViewport({ scale: 1 });
  cropState.pdfW = vp1.width;
  cropState.pdfH = vp1.height;

  // Auto-collapse sidebar on tablet to avoid overlap
  cropState._sidebarWasOpen = State.sidebarOpen;
  if (window.innerWidth <= 768 && State.sidebarOpen) {
    toggleSidebar();
  }

  // Show overlay first so we can measure it
  $('crop-overlay').classList.remove('hidden');
  $('crop-bar').classList.remove('hidden');

  // Use overlay dimensions for coordinate system consistency
  const overlay = $('crop-overlay');
  cropState.pageW = overlay.offsetWidth;
  cropState.pageH = overlay.offsetHeight;

  // Default crop: inset 5% from each edge
  const inset = 0.05;
  cropState.x = Math.round(cropState.pageW * inset);
  cropState.y = Math.round(cropState.pageH * inset);
  cropState.w = Math.round(cropState.pageW * (1 - 2 * inset));
  cropState.h = Math.round(cropState.pageH * (1 - 2 * inset));
  cropState.active = true;

  updateCropOverlay();
  updateCropInfo();
}

function closeCropModal() {
  cropState.active = false;
  $('crop-overlay').classList.add('hidden');
  $('crop-bar').classList.add('hidden');
  $('crop-modal-backdrop').classList.add('hidden');

  // Restore sidebar if it was open before crop
  if (cropState._sidebarWasOpen && !State.sidebarOpen) {
    toggleSidebar();
  }
  cropState._sidebarWasOpen = false;
}

function updateCropOverlay() {
  const { x, y, w, h, pageW, pageH } = cropState;
  const sel = $('crop-overlay').querySelector('.crop-selection');

  // Position selection box
  sel.style.left = x + 'px';
  sel.style.top = y + 'px';
  sel.style.width = w + 'px';
  sel.style.height = h + 'px';

  // Position shade panels
  const shadeT = $('crop-overlay').querySelector('.crop-shade-top');
  const shadeB = $('crop-overlay').querySelector('.crop-shade-bottom');
  const shadeL = $('crop-overlay').querySelector('.crop-shade-left');
  const shadeR = $('crop-overlay').querySelector('.crop-shade-right');

  shadeT.style.height = y + 'px';

  shadeB.style.top = (y + h) + 'px';
  shadeB.style.height = (pageH - y - h) + 'px';

  shadeL.style.top = y + 'px';
  shadeL.style.width = x + 'px';
  shadeL.style.height = h + 'px';

  shadeR.style.top = y + 'px';
  shadeR.style.left = (x + w) + 'px';
  shadeR.style.width = (pageW - x - w) + 'px';
  shadeR.style.height = h + 'px';
}

function updateCropInfo() {
  const { x, y, w, h, pageW, pageH, pdfW, pdfH } = cropState;
  // Convert CSS px crop margins to PDF points
  const scaleX = pdfW / pageW;
  const scaleY = pdfH / pageH;
  const topPt = Math.round(y * scaleY);
  const leftPt = Math.round(x * scaleX);
  const bottomPt = Math.round((pageH - y - h) * scaleY);
  const rightPt = Math.round((pageW - x - w) * scaleX);

  $('crop-top').value = topPt;
  $('crop-bottom').value = bottomPt;
  $('crop-left').value = leftPt;
  $('crop-right').value = rightPt;

  const wIn = ((pdfW - leftPt - rightPt) / 72).toFixed(1);
  const hIn = ((pdfH - topPt - bottomPt) / 72).toFixed(1);
  $('crop-bar-info').textContent = `Crop: ${wIn}" × ${hIn}" — T:${topPt} B:${bottomPt} L:${leftPt} R:${rightPt} pt`;
}

function setCropFromPreset(topPt, bottomPt, leftPt, rightPt) {
  const { pageW, pageH, pdfW, pdfH } = cropState;
  const scaleX = pageW / pdfW;
  const scaleY = pageH / pdfH;

  cropState.x = Math.round(leftPt * scaleX);
  cropState.y = Math.round(topPt * scaleY);
  cropState.w = Math.round((pdfW - leftPt - rightPt) * scaleX);
  cropState.h = Math.round((pdfH - topPt - bottomPt) * scaleY);

  updateCropOverlay();
  updateCropInfo();
}

function initCropDragHandlers() {
  const overlay = $('crop-overlay');
  let dragMode = null; // 'move' | handle name
  let startMX = 0, startMY = 0;
  let startRect = {};

  function beginDrag(target, clientX, clientY) {
    if (!cropState.active) return false;
    const handle = target.closest('.crop-handle');
    if (handle) {
      dragMode = handle.dataset.handle;
    } else if (target.closest('.crop-selection')) {
      dragMode = 'move';
    } else {
      return false;
    }
    startMX = clientX;
    startMY = clientY;
    startRect = { x: cropState.x, y: cropState.y, w: cropState.w, h: cropState.h };
    return true;
  }

  function applyDrag(clientX, clientY) {
    if (!dragMode || !cropState.active) return;
    const dx = clientX - startMX;
    const dy = clientY - startMY;
    const { pageW, pageH } = cropState;
    const MIN = 20;

    let { x, y, w, h } = startRect;

    if (dragMode === 'move') {
      x = Math.max(0, Math.min(pageW - w, x + dx));
      y = Math.max(0, Math.min(pageH - h, y + dy));
    } else {
      // Handle resize
      if (dragMode.includes('w')) { x += dx; w -= dx; }
      if (dragMode.includes('e')) { w += dx; }
      if (dragMode.includes('n')) { y += dy; h -= dy; }
      if (dragMode.includes('s')) { h += dy; }

      // Enforce minimums and bounds
      if (w < MIN) { w = MIN; if (dragMode.includes('w')) x = startRect.x + startRect.w - MIN; }
      if (h < MIN) { h = MIN; if (dragMode.includes('n')) y = startRect.y + startRect.h - MIN; }
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      if (x + w > pageW) w = pageW - x;
      if (y + h > pageH) h = pageH - y;
    }

    cropState.x = x;
    cropState.y = y;
    cropState.w = w;
    cropState.h = h;
    updateCropOverlay();
    updateCropInfo();
  }

  function endDrag() {
    dragMode = null;
  }

  // Mouse events
  overlay.addEventListener('mousedown', e => {
    if (beginDrag(e.target, e.clientX, e.clientY)) e.preventDefault();
  });
  document.addEventListener('mousemove', e => applyDrag(e.clientX, e.clientY));
  document.addEventListener('mouseup', endDrag);

  // Touch events
  overlay.addEventListener('touchstart', e => {
    const t = e.touches[0];
    if (beginDrag(e.target, t.clientX, t.clientY)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!dragMode) return;
    const t = e.touches[0];
    applyDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', endDrag);
}

async function executeCrop() {
  if (!State.pdfBytes) return;

  const top = parseFloat($('crop-top').value) || 0;
  const bottom = parseFloat($('crop-bottom').value) || 0;
  const left = parseFloat($('crop-left').value) || 0;
  const right = parseFloat($('crop-right').value) || 0;

  if (top === 0 && bottom === 0 && left === 0 && right === 0) {
    toast('Adjust the crop area before applying', 'warning');
    return;
  }

  const scope = $('crop-scope').value;

  showLoading('Cropping pages…');
  try {
    const bytes = await cropPages(State.pdfBytes, {
      top, bottom, left, right,
      pages: scope,
      currentPage: State.currentPage,
    });

    closeCropModal();
    await reloadAfterEdit(bytes);
    const label = scope === 'all' ? 'all pages' : `page ${State.currentPage}`;
    toast(`Cropped ${label}`, 'success');
  } catch (err) {
    console.error('Crop failed:', err);
    toast('Crop failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Image Insertion ═══════════════════ */

function handleImageInsert() {
  $('image-file-input').click();
}

async function onImageFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset for reuse

  if (!file.type.startsWith('image/')) {
    toast('Please select an image file', 'warning');
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    await insertImage(dataUrl, file.name);
    toast(`Inserted ${file.name}`, 'success');
  } catch (err) {
    console.error('Image insert failed:', err);
    toast('Image insert failed: ' + err.message, 'error');
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ═══════════════════ Add Pages (Drag-Drop Inline Merge) ═══════════════════ */

/**
 * Append pages from dropped PDF files into the current document.
 * @param {File[]} files - PDF files to append
 * @param {number} [insertAfter] - 0-based page index to insert after (default: end)
 */
async function handleAddPages(files, insertAfter) {
  if (!State.pdfBytes || !files.length) return;
  showLoading('Adding pages…');
  try {
    const additions = [];
    let totalNewPages = 0;
    for (const file of files) {
      const name = file.name.toLowerCase();
      const isImage = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name) || file.type.startsWith('image/');
      let bytes;
      if (name.endsWith('.pdf')) {
        bytes = await readFileAsArrayBuffer(file);
      } else if (isImage) {
        bytes = await createPDFFromImages([file], { pageSize: 'fit' });
      } else {
        continue;
      }
      const donor = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      totalNewPages += donor.getPageCount();
      additions.push({ bytes });
    }
    if (additions.length === 0) {
      toast('No valid PDF or image files found', 'warning');
      return;
    }
    const newBytes = await appendPages(State.pdfBytes, additions, insertAfter);
    await reloadAfterEdit(newBytes);
    toast(`Added ${totalNewPages} page${totalNewPages !== 1 ? 's' : ''} from ${additions.length} file${additions.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) {
    console.error('Add pages failed:', err);
    toast('Failed to add pages: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Dark Mode ═══════════════════ */

function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('mudbrick-dark', isDark ? 'false' : 'true');
  $('btn-dark-mode').innerHTML = isDark ? icon('moon', 16) : icon('sun', 16);
}

/* ═══════════════════ Sidebar Toggle ═══════════════════ */

function toggleSidebar() {
  State.sidebarOpen = !State.sidebarOpen;
  DOM.sidebar.classList.toggle('collapsed', !State.sidebarOpen);
  $('btn-toggle-sidebar').innerHTML = State.sidebarOpen
    ? icon('panel-left-close', 16)
    : icon('panel-left-open', 16);
}

/* ═══════════════════ Properties Panel ═══════════════════ */

function togglePropertiesPanel(forceOpen) {
  const open = forceOpen !== undefined ? forceOpen : !State.panelOpen;
  State.panelOpen = open;
  DOM.propertiesPanel.classList.toggle('hidden', !open);
}

/** Update the Document Info section in the properties panel */
function updatePanelDocInfo() {
  const titleEl = $('prop-doc-title');
  const authorEl = $('prop-doc-author');
  const pagesEl = $('prop-doc-pages');
  const sizeEl = $('prop-doc-size');
  if (titleEl) titleEl.value = State.fileName.replace(/\.pdf$/i, '') || '—';
  if (authorEl) authorEl.value = '—'; // Will be populated from PDF metadata later
  if (pagesEl) pagesEl.value = State.totalPages || '—';
  if (sizeEl) sizeEl.value = State.fileSize ? formatFileSize(State.fileSize) : '—';
}

/** Update the tool properties section title based on active tool */
function updatePanelToolTitle() {
  const section = $('panel-tool-props');
  if (!section) return;
  const titleEl = section.querySelector('.panel-section-title');
  if (!titleEl) return;
  const toolNames = {
    select: 'Select Tool',
    hand: 'Hand Tool',
    text: 'Text Tool',
    highlight: 'Highlight Tool',
    draw: 'Draw Tool',
    stamp: 'Stamp Tool',
    shape: 'Shape Tool',
    cover: 'Cover Tool',
    redact: 'Redact Tool',
    image: 'Image Tool',
    watermark: 'Watermark Tool',
    'sticky-note': 'Sticky Note Tool',
    underline: 'Underline Tool',
    strikethrough: 'Strikethrough Tool',
  };
  titleEl.textContent = toolNames[State.activeTool] || 'Tool Options';
}

/* ═══════════════════ Sticky Notes — Panel & Sidebar ═══════════════════ */

function showNotePropsPanel(noteObj) {
  const panel = $('panel-note-props');
  const textarea = $('prop-note-text');
  if (!panel || !textarea) return;
  panel.classList.remove('hidden');
  textarea.value = noteObj?.noteText || '';
  // Highlight the matching color swatch
  const swatches = document.querySelectorAll('#note-color-swatches .color-swatch');
  swatches.forEach(s => s.classList.remove('active'));
  const colorName = noteObj?.noteColor || 'yellow';
  const match = document.querySelector(`[data-note-color="${colorName}"]`);
  if (match) match.classList.add('active');
}

function hideNotePropsPanel() {
  const panel = $('panel-note-props');
  if (panel) panel.classList.add('hidden');
}

function refreshNotesSidebar() {
  const panel = $('sidebar-notes');
  if (!panel) return;

  const notes = getAllStickyNotes();

  if (notes.length === 0) {
    panel.innerHTML = `
      <div class="sidebar-empty">
        <span data-icon="message-square" data-icon-size="24"></span>
        <p>No notes yet</p>
        <p class="sidebar-empty-hint">Add sticky notes to pages to see them here.</p>
      </div>`;
    replaceIcons();
    // Update badge
    const badge = document.querySelector('.sidebar-tab[data-sidebar="notes"] .sidebar-tab-label');
    if (badge) badge.dataset.count = '';
    return;
  }

  panel.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'notes-list';
  list.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:8px;';

  notes.forEach(note => {
    const item = document.createElement('button');
    item.className = 'note-list-item';
    item.style.cssText = `
      display:flex;align-items:flex-start;gap:8px;width:100%;
      text-align:left;padding:8px 10px;border-radius:var(--mb-radius-sm);
      border:1px solid var(--mb-border-light);background:var(--mb-surface-alt);
      cursor:pointer;font-size:12px;color:var(--mb-text);
    `;

    const colorMap = { yellow:'#fff9c4', green:'#c8e6c9', blue:'#bbdefb', pink:'#f8bbd0', orange:'#ffe0b2' };
    const bg = colorMap[note.noteColor] || '#fff9c4';

    item.innerHTML = `
      <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${bg};border:1px solid rgba(0,0,0,0.15);flex-shrink:0;margin-top:1px;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${note.noteText ? escapeHtml(note.noteText) : '<em style="color:var(--mb-text-muted)">Empty note</em>'}</span>
      <span style="color:var(--mb-text-muted);flex-shrink:0;">p.${note.pageNum}</span>
    `;

    item.addEventListener('click', () => {
      goToPage(note.pageNum);
    });

    list.appendChild(item);
  });

  panel.appendChild(list);

  // Update badge count
  const badge = document.querySelector('.sidebar-tab[data-sidebar="notes"] .sidebar-tab-label');
  if (badge) badge.dataset.count = notes.length;
}

/* ═══════════════════ Modal Focus Trapping ═══════════════════ */

let _focusTrapCleanup = null;
let _previousFocus = null;

function trapFocus(modalEl) {
  _previousFocus = document.activeElement;
  const focusable = modalEl.querySelectorAll(
    'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Focus the first element
  setTimeout(() => first.focus(), 50);

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  modalEl.addEventListener('keydown', onKeyDown);
  _focusTrapCleanup = () => {
    modalEl.removeEventListener('keydown', onKeyDown);
  };
}

function releaseFocus() {
  if (_focusTrapCleanup) {
    _focusTrapCleanup();
    _focusTrapCleanup = null;
  }
  if (_previousFocus && _previousFocus.focus) {
    _previousFocus.focus();
    _previousFocus = null;
  }
}

/* ═══════════════════ Offline Indicator ═══════════════════ */

function initOfflineIndicator() {
  const badge = $('status-offline');
  if (!badge) return;

  const update = () => {
    if (navigator.onLine) {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
    }
  };

  update();
  window.addEventListener('online', () => {
    update();
    toast('Back online', 'success', 2000);
  });
  window.addEventListener('offline', () => {
    update();
    toast('You are offline — your work is safe locally', 'warning', 4000);
  });
}

/* ═══════════════════ Unsaved Changes Indicator ═══════════════════ */

function updateUnsavedIndicator() {
  const dot = $('status-unsaved');
  if (!dot) return;
  const hasUnsaved = State.pdfBytes && hasAnnotations && hasAnnotations();
  dot.classList.toggle('hidden', !hasUnsaved);
}

function initModalFocusTrapping() {
  // Observe all modal backdrops for visibility changes
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    const observer = new MutationObserver(() => {
      if (!backdrop.classList.contains('hidden')) {
        const modal = backdrop.querySelector('.modal, .modal-panel');
        if (modal) trapFocus(modal);
      } else {
        releaseFocus();
      }
    });
    observer.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
  });
}

/* ═══════════════════ Title Bar Dropdown Menus ═══════════════════ */

let _activeDropdown = null;

function closeDropdown() {
  if (_activeDropdown) {
    _activeDropdown.remove();
    _activeDropdown = null;
  }
  document.querySelectorAll('.menu-item.active').forEach(el => el.classList.remove('active'));
}

function openDropdown(menuBtn, items) {
  closeDropdown();
  hideContextMenu();

  menuBtn.classList.add('active');
  const rect = menuBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';

  for (const item of items) {
    if (item === '---') {
      const sep = document.createElement('div');
      sep.className = 'dropdown-menu-separator';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    const needsDoc = item.needsDoc !== false;
    btn.disabled = needsDoc && !State.pdfBytes;
    btn.innerHTML = `${icon(item.icon, 14)}<span>${item.label}</span>${item.shortcut ? `<span class="shortcut-hint">${item.shortcut}</span>` : ''}`;
    btn.addEventListener('click', () => {
      closeDropdown();
      item.action();
    });
    menu.appendChild(btn);
  }

  menu.style.left = rect.left + 'px';
  menu.style.top = rect.bottom + 'px';
  document.body.appendChild(menu);

  // Keep menu within viewport
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
  }

  _activeDropdown = menu;

  // Close on click outside
  const onOutsideClick = (e) => {
    if (!menu.contains(e.target) && !e.target.closest('.menu-item')) {
      closeDropdown();
      document.removeEventListener('mousedown', onOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);

  // Close on Escape
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

function getMenuDefinitions() {
  return {
    'File': [
      { icon: 'folder-open', label: 'Open', shortcut: 'Ctrl+O', needsDoc: false, action: () => DOM.fileInput.click() },
      { icon: 'save', label: 'Export', shortcut: 'Ctrl+S', action: handleExport },
      { icon: 'printer', label: 'Print', shortcut: 'Ctrl+P', action: handlePrint },
      '---',
      { icon: 'download', label: 'Export as Image', action: () => $('btn-export-image').click() },
    ],
    'Edit': [
      { icon: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: handleUndo },
      { icon: 'redo', label: 'Redo', shortcut: 'Ctrl+Y', action: handleRedo },
      '---',
      { icon: 'search', label: 'Find', shortcut: 'Ctrl+F', action: openFindBar },
      { icon: 'trash', label: 'Delete Selection', shortcut: 'Del', action: deleteSelected },
    ],
    'View': [
      { icon: 'zoom-in', label: 'Zoom In', shortcut: '+', action: zoomIn },
      { icon: 'zoom-out', label: 'Zoom Out', shortcut: '−', action: zoomOut },
      { icon: 'columns', label: 'Fit Width', action: fitWidth },
      { icon: 'maximize', label: 'Fit Page', action: fitPage },
      '---',
      { icon: 'panel-left-open', label: 'Toggle Sidebar', action: toggleSidebar },
      { icon: 'moon', label: 'Toggle Dark Mode', needsDoc: false, action: toggleDarkMode },
    ],
    'Insert': [
      { icon: 'type', label: 'Text', shortcut: 'T', action: () => setTool('text') },
      { icon: 'image', label: 'Image', action: handleImageInsert },
      { icon: 'pen-tool', label: 'Signature', action: () => $('btn-signature').click() },
      { icon: 'stamp', label: 'Stamp', action: () => setTool('stamp') },
      { icon: 'droplet', label: 'Watermark', action: openWatermarkModal },
      '---',
      { icon: 'file-plus', label: 'Blank Page', action: () => $('btn-insert-blank').click() },
    ],
    'Tools': [
      { icon: 'link', label: 'Merge', action: openMergeModal },
      { icon: 'scissors', label: 'Split', action: openSplitModal },
      '---',
      { icon: 'file-scan', label: 'OCR', action: () => $('btn-ocr').click() },
      { icon: 'git-compare', label: 'Compare', action: () => $('btn-compare').click() },
      { icon: 'shrink', label: 'Optimize', action: () => $('btn-optimize').click() },
      '---',
      { icon: 'lock', label: 'Encrypt', action: () => $('btn-encrypt').click() },
      { icon: 'shield-off', label: 'Redact Search', action: () => $('btn-redact-search').click() },
      { icon: 'eye-off', label: 'Sanitize', action: () => $('btn-sanitize')?.click() },
    ],
    'Help': [
      { icon: 'info', label: 'Keyboard Shortcuts', shortcut: '?', needsDoc: false, action: openShortcutsModal },
      '---',
      { icon: 'zap', label: 'About Mudbrick', needsDoc: false, action: openAboutModal },
    ],
  };
}

function openShortcutsModal() {
  $('shortcuts-modal-backdrop').classList.remove('hidden');
}

function openAboutModal() {
  $('about-modal-backdrop').classList.remove('hidden');
}

function initDropdownMenus() {
  const defs = getMenuDefinitions();
  document.querySelectorAll('.menu-item').forEach(btn => {
    const label = btn.textContent.trim();
    const items = defs[label];
    if (!items) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_activeDropdown && btn.classList.contains('active')) {
        closeDropdown();
      } else {
        openDropdown(btn, items);
      }
    });
    // Open on hover when another menu is already open
    btn.addEventListener('mouseenter', () => {
      if (_activeDropdown) {
        openDropdown(btn, items);
      }
    });
  });
}

/* ═══════════════════ Event Wiring ═══════════════════ */

function wireEvents() {
  // File open
  $('open-file-btn').addEventListener('click', () => DOM.fileInput.click());
  $('btn-open').addEventListener('click', () => DOM.fileInput.click());
  DOM.fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFiles(Array.from(e.target.files));
    e.target.value = ''; // reset so same file can be reopened
  });

  // Draggable floating toolbar
  {
    const ftbar = $('floating-toolbar');
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    ftbar.addEventListener('mousedown', e => {
      // Don't drag if clicking a tool button
      if (e.target.closest('.float-btn')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = ftbar.getBoundingClientRect();
      const parentRect = ftbar.offsetParent.getBoundingClientRect();
      origLeft = rect.left - parentRect.left;
      origTop = rect.top - parentRect.top;
      ftbar.classList.add('is-dragging');
      // Remove centering transform on first drag
      ftbar.style.transform = 'none';
      ftbar.style.left = origLeft + 'px';
      ftbar.style.top = origTop + 'px';
      ftbar.style.bottom = 'auto';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      ftbar.style.left = (origLeft + dx) + 'px';
      ftbar.style.top = (origTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      ftbar.classList.remove('is-dragging');
    });
  }

  // Hand-tool panning (click-and-drag to scroll canvas-area)
  {
    let panning = false, panStartX = 0, panStartY = 0, scrollStartX = 0, scrollStartY = 0;

    DOM.canvasArea.addEventListener('mousedown', e => {
      if (State.activeTool !== 'hand') return;
      // Don't interfere with sidebar or toolbar clicks
      if (e.target.closest('#sidebar') || e.target.closest('#floating-toolbar')) return;
      panning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      scrollStartX = DOM.canvasArea.scrollLeft;
      scrollStartY = DOM.canvasArea.scrollTop;
      DOM.canvasArea.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!panning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      DOM.canvasArea.scrollLeft = scrollStartX - dx;
      DOM.canvasArea.scrollTop = scrollStartY - dy;
    });

    document.addEventListener('mouseup', () => {
      if (!panning) return;
      panning = false;
      DOM.canvasArea.style.cursor = '';
    });
  }

  // Undo / Redo
  DOM.btnUndo.addEventListener('click', handleUndo);
  DOM.btnRedo.addEventListener('click', handleRedo);

  // Edit Text
  DOM.btnEditText.addEventListener('click', handleEditText);

  // Edit Image
  if (DOM.btnEditImage) DOM.btnEditImage.addEventListener('click', handleEditImage);

  // Text/Image edit toolbar (event delegation on page container)
  DOM.pageContainer.addEventListener('click', e => {
    if (e.target.classList.contains('text-edit-commit')) {
      handleCommitTextEdits();
    } else if (e.target.classList.contains('text-edit-cancel')) {
      handleCancelTextEdits();
    } else if (e.target.classList.contains('image-edit-commit-btn')) {
      handleCommitImageEdits();
    } else if (e.target.classList.contains('image-edit-cancel-btn')) {
      handleCancelImageEdits();
    }
  });

  // Page navigation
  DOM.btnFirst.addEventListener('click', firstPage);
  DOM.btnPrev.addEventListener('click', prevPage);
  DOM.btnNext.addEventListener('click', nextPage);
  DOM.btnLast.addEventListener('click', lastPage);
  DOM.pageInput.addEventListener('change', () => {
    const val = parseInt(DOM.pageInput.value);
    if (!isNaN(val)) goToPage(val);
  });
  DOM.pageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseInt(DOM.pageInput.value);
      if (!isNaN(val)) goToPage(val);
      DOM.pageInput.blur();
    }
  });

  // Zoom (ribbon)
  $('btn-zoom-in').addEventListener('click', zoomIn);
  $('btn-zoom-out').addEventListener('click', zoomOut);
  $('btn-zoom-level').addEventListener('click', () => setZoom(1.0));
  $('btn-fit-width').addEventListener('click', fitWidth);
  $('btn-fit-page').addEventListener('click', fitPage);

  // Zoom (status bar)
  DOM.statusZoomIn.addEventListener('click', zoomIn);
  DOM.statusZoomOut.addEventListener('click', zoomOut);
  DOM.statusZoom.addEventListener('click', () => setZoom(1.0));

  // Ctrl+scroll zoom on canvas area
  DOM.canvasArea.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }
  }, { passive: false });

  // Merge modal
  $('btn-merge').addEventListener('click', openMergeModal);
  $('merge-drop-zone').addEventListener('click', () => $('merge-file-input').click());
  $('merge-file-input').addEventListener('change', e => {
    if (e.target.files.length) addMergeFiles(Array.from(e.target.files));
    e.target.value = '';
  });
  $('merge-drop-zone').addEventListener('dragover', e => e.preventDefault());
  $('merge-drop-zone').addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length) addMergeFiles(files);
  });
  $('btn-merge-execute').addEventListener('click', executeMerge);

  // Split modal
  $('btn-split').addEventListener('click', openSplitModal);
  $('split-range-input').addEventListener('input', updateSplitPreview);
  $('btn-split-execute').addEventListener('click', executeSplit);

  // Close modals
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.dataset.closeModal;
      if (modal === 'merge') closeMergeModal();
      if (modal === 'split') closeSplitModal();
      if (modal === 'watermark') closeWatermarkModal();
      if (modal === 'bates') closeBatesModal();
      if (modal === 'hf') closeHfModal();
      if (modal === 'crop') closeCropModal();
      if (modal === 'signature') closeSignatureModal();
      if (modal === 'ocr') $('ocr-modal-backdrop').classList.add('hidden');
      if (modal === 'encrypt') $('encrypt-modal-backdrop').classList.add('hidden');
      if (modal === 'metadata') $('metadata-modal-backdrop').classList.add('hidden');
      if (modal === 'redact-search') $('redact-search-modal-backdrop').classList.add('hidden');
      if (modal === 'export-image') $('export-image-modal-backdrop').classList.add('hidden');
      if (modal === 'create-from-images') $('create-from-images-modal-backdrop').classList.add('hidden');
      if (modal === 'optimize') $('optimize-modal-backdrop').classList.add('hidden');
      if (modal === 'compare') $('compare-modal-backdrop').classList.add('hidden');
      if (modal === 'comment-summary') $('comment-summary-modal-backdrop').classList.add('hidden');
      if (modal === 'form-data') $('form-data-modal-backdrop').classList.add('hidden');
      if (modal === 'exhibit') $('exhibit-modal-backdrop').classList.add('hidden');
      if (modal === 'sanitize') $('sanitize-modal-backdrop').classList.add('hidden');
      if (modal === 'shortcuts') $('shortcuts-modal-backdrop').classList.add('hidden');
      if (modal === 'about') $('about-modal-backdrop').classList.add('hidden');
      if (modal === 'page-labels') {
        $('page-labels-modal-backdrop').classList.add('hidden');
        // Restore previously saved ranges on cancel
        clearLabels();
        _savedLabelRanges.forEach(r => setLabelRange(r.startPage, r.endPage, r.format, r.prefix, r.startNum));
      }
      if (modal === 'replace-pages') $('replace-pages-modal-backdrop').classList.add('hidden');
    });
  });

  // Close modal on backdrop click (click on the overlay, not the dialog content)
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop') && !e.target.classList.contains('hidden')) {
      const closeBtn = e.target.querySelector('[data-close-modal]');
      if (closeBtn) closeBtn.click();
    }
  });

  // Annotation tool buttons (sync active state across all ribbon panels)
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      selectTool(btn.dataset.tool);
    });
  });

  // Floating toolbar tool buttons
  document.querySelectorAll('.float-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'image') {
        handleImageInsert();
      } else {
        selectTool(btn.dataset.tool);
      }
    });
  });

  // Sidebar tab switching
  document.querySelectorAll('.sidebar-tab[data-sidebar]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab[data-sidebar]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = $('sidebar-' + tab.dataset.sidebar);
      if (panel) panel.classList.add('active');
    });
  });

  // Sidebar toggle
  $('btn-toggle-sidebar').addEventListener('click', toggleSidebar);

  // Properties panel close
  $('btn-close-panel').addEventListener('click', () => togglePropertiesPanel(false));

  // Properties panel — color swatches
  document.querySelectorAll('#panel-tool-props .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('#panel-tool-props .color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      updateToolOptions({ color: swatch.dataset.color });
    });
  });

  // Properties panel — opacity slider
  const opacitySlider = $('prop-opacity');
  const opacityValue = $('prop-opacity-value');
  if (opacitySlider && opacityValue) {
    opacitySlider.addEventListener('input', () => {
      opacityValue.textContent = opacitySlider.value + '%';
      updateToolOptions({ opacity: parseInt(opacitySlider.value) / 100 });
    });
  }

  // Dark mode
  $('btn-dark-mode').addEventListener('click', toggleDarkMode);

  // Ribbon tab switching
  document.querySelectorAll('.ribbon-tab[data-ribbon]').forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all tabs and panels
      document.querySelectorAll('.ribbon-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ribbon-content').forEach(p => p.classList.remove('active'));
      // Activate clicked tab and its panel
      tab.classList.add('active');
      const panel = $('ribbon-' + tab.dataset.ribbon);
      if (panel) panel.classList.add('active');
    });
  });

  // Signature modal
  $('btn-signature').addEventListener('click', openSignatureModal);
  // Also wire sig-open-btn class (Annotate ribbon + floating toolbar duplicates)
  document.querySelectorAll('.sig-open-btn').forEach(btn => {
    btn.addEventListener('click', openSignatureModal);
  });

  // Watermark modal
  $('btn-watermark').addEventListener('click', openWatermarkModal);
  $('btn-watermark-execute').addEventListener('click', executeWatermark);
  $('watermark-opacity').addEventListener('input', () => {
    $('watermark-opacity-value').textContent = Math.round(parseFloat($('watermark-opacity').value) * 100) + '%';
  });

  // Bates Numbering modal
  $('btn-bates').addEventListener('click', openBatesModal);
  $('btn-bates-execute').addEventListener('click', executeBates);
  // Live preview update on any Bates input change
  ['bates-prefix', 'bates-suffix', 'bates-start', 'bates-pad'].forEach(id => {
    $(id).addEventListener('input', updateBatesPreview);
  });
  // Toggle custom range visibility
  $('bates-page-range').addEventListener('change', () => {
    const custom = $('bates-custom-range');
    if ($('bates-page-range').value === 'custom') {
      custom.classList.remove('hidden');
    } else {
      custom.classList.add('hidden');
    }
  });

  // Headers & Footers modal
  $('btn-headers-footers').addEventListener('click', openHfModal);
  $('btn-hf-execute').addEventListener('click', executeHeadersFooters);
  // Track last-focused zone input for token insertion
  document.querySelectorAll('.hf-zone').forEach(input => {
    input.addEventListener('focus', () => { lastFocusedHfZone = input; });
    input.addEventListener('input', updateHfPreview);
  });
  // Token buttons
  document.querySelectorAll('.hf-token-btn').forEach(btn => {
    btn.addEventListener('click', () => insertHfToken(btn.dataset.token));
  });
  // Toggle custom range
  $('hf-page-range').addEventListener('change', () => {
    const custom = $('hf-custom-range');
    if ($('hf-page-range').value === 'custom') {
      custom.classList.remove('hidden');
    } else {
      custom.classList.add('hidden');
    }
  });

  // Visual Crop
  $('btn-crop-page').addEventListener('click', openCropModal);
  $('btn-crop-execute').addEventListener('click', executeCrop);
  $('btn-crop-cancel').addEventListener('click', closeCropModal);
  initCropDragHandlers();
  // Preset buttons set crop from PDF-point values
  document.querySelectorAll('.crop-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!cropState.active) return;
      setCropFromPreset(
        parseFloat(btn.dataset.top),
        parseFloat(btn.dataset.bottom),
        parseFloat(btn.dataset.left),
        parseFloat(btn.dataset.right),
      );
    });
  });

  // OCR modal
  $('btn-ocr').addEventListener('click', () => {
    $('ocr-modal-backdrop').classList.remove('hidden');
    $('ocr-progress-area').classList.add('hidden');
    $('btn-ocr-run').disabled = false;
    // Default to current page
    const radios = document.querySelectorAll('input[name="ocr-scope"]');
    radios[0].checked = true;
  });

  $('btn-ocr-run').addEventListener('click', async () => {
    if (!State.pdfDoc) return;

    // Determine page numbers
    const scope = document.querySelector('input[name="ocr-scope"]:checked').value;
    let pageNumbers = [];

    if (scope === 'current') {
      pageNumbers = [State.currentPage];
    } else if (scope === 'all') {
      pageNumbers = Array.from({ length: State.totalPages }, (_, i) => i + 1);
    } else if (scope === 'range') {
      const rangeStr = $('ocr-range-input').value.trim();
      if (!rangeStr) {
        toast('Enter a page range', 'warning');
        return;
      }
      const parsed = parsePageRanges(rangeStr, State.totalPages);
      if (!parsed || !parsed.length) {
        toast('Invalid page range', 'error');
        return;
      }
      // Flatten array-of-arrays and convert from 0-based to 1-based
      pageNumbers = parsed.flat().map(p => p + 1);
    }

    // Show progress
    $('ocr-progress-area').classList.remove('hidden');
    $('btn-ocr-run').disabled = true;

    try {
      await runOCR(State.pdfDoc, pageNumbers, (info) => {
        $('ocr-progress-label').textContent = info.status;
        $('ocr-progress-pct').textContent = Math.round(info.progress) + '%';
        $('ocr-progress-bar').style.width = info.progress + '%';
      });

      // Augment find text index with OCR results
      const ocrEntries = getOCRTextEntries();
      if (ocrEntries.length > 0) {
        augmentTextIndex(ocrEntries);
      }

      // Update status bar
      const ocrBadge = $('status-ocr');
      if (ocrBadge) {
        ocrBadge.textContent = `OCR ✓ (${pageNumbers.length} pg${pageNumbers.length !== 1 ? 's' : ''})`;
        ocrBadge.classList.remove('hidden');
      }

      // Re-render current page to show OCR text layer
      await renderCurrentPage();

      toast(`OCR complete — ${pageNumbers.length} page${pageNumbers.length !== 1 ? 's' : ''} processed`, 'success');

      // Close modal
      $('ocr-modal-backdrop').classList.add('hidden');
    } catch (err) {
      toast('OCR failed: ' + err.message, 'error');
      console.error('OCR error:', err);
    } finally {
      $('btn-ocr-run').disabled = false;
    }
  });

  // Edit ribbon — Insert Blank Page
  $('btn-insert-blank').addEventListener('click', async () => {
    if (!State.pdfBytes) return;
    showLoading('Inserting page…');
    try {
      const newBytes = await insertBlankPage(State.pdfBytes, State.currentPage - 1);
      await reloadAfterEdit(newBytes);
      toast('Blank page inserted', 'success');
    } catch (err) {
      toast('Insert failed: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

  // Image insertion
  $('btn-insert-image').addEventListener('click', handleImageInsert);
  $('image-file-input').addEventListener('change', onImageFileSelected);

  // Annotate ribbon image button
  if ($('btn-anno-image')) $('btn-anno-image').addEventListener('click', handleImageInsert);

  // Sticky note — note text textarea
  const noteTextarea = $('prop-note-text');
  if (noteTextarea) {
    noteTextarea.addEventListener('input', () => {
      updateSelectedNoteText(noteTextarea.value);
      refreshNotesSidebar();
    });
  }

  // Sticky note — color swatches in props panel
  document.querySelectorAll('#note-color-swatches .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const canvas = getCanvas();
      if (!canvas) return;
      const obj = canvas.getActiveObject();
      if (!obj || obj.mudbrickType !== 'sticky-note') return;
      const colorName = swatch.dataset.noteColor;
      const colorMap = { yellow:'#fff9c4', green:'#c8e6c9', blue:'#bbdefb', pink:'#f8bbd0', orange:'#ffe0b2' };
      const fill = colorMap[colorName];
      if (!fill) return;
      // Update the rect background in the group
      if (obj._objects) {
        const rect = obj._objects.find(o => o.type === 'rect');
        if (rect) {
          rect.set('fill', fill);
        }
      }
      obj.noteColor = colorName;
      canvas.renderAll();
      savePageAnnotations(State.currentPage);
      // Update swatch active state
      document.querySelectorAll('#note-color-swatches .color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      refreshNotesSidebar();
    });
  });

  // Fabric canvas selection events — show/hide note props
  // We use a MutationObserver-style approach via periodic check, but
  // actually Fabric fires events we can hook after init.
  // Hook into canvas events after a short delay (canvas is ready after boot)
  setTimeout(() => {
    const canvas = getCanvas();
    if (!canvas) return;

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0];
      if (obj && obj.mudbrickType === 'sticky-note') {
        showNotePropsPanel(obj);
      } else {
        hideNotePropsPanel();
      }
    });

    canvas.on('selection:updated', (e) => {
      const obj = e.selected?.[0];
      if (obj && obj.mudbrickType === 'sticky-note') {
        showNotePropsPanel(obj);
      } else {
        hideNotePropsPanel();
      }
    });

    canvas.on('selection:cleared', () => {
      hideNotePropsPanel();
    });

    // Also refresh notes sidebar after any annotation modification
    canvas.on('object:modified', () => {
      refreshNotesSidebar();
      updateUnsavedIndicator();
    });

    canvas.on('object:added', () => {
      updateUnsavedIndicator();
    });

    canvas.on('object:removed', () => {
      refreshNotesSidebar();
      hideNotePropsPanel();
      updateUnsavedIndicator();
    });
  }, 500);

  // Export
  $('btn-export').addEventListener('click', handleExport);

  // Annotation context menu — right-click on Fabric canvas
  DOM.fabricWrapper.addEventListener('contextmenu', e => {
    // Only show annotation context menu when a PDF is loaded
    if (!State.pdfDoc) return;
    e.preventDefault();

    const canvas = getCanvas();
    if (!canvas) return;

    // Find the Fabric object under the pointer
    const target = canvas.getActiveObject() || canvas.findTarget(e);
    showAnnotationContextMenu(e, target);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);

  // Find bar events
  const findInput = $('find-input');
  if (findInput) {
    findInput.addEventListener('input', debounce(performSearch, 200));
    findInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) navigateMatch('prev');
        else navigateMatch('next');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    });
  }
  $('find-next')?.addEventListener('click', () => navigateMatch('next'));
  $('find-prev')?.addEventListener('click', () => navigateMatch('prev'));
  $('find-close')?.addEventListener('click', closeFindBar);
  $('find-case-sensitive')?.addEventListener('change', performSearch);

  // Window resize: debounced re-render
  window.addEventListener('resize', debounce(() => {
    if (State.pdfDoc) renderCurrentPage();
  }, 250));

  // Drag-and-drop on canvas area
  // If no PDF is loaded → open the file. If a PDF is already open → append pages.
  DOM.canvasArea.addEventListener('dragover', e => {
    e.preventDefault();
    DOM.canvasArea.classList.add('drag-over');
  });
  DOM.canvasArea.addEventListener('dragleave', () => {
    DOM.canvasArea.classList.remove('drag-over');
  });
  DOM.canvasArea.addEventListener('drop', e => {
    e.preventDefault();
    DOM.canvasArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith('.pdf') ||
      f.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f.name)
    );
    if (!files.length) return;
    if (State.pdfDoc) {
      // PDF already open — append pages to end
      handleAddPages(files);
    } else {
      handleFiles(files);
    }
  });

  // Drag-and-drop on sidebar thumbnail list — insert pages at drop position
  DOM.thumbnailList.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Highlight drop target between thumbnails
    const target = getDropTarget(e);
    clearDropIndicators();
    if (target.item) {
      target.item.classList.add(target.position === 'before' ? 'drop-before' : 'drop-after');
    }
  });
  DOM.thumbnailList.addEventListener('dragleave', e => {
    // Only clear if leaving the thumbnail list entirely
    if (!DOM.thumbnailList.contains(e.relatedTarget)) {
      clearDropIndicators();
    }
  });
  DOM.thumbnailList.addEventListener('drop', e => {
    e.preventDefault();
    clearDropIndicators();
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith('.pdf') ||
      f.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f.name)
    );
    if (!files.length || !State.pdfDoc) return;

    // Determine insertion point from drop position
    const target = getDropTarget(e);
    let insertAfter;
    if (target.item) {
      const pageNum = parseInt(target.item.dataset.page);
      insertAfter = target.position === 'before' ? pageNum - 2 : pageNum - 1;
      // Clamp: -1 means insert at very beginning (before page 1)
      if (insertAfter < -1) insertAfter = -1;
    }
    // insertAfter === undefined → append at end
    // insertAfter === -1 → insert before first page (index 0)
    if (insertAfter === -1) {
      // Special case: insert at the beginning
      handleAddPages(files, -1);
    } else {
      handleAddPages(files, insertAfter);
    }
  });

  /* ── Security ribbon ── */
  $('btn-encrypt').addEventListener('click', () => {
    $('encrypt-modal-backdrop').classList.remove('hidden');
  });
  $('btn-encrypt-execute').addEventListener('click', executeEncrypt);

  $('btn-metadata').addEventListener('click', openMetadataModal);
  $('btn-meta-save').addEventListener('click', executeMetadataSave);
  $('btn-meta-remove').addEventListener('click', executeMetadataRemove);

  $('btn-redact-search').addEventListener('click', () => {
    $('redact-results-list').innerHTML = '';
    $('redact-results').classList.add('hidden');
    $('btn-redact-apply').classList.add('hidden');
    $('redact-search-modal-backdrop').classList.remove('hidden');
  });
  $('btn-redact-search-execute').addEventListener('click', executeRedactSearch);
  $('btn-redact-apply').addEventListener('click', executeRedactApply);

  // Toggle custom pattern row when "Custom Pattern" checkbox changes
  document.querySelectorAll('.redact-pattern-cb').forEach(cb => {
    if (cb.value === 'custom') {
      cb.addEventListener('change', () => {
        $('redact-custom-row').classList.toggle('hidden', !cb.checked);
      });
    }
  });

  /* ── Tools ribbon ── */
  $('btn-export-image').addEventListener('click', () => {
    $('export-image-modal-backdrop').classList.remove('hidden');
  });
  $('btn-export-image-execute').addEventListener('click', executeExportImage);

  // Show/hide custom range row based on scope
  $('export-img-scope')?.addEventListener('change', (e) => {
    $('export-img-range-row').classList.toggle('hidden', e.target.value !== 'custom');
  });
  // Update quality % display
  $('export-img-quality')?.addEventListener('input', (e) => {
    const display = $('export-img-quality-val');
    if (display) display.textContent = e.target.value + '%';
  });

  $('btn-create-from-images').addEventListener('click', () => {
    $('create-from-images-modal-backdrop').classList.remove('hidden');
    _imagesToPdf = [];
    $('images-file-list').innerHTML = '<p style="color:var(--mb-text-secondary)">No images added yet.</p>';
  });
  $('btn-create-from-images-execute').addEventListener('click', executeCreateFromImages);

  // Images drop zone
  const imgDropZone = $('images-drop-zone');
  if (imgDropZone) {
    imgDropZone.addEventListener('dragover', e => { e.preventDefault(); imgDropZone.classList.add('drag-over'); });
    imgDropZone.addEventListener('dragleave', () => imgDropZone.classList.remove('drag-over'));
    imgDropZone.addEventListener('drop', e => {
      e.preventDefault();
      imgDropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      addImagesToList(files);
    });
    imgDropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
      input.addEventListener('change', () => addImagesToList(Array.from(input.files)));
      input.click();
    });
  }

  $('btn-optimize').addEventListener('click', () => {
    $('optimize-result').textContent = '';
    $('optimize-result').classList.add('hidden');
    $('optimize-modal-backdrop').classList.remove('hidden');
  });
  $('btn-optimize-execute').addEventListener('click', executeOptimize);
  $('optimize-quality')?.addEventListener('input', (e) => {
    const display = $('optimize-quality-val');
    if (display) display.textContent = e.target.value + '%';
  });
  // Show/hide custom options based on preset
  $('optimize-preset')?.addEventListener('change', (e) => {
    const customOpts = $('optimize-custom-opts');
    if (customOpts) customOpts.classList.toggle('hidden', e.target.value !== 'custom');
  });
  // Update hint text when mode changes
  $('optimize-mode')?.addEventListener('change', (e) => {
    const hint = $('optimize-mode-hint');
    if (hint) {
      const hints = {
        smart: 'Smart mode preserves text, links, and fonts on text-only pages. Only image-heavy pages are recompressed.',
        images: 'Images Only mode recompresses individual embedded images without rasterizing pages. All text, fonts, links, and vectors are preserved.',
        aggressive: 'Aggressive mode rasterizes all pages as JPEG. Text will become non-selectable.',
      };
      hint.textContent = hints[e.target.value] || hints.smart;
    }
    // Hide DPI for images-only mode (it doesn't use DPI)
    const dpiRow = $('optimize-custom-opts');
    const presetRow = $('optimize-preset')?.parentElement;
    if (e.target.value === 'images') {
      if (presetRow) presetRow.style.display = 'none';
      if (dpiRow) dpiRow.classList.add('hidden');
    } else {
      if (presetRow) presetRow.style.display = '';
    }
  });

  $('btn-compare').addEventListener('click', () => {
    $('compare-setup').classList.remove('hidden');
    $('compare-results').classList.add('hidden');
    $('compare-modal-backdrop').classList.remove('hidden');
    _compareDocB = null;
  });
  $('btn-compare-execute').addEventListener('click', executeCompare);
  $('btn-compare-report').addEventListener('click', downloadCompareReport);
  $('btn-compare-prev')?.addEventListener('click', () => navigateCompare(-1));
  $('btn-compare-next')?.addEventListener('click', () => navigateCompare(1));
  $('compare-view-mode')?.addEventListener('change', renderCurrentCompare);

  // Compare drop zone
  const cmpDropZone = $('compare-drop-zone');
  if (cmpDropZone) {
    cmpDropZone.addEventListener('dragover', e => { e.preventDefault(); cmpDropZone.classList.add('drag-over'); });
    cmpDropZone.addEventListener('dragleave', () => cmpDropZone.classList.remove('drag-over'));
    cmpDropZone.addEventListener('drop', e => {
      e.preventDefault();
      cmpDropZone.classList.remove('drag-over');
      const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.pdf'));
      if (file) loadCompareFile(file);
    });
    cmpDropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.pdf';
      input.addEventListener('change', () => { if (input.files[0]) loadCompareFile(input.files[0]); });
      input.click();
    });
  }

  $('btn-comment-summary').addEventListener('click', openCommentSummaryModal);
  $('btn-comment-download').addEventListener('click', downloadCommentSummary);
  $('btn-flatten-anno-exec').addEventListener('click', executeFlattenAnnotations);

  $('btn-flatten-annotations').addEventListener('click', executeFlattenAnnotations);

  /* ── Forms ribbon ── */
  $('btn-form-text').addEventListener('click', () => createFormFieldInteractive('text'));
  $('btn-form-checkbox').addEventListener('click', () => createFormFieldInteractive('checkbox'));
  $('btn-form-dropdown').addEventListener('click', () => createFormFieldInteractive('dropdown'));
  $('btn-form-radio').addEventListener('click', () => createFormFieldInteractive('radio'));
  $('btn-form-signature').addEventListener('click', () => createFormFieldInteractive('signature'));
  $('btn-form-button').addEventListener('click', () => createFormFieldInteractive('button'));

  $('btn-form-import').addEventListener('click', () => {
    $('form-import-pane').classList.remove('hidden');
    $('form-export-pane').classList.add('hidden');
    $('form-data-modal-backdrop').classList.remove('hidden');
  });
  $('btn-form-export').addEventListener('click', () => {
    $('form-import-pane').classList.add('hidden');
    $('form-export-pane').classList.remove('hidden');
    $('form-data-modal-backdrop').classList.remove('hidden');
  });
  $('btn-form-data-execute')?.addEventListener('click', () => {
    // Determine which pane is active
    const importPane = $('form-import-pane');
    if (importPane && !importPane.classList.contains('hidden')) {
      executeFormDataImport();
    } else {
      const fmt = $('form-export-format')?.value || 'json';
      executeFormDataExport(fmt);
    }
  });

  $('btn-form-tab-order').addEventListener('click', showTabOrder);
  $('btn-form-flatten').addEventListener('click', executeFormFlatten);

  /* ── Phase 3 Batch: Exhibit Stamps, Sanitize, Page Labels, Replace Pages ── */

  // Exhibit Stamp
  $('btn-exhibit-stamp').addEventListener('click', openExhibitModal);
  $('btn-exhibit-execute').addEventListener('click', executeExhibitPlace);
  $('exhibit-format')?.addEventListener('change', updateExhibitPreview);
  $('exhibit-prefix')?.addEventListener('input', updateExhibitPreview);

  // Sanitize Document
  $('btn-sanitize').addEventListener('click', openSanitizeModal);
  $('btn-sanitize-execute').addEventListener('click', executeSanitize);
  $('sanitize-confirm').addEventListener('change', () => {
    $('btn-sanitize-execute').disabled = !$('sanitize-confirm').checked;
  });

  // Page Labels
  $('btn-page-labels').addEventListener('click', openPageLabelsModal);
  $('btn-add-label-range').addEventListener('click', addLabelRangeRow);
  $('btn-page-labels-apply').addEventListener('click', executePageLabels);

  // Replace Pages
  $('btn-replace-pages').addEventListener('click', openReplacePagesModal);
  $('btn-replace-execute').addEventListener('click', executeReplacePages);
  $('replace-confirm').addEventListener('change', () => {
    $('btn-replace-execute').disabled = !$('replace-confirm').checked;
  });

  // Replace Pages — file picker
  const replaceDropZone = $('replace-source-drop');
  if (replaceDropZone) {
    replaceDropZone.addEventListener('dragover', e => { e.preventDefault(); replaceDropZone.classList.add('drag-over'); });
    replaceDropZone.addEventListener('dragleave', () => replaceDropZone.classList.remove('drag-over'));
    replaceDropZone.addEventListener('drop', e => {
      e.preventDefault();
      replaceDropZone.classList.remove('drag-over');
      const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.pdf'));
      if (file) loadReplaceSource(file);
    });
    replaceDropZone.addEventListener('click', () => {
      $('replace-file-input').click();
    });
    $('replace-file-input').addEventListener('change', () => {
      const f = $('replace-file-input').files[0];
      if (f) loadReplaceSource(f);
    });
  }

  // Form data drop zone
  const formDropZone = $('form-import-drop-zone');
  if (formDropZone) {
    formDropZone.addEventListener('dragover', e => { e.preventDefault(); formDropZone.classList.add('drag-over'); });
    formDropZone.addEventListener('dragleave', () => formDropZone.classList.remove('drag-over'));
    formDropZone.addEventListener('drop', e => {
      e.preventDefault();
      formDropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) { _formDataFile = file; formDropZone.querySelector('p').textContent = file.name; }
    });
    formDropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,.xfdf,.csv';
      input.addEventListener('change', () => {
        if (input.files[0]) { _formDataFile = input.files[0]; formDropZone.querySelector('p').textContent = input.files[0].name; }
      });
      input.click();
    });
  }
}

/* ═══════════════════ Sidebar Drop Helpers ═══════════════════ */

/** Find the thumbnail item closest to the drop point and whether to insert before/after it */
function getDropTarget(e) {
  const items = Array.from(DOM.thumbnailList.querySelectorAll('.thumbnail-item'));
  if (!items.length) return { item: null, position: 'after' };

  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      return { item, position: 'before' };
    }
  }
  // Below all items — insert after last
  return { item: items[items.length - 1], position: 'after' };
}

function clearDropIndicators() {
  DOM.thumbnailList.querySelectorAll('.drop-before, .drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

/* ═══════════════════ Phase 3 — Feature Handlers ═══════════════════ */

/* ── Module-level state for Phase 3 features ── */
let _imagesToPdf = [];       // images queued for Create PDF from Images
let _compareDocB = null;     // PDF.js doc for Compare (document B)
let _compareResults = null;  // comparison results object
let _comparePageIdx = 0;     // current page index in comparison view
let _redactMatches = [];     // redaction search results
let _formDataFile = null;    // file for form data import

/* ── Encrypt ── */
async function executeEncrypt() {
  if (!State.pdfBytes) return;
  const userPwd = $('encrypt-user-pw').value.trim();
  const ownerPwd = $('encrypt-owner-pw').value.trim();
  if (!userPwd && !ownerPwd) { toast('Enter at least one password', 'error'); return; }

  showLoading('Encrypting PDF…');
  try {
    const permissions = {
      printing: $('perm-print').checked,
      copying: $('perm-copy').checked,
      modifying: $('perm-modify').checked,
      annotating: $('perm-annotate').checked,
      fillingForms: $('perm-fill-forms').checked,
    };
    const newBytes = await encryptPDF(State.pdfBytes, { userPassword: userPwd, ownerPassword: ownerPwd, permissions });
    await reloadAfterEdit(newBytes);
    $('encrypt-modal-backdrop').classList.add('hidden');
    toast('PDF encrypted successfully', 'success');
  } catch (err) {
    toast('Encryption failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Metadata ── */
async function openMetadataModal() {
  if (!State.pdfBytes) return;
  try {
    const meta = await getMetadata(State.pdfBytes);
    $('meta-title').value = meta.title || '';
    $('meta-author').value = meta.author || '';
    $('meta-subject').value = meta.subject || '';
    $('meta-keywords').value = meta.keywords || '';
    $('meta-creator').value = meta.creator || '';
    $('meta-producer').value = meta.producer || '';
    $('meta-creation-date').value = meta.creationDate || '';
    $('meta-mod-date').value = meta.modificationDate || '';
    $('metadata-modal-backdrop').classList.remove('hidden');
  } catch (err) {
    toast('Failed to read metadata: ' + err.message, 'error');
  }
}

async function executeMetadataSave() {
  if (!State.pdfBytes) return;
  showLoading('Saving metadata…');
  try {
    const fields = {
      title: $('meta-title').value,
      author: $('meta-author').value,
      subject: $('meta-subject').value,
      keywords: $('meta-keywords').value,
    };
    const newBytes = await setMetadata(State.pdfBytes, fields);
    await reloadAfterEdit(newBytes);
    $('metadata-modal-backdrop').classList.add('hidden');
    toast('Metadata updated', 'success');
  } catch (err) {
    toast('Failed to save metadata: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

async function executeMetadataRemove() {
  if (!State.pdfBytes) return;
  if (!confirm('Remove all metadata from this document?')) return;
  showLoading('Removing metadata…');
  try {
    const newBytes = await removeMetadata(State.pdfBytes);
    await reloadAfterEdit(newBytes);
    $('metadata-modal-backdrop').classList.add('hidden');
    toast('Metadata removed', 'success');
  } catch (err) {
    toast('Failed to remove metadata: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Redaction Search ── */
async function executeRedactSearch() {
  if (!State.pdfDoc) return;
  const patternNames = [];
  document.querySelectorAll('.redact-pattern-cb:checked').forEach(cb => {
    if (cb.value) patternNames.push(cb.value);
  });
  const customInput = $('redact-custom-input');
  const customPattern = customInput ? customInput.value.trim() : '';
  if (patternNames.length === 0 && !customPattern) {
    toast('Select at least one pattern', 'error');
    return;
  }
  if (customPattern && !patternNames.includes('custom')) patternNames.push('custom');

  showLoading('Searching for redaction patterns…');
  try {
    _redactMatches = await searchPatterns(State.pdfDoc, patternNames, customPattern);
    const container = $('redact-results-list');
    $('redact-results').classList.remove('hidden');
    if (_redactMatches.length === 0) {
      container.innerHTML = '<p>No matches found.</p>';
      $('btn-redact-apply').classList.add('hidden');
    } else {
      container.innerHTML = _redactMatches.map((m, i) =>
        `<label class="redact-match-label">
          <input type="checkbox" checked data-redact-idx="${i}">
          <span class="redact-match-text"><strong>Page ${m.pageNum}</strong> — ${escapeHtml(m.text)} <em>(${m.pattern})</em></span>
        </label>`
      ).join('');
      $('btn-redact-apply').classList.remove('hidden');
    }
    toast(`Found ${_redactMatches.length} match(es)`, 'info');
  } catch (err) {
    toast('Search failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function executeRedactApply() {
  if (!_redactMatches.length) return;
  const canvas = getCanvas();
  if (!canvas) return;

  const checked = document.querySelectorAll('#redact-results-list input[type="checkbox"]:checked');
  let applied = 0;
  for (const cb of checked) {
    const idx = parseInt(cb.dataset.redactIdx);
    const match = _redactMatches[idx];
    if (!match) continue;
    // Create redaction rects on the matching page
    for (const rect of match.rects) {
      const rectProps = {
        type: 'rect',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        fill: '#000000',
        opacity: 1,
        selectable: true,
        mudbrickType: 'redact',
      };
      if (match.pageNum === State.currentPage) {
        canvas.add(new window.fabric.Rect(rectProps));
      } else {
        // Add directly to the page's annotation store
        addAnnotationToPage(match.pageNum, rectProps);
      }
      applied++;
    }
  }
  canvas.renderAll();
  savePageAnnotations(State.currentPage);
  $('redact-search-modal-backdrop').classList.add('hidden');
  toast(`Applied ${applied} redaction(s) — export PDF to make permanent`, 'success');
}

/* ── Export to Image ── */
async function executeExportImage() {
  if (!State.pdfDoc) return;
  const scopeEl = $('export-img-scope');
  const format = $('export-img-format')?.value || 'png';
  const dpi = parseInt($('export-img-dpi')?.value) || 150;
  const quality = parseFloat($('export-img-quality')?.value) || 0.92;

  let pages;
  const scope = scopeEl?.value || 'current';
  if (scope === 'current') {
    pages = [State.currentPage];
  } else if (scope === 'all') {
    pages = Array.from({ length: State.totalPages }, (_, i) => i + 1);
  } else {
    // Custom range
    const rangeInput = $('export-img-range');
    const parsed = rangeInput ? parsePageRanges(rangeInput.value, State.totalPages) : null;
    pages = parsed ? parsed.flat().map(p => p + 1) : [State.currentPage];
  }

  showLoading('Exporting images…');
  try {
    await exportPagesToImages(State.pdfDoc, pages, {
      format, dpi, quality, fileName: State.fileName,
    }, (done, total) => {
      $('loading-text').textContent = `Exporting page ${done}/${total}...`;
    });
    $('export-image-modal-backdrop').classList.add('hidden');
    toast(`Exported ${pages.length} page(s) as ${format.toUpperCase()}`, 'success');
  } catch (err) {
    toast('Export failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Create PDF from Images ── */
function addImagesToList(files) {
  _imagesToPdf.push(...files);
  const list = $('images-file-list');
  list.innerHTML = _imagesToPdf.map((f, i) =>
    `<div class="image-file-row">
      <span class="image-file-name">${escapeHtml(f.name)} (${formatFileSize(f.size)})</span>
      <button onclick="this.parentElement.remove(); window._removeImageFromPdf(${i})" class="image-file-remove">&times;</button>
    </div>`
  ).join('');
}
window._removeImageFromPdf = (idx) => { _imagesToPdf.splice(idx, 1); };

async function executeCreateFromImages() {
  if (_imagesToPdf.length === 0) { toast('Add at least one image', 'error'); return; }
  const pageSize = $('images-page-size')?.value || 'fit';
  const margin = parseInt($('images-margin')?.value) || 0;

  showLoading('Creating PDF from images…');
  try {
    const pdfBytes = await createPDFFromImages(_imagesToPdf, { pageSize, margin }, (done, total) => {
      $('loading-text').textContent = `Processing image ${done}/${total}...`;
    });
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    downloadBlob(blob, 'images_combined.pdf');
    $('create-from-images-modal-backdrop').classList.add('hidden');
    toast('PDF created from images', 'success');
  } catch (err) {
    toast('Failed to create PDF: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Optimize PDF ── */
async function executeOptimize() {
  if (!State.pdfDoc || !State.pdfBytes) return;

  const mode = $('optimize-mode')?.value || 'smart';
  const preset = $('optimize-preset')?.value || 'ebook';

  // For custom preset, read DPI and quality from the controls
  const dpi = preset === 'custom' ? (parseInt($('optimize-dpi')?.value) || 150) : undefined;
  const quality = preset === 'custom' ? ((parseFloat($('optimize-quality')?.value) || 75) / 100) : undefined;

  showLoading('Analyzing pages…');
  try {
    const originalSize = State.pdfBytes.length;
    const opts = { mode };
    if (preset === 'custom') {
      opts.dpi = dpi;
      opts.quality = quality;
    } else {
      opts.preset = preset;
    }

    const newBytes = await optimizePDF(State.pdfDoc, State.pdfBytes, opts, (done, total, label) => {
      if (label === 'recompressing images') {
        $('loading-text').textContent = `Recompressing image ${done}/${total}…`;
      } else {
        $('loading-text').textContent = `${label === 'compressing' ? 'Compressing' : 'Copying'} page ${done}/${total}…`;
      }
    });

    const saved = originalSize - newBytes.length;
    const pct = ((saved / originalSize) * 100).toFixed(1);
    const stats = newBytes._optimizeStats || {};
    let resultText = `Original: ${formatFileSize(originalSize)} → Optimized: ${formatFileSize(newBytes.length)} (${pct}% ${saved > 0 ? 'smaller' : 'larger'})`;
    if (mode === 'smart' && stats.preserved > 0) {
      resultText += `\n${stats.preserved} text page${stats.preserved > 1 ? 's' : ''} preserved, ${stats.rasterized} image page${stats.rasterized > 1 ? 's' : ''} compressed`;
    }
    if (mode === 'images' && stats.imagesFound > 0) {
      resultText += `\n${stats.imagesRecompressed}/${stats.imagesFound} images recompressed. All text and vectors preserved.`;
    }

    const resultEl = $('optimize-result');
    resultEl.textContent = resultText;
    resultEl.classList.remove('hidden');

    await reloadAfterEdit(newBytes);
    toast(`Optimized — saved ${formatFileSize(Math.max(0, saved))} (${pct}%)`, saved > 0 ? 'success' : 'info');
  } catch (err) {
    toast('Optimization failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Document Compare ── */
async function loadCompareFile(file) {
  try {
    const buf = await readFileAsArrayBuffer(file);
    const bytes = new Uint8Array(buf);
    const pdfjsLib = window.pdfjsLib;
    _compareDocB = await pdfjsLib.getDocument({ data: bytes }).promise;
    const dropZone = $('compare-drop-zone');
    if (dropZone) dropZone.querySelector('p').textContent = `${file.name} (${_compareDocB.numPages} pages)`;
    const execBtn = $('btn-compare-execute');
    if (execBtn) execBtn.disabled = false;
    toast(`Loaded ${file.name} for comparison`, 'info');
  } catch (err) {
    toast('Failed to load comparison file: ' + err.message, 'error');
  }
}

async function executeCompare() {
  if (!State.pdfDoc || !_compareDocB) { toast('Load a second PDF to compare', 'error'); return; }
  const dpi = parseInt($('compare-dpi')?.value) || 96;
  const threshold = parseInt($('compare-threshold')?.value) || 30;

  showLoading('Comparing documents…');
  try {
    _compareResults = await compareDocuments(State.pdfDoc, _compareDocB, { dpi, threshold }, (page, total) => {
      $('loading-text').textContent = `Comparing page ${page}/${total}...`;
      const bar = $('compare-progress-bar');
      if (bar) bar.style.width = Math.round(page / total * 100) + '%';
    });
    _comparePageIdx = 0;
    $('compare-setup').classList.add('hidden');
    $('compare-results').classList.remove('hidden');
    $('compare-report').textContent = generateCompareReport(_compareResults);
    renderCurrentCompare();
    toast(`Comparison complete — ${_compareResults.overallDiffPercentage.toFixed(1)}% different`, 'info');
  } catch (err) {
    toast('Comparison failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderCurrentCompare() {
  if (!_compareResults || !_compareResults.pages.length) return;
  const page = _compareResults.pages[_comparePageIdx];
  const view = $('compare-view-mode')?.value || 'side-by-side';
  const container = $('compare-view');
  if (container) renderComparisonView(container, page, { view });
  $('compare-page-info').textContent = `Page ${page.pageNum} of ${_compareResults.maxPages} (${page.diffPercentage.toFixed(2)}% diff)`;
  // Update prev/next button states
  const prevBtn = $('btn-compare-prev');
  const nextBtn = $('btn-compare-next');
  if (prevBtn) prevBtn.disabled = _comparePageIdx <= 0;
  if (nextBtn) nextBtn.disabled = _comparePageIdx >= _compareResults.pages.length - 1;
}

function navigateCompare(dir) {
  if (!_compareResults) return;
  _comparePageIdx = Math.max(0, Math.min(_compareResults.pages.length - 1, _comparePageIdx + dir));
  renderCurrentCompare();
}

function downloadCompareReport() {
  if (!_compareResults) return;
  const text = generateCompareReport(_compareResults);
  const blob = new Blob([text], { type: 'text/plain' });
  downloadBlob(blob, 'comparison_report.txt');
}

/* ── Comment Summary & Flatten Annotations ── */
function openCommentSummaryModal() {
  if (!State.pdfDoc) return;
  const stats = getAnnotationStats(State.currentPage);
  $('comment-stat-total').textContent = stats.total;
  $('comment-stat-pages').textContent = stats.pages;
  $('comment-stat-types').textContent = Object.keys(stats.byType).length;

  // Preview
  const text = exportCommentsText(State.currentPage);
  $('comment-summary-preview').textContent = text;
  $('comment-summary-modal-backdrop').classList.remove('hidden');
}

function downloadCommentSummary() {
  const format = $('comment-export-format')?.value || 'text';
  let content, mime, ext;
  if (format === 'json') {
    content = exportCommentsJSON(State.currentPage);
    mime = 'application/json'; ext = 'json';
  } else if (format === 'csv') {
    content = exportCommentsCSV(State.currentPage);
    mime = 'text/csv'; ext = 'csv';
  } else {
    content = exportCommentsText(State.currentPage);
    mime = 'text/plain'; ext = 'txt';
  }
  const blob = new Blob([content], { type: mime });
  const baseName = (State.fileName || 'document').replace(/\.pdf$/i, '');
  downloadBlob(blob, `${baseName}_annotations.${ext}`);
  toast('Annotation summary downloaded', 'success');
}

async function executeFlattenAnnotations() {
  if (!State.pdfBytes) return;
  if (!confirm('Flatten all annotations into the PDF permanently? This cannot be undone.')) return;
  showLoading('Flattening annotations…');
  try {
    const result = await flattenAnnotations({
      pdfBytes: State.pdfBytes,
      currentPage: State.currentPage,
      totalPages: State.totalPages,
      fileName: State.fileName,
    });
    // Clear annotation data
    State.pageAnnotations = {};
    await reloadAfterEdit(result.bytes);
    $('comment-summary-modal-backdrop').classList.add('hidden');
    toast('Annotations flattened into PDF', 'success');
  } catch (err) {
    toast('Flatten failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Form Creator ── */
async function createFormFieldInteractive(fieldType) {
  if (!State.pdfLibDoc) { toast('Open a PDF first', 'error'); return; }
  const pageIndex = State.currentPage - 1;
  const name = `${fieldType}_${Date.now()}`;

  // Place in center of visible area
  const page = State.pdfLibDoc.getPage(pageIndex);
  const { width: pw, height: ph } = page.getSize();

  try {
    addFormField(State.pdfLibDoc, {
      type: fieldType, name, pageIndex,
      x: pw / 2 - 50, y: ph / 2 - 12,
    });
    const newBytes = await State.pdfLibDoc.save();
    await reloadAfterEdit(newBytes);
    toast(`Added ${fieldType} field "${name}"`, 'success');
  } catch (err) {
    toast('Failed to add field: ' + err.message, 'error');
  }
}

async function showTabOrder() {
  if (!State.pdfLibDoc) return;
  const order = getTabOrder(State.pdfLibDoc, State.currentPage - 1);
  if (order.length === 0) { toast('No form fields on this page', 'info'); return; }
  toast(`Tab order (${order.length} fields): ${order.join(' → ')}`, 'info');
}

async function executeFormFlatten() {
  if (!State.pdfLibDoc) return;
  if (!confirm('Flatten all form fields? They will become non-editable.')) return;
  showLoading('Flattening form fields…');
  try {
    const newBytes = await flattenFormFields(State.pdfLibDoc);
    await reloadAfterEdit(newBytes);
    toast('Form fields flattened', 'success');
  } catch (err) {
    toast('Flatten failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Form Data Import/Export ── */
async function executeFormDataImport() {
  if (!State.pdfLibDoc || !_formDataFile) { toast('Select a file to import', 'error'); return; }
  showLoading('Importing form data…');
  try {
    const text = await _formDataFile.text();
    const ext = _formDataFile.name.split('.').pop().toLowerCase();
    let filled = 0;
    if (ext === 'json') {
      filled = importFormDataJSON(State.pdfLibDoc, JSON.parse(text));
    } else if (ext === 'xfdf' || ext === 'xml') {
      filled = importFormDataXFDF(State.pdfLibDoc, text);
    } else if (ext === 'csv') {
      filled = importFormDataCSV(State.pdfLibDoc, text);
    }
    const newBytes = await State.pdfLibDoc.save();
    await reloadAfterEdit(newBytes);
    $('form-data-modal-backdrop').classList.add('hidden');
    toast(`Imported ${filled} field value(s)`, 'success');
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function executeFormDataExport(format) {
  if (!State.pdfLibDoc) return;
  let content, mime, ext;
  if (format === 'json') {
    content = JSON.stringify(exportFormDataJSON(State.pdfLibDoc), null, 2);
    mime = 'application/json'; ext = 'json';
  } else if (format === 'xfdf') {
    content = exportFormDataXFDF(State.pdfLibDoc, State.fileName);
    mime = 'application/xml'; ext = 'xfdf';
  } else {
    content = exportFormDataCSV(State.pdfLibDoc);
    mime = 'text/csv'; ext = 'csv';
  }
  const blob = new Blob([content], { type: mime });
  const baseName = (State.fileName || 'document').replace(/\.pdf$/i, '');
  downloadBlob(blob, `${baseName}_formdata.${ext}`);
  toast('Form data exported', 'success');
}

/* ── Helpers ── */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═══════════════════ Phase 3 Batch — Feature Handlers ═══════════════════ */

/* ── Exhibit Stamps ── */
let _exhibitPlaceMode = false;

function openExhibitModal() {
  if (!State.pdfDoc) return;
  updateExhibitPreview();
  $('exhibit-modal-backdrop').classList.remove('hidden');
}

function updateExhibitPreview() {
  const format = $('exhibit-format').value;
  const prefix = $('exhibit-prefix').value;
  const existing = countExistingExhibits(getAnnotations() || {});
  const nextNum = existing + 1;
  const fmt = EXHIBIT_FORMATS[format] || EXHIBIT_FORMATS.letter;
  $('exhibit-preview').textContent = 'EXHIBIT ' + prefix + fmt.fn(nextNum);
}

function executeExhibitPlace() {
  const format = $('exhibit-format').value;
  const prefix = $('exhibit-prefix').value;
  const includeDate = $('exhibit-include-date').checked;
  setExhibitOptions(format, prefix, includeDate);
  $('exhibit-modal-backdrop').classList.add('hidden');

  // Enter click-to-place mode
  _exhibitPlaceMode = true;
  toast('Click on the page to place exhibit stamp', 'info');
  DOM.canvasArea.style.cursor = 'crosshair';

  // One-time click handler on the canvas area
  const onPlace = (e) => {
    if (!_exhibitPlaceMode) return;
    _exhibitPlaceMode = false;
    DOM.canvasArea.style.cursor = '';

    const canvas = getCanvas();
    if (!canvas) return;

    // Calculate position relative to the Fabric canvas
    const canvasEl = canvas.getElement();
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const stamp = addExhibitStamp(canvas, x, y, State.zoom);
    if (stamp) {
      savePageAnnotations(State.currentPage);
      toast(`Exhibit stamp placed`, 'success');
    }
  };

  // Listen for next click on the canvas overlay (Fabric canvas)
  setTimeout(() => {
    const canvasEl = getCanvas()?.getElement();
    if (canvasEl) {
      canvasEl.addEventListener('click', onPlace, { once: true });
    }
  }, 100);
}

/* ── Document Sanitization ── */
function openSanitizeModal() {
  if (!State.pdfDoc) return;
  $('sanitize-confirm').checked = false;
  $('btn-sanitize-execute').disabled = true;
  $('sanitize-modal-backdrop').classList.remove('hidden');
}

async function executeSanitize() {
  if (!State.pdfBytes) return;
  showLoading('Sanitizing document…');
  try {
    const result = await sanitizeDocument(State.pdfBytes);
    await reloadAfterEdit(result.bytes);
    $('sanitize-modal-backdrop').classList.add('hidden');

    const rpt = result.report || {};
    const msg = rpt.metadataRemoved
      ? 'Document sanitized — metadata stripped'
      : 'Document sanitized (no metadata found)';
    toast(msg, 'success');
  } catch (err) {
    toast('Sanitization failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── Page Labels ── */
let _labelRangeRows = 0;
let _savedLabelRanges = []; // snapshot for cancel restore

function openPageLabelsModal() {
  if (!State.pdfDoc) return;

  // Snapshot current ranges so we can restore on cancel
  _savedLabelRanges = getLabelRanges();

  // Populate with existing ranges or one empty row
  const existing = getLabelRanges();
  const list = $('page-labels-list');
  list.innerHTML = '';
  _labelRangeRows = 0;

  if (existing.length > 0) {
    existing.forEach(r => addLabelRangeRow(null, r));
  } else {
    addLabelRangeRow();
  }

  updateLabelsPreview();
  $('page-labels-modal-backdrop').classList.remove('hidden');
}

function addLabelRangeRow(evt, prefill) {
  const list = $('page-labels-list');
  const idx = _labelRangeRows++;

  const startVal = prefill ? prefill.startPage : 1;
  const endVal = prefill ? prefill.endPage : State.totalPages;
  const fmtVal = prefill ? prefill.format : 'decimal';
  const prefixVal = prefill ? prefill.prefix : '';
  const startNumVal = prefill ? prefill.startNum : 1;

  const fmtOptions = LABEL_FORMATS.map(f =>
    `<option value="${f}" ${f === fmtVal ? 'selected' : ''}>${f}</option>`
  ).join('');

  const row = document.createElement('div');
  row.className = 'label-range-row';
  row.dataset.rangeIdx = idx;
  row.innerHTML = `
    <label style="min-width:40px;">Pages</label>
    <input type="number" class="label-start label-range-input" value="${startVal}" min="1" max="${State.totalPages}">
    <span>–</span>
    <input type="number" class="label-end label-range-input" value="${endVal}" min="1" max="${State.totalPages}">
    <select class="label-format label-range-select">${fmtOptions}</select>
    <input type="text" class="label-prefix label-range-prefix" value="${escapeHtml(prefixVal)}" placeholder="Prefix">
    <label class="label-range-startlabel">Start#</label>
    <input type="number" class="label-startnum label-range-startnum" value="${startNumVal}" min="1">
    <button class="btn-remove-range label-range-remove" title="Remove">&times;</button>
  `;

  row.querySelector('.btn-remove-range').addEventListener('click', () => {
    row.remove();
    updateLabelsPreview();
  });

  row.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', updateLabelsPreview);
    el.addEventListener('change', updateLabelsPreview);
  });

  list.appendChild(row);
  updateLabelsPreview();
}

function updateLabelsPreview() {
  // Temporarily apply ranges from the modal to generate preview
  clearLabels();
  const rows = $('page-labels-list').querySelectorAll('.label-range-row');
  rows.forEach(row => {
    const start = parseInt(row.querySelector('.label-start').value) || 1;
    const end = parseInt(row.querySelector('.label-end').value) || State.totalPages;
    const format = row.querySelector('.label-format').value;
    const prefix = row.querySelector('.label-prefix').value;
    const startNum = parseInt(row.querySelector('.label-startnum').value) || 1;
    setLabelRange(start, end, format, prefix, startNum);
  });

  const preview = previewLabels(Math.min(State.totalPages, 20));
  const container = $('page-labels-preview');
  container.innerHTML = preview.map(p =>
    `<span class="label-preview-tag">
      <strong>${p.page}</strong>→${escapeHtml(p.label)}
    </span>`
  ).join('');

  if (State.totalPages > 20) {
    container.innerHTML += `<span class="label-preview-more">...and ${State.totalPages - 20} more</span>`;
  }
}

function executePageLabels() {
  // Ranges are already applied from live preview — just persist and refresh
  generateThumbnails();
  updatePageNav();
  $('page-labels-modal-backdrop').classList.add('hidden');
  toast('Page labels updated', 'success');
}

/* ── Replace Pages ── */
let _replaceSourceBytes = null;
let _replaceSourcePageCount = 0;

function openReplacePagesModal() {
  if (!State.pdfDoc) return;
  _replaceSourceBytes = null;
  _replaceSourcePageCount = 0;
  $('replace-source-name').textContent = '';
  $('replace-source-pages').textContent = '';
  $('replace-mapping').classList.add('hidden');
  $('replace-mappings-list').innerHTML = '';
  $('replace-confirm').checked = false;
  $('btn-replace-execute').disabled = true;
  $('replace-pages-modal-backdrop').classList.remove('hidden');
}

async function loadReplaceSource(file) {
  try {
    const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
    // Validate it's a valid PDF by loading with pdf-lib
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    _replaceSourceBytes = bytes;
    _replaceSourcePageCount = doc.getPageCount();
    $('replace-source-name').textContent = file.name;
    $('replace-source-pages').textContent = _replaceSourcePageCount;
    $('replace-mapping').classList.remove('hidden');
    buildReplaceMappingTable();
  } catch (err) {
    toast('Invalid PDF: ' + err.message, 'error');
  }
}

function buildReplaceMappingTable() {
  const tbody = $('replace-mappings-list');
  tbody.innerHTML = '';

  const sourceOpts = ['<option value="">— skip —</option>'];
  for (let s = 1; s <= _replaceSourcePageCount; s++) {
    sourceOpts.push(`<option value="${s}">Source page ${s}</option>`);
  }
  const optsHtml = sourceOpts.join('');

  for (let p = 1; p <= State.totalPages; p++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Page ${p}</td>
      <td><select class="replace-source-page" data-target="${p}">${optsHtml}</select></td>
    `;
    tbody.appendChild(tr);
  }
}

async function executeReplacePages() {
  if (!State.pdfBytes || !_replaceSourceBytes) return;

  // Collect mappings
  const selects = $('replace-mappings-list').querySelectorAll('.replace-source-page');
  const mappings = [];
  selects.forEach(sel => {
    const sourcePage = parseInt(sel.value);
    if (sourcePage) {
      mappings.push({ targetPage: parseInt(sel.dataset.target), sourcePage });
    }
  });

  if (mappings.length === 0) {
    toast('No page replacements selected', 'warning');
    return;
  }

  showLoading('Replacing pages…');
  try {
    const newBytes = await replacePages(State.pdfBytes, _replaceSourceBytes, mappings);
    await reloadAfterEdit(newBytes);
    $('replace-pages-modal-backdrop').classList.add('hidden');
    toast(`Replaced ${mappings.length} page${mappings.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) {
    toast('Replace failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ═══════════════════ Keyboard Shortcuts ═══════════════════ */

function handleKeyboard(e) {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+F — open find bar (intercept before input check so it works globally)
  if (mod && e.key === 'f' && State.pdfDoc) {
    e.preventDefault();
    openFindBar();
    return;
  }

  // Don't intercept when typing in inputs, selects, or Fabric IText editing
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.target.contentEditable === 'true') return;

  // ? key — show keyboard shortcuts (works without a PDF loaded)
  if (e.key === '?' && !mod) {
    e.preventDefault();
    openShortcutsModal();
    return;
  }

  if (!State.pdfDoc) return;

  // Check if Fabric.js IText is being edited
  const canvas = getCanvas();
  const activeObj = canvas && canvas.getActiveObject();
  const isEditingText = activeObj && activeObj.isEditing;

  switch (true) {
    // Undo / Redo
    case mod && e.key === 'z' && !e.shiftKey:
      e.preventDefault();
      handleUndo();
      break;
    case mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey)):
      e.preventDefault();
      handleRedo();
      break;

    // Copy / Paste / Duplicate annotations
    case mod && e.key === 'c' && !isEditingText:
      e.preventDefault();
      copySelected();
      break;
    case mod && e.key === 'v' && !isEditingText:
      e.preventDefault();
      pasteClipboard();
      break;
    case mod && e.key === 'd' && !isEditingText:
      e.preventDefault();
      duplicateSelected();
      break;

    // Delete selected annotation object
    case (e.key === 'Delete' || e.key === 'Backspace') && !isEditingText:
      e.preventDefault();
      deleteSelected();
      break;

    // Escape: close modal → close crop → close find bar → deselect → switch to select tool
    case e.key === 'Escape': {
      const openBackdrop = document.querySelector('.modal-backdrop:not(.hidden)');
      if (openBackdrop) {
        const closeBtn = openBackdrop.querySelector('[data-close-modal]');
        if (closeBtn) closeBtn.click();
      } else if (cropState.active) {
        closeCropModal();
      } else if (isFindOpen()) {
        closeFindBar();
      } else {
        if (canvas) canvas.discardActiveObject().renderAll();
        selectTool('select');
      }
      break;
    }

    // Tool shortcuts (only when not editing text)
    case e.key === 'v' && !mod && !isEditingText:
      selectTool('select');
      break;
    case e.key === 'h' && !mod && !isEditingText:
      selectTool('hand');
      break;
    case e.key === 't' && !mod && !isEditingText:
      selectTool('text');
      break;
    case e.key === 'd' && !mod && !isEditingText:
      selectTool('draw');
      break;

    // Print
    case mod && e.key === 'p':
      e.preventDefault();
      handlePrint();
      break;

    // Navigation
    case e.key === 'ArrowLeft' || e.key === 'ArrowUp':
      if (isEditingText) return; // let Fabric handle arrows in text
      e.preventDefault();
      prevPage();
      break;
    case e.key === 'ArrowRight' || e.key === 'ArrowDown':
      if (isEditingText) return;
      e.preventDefault();
      nextPage();
      break;
    case e.key === 'Home':
      e.preventDefault();
      goToPage(1);
      break;
    case e.key === 'End':
      e.preventDefault();
      goToPage(State.totalPages);
      break;

    // Zoom
    case (e.key === '=' || e.key === '+') && mod:
      e.preventDefault();
      zoomIn();
      break;
    case e.key === '-' && mod:
      e.preventDefault();
      zoomOut();
      break;
    case e.key === '0' && mod:
      e.preventDefault();
      setZoom(1.0);
      break;

    // File open
    case e.key === 'o' && mod:
      e.preventDefault();
      DOM.fileInput.click();
      break;

    // Export / Save
    case e.key === 's' && mod:
      e.preventDefault();
      handleExport();
      break;
  }
}

/** Helper to switch tool and update UI across all ribbon panels */
function selectTool(toolName) {
  // Sync ribbon toolbar buttons
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.tool-btn[data-tool="${toolName}"]`).forEach(btn => {
    if (!btn.disabled) btn.classList.add('active');
  });
  // Sync floating toolbar buttons
  document.querySelectorAll('.float-btn[data-tool]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.float-btn[data-tool="${toolName}"]`).forEach(btn => {
    btn.classList.add('active');
  });
  State.activeTool = toolName;
  setTool(toolName, { shapeType: 'rect', stampType: 'approved' });
  updatePanelToolTitle();
  // Update status bar tool indicator
  const toolLabel = $('status-tool');
  if (toolLabel) {
    const names = { select: 'Select', hand: 'Hand', text: 'Text', draw: 'Draw', highlight: 'Highlight', underline: 'Underline', strikethrough: 'Strikethrough', shape: 'Shape', cover: 'Cover', redact: 'Redact', stamp: 'Stamp', 'sticky-note': 'Note' };
    toolLabel.textContent = 'Tool: ' + (names[toolName] || toolName);
    toolLabel.classList.remove('hidden');
  }
  // Show/hide tool properties section based on active tool
  const toolPropsEl = $('panel-tool-props');
  if (toolPropsEl) {
    const noPropsTools = ['select', 'hand'];
    toolPropsEl.style.display = noPropsTools.includes(toolName) ? 'none' : '';
  }
  // Update canvas cursor
  DOM.canvasArea.setAttribute('data-cursor', toolName);

  // Hand tool: disable text selection so it doesn't interfere with panning
  // Select tool: enable text selection on the text layer
  const textLayer = DOM.textLayer;
  if (textLayer) {
    if (toolName === 'hand') {
      textLayer.style.pointerEvents = 'none';
      textLayer.style.userSelect = 'none';
    } else if (toolName === 'select') {
      textLayer.style.pointerEvents = 'auto';
      textLayer.style.userSelect = 'auto';
    } else {
      // Other annotation tools: disable text selection
      textLayer.style.pointerEvents = 'none';
      textLayer.style.userSelect = 'none';
    }
  }
}

/* ═══════════════════ Public API (for testing & URL loading) ═══════════════════ */

window.Mudbrick = {
  /** Load a PDF from a URL (useful for testing and link sharing) */
  async loadFromURL(url) {
    showLoading('Loading PDF from URL…');
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const name = url.split('/').pop() || 'document.pdf';
      await openPDF(bytes, name, bytes.length);
      toast(`Opened ${name}`, 'success');
    } catch (e) {
      console.error('Load from URL failed:', e);
      toast('Failed to load PDF from URL.', 'error');
    } finally {
      hideLoading();
    }
  },
  getState: () => State,
  goToPage,
  setZoom,
  getCanvas,
  handleExport,
};

/* ═══════════════════ Boot ═══════════════════ */

boot().then(() => {
  // Auto-load PDF from ?url= query param (useful for testing & sharing)
  const params = new URLSearchParams(window.location.search);
  const pdfUrl = params.get('url');
  if (pdfUrl) {
    window.Mudbrick.loadFromURL(pdfUrl);
  }
}).catch(e => console.error('Boot failed:', e));
