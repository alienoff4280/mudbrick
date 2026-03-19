# Mudbrick v2 -- Implementation Plan

> Compiled: 2026-03-19 | Revised: 2026-03-19
> Sources: architecture-blueprint.md (System Designer), tech-lead-review.md (Tech Lead)
> Status: FINAL -- Tauri desktop application with Python sidecar

---

## Executive Summary

Mudbrick v2 replaces the current 28K LOC vanilla JS PWA with a **Windows desktop application**:
- **Tauri 2.x** native shell wrapping a **React 19** frontend
- **Python FastAPI** backend running as a **local sidecar** on `localhost:8000`
- **Everything runs locally** -- files never leave the user's machine

Key upgrades over v1: forensic redaction (strips PDF objects), local OCR (faster/more accurate via pytesseract), unlimited undo history, proper 100MB+ file handling with no browser memory pressure, and a maintainable component-based frontend.

Timeline: 20 weeks (5 months) across 4 phases. Phase 1 MVP in 6 weeks.

Branch strategy: New branch `mudbrickv2` in the existing `mudbrick` repo. If successful, replaces main after testing.

### Confirmed Windows App Additions

- `src-tauri/` owns the Rust shell, sidecar configuration, window management, and native app lifecycle
- The PyInstaller spec plus `scripts/build-sidecar.ps1` bundle Python + Tesseract into a distributable sidecar directory
- Tauri file dialogs replace browser open, save, and save-as pickers
- OCR progress streams from the local sidecar over SSE, so there is no polling layer
- Sessions persist in `%APPDATA%/mudbrick/sessions/` while active session state stays in memory
- GitHub Actions builds and publishes `.msi` and `.exe` installers to GitHub Releases
- Tauri auto-updater uses GitHub Releases as the update source

---

## 1. Architecture Decision

**Greenfield hybrid rewrite as a desktop app.** Not gradual migration, not web-hosted.

### Why Greenfield
- The app.js god-module (6,566 LOC) manages all state, events, navigation, and rendering. It has no seams for incremental refactoring.
- There is no API layer, no component model, and no build system. You cannot insert API calls into a system of window globals and direct DOM manipulation without rewriting the consumers.
- The cost of maintaining two architectures during a gradual migration exceeds the cost of a clean rewrite.

### Why Hybrid (Not Python Full-Stack)
- PDF rendering, annotation drawing, zoom/pan, text editing overlays, and signature canvas all require sub-16ms frame budgets. This is physically impossible over HTTP round-trips.
- PDF.js and Fabric.js are browser-only libraries with no Python equivalents. They ARE the rendering engine.
- A native canvas GUI toolkit cannot match the maturity and flexibility of Fabric.js for annotation editing.

### Why Desktop (Not Web-Hosted)
- **Files never leave the machine.** This is a core requirement for a legal document editor handling sensitive client files.
- **No timeout constraints.** OCR on 500 pages, merging 10 x 100MB files -- runs as long as needed.
- **No upload/download cycle.** Backend reads/writes files directly on the local filesystem. Zero network overhead for 100MB files.
- **No hosting costs.** $0/month infrastructure.
- **No cold starts.** Python sidecar is always running while the app is open.
- **SSE streaming works.** Real-time progress for OCR and long operations, no polling workarounds.

### Why Not Keep Everything Client-Side
- pdf-lib (the current JS PDF mutation library) cannot perform forensic redaction -- it cannot strip underlying PDF objects.
- PyMuPDF can. This is the single biggest capability upgrade and the primary reason for a Python backend.
- Local Python processing also solves: 100MB file memory pressure (PyMuPDF is more memory-efficient than browser-based pdf-lib), OCR performance, encryption quality, document comparison accuracy.

### Why Tauri (Not Electron)
- Tauri produces ~10MB installers vs Electron's ~150MB (no bundled Chromium -- uses system WebView2).
- Lower memory footprint -- important when processing 100MB PDFs.
- Built-in file dialogs, auto-updater, and Windows installer (.msi) generation.
- Rust core is fast and memory-safe for the sidecar management layer.
- WebView2 is pre-installed on Windows 10/11.

---

## 2. Tech Stack

### Frontend (rendered in Tauri WebView)
| Component | Technology | Version |
|---|---|---|
| Desktop shell | Tauri | 2.x |
| Framework | React | 19 |
| Language | TypeScript | 5.x |
| Build tool | Vite | 6.x |
| State management | Zustand | 5.x |
| PDF rendering | PDF.js | Latest (via pdfjs-dist) |
| Annotations | Fabric.js | 6.x |
| Styling | CSS Modules + CSS custom properties | -- |
| Testing | Vitest + React Testing Library | Latest |

### Backend (Python sidecar on localhost:8000)
| Component | Technology | Version |
|---|---|---|
| Framework | FastAPI | 0.115.x |
| Language | Python | 3.12 |
| PDF engine (primary) | PyMuPDF (fitz) | 1.25.x |
| PDF engine (forms/crypto) | pikepdf | 9.x |
| OCR | pytesseract + Tesseract 5 | Latest |
| Image processing | Pillow | 11.x |
| HTTP server | Uvicorn | 0.34.x |
| Testing | pytest + httpx | Latest |
| Bundling | PyInstaller | 6.x |

### Infrastructure
| Component | Technology | Purpose |
|---|---|---|
| Desktop shell | Tauri 2.x | Native window, file dialogs, sidecar management, auto-updater |
| Python runtime | PyInstaller bundle | Bundled Python + all deps, no user install required |
| Build/CI | GitHub Actions | Lint, test, build installer, publish release |
| Distribution | GitHub Releases | .msi installer download + auto-update feed |
| Monorepo | pnpm workspaces | Frontend + shared packages |

---

## 3. File/Folder Structure

