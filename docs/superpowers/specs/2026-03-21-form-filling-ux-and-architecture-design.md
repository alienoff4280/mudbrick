# Form Filling UX & Architecture Improvements

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Smart form filling for USCIS immigration forms + app.js decomposition

---

## Problem

Paralegals at Novo Legal Group use MudBrick daily to fill USCIS immigration forms (I-130, I-485, I-765, etc.) and review pre-filled PDFs from the dashboard. Two pain points:

1. **Repetitive data entry** — The same petitioner/beneficiary info (name, DOB, A-number, address) appears across multiple pages and multiple forms in a case. Paralegals retype it every time.
2. **Formatting confusion** — Date formats (mm/dd/yyyy), phone numbers, SSNs, and mutually exclusive checkboxes cause errors and slowdowns.

Additionally, `app.js` is a 6,400-line monolith that's increasingly hard to maintain and debug.

## Solution

Two workstreams, designed to be implemented sequentially:

1. **Form Intelligence** — Smart field labels, profile-based auto-fill, format masks, and progress tracking for USCIS forms. Toggle-able per session.
2. **Architecture** — Decompose `app.js` into focused modules to improve maintainability.

---

## 1. Field Mapping System

Each supported USCIS form gets a JSON mapping file in a `forms/` directory:

```
forms/
  i-130.json
  i-485.json
  i-765.json
  ...
```

### Mapping File Schema

```json
{
  "formId": "i-130",
  "formTitle": "Petition for Alien Relative",
  "fields": {
    "<xfa-field-name>": {
      "label": "Human-readable label",
      "section": "Part 2. Information About You",
      "page": 2,
      "type": "text | date | phone | ssn | a-number | zip | checkbox | radio | dropdown",
      "format": "mm/dd/yyyy",
      "role": "petitioner.familyName",
      "exclusive": false,
      "options": ["Option A", "Option B"]
    }
  }
}
```

### Key Properties

| Property | Purpose |
|----------|---------|
| `label` | Shown as placeholder and tooltip instead of XFA name |
| `role` | Links to profile data path for auto-fill (e.g., `petitioner.familyName`, `beneficiary.address.city`). `null` for non-auto-fill fields |
| `format` | Input mask type: `mm/dd/yyyy`, `phone`, `ssn`, `a-number`, `zip` |
| `section` | Groups fields for the progress indicator |
| `exclusive` | When `true`, checking this box unchecks others in the same group |
| `options` | For radio/dropdown fields, the list of valid values |

### Form Identification

When a PDF is loaded, match it to a mapping file by:
1. Checking the PDF filename against known patterns (e.g., contains "i-130")
2. Checking PDF title metadata
3. Falls back to generic labels (current XFA name behavior) if no match

---

## 2. Profile Data & Auto-Fill

### Profile Schema

```json
{
  "petitioner": {
    "familyName": "",
    "givenName": "",
    "middleName": "",
    "dateOfBirth": "",
    "aNumber": "",
    "uscisAccountNumber": "",
    "ssn": "",
    "sex": "",
    "address": {
      "street": "",
      "apt": "",
      "city": "",
      "state": "",
      "zip": "",
      "province": "",
      "postalCode": "",
      "country": ""
    },
    "phone": "",
    "email": ""
  },
  "beneficiary": {
    "familyName": "",
    "givenName": "",
    ...
  }
}
```

### Three Population Methods

1. **Manual entry** — A "Fill Profile" flyout panel on the icon rail (person icon). Simple form with petitioner/beneficiary sections. Stored in `sessionStorage` (no PII persisted to disk).

2. **Dashboard integration** — New URL param `?profileData=<base64-encoded-json>`. The integration module decodes it and populates the profile automatically on launch. **PII safety**: Immediately after parsing, strip `profileData` from the URL using `history.replaceState()` so it does not persist in browser history, Vercel access logs, or referrer headers. Base64 is encoding, not encryption — this mitigation prevents casual exposure. For higher-security needs, a future iteration can use `postMessage` from a parent iframe instead.

