/**
 * Mudbrick — Keyboard Shortcuts Registry
 *
 * Centralized shortcut definitions that can be queried by the shortcuts
 * modal and by the event handler in app.js.
 *
 * This module is extracted to keep the shortcut catalog in a single place
 * and make it testable independently.
 */

/**
 * Shortcut definitions grouped by category.
 * Each entry: { label, keys, mac? }
 */
export const SHORTCUT_CATALOG = {
  File: [
    { label: 'Open file', keys: 'Ctrl+O' },
    { label: 'Save / Export', keys: 'Ctrl+S' },
    { label: 'Print', keys: 'Ctrl+P' },
  ],
  Edit: [
    { label: 'Undo', keys: 'Ctrl+Z' },
    { label: 'Redo', keys: 'Ctrl+Shift+Z' },
    { label: 'Cut', keys: 'Ctrl+X' },
    { label: 'Copy', keys: 'Ctrl+C' },
    { label: 'Paste', keys: 'Ctrl+V' },
    { label: 'Delete selection', keys: 'Delete' },
    { label: 'Select All', keys: 'Ctrl+A' },
    { label: 'Find & Replace', keys: 'Ctrl+F' },
  ],
  Navigation: [
    { label: 'Previous page', keys: 'Ctrl+[' },
    { label: 'Next page', keys: 'Ctrl+]' },
    { label: 'First page', keys: 'Home' },
    { label: 'Last page', keys: 'End' },
  ],
  View: [
    { label: 'Zoom in', keys: 'Ctrl+=' },
    { label: 'Zoom out', keys: 'Ctrl+-' },
    { label: 'Actual Size', keys: 'Ctrl+0' },
    { label: 'Full Screen', keys: 'F11' },
  ],
  Tools: [
    { label: 'Select tool', keys: 'V' },
    { label: 'Hand / Pan', keys: 'H' },
    { label: 'Text tool', keys: 'T' },
    { label: 'Draw tool', keys: 'D' },
  ],
  'Text Editing': [
    { label: 'Bold', keys: 'Ctrl+B' },
    { label: 'Italic', keys: 'Ctrl+I' },
    { label: 'Apply changes', keys: 'Ctrl+Enter' },
  ],
  General: [
    { label: 'Show shortcuts', keys: '?' },
    { label: 'Close modal / Deselect', keys: 'Esc' },
    { label: 'Cycle app regions', keys: 'F6' },
    { label: 'Page context menu', keys: 'Shift+F10' },
  ],
};

/**
 * Get all shortcut categories.
 * @returns {string[]}
 */
export function getCategories() {
  return Object.keys(SHORTCUT_CATALOG);
}

/**
 * Get shortcuts for a specific category.
 * @param {string} category
 * @returns {Array<{label: string, keys: string}>}
 */
export function getShortcuts(category) {
  return SHORTCUT_CATALOG[category] || [];
}

/**
 * Search shortcuts by label text.
 * @param {string} query
 * @returns {Array<{category: string, label: string, keys: string}>}
 */
export function searchShortcuts(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const [category, shortcuts] of Object.entries(SHORTCUT_CATALOG)) {
    for (const s of shortcuts) {
      if (s.label.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q)) {
        results.push({ category, ...s });
      }
    }
  }
  return results;
}
