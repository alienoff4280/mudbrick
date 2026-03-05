# Mudbrick — Revised Implementation Plan (v2)

## Status: All 8 phases COMPLETE + Polish Pass COMPLETE (March 2026)

All original implementation phases (1-8) are done. A comprehensive polish pass added:
- **WS1**: Automated testing (Vitest, 75 unit tests, CI workflow)
- **WS2**: Full menu bar with dropdowns, keyboard nav, submenu support
- **WS3**: Centralized error handling, IndexedDB crash recovery, PDF validation
- **WS4**: WCAG 2.1 AA accessibility (focus trapping, ARIA, skip links, F6 region cycling)
- **WS5**: Performance (render cancellation, debounced nav, lazy text indexing, thumbnail concurrency)
- **WS6**: Print support (print.css, print dialog), unified export modal with tabs
- **WS7**: Service worker polish (stale-while-revalidate, update notifications, proper PWA icons)
- **WS8**: Onboarding tour, contextual tips, About modal

## Context

Adobe Acrobat Pro costs $22.99/month, uses dark-pattern cancellation flows, and locks basic PDF operations behind a paywall. Mudbrick is a free, open-source, client-side PDF editor that runs entirely in the browser with no server dependencies. Hosted on Vercel as a static site. The name "Mudbrick" is a jab at Adobe (which literally means sun-dried mud brick in Spanish).

---

## Changes from v1

| # | Issue | Resolution |
|---|-------|------------|
| 1 | **Redaction is cosmetic only** — drawing a black rect does not remove underlying text from the content stream; pdf-lib cannot modify content streams | Renamed to "Visual Cover" with prominent disclaimer, OR flatten page to raster before covering (destroys text selectability on that page). User chooses per-export. |
| 2 | **Annotation baking via full-page PNG** bloats file size and degrades print quality | Hybrid export: use pdf-lib drawing primitives (`drawText`, `drawRectangle`, `drawCircle`, `drawLine`) for text/shapes/highlights; raster fallback only for freehand drawings and complex Fabric objects. |
| 3 | **No text layer** — users expect Ctrl+F search and text selection in a PDF viewer | Added PDF.js `TextLayerBuilder` as a third layer between PDF canvas and Fabric canvas. Added to Phase 1. |
| 4 | **jsPDF dependency is unnecessary** — pdf-lib can embed images into new PDFs natively via `PDFDocument.create()` + `embedPng()`/`embedJpg()` | Removed jsPDF from stack. |
| 5 | **Zoom sync under-specified** — Fabric object coordinate transforms, in-progress drawing edge cases | Store all annotations in PDF-space (72 DPI). Use `canvas.setViewportTransform()` for zoom. Pause active tool on zoom change. |
| 6 | **Memory pressure on large PDFs** — dual in-memory representations (`pdfBytes` + `pdfLibDoc`) | Load pdf-lib document lazily (only on first edit operation, not on file open). Call `page.cleanup()` on off-screen PDF.js pages. |
| 7 | **Form field positioning fragile** — HTML overlays on canvas break on zoom/scroll/resize | Render form fields as Fabric.js objects on the annotation canvas. Write values back to pdf-lib on export. |
| 8 | **COEP/COOP headers may break CDN resources** | Test early; fallback plan is to disable SharedArrayBuffer mode in PDF.js (uses Uint8Array transfers instead — slightly slower, no header requirements). |
| 9 | **Undo/redo inefficient** — full JSON snapshot per action | Command pattern (action + inverse). Cap stack at 30 entries. |
| 10 | **No offline support** — meaningful differentiator vs. Acrobat | Added service worker to Phase 8 for offline capability. |

---

## Tech Stack (All via CDN, zero build system)

| Library | Purpose | CDN |
|---------|---------|-----|
| PDF.js (Mozilla, Apache 2.0) | Render PDFs to canvas + text layer | `pdfjs-dist@4.8.69` |
| pdf-lib (MIT) | Manipulate PDFs (merge, split, rotate, forms, watermark, export primitives) | `pdf-lib@1.17.1` |
| Fabric.js (MIT) | Interactive canvas overlay for annotations/drawing | `fabric@6.4.3` (verify UMD bundle, not ESM) |

