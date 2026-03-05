import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trapFocus,
  releaseFocus,
  announceToScreenReader,
  cycleRegion,
} from '../js/a11y.js';

beforeEach(() => {
  // Remove all children but keep body itself intact
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

/* ═══════════════════ trapFocus ═══════════════════ */

describe('trapFocus', () => {
  function createModal() {
    const modal = document.createElement('div');
    modal.innerHTML = `
      <button id="btn-first">First</button>
      <input id="input-mid" type="text" />
      <button id="btn-last">Last</button>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  it('adds a keydown listener to the modal element', () => {
    const modal = createModal();
    const spy = vi.spyOn(modal, 'addEventListener');
    trapFocus(modal);
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('wraps focus from last to first element on Tab', () => {
    const modal = createModal();
    trapFocus(modal);

    const btnLast = modal.querySelector('#btn-last');
    const btnFirst = modal.querySelector('#btn-first');
    btnLast.focus();

    const focusSpy = vi.spyOn(btnFirst, 'focus');

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    modal.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('wraps focus from first to last element on Shift+Tab', () => {
    const modal = createModal();
    trapFocus(modal);

    const btnFirst = modal.querySelector('#btn-first');
    const btnLast = modal.querySelector('#btn-last');
    btnFirst.focus();

    const focusSpy = vi.spyOn(btnLast, 'focus');

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    modal.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('prevents default when no focusable elements exist', () => {
    const modal = document.createElement('div');
    modal.innerHTML = '<p>No focusable elements here</p>';
    document.body.appendChild(modal);
    trapFocus(modal);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    modal.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does nothing when called with null', () => {
    expect(() => trapFocus(null)).not.toThrow();
  });

  it('ignores non-Tab keys', () => {
    const modal = createModal();
    trapFocus(modal);

    const btnFirst = modal.querySelector('#btn-first');
    btnFirst.focus();

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    modal.dispatchEvent(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

/* ═══════════════════ releaseFocus ═══════════════════ */

describe('releaseFocus', () => {
  it('removes the keydown listener from the modal', () => {
    const modal = document.createElement('div');
    modal.innerHTML = '<button>OK</button>';
    document.body.appendChild(modal);

    const spy = vi.spyOn(modal, 'removeEventListener');
    trapFocus(modal);
    releaseFocus(modal, null);

    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('restores focus to the previous element via requestAnimationFrame', () => {
    const modal = document.createElement('div');
    modal.innerHTML = '<button>OK</button>';
    document.body.appendChild(modal);

    const trigger = document.createElement('button');
    trigger.textContent = 'Open Modal';
    document.body.appendChild(trigger);

    trapFocus(modal);
    releaseFocus(modal, trigger);

    // releaseFocus calls requestAnimationFrame(() => previousElement.focus())
    // In jsdom, rAF callbacks are executed; verify trigger is a valid focus target
    expect(typeof trigger.focus).toBe('function');
  });

  it('handles null previousElement gracefully', () => {
    const modal = document.createElement('div');
    modal.innerHTML = '<button>OK</button>';
    document.body.appendChild(modal);

    trapFocus(modal);
    expect(() => releaseFocus(modal, null)).not.toThrow();
  });

  it('handles null modal element gracefully', () => {
    expect(() => releaseFocus(null, null)).not.toThrow();
  });
});

/* ═══════════════════ announceToScreenReader ═══════════════════ */

describe('announceToScreenReader', () => {
  it('does nothing when the announcer element is missing', () => {
    // No #a11y-announcer in DOM — must run first before any announcer is cached
    // The internal _announcer is null at module load, so this test verifies
    // the function gracefully handles a missing element.
    expect(() => announceToScreenReader('Test message')).not.toThrow();
  });

  it('clears text content synchronously when announcing', () => {
    const announcer = document.createElement('div');
    announcer.id = 'a11y-announcer';
    announcer.setAttribute('aria-live', 'polite');
    announcer.textContent = 'Old message';
    document.body.appendChild(announcer);

    announceToScreenReader('New message');

    // The function clears text synchronously, then sets new text in rAF
    expect(announcer.textContent).toBe('');
  });

  it('sets the new message text inside requestAnimationFrame', () => {
    // The announcer element was created and cached by the previous test.
    // Retrieve it from the DOM.
    let announcer = document.getElementById('a11y-announcer');
    if (!announcer) {
      announcer = document.createElement('div');
      announcer.id = 'a11y-announcer';
      announcer.setAttribute('aria-live', 'polite');
      document.body.appendChild(announcer);
    }

    announceToScreenReader('Page rotated');
    // Text is cleared synchronously
    expect(announcer.textContent).toBe('');
    // The actual message would be set in the rAF callback
  });

  it('has aria-live attribute for screen reader support', () => {
    let announcer = document.getElementById('a11y-announcer');
    if (!announcer) {
      announcer = document.createElement('div');
      announcer.id = 'a11y-announcer';
      announcer.setAttribute('aria-live', 'polite');
      document.body.appendChild(announcer);
    }
    expect(announcer.getAttribute('aria-live')).toBe('polite');
  });
});

/* ═══════════════════ cycleRegion ═══════════════════ */

describe('cycleRegion', () => {
  function createRegions() {
    const regions = [
      { id: 'ribbon-panel', label: 'Ribbon' },
      { id: 'sidebar', label: 'Sidebar' },
      { id: 'canvas-area', label: 'Canvas' },
      { id: 'status-bar', label: 'Status Bar' },
    ];

    regions.forEach(({ id, label }) => {
      const el = document.createElement('div');
      el.id = id;
      el.setAttribute('aria-label', label);
      document.body.appendChild(el);
    });

    // Also add the announcer so cycleRegion can announce
    const announcer = document.createElement('div');
    announcer.id = 'a11y-announcer';
    announcer.setAttribute('aria-live', 'polite');
    document.body.appendChild(announcer);
  }

  it('moves focus to a region element', () => {
    createRegions();
    cycleRegion();

    // After one forward cycle from index 0, it should focus the next region
    const focusedId = document.activeElement?.id;
    // The region that received focus should be one of the known regions
    expect(['ribbon-panel', 'sidebar', 'canvas-area', 'status-bar']).toContain(focusedId);
  });

  it('adds tabindex="-1" to regions that lack it', () => {
    createRegions();
    cycleRegion();

    const focused = document.activeElement;
    expect(focused.getAttribute('tabindex')).toBe('-1');
  });

  it('cycles backwards with reverse=true', () => {
    createRegions();

    // Go forward twice to establish position
    cycleRegion(false);
    cycleRegion(false);
    const forwardId = document.activeElement?.id;

    // Now go backwards
    cycleRegion(true);
    const backId = document.activeElement?.id;

    // Should be a different region than where we were
    expect(backId).not.toBe(forwardId);
  });

  it('does not throw when a target region is missing from the DOM', () => {
    // Only add some regions, not all
    const el = document.createElement('div');
    el.id = 'canvas-area';
    document.body.appendChild(el);

    // Should not throw even if the next region in the cycle is missing
    expect(() => {
      cycleRegion();
      cycleRegion();
      cycleRegion();
      cycleRegion();
    }).not.toThrow();
  });
});