```
mudbrick-v2/
├── apps/
│   ├── web/                              # React frontend (rendered in Tauri WebView)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── viewer/
│   │   │   │   │   ├── PdfViewer.tsx           # Main viewer with page virtualization
│   │   │   │   │   ├── PageCanvas.tsx          # Single page: PDF.js render + annotation overlay
│   │   │   │   │   ├── ThumbnailSidebar.tsx    # Page thumbnails with drag-to-reorder
│   │   │   │   │   ├── ZoomControls.tsx        # Zoom bar, fit-to-page/width
│   │   │   │   │   └── TextLayer.tsx           # PDF.js text layer for selection
│   │   │   │   ├── annotations/
│   │   │   │   │   ├── AnnotationCanvas.tsx    # Fabric.js canvas overlay per page
│   │   │   │   │   ├── Toolbar.tsx             # Tool selection + properties panel
│   │   │   │   │   ├── tools/                  # Individual tool components
│   │   │   │   │   │   ├── DrawTool.tsx
│   │   │   │   │   │   ├── HighlightTool.tsx
│   │   │   │   │   │   ├── TextTool.tsx
│   │   │   │   │   │   ├── ShapeTool.tsx
│   │   │   │   │   │   ├── StampTool.tsx
│   │   │   │   │   │   └── RedactTool.tsx
│   │   │   │   │   └── PropertyPanel.tsx       # Color, stroke, font controls
│   │   │   │   ├── text-edit/
│   │   │   │   │   ├── TextEditMode.tsx        # Cover-and-replace overlay
│   │   │   │   │   ├── TextEditToolbar.tsx     # Floating font/color controls
│   │   │   │   │   └── ColorSampler.tsx        # Background color sampling
│   │   │   │   ├── forms/
│   │   │   │   │   ├── FormOverlay.tsx         # Detected form fields overlay
│   │   │   │   │   ├── FormFieldEditor.tsx     # Create/edit form fields
│   │   │   │   │   └── FormDataPanel.tsx       # Import/export form data
│   │   │   │   ├── signatures/
│   │   │   │   │   ├── SignatureModal.tsx       # Draw/type/upload signature
│   │   │   │   │   └── SignatureStamp.tsx       # Place on page
│   │   │   │   ├── find/
│   │   │   │   │   ├── FindBar.tsx             # Ctrl+F search bar
│   │   │   │   │   └── SearchHighlights.tsx    # Match highlight overlay
│   │   │   │   ├── ocr/
│   │   │   │   │   ├── OcrPanel.tsx            # OCR controls and SSE progress
│   │   │   │   │   └── CorrectionMode.tsx      # Low-confidence word editor
│   │   │   │   ├── redaction/
│   │   │   │   │   ├── RedactionPanel.tsx      # Pattern selector + preview
│   │   │   │   │   └── RedactionReview.tsx     # Review matches before applying
│   │   │   │   ├── sidebar/
│   │   │   │   │   ├── PageList.tsx            # Thumbnails, drag reorder
│   │   │   │   │   └── OutlinePanel.tsx        # Bookmarks
│   │   │   │   ├── shared/
│   │   │   │   │   ├── Toast.tsx
│   │   │   │   │   ├── LoadingOverlay.tsx
│   │   │   │   │   ├── ProgressBar.tsx
│   │   │   │   │   ├── Modal.tsx
│   │   │   │   │   ├── DropZone.tsx
│   │   │   │   │   └── WelcomeScreen.tsx
│   │   │   │   └── a11y/
│   │   │   │       ├── SkipLink.tsx
│   │   │   │       ├── FocusTrap.tsx
│   │   │   │       └── Announcer.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── usePdfDocument.ts           # Load, navigate, page state
│   │   │   │   ├── useAnnotations.ts           # Per-page Fabric.js state
│   │   │   │   ├── useZoom.ts                  # Zoom levels, fit calculations
│   │   │   │   ├── useKeyboardShortcuts.ts     # All keyboard bindings
│   │   │   │   ├── useAutoSave.ts              # IndexedDB crash recovery
│   │   │   │   ├── useUndoRedo.ts              # Annotation + doc history
│   │   │   │   ├── useDarkMode.ts              # Theme toggle
│   │   │   │   ├── useTauri.ts                 # Tauri API bridge (file dialogs, window controls)
│   │   │   │   └── useApi.ts                   # API calls to localhost:8000 with SSE support
│   │   │   ├── stores/
│   │   │   │   ├── documentStore.ts            # PDF state, file path, pages
│   │   │   │   ├── annotationStore.ts          # Per-page annotations
│   │   │   │   ├── uiStore.ts                  # Sidebar, panels, modals, theme
│   │   │   │   └── sessionStore.ts             # Recent files, preferences
│   │   │   ├── services/
│   │   │   │   ├── api.ts                      # Typed API client to localhost:8000, SSE support
│   │   │   │   ├── pdfService.ts               # PDF.js wrapper
│   │   │   │   └── tauriBridge.ts              # Tauri invoke wrappers (file dialog, app data path)
│   │   │   ├── types/
│   │   │   │   ├── pdf.ts
│   │   │   │   ├── annotation.ts
│   │   │   │   └── api.ts
│   │   │   ├── utils/
│   │   │   │   ├── zoom.ts                     # Zoom math (ported from v1)
│   │   │   │   ├── colorSampler.ts             # Canvas pixel sampling
│   │   │   │   └── formatting.ts               # File size, page ranges, etc.
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   │   └── icons/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── api/                                # Python backend (runs as sidecar)
│       ├── app/
│       │   ├── __init__.py
│       │   ├── main.py                     # FastAPI app, CORS for localhost, lifespan events
│       │   ├── config.py                   # Settings: data dir, temp dir paths
│       │   ├── dependencies.py             # Shared dependencies (session lookup)
│       │   ├── routers/
│       │   │   ├── __init__.py
│       │   │   ├── documents.py            # Open file, save, save-as, close, session info
│       │   │   ├── pages.py                # Rotate, delete, reorder, insert, crop
│       │   │   ├── merge.py                # Merge multiple PDFs
│       │   │   ├── split.py                # Split by page ranges
│       │   │   ├── ocr.py                  # OCR with SSE streaming progress
│       │   │   ├── redaction.py            # Pattern search + forensic redaction
│       │   │   ├── text.py                 # Text extraction, search
│       │   │   ├── export.py               # Flatten annotations, produce final PDF
│       │   │   ├── bates.py                # Bates numbering
│       │   │   ├── headers.py              # Headers/footers
│       │   │   ├── exhibits.py             # Exhibit stamps
│       │   │   ├── compare.py              # Document comparison
│       │   │   ├── security.py             # Encryption, metadata, sanitization
│       │   │   ├── forms.py                # Form field operations
│       │   │   └── thumbnails.py           # Page thumbnail generation
│       │   ├── services/
│       │   │   ├── __init__.py
│       │   │   ├── pdf_engine.py           # PyMuPDF core wrapper
│       │   │   ├── ocr_engine.py           # pytesseract wrapper with SSE progress
│       │   │   ├── redaction_engine.py     # Forensic redaction: search + strip
│       │   │   ├── comparison_engine.py    # Page-level diff engine
│       │   │   ├── annotation_renderer.py  # Fabric.js JSON -> PyMuPDF drawing
│       │   │   └── session_manager.py      # In-memory session state + local file versioning
│       │   ├── models/
│       │   │   ├── __init__.py
│       │   │   ├── document.py             # Pydantic models: session, metadata
│       │   │   ├── annotation.py           # Fabric.js annotation schema
│       │   │   ├── operation.py            # Request/response models
│       │   │   └── redaction.py            # Redaction pattern models
│       │   └── utils/
│       │       ├── __init__.py
│       │       ├── streaming.py            # SSE helpers for real-time progress
│       │       └── file_handling.py        # Local file operations, temp dir management
│       ├── tests/
│       │   ├── conftest.py
│       │   ├── test_documents.py
│       │   ├── test_pages.py
│       │   ├── test_ocr.py
│       │   ├── test_redaction.py
│       │   └── test_export.py
│       ├── requirements.txt
│       └── mudbrick_api.spec              # PyInstaller spec for bundling
│
├── src-tauri/                              # Tauri native shell
│   ├── Cargo.toml                         # Rust dependencies
│   ├── tauri.conf.json                    # Tauri config: window, permissions, sidecar, updater
│   ├── capabilities/
│   │   └── default.json                   # Tauri permissions (fs, dialog, shell, http, updater)
│   ├── src/
│   │   ├── main.rs                        # Tauri app entry, sidecar lifecycle management
│   │   └── lib.rs                         # Tauri commands (file dialogs, sidecar health check)
│   ├── icons/                             # App icons (generated by tauri icon command)
│   └── sidecars/                          # PyInstaller-built backend placed here at build time
│
├── scripts/
│   ├── build-sidecar.ps1                  # Build Python backend with PyInstaller
│   ├── build-sidecar.sh                   # Linux/macOS variant
│   └── dev.ps1                            # Launch both uvicorn and vite for dev
│
├── packages/
│   └── shared/
│       ├── src/
│       │   └── constants.ts               # Zoom levels, limits, shared enums
│       └── package.json
│
├── .github/
│   └── workflows/
│       ├── test.yml                       # Lint + test (frontend + backend)
│       └── release.yml                    # Build installer + publish to GitHub Releases
│
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

---

## 4. API Endpoint Design

Base URL: `http://localhost:8000/api` (local sidecar, never exposed to network)

