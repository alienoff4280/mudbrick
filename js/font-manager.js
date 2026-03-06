/**
 * Mudbrick — Font Manager
 * Load custom fonts for both CSS rendering (contenteditable) and pdf-lib embedding.
 */

const DB_NAME = 'mudbrick_fonts';
const STORE_NAME = 'fonts';

/** In-memory cache: fontName → { name, bytes, cssFamily } */
const loadedFonts = new Map();

const STANDARD_FONTS = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'TimesRoman', 'TimesRoman-Bold', 'TimesRoman-Italic', 'TimesRoman-BoldItalic',
];

export function getStandardFonts() { return [...STANDARD_FONTS]; }
export function getLoadedFonts() { return [...loadedFonts.keys()]; }
export function getAllFontNames() {
  return [...new Set([...STANDARD_FONTS.map(f => f.split('-')[0]), ...loadedFonts.keys()])];
}

/**
 * Load a .ttf or .otf font file. Registers it for CSS and caches bytes for pdf-lib.
 * @returns {{ name: string, bytes: Uint8Array, cssFamily: string }}
 */
export async function loadCustomFont(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
  const cssFamily = `mudbrick-${name}`;

  const blob = new Blob([bytes], { type: 'font/ttf' });
  const url = URL.createObjectURL(blob);
  const style = document.createElement('style');
  style.textContent = `@font-face { font-family: '${cssFamily}'; src: url('${url}'); }`;
  document.head.appendChild(style);

  const entry = { name, bytes, cssFamily, styleEl: style };
  loadedFonts.set(name, entry);

  await saveFontToDB(name, bytes);
  return entry;
}

/**
 * Embed a custom font into a pdf-lib document. Returns the embedded font object.
 */
export async function embedInPdfLib(pdfDoc, fontName) {
  const entry = loadedFonts.get(fontName);
  if (!entry) return null;
  return pdfDoc.embedFont(entry.bytes, { subset: true });
}

/**
 * Get CSS font-family string for a loaded custom font.
 */
export function getCSSFamily(fontName) {
  const entry = loadedFonts.get(fontName);
  return entry ? `'${entry.cssFamily}', sans-serif` : null;
}

/**
 * Check if a font is a custom (non-standard) font.
 */
export function isCustomFont(fontName) {
  return loadedFonts.has(fontName);
}

/**
 * Measure text width using a temporary canvas (works for any CSS font).
 */
export function measureTextWidth(text, fontFamily, fontSize) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

/** Restore fonts from IndexedDB on startup. */
export async function restoreFonts() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await idbGetAll(store);
    for (const record of all) {
      const cssFamily = `mudbrick-${record.name}`;
      const blob = new Blob([record.bytes], { type: 'font/ttf' });
      const url = URL.createObjectURL(blob);
      const style = document.createElement('style');
      style.textContent = `@font-face { font-family: '${cssFamily}'; src: url('${url}'); }`;
      document.head.appendChild(style);
      loadedFonts.set(record.name, { name: record.name, bytes: record.bytes, cssFamily, styleEl: style });
    }
  } catch { /* IndexedDB unavailable */ }
}

// --- IndexedDB helpers ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFontToDB(name, bytes) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ name, bytes });
  } catch { /* ignore */ }
}

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
