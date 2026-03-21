/**
 * Menus — Dropdown menus, context menus, and menu definitions.
 *
 * All action callbacks are injected via the `actions` parameter in
 * getMenuDefinitions() and setMenuCallbacks(), keeping this module
 * decoupled from app.js.
 */

import State from './state.js';
import { DOM, $ } from './dom-refs.js';
import { icon } from './icons.js';

/* ═══════════════════ Module-level State ═══════════════════ */

let _activeDropdown = null;
let contextMenu = null;

/** Callbacks injected by app.js for context-menu actions */
let _callbacks = {};

/* ═══════════════════ Callback Injection ═══════════════════ */

/**
 * Register callbacks used by showContextMenu and showAnnotationContextMenu.
 * Call this once during boot, before any menus are opened.
 */
export function setMenuCallbacks(callbacks) {
  _callbacks = callbacks;
}

/* ═══════════════════ Dropdown Menus ═══════════════════ */

export function closeDropdown() {
  if (_activeDropdown) {
    if (_activeDropdown._keyHandler) {
      document.removeEventListener('keydown', _activeDropdown._keyHandler);
    }
    _activeDropdown.remove();
    _activeDropdown = null;
  }
  // Remove any lingering submenus
  document.querySelectorAll('.dropdown-submenu').forEach(s => s.remove());
  document.querySelectorAll('.menu-item.active').forEach(el => {
    el.classList.remove('active');
    el.setAttribute('aria-expanded', 'false');
  });
}

