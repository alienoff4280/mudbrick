/**
 * navigation.js — Page navigation helpers extracted from app.js
 */

import State from './state.js';
import { DOM } from './dom-refs.js';
import { renderCurrentPage } from './renderer.js';
import { announceToScreenReader } from './a11y.js';
import { getPageLabel } from './page-labels.js';

// Callback registry — avoids importing functions still in app.js
let _callbacks = {};
export function setNavCallbacks(cbs) { _callbacks = cbs; }

// Navigation debounce state
let _navDebounceTimer = null;    // timer for debounced page navigation
const NAV_DEBOUNCE_MS = 16;      // ~60fps batching for arrow-key holding

export function goToPage(pageNum) {
  const clamped = Math.max(1, Math.min(pageNum, State.totalPages));
  if (clamped === State.currentPage) return;

  State.currentPage = clamped;
  updatePageNav();
  _callbacks.highlightActiveThumbnail?.();

  // Scroll thumbnail into view (within thumbnail list only — prevent app-level scroll)
  const thumb = DOM.thumbnailList.querySelector(`[data-page="${clamped}"]`);
  if (thumb) {
    thumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Prevent scrollIntoView from scrolling the #app grid container
    DOM.app.scrollLeft = 0;
    DOM.app.scrollTop = 0;
  }

  // Scroll canvas area to top on page change
  DOM.canvasArea.scrollTo({ top: 0, behavior: 'smooth' });

  // Debounce rapid calls (e.g. holding arrow key) — only render at ~60fps
  if (_navDebounceTimer !== null) clearTimeout(_navDebounceTimer);
  _navDebounceTimer = setTimeout(() => {
    _navDebounceTimer = null;
    renderCurrentPage();
  }, NAV_DEBOUNCE_MS);
}

export function prevPage() { goToPage(State.currentPage - 1); }
export function nextPage() { goToPage(State.currentPage + 1); }
export function firstPage() { goToPage(1); }
export function lastPage() { goToPage(State.totalPages); }

export function updatePageNav() {
  const label = typeof getPageLabel === 'function' ? getPageLabel(State.currentPage) : null;
  DOM.pageInput.value = label || State.currentPage;
  DOM.pageInput.max = State.totalPages;
  DOM.totalPages.textContent = State.totalPages;
  const atFirst = State.currentPage <= 1;
  const atLast = State.currentPage >= State.totalPages;
  if (DOM.btnFirst) DOM.btnFirst.disabled = atFirst;
  DOM.btnPrev.disabled = atFirst;
  DOM.btnNext.disabled = atLast;
  if (DOM.btnLast) DOM.btnLast.disabled = atLast;
}
