/**
 * Mudbrick — Thumbnail Management
 * Generates, renders, and highlights page thumbnails in the sidebar.
 */

import State from './state.js';
import { DOM } from './dom-refs.js';
import { renderThumbnail } from './pdf-engine.js';
import { getPageLabel } from './page-labels.js';
import { announceToScreenReader } from './a11y.js';

// Thumbnail render queue — limits concurrent PDF.js thumbnail renders
let _thumbQueue = [];
let _thumbActiveCount = 0;
const THUMB_CONCURRENCY = 3;
let _thumbObserver = null; // current IntersectionObserver; disconnected on regenerate

let _callbacks = {};
export function setThumbnailCallbacks(cbs) { _callbacks = cbs; }

export function generateThumbnails() {
  DOM.thumbnailList.innerHTML = '';

  // Disconnect previous observer and reset queue state
  if (_thumbObserver) {
    _thumbObserver.disconnect();
    _thumbObserver = null;
  }
  _thumbQueue = [];
  _thumbActiveCount = 0;

  // Create placeholder items for all pages
  for (let i = 1; i <= State.totalPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item' + (i === State.currentPage ? ' active' : '');
    item.dataset.page = i;
    item.draggable = true;
    // Accessibility: thumbnail acts as a listbox option
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-selected', i === State.currentPage ? 'true' : 'false');
    item.setAttribute('aria-label', `Page ${getPageLabel(i)}`);
    // Placeholder: light-gray background + centered page number
    // Note: innerHTML here uses only trusted static content (page number integer)
    item.innerHTML = `
      <div class="thumbnail-placeholder" style="display:flex;align-items:center;justify-content:center;background:#e8e8e8;aspect-ratio:8.5/11;width:100%;font-size:12px;color:#888;border-radius:2px;">${i}</div>
      <span class="page-number">${getPageLabel(i)}</span>
    `;
    item.addEventListener('click', () => _callbacks.goToPage?.(i));
    item.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        _callbacks.goToPage?.(i);
      }
    });
    item.addEventListener('contextmenu', e => _callbacks.showContextMenu?.(e, i));

    // Drag-and-drop reordering
    item.draggable = true;
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/x-mudbrick-page', String(i));
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      _callbacks.clearDropIndicators?.();
    });

    DOM.thumbnailList.appendChild(item);
  }

  // Use IntersectionObserver to render only thumbnails near the viewport.
  // rootMargin of 300px pre-loads thumbnails before the user actually scrolls
  // to them, so placeholders are rarely visible even when scrolling quickly.
  _thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const item = entry.target;
      // Only enqueue once — skip items already queued or already rendered
      if (!item.dataset.thumbQueued && item.querySelector('.thumbnail-placeholder')) {
        item.dataset.thumbQueued = '1';
        const pageNum = parseInt(item.dataset.page);
        // Give pages close to the current page higher priority (front of queue)
        const dist = Math.abs(pageNum - State.currentPage);
        if (dist <= 2) {
          _thumbQueue.unshift({ item, pageNum });
        } else {
          _thumbQueue.push({ item, pageNum });
        }
        _drainThumbQueue();
      }
      _thumbObserver.unobserve(item);
    });
  }, {
    root: DOM.thumbnailList,
    rootMargin: '300px', // pre-render 300px above/below the visible area
  });

  DOM.thumbnailList.querySelectorAll('.thumbnail-item').forEach(item => {
    _thumbObserver.observe(item);
  });
}

/** Pull entries off _thumbQueue while a concurrency slot is available */
export function _drainThumbQueue() {
  while (_thumbActiveCount < THUMB_CONCURRENCY && _thumbQueue.length > 0) {
    const { item, pageNum } = _thumbQueue.shift();
    _thumbActiveCount++;
    renderThumbnailForItem(item, pageNum).finally(() => {
      _thumbActiveCount--;
      _drainThumbQueue(); // check for more work once a slot frees up
    });
  }
}

export async function renderThumbnailForItem(item, pageNum) {
  // Guard: skip if placeholder was already replaced (e.g. double-queued)
  if (!item.querySelector('.thumbnail-placeholder')) return;
  try {
    const thumbWidth = (DOM.thumbnailList.clientWidth || 180) - 24; // minus padding
    const canvas = await renderThumbnail(State.pdfDoc, pageNum, thumbWidth);

    // Replace placeholder with rendered canvas
    const placeholder = item.querySelector('.thumbnail-placeholder');
    if (placeholder) {
      item.replaceChild(canvas, placeholder);
    }
  } catch (e) {
    console.warn(`Thumbnail render failed for page ${pageNum}:`, e);
  }
}

export function highlightActiveThumbnail() {
  DOM.thumbnailList.querySelectorAll('.thumbnail-item').forEach(item => {
    const isActive = parseInt(item.dataset.page) === State.currentPage;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // Announce page change to screen readers
  announceToScreenReader(`Page ${State.currentPage} of ${State.totalPages}`);
}