**Removed:** jsPDF (redundant — pdf-lib handles image-to-PDF natively).

---

## File Structure

```
/Users/daddynovo/Documents/Claude/Abode/
  index.html                # App shell, CDN tags, layout, modals
  styles/
    variables.css           # CSS custom properties, dark/light theme
    layout.css              # App shell layout (toolbar, sidebar, canvas)
    components.css          # Buttons, modals, dropdowns, toasts
  js/
    app.js                  # State management, init, event wiring, undo/redo (command pattern)
    pdf-engine.js           # PDF.js: load, render, zoom, text layer, thumbnails
    pdf-edit.js             # pdf-lib: merge, split, rotate, delete, reorder, watermark
    annotations.js          # Fabric.js: draw, highlight, text, shapes, stamps, visual cover
    forms.js                # PDF form fields as Fabric objects + pdf-lib writeback
    export.js               # Hybrid export: pdf-lib primitives + raster fallback
    utils.js                # File I/O, drag-drop, helpers
  sw.js                     # Service worker for offline support
  vercel.json               # Deployment config (COEP/COOP headers, or fallback without)
```

---

## UI Layout

```
+------------------------------------------------------------------+
| TOOLBAR (56px)                                                    |
| [Open] [Merge] [Split] | [Select][Hand][Text][Draw][Highlight]   |
| [Shape][Stamp][Cover][Watermark] | [Zoom -][100%][Zoom +] [Find] |
+----------+---------------------------------------------+---------+
| SIDEBAR  |           MAIN CANVAS AREA                   | PROPS   |
| (220px)  |                                              | (280px) |
| Thumb 1  |     +----------------------------+          | Color   |
| Thumb 2  |     | PDF Canvas    (PDF.js)     |          | Size    |
| Thumb 3  |     | Text Layer    (PDF.js)     |          | Opacity |
| ...      |     | Fabric Canvas (overlay)    |          |         |
| [+Add]   |     +----------------------------+          |         |
|          |     Page 2 of 15   [< >]                    |         |
+----------+---------------------------------------------+---------+
| STATUS BAR - filename, page count, zoom %, file size              |
+------------------------------------------------------------------+
```

**Three-layer stack per page:**

```
div.page-container (position: relative)
  canvas#pdf-canvas     (PDF.js render, position: absolute, z-index: 1)
  div#text-layer        (PDF.js TextLayerBuilder, position: absolute, z-index: 2)
  canvas#fabric-canvas  (Fabric.js annotations, position: absolute, z-index: 3)
```

The text layer sits between PDF render and Fabric overlay, enabling native text selection and Ctrl+F search without interfering with annotations.

---

## Core State Object (js/app.js)

```js
const State = {
  // PDF.js state
  pdfDoc: null,            // PDF.js document (always loaded on open)

  // pdf-lib state (lazy-loaded on first edit)
  pdfLibDoc: null,         // pdf-lib document (null until first structural edit)
  pdfBytes: null,          // Original Uint8Array (kept for pdf-lib init)

  // File metadata
  fileName: '',
  fileSize: 0,

  // Navigation
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,

  // Page tracking
  pages: [],               // { index, rotation, deleted, thumbnailUrl }

  // Annotations (stored in PDF coordinate space, 72 DPI)
  pageAnnotations: {},     // { pageNum: fabricJsonString }

  // Tools
  activeTool: 'select',   // select | hand | text | draw | highlight | shape | stamp | cover
  toolOptions: {
    color: '#000000',
    fontSize: 16,
    strokeWidth: 2,
    opacity: 1.0,
  },

  // Undo/redo (command pattern)
  undoStack: [],           // { execute(), undo(), description }
  redoStack: [],           // capped at 30 entries

  // Merge queue
  mergeFiles: [],
};
```

---

## Implementation Phases

