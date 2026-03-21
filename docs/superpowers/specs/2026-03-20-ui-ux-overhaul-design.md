# MudBrick UI/UX Overhaul — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Complete visual and interaction redesign of MudBrick PDF editor

---

## Context

MudBrick is a feature-complete, client-side PDF editor (100+ features) built with vanilla JS, PDF.js, pdf-lib, Fabric.js, and Tesseract.js. The feature set rivals Adobe Acrobat Pro. The UI/UX does not.

This spec covers a ground-up redesign of every surface the user touches — visual design, layout, toolbar architecture, interaction patterns, and information architecture — while preserving the battle-tested editing engine underneath.

### Constraints

- **No framework migration.** Vanilla JS, no build step. All libraries via CDN.
- **No engine changes.** pdf-engine.js, pdf-edit.js, annotations.js, text-edit.js, export.js, forms.js, ocr.js, signatures.js, and all other feature modules remain unchanged.
- **Primary users:** Legal professionals (Novo Legal Group) launching from Filevine dashboard. Secondary users: general knowledge workers.
- **Deployment:** Static files on Vercel. PWA with service worker.

### Goals

1. Professional creative tool aesthetic that signals "Adobe Acrobat alternative"
2. Every feature discoverable within 2 clicks
3. Maximum canvas space for PDF viewing/editing
4. Smooth, snappy interactions (150ms transitions, no jank)
5. Dark mode default, light mode available, fully theme-aware

---

## 1. Visual Design System

### Color Palette

Dark theme (default):

| Token | Value | Usage |
|-------|-------|-------|
| `--mb-bg-primary` | `#09090b` (zinc-950) | App background, canvas area |
| `--mb-bg-secondary` | `#18181b` (zinc-900) | Panels, flyouts |
| `--mb-bg-elevated` | `#27272a` (zinc-800) | Buttons, inputs, active states |
| `--mb-border` | `#27272a` (zinc-800) | All borders |
| `--mb-text-primary` | `#fafafa` (zinc-50) | Primary text |
| `--mb-text-secondary` | `#a1a1aa` (zinc-400) | Secondary text, inactive icons |
| `--mb-text-muted` | `#71717a` (zinc-500) | Labels, hints |
| `--mb-text-subtle` | `#52525b` (zinc-600) | Tertiary text |
| `--mb-text-ghost` | `#3f3f46` (zinc-700) | Disabled, dividers |
| `--mb-accent` | `#ef4444` (red-500) | Brand accent, active indicators, primary buttons |
| `--mb-accent-hover` | `#dc2626` (red-600) | Accent hover state |
| `--mb-danger` | `#dc2626` (red-600) | Destructive actions — darker than accent for visual distinction |
| `--mb-success` | `#22c55e` | Success toasts |
| `--mb-warning` | `#eab308` | Warning toasts |
| `--mb-info` | `#3b82f6` | Info toasts |

Light theme (under `[data-theme="light"]`):

| Token | Value | Usage |
|-------|-------|-------|
| `--mb-bg-primary` | `#ffffff` | App background |
| `--mb-bg-secondary` | `#f4f4f5` (zinc-100) | Panels, flyouts |
| `--mb-bg-elevated` | `#e4e4e7` (zinc-200) | Buttons, inputs |
| `--mb-border` | `#e4e4e7` (zinc-200) | All borders |
| `--mb-text-primary` | `#09090b` (zinc-950) | Primary text |
| `--mb-text-secondary` | `#52525b` (zinc-600) | Secondary text |
| `--mb-text-muted` | `#71717a` (zinc-500) | Labels |
| `--mb-text-subtle` | `#a1a1aa` (zinc-400) | Tertiary |
| `--mb-text-ghost` | `#d4d4d8` (zinc-300) | Disabled |
| `--mb-accent` | `#ef4444` | Same red accent |
| Canvas background | `#f4f4f5` | Light gray instead of black |

### Typography

