# Architecture Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 6,500-line `js/app.js` monolith into focused modules with clear boundaries, zero behavior changes, and all 621 tests passing after each task.

**Architecture:** Extract `State`, `DOM`, rendering, navigation, thumbnails, menus, and event wiring into separate ES modules. `app.js` becomes a thin orchestrator (~800 lines). Each module imports `State` and `DOM` from their respective modules. Lower modules never import from higher ones.

**Tech Stack:** Vanilla JS (ES modules), no build step, no bundler. All existing CDN dependencies unchanged.

**Spec:** `docs/superpowers/specs/2026-03-21-form-filling-ux-and-architecture-design.md`

**Import topology (lower → higher only):**
```
state.js         ← no imports from other app modules
dom-refs.js      ← imports state.js only
renderer.js      ← imports state, dom-refs, pdf-engine, forms, find, ocr, annotations, links, history
navigation.js    ← imports state, dom-refs, renderer, thumbnails, a11y
thumbnails.js    ← imports state, dom-refs, pdf-engine, page-labels
menus.js         ← imports state, dom-refs (actions passed as callbacks object)
event-wiring.js  ← imports all above modules + all feature modules
app.js           ← imports event-wiring, orchestrates boot/openPDF/reloadAfterEdit
```

---

### Task 1: Extract `js/state.js`

**Files:**
- Create: `js/state.js`
- Modify: `js/app.js:100-116`

- [ ] **Step 1: Create `js/state.js`**

```javascript
/**
 * Mudbrick — Application State
 * Singleton mutable state object shared across all modules.
 */

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
  formFields: [],
  pdfLibDoc: null,
  _viewport: null,
  integration: null,
  formAssistEnabled: true, // reserved for toggle system (Phase 2)
};

export default State;
```

- [ ] **Step 2: Update `js/app.js` to import State**

Replace the `State` object definition (lines 100-116) with:
```javascript
import State from './state.js';
```

