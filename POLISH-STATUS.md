# Mudbrick — Production Polish Status

## Completed in This Pass

### Workstream A — Test Coverage (603 tests across 28 files)
- **Before:** 4 test files, ~55 tests covering only utils, bates, page-labels, redact-patterns
- **After:** 28 test files, 603 tests covering ALL modules
- Created `tests/setup.js` with global mocks for PDFLib, Fabric.js, IndexedDB
- Updated `vitest.config.js` to use setup file

### Workstream C — PWA & Deployment Hardening
- Added security headers to `vercel.json`: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- Added aggressive cache headers for static assets (JS, CSS, icons): 1-year immutable
- Created proper `icons/icon.svg` (external file, not inline data-URI)
- Updated `manifest.json`: external SVG references, separate maskable purpose entries
- Created `scripts/generate-icons.js` for PNG icon generation (requires `sharp`)
- Bumped service worker to v4.2

### Workstream D — SEO & Meta Tags
- Added Open Graph tags (og:title, og:description, og:type, og:image)
- Added Twitter Card tags
- Added JSON-LD structured data (SoftwareApplication schema)
- Improved page title with keywords
- Enhanced meta description with feature list
- Updated favicon and apple-touch-icon to use SVG file

### Workstream E — UX Polish
- Created `js/keyboard-shortcuts.js` — centralized shortcut catalog with search
- Created `js/recent-files.js` — localStorage-based recent files manager
- Note: The HTML already had keyboard shortcuts modal and recent files UI

### Workstream F — CI/CD & Lint
- Enhanced `.github/workflows/test.yml`: separate lint + test jobs, coverage
- Created `eslint.config.js` (flat config for ESLint 9+)
- Added `@vitest/coverage-v8` for test coverage reporting
- Added `npm run lint` and `npm run test:coverage` scripts
- **Result:** 0 lint errors, 59 warnings (all pre-existing unused vars)

### Workstream G — Performance
- Added `<link rel="preconnect">` for CDN (already had fonts.googleapis.com)
- SW pre-caches new modules for offline support

## Deferred to Next Iteration

### Workstream B — app.js Decomposition
**Reason:** The 194KB monolith decomposition is high-risk without comprehensive E2E tests. With 603 unit tests now in place, the next step would be:
1. Add Playwright E2E tests for critical user flows
2. Extract State → `js/state.js`
3. Extract DOM refs → `js/dom-refs.js`
4. Extract modals → `js/modal-controller.js`
5. Extract navigation → `js/navigation.js`
6. Extract toolbar → `js/toolbar.js`

### Lazy Module Loading (Part of WS-G)
Converting OCR, doc-compare, export-image, form-creator, exhibit-stamps, comment-summary from static to dynamic `import()` would reduce initial parse from ~559KB to ~400KB. This is tightly coupled to the app.js decomposition.

### PNG Icon Generation
The `scripts/generate-icons.js` script is ready but requires `sharp` (native binary). Run when a build environment with native dependencies is available:
```
npm install --save-dev sharp
node scripts/generate-icons.js
```

### Additional Future Work
- E2E tests with Playwright (canvas interactions, modal flows)
- i18n/localization framework
- Multi-document tab support
- Password-protected PDF support
- Error reporting / analytics (opt-in)
