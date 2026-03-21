/**
 * Mudbrick — DOM References
 * Lazily resolved DOM element references.
 * Call resolveDOMRefs() during boot() after DOMContentLoaded.
 */

const _nullEl = new Proxy({}, { get: () => () => {}, set: () => true });
export const $ = id => document.getElementById(id) || _nullEl;

export const DOM = {};

export function resolveDOMRefs() {
  DOM.welcomeScreen = $('welcome-screen');
  DOM.app = $('app');
  DOM.pdfCanvas = $('pdf-canvas');
  DOM.textLayer = $('text-layer');
  DOM.fabricWrapper = $('fabric-canvas-wrapper');
  DOM.canvasArea = $('canvas-area');
  DOM.pageContainer = $('page-container');
  DOM.thumbnailList = $('thumbnail-list');
  DOM.sidebar = $('sidebar');
  DOM.pageInput = $('page-input');
  DOM.totalPages = $('total-pages');
  DOM.zoomBtn = $('btn-zoom-level');
  DOM.statusFilename = $('status-filename');
  DOM.statusBarFilename = $('statusbar-filename');
  DOM.statusPagesSize = $('status-pages-size');
  DOM.statusZoom = $('status-zoom');
  DOM.statusBates = $('status-bates');
  DOM.statusBadgeEncrypted = $('status-badge-encrypted');
  DOM.statusBadgeTagged = $('status-badge-tagged');
  DOM.statusZoomIn = $('status-zoom-in');
  DOM.statusZoomOut = $('status-zoom-out');
  DOM.fileInput = $('file-input');
  DOM.btnPrev = $('btn-prev-page');
  DOM.btnNext = $('btn-next-page');
  DOM.btnFirst = $('btn-first-page');
  DOM.btnLast = $('btn-last-page');
  DOM.propertiesPanel = $('properties-panel');
  DOM.btnUndo = $('btn-undo');
  DOM.btnRedo = $('btn-redo');
  DOM.btnEditText = $('btn-edit-text');
  DOM.btnEditImage = $('btn-edit-image');
}
