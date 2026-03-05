import { describe, it, expect } from 'vitest';
import { SHORTCUT_CATALOG, getCategories, getShortcuts, searchShortcuts } from '../js/keyboard-shortcuts.js';

describe('SHORTCUT_CATALOG', () => {
  it('contains expected categories', () => {
    expect(SHORTCUT_CATALOG).toHaveProperty('File');
    expect(SHORTCUT_CATALOG).toHaveProperty('Edit');
    expect(SHORTCUT_CATALOG).toHaveProperty('Navigation');
    expect(SHORTCUT_CATALOG).toHaveProperty('View');
    expect(SHORTCUT_CATALOG).toHaveProperty('Tools');
    expect(SHORTCUT_CATALOG).toHaveProperty('General');
  });

  it('each entry has label and keys', () => {
    for (const [, shortcuts] of Object.entries(SHORTCUT_CATALOG)) {
      for (const s of shortcuts) {
        expect(s).toHaveProperty('label');
        expect(s).toHaveProperty('keys');
        expect(typeof s.label).toBe('string');
        expect(typeof s.keys).toBe('string');
      }
    }
  });
});

describe('getCategories', () => {
  it('returns array of category names', () => {
    const cats = getCategories();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toContain('File');
    expect(cats).toContain('Edit');
  });
});

describe('getShortcuts', () => {
  it('returns shortcuts for a valid category', () => {
    const fileShortcuts = getShortcuts('File');
    expect(fileShortcuts.length).toBeGreaterThan(0);
    expect(fileShortcuts[0]).toHaveProperty('label');
  });

  it('returns empty array for unknown category', () => {
    expect(getShortcuts('Nonexistent')).toEqual([]);
  });
});

describe('searchShortcuts', () => {
  it('finds shortcuts by label', () => {
    const results = searchShortcuts('undo');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].label.toLowerCase()).toContain('undo');
  });

  it('finds shortcuts by key combo', () => {
    const results = searchShortcuts('Ctrl+S');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array for no match', () => {
    expect(searchShortcuts('xyznonexistent')).toEqual([]);
  });

  it('is case-insensitive', () => {
    const results = searchShortcuts('UNDO');
    expect(results.length).toBeGreaterThan(0);
  });
});