export function openDropdown(menuBtn, items) {
  closeDropdown();
  hideContextMenu();

  menuBtn.classList.add('active');
  menuBtn.setAttribute('aria-expanded', 'true');
  const rect = menuBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item === '---') {
      const sep = document.createElement('div');
      sep.className = 'dropdown-menu-separator';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.setAttribute('role', 'menuitem');
    const needsDoc = item.needsDoc !== false;
    const isDisabled = (needsDoc && !State.pdfBytes) || item.disabled;
    btn.disabled = isDisabled;

    // Submenu arrow indicator
    const submenuArrow = item.submenu ? `<span class="submenu-arrow">${icon('chevron-right', 12)}</span>` : '';
    const shortcutHtml = item.shortcut && !item.submenu ? `<span class="shortcut-hint">${item.shortcut}</span>` : '';

    // Support checked menu items
    const label = item.checked && item.checked() ? '\u2713 ' + item.label : item.label;

    // NOTE: innerHTML is safe here — icon() returns pre-defined SVG markup,
    // and label/shortcut come from our own menu definitions, not user input.
    btn.innerHTML = `${icon(item.icon, 14)}<span>${label}</span>${shortcutHtml}${submenuArrow}`;
    if (item.submenu) {
      // Submenu on hover
      let submenuEl = null;
      let submenuTimeout = null;
      btn.addEventListener('mouseenter', () => {
        clearTimeout(submenuTimeout);
        // Remove any other open submenus
        menu.querySelectorAll('.dropdown-submenu').forEach(s => s.remove());
        const subItems = item.submenu();
        submenuEl = document.createElement('div');
        submenuEl.className = 'dropdown-menu dropdown-submenu';
        submenuEl.setAttribute('role', 'menu');
        for (const si of subItems) {
          if (si === '---') {
            const sep = document.createElement('div');
            sep.className = 'dropdown-menu-separator';
            submenuEl.appendChild(sep);
            continue;
          }
          const subBtn = document.createElement('button');
          subBtn.setAttribute('role', 'menuitem');
          const subNeedsDoc = si.needsDoc !== false;
          subBtn.disabled = (subNeedsDoc && !State.pdfBytes) || si.disabled;
          subBtn.innerHTML = `${icon(si.icon, 14)}<span>${si.label}</span>${si.shortcut ? `<span class="shortcut-hint">${si.shortcut}</span>` : ''}`;          subBtn.addEventListener('click', () => {
            closeDropdown();
            si.action();
          });
          submenuEl.appendChild(subBtn);
        }
        const btnRect = btn.getBoundingClientRect();
        submenuEl.style.left = btnRect.right + 'px';
        submenuEl.style.top = btnRect.top + 'px';
        document.body.appendChild(submenuEl);
        // Keep submenu in viewport
        const subRect = submenuEl.getBoundingClientRect();
        if (subRect.right > window.innerWidth) {
          submenuEl.style.left = (btnRect.left - subRect.width) + 'px';
        }
        if (subRect.bottom > window.innerHeight) {
          submenuEl.style.top = (window.innerHeight - subRect.height - 8) + 'px';
        }
      });
      btn.addEventListener('mouseleave', (e) => {
        submenuTimeout = setTimeout(() => {
          if (submenuEl && !submenuEl.matches(':hover')) {
            submenuEl.remove();
            submenuEl = null;
          }
        }, 200);
      });
    } else {
      btn.addEventListener('click', () => {
        closeDropdown();
        item.action();
      });
    }
    menu.appendChild(btn);
  }

  menu.style.left = rect.left + 'px';
  menu.style.top = rect.bottom + 'px';
  document.body.appendChild(menu);

  // Keep menu within viewport
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
  }

  _activeDropdown = menu;

  // Focus first enabled button for keyboard navigation
  const firstBtn = menu.querySelector('button:not(:disabled)');
  if (firstBtn) firstBtn.focus();

  // Close on click outside
  const onOutsideClick = (e) => {
    if (!menu.contains(e.target) && !e.target.closest('.menu-item') && !e.target.closest('.dropdown-submenu')) {
      closeDropdown();
      document.removeEventListener('mousedown', onOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);

  // Keyboard navigation: Arrow keys, Enter, Escape
  const onKey = (e) => {
    const buttons = Array.from(menu.querySelectorAll('button:not(:disabled)'));
    const focused = document.activeElement;
    const idx = buttons.indexOf(focused);

    if (e.key === 'Escape') {
      closeDropdown();
      menuBtn.focus();
      document.removeEventListener('keydown', onKey);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx < buttons.length - 1 ? idx + 1 : 0;
      buttons[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx > 0 ? idx - 1 : buttons.length - 1;
      buttons[prev]?.focus();
    } else if (e.key === 'ArrowRight') {
      // Open submenu if item has one, or move to next menu
      const item = items.filter(i => i !== '---')[idx];
      if (item && item.submenu) {
        // Trigger mouseenter to open submenu
        focused.dispatchEvent(new MouseEvent('mouseenter'));
        setTimeout(() => {
          const sub = document.querySelector('.dropdown-submenu button:not(:disabled)');
          if (sub) sub.focus();
        }, 50);
        e.preventDefault();
      } else {
        // Move to next menu item in title bar
        const allMenuBtns = Array.from(document.querySelectorAll('.menu-item'));
        const menuIdx = allMenuBtns.indexOf(menuBtn);
        if (menuIdx < allMenuBtns.length - 1) {
          allMenuBtns[menuIdx + 1].click();
          e.preventDefault();
        }
      }
    } else if (e.key === 'ArrowLeft') {
      // Move to previous menu item in title bar
      const allMenuBtns = Array.from(document.querySelectorAll('.menu-item'));
      const menuIdx = allMenuBtns.indexOf(menuBtn);
      if (menuIdx > 0) {
        allMenuBtns[menuIdx - 1].click();
        e.preventDefault();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  // Store cleanup reference
  menu._keyHandler = onKey;
}

/* ═══════════════════ Menu Definitions ═══════════════════ */

/**
 * Returns the menu structure object. All action callbacks are received
 * via the `actions` parameter so this module stays decoupled from app.js.
 */
export function getMenuDefinitions(actions) {
  return {
    'File': [
      { icon: 'file-plus', label: 'New Blank PDF', needsDoc: false, action: actions.handleNewBlankPdf },
      { icon: 'folder-open', label: 'Open', shortcut: 'Ctrl+O', needsDoc: false, action: actions.openFile },
      { icon: 'clock', label: 'Open Recent', needsDoc: false, submenu: () => buildRecentSubmenu(actions) },
      '---',
      { icon: 'save', label: 'Save', shortcut: 'Ctrl+S', action: actions.handleSave },
      { icon: 'download', label: 'Save & Download', shortcut: 'Ctrl+Shift+S', action: actions.handleSaveDownload },
      { icon: 'file-output', label: 'Export\u2026', action: actions.handleExport },
      { icon: 'download', label: 'Export as Image', action: actions.exportAsImage },
      '---',
      { icon: 'printer', label: 'Print', shortcut: 'Ctrl+P', action: actions.handlePrint },
      { icon: 'info', label: 'Properties', action: actions.showProperties },
      { icon: 'x', label: 'Close', action: actions.handleCloseDocument },
    ],
    'Edit': [
      { icon: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: actions.handleUndo },
      { icon: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: actions.handleRedo },
      '---',
      { icon: 'scissors', label: 'Cut', shortcut: 'Ctrl+X', action: actions.cut },
      { icon: 'copy', label: 'Copy', shortcut: 'Ctrl+C', action: actions.copy },
      { icon: 'clipboard-paste', label: 'Paste', shortcut: 'Ctrl+V', action: actions.paste },
      { icon: 'trash', label: 'Delete', shortcut: 'Del', action: actions.deleteSelected },
      '---',
      { icon: 'maximize', label: 'Select All', shortcut: 'Ctrl+A', action: actions.selectAll },
      '---',
      { icon: 'search', label: 'Find & Replace', shortcut: 'Ctrl+F', action: actions.openFindBar },
    ],
    'View': [
      { icon: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl+=', action: actions.zoomIn },
      { icon: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+\u2212', action: actions.zoomOut },
      '---',
      { icon: 'columns', label: 'Fit Width', action: actions.fitWidth },
      { icon: 'maximize', label: 'Fit Page', action: actions.fitPage },
      { icon: 'scan', label: 'Actual Size', shortcut: 'Ctrl+0', action: actions.actualSize },
      '---',
      { icon: 'panel-left-open', label: 'Toggle Sidebar', needsDoc: false, action: actions.toggleSidebar },
      { icon: 'panel-right-open', label: 'Toggle Properties Panel', action: actions.togglePropertiesPanel },
      '---',
      { icon: 'moon', label: 'Dark Mode', needsDoc: false, action: actions.toggleDarkMode },
      { icon: 'maximize', label: 'Full Screen', shortcut: 'F11', needsDoc: false, action: actions.fullScreen },
    ],
    'Insert': [
      { icon: 'file-plus', label: 'Blank Page', action: actions.addBlankPage },
      { icon: 'files', label: 'Pages from File', action: actions.openMergeModal },
      '---',
      { icon: 'image', label: 'Image', action: actions.handleImageInsert },
      { icon: 'type', label: 'Text Annotation', shortcut: 'T', action: actions.setToolText },
      { icon: 'stamp', label: 'Stamp', action: actions.setToolStamp },
      '---',
      { icon: 'pen-tool', label: 'Signature', action: actions.openSignature },
      { icon: 'droplet', label: 'Watermark', action: actions.openWatermarkModal },
      { icon: 'align-justify', label: 'Header / Footer', action: actions.openHfModal },
      '---',
      { icon: 'hash', label: 'Bates Numbers', action: actions.openBatesModal },
      { icon: 'tag', label: 'Page Labels', action: actions.openPageLabelsModal },
      { icon: 'gavel', label: 'Exhibit Stamps', action: actions.openExhibitModal },
    ],
    'Tools': [
      { icon: 'type', label: 'Text Edit Mode', action: actions.handleEditText },
      '---',
      { icon: 'form-input', label: 'Form Filler', action: actions.formFiller },
      { icon: 'list-ordered', label: 'Form Creator', action: actions.formCreator },
      '---',
      { icon: 'file-scan', label: 'OCR', action: actions.ocr },
      { icon: 'shield-off', label: 'Redaction Patterns', action: actions.redactSearch },
      { icon: 'git-compare', label: 'Document Compare', action: actions.docCompare },
      '---',
      { icon: 'lock', label: 'Security', action: actions.security },
      { icon: 'message-square', label: 'Comment Summary', action: actions.openCommentSummaryModal },
      '---',
      { icon: 'maximize', label: 'Normalize Page Sizes', action: actions.openNormalizePagesModal },
      '---',
      { icon: 'zap', label: 'Optimize / Compress', action: actions.optimize },
    ],
    'Help': [
      { icon: 'info', label: 'Keyboard Shortcuts', shortcut: '?', needsDoc: false, action: actions.openShortcutsModal },
      { icon: 'play', label: 'Start Tour', needsDoc: false, action: actions.startTour },
      '---',
      { icon: 'zap', label: 'About Mudbrick', needsDoc: false, action: actions.openAboutModal },
      { icon: 'link', label: 'GitHub Repository', needsDoc: false, action: actions.openGitHub },
    ],
  };
}

export function buildRecentSubmenu(actions) {
  const recent = actions.getRecentFiles();
  if (recent.length === 0) {
    return [{ icon: 'info', label: 'No recent files', needsDoc: false, disabled: true, action: () => {} }];
  }
  const items = recent.map(f => ({
    icon: 'file',
    label: f.name.length > 35 ? f.name.slice(0, 32) + '\u2026' : f.name,
    needsDoc: false,
    action: actions.openFile,
  }));
  items.push('---');
  items.push({ icon: 'trash', label: 'Clear Recent', needsDoc: false, action: actions.clearRecentFiles });
  return items;
}

export function initDropdownMenus(actions) {
  const defs = getMenuDefinitions(actions);
  document.querySelectorAll('.menu-item').forEach(btn => {
    const label = btn.textContent.trim();
    const items = defs[label];
    if (!items) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_activeDropdown && btn.classList.contains('active')) {
        closeDropdown();
      } else {
        openDropdown(btn, items);
      }
    });
    // Open on hover when another menu is already open
    btn.addEventListener('mouseenter', () => {
      if (_activeDropdown) {
        openDropdown(btn, items);
      }
    });
  });
}

/* ═══════════════════ Context Menus ═══════════════════ */

export function showContextMenu(e, pageNum) {
  e.preventDefault();
  hideContextMenu();

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  // NOTE: innerHTML is safe here — icon() returns pre-defined SVG markup,
  // and all other content is static strings, not user input.
  contextMenu.innerHTML = `
    <button data-action="insert-before">${icon('file-plus', 14)} Insert Page Before</button>
    <button data-action="insert-after">${icon('file-plus', 14)} Insert Page After</button>
    <button data-action="insert-blank">${icon('file-plus', 14)} Insert Blank Page</button>
    <button data-action="duplicate">${icon('files', 14)} Duplicate Page</button>
    <div class="context-menu-separator"></div>
    <button data-action="rotate-cw">${icon('rotate-cw', 14)} Rotate Right</button>
    <button data-action="rotate-ccw">${icon('rotate-ccw', 14)} Rotate Left</button>
    <button data-action="rotate-180">${icon('flip-vertical', 14)} Rotate 180°</button>
    <div class="context-menu-separator"></div>
    <button data-action="delete" ${State.totalPages <= 1 ? 'disabled' : ''}>${icon('trash', 14)} Delete Page</button>
    <button data-action="extract">${icon('file-output', 14)} Extract Page</button>
  `;
  // Position at mouse
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  document.body.appendChild(contextMenu);

  // Clamp to viewport
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  // Handle clicks
  contextMenu.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    hideContextMenu();

    const action = btn.dataset.action;
    const idx = pageNum - 1; // 0-based

    // Insert blank page
    if (action === 'insert-blank') {
      _callbacks.showLoading('Inserting page\u2026');
      try {
        const newBytes = await _callbacks.insertBlankPage(State.pdfBytes, idx);
        State.currentPage = pageNum + 1; // navigate to the new blank page
        await _callbacks.reloadAfterEdit(newBytes);
        _callbacks.toast('Inserted blank page', 'success');
      } catch (err) {
        console.error('Insert blank page failed:', err);
        _callbacks.toast('Insert blank page failed: ' + err.message, 'error');
      } finally {
        _callbacks.hideLoading();
      }
      return;
    }

    // Insert page needs a file picker — not a loading operation
    if (action === 'insert-before' || action === 'insert-after') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.multiple = true;
      input.addEventListener('change', e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const insertAfter = action === 'insert-before' ? idx - 1 : idx;
        _callbacks.handleAddPages(files, insertAfter);
      });
      input.click();
      return;
    }

    // Duplicate page via pdf-lib
    if (action === 'duplicate') {
      _callbacks.showLoading('Duplicating page\u2026');
      try {
        const PDFLib = window.PDFLib;
        const doc = await PDFLib.PDFDocument.load(State.pdfBytes, { ignoreEncryption: true });
        const [copied] = await doc.copyPages(doc, [idx]);
        doc.insertPage(idx + 1, copied);
        const newBytes = await doc.save();
        State.currentPage = pageNum + 1;
        await _callbacks.reloadAfterEdit(newBytes);
        _callbacks.toast(`Duplicated page ${pageNum}`, 'success');
      } catch (err) {
        console.error('Duplicate page failed:', err);
        _callbacks.toast('Duplicate failed: ' + err.message, 'error');
      } finally {
        _callbacks.hideLoading();
      }
      return;
    }

    _callbacks.showLoading('Editing page\u2026');
    try {
      let newBytes;
      switch (action) {
        case 'rotate-cw':
          newBytes = await _callbacks.rotatePage(State.pdfBytes, idx, 90);
          await _callbacks.reloadAfterEdit(newBytes);
          _callbacks.toast('Rotated page right', 'success');
          break;
        case 'rotate-ccw':
          newBytes = await _callbacks.rotatePage(State.pdfBytes, idx, -90);
          await _callbacks.reloadAfterEdit(newBytes);
          _callbacks.toast('Rotated page left', 'success');
          break;
        case 'rotate-180':
          newBytes = await _callbacks.rotatePage(State.pdfBytes, idx, 180);
          await _callbacks.reloadAfterEdit(newBytes);
          _callbacks.toast('Rotated page 180\u00b0', 'success');
          break;
        case 'delete':
          if (State.totalPages <= 1) return;
          if (!confirm(`Delete page ${pageNum}? This cannot be undone.`)) return;
          newBytes = await _callbacks.deletePage(State.pdfBytes, idx);
          // If we deleted the current page or a page before it, adjust
          if (pageNum <= State.currentPage && State.currentPage > 1) {
            State.currentPage--;
          }
          await _callbacks.reloadAfterEdit(newBytes);
          _callbacks.toast(`Deleted page ${pageNum}`, 'success');
          break;
        case 'extract': {
          const extracted = await _callbacks.splitPDF(State.pdfBytes, [[idx]]);
          const part = extracted[0];
          const name = State.fileName.replace('.pdf', '') + `_${part.label}.pdf`;
          _callbacks.downloadBlob(part.bytes, name);
          _callbacks.toast(`Extracted ${part.label}`, 'success');
          break;
        }
      }
    } catch (err) {
      console.error('Page operation failed:', err);
      _callbacks.toast('Operation failed: ' + err.message, 'error');
    } finally {
      _callbacks.hideLoading();
    }
  });

  // Close on click outside or Escape
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
    document.addEventListener('keydown', function onKey(ev) {
      if (ev.key === 'Escape') {
        hideContextMenu();
        document.removeEventListener('keydown', onKey);
      }
    });
  }, 0);
}

