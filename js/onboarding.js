/**
 * Mudbrick — Onboarding Module
 * Guided tour, contextual tips, and about modal support for first-time users.
 *
 * Exports:
 *   initOnboarding()   — call once from boot(); wires Help menu "Start Tour"
 *   startTour()        — begin the 5-step guided tour
 *   showTip(id, msg, anchor) — show a one-time contextual tip
 *   shouldShowTour()   — returns true if tour hasn't been completed yet
 */

/* ── Storage keys ── */
const TOUR_KEY       = 'mudbrick-tour-complete';
const TIPS_KEY       = 'mudbrick-seen-tips';
const SESSION_KEY    = 'mudbrick-tips-session-count';

/* ── Tour step definitions ── */
const TOUR_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Mudbrick!',
    text: 'Drop a PDF here or click Open to get started. Your files never leave your device.',
    target: '#drop-zone',
    position: 'bottom',
  },
  {
    id: 'ribbon',
    title: 'Ribbon Toolbar',
    text: 'Use these tabs to access different tools — Home, Edit, Annotate, Forms, and more.',
    target: '#ribbon-tabs',
    position: 'bottom',
  },
  {
    id: 'annotate',
    title: 'Annotation Tools',
    text: 'The Annotate tab has drawing, highlighting, shapes, stamps, and text tools.',
    target: '[data-ribbon="annotate"]',
    position: 'bottom',
  },
  {
    id: 'sidebar',
    title: 'Page Thumbnails',
    text: 'Thumbnails show all pages. Right-click for options like rotate, delete, or reorder.',
    target: '#sidebar',
    position: 'right',
  },
  {
    id: 'export',
    title: 'Export Your PDF',
    text: 'When you\'re done, export your PDF. All changes are baked in permanently.',
    target: '#btn-export',
    position: 'bottom',
  },
];

/* ── Internal state ── */
let _tourActive    = false;
let _currentStep   = 0;
let _overlayEl     = null;
let _tooltipEl     = null;
let _spotlightEl   = null;

/* ═══════════════════ Public API ═══════════════════ */

/**
 * Initialize onboarding: add "Start Tour" to the Help menu via a
 * custom event, and auto-launch tour on first visit.
 */
export function initOnboarding() {
  // Expose globally so app.js can call these from the Help menu
  window.__mbStartTour  = startTour;
  window.__mbShowAbout  = showAbout;

  // Auto-start tour on very first visit (welcome screen visible, no PDF loaded)
  if (shouldShowTour()) {
    // Delay slightly to let the page settle
    setTimeout(() => {
      // Only show tour if the welcome screen is visible (no doc loaded yet)
      const welcome = document.getElementById('welcome-screen');
      if (welcome && !welcome.classList.contains('hidden')) {
        startTour();
      }
    }, 800);
  }

  // Wire Escape key to close tour
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _tourActive) {
      endTour();
    }
  });
}

/**
 * Returns true if the user hasn't completed the tour yet.
 */
export function shouldShowTour() {
  return !localStorage.getItem(TOUR_KEY);
}

/**
 * Start the guided tour from step 0.
 */
export function startTour() {
  if (_tourActive) return;
  _tourActive   = true;
  _currentStep  = 0;
  _createOverlay();
  _showStep(_currentStep);
}

/**
 * Show a one-time contextual tip anchored to an element.
 * @param {string} tipId        — unique id for this tip
 * @param {string} message      — tip text
 * @param {Element|null} anchor — element to position tip near (or null for top-center)
 */
export function showTip(tipId, message, anchor = null) {
  // Don't show more than 3 tips per session
  const sessionCount = parseInt(sessionStorage.getItem(SESSION_KEY) || '0', 10);
  if (sessionCount >= 3) return;

  // Don't re-show tips already seen
  const seen = _getSeenTips();
  if (seen.includes(tipId)) return;

  // Mark as seen
  seen.push(tipId);
  _saveSeenTips(seen);
  sessionStorage.setItem(SESSION_KEY, String(sessionCount + 1));

  _createContextualTip(tipId, message, anchor);
}

/* ═══════════════════ Tour internals ═══════════════════ */

function _createOverlay() {
  // Remove any stale overlay
  _removeOverlay();

  _overlayEl = document.createElement('div');
  _overlayEl.className = 'tour-overlay';
  _overlayEl.setAttribute('aria-hidden', 'true');

  _spotlightEl = document.createElement('div');
  _spotlightEl.className = 'tour-spotlight';

  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'tour-tooltip';
  _tooltipEl.setAttribute('role', 'dialog');
  _tooltipEl.setAttribute('aria-modal', 'true');
  _tooltipEl.setAttribute('aria-label', 'Tour step');

  document.body.appendChild(_overlayEl);
  document.body.appendChild(_spotlightEl);
  document.body.appendChild(_tooltipEl);

  // Skip on overlay click
  _overlayEl.addEventListener('click', endTour);
}