### 4.1 Document Operations

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/documents/open` | `{ file_path: "C:/..." }` | `{ session_id, page_count, file_size }` | Backend reads file directly from disk |
| POST | `/api/documents/save` | `{ session_id }` | `{ success, file_path }` | Saves current state to original path |
| POST | `/api/documents/save-as` | `{ session_id, file_path }` | `{ success, file_path }` | Saves to new path |
| GET | `/api/documents/{sid}` | -- | `{ session_id, file_path, pages, size, versions }` | Session metadata |
| POST | `/api/documents/{sid}/close` | -- | `{ success }` | Clean up session temp files |
| POST | `/api/documents/{sid}/undo` | -- | `{ version, page_count }` | Undo last operation |
| POST | `/api/documents/{sid}/redo` | -- | `{ version, page_count }` | Redo last undone operation |

### 4.2 Page Operations

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/pages/{sid}/rotate` | `{ pages: [1,3], degrees: 90 }` | `{ success, page_count }` |
| POST | `/api/pages/{sid}/delete` | `{ pages: [2,5] }` | `{ success, page_count }` |
| POST | `/api/pages/{sid}/reorder` | `{ order: [3,1,2,4] }` | `{ success }` |
| POST | `/api/pages/{sid}/insert` | `{ after: 2, size: "letter" }` | `{ success, page_count }` |
| POST | `/api/pages/{sid}/crop` | `{ pages: [1], box: {x,y,w,h} }` | `{ success }` |
| GET | `/api/pages/{sid}/{page}/thumbnail` | query: `?width=200` | image/png |

### 4.3 Merge / Split

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/merge` | `{ file_paths: ["C:/a.pdf", "C:/b.pdf"] }` | `{ session_id, page_count }` |
| POST | `/api/split/{sid}` | `{ ranges: ["1-3","4-6"], output_dir: "C:/..." }` | `{ files: [{ file_path, pages }] }` |

### 4.4 OCR (SSE Streaming)

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/ocr/{sid}` | `{ pages: [1,2,3], language: "eng" }` | SSE stream: `{ page, progress, words, confidence }` per page |
| GET | `/api/ocr/{sid}/results` | -- | `{ pages: { 1: { words, lines, fullText } } }` |

> **Note:** Since the backend runs locally with no timeout, OCR uses real-time SSE streaming. The frontend receives per-page progress events as they complete. No polling or job queue needed.

### 4.5 Forensic Redaction

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/redaction/{sid}/search` | `{ patterns: ["ssn","email"] }` | `{ matches: [{ page, pattern, text, rects }] }` |
| POST | `/api/redaction/{sid}/apply` | `{ regions: [{ page, x, y, w, h }] }` | `{ success, redacted_count }` |

### 4.6 Text

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/text/{sid}/extract` | query: `?pages=1-5` | `{ pages: { 1: "text..." } }` |
| GET | `/api/text/{sid}/search` | query: `?q=term` | `{ matches: [{ page, positions }] }` |
| POST | `/api/text/{sid}/edit` | `{ page, edits: [{region,text,font,size,color}] }` | `{ success }` |

### 4.7 Bates / Headers / Exhibits

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/bates/{sid}` | `{ prefix, start_num, position, font, font_size }` | `{ success }` |
| POST | `/api/headers/{sid}` | `{ header, footer, font, font_size, pages }` | `{ success }` |
| POST | `/api/exhibits/{sid}` | `{ format, start_num, position }` | `{ success }` |

### 4.8 Export

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/export/{sid}` | `{ annotations: {page: fabricJSON}, output_path, options }` | `{ success, file_path }` |
| POST | `/api/export/{sid}/images` | `{ pages: [1,2], format: "png", dpi: 300, output_dir }` | `{ files: [{ page, file_path }] }` |

### 4.9 Document Comparison

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/compare` | `{ file_path_1: "C:/a.pdf", file_path_2: "C:/b.pdf" }` | `{ changes: [{ page, type, regions }], summary }` |

### 4.10 Security

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/security/{sid}/encrypt` | `{ user_password, owner_password, permissions }` | `{ success }` |
| GET | `/api/security/{sid}/metadata` | -- | `{ title, author, ... }` |
| POST | `/api/security/{sid}/metadata` | `{ title, author, ... }` | `{ success }` |
| POST | `/api/security/{sid}/sanitize` | -- | `{ success, report }` |

### 4.11 Forms

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/forms/{sid}/fields` | -- | `{ fields: [{ name, type, page, rect }] }` |
| POST | `/api/forms/{sid}/fill` | `{ fields: { name: value } }` | `{ success }` |
| POST | `/api/forms/{sid}/flatten` | -- | `{ success }` |
| GET | `/api/forms/{sid}/export` | query: `?format=json` | form data |
| POST | `/api/forms/{sid}/import` | form data (JSON/XFDF/CSV) | `{ success }` |

### 4.12 System

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/health` | -- | `{ status: "ok", version: "2.0.0" }` |

---

## 5. Feature-by-Feature Implementation Plan

### Recommended Build Order (Bottom-Up, Parallel)

For the Windows app, start at the lowest-dependency layer and move upward. Tasks within the same layer are the ones we should run in parallel.

| Layer | Start Here Because | Tasks in This Layer | Safe Parallel Lanes | Exit Criteria |
|---|---|---|---|---|
| 1. Native shell + packaging foundation | Every other task depends on the app booting locally and launching the sidecar reliably | `src-tauri/` scaffold, sidecar spawn/health check, `tauri.conf.json`, PyInstaller spec, `scripts/build-sidecar.ps1`, initial GitHub Actions release skeleton | Rust/Tauri shell, Python bundling, React/Vite scaffold | `pnpm tauri dev` opens the window, starts the sidecar, and passes a health check |
| 2. Local file I/O + sessions | The Windows app is local-first, so open/save/session plumbing must exist before feature work can land cleanly | Tauri open/save/save-as dialogs, `%APPDATA%/mudbrick/sessions/` layout, in-memory active session registry, open/save/save-as routers, metadata/version storage | Backend session manager + routers, frontend Tauri bridge + typed API client | Open a PDF from disk, create a session, save, save as, and restore working files locally |
| 3. Viewer shell | The viewer is the base surface that nearly every feature plugs into | PDF.js render path, zoom controls, thumbnails, navigation, drag-and-drop, keyboard shortcuts, dark mode | Viewer UI, thumbnail endpoint, desktop file-drop handling | Large PDFs render correctly, navigation is fast, and desktop file loading feels native |
| 4. Annotation + export core | This is the first feature-complete value slice for the desktop app | Fabric.js canvas, annotation store, property panel, export dialog, backend annotation renderer, export route | Frontend annotation tools, backend PyMuPDF renderer spike | Users can annotate and export a valid PDF with those annotations embedded |
| 5. Document mutation workflows | These features depend on sessions, viewer state, and export/save semantics already existing | Rotate/delete/reorder, merge, split, document undo/redo, save/save-as integration polish | Page ops API, merge/split API, frontend dialogs/history UI | Core document editing works on 100MB files without breaking session history |
| 6. OCR, text, and forensic features | These are heavier capabilities that build on the stable local shell and document pipeline | `pytesseract` sidecar bundle, `/api/ocr/{sid}` SSE, correction mode, text extract/search/edit, forensic redaction engine and UI | OCR engine + SSE transport, redaction engine, frontend OCR/redaction panels | Long-running operations stream progress and complete reliably inside the desktop app |
| 6.5. Pre-7 quality gate | Release/update work should only start once the app is already trustworthy, regression-tested, and button-complete for the core workflow | Strict regression pass, TDD coverage audit, button-by-button functional test matrix, crash/recovery validation, performance baseline, installer readiness checklist | Frontend test hardening, backend test hardening, manual QA matrix, performance validation | Phase 1-3 functionality is proven stable enough that Stage 7 is packaging work, not bug discovery |
| 7. Release, update, and polish | Ship only after the app and sidecar are stable enough to package and update safely | `.msi`/`.exe` release workflow, Tauri updater wiring, accessibility, onboarding, recent files, final QA | CI/release automation, updater UX, QA/accessibility pass | Installer builds cleanly, updates work, and the Windows app is ready for team rollout |