- **UI font:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` — no custom fonts for chrome
- **Monospace:** `ui-monospace, "SF Mono", "Cascadia Mono", monospace` — for technical display
- **Signature fonts:** Caveat, Dancing Script, Great Vibes, Sacramento — loaded on-demand only when signature modal opens
- **Scale:** 9px (labels), 10px (body), 11px (emphasized), 12px (headings), 13px (brand), 14px (hero)

### Spacing

- **Base unit:** 4px
- **Scale:** 4, 8, 12, 16, 20, 24, 32, 48
- Tight spacing throughout — professional tool density

### Border Radius

- **Buttons/interactive:** 6px
- **Inputs:** 4px
- **Panels/cards:** 8px
- **Thumbnails:** 3px
- **Full round:** 50% (color swatches, indicators)

### Shadows

- **None** on UI chrome (flat design for panels, toolbars, buttons)
- **PDF page only:** `0 4px 32px rgba(0,0,0,0.5)` in dark, `0 2px 12px rgba(0,0,0,0.08)` in light — makes the page "float"

### Animations

- **Duration:** 150ms for all transitions
- **Easing:** `ease` (CSS default)
- **Flyout panels:** slide in from left
- **Properties panel:** slide in from right
- **Toasts:** slide up from bottom-center
- **No bounces, springs, or playful motion**

### Focus States

- **Keyboard:** 2px red outline, 2px offset (`:focus-visible`)
- **Mouse:** No visible focus ring (`:focus:not(:focus-visible)`)
- **WCAG 2.1 AA compliant**

---

## 2. Layout Architecture

### App Shell Grid

```
┌──────────────────────────────────────────────────────────┐
│  TITLE BAR (36px)                                        │
│  [Logo] [File Edit View Help]    [filename] [⟲⟳] [🌙] [Export] │
├────┬────────┬────────────────────────────┬───────────────┤
│    │        │                            │               │
│ I  │ FLYOUT │       CANVAS AREA          │  PROPERTIES   │
│ C  │ PANEL  │                            │    PANEL      │
│ O  │ (180px)│    ┌──────────────┐        │   (220px)     │
│ N  │        │    │              │        │               │
│    │ Pages/ │    │   PDF PAGE   │        │  Color        │
│ R  │ Tools/ │    │              │        │  Stroke       │
│ A  │ Options│    │              │        │  Opacity      │
│ I  │        │    └──────────────┘        │  Font         │
│ L  │        │                            │  Actions      │
│    │        │   [- 100% +] [◄ 1/12 ►]   │               │
│48px│        │                            │               │
├────┴────────┴────────────────────────────┴───────────────┤
│  STATUS BAR (24px)  Page 1 of 12 • 2.4 MB    Select Tool │
└──────────────────────────────────────────────────────────┘
```

### Zone Specifications

**Title Bar (36px, fixed top):**
- Left: Brand logo ("MudBrick" — "Mud" in red, "Brick" in primary text)
- Left-center: Menu bar (File, Edit, View, Help) — text buttons, no backgrounds
- Right: Filename + file size, undo/redo buttons, theme toggle, Export button (red accent)
- Always visible. No collapse behavior.

**Icon Rail (48px, fixed left):**
- Vertical icon strip with 3 groups separated by horizontal dividers
- Group 1 — Navigation: Pages, Bookmarks, Search
- Group 2 — Tools: Select, Hand, Text, Draw, Shapes, Sign, Stamp
- Group 3 — Advanced: Forms, Redact, Security, OCR, Compare
- Bottom: Keyboard shortcuts icon
- Active tool indicator: 2px red left-border
- Icons: 36x34px hit targets, 6px border-radius
- Tooltips on hover (appearing to the right after 500ms delay)

**Flyout Panel (180px, left of canvas):**
- Opens when an icon rail item is clicked
- Closes when: same icon clicked again, X button clicked, different icon clicked (swaps), Escape key
- Pages flyout: scrollable thumbnail list, add page button at bottom
- Tool flyouts: sub-tool list with descriptions, tool-specific options
- Slide-in animation (150ms, from left)
- Only one flyout open at a time
- "Pinnable" — click pin icon to keep open while working

**Canvas Area (fluid center):**
- Background: `--mb-bg-primary` (#09090b dark, #f4f4f5 light)
- PDF page centered with drop shadow
- Floating zoom control: bottom-center, pill-shaped, `[- 100% + | Fit]`
- Floating page nav: bottom-right, pill-shaped, `[◄ 1/12 ►]`
- Both floaters: `--mb-bg-secondary` background with border, 8px radius

**Properties Panel (220px, right side):**
- Shows when annotation/object is selected
- Hides when nothing selected (unless pinned)
- **Default state:** Fill Color (swatch row), Stroke (color + width slider), Opacity (slider), Font (dropdown), Size (input + B/I/U toggles), Actions (Duplicate, Lock, Delete)
- **Contextual states** (panel content swaps based on selection type):
  - **Link selected:** URL/page type toggle, URL input, Save/Follow/Remove buttons
  - **Sticky note selected:** Note text textarea, color swatches, delete
  - **Comment thread:** Reply list, status indicator, reply input, resolve button
  - **No selection + pinned:** Document info (page count, file size, metadata summary)
- Slide-in animation (150ms, from right)
- Close button (X) in header

**Status Bar (24px, fixed bottom):**
- Left: Page count, file size
- Right: Active tool name, unsaved changes indicator
- Subtle, informational only

---

## 3. Welcome Screen

### Layout

Two-column dashboard on `--mb-bg-primary` background:

**Left column (60% width):**
- Drop zone: dashed border (`--mb-border`), 16px radius, centered content
  - PDF icon (subtle, 32px)
  - "Drop a PDF here" heading
  - "or" divider
  - "Browse Files" button (red accent)
  - Supported formats note
- Recent files list below drop zone:
  - Header: "Recent" label + "Clear" link
  - Each item: PDF icon, filename, relative timestamp ("2h ago")
  - Max 8 items
  - Click to reopen (from localStorage metadata — actual file must be re-selected)
  - Stored in localStorage

**Right column (40% width):**
- "Quick Actions" header
- 4 action cards with icon, title, and description:
  - Merge PDFs — "Combine multiple files"
  - Edit Text — "Modify PDF content"
  - Sign — "Add your signature"
  - Protect — "Encrypt or redact"
- Each card opens a file picker, then activates the corresponding tool

**Title bar during welcome:** Minimal — just brand logo and version. No menu bar (nothing to act on yet).

### Integration Mode

When launched with `?fileUrl=...`:
- Skip welcome screen entirely
- Load PDF directly from signed URL
- Show "Return to Dashboard" link in title bar when `returnUrl` present
- Save button POSTs to `callbackUrl` via multipart/form-data

### First-Time Onboarding

- No multi-step tour or wizard
- 3 contextual tooltip hints on first use:
  1. On first PDF open: callout near icon rail — "Click tools here to annotate, edit, or sign"
  2. On first annotation: callout near properties panel area — "Select any annotation to edit its properties"
  3. On first export: callout near Export button — "Your annotations are saved into the PDF"
- Each hint dismisses on click
- Max 3 hints per session
- Tracks shown hints in localStorage (`mb-hints-shown`)

---

## 4. Icon Rail Tool Organization

### Group 1: Navigation

| Icon | Label | Flyout | Keyboard |
|------|-------|--------|----------|
| Pages grid | Pages | Thumbnail list, add/delete/rotate/reorder/crop, insert blank, replace, extract, normalize page sizes | — |
| Bookmark | Bookmarks | PDF outline navigation tree (if document has bookmarks), expandable/collapsible | — |
| Magnifier | Find | Search input, case toggle, match count, prev/next, find & replace | Ctrl+F |

### Group 2: Tools

| Icon | Label | Behavior | Keyboard |
|------|-------|----------|----------|
| Arrow | Select | Direct activate (no flyout) | V |
| Hand | Hand | Direct activate — pan/scroll mode (no flyout) | H |
| T (serif) | Text | Flyout: Edit existing text, Add text annotation, Edit images (replace/delete/resize), Font/size/color | T |
| Pen | Draw | Flyout: Freehand, Highlighter, Underline, Strikethrough, Eraser + brush options | D |
| Square | Shapes | Flyout: Rectangle, Ellipse, Line, Arrow, Sticky Note, Image insert, Visual Cover (reversible, non-destructive — draws opaque rect over content) | S |
| Signature | Sign | Flyout: Draw/Type/Upload, Saved signatures list | — |
| Stamp | Stamps | Flyout: Approved, Draft, Confidential, For Review, Rejected, Expired, Custom, Exhibit | — |

### Group 3: Advanced

| Icon | Label | Flyout | Keyboard |
|------|-------|--------|----------|
| Checkbox | Forms | Flyout: Detect fields, Create fields, Fill mode, Import/export data, Flatten fields, Tab order | — |
| Block | Redact | Flyout: **Redact (permanent, destructive)** — manual redact tool, Auto-redact patterns (SSN, phone, email, dates), Preview matches. Clearly distinguished from Visual Cover in Shapes flyout. | — |
| Lock | Security | Flyout: Encrypt, Remove metadata, Sanitize, Password protect | — |
| "OCR" text | OCR | Flyout: Run OCR, Language select, Correction mode, Export text | — |
| Diff | Compare | Flyout: Open second PDF, side-by-side comparison, generate report | — |

### Menu Bar Items (not in icon rail)

- **File:** Open, Open Recent ►, Merge, Split, Save (callback), Download, Export as Images, Create PDF from Images, Optimize/Compress, Print, Close
- **Edit:** Undo, Redo, Copy, Paste, Delete, Select All, Flatten Annotations, Watermark, Preferences
- **View:** Zoom In/Out, Fit Width, Fit Page, Comments/Notes Panel, Legal Tools ► (Bates Numbering, Headers/Footers, Page Labels, Exhibit Stamps), Dark/Light Mode
- **Help:** Keyboard Shortcuts, About MudBrick, Onboarding Tour

**Notes:**
- Legal-specific tools live under **View > Legal Tools** submenu — accessible to power users without cluttering the icon rail for general users.
- **Visual Cover vs Redact:** Cover (in Shapes flyout) is a reversible Fabric.js annotation — an opaque rectangle drawn over content. Redact (in Redact flyout) permanently destroys underlying content via pdf-lib. The Redact flyout shows a prominent warning about permanence.
- **Comment Summary** is accessible via **View > Comments/Notes Panel** or by right-clicking an annotation and selecting "View Thread."
- **Export as Images** and **Create PDF from Images** live under File menu since they are document-level I/O operations.
- **Optimize/Compress** lives under File menu as a pre-export operation.

---

## 5. Interaction Patterns

### Tool Switching

- Click icon rail → activate tool, show red left-border indicator
- Click same icon → deactivate (return to Select)
- Click different icon → switch tools, swap flyout
- Keyboard shortcut → activate tool directly
- Hold Space → temporarily activate Hand tool (release to return to previous tool)
- Escape → deactivate current tool, return to Select, close any flyout

### Flyout Panels

- Slide in from left (150ms ease)
- Only one open at a time
- Close triggers: click same icon, click X, click different icon, press Escape
- Pin button in header → keeps flyout open while working on canvas
- Pages panel opens (unpinned) by default on first PDF load. Pin state persisted in localStorage — if user pins it, it stays pinned on future loads. If user closes it, it stays closed.

### Properties Panel

- Auto-shows when annotation selected (slide from right, 150ms)
- Auto-hides when deselected (unless pinned)
- Pin button in header
- Remembers pin state in localStorage

### Modals → Slide-Over Panels

Most current modals become slide-over panels from the right (240px wide):
- Export options
- Watermark settings
- Bates numbering
- Headers/footers
- Security settings
- Form field creation

True centered modals only for:
- Signature capture (needs canvas space)
- Destructive confirmations ("Delete 5 pages?")
- About/keyboard shortcuts

### Context Menus

- Right-click annotation: Duplicate, Lock/Unlock, Delete, Bring Forward, Send Back, Copy Style
- Right-click page thumbnail: Rotate, Delete, Insert Before, Insert After, Extract, Replace
- Right-click canvas (no selection): Paste, Zoom to Fit, Page Properties

### Toasts

- Bottom-center positioning
- Slide up animation (150ms)
- 4-second auto-dismiss
- Types: success (green), error (red), warning (yellow), info (blue)
- Stack up to 3 visible, older ones dismissed
- Close button on each

### Drag and Drop

- Welcome screen: visible drop zone with dashed border
- Editor mode: dropping a file shows "Merge with current document?" confirmation
- Thumbnail panel: drag to reorder pages

---

## 6. CSS Architecture

### File Structure

| File | Purpose | Estimated Lines |
|------|---------|-----------------|
| `styles/variables.css` | Complete rewrite. All design tokens, dark/light themes | ~200 |
| `styles/layout.css` | Rewrite. App shell grid, title bar, icon rail, canvas, status bar | ~400 |
| `styles/components.css` | Rewrite. Buttons, inputs, dropdowns, tooltips, toasts, sliders, color pickers | ~500 |
| `styles/panels.css` | New. Flyout panels, properties panel, slide-over panels, transitions | ~300 |
| `styles/welcome.css` | New. Welcome screen, drop zone, recent files, quick actions | ~200 |
| `styles/print.css` | Keep, minor updates | ~50 |

### Naming Convention

BEM-lite with `mb-` prefix:
- `.mb-icon-rail`
- `.mb-icon-rail__item`
- `.mb-icon-rail__item--active`
- `.mb-flyout`
- `.mb-flyout--open`
- `.mb-properties`
- `.mb-canvas-area`
- `.mb-toast`
- `.mb-toast--success`

### Rules

- Zero hardcoded colors — all `var(--mb-*)` references
- No `!important`
- Dark mode is default; light mode is `[data-theme="light"]` override
- All z-indexes defined in variables.css
- All transitions use `var(--mb-transition)` token

---

## 7. HTML Restructuring

The monolithic `index.html` (2,433 lines) is restructured:

### Key Changes

1. **Remove:** All 6 ribbon tab sections and ribbon panel markup
2. **Add:** Icon rail markup (13 icon buttons in 3 groups)
3. **Add:** Flyout panel containers (one per icon rail item, hidden by default)
4. **Convert:** Centered modals → slide-over panels where appropriate
5. **Add:** Welcome screen dashboard markup (drop zone, recent files, quick actions)
6. **Add:** Floating zoom/page-nav controls in canvas area
7. **Update:** ARIA attributes throughout (role, aria-expanded, aria-label, aria-describedby)
8. **Remove:** Dead/duplicate markup from old ribbon structure

### Target

Target ~1,800 lines (from 2,433). Net reduction from removing ribbon markup, offset by new flyout panel containers and icon rail. Modal-to-slide-over conversions restructure markup but don't dramatically reduce line count. Use `<template>` elements for modal/slide-over content where appropriate to keep the main DOM clean.

---

## 8. JS Changes

### New Module: `js/ui-controller.js` (~300 lines)

Extracted from `app.js`. Manages:
- Icon rail state (active tool indicator)
- Flyout panel open/close/swap/pin
- Properties panel show/hide/pin
- Slide-over panel open/close
- Theme toggle (dark/light)
- Welcome screen ↔ editor screen transition
- Floating controls positioning

### Updates to `app.js`

- Remove ribbon tab switching logic
- Replace ribbon button selectors with icon rail / flyout panel selectors
- Wire tool activation through `ui-controller.js`
- Keep all existing tool logic, state management, PDF loading, annotation handling

### Unchanged Modules

All 35+ feature modules remain untouched:
- `pdf-engine.js`, `pdf-edit.js`, `annotations.js`, `text-edit.js`
- `export.js`, `forms.js`, `form-creator.js`, `ocr.js`
- `signatures.js`, `find.js`, `bates.js`, `headers.js`
- `page-labels.js`, `exhibit-stamps.js`, `security.js`
- `redact-patterns.js`, `doc-compare.js`, `doc-history.js`
- `comments.js`, `comment-summary.js`, `export-image.js`
- `links.js`, `icons.js`, `history.js`, `utils.js`
- `error-handler.js`, `keyboard-shortcuts.js`, `recent-files.js`
- `menu-actions.js`, `font-manager.js`, `a11y.js`
- `onboarding.js`, `integration.js`

---

## 9. Migration Strategy

### Phase Approach

The redesign can be implemented in 3 phases, each producing a working app:

**Phase A — Visual Foundation:**
- **Step 1 (FIRST):** Rewrite `variables.css` with new design tokens. Dark theme as `:root` default, light theme as `[data-theme="light"]` override. This inverts the current architecture where light is default. Must be done before any other CSS or HTML changes to avoid color inversion flash.
- **Step 2:** Update `index.html` `<html>` tag to `data-theme="dark"` (or remove theme attribute since dark is now the default)
- **Step 3:** Rewrite `layout.css` for new app shell grid
- **Step 4:** Rewrite `components.css` for new component styles
- **Step 5:** Create `welcome.css` for new welcome screen
- **Step 6:** Update `index.html` for new layout structure (title bar, icon rail, canvas area, status bar). Remove ribbon markup.
- **Step 7:** Move eager Google Font `<link>` tags from `<head>` to dynamic JS loading in `signatures.js` (load on-demand when signature modal opens)
- Result: New visual design, but tools still wired to temporary locations

**Phase B — Tool Architecture:**
- Create `panels.css` for flyout and properties panels
- Add flyout panel markup to `index.html`
- Create `ui-controller.js` for panel management
- Wire icon rail → flyout → tool activation
- Wire properties panel to annotation selection
- Convert modals to slide-over panels
- Result: Full new interaction model working

**Phase C — Polish:**
- Welcome screen dashboard (drop zone, recent files, quick actions)
- Floating zoom/page nav controls
- Context menus
- Tooltip system
- Onboarding hints
- Keyboard shortcut updates
- Final accessibility audit
- Light mode verification
- Result: Ship-ready

---

## 10. Success Criteria

1. **Every feature** accessible within 2 clicks from the icon rail
2. **Zero visual regressions** — all 100+ features still work
3. **WCAG 2.1 AA** compliance maintained
4. **< 150ms** for all UI transitions
5. **Dark and light modes** both fully functional
6. **Integration mode** still works (fileUrl, callbackUrl, returnUrl)
7. **All 603 tests** still pass
8. **PWA** still works offline
9. **index.html** under ~1,800 lines
10. **No hardcoded colors** in CSS — all design tokens