function _showStep(index) {
  if (index >= TOUR_STEPS.length) {
    endTour(true);
    return;
  }

  const step = TOUR_STEPS[index];
  const target = document.querySelector(step.target);

  // Position spotlight
  if (target) {
    const rect = target.getBoundingClientRect();
    const pad  = 6;
    _spotlightEl.style.top    = (rect.top    - pad + window.scrollY) + 'px';
    _spotlightEl.style.left   = (rect.left   - pad + window.scrollX) + 'px';
    _spotlightEl.style.width  = (rect.width  + pad * 2) + 'px';
    _spotlightEl.style.height = (rect.height + pad * 2) + 'px';
    _spotlightEl.classList.remove('hidden');
  } else {
    _spotlightEl.classList.add('hidden');
  }

  // Build tooltip content
  const isFirst = index === 0;
  const isLast  = index === TOUR_STEPS.length - 1;

  _tooltipEl.innerHTML = `
    <div class="tour-tooltip-header">
      <span class="tour-step-indicator">${index + 1} of ${TOUR_STEPS.length}</span>
      <button class="tour-skip-btn" aria-label="Skip tour">Skip</button>
    </div>
    <h3 class="tour-tooltip-title">${_esc(step.title)}</h3>
    <p class="tour-tooltip-text">${_esc(step.text)}</p>
    <div class="tour-tooltip-nav">
      <button class="tour-btn-secondary" id="tour-prev" ${isFirst ? 'style="visibility:hidden"' : ''}>Back</button>
      <div class="tour-dots">${_buildDots(index)}</div>
      <button class="tour-btn-primary" id="tour-next">${isLast ? 'Finish' : 'Next'}</button>
    </div>
  `;

  // Position tooltip relative to target
  if (target) {
    _positionTooltip(target, step.position);
  } else {
    // Fallback: center of screen
    _tooltipEl.style.top       = '50%';
    _tooltipEl.style.left      = '50%';
    _tooltipEl.style.transform = 'translate(-50%, -50%)';
  }

  // Wire navigation buttons
  _tooltipEl.querySelector('#tour-next').addEventListener('click', () => {
    _currentStep++;
    _showStep(_currentStep);
  });

  const prevBtn = _tooltipEl.querySelector('#tour-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      _currentStep--;
      _showStep(_currentStep);
    });
  }

  _tooltipEl.querySelector('.tour-skip-btn').addEventListener('click', endTour);
}

function _positionTooltip(target, position) {
  const rect       = target.getBoundingClientRect();
  const tooltipW   = 300;
  const tooltipH   = 180; // approximate
  const margin     = 16;
  const scrollY    = window.scrollY;
  const scrollX    = window.scrollX;
  const vw         = window.innerWidth;
  const vh         = window.innerHeight;

  // Reset any previous inline transforms
  _tooltipEl.style.transform = '';

  let top, left;

  if (position === 'bottom') {
    top  = rect.bottom + margin + scrollY;
    left = rect.left + rect.width / 2 - tooltipW / 2 + scrollX;
  } else if (position === 'top') {
    top  = rect.top - tooltipH - margin + scrollY;
    left = rect.left + rect.width / 2 - tooltipW / 2 + scrollX;
  } else if (position === 'right') {
    top  = rect.top + rect.height / 2 - tooltipH / 2 + scrollY;
    left = rect.right + margin + scrollX;
  } else {
    top  = rect.top + rect.height / 2 - tooltipH / 2 + scrollY;
    left = rect.left - tooltipW - margin + scrollX;
  }

  // Clamp to viewport
  left = Math.max(margin, Math.min(left, vw - tooltipW - margin));
  top  = Math.max(margin + scrollY, top);

  _tooltipEl.style.top  = top + 'px';
  _tooltipEl.style.left = left + 'px';
}

function _buildDots(activeIndex) {
  return TOUR_STEPS.map((_, i) =>
    `<span class="tour-dot ${i === activeIndex ? 'active' : ''}"></span>`
  ).join('');
}

function endTour(completed = false) {
  _tourActive = false;
  _removeOverlay();

  if (completed === true) {
    localStorage.setItem(TOUR_KEY, '1');
  } else {
    // Also mark as complete on skip so we don't pester the user
    localStorage.setItem(TOUR_KEY, '1');
  }
}

function _removeOverlay() {
  if (_overlayEl)   { _overlayEl.remove();   _overlayEl   = null; }
  if (_spotlightEl) { _spotlightEl.remove(); _spotlightEl = null; }
  if (_tooltipEl)   { _tooltipEl.remove();   _tooltipEl   = null; }
}

/* ═══════════════════ Contextual tips ═══════════════════ */

function _createContextualTip(tipId, message, anchor) {
  const tip = document.createElement('div');
  tip.className = 'contextual-tip';
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');

  tip.innerHTML = `
    <span class="contextual-tip-icon">💡</span>
    <span class="contextual-tip-text">${_esc(message)}</span>
    <button class="contextual-tip-close" aria-label="Dismiss tip">&times;</button>
  `;

  document.body.appendChild(tip);

  // Position near anchor if provided
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    const scrollY = window.scrollY;
    tip.style.position = 'fixed';
    tip.style.top  = Math.min(rect.bottom + 8, window.innerHeight - 80) + 'px';
    tip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 320)) + 'px';
  }

  // Wire dismiss button
  tip.querySelector('.contextual-tip-close').addEventListener('click', () => {
    _dismissTip(tip);
  });

  // Auto-dismiss after 6 seconds
  const autoTimer = setTimeout(() => _dismissTip(tip), 6000);

  tip.addEventListener('click', () => {
    clearTimeout(autoTimer);
    _dismissTip(tip);
  }, { once: true });
}

function _dismissTip(el) {
  el.classList.add('exiting');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  // Fallback remove in case animation doesn't fire
  setTimeout(() => el.remove(), 400);
}

/* ═══════════════════ Helpers ═══════════════════ */

function _getSeenTips() {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY)) || [];
  } catch {
    return [];
  }
}

function _saveSeenTips(list) {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(list));
  } catch { /* storage might be full */ }
}

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════ About modal helper ═══════════════════ */

function showAbout() {
  const el = document.getElementById('about-modal-backdrop');
  if (el) el.classList.remove('hidden');
}