### Phase 1: MVP Core (Weeks 1-6)

| Week | Feature | Frontend Work | Backend Work | Notes |
|---|---|---|---|---|
| 1 | Project scaffolding | Vite + React + TypeScript + Tauri setup, pnpm workspace | FastAPI scaffold, uvicorn, PyMuPDF, health endpoint | `pnpm tauri dev` launches both frontend and backend |
| 1 | Tauri sidecar setup | Tauri config for Python sidecar, sidecar health check | -- | Tauri spawns uvicorn on app launch, kills on exit |
| 1 | File open | WelcomeScreen, Tauri file dialog integration | `/api/documents/open` reads file from disk | Test with 100MB file immediately |
| 2 | PDF viewing | PdfViewer, PageCanvas, PDF.js integration, ZoomControls | `/api/pages/{sid}/{page}/thumbnail` | 17 zoom levels, fit-to-page/width, HiDPI |
| 2 | Navigation | ThumbnailSidebar, PageList, page navigation | -- | Keyboard: PgUp/PgDn, Home/End |
| 3 | Annotations (part 1) | AnnotationCanvas (Fabric.js), DrawTool, HighlightTool, TextTool | -- | All client-side, Fabric.js 6 |
| 3 | Annotations (part 2) | ShapeTool, StampTool, RedactTool (visual), PropertyPanel | -- | Color, stroke, opacity, font controls |
| 4 | Page operations | ThumbnailSidebar drag-to-reorder UI | `/api/pages/{sid}/rotate,delete,reorder,insert` | Direct filesystem ops, no upload cycle |
| 4 | Merge | Merge UI (Tauri multi-file dialog) | `/api/merge` | Reads files directly from disk |
| 5 | Export | Export dialog, Tauri save dialog | `/api/export/{sid}` + annotation_renderer.py | CRITICAL: Fabric.js JSON to PyMuPDF |
| 5 | Save / Save As | Ctrl+S save, Ctrl+Shift+S save-as with Tauri dialog | `/api/documents/save`, `/api/documents/save-as` | Writes directly to disk |
| 5 | Auto-save | useAutoSave hook, IndexedDB for annotations | -- | 60s interval, annotation crash recovery |
| 5 | Undo/redo (annotations) | useUndoRedo hook, Fabric.js history | -- | Per-page annotation history |
| 6 | Undo/redo (document) | API integration for doc undo | Local temp dir versioning | 20+ levels, no storage limits |
| 6 | Dark mode | CSS custom properties, useDarkMode hook | -- | Port existing CSS variables |
| 6 | Keyboard shortcuts | useKeyboardShortcuts hook | -- | Port from keyboard-shortcuts.js |
| 6 | Drag-and-drop | DropZone + Tauri file drop events | -- | PDF + image support |
| 6 | **MVP QA + polish** | Bug fixes, performance testing | Load testing with 100MB files | **GATE: MVP must pass acceptance criteria** |

### Phase 2: Core Upgrades (Weeks 7-12)

| Week | Feature | Frontend Work | Backend Work |
|---|---|---|---|
| 7 | Forensic redaction | RedactionPanel, RedactionReview, visual preview | `/api/redaction/{sid}/search,apply` + redaction_engine.py |
| 8 | Redaction patterns | Pattern selector UI, match highlighting | SSN, email, phone, date, credit card, custom regex |
| 9 | OCR | OcrPanel, SSE progress bar, result display | `/api/ocr/{sid}` SSE streaming + ocr_engine.py + pytesseract |
| 10 | OCR correction mode | CorrectionMode component, word-level editor | OCR results with confidence scores |
| 11 | Find/search | FindBar, SearchHighlights | `/api/text/{sid}/search,extract` |
| 11 | Text editing | TextEditMode, TextEditToolbar, ColorSampler | `/api/text/{sid}/edit` |
| 12 | Split PDF | Split UI (page range selector, Tauri save dialog) | `/api/split/{sid}` |
| 12 | **Phase 2 QA** | Integration testing | Forensic redaction verification |

### Phase 3: Legal Features (Weeks 13-16)

| Week | Feature | Frontend Work | Backend Work |
|---|---|---|---|
| 13 | Bates numbering | Bates dialog, preview | `/api/bates/{sid}` |
| 13 | Headers/footers | Header/footer dialog, preview | `/api/headers/{sid}` |
| 14 | Exhibit stamps | Exhibit stamp dialog, format options | `/api/exhibits/{sid}` |
| 14 | Page labels | Page label editor | PyMuPDF page label support |
| 15 | Digital signatures | SignatureModal, SignatureStamp | Signature embedding in export |
| 15 | Form field detection | FormOverlay | `/api/forms/{sid}/fields` |
| 16 | Form filling + creation | FormFieldEditor, FormDataPanel | `/api/forms/{sid}/fill,flatten,export,import` |
| 16 | **Phase 3 QA** | Feature testing | -- |

### Pre-7 Quality Gate: Strict Precheck (Required Before Stage 7)

This is a hard gate between Stage 6 and Stage 7. We do **not** start installer, updater, onboarding, or release rollout work until this gate passes. The goal is to make Stage 7 about packaging and rollout confidence, not about discovering broken core behavior late.

#### Purpose

- Prove that the desktop app already works for the real Novo Legal workflow before we start distributing it
- Catch regressions before packaging hides them behind installer/update complexity
- Force a **test-first / TDD** workflow so tests lead implementation rather than trail it
- Verify that every major button, shortcut, dialog, and document mutation path works end-to-end

#### TDD Rule (Mandatory)

For all remaining feature work before Stage 7:
- Write or update the failing test first
- Implement the minimum code needed to make the test pass
- Refactor only after the test is green
- No feature PR is complete without automated tests plus a matching manual verification note
- No "we'll add tests later" exceptions for core flows

#### Required Test Layers

