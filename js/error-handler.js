/**
 * Mudbrick -- Error Handler & Crash Recovery
 * Centralized error handling, user-friendly messages, and auto-save via IndexedDB.
 */

import { toast, showLoading, hideLoading, updateLoadingProgress } from './utils.js';

/* ══════════════════════ Constants ══════════════════════ */

const DB_NAME = 'mudbrick-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const RECOVERY_KEY = 'current';
const AUTO_SAVE_INTERVAL = 60000; // 60 seconds

/** Map of error categories to user-friendly messages */
const ERROR_MESSAGES = {
  'file-corrupt': 'This PDF file appears to be corrupted or damaged. Please try a different file.',
  'file-encrypted': 'This PDF is password-protected. Mudbrick does not currently support encrypted PDFs.',
  'file-too-large': 'This file is very large and may cause performance issues or run out of memory.',
  'file-not-pdf': 'This file does not appear to be a valid PDF. Please check the file and try again.',
  'memory': 'The browser ran out of memory. Try closing other tabs or using a smaller file.',
  'network': 'A network error occurred. Please check your connection and try again.',
  'export-failed': 'Export failed. The file may be too large or complex to process.',
  'timeout': 'The operation took too long and was cancelled. The file may be too large or complex.',
  'unknown': 'An unexpected error occurred. Please try again or refresh the page.',
};

/* ══════════════════════ Global Error Handlers ══════════════════════ */

let _initialized = false;
let _autoSaveTimer = null;
let _getStateForSave = null; // callback to get current state

/**
 * Initialize global error handlers.
 * Call once at boot.
 */
export function initErrorHandler() {
  if (_initialized) return;
  _initialized = true;

  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (isMemoryError(msg)) {
      showUserError('memory');
    } else {
      console.error('[Mudbrick] Uncaught error:', event.error || msg);
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason || '');

    if (isMemoryError(msg)) {
      showUserError('memory');
    } else if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
      showUserError('network');
    } else {
      console.error('[Mudbrick] Unhandled rejection:', reason);
    }
  });
}

function isMemoryError(msg) {
  return /out of memory|allocation failed|RangeError.*Maximum call stack/i.test(msg);
}

/* ══════════════════════ User Error Display ══════════════════════ */

/**
 * Show a categorized, user-friendly error message.
 * @param {'file-corrupt'|'file-encrypted'|'file-too-large'|'file-not-pdf'|'memory'|'network'|'export-failed'|'timeout'|'unknown'} category
 * @param {string} [details] - Optional technical details for console
 */
export function showUserError(category, details) {
  const message = ERROR_MESSAGES[category] || ERROR_MESSAGES['unknown'];
  toast(message, 'error', 8000); // longer duration for errors

  if (details) {
    console.error(`[Mudbrick] ${category}:`, details);
  }
}

/* ══════════════════════ IndexedDB Helpers ══════════════════════ */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbPut(key, value) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function idbDelete(key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

/* ══════════════════════ Auto-Recovery ══════════════════════ */

/**
 * Initialize periodic auto-save to IndexedDB.
 * @param {Function} getState - callback returning { pdfBytes, pageAnnotations, fileName, hasChanges }
 */
export function initAutoRecovery(getState) {
  _getStateForSave = getState;

  // Clear any existing timer
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
  }

  _autoSaveTimer = setInterval(async () => {
    if (!_getStateForSave) return;

    try {
      const state = _getStateForSave();
      if (!state || !state.pdfBytes || !state.hasChanges) return;

      await idbPut(RECOVERY_KEY, {
        pdfBytes: state.pdfBytes,
        pageAnnotations: state.pageAnnotations,
        fileName: state.fileName,
        timestamp: Date.now(),
      });
    } catch (e) {
      // Silent fail for auto-save -- don't bother the user
      console.warn('[Mudbrick] Auto-save failed:', e);
    }
  }, AUTO_SAVE_INTERVAL);
}

/**
 * Check if recovery data exists from a previous session.
 * @returns {Promise<{available: boolean, fileName?: string, timestamp?: number}>}
 */
export async function checkRecoveryData() {
  try {
    const data = await idbGet(RECOVERY_KEY);
    if (data && data.pdfBytes && data.fileName) {
      return {
        available: true,
        fileName: data.fileName,
        timestamp: data.timestamp || 0,
      };
    }
  } catch (e) {
    console.warn('[Mudbrick] Recovery check failed:', e);
  }
  return { available: false };
}

/**
 * Recover session data from IndexedDB.
 * @returns {Promise<{pdfBytes: Uint8Array, pageAnnotations: Object, fileName: string}|null>}
 */
export async function recoverSession() {
  try {
    const data = await idbGet(RECOVERY_KEY);
    if (data && data.pdfBytes) {
      return {
        pdfBytes: new Uint8Array(data.pdfBytes),
        pageAnnotations: data.pageAnnotations || {},
        fileName: data.fileName || 'recovered.pdf',
      };
    }
  } catch (e) {
    console.error('[Mudbrick] Recovery failed:', e);
    toast('Failed to recover previous session.', 'error');
  }
  return null;
}

/**
 * Clear recovery data (call after successful export or user dismissal).
 */
export async function clearRecoveryData() {
  try {
    await idbDelete(RECOVERY_KEY);
  } catch (e) {
    console.warn('[Mudbrick] Failed to clear recovery data:', e);
  }
}

/* ══════════════════════ PDF Validation Helpers ══════════════════════ */

/**
 * Check if bytes begin with the PDF magic number (%PDF-).
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isPDFMagicBytes(bytes) {
  if (!bytes || bytes.length < 5) return false;
  // %PDF- = 0x25 0x50 0x44 0x46 0x2D
  return bytes[0] === 0x25 &&
         bytes[1] === 0x50 &&
         bytes[2] === 0x44 &&
         bytes[3] === 0x46 &&
         bytes[4] === 0x2D;
}

/**
 * Classify a PDF.js loading error into a user-friendly category.
 * @param {Error} error
 * @returns {'file-corrupt'|'file-encrypted'|'file-not-pdf'|'memory'|'timeout'|'unknown'}
 */
export function classifyPDFError(error) {
  const msg = error?.message || '';
  const name = error?.name || '';

  if (name === 'PasswordException' || msg.includes('password') || msg.includes('Password')) {
    return 'file-encrypted';
  }
  if (name === 'InvalidPDFException' || msg.includes('Invalid PDF') || msg.includes('invalid pdf')) {
    return 'file-corrupt';
  }
  if (msg.includes('not a valid PDF') || msg.includes('bad XRef')) {
    return 'file-corrupt';
  }
  if (isMemoryError(msg)) {
    return 'memory';
  }
  if (name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout')) {
    return 'timeout';
  }
  return 'unknown';
}

/**
 * Wrap a promise with a timeout.
 * @param {Promise} promise
 * @param {number} ms - timeout in milliseconds
 * @param {string} [label] - description for the timeout error
 * @returns {Promise}
 */
export function withTimeout(promise, ms, label = 'Operation') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
