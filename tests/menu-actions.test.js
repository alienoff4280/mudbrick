import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initMenuActions } from '../js/menu-actions.js';

describe('initMenuActions', () => {
  let cleanup;

  beforeEach(() => {
    // Store original listeners count to detect additions
    // Create fresh menu DOM structure
    document.body.innerHTML = `
      <div class="menu-bar">
        <button class="menu-item">File</button>
        <button class="menu-item">Edit</button>
        <button class="menu-item">View</button>
        <button class="menu-item">Insert</button>
        <button class="menu-item">Tools</button>
        <button class="menu-item">Help</button>
      </div>
    `;
    initMenuActions();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Alt+key menu accelerators', () => {
    it('clicks the File menu on Alt+f', () => {
      const fileBtn = Array.from(document.querySelectorAll('.menu-item'))
        .find(btn => btn.textContent.trim() === 'File');
      const clickSpy = vi.spyOn(fileBtn, 'click');

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(clickSpy).toHaveBeenCalled();
    });

    it('clicks the Edit menu on Alt+e', () => {
      const editBtn = Array.from(document.querySelectorAll('.menu-item'))
        .find(btn => btn.textContent.trim() === 'Edit');
      const clickSpy = vi.spyOn(editBtn, 'click');

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'e',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(clickSpy).toHaveBeenCalled();
    });

    it('does nothing for Alt+key with no matching menu', () => {
      // Alt+z should not throw or match any menu
      expect(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z',
          altKey: true,
          ctrlKey: false,
          shiftKey: false,
          metaKey: false,
          bubbles: true,
          cancelable: true,
        }));
      }).not.toThrow();
    });

    it('ignores Alt+key when Ctrl is also pressed', () => {
      const fileBtn = Array.from(document.querySelectorAll('.menu-item'))
        .find(btn => btn.textContent.trim() === 'File');
      const clickSpy = vi.spyOn(fileBtn, 'click');

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        altKey: true,
        ctrlKey: true,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('is case-insensitive for Alt+key', () => {
      const helpBtn = Array.from(document.querySelectorAll('.menu-item'))
        .find(btn => btn.textContent.trim() === 'Help');
      const clickSpy = vi.spyOn(helpBtn, 'click');

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'H',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Ctrl+0 actual size shortcut', () => {
    it('dispatches mudbrick:actualsize custom event on Ctrl+0', () => {
      const handler = vi.fn();
      document.addEventListener('mudbrick:actualsize', handler);

      // Focus a non-input element
      document.body.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '0',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).toHaveBeenCalled();
      document.removeEventListener('mudbrick:actualsize', handler);
    });

    it('dispatches mudbrick:actualsize on Meta+0 (macOS)', () => {
      const handler = vi.fn();
      document.addEventListener('mudbrick:actualsize', handler);

      document.body.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '0',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).toHaveBeenCalled();
      document.removeEventListener('mudbrick:actualsize', handler);
    });

    it('does NOT dispatch when an INPUT element is focused', () => {
      const handler = vi.fn();
      document.addEventListener('mudbrick:actualsize', handler);

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '0',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).not.toHaveBeenCalled();
      document.removeEventListener('mudbrick:actualsize', handler);
    });

    it('does NOT dispatch when a TEXTAREA element is focused', () => {
      const handler = vi.fn();
      document.addEventListener('mudbrick:actualsize', handler);

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '0',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).not.toHaveBeenCalled();
      document.removeEventListener('mudbrick:actualsize', handler);
    });

    it('does NOT dispatch when Shift is also pressed', () => {
      const handler = vi.fn();
      document.addEventListener('mudbrick:actualsize', handler);

      document.body.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '0',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).not.toHaveBeenCalled();
      document.removeEventListener('mudbrick:actualsize', handler);
    });
  });
});