3. **Extract from PDF** — A "Learn Profile" button scans current form field values (using the mapping's `role` properties) and populates the profile from them. Enables carrying data from a pre-filled I-130 to the next form (I-485, I-765) without retyping.

### Auto-Fill Mechanics

- When a profile loads, iterate the field mapping and set values for any field whose `role` matches a profile path
- **Pre-fill detection**: Check the field descriptor's original `.value` property (set during `detectFormFieldsPdfJs` or `detectFormFields`) — NOT `formFieldValues` (which is empty at auto-fill time). A field is "pre-filled" if `descriptor.value` is non-empty. Pre-filled fields are never overwritten by auto-fill.
- Toast: "Auto-filled 34 of 48 fields" with an undo option
- Auto-filled fields get a subtle green left-border to distinguish them from manually filled or pre-filled values

---

## 3. Format Validation & Input Masks

New module: `js/field-format.js` (~200 lines). Exports `applyFormatting(inputElement, formatSpec)`.

| Format | Behavior |
|--------|----------|
| `mm/dd/yyyy` | Auto-inserts `/` separators. Red border + tooltip on invalid date. Placeholder shows `MM/DD/YYYY` |
| `phone` | Auto-formats as `(213) 555-0100`. Strips non-numeric on paste |
| `ssn` | Auto-formats as `XXX-XX-XXXX`. Masks to `***-**-6789` after blur |
| `a-number` | 9-digit numeric. Strips leading `A-` prefix if pasted |
| `zip` | Accepts 5-digit or 9-digit (`XXXXX-XXXX`) |
| `exclusive: true` | Checking one box unchecks others in the same group |

All formatting via `input` event listeners. No external libraries.

---

## 4. Form Progress Indicator

### Location

Bottom of the PAGES flyout panel, below thumbnail list. Collapsible section titled "Form Progress".

### What It Shows

- **Overall bar**: "32 of 48 fields filled" with percentage
- **Per-section breakdown**: One line per section from the mapping (e.g., "Part 1. Relationship ✓", "Part 2. Information About You — 8 of 15")
- **Click to navigate**: Clicking a section scrolls to that section's first empty field on the correct page
- **Empty field links**: Expand a section to see clickable individual empty fields ("Date of Birth (p.2)")

### Visual Treatment

- Green fill for completion bar
- Checkmark for completed sections
- Muted count text for incomplete sections
- Compact — one line per section

### Updates

Live — as fields are filled, progress updates immediately via existing `input` event listeners.

### Fallback

No mapping file match → progress panel does not appear.

---

## 5. Toggle System

### Automatic Activation

Form intelligence activates automatically when a mapping file matches the loaded PDF. No match → editor behaves as it does today.

### Manual Override

View menu → "Form Assistant" toggle with checkmark:
- Defaults ON when a mapping is detected
- Can be turned OFF to annotate without overlays
- Can be turned ON for unmapped forms to get generic format hints

**Checkmark menu rendering**: The existing `openDropdown` renderer does not support checkmark-state items. Add a `checked: () => bool` function property to the menu item schema. `openDropdown` renders a `✓` prefix when `checked()` returns true. The toggle reads/writes `State.formAssistEnabled`.

### URL Param

`?formAssist=off` disables form intelligence for dashboard-launched sessions.

### What Gets Toggled (all-or-nothing)

- Smart field labels (reverts to XFA names when off)
- Profile flyout panel (hidden from icon rail when off)
- Format masks and validation
- Progress indicator
- Auto-fill behavior

### Always On Regardless of Toggle

- Basic form field detection and overlay rendering
- Click-and-type in form fields
- Export with filled values

---

## 6. Architecture — app.js Decomposition

### New Module Structure

| Module | Lines (est.) | Responsibility |
|--------|:---:|---|
| `js/state.js` | ~50 | `State` object + getters/setters, exported as singleton. Includes `formAssistEnabled` flag for toggle system |
| `js/dom-refs.js` | ~60 | `DOM` object + `$()` helper. Exports a mutable `DOM` object and a `resolveDOMRefs()` function called explicitly during `boot()` — NOT at import time. This avoids null refs when modules are imported before DOMContentLoaded |
| `js/renderer.js` | ~300 | `renderCurrentPage()`, zoom logic, scroll restoration, page container sizing |
| `js/navigation.js` | ~150 | `goToPage()`, page nav, thumbnail highlighting, scroll-into-view |
| `js/thumbnails.js` | ~120 | Thumbnail generation, IntersectionObserver queue, drag-reorder |
| `js/menus.js` | ~400 | Menu definitions, context menu, dropdown rendering. `getMenuDefinitions(actions)` takes a callback object injected by `app.js` to avoid circular imports |
| `js/event-wiring.js` | ~500 | All `addEventListener` calls extracted from app.js |
| `js/app.js` | ~800 | Boot sequence, `openPDF()`, `reloadAfterEdit()`, orchestration only |

### Rules

- All modules import `State` and `DOM` from their respective modules
- Each module exports named functions only — no side effects on import (DOM refs resolved lazily via `resolveDOMRefs()` during boot, not at parse time)
- `app.js` remains the entry point and orchestrator
- Existing 621 tests continue to pass — extract, don't rewrite

### Import Topology (lower modules must never import from higher)

```
state.js         ← no imports from other app modules
dom-refs.js      ← imports state.js only
renderer.js      ← imports state, dom-refs, pdf-engine, forms
navigation.js    ← imports state, dom-refs, renderer, thumbnails
thumbnails.js    ← imports state, dom-refs, pdf-engine
menus.js         ← imports state, dom-refs (actions passed in as callbacks, NOT imported)
event-wiring.js  ← imports all of the above
app.js           ← imports event-wiring + orchestrates boot
```

**Circular dependency rule**: Lower modules must never import from higher modules. `menus.js` receives action callbacks via `getMenuDefinitions(actions)` — it does not import from `app.js`, `renderer.js`, or `navigation.js`. Violations cause silent `undefined` bindings in ES modules.

### Error Recovery

- `renderCurrentPage()` gets 1 automatic retry on failure with fresh canvas
- `window.onerror` / `unhandledrejection` → "Something went wrong — Reload?" toast
- Form field values backed up to `sessionStorage` every 30 seconds, integrated with the existing IndexedDB crash recovery system. On recovery restore (`checkRecoveryData` → `recoverSession`), the restore path also rehydrates `formFieldValues` from `sessionStorage` so form data is not lost

### No Changes To

- Build system (zero-build, CDN-loaded)
- Module loading (ES modules, static imports)
- External integration contract
- Service worker caching strategy

---

## New Files Summary

```
forms/                          — USCIS form mapping files
  i-130.json
  i-485.json
  i-765.json
  ... (10-20 forms)

js/field-format.js              — Input masks and validation (~200 lines)
js/form-profile.js              — Profile data, auto-fill, learn-from-PDF (~300 lines)
js/form-progress.js             — Progress indicator panel (~150 lines)
js/form-matcher.js              — Match PDF to mapping file (~50 lines)

js/state.js                     — Extracted from app.js
js/dom-refs.js                  — Extracted from app.js
js/renderer.js                  — Extracted from app.js
js/navigation.js                — Extracted from app.js
js/thumbnails.js                — Extracted from app.js
js/menus.js                     — Extracted from app.js
js/event-wiring.js              — Extracted from app.js
```

## Implementation Order

1. **Architecture first** — Decompose `app.js` (no behavior changes, tests must pass). Reserve `State.formAssistEnabled` flag, `checked` menu item support in dropdown renderer, and `?formAssist` URL param parsing — even though the toggle UI ships in step 6, the touch points must exist in the extracted modules.
2. **Field mapping system** — JSON files + matcher + smart labels in overlays
3. **Format masks** — `field-format.js` + integration with form overlays
4. **Profile & auto-fill** — Profile panel, dashboard integration (with `history.replaceState` PII stripping), learn-from-PDF
5. **Progress indicator** — Panel in PAGES flyout
6. **Toggle system** — View menu item, URL param, auto-detection (wiring up the touch points reserved in step 1)

Each step is independently shippable and testable.