export function hideContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

/* ═══════════════════ Annotation Context Menu ═══════════════════ */

export function showAnnotationContextMenu(e, target) {
  e.preventDefault();
  e.stopPropagation();
  hideContextMenu();

  const canvas = _callbacks.getCanvas();
  if (!canvas) return;

  const locked = target ? !!target.lockMovementX : false;
  const hasSelection = !!target;

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  // NOTE: innerHTML is safe here — icon() returns pre-defined SVG markup,
  // and all other content is static strings, not user input.
  contextMenu.innerHTML = `
    <button data-action="anno-copy" ${!hasSelection ? 'disabled' : ''}>${icon('copy', 14)} Copy</button>
    <button data-action="anno-paste">${icon('clipboard-paste', 14)} Paste</button>
    <button data-action="anno-duplicate" ${!hasSelection ? 'disabled' : ''}>${icon('files', 14)} Duplicate</button>
    <div class="context-menu-separator"></div>
    <button data-action="anno-front" ${!hasSelection ? 'disabled' : ''}>${icon('arrow-up-to-line', 14)} Bring to Front</button>
    <button data-action="anno-forward" ${!hasSelection ? 'disabled' : ''}>${icon('chevron-up', 14)} Bring Forward</button>
    <button data-action="anno-backward" ${!hasSelection ? 'disabled' : ''}>${icon('chevron-down', 14)} Send Backward</button>
    <button data-action="anno-back" ${!hasSelection ? 'disabled' : ''}>${icon('arrow-down-to-line', 14)} Send to Back</button>
    <div class="context-menu-separator"></div>
    <button data-action="anno-lock" ${!hasSelection ? 'disabled' : ''}>${locked ? icon('lock', 14) + ' Unlock' : icon('lock-open', 14) + ' Lock'}</button>
    <button data-action="anno-delete" ${!hasSelection ? 'disabled' : ''}>${icon('trash', 14)} Delete</button>
  `;
  // Position at mouse
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  document.body.appendChild(contextMenu);

  // Clamp to viewport
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  // Handle clicks
  contextMenu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    hideContextMenu();

    switch (btn.dataset.action) {
      case 'anno-copy':      _callbacks.copySelected(); break;
      case 'anno-paste':     _callbacks.pasteClipboard(); break;
      case 'anno-duplicate': _callbacks.duplicateSelected(); break;
      case 'anno-front':     _callbacks.bringToFront(); break;
      case 'anno-forward':   _callbacks.bringForward(); break;
      case 'anno-backward':  _callbacks.sendBackward(); break;
      case 'anno-back':      _callbacks.sendToBack(); break;
      case 'anno-lock':
        if (locked) _callbacks.unlockSelected();
        else _callbacks.lockSelected();
        break;
      case 'anno-delete':    _callbacks.deleteSelected(); break;
    }
  });

  // Close on click outside or Escape
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
    document.addEventListener('keydown', function onKey(ev) {
      if (ev.key === 'Escape') {
        hideContextMenu();
        document.removeEventListener('keydown', onKey);
      }
    });
  }, 0);
}
