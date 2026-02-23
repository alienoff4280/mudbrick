# Mudbrick

**Free, open-source PDF editor that runs entirely in your browser.**

No uploads. No servers. No subscriptions. Your files never leave your device.

**[Try it live at mudbrick.vercel.app](https://mudbrick.vercel.app)**

---

## Features

### View & Navigate
- High-fidelity PDF rendering (PDF.js 4.8)
- Page thumbnails, bookmarks, and outline navigation
- Keyboard shortcuts and smooth zoom (fit-width, fit-page, custom %)
- Find & replace with match highlighting
- Hand tool for panning, text selection for copy

### Annotate & Mark Up
- Freehand drawing with adjustable brush
- Highlighter, underline, and strikethrough
- Shapes (rectangles, ellipses, lines, arrows)
- Text annotations and sticky notes
- Cover/redact tool for permanently hiding content
- Stamp library (Approved, Draft, Confidential, etc.)
- Image insertion from file or clipboard

### Edit PDFs
- Edit existing text directly on the page
- Replace or delete embedded images
- Add, delete, rotate, and reorder pages
- Visual crop with aspect ratio presets
- Merge multiple PDFs via drag-and-drop
- Split documents by page range

### Legal & Professional
- Bates numbering with customizable prefix/suffix
- Headers and footers across all pages
- Electronic signatures (draw, type, or upload)
- Exhibit stamps for litigation support
- Page labels (i, ii, iii / A-1, A-2, etc.)
- Form filling and form field creation
- Redaction patterns (SSN, phone, email, dates)

### Export
- Download annotated PDF with baked-in annotations
- Redactions permanently destroy underlying content
- Export pages as images (PNG/JPEG)

### Works Offline
- Service worker caches all assets for offline use
- Works without internet after first visit
- Mobile-responsive layout for tablets and phones

---

## Tech Stack

| Layer | Library | Role |
|-------|---------|------|
| PDF rendering | [PDF.js 4.8.69](https://mozilla.github.io/pdf.js/) | Page rendering + text layer |
| PDF editing | [pdf-lib 1.17.1](https://pdf-lib.js.org/) | Structural edits, merge, export |
| Annotations | [Fabric.js 5.3.0](http://fabricjs.com/) | Canvas overlay for drawings/shapes |
| OCR | [Tesseract.js 5](https://tesseract.projectnaptha.com/) | Optional text recognition |
| UI | Vanilla HTML/CSS/JS | Zero frameworks, zero build step |
| Hosting | [Vercel](https://vercel.com) | Static deployment with COEP/COOP headers |

All libraries loaded via CDN. No npm, no bundler, no transpiler.

---

## Architecture

```
index.html            — App shell, modals, all UI markup
styles/
  variables.css       — Design tokens (colors, spacing, z-index)
  layout.css          — Grid layout, sidebar, ribbon, responsive
  components.css      — Buttons, modals, toasts, context menu
js/
  app.js              — Main orchestrator (state, events, navigation)
  pdf-engine.js       — PDF.js wrapper (render, text layer)
  annotations.js      — Fabric.js overlay (tools, per-page save/restore)
  export.js           — Bake annotations into PDF for download
  pdf-edit.js         — Structural edits via pdf-lib (add/delete/rotate pages)
  text-edit.js        — Inline text editing on PDF pages
  find.js             — Find & replace with text layer highlighting
  signatures.js       — Electronic signature capture (draw/type/upload)
  forms.js            — PDF form field detection and filling
  form-creator.js     — Create new form fields on PDF pages
  bates.js            — Bates numbering across pages
  headers.js          — Headers/footers insertion
  ocr.js              — Tesseract.js integration for scanned PDFs
  history.js          — Undo/redo state management
  icons.js            — SVG icon library (inline, no external requests)
  utils.js            — Shared utilities
  ...                 — Additional feature modules
sw.js                 — Service worker for offline caching
vercel.json           — COEP/COOP headers for SharedArrayBuffer
```

**Three-layer canvas stack:**
1. PDF.js canvas (z-index 1) — renders the PDF page
2. Text layer (z-index 2) — invisible text spans for selection/search
3. Fabric.js canvas (z-index 3) — annotation overlay

---

## Run Locally

```bash
# No build step needed — just serve the files
npx serve -l 3456 --cors -n

# Open http://localhost:3456
```

Or open `index.html` directly in a browser (some features require HTTP due to CORS).

---

## Deploy

The project deploys as a static site. Push to `main` and Vercel auto-deploys.

`vercel.json` sets required headers for `SharedArrayBuffer` (used by PDF.js):
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

---

## License

MIT

---

Built by [Novo Legal Group](https://github.com/NovoLegalGroup).
