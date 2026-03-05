/**
 * Mudbrick — Accessibility Utilities (a11y.js)
 *
 * Provides WCAG 2.1 AA focus management and screen reader announcement helpers:
 *   - trapFocus(modalElement)        Confines Tab/Shift+Tab within a modal
 *   - releaseFocus(previousElement)  Returns focus to the trigger element after modal close
 *   - announceToScreenReader(msg)    Injects text into the aria-live announcer region
 *   - initRegionCycling()            Wires F6 to cycle between app regions
 */

/* ── Focus trap ── */

/**
 * All HTML element types that are natively keyboard focusable.
 * We query these inside the modal to build the focus cycle.
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** @type {Map<Element, (e: KeyboardEvent) => void>} Active trap handlers keyed by modal element */
const _trapHandlers = new Map();

/**
 * Trap keyboard focus inside `modalElement`.
 * Pressing Tab or Shift+Tab wraps around within the modal's focusable children.
 * Call releaseFocus() when the modal closes to clean up the handler.
 *
 * @param {HTMLElement} modalElement - The modal container (backdrop or inner panel).
 */
export function trapFocus(modalElement) {
  if (!modalElement) return;

  // Remove any pre-existing trap on this element to avoid duplicates
  releaseFocusTrap(modalElement);

  function handler(e) {
    if (e.key !== 'Tab') return;

    const focusable = Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTORS))
      .filter(el => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none');

    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: if focus is on first, wrap to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if focus is on last, wrap to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  modalElement.addEventListener('keydown', handler);
  _trapHandlers.set(modalElement, handler);

  // Move focus to the first focusable element inside the modal
  const focusable = Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTORS))
    .filter(el => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none');
  if (focusable.length > 0) {
    // Small delay lets the modal finish its CSS animation before taking focus,
    // avoiding a flash of focus ring on the backdrop itself.
    requestAnimationFrame(() => focusable[0].focus());
  }
}

/**
 * Remove the focus trap installed on `modalElement` without returning focus.
 * Used internally; call releaseFocus() from call sites to also restore focus.
 *
 * @param {HTMLElement} modalElement
 */
function releaseFocusTrap(modalElement) {
  if (!modalElement) return;
  const handler = _trapHandlers.get(modalElement);
  if (handler) {
    modalElement.removeEventListener('keydown', handler);
    _trapHandlers.delete(modalElement);
  }
}

/**
 * Remove the focus trap on `modalElement` and return focus to `previousElement`
 * (the element that was focused when the modal opened).
 *
 * @param {HTMLElement} modalElement    - The modal that is now closing.
 * @param {HTMLElement|null} previousElement - Element to restore focus to.
 */
export function releaseFocus(modalElement, previousElement) {
  releaseFocusTrap(modalElement);
  if (previousElement && typeof previousElement.focus === 'function') {
    // Use requestAnimationFrame so the modal is fully hidden before focus moves,
    // preventing screen readers from announcing the (now invisible) modal content.
    requestAnimationFrame(() => previousElement.focus());
  }
}

/* ── Screen reader announcements ── */

/** Cached reference to the aria-live announcer div */
let _announcer = null;

function getAnnouncer() {
  if (!_announcer) {
    _announcer = document.getElementById('a11y-announcer');
  }
  return _announcer;
}

/**
 * Inject `message` into the polite aria-live region so screen readers announce it.
 * Clears the previous message first (with a brief delay) so identical consecutive
 * messages still re-trigger the announcement.
 *
 * @param {string} message - The text to announce.
 */
export function announceToScreenReader(message) {
  const el = getAnnouncer();
  if (!el) return;

  // Clear then set with a tick gap so the DOM mutation is always detected
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

/* ── Region cycling (F6) ── */

/**
 * Ordered list of landmark region selectors for F6 navigation.
 * These map to the major sections of the Mudbrick shell.
 */
const REGIONS = [
  '#ribbon-panel',   // Ribbon toolbar
  '#sidebar',        // Thumbnail / bookmarks sidebar
  '#canvas-area',    // Main PDF canvas
  '#status-bar',     // Status bar / footer
];

let _regionIndex = 0;

/**
 * Move focus to the next (or previous, with Shift) app region when F6 is pressed.
 *
 * @param {boolean} reverse - Pass true when Shift+F6 should go backwards.
 */
export function cycleRegion(reverse = false) {
  const count = REGIONS.length;

  if (reverse) {
    _regionIndex = (_regionIndex - 1 + count) % count;
  } else {
    _regionIndex = (_regionIndex + 1) % count;
  }

  const selector = REGIONS[_regionIndex];
  const region   = document.querySelector(selector);
  if (!region) return;

  // Make region focusable if it isn't already (tabindex=-1 added in HTML)
  if (!region.hasAttribute('tabindex')) {
    region.setAttribute('tabindex', '-1');
  }
  region.focus();

  // Announce the region name to screen readers
  const label = region.getAttribute('aria-label') || region.id || selector;
  announceToScreenReader(`Navigated to ${label}`);
}