### Phase 1: PDF Viewer Foundation + Text Layer
**Files:** `index.html`, `styles/*`, `js/app.js`, `js/pdf-engine.js`, `js/utils.js`, `vercel.json`

**Viewer core:**
- App shell with full layout (toolbar, sidebar, canvas area, properties panel, status bar)
- Drag-and-drop + file picker to open PDFs
- PDF.js rendering with HiDPI support (`devicePixelRatio`)
- Welcome screen with drop zone when no file is loaded

**Text layer (critical for competitive parity):**
- PDF.js `TextLayerBuilder` rendered between PDF canvas and Fabric canvas
- Native browser text selection on PDF content
- Ctrl+F / Cmd+F search integration (PDF.js `PDFFindController`)
- CSS: `div#text-layer` with `pointer-events: none` when annotation tool is active, `pointer-events: auto` when select/hand tool is active

**Navigation:**
- Page navigation (prev/next, page number input, keyboard arrows)
- Zoom controls (fit-width, fit-page, custom %, Ctrl+scroll zoom)
- Thumbnail sidebar with lazy rendering via `IntersectionObserver`

**Performance:**
- Adjacent pages pre-rendered via `requestIdleCallback`
- `page.cleanup()` called on pages more than 2 away from current
- Thumbnails rendered at low resolution (0.25x scale)

**Deployment:**
- `vercel.json` with COEP/COOP headers
- Fallback: if SharedArrayBuffer isn't available, configure PDF.js worker without it (`isEvalSupported: false`, transfer-based messaging)
- Verify Fabric.js CDN bundle is UMD/IIFE (not ESM)

**Exit criteria:** Open a 100-page PDF, navigate pages, zoom in/out, select text, Ctrl+F search works, thumbnails load lazily.

---

### Phase 2: Page Management
**Files:** `js/pdf-edit.js`

This is the first phase that modifies PDFs, so it triggers lazy loading of pdf-lib.

**Lazy pdf-lib initialization:**
```js
async function ensurePdfLib() {
  if (!State.pdfLibDoc) {
    State.pdfLibDoc = await PDFDocument.load(State.pdfBytes);
  }
  return State.pdfLibDoc;
}
```

**Operations:**
- Rotate pages (90° increments) via `page.setRotation()`
- Delete pages via `removePage()`
- Reorder pages via sidebar drag-and-drop (rebuild doc with `copyPages()`)
- Thumbnail context menu (right-click: rotate, delete, extract as separate PDF)

**Exit criteria:** Rotate page 3, delete page 5, drag page 1 to position 4, export — output reflects all changes.

---

### Phase 3: Merge & Split
**Files:** Modify `js/pdf-edit.js`, add modal markup to `index.html`

**Merge:**
- Modal with multi-file drop zone
- File list with drag-to-reorder, page count preview per file
- Combine via `PDFDocument.copyPages()` from each source
- Progress indicator for large merges

**Split:**
- Modal with page range input (e.g., "1-3, 5, 7-12")
- Live preview showing which pages are in each range
- Export each range as separate PDF with auto-naming (`filename_pages_1-3.pdf`)

**Exit criteria:** Merge 3 PDFs (total 50 pages), verify all pages present. Split a 10-page PDF into ranges, verify each output.

---

### Phase 4: Annotations + Visual Cover
**Files:** `js/annotations.js`

**Fabric.js setup:**
- Single Fabric canvas instance (current page only)
- On page navigation: save current page annotations as JSON (`toJSON()`), dispose canvas, create new canvas for target page, restore from JSON (`loadFromJSON()`)
- All coordinates stored in PDF space (72 DPI), transformed to screen space via `canvas.setViewportTransform()`
- On zoom change: update viewport transform, pause any active drawing tool, resume after transform

