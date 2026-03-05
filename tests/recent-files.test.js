import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRecentFiles, addRecentFile, removeRecentFile,
  clearRecentFiles, hasRecentFiles,
} from '../js/recent-files.js';

describe('recent-files', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getRecentFiles', () => {
    it('returns empty array when no files stored', () => {
      expect(getRecentFiles()).toEqual([]);
    });

    it('returns stored files', () => {
      addRecentFile({ name: 'test.pdf', size: 1024, pages: 5 });
      const files = getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('test.pdf');
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem('mudbrick-recent-files', 'not-json');
      expect(getRecentFiles()).toEqual([]);
    });
  });

  describe('addRecentFile', () => {
    it('adds a file to the list', () => {
      addRecentFile({ name: 'a.pdf', size: 100 });
      expect(getRecentFiles()).toHaveLength(1);
    });

    it('moves existing file to top', () => {
      addRecentFile({ name: 'a.pdf' });
      addRecentFile({ name: 'b.pdf' });
      addRecentFile({ name: 'a.pdf' });
      const files = getRecentFiles();
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('a.pdf');
    });

    it('caps at 10 files', () => {
      for (let i = 0; i < 15; i++) {
        addRecentFile({ name: `file${i}.pdf` });
      }
      expect(getRecentFiles()).toHaveLength(10);
    });

    it('ignores null/undefined input', () => {
      addRecentFile(null);
      addRecentFile(undefined);
      addRecentFile({});
      expect(getRecentFiles()).toEqual([]);
    });

    it('sets openedAt timestamp', () => {
      addRecentFile({ name: 'test.pdf' });
      const files = getRecentFiles();
      expect(files[0].openedAt).toBeDefined();
    });
  });

  describe('removeRecentFile', () => {
    it('removes a file by name', () => {
      addRecentFile({ name: 'a.pdf' });
      addRecentFile({ name: 'b.pdf' });
      removeRecentFile('a.pdf');
      const files = getRecentFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('b.pdf');
    });

    it('does nothing if file not found', () => {
      addRecentFile({ name: 'a.pdf' });
      removeRecentFile('nonexistent.pdf');
      expect(getRecentFiles()).toHaveLength(1);
    });
  });

  describe('clearRecentFiles', () => {
    it('clears all recent files', () => {
      addRecentFile({ name: 'a.pdf' });
      addRecentFile({ name: 'b.pdf' });
      clearRecentFiles();
      expect(getRecentFiles()).toEqual([]);
    });
  });

  describe('hasRecentFiles', () => {
    it('returns false when empty', () => {
      expect(hasRecentFiles()).toBe(false);
    });

    it('returns true when files exist', () => {
      addRecentFile({ name: 'test.pdf' });
      expect(hasRecentFiles()).toBe(true);
    });
  });
});
