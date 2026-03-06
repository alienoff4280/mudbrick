/**
 * Mudbrick — Document-Level Undo / Redo
 *
 * Stores pdfBytes snapshots so users can undo/redo document mutations
 * (insert page, crop, text edit, etc.).
 *
 * Separate from annotation history (history.js) which tracks per-page
 * Fabric.js canvas states.
 *
 * Usage:
 *   import { pushDocState, undoDoc, redoDoc, canUndoDoc, canRedoDoc, clearDocHistory } from './doc-history.js';
 *   pushDocState(currentBytes);   // before each mutation
 *   const prev = undoDoc();       // returns Uint8Array or null
 *   const next = redoDoc();       // returns Uint8Array or null
 */

const MAX_DOC_HISTORY = 10;
const MAX_MEMORY_BYTES = 300 * 1024 * 1024; // 300 MB

let undoStack = [];  // Uint8Array[]
let redoStack = [];  // Uint8Array[]

/** Total bytes currently stored across both stacks. */
function totalMemory() {
  let sum = 0;
  for (const b of undoStack) sum += b.byteLength;
  for (const b of redoStack) sum += b.byteLength;
  return sum;
}

/** Evict oldest undo entries until within memory budget, but always keep at least one. */
function evictIfNeeded() {
  while (undoStack.length > 1 && totalMemory() > MAX_MEMORY_BYTES) {
    undoStack.shift();
  }
}

/**
 * Save a snapshot of the current document bytes before a mutation.
 * Clears the redo stack (new edit branch).
 */
export function pushDocState(bytes) {
  if (!bytes) { console.warn('[doc-history] pushDocState called with falsy bytes'); return; }
  const copy = new Uint8Array(bytes);
  undoStack.push(copy); // defensive copy
  console.log('[doc-history] pushDocState: saved', copy.byteLength, 'bytes, undoStack depth:', undoStack.length);
  if (undoStack.length > MAX_DOC_HISTORY) {
    undoStack.shift();
  }
  redoStack.length = 0;
  evictIfNeeded();
  console.log('[doc-history] after eviction: undoStack depth:', undoStack.length, 'totalMem:', totalMemory());
}

/**
 * Undo the last document mutation.
 * @param {Uint8Array} currentBytes — the current pdfBytes to push onto redo
 * @returns {Uint8Array|null} previous bytes, or null if nothing to undo
 */
export function undoDoc(currentBytes) {
  console.log('[doc-history] undoDoc called, undoStack depth:', undoStack.length, 'currentBytes size:', currentBytes?.byteLength);
  if (undoStack.length === 0) { console.warn('[doc-history] undoDoc: stack empty!'); return null; }
  if (currentBytes) {
    redoStack.push(new Uint8Array(currentBytes));
  }
  const popped = undoStack.pop();
  console.log('[doc-history] undoDoc: returning', popped.byteLength, 'bytes, undoStack now:', undoStack.length);
  return popped;
}

/**
 * Redo the last undone document mutation.
 * @param {Uint8Array} currentBytes — the current pdfBytes to push onto undo
 * @returns {Uint8Array|null} next bytes, or null if nothing to redo
 */
export function redoDoc(currentBytes) {
  if (redoStack.length === 0) return null;
  if (currentBytes) {
    undoStack.push(new Uint8Array(currentBytes));
  }
  return redoStack.pop();
}

/** Whether document undo is available. */
export function canUndoDoc() {
  const can = undoStack.length > 0;
  console.log('[doc-history] canUndoDoc:', can, 'depth:', undoStack.length);
  return can;
}

/** Whether document redo is available. */
export function canRedoDoc() {
  return redoStack.length > 0;
}

/** Clear all document history (call on new file open). */
export function clearDocHistory() {
  undoStack = [];
  redoStack = [];
}