**Annotation tools:**
- **Select:** move, resize, delete objects. Properties panel shows color/size/opacity for selection.
- **Hand:** pan the canvas (translate viewport)
- **Freehand draw:** `PencilBrush` with configurable color, width, opacity
- **Highlight:** semi-transparent yellow rectangles (default opacity 0.3)
- **Text:** `IText` objects, click-to-place, inline editing, font size/color
- **Shapes:** rectangle, circle, line, arrow (Fabric primitives)
- **Stamps:** predefined text stamps (APPROVED, REJECTED, DRAFT, CONFIDENTIAL, VOID) as styled `IText` with border

**Visual Cover (not redaction):**
- Solid-color rectangles (default black) placed over content
- **Prominent disclaimer** in UI: "Visual Cover hides content visually but does NOT securely remove it from the PDF data. Text underneath can still be extracted. For true redaction, use the 'Flatten & Cover' export option."
- See Phase 5 for secure flatten-and-cover export option

**Undo/redo (command pattern):**
```js
// Each action creates a command object
const command = {
  description: 'Add text annotation',
  execute() { /* add object to canvas */ },
  undo() { /* remove object from canvas */ },
};
State.undoStack.push(command);
State.redoStack = []; // clear redo on new action
// Cap at 30 entries, drop oldest
if (State.undoStack.length > 30) State.undoStack.shift();
```

**Exit criteria:** Draw on page 1, add text on page 3, navigate back to page 1 — annotations persist. Undo/redo works across 10 operations. Zoom in — annotations scale correctly.

---

### Phase 5: Export & Download
**Files:** `js/export.js`

**Hybrid export pipeline (the key architectural improvement):**

For each annotated page, iterate through Fabric objects and export using the appropriate method:

| Fabric Object Type | Export Method | Quality |
|-------------------|--------------|---------|
| `IText` (text annotations) | `page.drawText()` via pdf-lib | Vector, lossless |
| `Rect` (highlights, covers) | `page.drawRectangle()` via pdf-lib | Vector, lossless |
| `Circle` | `page.drawEllipse()` via pdf-lib | Vector, lossless |
| `Line`, `Arrow` | `page.drawLine()` via pdf-lib | Vector, lossless |
| Stamps | `page.drawText()` + `page.drawRectangle()` | Vector, lossless |
| `Path` (freehand draw) | Render to PNG, embed as image | Raster fallback |
| Complex/grouped objects | Render to PNG, embed as image | Raster fallback |

**Export options:**
1. **Annotated PDF** (default): Bakes annotations using hybrid method above. Visual covers are drawn as opaque rectangles but underlying content remains in the data stream. Download as `filename_annotated.pdf`.
2. **Flatten & Cover** (secure): For each page with visual cover annotations, render the entire page (PDF + annotations) to a high-res raster image (300 DPI), replace the page content with that image. This physically destroys underlying text. Clearly labeled: "Flattened pages lose text selectability." Download as `filename_flattened.pdf`.
3. **Annotations only** (optional): Export annotations as a separate overlay PDF that can be layered in other tools.

**Exit criteria:** Add text + shape + freehand drawing + visual cover to a page. Export with each option. Open in Adobe Reader — annotations are baked in, file size is reasonable (<2x original for vector annotations), flatten option destroys underlying text (verify with `pdftotext`).

---

### Phase 6: Form Filling
**Files:** `js/forms.js`

**Architecture: Form fields as Fabric objects (not HTML overlays).**

This avoids the fragile positioning problem of HTML overlays on canvas.

**Detection:**
- On pdf-lib load, call `pdfLibDoc.getForm().getFields()`
- For each field, read type, position, dimensions, current value

**Rendering:**
- Create Fabric.js objects for each form field type:
  - **Text fields:** `IText` with border, positioned over the field location
  - **Checkboxes:** Custom Fabric object (square + X/check mark on click)
  - **Dropdowns:** `IText` with click handler that shows a native `<select>` temporarily
  - **Radio buttons:** Custom Fabric object (circle + fill on click)
- Fields styled distinctly from annotations (blue border, light blue background)

**Export:**
- On save/export, write Fabric object values back to pdf-lib form fields
- `form.getTextField('name').setText(fabricObject.text)`

**Exit criteria:** Open a PDF with text fields, checkboxes, and dropdowns. Fill all fields. Export. Open in Adobe Reader — values persist.

