/**
 * Mudbrick — Recent Files Manager
 *
 * Stores and retrieves recent file metadata using localStorage.
 * Metadata only: name, size, date opened, page count.
 * No actual file content is stored.
 */

const STORAGE_KEY = 'mudbrick-recent-files';
const MAX_RECENT = 10;

/**
 * @typedef {Object} RecentFile
 * @property {string} name - File name
 * @property {number} size - File size in bytes
 * @property {number} pages - Page count
 * @property {string} openedAt - ISO date string
 */

/**
 * Get list of recently opened files.
 * @returns {RecentFile[]}
 */
export function getRecentFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Add a file to the recent list.
 * Moves to top if already present. Caps at MAX_RECENT.
 * @param {RecentFile} file
 */
export function addRecentFile(file) {
  if (!file || !file.name) return;

  const list = getRecentFiles();

  // Remove existing entry with same name
  const filtered = list.filter(f => f.name !== file.name);

  // Add to front
  filtered.unshift({
    name: file.name,
    size: file.size || 0,
    pages: file.pages || 0,
    openedAt: new Date().toISOString(),
  });

  // Cap
  if (filtered.length > MAX_RECENT) filtered.length = MAX_RECENT;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Storage full — silently ignore
  }
}

/**
 * Remove a specific file from the recent list.
 * @param {string} name
 */
export function removeRecentFile(name) {
  const list = getRecentFiles().filter(f => f.name !== name);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

/**
 * Clear all recent files.
 */
export function clearRecentFiles() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/**
 * Check if there are any recent files.
 * @returns {boolean}
 */
export function hasRecentFiles() {
  return getRecentFiles().length > 0;
}