Remove the `const State = { ... };` block. All existing references to `State.xxx` in app.js continue to work since they reference the same object.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 621 tests pass (State is module-scoped in app.js currently; tests mock at the module level and don't directly access State)

- [ ] **Step 4: Manual smoke test**

Open `http://localhost:3456`, load a PDF, verify rendering, page navigation, zoom all work.

- [ ] **Step 5: Commit**

```bash
git add js/state.js js/app.js
git commit -m "refactor: extract State into js/state.js"
```

---

### Task 2: Extract `js/dom-refs.js`

**Files:**
- Create: `js/dom-refs.js`
- Modify: `js/app.js:118-155`

- [ ] **Step 1: Create `js/dom-refs.js`**

```javascript
/**
 * Mudbrick — DOM References
 * Lazily resolved DOM element references.
 * Call resolveDOMRefs() during boot() after DOMContentLoaded.
 */

const _nullEl = new Proxy({}, { get: () => () => {}, set: () => true });
export const $ = id => document.getElementById(id) || _nullEl;

export const DOM = {
  // Populated by resolveDOMRefs() — not at import time
};

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
```

- [ ] **Step 2: Update `js/app.js`**

Replace `_nullEl`, `$`, and `DOM` definitions (lines 118-155) with:
```javascript
import { DOM, $, resolveDOMRefs } from './dom-refs.js';
```

In `boot()` (line 168), add `resolveDOMRefs();` as the first line after `initErrorHandler();`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 621 tests pass

- [ ] **Step 4: Manual smoke test**

Load a PDF, verify all UI elements respond (buttons, menus, panels).

- [ ] **Step 5: Commit**

```bash
git add js/dom-refs.js js/app.js
git commit -m "refactor: extract DOM refs into js/dom-refs.js with lazy resolution"
```

---

### Task 3: Extract `js/renderer.js`

**Files:**
- Create: `js/renderer.js`
- Modify: `js/app.js`

This is the largest extraction — `renderCurrentPage` (164 lines) plus all zoom functions (~80 lines).

- [ ] **Step 1: Create `js/renderer.js`**

Extract these functions from `app.js` into `js/renderer.js`:
- `renderCurrentPage` (line 645, ~164 lines)
- `_captureScrollRatio` (line 872, ~9 lines)
- `setZoom` (line 883, ~6 lines)
- `setZoomThrottled` (line 895, ~18 lines)
- `zoomIn` (line 915)
- `zoomOut` (line 916)
- `fitWidth` (line 918, ~8 lines)
- `fitPage` (line 928, ~10 lines)
- `updateZoomDisplay` (line 941, ~5 lines)
- `replaceIcons` (line 160, ~6 lines)

The module must import:
```javascript
import State from './state.js';
import { DOM, $ } from './dom-refs.js';
import { renderPage, renderTextLayer, calculateFitWidth, calculateFitPage, cleanupPage, getCleanupDistance } from './pdf-engine.js';
import { renderFormOverlay, clearFormOverlay } from './forms.js';
import { renderHighlights } from './find.js';
import { renderOCRTextLayer, hasOCRResults } from './ocr.js';
import { resizeOverlay, loadPageAnnotations, savePageAnnotations, getCanvas, getAnnotations, initAnnotations } from './annotations.js';
import { extractLinksFromPage, createLinkRect } from './links.js';
import { initPageState, canUndo, canRedo } from './history.js';
import { icon } from './icons.js';
import { getPageLabel } from './page-labels.js';
import { announceToScreenReader } from './a11y.js';
```

Export all functions as named exports. Move the module-level variables they depend on:
- `_renderGeneration` (line 641)
- `_pendingScrollRestore` (line 643)
- `_zoomThrottleTimer` (line 893)

- [ ] **Step 2: Update `js/app.js`**

Replace extracted functions with import:
```javascript
import {
  renderCurrentPage, setZoom, setZoomThrottled, zoomIn, zoomOut,
  fitWidth, fitPage, updateZoomDisplay, replaceIcons, _captureScrollRatio,
} from './renderer.js';
```

Delete the extracted function bodies from app.js.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 621 tests pass

- [ ] **Step 4: Smoke test**

Load PDF, zoom in/out, fit width, fit page, navigate pages, verify rendering.

- [ ] **Step 5: Commit**

```bash
git add js/renderer.js js/app.js
git commit -m "refactor: extract renderer (renderCurrentPage, zoom) into js/renderer.js"
```

---

### Task 4: Extract `js/navigation.js`

**Files:**
- Create: `js/navigation.js`
- Modify: `js/app.js`

- [ ] **Step 1: Create `js/navigation.js`**

Extract these functions:
- `goToPage` (line 813, ~26 lines)
- `prevPage`, `nextPage`, `firstPage`, `lastPage` (lines 841-844)
- `updatePageNav` (line 846, ~11 lines)

Import:
```javascript
import State from './state.js';
import { DOM } from './dom-refs.js';
import { renderCurrentPage } from './renderer.js';
import { announceToScreenReader } from './a11y.js';
import { getPageLabel } from './page-labels.js';
```

Move module-level variable: `_navDebounceTimer` (near line 830).

Note: `goToPage` calls `highlightActiveThumbnail` — this will be in `thumbnails.js`. Use a late-bound callback pattern: export a `setHighlightCallback(fn)` function that `app.js` calls during boot to wire it up, avoiding a circular import with thumbnails.js.

- [ ] **Step 2: Update `js/app.js`**

```javascript
import { goToPage, prevPage, nextPage, firstPage, lastPage, updatePageNav, setHighlightCallback } from './navigation.js';
```

In `boot()`, after thumbnail setup: `setHighlightCallback(highlightActiveThumbnail);`

- [ ] **Step 3: Run tests and smoke test**

- [ ] **Step 4: Commit**

```bash
git add js/navigation.js js/app.js
git commit -m "refactor: extract navigation (goToPage, page nav) into js/navigation.js"
```

---

### Task 5: Extract `js/thumbnails.js`

**Files:**
- Create: `js/thumbnails.js`
- Modify: `js/app.js`

- [ ] **Step 1: Create `js/thumbnails.js`**

Extract:
- `generateThumbnails` (line 955, ~81 lines)
- `_drainThumbQueue` (line 1039, ~9 lines)
- `renderThumbnailForItem` (line 1050, ~15 lines)
- `highlightActiveThumbnail` (line 1067, ~8 lines)

Module-level variables: `_thumbObserver`, `_thumbQueue`, `_thumbActiveCount`, `THUMB_CONCURRENCY`.

Import:
```javascript
import State from './state.js';
import { DOM } from './dom-refs.js';
import { renderThumbnail } from './pdf-engine.js';
import { getPageLabel } from './page-labels.js';
import { announceToScreenReader } from './a11y.js';
```

Note: `generateThumbnails` creates click handlers that call `goToPage` and `showContextMenu`. Accept these as callbacks via a `setThumbnailCallbacks({ goToPage, showContextMenu })` pattern to avoid circular imports.

- [ ] **Step 2: Update `js/app.js`**

```javascript
import { generateThumbnails, highlightActiveThumbnail, renderThumbnailForItem, setThumbnailCallbacks } from './thumbnails.js';
```

In `boot()`: `setThumbnailCallbacks({ goToPage, showContextMenu });`

- [ ] **Step 3: Run tests and smoke test**

- [ ] **Step 4: Commit**

```bash
git add js/thumbnails.js js/app.js
git commit -m "refactor: extract thumbnails into js/thumbnails.js"
```

---

### Task 6: Extract `js/menus.js`

**Files:**
- Create: `js/menus.js`
- Modify: `js/app.js`

- [ ] **Step 1: Create `js/menus.js`**

Extract:
- `getMenuDefinitions` (line 3696, ~84 lines) — change signature to `getMenuDefinitions(actions)` where `actions` is an object of callbacks
- `openDropdown` (line 3520, ~174 lines) — add support for `checked: () => bool` property on menu items
- `closeDropdown` (line 3504, ~14 lines)
- `initDropdownMenus` (line 3843, ~21 lines)
- `buildRecentSubmenu` (line 3819, ~14 lines)
- `showContextMenu` (line 1645, ~155 lines)
- `hideContextMenu` (line 1801, ~6 lines)
- `showAnnotationContextMenu` (line 1810, ~73 lines)

In `openDropdown`, add checked item rendering:
```javascript
// Inside the item rendering loop, after creating the menu item element:
if (item.checked && item.checked()) {
  itemEl.classList.add('menu-item-checked');
  itemEl.insertAdjacentHTML('afterbegin', '<span class="menu-check">✓</span> ');
}
```

Import:
```javascript
import State from './state.js';
import { DOM, $ } from './dom-refs.js';
import { icon } from './icons.js';
```

`getMenuDefinitions(actions)` receives all action callbacks from `app.js`:
```javascript
export function getMenuDefinitions(actions) {
  return {
    'File': [
      { icon: 'file-plus', label: 'New Blank PDF', shortcut: '', needsDoc: false, action: actions.handleNewBlankPdf },
      { icon: 'folder-open', label: 'Open', shortcut: 'Ctrl+O', needsDoc: false, action: () => DOM.fileInput.click() },
      // ... all menu items reference actions.xxx instead of direct function calls
    ],
    // ...
  };
}
```

- [ ] **Step 2: Update `js/app.js`**

```javascript
import { getMenuDefinitions, openDropdown, closeDropdown, initDropdownMenus, showContextMenu, hideContextMenu, showAnnotationContextMenu } from './menus.js';
```

In `boot()` or wherever menus are initialized, pass the actions object:
```javascript
const menuActions = {
  handleNewBlankPdf, handleCloseDocument, handleSave, handleSaveDownload,
  handleExport, handlePrint, zoomIn, zoomOut, fitWidth, fitPage, setZoom,
  toggleSidebar, togglePropertiesPanel, toggleDarkMode, handleEditText,
  handleImageInsert, openWatermarkModal, openHfModal, openBatesModal,
  openPageLabelsModal, openExhibitModal, openMergeModal, openFindBar,
  openCommentSummaryModal, openNormalizePagesModal, openShortcutsModal,
  openAboutModal, selectTool,
  // ... all actions referenced by menu definitions
};
initDropdownMenus(); // or pass menuActions here
```

- [ ] **Step 3: Run tests and smoke test**

Test all menus: File, Edit, View, Insert, Tools, Help. Verify each item triggers the correct action.

- [ ] **Step 4: Commit**

```bash
git add js/menus.js js/app.js
git commit -m "refactor: extract menus into js/menus.js with callback injection"
```

---

### Task 7: Extract `js/event-wiring.js`

**Files:**
- Create: `js/event-wiring.js`
- Modify: `js/app.js`

This is the largest single extraction — `wireEvents` is ~1,455 lines. Extract it as-is first, then it can be further decomposed in a future pass.

- [ ] **Step 1: Create `js/event-wiring.js`**

Move the entire `wireEvents` function (lines 3898-5353) and its inner helpers (`applyToSelected`, `syncPanelFromObject`, `_onObjectSelected`) into this file.

This module will have the most imports since it wires everything:
```javascript
import State from './state.js';
import { DOM, $ } from './dom-refs.js';
import { renderCurrentPage, setZoom, zoomIn, zoomOut, fitWidth, setZoomThrottled } from './renderer.js';
import { goToPage } from './navigation.js';
// ... all feature module imports needed by event handlers
```

Export:
```javascript
export function wireEvents(appCallbacks) { ... }
```

Where `appCallbacks` contains functions still defined in app.js (feature handlers like `handleSave`, `openMergeModal`, etc.).

- [ ] **Step 2: Update `js/app.js`**

```javascript
import { wireEvents } from './event-wiring.js';
```

In `boot()`, call `wireEvents(appCallbacks)` with the necessary callbacks.

- [ ] **Step 3: Run tests and smoke test**

Thorough testing required — every button, every keyboard shortcut, every tool selection.

- [ ] **Step 4: Commit**

```bash
git add js/event-wiring.js js/app.js
git commit -m "refactor: extract wireEvents into js/event-wiring.js"
```

---

### Task 8: Error Recovery Improvements

**Files:**
- Modify: `js/renderer.js`
- Modify: `js/app.js`
- Modify: `js/forms.js`

- [ ] **Step 1: Add render retry to `renderCurrentPage` in `js/renderer.js`**

Wrap the core render logic in a try/catch with one retry:
```javascript
try {
  await _renderPageCore(renderedPage);
} catch (err) {
  console.warn('Render failed, retrying with fresh canvas:', err);
  DOM.pdfCanvas.getContext('2d').clearRect(0, 0, DOM.pdfCanvas.width, DOM.pdfCanvas.height);
  await _renderPageCore(renderedPage); // retry once
}
```

- [ ] **Step 2: Add global error handler in `js/app.js` boot()**

```javascript
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  toast('Something went wrong. Try reloading if the editor is unresponsive.', 'error');
});
```

- [ ] **Step 3: Add form field sessionStorage backup in `js/forms.js`**

```javascript
let _backupTimer = null;

export function startFormBackup() {
  if (_backupTimer) clearInterval(_backupTimer);
  _backupTimer = setInterval(() => {
    if (Object.keys(formFieldValues).length > 0) {
      try {
        sessionStorage.setItem('mb-form-values', JSON.stringify(formFieldValues));
      } catch { /* quota exceeded — ignore */ }
    }
  }, 30000);
}

export function restoreFormBackup() {
  try {
    const saved = sessionStorage.getItem('mb-form-values');
    if (saved) formFieldValues = JSON.parse(saved);
  } catch { /* ignore */ }
}
```

Call `startFormBackup()` after form detection in `openPDF`, and `restoreFormBackup()` during crash recovery.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 621 tests pass

- [ ] **Step 5: Commit**

```bash
git add js/renderer.js js/app.js js/forms.js
git commit -m "feat: add render retry, global error handler, and form value backup"
```

---

### Task 9: Update Service Worker Cache

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Add new modules to SHELL_ASSETS**

Add these paths to the `SHELL_ASSETS` array in `sw.js`:
```javascript
'./js/state.js',
'./js/dom-refs.js',
'./js/renderer.js',
'./js/navigation.js',
'./js/thumbnails.js',
'./js/menus.js',
'./js/event-wiring.js',
```

- [ ] **Step 2: Bump cache version**

Increment the `CACHE_VERSION` constant in `sw.js`.

- [ ] **Step 3: Run tests and smoke test**

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore: add extracted modules to service worker cache"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: 621 tests pass

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 3: Browser smoke test**

Test in Chrome:
1. Open PDF from file picker
2. Navigate pages (thumbnails, next/prev, keyboard arrows)
3. Zoom in/out, fit width, fit page
4. All menus (File, Edit, View, Help) open and items work
5. Find & Replace
6. Annotation tools (draw, highlight, text, shapes)
7. Form field detection (USCIS PDF)
8. Dark/light mode toggle
9. Export PDF

- [ ] **Step 4: Check app.js line count**

Run: `wc -l js/app.js`
Expected: ~800-1200 lines (down from ~6,500)

- [ ] **Step 5: Commit and tag**

```bash
git tag v1.1.0-architecture-decomposition
```