---

### Phase 7: Watermark & Image Tools
**Files:** Modify `js/pdf-edit.js`, `js/annotations.js`

**Watermark:**
- Modal: text input, font size, rotation angle, opacity, color
- Apply diagonally across all pages via pdf-lib `page.drawText()` with rotation
- Preview on current page before applying to all

**Image insertion (as annotation):**
- File picker for PNG/JPG
- Load as `fabric.Image` on annotation canvas
- Resize handles, drag to position
- Exported via the hybrid pipeline (embedded as image in pdf-lib)

**Images to PDF (new document):**
- Accept multiple image files
- Create new `PDFDocument`, embed each image as a page via `embedPng()`/`embedJpg()`
- Auto-size pages to match image dimensions
- Download as new PDF

**Exit criteria:** Add diagonal "DRAFT" watermark to all pages of a 10-page PDF. Insert a PNG onto page 3. Convert 5 JPGs into a single PDF.

---

### Phase 8: Polish & Offline
**Files:** All files, `sw.js`

**Dark mode:**
- CSS custom properties + `html[data-theme="dark"]` toggle
- Respect `prefers-color-scheme` media query
- Persist preference in `localStorage`

**Keyboard shortcuts:**
- `Ctrl+Z` / `Cmd+Z`: Undo
- `Ctrl+Shift+Z` / `Cmd+Shift+Z`: Redo
- `Ctrl+S` / `Cmd+S`: Export/save
- `Ctrl+F` / `Cmd+F`: Find in PDF
- `Delete` / `Backspace`: Remove selected annotation
- `Arrow keys`: Navigate pages
- `V`: Select tool, `H`: Hand tool, `T`: Text tool, `D`: Draw tool
- `+` / `-`: Zoom in/out

**Toast notifications:**
- Success (green): "PDF exported successfully"
- Error (red): "Failed to load PDF — file may be corrupted"
- Warning (yellow): "Visual cover does not securely redact content"
- Info (blue): "Loading large PDF, this may take a moment..."

**Loading states:**
- Skeleton thumbnails while rendering
- Progress bar for merge/split/export operations
- Disable toolbar during long operations

**Service worker (`sw.js`):**
- Cache CDN libraries (PDF.js, pdf-lib, Fabric.js) for offline use
- Cache app shell (HTML, CSS, JS)
- Strategy: cache-first for CDN assets, network-first for app files
- Offline indicator in status bar

**Mobile responsive:**
- Sidebar collapses to bottom sheet on narrow screens
- Properties panel becomes a modal
- Touch-friendly toolbar with overflow menu
- Pinch-to-zoom support

**Exit criteria:** Toggle dark mode. Use all keyboard shortcuts. Load app while offline. Open on mobile — layout adapts.

---

## Key Technical Details

### Zoom Synchronization (detailed)

All annotations stored in PDF coordinate space (1 unit = 1/72 inch). Screen rendering uses a viewport transform:

```js
function updateZoom(newZoom) {
  const prevTool = State.activeTool;
  State.activeTool = 'select'; // pause active tool

  State.zoom = newZoom;

  // 1. Re-render PDF.js at new scale
  renderPage(State.currentPage, newZoom * devicePixelRatio);

  // 2. Resize Fabric canvas dimensions to match
  fabricCanvas.setDimensions({
    width: pdfCanvas.width / devicePixelRatio,
    height: pdfCanvas.height / devicePixelRatio,
  });

  // 3. Apply viewport transform (annotation coords are in PDF space)
  const scale = newZoom * (96 / 72); // PDF points to CSS pixels
  fabricCanvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);

  // 4. Resize text layer to match
  textLayer.style.transform = `scale(${newZoom})`;

  State.activeTool = prevTool; // resume tool
}
```

### Memory Management for Large PDFs