| Layer | Scope | Required Before Stage 7 |
|---|---|---|
| Unit tests | Pure utilities, reducers/stores, formatting, page math, token replacement, request/response validation | Must exist for all critical utility modules and state transitions |
| Component tests | Buttons, dialogs, toolbars, welcome screen, recent files, OCR controls, redaction review, save flows | Must cover visible UI behavior, not just render snapshots |
| Integration tests | Frontend API client + backend routers + session/version flows | Must cover open, save, save-as, export, rotate, delete, reorder, merge, split, OCR request flow |
| Golden/output tests | Exported PDFs, redaction output, annotation flattening, OCR text payloads | Must compare output against known-good fixtures for core operations |
| Manual QA matrix | Button-by-button and shortcut-by-shortcut verification on Windows | Must be completed and signed off before Stage 7 begins |
| Performance checks | 100MB open, page navigation, export, page ops, OCR startup, session recovery | Must be measured and written down, not estimated |

#### Button-and-Flow Precheck Matrix

Every user-facing control in completed phases must be checked explicitly:
- Welcome screen: open button, drag-and-drop, recent files open/remove
- Toolbar and shortcuts: `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`, navigation, zoom controls, dark mode
- Document flows: open, close, save, save as, undo, redo, crash recovery restore
- Page operations: rotate, delete, reorder, insert, merge, split
- Annotation flows: draw, highlight, text, shapes, stamps, cover/redact, property changes, export visibility
- OCR flows: start OCR, receive SSE progress, review results, correction mode save path
- Text/redaction flows: search, edit, pattern search, review, apply redaction, verify unrecoverable output
- Legal tools from Phase 3: Bates, headers/footers, exhibits, page labels, signatures, forms

If a button exists in the UI, it must have:
- An automated test where practical
- A manual QA row in the matrix
- A recorded expected result

#### Entry Criteria for Pre-7 Gate

Stage 7 work cannot begin until all of the following are true:
- Phase 1, 2, and 3 planned functionality is implemented
- Backend sidecar starts reliably in local desktop runs
- The document session/version system is stable under repeated edits
- The export path is already trusted for real documents
- There is a runnable automated test suite for both frontend and backend
- QA fixtures exist for small, medium, and 100MB-class PDFs

#### Exit Criteria for Pre-7 Gate

Stage 7 may begin only when all of the following are true:
- All completed features have automated coverage at the right layer
- Critical regressions are zero; medium issues are triaged and accepted explicitly
- Manual QA matrix is complete on Windows 10 and Windows 11
- Crash recovery has been tested by forced app termination
- Save, save-as, export, and reopen round-trips are verified
- OCR, redaction, and annotation export outputs match expected fixtures
- Performance baseline is documented and acceptable
- CI is green on lint, frontend tests, backend tests, and smoke checks

#### Stop-Ship Bugs for This Gate

Any one of these blocks Stage 7 entirely:
- Any document open/save/export corruption issue
- Any unrecoverable crash in core flows
- Any redaction bug where content remains recoverable
- Any OCR job that hangs without completion/error feedback
- Any broken undo/redo or version rollback behavior
- Any major button in completed phases that does nothing or produces the wrong document state
- Any failed crash recovery on unsaved work

#### Deliverables

Before Stage 7 starts, the team must produce:
- A completed automated test inventory by module and feature
- A manual QA matrix with pass/fail and notes
- A regression fixture set for PDFs and expected outputs
- A performance baseline report for the core desktop flows
- A short "Stage 7 approved" sign-off note naming remaining known issues

### Phase 4: Polish and Parity (Weeks 17-20)

| Week | Feature | Frontend Work | Backend Work |
|---|---|---|---|
| 17 | Document comparison | Comparison viewer (side-by-side) | `/api/compare` + comparison_engine.py |
| 17 | Comment/annotation reports | Export dialog (text/JSON/CSV) | Report generation |
| 18 | Encryption/metadata | Security panel | `/api/security/{sid}/*` |
| 18 | Windows installer + auto-updater | Tauri bundler config, update check UI | -- |
| 19 | Accessibility | SkipLink, FocusTrap, Announcer, ARIA, focus management | -- |
| 19 | Onboarding tooltips | Tooltip system, first-run detection | -- |
| 20 | Recent files | Recent files panel (app data storage) | -- |
| 20 | Export to images | Image export dialog | `/api/export/{sid}/images` |
| 20 | **Final QA + acceptance testing** | Full feature parity checklist | Performance + load testing |

---

## 6. Deployment Strategy

### Building the Application

The build process creates a single Windows installer containing:
1. The Tauri shell (native .exe, ~5MB)
2. The React frontend (built by Vite, ~3MB)
3. The Python sidecar (PyInstaller-bundled, ~80-120MB including PyMuPDF, Tesseract, Pillow)

### PyInstaller Sidecar Build

```powershell
# scripts/build-sidecar.ps1
cd apps/api
python -m PyInstaller --onedir --name mudbrick-api `
    --add-data "../../tesseract;tesseract" `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.lifespan.on `
    --hidden-import uvicorn.protocols.http.auto `
    app/main.py

# Output: apps/api/dist/mudbrick-api/
# Copy to src-tauri/sidecars/mudbrick-api-x86_64-pc-windows-msvc/
```

### Tauri Sidecar Configuration

```json
// src-tauri/tauri.conf.json (relevant sections)
{
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "icon": ["icons/icon.ico"],
    "windows": {
      "certificateThumbprint": null,
      "timestampUrl": ""
    }
  },
  "plugins": {
    "shell": {
      "sidecar": true
    },
    "updater": {
      "endpoints": [
        "https://github.com/user/mudbrick/releases/latest/download/latest.json"
      ]
    }
  },
  "app": {
    "windows": [
      {
        "title": "Mudbrick",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600
      }
    ]
  }
}
```

### Sidecar Lifecycle (Rust)

