/**
 * Menu Actions — Wires dropdown menu items to existing app functionality
 * and handles context-sensitive disabling of menu items.
 *
 * This module is imported by app.js and initialized during boot().
 */

/**
 * Initialize menu action listeners.
 * - Handles Alt+key accelerators for opening menus
 * - Adds global keyboard shortcut for Ctrl+0 (Actual Size)
 * - Manages context-sensitive menu state
 */
export function initMenuActions() {
  // Alt+key accelerators to open menus by first letter
  const menuKeys = {
    'f': 'File',
    'e': 'Edit',
    'v': 'View',
    'i': 'Insert',
    't': 'Tools',
    'h': 'Help',
  };

  document.addEventListener('keydown', (e) => {
    // Alt+letter opens corresponding menu
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      const key = e.key.toLowerCase();
      const menuLabel = menuKeys[key];
      if (menuLabel) {
        e.preventDefault();
        const menuBtn = Array.from(document.querySelectorAll('.menu-item'))
          .find(btn => btn.textContent.trim() === menuLabel);
        if (menuBtn) menuBtn.click();
      }
    }

    // Ctrl+0 — Actual Size (not handled elsewhere)
    if ((e.ctrlKey || e.metaKey) && e.key === '0' && !e.shiftKey && !e.altKey) {
      // Only prevent if no input/textarea is focused
      const tag = document.activeElement?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        // setZoom(1.0) is called via the menu action; dispatch a custom event
        document.dispatchEvent(new CustomEvent('mudbrick:actualsize'));
      }
    }
  });
}
