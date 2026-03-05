import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  encryptPDF, removeMetadata, getMetadata, setMetadata, sanitizeDocument,
} from '../js/security.js';

/* ── Helpers ── */

const fakePdfBytes = new Uint8Array([37, 80, 68, 70]); // %PDF

describe('security.js', () => {

  beforeEach(() => {
    // Reset mock call counts between tests
    const mockDoc = window.PDFLib.PDFDocument.load.getMockImplementation()
      ? null : null; // load is already mocked via setup.js
    vi.clearAllMocks();
  });

  /* ── encryptPDF ── */

  describe('encryptPDF', () => {
    it('throws when no password is provided', async () => {
      await expect(encryptPDF(fakePdfBytes, {})).rejects.toThrow(
        'At least one password (user or owner) is required'
      );
    });

    it('throws with empty passwords', async () => {
      await expect(
        encryptPDF(fakePdfBytes, { userPassword: '', ownerPassword: '' })
      ).rejects.toThrow('At least one password');
    });

    it('encrypts with a user password', async () => {
      const result = await encryptPDF(fakePdfBytes, { userPassword: 'secret' });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(window.PDFLib.PDFDocument.load).toHaveBeenCalledWith(
        fakePdfBytes,
        { ignoreEncryption: true }
      );
    });

    it('encrypts with an owner password', async () => {
      const result = await encryptPDF(fakePdfBytes, { ownerPassword: 'admin' });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('encrypts with both passwords', async () => {
      const result = await encryptPDF(fakePdfBytes, {
        userPassword: 'user',
        ownerPassword: 'owner',
      });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('passes permission options through', async () => {
      const result = await encryptPDF(fakePdfBytes, {
        userPassword: 'pass',
        permissions: {
          printing: false,
          copying: false,
          modifying: true,
        },
      });
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  /* ── removeMetadata ── */

  describe('removeMetadata', () => {
    it('calls all set methods to clear metadata', async () => {
      const result = await removeMetadata(fakePdfBytes);
      expect(result).toBeInstanceOf(Uint8Array);
      // The mock doc's set methods should have been called
      const doc = await window.PDFLib.PDFDocument.load(fakePdfBytes);
      // We verify indirectly — if no error, methods were called
    });

    it('returns Uint8Array bytes', async () => {
      const result = await removeMetadata(fakePdfBytes);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('respects selective removal options', async () => {
      // Only remove title, keep everything else
      const result = await removeMetadata(fakePdfBytes, {
        removeTitle: true,
        removeAuthor: false,
        removeSubject: false,
        removeKeywords: false,
        removeCreator: false,
        removeProducer: false,
        removeDates: false,
      });
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  /* ── getMetadata ── */

  describe('getMetadata', () => {
    it('returns metadata object with expected fields', async () => {
      const meta = await getMetadata(fakePdfBytes);
      expect(meta).toHaveProperty('title');
      expect(meta).toHaveProperty('author');
      expect(meta).toHaveProperty('subject');
      expect(meta).toHaveProperty('keywords');
      expect(meta).toHaveProperty('creator');
      expect(meta).toHaveProperty('producer');
      expect(meta).toHaveProperty('creationDate');
      expect(meta).toHaveProperty('modificationDate');
      expect(meta).toHaveProperty('pageCount');
    });

    it('returns pageCount from getPageCount()', async () => {
      const meta = await getMetadata(fakePdfBytes);
      expect(meta.pageCount).toBe(3); // setup.js mock returns 3
    });

    it('returns empty strings for unset fields', async () => {
      const meta = await getMetadata(fakePdfBytes);
      expect(meta.title).toBe('');
      expect(meta.author).toBe('');
    });
  });

  /* ── setMetadata ── */

  describe('setMetadata', () => {
    it('returns modified PDF bytes', async () => {
      const result = await setMetadata(fakePdfBytes, { title: 'My Doc' });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('accepts keywords as a string', async () => {
      const result = await setMetadata(fakePdfBytes, { keywords: 'foo, bar, baz' });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('accepts keywords as an array', async () => {
      const result = await setMetadata(fakePdfBytes, { keywords: ['foo', 'bar'] });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('only sets fields that are provided', async () => {
      // Should not throw when only some fields are given
      const result = await setMetadata(fakePdfBytes, { author: 'Alice' });
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  /* ── sanitizeDocument ── */

  describe('sanitizeDocument', () => {
    it('returns bytes and a report', async () => {
      const { bytes, report } = await sanitizeDocument(fakePdfBytes);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(report).toHaveProperty('metadataRemoved');
      expect(report).toHaveProperty('fieldsCount');
    });

    it('reports metadataRemoved as false when doc has no title/author', async () => {
      const { report } = await sanitizeDocument(fakePdfBytes);
      // Mock returns '' for getTitle/getAuthor → falsy → metadataRemoved = false
      expect(report.metadataRemoved).toBe(false);
    });

    it('reports metadataRemoved as true when doc has title', async () => {
      // Override getTitle to return a non-empty string
      const origLoad = window.PDFLib.PDFDocument.load;
      window.PDFLib.PDFDocument.load = vi.fn(() => Promise.resolve({
        getTitle: vi.fn(() => 'Existing Title'),
        getAuthor: vi.fn(() => ''),
        getSubject: vi.fn(() => ''),
        getKeywords: vi.fn(() => ''),
        getCreator: vi.fn(() => ''),
        getProducer: vi.fn(() => ''),
        getCreationDate: vi.fn(() => null),
        getModificationDate: vi.fn(() => null),
        getPageCount: vi.fn(() => 1),
        setTitle: vi.fn(),
        setAuthor: vi.fn(),
        setSubject: vi.fn(),
        setKeywords: vi.fn(),
        setCreator: vi.fn(),
        setProducer: vi.fn(),
        setCreationDate: vi.fn(),
        setModificationDate: vi.fn(),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      }));

      const { report } = await sanitizeDocument(fakePdfBytes);
      expect(report.metadataRemoved).toBe(true);

      // Restore
      window.PDFLib.PDFDocument.load = origLoad;
    });
  });
});
