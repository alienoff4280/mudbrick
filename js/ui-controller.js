/* Mudbrick — UI Controller
 * Manages icon rail, flyout panels, properties panel, slide-overs, and theme.
 * Extracted from app.js to reduce the monolith.
 */

// eslint-disable-next-line no-unused-vars
const UIController = (() => {
  // ─── State ───
  let activePanel = null;        // currently open flyout name
  const pinnedPanels = new Set();
  let propertiesPinned = false;
  let propertiesVisible = false;

  // ─── Persistence ───
  const PREFS_KEY = 'mb-ui-prefs';

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch { return {}; }
  }

  function savePrefs(patch) {
    const prefs = { ...loadPrefs(), ...patch };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  // ─── DOM Refs (resolved on init) ───
  let rail = null;
  let flyoutContainer = null;
  let propertiesPanel = null;

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return (root || document).querySelectorAll(sel); }

  // ─── Icon Rail ───

  function setActiveTool(toolName) {
    // Update rail indicator
    $$('.mb-rail-item', rail).forEach(item => {
      const isMatch = item.dataset.tool === toolName ||
                      item.dataset.panel === toolName;
      item.classList.toggle('mb-rail-item--active', isMatch);
    });

    // Also highlight active flyout item
    $$('.mb-flyout-item[data-tool]', flyoutContainer).forEach(item => {
      item.classList.toggle('mb-flyout-item--active', item.dataset.tool === toolName);
    });
  }

  // ─── Flyout Panels ───

  function openFlyout(panelName) {
    if (!flyoutContainer) return;

    // Hide all flyout contents
    $$('.mb-flyout__content', flyoutContainer).forEach(c => {
      c.hidden = c.dataset.flyout !== panelName;
    });

    // Show flyout container
    flyoutContainer.classList.add('mb-flyout--open');
    flyoutContainer.setAttribute('aria-hidden', 'false');
    activePanel = panelName;

    // Update rail indicator
    $$('.mb-rail-item[data-panel]', rail).forEach(item => {
      item.classList.toggle('mb-rail-item--active', item.dataset.panel === panelName);
    });
  }

  function closeFlyout() {
    if (!flyoutContainer) return;
    flyoutContainer.classList.remove('mb-flyout--open');
    flyoutContainer.setAttribute('aria-hidden', 'true');

    // Remove active state from panel rail items (not tool items)
    $$('.mb-rail-item[data-panel]', rail).forEach(item => {
      item.classList.remove('mb-rail-item--active');
    });

    activePanel = null;
  }

  function toggleFlyout(panelName) {
    if (activePanel === panelName && !pinnedPanels.has(panelName)) {
      closeFlyout();
    } else {
      openFlyout(panelName);
    }
  }

  function pinFlyout(panelName) {
    pinnedPanels.add(panelName);
    updatePinButton(panelName, true);
    savePrefs({ pinnedPanels: [...pinnedPanels] });
  }

  function unpinFlyout(panelName) {
    pinnedPanels.delete(panelName);
    updatePinButton(panelName, false);
    savePrefs({ pinnedPanels: [...pinnedPanels] });
  }

  function togglePin(panelName) {
    if (pinnedPanels.has(panelName)) {
      unpinFlyout(panelName);
    } else {
      pinFlyout(panelName);
    }
  }

  function updatePinButton(panelName, isPinned) {
    const content = flyoutContainer?.querySelector(`[data-flyout="${panelName}"]`);
    const pinBtn = content?.querySelector('.mb-flyout__pin');
    if (pinBtn) {
      pinBtn.classList.toggle('mb-flyout__pin--active', isPinned);
      pinBtn.title = isPinned ? 'Unpin panel' : 'Pin panel';
    }
  }

  // ─── Properties Panel ───

  function showProperties() {
    if (!propertiesPanel) return;
    propertiesPanel.classList.add('mb-properties--open');
    propertiesPanel.classList.remove('hidden');
    propertiesVisible = true;
  }

  function hideProperties() {
    if (!propertiesPanel || propertiesPinned) return;
    propertiesPanel.classList.remove('mb-properties--open');
    propertiesVisible = false;
    // Let transition finish before hiding
    setTimeout(() => {
      if (!propertiesVisible) {
        propertiesPanel.classList.add('hidden');
      }
    }, 160);
  }

  function togglePropertiesPin() {
    propertiesPinned = !propertiesPinned;
    const pinBtn = propertiesPanel?.querySelector('.mb-properties__pin');
    if (pinBtn) {
      pinBtn.classList.toggle('mb-flyout__pin--active', propertiesPinned);
      pinBtn.title = propertiesPinned ? 'Unpin panel' : 'Pin panel';
    }
    savePrefs({ propertiesPinned });
  }

  // ─── Slide-Over Panels ───

  function openSlideOver(backdropId) {
    const backdrop = $(backdropId);
    if (!backdrop) return;
    backdrop.classList.remove('hidden');
    // Trigger transition after DOM paint
    requestAnimationFrame(() => {
      const panel = backdrop.querySelector('.mb-slide-over');
      if (panel) panel.classList.add('mb-slide-over--open');
    });
  }

  function closeSlideOver(backdropId) {
    const backdrop = $(backdropId);
    if (!backdrop) return;
    const panel = backdrop.querySelector('.mb-slide-over');
    if (panel) panel.classList.remove('mb-slide-over--open');
    setTimeout(() => backdrop.classList.add('hidden'), 260);
  }

  // ─── Theme ───

  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    savePrefs({ theme: next });

    // Update toggle button icon
    const btn = $('btn-dark-mode');
    if (btn) {
      btn.title = next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  function restoreTheme() {
    const prefs = loadPrefs();
    if (prefs.theme) {
      document.documentElement.setAttribute('data-theme', prefs.theme);
    }
  }

  // ─── Welcome ↔ Editor ───

  function showEditor() {
    const welcome = $('welcome-screen');
    const app = $('app');
    if (welcome) welcome.classList.add('hidden');
    if (app) app.classList.remove('hidden');

    // Open pages flyout by default on first load
    const prefs = loadPrefs();
    if (prefs.pinnedPanels && prefs.pinnedPanels.includes('pages')) {
      openFlyout('pages');
      pinFlyout('pages');
    } else if (activePanel === null) {
      openFlyout('pages');
    }
  }

  function showWelcome() {
    const welcome = $('welcome-screen');
    const app = $('app');
    if (welcome) welcome.classList.remove('hidden');
    if (app) app.classList.add('hidden');
    closeFlyout();
    hideProperties();
  }

  // ─── Tooltip System ───

  let tooltipEl = null;
  let tooltipTimeout = null;

  function showTooltip(target) {
    if (!target.title && !target.getAttribute('aria-label')) return;
    const text = target.title || target.getAttribute('aria-label');

    // Temporarily remove title to prevent native tooltip
    if (target.title) {
      target.dataset.tooltipText = target.title;
      target.title = '';
    }

    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'mb-tooltip';
        document.body.appendChild(tooltipEl);
      }
      tooltipEl.textContent = text;
      tooltipEl.style.display = 'block';

      const rect = target.getBoundingClientRect();
      tooltipEl.style.left = (rect.right + 8) + 'px';
      tooltipEl.style.top = (rect.top + rect.height / 2 - 12) + 'px';
    }, 500);
  }

  function hideTooltip(target) {
    clearTimeout(tooltipTimeout);
    if (tooltipEl) tooltipEl.style.display = 'none';

    // Restore title
    if (target.dataset.tooltipText) {
      target.title = target.dataset.tooltipText;
      delete target.dataset.tooltipText;
    }
  }

  // ─── Event Wiring ───

  function wireEvents() {
    if (!rail) return;

    // Icon rail clicks
    $$('.mb-rail-item', rail).forEach(item => {
      item.addEventListener('click', () => {
        const panel = item.dataset.panel;
        const tool = item.dataset.tool;

        if (panel) {
          toggleFlyout(panel);
        } else if (tool) {
          // Direct tool activation (select, hand)
          if (typeof window.selectTool === 'function') {
            window.selectTool(tool);
          }
          setActiveTool(tool);
        }
      });

      // Tooltips
      item.addEventListener('mouseenter', () => showTooltip(item));
      item.addEventListener('mouseleave', () => hideTooltip(item));
    });

    // Flyout close buttons
    $$('.mb-flyout__close', flyoutContainer).forEach(btn => {
      btn.addEventListener('click', closeFlyout);
    });

    // Flyout pin buttons
    $$('.mb-flyout__pin', flyoutContainer).forEach(btn => {
      btn.addEventListener('click', () => {
        if (activePanel) togglePin(activePanel);
      });
    });

    // Flyout tool items
    $$('.mb-flyout-item[data-tool]', flyoutContainer).forEach(item => {
      item.addEventListener('click', () => {
        const tool = item.dataset.tool;
        if (typeof window.selectTool === 'function') {
          window.selectTool(tool);
        }
        setActiveTool(tool);
      });
    });

    // Properties panel pin
    const propsPinBtn = propertiesPanel?.querySelector('.mb-properties__pin');
    if (propsPinBtn) {
      propsPinBtn.addEventListener('click', togglePropertiesPin);
    }

    // Properties panel close
    const propsCloseBtn = propertiesPanel?.querySelector('.mb-properties__close');
    if (propsCloseBtn) {
      propsCloseBtn.addEventListener('click', () => {
        propertiesPinned = false;
        hideProperties();
      });
    }

    // Theme toggle
    const themeBtn = $('btn-dark-mode');
    if (themeBtn) {
      themeBtn.addEventListener('click', toggleTheme);
    }

    // Keyboard shortcuts rail button
    const shortcutsBtn = $('btn-shortcuts-rail');
    if (shortcutsBtn) {
      shortcutsBtn.addEventListener('click', () => {
        if (typeof window.openModal === 'function') {
          window.openModal('shortcuts-modal-backdrop');
        }
      });
    }

    // Escape key — close flyout or deselect tool
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (activePanel && !pinnedPanels.has(activePanel)) {
          closeFlyout();
          e.preventDefault();
        }
      }
    });

    // Space hold for hand tool
    let wasToolBeforeSpace = null;
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !isInputFocused()) {
        wasToolBeforeSpace = document.querySelector('.mb-rail-item--active')?.dataset?.tool || 'select';
        if (typeof window.selectTool === 'function') {
          window.selectTool('hand');
        }
        setActiveTool('hand');
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && wasToolBeforeSpace !== null && !isInputFocused()) {
        if (typeof window.selectTool === 'function') {
          window.selectTool(wasToolBeforeSpace);
        }
        setActiveTool(wasToolBeforeSpace);
        wasToolBeforeSpace = null;
        e.preventDefault();
      }
    });
  }

  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  // ─── Init ───

  function init() {
    rail = document.querySelector('.mb-icon-rail');
    flyoutContainer = $('flyout-container');
    propertiesPanel = document.querySelector('.mb-properties') || $('properties-panel');

    restoreTheme();

    // Restore pin states
    const prefs = loadPrefs();
    if (prefs.propertiesPinned) {
      propertiesPinned = true;
    }
    if (prefs.pinnedPanels) {
      prefs.pinnedPanels.forEach(p => pinnedPanels.add(p));
    }

    wireEvents();
  }

  // ─── Public API ───
  return {
    init,
    setActiveTool,
    openFlyout,
    closeFlyout,
    toggleFlyout,
    pinFlyout,
    unpinFlyout,
    showProperties,
    hideProperties,
    togglePropertiesPin,
    openSlideOver,
    closeSlideOver,
    toggleTheme,
    showEditor,
    showWelcome,

    // Getters
    get activePanel() { return activePanel; },
    get propertiesVisible() { return propertiesVisible; },
    get propertiesPinned() { return propertiesPinned; },
  };
})();