```
File open:
  → Store pdfBytes (Uint8Array)
  → Create PDF.js document (pdfDoc)
  → Do NOT create pdf-lib document yet

First structural edit (rotate, delete, reorder, merge, form fill):
  → Lazy-load: pdfLibDoc = await PDFDocument.load(pdfBytes)

Page navigation:
  → Save current Fabric canvas to pageAnnotations[currentPage] as JSON
  → fabricCanvas.dispose()
  → Create new Fabric canvas for target page
  → Restore from pageAnnotations[targetPage] if exists
  → Call page.cleanup() on pages > 2 away from current

Thumbnail rendering:
  → IntersectionObserver triggers render at 0.25x scale
  → Cache thumbnail as data URL
  → Never re-render unless page is modified
```

### Visual Cover vs. Secure Flattening

| | Visual Cover (default) | Flatten & Cover (secure) |
|---|---|---|
| How it works | Draws opaque rectangle via pdf-lib `drawRectangle()` | Renders entire page to 300 DPI raster, replaces page |
| Underlying text | Still in PDF data stream | Physically destroyed |
| Text selectability | Preserved on rest of page | Lost on flattened pages |
| File size impact | Minimal | Significant (raster pages) |
| Use case | Casual visual hiding | Legal/compliance needs |
| UI indicator | Yellow warning banner | Green "securely flattened" confirmation |

---

## Verification Plan

1. **Phase 1 — Viewer:** Open small (1-page), medium (20-page), and large (100+ page) PDFs. Verify text selection and Ctrl+F search work. Check memory usage on large files. Verify thumbnails lazy-load via IntersectionObserver.

2. **Phase 2 — Page ops:** Rotate page, delete page, reorder pages via drag. Export and verify output reflects changes. Verify pdf-lib only loads on first edit (check network tab).

3. **Phase 3 — Merge/Split:** Merge 3 PDFs, verify all pages present. Split a 10-page PDF into "1-3, 5, 7-10", verify two output files with correct page counts.

4. **Phase 4 — Annotations:** Draw on page 1, navigate to page 5, return to page 1 — annotations persist. Undo 5 actions, redo 3. Zoom to 200% — annotations scale correctly. Add visual cover — warning appears.

5. **Phase 5 — Export:** Add text + shape + freehand + visual cover. Export as annotated PDF — verify vector annotations are crisp, freehand is raster, file size is reasonable. Export as flattened — run `pdftotext` on output, verify covered text is absent.

6. **Phase 6 — Forms:** Open a PDF with text fields, checkboxes, dropdowns. Fill all fields. Export. Open in Adobe Reader — values persist. Zoom in — fields stay positioned correctly.

7. **Phase 7 — Watermark/Images:** Add diagonal watermark to all pages. Insert PNG on page 3. Convert 5 JPGs to PDF. Verify all outputs.

8. **Phase 8 — Polish:** Toggle dark mode, use keyboard shortcuts, disconnect network and verify app loads from service worker. Test on mobile viewport (375px wide).

9. **Vercel deploy:** `vercel --prod`. Verify COEP/COOP headers (or confirm fallback mode works). Verify PDF.js web worker loads. Test SharedArrayBuffer availability via console: `typeof SharedArrayBuffer`.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| COEP/COOP breaks CDN resource | Medium | High (blocks launch) | Test in Phase 1. Fallback: disable SharedArrayBuffer in PDF.js config. |
| Fabric.js 6.x CDN is ESM-only | Medium | High | Verify before Phase 1. Fallback: use Fabric.js 5.x (IIFE bundle confirmed). |
| pdf-lib can't handle encrypted PDFs | High | Medium | Detect and show clear error: "This PDF is password-protected. Please unlock it first." |
| Large PDF (100+ pages) causes OOM | Medium | High | Aggressive page cleanup, lazy pdf-lib, thumbnail caching limits. Test with 200-page PDF in Phase 1. |
| Users assume Visual Cover is secure redaction | High | High (legal liability) | Prominent warning on tool select, warning in export dialog, disclaimer in status bar while cover tool active. |
| Fabric.js freehand paths too complex for pdf-lib primitives | High | Low | Already planned: raster fallback for paths. Monitor file size impact. |
