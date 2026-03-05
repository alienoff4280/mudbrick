import { describe, it, expect, vi, beforeEach } from 'vitest';
import { icon, setIcon, ICONS } from '../js/icons.js';

describe('ICONS', () => {
  it('is a non-empty object', () => {
    expect(typeof ICONS).toBe('object');
    expect(Object.keys(ICONS).length).toBeGreaterThan(0);
  });

  it('contains expected icon keys', () => {
    const expectedKeys = ['save', 'download', 'trash', 'undo', 'redo', 'pencil', 'image', 'zoom-in', 'zoom-out'];
    for (const key of expectedKeys) {
      expect(ICONS).toHaveProperty(key);
    }
  });

  it('all values are non-empty strings containing SVG path elements', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(typeof paths).toBe('string');
      expect(paths.length).toBeGreaterThan(0);
      // Should contain at least one SVG element tag
      expect(paths).toMatch(/<(path|polyline|line|rect|circle|polygon|ellipse)\s/);
    }
  });
});

describe('icon', () => {
  it('returns an SVG string for a known icon', () => {
    const result = icon('save');
    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
    expect(result).toContain('viewBox="0 0 24 24"');
  });

  it('uses default size of 16', () => {
    const result = icon('save');
    expect(result).toContain('width="16"');
    expect(result).toContain('height="16"');
  });

  it('respects custom size parameter', () => {
    const result = icon('save', 24);
    expect(result).toContain('width="24"');
    expect(result).toContain('height="24"');
  });

  it('includes className when provided', () => {
    const result = icon('save', 16, 'my-icon');
    expect(result).toContain('class="icon my-icon"');
  });

  it('uses just "icon" class when className is empty', () => {
    const result = icon('save', 16, '');
    expect(result).toContain('class="icon"');
    expect(result).not.toContain('class="icon "');
  });

  it('returns fallback span with "?" for unknown icon', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = icon('nonexistent-icon');
    expect(result).toContain('<span');
    expect(result).toContain('?');
    expect(result).not.toContain('<svg');
    warnSpy.mockRestore();
  });

  it('logs a warning for unknown icon', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    icon('does-not-exist');
    expect(warnSpy).toHaveBeenCalledWith('Icon not found: does-not-exist');
    warnSpy.mockRestore();
  });

  it('fallback span uses the specified size', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = icon('nope', 32);
    expect(result).toContain('width:32px');
    expect(result).toContain('height:32px');
    warnSpy.mockRestore();
  });

  it('includes the icon path data in the SVG', () => {
    const result = icon('save');
    expect(result).toContain(ICONS['save']);
  });
});

describe('setIcon', () => {
  it('replaces innerHTML of .ribbon-icon child', () => {
    const innerSpan = document.createElement('span');
    innerSpan.className = 'ribbon-icon';
    innerSpan.textContent = 'old';
    const el = document.createElement('div');
    el.appendChild(innerSpan);

    setIcon(el, 'save', 20);
    expect(innerSpan.innerHTML).toContain('<svg');
    expect(innerSpan.innerHTML).toContain('width="20"');
  });

  it('replaces innerHTML of .icon child if no .ribbon-icon', () => {
    const innerSpan = document.createElement('span');
    innerSpan.className = 'icon';
    innerSpan.textContent = 'old';
    const el = document.createElement('div');
    el.appendChild(innerSpan);

    setIcon(el, 'download');
    expect(innerSpan.innerHTML).toContain('<svg');
  });

  it('does nothing when element is null', () => {
    expect(() => setIcon(null, 'save')).not.toThrow();
  });

  it('does nothing when no .ribbon-icon or .icon child exists', () => {
    const el = document.createElement('div');
    el.innerHTML = '<span class="other">text</span>';
    setIcon(el, 'save');
    expect(el.innerHTML).toContain('text'); // unchanged
  });

  it('prefers .ribbon-icon over .icon when both exist', () => {
    const el = document.createElement('div');
    const ribbonSpan = document.createElement('span');
    ribbonSpan.className = 'ribbon-icon';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    el.appendChild(ribbonSpan);
    el.appendChild(iconSpan);

    setIcon(el, 'trash', 18);
    expect(ribbonSpan.innerHTML).toContain('<svg');
    expect(iconSpan.innerHTML).toBe(''); // not touched
  });
});