```rust
// src-tauri/src/main.rs (simplified)
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Spawn Python sidecar on app start
            let sidecar = app.shell()
                .sidecar("mudbrick-api")
                .expect("failed to find sidecar binary");

            let (mut rx, child) = sidecar.spawn()
                .expect("failed to spawn sidecar");

            // Store child handle for cleanup
            app.manage(child);

            // Wait for health check before showing window
            tauri::async_runtime::spawn(async move {
                wait_for_backend_ready().await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
```

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/release.yml
name: Build and Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - uses: dtolnay/rust-toolchain@stable

      # Build Python sidecar
      - run: pip install -r apps/api/requirements.txt pyinstaller
      - run: powershell scripts/build-sidecar.ps1

      # Build Tauri app (includes frontend build)
      - run: pnpm install --frozen-lockfile
      - run: pnpm tauri build

      # Upload installer to GitHub Release
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            src-tauri/target/release/bundle/msi/*.msi
            src-tauri/target/release/bundle/nsis/*.exe
```

### Auto-Update

Tauri's built-in updater checks a JSON endpoint on app launch:

```json
// Published alongside each release at GitHub Releases
{
  "version": "2.1.0",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-04-15T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/user/mudbrick/releases/download/v2.1.0/Mudbrick_2.1.0_x64-setup.nsis.zip"
    }
  }
}
```

### Distribution
- **Primary:** GitHub Releases (.msi and .exe installers)
- **Optional:** Direct download from mudbrick.app (static page with download link)
- **Auto-update:** Built into the app, checks GitHub on launch

---

## 7. How 100MB+ Files Are Handled

### Opening Files
1. User clicks "Open" or drops file → Tauri file dialog returns local file path
2. Frontend sends `POST /api/documents/open` with `{ file_path: "C:/path/to/file.pdf" }`
3. Backend opens file directly with PyMuPDF — **no upload, no copy, no network**
4. PyMuPDF reads the file lazily (does not load entire 100MB into memory)
5. Backend creates session: copies file to temp dir for versioning
6. Returns page count, dimensions, metadata

### Processing
- PyMuPDF operates directly on local files — disk I/O only
- No download-process-upload cycle
- No timeout constraints — operations run until complete
- Memory footprint: PyMuPDF uses ~150-300MB for a 100MB PDF (lazy page loading)
- Total system memory available: user's full RAM (not capped at 3GB like serverless)

### Saving
- `Ctrl+S` → backend writes modified PDF back to original path
- `Ctrl+Shift+S` → Tauri save dialog → backend writes to new path
- Direct filesystem write — no streaming through HTTP body

### Version History (Undo/Redo)
- Stored in local temp directory: `%APPDATA%/mudbrick/sessions/{sid}/`
- Each version is a copy of the PDF: `versions/v1.pdf`, `v2.pdf`, etc.
- In-memory metadata tracks current version, operation history
- 50+ undo levels (limited only by disk space, not RAM)
- Temp files cleaned up on session close and on app exit
- Stale sessions (older than 7 days) cleaned up on app launch

### OCR
- Runs locally with full Tesseract — no timeout, no page-by-page workaround
- SSE stream sends real-time progress: `{ page: 3, total: 50, confidence: 0.94 }`
- Can OCR 500+ pages in one operation
- Tesseract bundled with the app via PyInstaller — no user install needed

---

## 8. Development

### Prerequisites
- Node.js 20+, pnpm 9+
- Python 3.12+
- Rust toolchain (for Tauri compilation)
- Tesseract 5 (`choco install tesseract`)
- Microsoft Visual C++ Build Tools (for Tauri/Rust on Windows)

### Running in Development

```powershell
# One command launches everything:
pnpm tauri dev
```

This runs:
1. Vite dev server for the React frontend (hot reload)
2. Tauri native window pointing at Vite's dev server
3. Python backend started by Tauri as sidecar (or manually via uvicorn for faster iteration)

For faster backend iteration, run uvicorn separately:

```powershell
# Terminal 1: Backend with auto-reload
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend + Tauri shell
pnpm tauri dev
```

Vite config proxies `/api` calls to `localhost:8000`:

```typescript
// apps/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
```

There is only one environment. Dev and production use the same local architecture — the only difference is that production bundles the Python runtime via PyInstaller instead of using your system Python.

---

## 9. Development Quality Policy

### Test-First Rule

Mudbrick v2 should follow test-driven development by default:
- Write the failing test first for new behavior or a reproduced bug
- Implement the narrowest change that makes the test pass
- Refactor after green, not before green
- Keep bug-fix tests permanently so regressions stay covered

### Pull Request Expectations

Every feature PR should include:
- What behavior changed
- Which failing test was added first
- Which automated layers were updated: unit, component, integration, output fixture
- Which manual QA steps were run
- Any remaining risks or intentionally deferred coverage

### CI Gate Policy

At minimum, CI must block merges when any of these fail:
- Lint
- Frontend unit/component tests
- Backend tests
- Core smoke tests for open, save, export, and session lifecycle
- Release smoke validation once Stage 7 starts

---

## 10. Risk Mitigation

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|
| 1 | Fabric.js JSON to PyMuPDF rendering fidelity | Medium | Critical | Week 5 spike: build annotation_renderer.py, test all 8 annotation types against v1 output. If fidelity is insufficient, keep annotation flattening client-side via pdf-lib. | 1 |
| 2 | PyInstaller bundle size | Medium | Medium | PyMuPDF (~15MB) + Tesseract (~30MB) + Python runtime (~40MB) + deps = ~100-120MB. Acceptable for a desktop app. Use `--onedir` mode, not `--onefile`, for faster startup. Test Week 1. | 1 |
| 3 | Tauri + Python sidecar integration | Medium | High | Tauri's sidecar API is well-documented for spawning external processes. Key risk: sidecar crash recovery. Implement: health check polling from Tauri, auto-restart on crash, error dialog if restart fails. Test Week 1. | 1 |
| 4 | Windows Defender / SmartScreen blocking | High | Medium | Unsigned .exe triggers SmartScreen warning on first run ("Windows protected your PC"). Mitigate: code signing certificate (~$70-200/year) eliminates the warning. Phase 4 task. Without signing, users click "More info" → "Run anyway". | 4 |
| 5 | PyMuPDF forensic redaction completeness | Low | Critical | Test with PDF forensic tools (qpdf, pdftk) to verify no recoverable content after redaction. PyMuPDF's `Page.add_redact_annot()` + `Page.apply_redactions()` is the standard approach. | 2 |
| 6 | React + Fabric.js integration complexity | Medium | Medium | Use `useRef` for Fabric.js canvas, keep Fabric.js imperative. Do not try to make Fabric.js declarative/reactive. | 1 |
| 7 | PDF.js rendering parity with v1 | Low | Medium | Same library, same rendering. Main risk is zoom/viewport math — port directly from v1's pdf-engine.js. | 1 |
| 8 | Scope creep during rewrite | High | High | Strict phase gates. Phase 1 MVP must pass acceptance criteria before Phase 2 starts. No feature additions during a phase. | All |
| 9 | Auto-updater reliability | Medium | Medium | Tauri's built-in updater uses GitHub Releases as the update feed. Test thoroughly in Phase 4. Fallback: manual download from website. | 4 |
| 10 | PyInstaller startup time | Medium | Low | `--onedir` mode starts in 1-2s. `--onefile` mode can take 5-10s (extracts to temp). Use `--onedir`. Backend health check adds ~1s. Total app startup target: <3s. | 1 |
| 11 | Tesseract binary compatibility across Windows versions | Low | Medium | Bundle a statically-linked Tesseract 5 binary. Test on Windows 10 and 11. PyInstaller includes all DLL dependencies automatically. | 2 |
| 12 | Stage 7 starts before product stability is proven | Medium | High | Enforce the Pre-7 Quality Gate. Release work is blocked until functional, regression, and crash-recovery checks are complete. | 6.5 |

---

## 11. Session Management Details

### Local Storage Architecture

```
%APPDATA%/mudbrick/
├── sessions/
│   ├── {sid}/
│   │   ├── metadata.json              # { session_id, file_path, page_count, current_version, operations[] }
│   │   ├── current.pdf                # Working copy of the document
│   │   ├── versions/
│   │   │   ├── v1.pdf                 # Original (copy of source file)
│   │   │   ├── v2.pdf                 # After rotate page 1
│   │   │   └── v3.pdf                 # After delete page 5
│   │   ├── thumbnails/
│   │   │   ├── page_1.png
│   │   │   └── page_2.png
│   │   └── ocr_results.json           # Cached OCR results
│   └── {sid2}/
│       └── ...
├── preferences.json                    # Dark mode, recent files, window size
└── logs/
    └── mudbrick-api.log               # Backend logs for debugging
```

### Session Lifecycle

```python
# In-memory session state (app/services/session_manager.py)
import shutil, os, json
from pathlib import Path
from datetime import datetime

APPDATA = Path(os.getenv("APPDATA")) / "mudbrick"
SESSIONS_DIR = APPDATA / "sessions"
MAX_VERSIONS = 50  # Generous — disk is cheap

class SessionManager:
    def __init__(self):
        self.sessions: dict[str, dict] = {}
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

    def open_file(self, file_path: str) -> dict:
        sid = generate_session_id()
        session_dir = SESSIONS_DIR / sid
        session_dir.mkdir()
        (session_dir / "versions").mkdir()
        (session_dir / "thumbnails").mkdir()

        # Copy source file to working area
        shutil.copy2(file_path, session_dir / "current.pdf")
        shutil.copy2(file_path, session_dir / "versions" / "v1.pdf")

        meta = {
            "session_id": sid,
            "file_path": file_path,
            "current_version": 1,
            "oldest_version": 1,
            "created_at": datetime.now().isoformat(),
            "operations": [{"version": 1, "operation": "open"}]
        }
        self.sessions[sid] = meta
        self._save_metadata(sid, meta)
        return meta

    def create_version(self, sid: str, operation: str) -> int:
        meta = self.sessions[sid]
        new_v = meta["current_version"] + 1
        session_dir = SESSIONS_DIR / sid

        # Save current as new version
        shutil.copy2(
            session_dir / "current.pdf",
            session_dir / "versions" / f"v{new_v}.pdf"
        )

        # Truncate redo future
        for v in range(new_v, meta.get("max_version", 0) + 1):
            vpath = session_dir / "versions" / f"v{v}.pdf"
            if vpath.exists():
                vpath.unlink()

        # Evict old versions
        while new_v - meta["oldest_version"] >= MAX_VERSIONS:
            old = session_dir / "versions" / f"v{meta['oldest_version']}.pdf"
            if old.exists():
                old.unlink()
            meta["oldest_version"] += 1

        meta["current_version"] = new_v
        meta["max_version"] = new_v
        meta["operations"].append({"version": new_v, "operation": operation})
        self._save_metadata(sid, meta)
        return new_v

    def close_session(self, sid: str):
        session_dir = SESSIONS_DIR / sid
        if session_dir.exists():
            shutil.rmtree(session_dir)
        self.sessions.pop(sid, None)
```

### Cleanup on App Launch

```python
# Run on FastAPI startup
def cleanup_stale_sessions(max_age_days: int = 7):
    """Remove sessions older than 7 days (e.g., from a crash)."""
    now = datetime.now()
    for sid_dir in SESSIONS_DIR.iterdir():
        if not sid_dir.is_dir():
            continue
        meta_path = sid_dir / "metadata.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            created = datetime.fromisoformat(meta["created_at"])
            if (now - created).days > max_age_days:
                shutil.rmtree(sid_dir)
```

---

## 12. OCR Strategy

### Bundled Tesseract

Tesseract 5 is bundled with the PyInstaller package:
- Binary: `tesseract.exe` (~15MB)
- Language data: `eng.traineddata` (~15MB)
- Set `TESSDATA_PREFIX` at runtime to point to the bundled data directory

### SSE Streaming for Progress

Since there are no timeout constraints, OCR runs the full document in one request:

```python
# app/routers/ocr.py
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

@router.post("/api/ocr/{sid}")
async def run_ocr(sid: str, request: OcrRequest):
    async def generate():
        for page_num in request.pages:
            result = await ocr_engine.process_page(sid, page_num, request.language)
            yield {
                "event": "page_complete",
                "data": json.dumps({
                    "page": page_num,
                    "total": len(request.pages),
                    "words": len(result.words),
                    "confidence": result.avg_confidence
                })
            }
        yield {"event": "done", "data": json.dumps({"status": "complete"})}

    return EventSourceResponse(generate())
```

### Cloud OCR Fallback (Optional)

If higher accuracy is needed for specific documents, the `ocr_engine.py` interface can support a cloud API (Google Vision, AWS Textract) as an alternative engine. This would be the only feature requiring network access.

---

## 13. Migration/Cutover Strategy

### Branch Strategy
- New branch `mudbrickv2` in the existing `mudbrick` repo
- v1 code remains on `main` branch, untouched
- v2 development happens entirely on `mudbrickv2`
- If v2 succeeds, it replaces `main` after testing

### Phase 1-3: Parallel Availability
- v1 (current web app) stays live at mudbrick.app
- v2 (desktop app) distributed as .exe/.msi installer via GitHub Releases or direct download
- Novo Legal team installs v2 alongside v1, tests both for their workflows
- Bug reports and feature gaps tracked in GitHub Issues

### Phase 4: Cutover Preparation
- Feature parity checklist: every feature in v1 verified working in v2
- Performance comparison: all operations same speed or faster (they will be — no network)
- Novo Legal signs off on v2 for production use

### Cutover Day
1. v2 installer distributed to all Novo Legal team members
2. mudbrick.app updated with download link and migration notice
3. v1 web app remains accessible for 60 days as fallback
4. After 60 days with no issues, v1 is sunset

### Rollback Plan
- v1 web app is a static PWA — always deployable in minutes
- No data dependencies between v1 and v2
- Users can have both installed simultaneously

---

## 14. Cost Estimate

| Item | Cost | Notes |
|---|---|---|
| Hosting | $0/month | Desktop app, no server infrastructure |
| Code signing certificate | ~$70-200/year (optional) | Eliminates Windows SmartScreen warning. EV cert for full trust. |
| GitHub (repo + releases) | $0 | Free for public repos. Private: $4/user/month. |
| Cloud OCR API (optional) | ~$0-10/month | Only if cloud OCR fallback is used. Pay per page. |
| **Total** | **$0-17/month** | vs. v1's $0 (static hosting) |

---

## 15. Key Files to Port from v1

These files contain logic that transfers directly or with minimal modification:

| v1 File | v2 Destination | Transfer Type |
|---|---|---|
| `js/redact-patterns.js` (247 LOC) | `apps/api/app/services/redaction_engine.py` | Direct port: regex patterns + validators |
| `js/keyboard-shortcuts.js` (95 LOC) | `apps/web/src/hooks/useKeyboardShortcuts.ts` | Direct port: key mappings |
| `js/a11y.js` (187 LOC) | `apps/web/src/components/a11y/*` | Adapt to React components |
| `js/history.js` (131 LOC) | `apps/web/src/hooks/useUndoRedo.ts` | Port state machine logic |
| `js/recent-files.js` (90 LOC) | `apps/web/src/stores/sessionStore.ts` | Port to app data storage |
| `js/icons.js` (160 LOC) | `apps/web/src/components/shared/Icon.tsx` | SVG icon system as React component |
| `js/utils.js` (190 LOC) | `apps/web/src/utils/formatting.ts` | Port utility functions |
| `styles/variables.css` | `apps/web/src/styles/variables.css` | Direct copy |
| `styles/components.css` | `apps/web/src/styles/` (split into CSS Modules) | Adapt per component |
| `js/text-edit.js` lines 27-75 | `apps/web/src/utils/colorSampler.ts` | Port color sampling logic |

---

## 16. Acceptance Criteria

### Pre-7 Quality Gate (Must pass ALL before Stage 7 begins)

- [ ] All Phase 1-3 user-facing buttons and menu actions have been verified against a manual QA matrix
- [ ] Every completed core feature has automated coverage at the appropriate layer
- [ ] Frontend tests cover critical UI behavior, not only rendering
- [ ] Backend tests cover document mutation, session lifecycle, and output correctness
- [ ] Exported PDF fixtures are verified against known-good results
- [ ] Crash recovery is tested by force-closing the app during unsaved work
- [ ] Save, Save As, export, reopen, undo, and redo round-trips are verified
- [ ] OCR progress, completion, failure handling, and correction mode are verified
- [ ] Redaction output is verified unrecoverable with forensic checks
- [ ] Performance baseline exists for open, navigate, export, page ops, and OCR
- [ ] CI is green on lint, frontend tests, backend tests, and smoke checks
- [ ] Remaining known issues are explicitly triaged and accepted; none are stop-ship

### Phase 1 MVP Gate (Must pass ALL to proceed)

- [ ] App launches on Windows 10/11 in under 3 seconds
- [ ] Python sidecar starts automatically and responds to health check
- [ ] Open 100MB PDF via file dialog — loads in under 5s
- [ ] All 17 zoom levels work, fit-to-page and fit-to-width work correctly
- [ ] Page navigation (next/prev) renders in under 500ms
- [ ] All 8 annotation tools functional: select, draw, highlight, text, shapes, stamps, cover, eraser
- [ ] Annotation properties work: color, stroke width, opacity, font size, font family
- [ ] Export produces valid PDF viewable in Adobe Reader with all annotations visible
- [ ] Save (Ctrl+S) writes to original file path. Save As writes to new path.
- [ ] Page rotate, delete, reorder work on 100MB files (each under 3s)
- [ ] Merge 2+ PDFs works (combined size up to 200MB)
- [ ] Document undo/redo works for page operations (20+ levels)
- [ ] Annotation undo/redo works per-page
- [ ] Crash recovery: after simulated app crash, annotations are restored on relaunch
- [ ] Dark mode renders correctly for all UI elements
- [ ] All keyboard shortcuts from v1 work
- [ ] Drag-and-drop file loading works
- [ ] Sidecar auto-restarts if it crashes
- [ ] CI/CD pipeline green (tests pass)

### Full Parity Gate (Must pass ALL to sunset v1)

- [ ] All 26 features from feature list verified functional
- [ ] Forensic redaction: content verified unrecoverable with qpdf/pdftk
- [ ] OCR accuracy >= v1 on 10 test documents
- [ ] Accessibility: axe-core automated scan passes, manual keyboard navigation works
- [ ] Performance: all operations faster than v1 (no network overhead)
- [ ] Windows installer (.msi) builds and installs cleanly
- [ ] Clean uninstall removes app files and (optionally) app data
- [ ] Novo Legal team sign-off after 2-week parallel testing period

> **Note:** Offline support is inherent — the entire app runs locally. The only feature that could require network is an optional cloud OCR API fallback.

---

## Appendix A: Resolved Decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Deployment target | **Tauri desktop app.** Files never leave the user's machine. No cloud hosting. |
| 2 | New repo or same repo? | **Same repo, new branch.** Branch name: `mudbrickv2`. Replaces main after testing. |
| 3 | Offline requirements | **Inherent.** Desktop app is always offline. Only optional cloud OCR needs network. |
| 4 | Files leaving device | **No.** All processing is local. This was a key driver for choosing desktop over web. |
| 5 | Local development approach | **`pnpm tauri dev`** or manual `uvicorn` + `pnpm tauri dev`. Single environment. |

### Remaining Open Decisions

1. **Code signing certificate:** Purchase now ($70-200/year) or defer to Phase 4? Without it, SmartScreen warns on first install.

2. **Filevine integration scope:** Should v2 include direct document pull/push from Filevine cases? If yes, add to Phase 4 scope. This would be the only networked feature beyond optional cloud OCR.

3. **Multi-platform support:** This plan targets Windows only. macOS/Linux support via Tauri is possible in the future but deferred.

4. **Common-editor backlog beyond current scope:** See [COMMON-PDF-EDITOR-BACKLOG.md](COMMON-PDF-EDITOR-BACKLOG.md) for commonly expected PDF editor features that are not explicitly planned in Phases 1-4, plus a recommended post-parity implementation sequence.

---

## Appendix B: Architecture Decision Records

### ADR-001: Tauri Desktop Application
- **Context:** Original plan was Vercel-hosted web app with serverless Python functions. User decided files should not leave the machine, and a desktop app eliminates all cloud infrastructure complexity.
- **Decision:** Use Tauri 2.x as native desktop shell. React frontend rendered in WebView2. Python FastAPI backend runs as local sidecar process on localhost:8000.
- **Consequences:** Zero hosting costs. No timeout constraints. No upload/download cycle. Files stay local. Trade-off: users must install a desktop app instead of visiting a URL. Requires Python bundling via PyInstaller. Windows-only initially (macOS/Linux deferred).

### ADR-002: React 19 + Zustand + CSS Modules
- **Context:** Current vanilla JS has no component model, leading to a 6,566-line god-module. Need a framework for maintainability.
- **Decision:** React 19 with Zustand for state and CSS Modules for styling. No Tailwind (unnecessary churn for existing CSS variable system).
- **Consequences:** Strong ecosystem, TypeScript safety, component model prevents god-module recurrence. Same frontend code works in Tauri WebView as in any browser.

### ADR-003: Python Sidecar via PyInstaller
- **Context:** Users should not need to install Python, PyMuPDF, Tesseract, etc. separately.
- **Decision:** Bundle the entire Python backend + dependencies into a single directory using PyInstaller `--onedir` mode. Tauri launches it as a sidecar process.
- **Consequences:** ~100-120MB added to installer size. ~1-2s sidecar startup time. Self-contained — no Python install required. Tesseract OCR included in the bundle.

### ADR-004: Local Filesystem Session Storage
- **Context:** Desktop app has full filesystem access. No need for Blob storage or KV stores.
- **Decision:** Sessions stored in `%APPDATA%/mudbrick/sessions/`. Version history as PDF file copies. Metadata as JSON files. In-memory state for active sessions.
- **Consequences:** Simple, fast, unlimited storage (bounded only by disk space). 50+ undo levels trivially supported. Stale session cleanup on app launch.

### ADR-005: Fabric.js JSON as Annotation Exchange Format
- **Context:** Annotations are drawn client-side (Fabric.js) but must be embedded by the Python backend (PyMuPDF) during export.
- **Decision:** Fabric.js JSON is the canonical annotation format. Server-side `annotation_renderer.py` maps Fabric objects to PyMuPDF drawing commands.
- **Consequences:** Annotation format stays the same as v1. Server-side rendering is the highest-risk component and must be spiked in Phase 1 Week 5.

### ADR-006: SSE Streaming for Long Operations
- **Context:** No timeout constraints on local sidecar. Real-time progress feedback is better UX than polling.
- **Decision:** Long operations (OCR, large merges, document comparison) use Server-Sent Events (SSE) to stream progress to the frontend in real-time.
- **Consequences:** Better UX than polling (instant updates vs 2s granularity). Simpler code (no job queue, no KV progress storage). Standard browser EventSource API on the frontend.

### ADR-007: Windows-First, Multi-Platform Deferred
- **Context:** Novo Legal Group uses Windows. Supporting macOS/Linux adds build complexity.
- **Decision:** Target Windows 10/11 only for initial release. Tauri supports macOS/Linux, so multi-platform is architecturally possible but deferred.
- **Consequences:** Simpler CI/CD (Windows-only builds). PyInstaller bundle is Windows-specific. Tesseract binary is Windows-specific. Cross-platform can be added later by adding build targets and platform-specific sidecar bundles.
