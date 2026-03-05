/**
 * Mudbrick — Test Setup
 * Global mocks for browser APIs, PDFLib, Fabric.js, and DOM stubs.
 */

import { vi } from 'vitest';

// ── Mock window.PDFLib ──
const mockPDFDocument = {
  getPageCount: vi.fn(() => 3),
  getPage: vi.fn((idx) => ({
    getSize: () => ({ width: 612, height: 792 }),
    drawRectangle: vi.fn(),
    drawImage: vi.fn(),
  })),
  getTitle: vi.fn(() => ''),
  getAuthor: vi.fn(() => ''),
  getSubject: vi.fn(() => ''),
  getKeywords: vi.fn(() => ''),
  getCreator: vi.fn(() => ''),
  getProducer: vi.fn(() => ''),
  getCreationDate: vi.fn(() => null),
  getModificationDate: vi.fn(() => null),
  setTitle: vi.fn(),
  setAuthor: vi.fn(),
  setSubject: vi.fn(),
  setKeywords: vi.fn(),
  setCreator: vi.fn(),
  setProducer: vi.fn(),
  setCreationDate: vi.fn(),
  setModificationDate: vi.fn(),
  addPage: vi.fn(() => ({
    getSize: () => ({ width: 612, height: 792 }),
    drawRectangle: vi.fn(),
    drawImage: vi.fn(),
  })),
  insertPage: vi.fn(),
  removePage: vi.fn(),
  copyPages: vi.fn(() => [{}]),
  save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
  embedPng: vi.fn(() => Promise.resolve({})),
  getForm: vi.fn(() => ({
    getFields: vi.fn(() => []),
  })),
};

globalThis.window = globalThis.window || globalThis;

globalThis.window.PDFLib = {
  PDFDocument: {
    load: vi.fn(() => Promise.resolve({ ...mockPDFDocument })),
    create: vi.fn(() => Promise.resolve({ ...mockPDFDocument })),
  },
  rgb: vi.fn((r, g, b) => ({ r, g, b })),
  degrees: vi.fn((d) => d),
  StandardFonts: { Helvetica: 'Helvetica' },
  PageSizes: { A4: [595, 842], Letter: [612, 792] },
};

// ── Mock window.fabric ──
globalThis.window.fabric = {
  Canvas: vi.fn(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    getObjects: vi.fn(() => []),
    renderAll: vi.fn(),
    toJSON: vi.fn(() => ({ objects: [] })),
    loadFromJSON: vi.fn((json, cb) => cb && cb()),
    dispose: vi.fn(),
    setWidth: vi.fn(),
    setHeight: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    clear: vi.fn(),
  })),
  StaticCanvas: vi.fn(() => ({
    getObjects: vi.fn(() => []),
    renderAll: vi.fn(),
    toJSON: vi.fn(() => ({ objects: [] })),
    loadFromJSON: vi.fn((json, cb) => cb && cb()),
    toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgo='),
    dispose: vi.fn(),
    setWidth: vi.fn(),
    setHeight: vi.fn(),
  })),
  Rect: vi.fn((opts) => ({ ...opts, type: 'rect' })),
  Circle: vi.fn((opts) => ({ ...opts, type: 'circle' })),
  IText: vi.fn((text, opts) => ({ text, ...opts, type: 'i-text' })),
  Path: vi.fn((path, opts) => ({ path, ...opts, type: 'path' })),
  Image: { fromURL: vi.fn() },
  Group: vi.fn((objs, opts) => ({ objects: objs, ...opts, type: 'group' })),
};

// ── Mock IndexedDB (minimal) ──
if (!globalThis.indexedDB) {
  const stores = {};
  globalThis.indexedDB = {
    open: vi.fn(() => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: vi.fn(),
          transaction: vi.fn(() => ({
            objectStore: vi.fn(() => ({
              get: vi.fn(() => {
                const r = { onsuccess: null, onerror: null, result: undefined };
                setTimeout(() => r.onsuccess?.(), 0);
                return r;
              }),
              put: vi.fn(() => {
                const r = { onsuccess: null, onerror: null };
                setTimeout(() => r.onsuccess?.(), 0);
                return r;
              }),
              delete: vi.fn(() => {
                const r = { onsuccess: null, onerror: null };
                setTimeout(() => r.onsuccess?.(), 0);
                return r;
              }),
            })),
          })),
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    }),
  };
}

// ── Mock toast (from utils.js) ──
// Many modules import toast — ensure it doesn't throw in test env
if (!document.getElementById('toast-container')) {
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
}
