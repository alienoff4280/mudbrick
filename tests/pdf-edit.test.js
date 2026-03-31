import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resetPdfLib,
  ensurePdfLib,
  rotatePage,
  deletePage,
  reorderPages,
  mergePDFs,
  splitPDF,
  addWatermark,
  appendPages,
  insertBlankPage,
  cropPages,
  replacePages,
  saveToBytes,
  getPdfLibDoc,
  setPdfLibDoc,
} from '../js/pdf-edit.js';

const fakePdfBytes = new Uint8Array([37, 80, 68, 70]);

/* ── Helper: build a fresh mock doc with configurable page count ── */
function makeMockDoc(pageCount = 3) {
  const pages = Array.from({ length: pageCount }, () => ({
    getSize: () => ({ width: 612, height: 792 }),
    getRotation: () => ({ angle: 0 }),
    setRotation: vi.fn(),
    getCropBox: () => ({ x: 0, y: 0, width: 612, height: 792 }),
    getMediaBox: () => ({ x: 0, y: 0, width: 612, height: 792 }),
    setCropBox: vi.fn(),
    drawText: vi.fn(),
    drawImage: vi.fn(),
    drawRectangle: vi.fn(),
  }));

  return {
    getPageCount: vi.fn(() => pageCount),
    getPage: vi.fn((idx) => pages[idx]),
    getPageIndices: vi.fn(() => Array.from({ length: pageCount }, (_, i) => i)),
    addPage: vi.fn(),
    insertPage: vi.fn(),
    removePage: vi.fn(() => { pageCount--; }),
    copyPages: vi.fn((_, indices) => Promise.resolve(indices.map(() => ({})))),
    save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
    embedFont: vi.fn(() => Promise.resolve({
      widthOfTextAtSize: () => 200,
    })),
  };
}

beforeEach(() => {
  resetPdfLib();

  const mockDoc = makeMockDoc(3);
  window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(mockDoc));
  window.PDFLib.PDFDocument.create.mockImplementation(() => Promise.resolve(makeMockDoc(0)));
});

/* ═══════════════════ ensurePdfLib / resetPdfLib ═══════════════════ */

describe('ensurePdfLib', () => {
  it('loads a pdf-lib document from bytes', async () => {
    const doc = await ensurePdfLib(fakePdfBytes);
    expect(doc).toBeDefined();
    expect(doc.getPageCount()).toBe(3);
  });

  it('returns the same document on subsequent calls (caches)', async () => {
    const doc1 = await ensurePdfLib(fakePdfBytes);
    const callsBefore = window.PDFLib.PDFDocument.load.mock.calls.length;
    const doc2 = await ensurePdfLib(fakePdfBytes);
    const callsAfter = window.PDFLib.PDFDocument.load.mock.calls.length;
    expect(doc1).toBe(doc2);
    // load should not be called again
    expect(callsAfter - callsBefore).toBe(0);
  });

  it('creates a new document after resetPdfLib', async () => {
    await ensurePdfLib(fakePdfBytes);
    const callsBefore = window.PDFLib.PDFDocument.load.mock.calls.length;
    resetPdfLib();
    expect(getPdfLibDoc()).toBeNull();
    await ensurePdfLib(fakePdfBytes);
    const callsAfter = window.PDFLib.PDFDocument.load.mock.calls.length;
    expect(callsAfter - callsBefore).toBe(1);
  });
});

/* ═══════════════════ saveToBytes ═══════════════════ */

describe('saveToBytes', () => {
  it('throws when no document is loaded', async () => {
    await expect(saveToBytes()).rejects.toThrow('No pdf-lib document loaded');
  });

  it('returns bytes from the loaded document', async () => {
    await ensurePdfLib(fakePdfBytes);
    const bytes = await saveToBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('calls save on the internal document', async () => {
    const doc = await ensurePdfLib(fakePdfBytes);
    await saveToBytes();
    expect(doc.save).toHaveBeenCalled();
  });
});

/* ═══════════════════ rotatePage ═══════════════════ */

describe('rotatePage', () => {
  it('rotates a page by 90 degrees', async () => {
    const result = await rotatePage(fakePdfBytes, 0, 90);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(window.PDFLib.degrees).toHaveBeenCalledWith(90);
  });

  it('rotates a page by 180 degrees', async () => {
    await rotatePage(fakePdfBytes, 1, 180);
    expect(window.PDFLib.degrees).toHaveBeenCalledWith(180);
  });

  it('rotates a page by 270 degrees', async () => {
    await rotatePage(fakePdfBytes, 2, 270);
    expect(window.PDFLib.degrees).toHaveBeenCalledWith(270);
  });

  it('accumulates rotation on a page that already has rotation', async () => {
    const doc = await ensurePdfLib(fakePdfBytes);
    // Override the first page to already have 90 degrees
    const page = doc.getPage(0);
    page.getRotation = () => ({ angle: 90 });

    resetPdfLib();
    setPdfLibDoc(doc);

    await rotatePage(fakePdfBytes, 0, 90);
    // (90 + 90) % 360 = 180
    expect(window.PDFLib.degrees).toHaveBeenCalledWith(180);
  });
});

/* ═══════════════════ deletePage ═══════════════════ */

describe('deletePage', () => {
  it('removes a page by index', async () => {
    const result = await deletePage(fakePdfBytes, 1);
    expect(result).toBeInstanceOf(Uint8Array);
    const doc = getPdfLibDoc();
    expect(doc.removePage).toHaveBeenCalledWith(1);
  });

  it('removes the first page (index 0)', async () => {
    await deletePage(fakePdfBytes, 0);
    const doc = getPdfLibDoc();
    expect(doc.removePage).toHaveBeenCalledWith(0);
  });

  it('throws when trying to delete the only remaining page', async () => {
    const singlePageDoc = makeMockDoc(1);
    window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(singlePageDoc));

    await expect(deletePage(fakePdfBytes, 0)).rejects.toThrow(
      'Cannot delete the only remaining page'
    );
  });

  it('returns valid PDF bytes after deletion', async () => {
    const bytes = await deletePage(fakePdfBytes, 0);
    expect(bytes[0]).toBe(37); // '%' — PDF magic number start
  });
});

/* ═══════════════════ insertBlankPage ═══════════════════ */

describe('insertBlankPage', () => {
  it('inserts a blank page after the given index', async () => {
    const result = await insertBlankPage(fakePdfBytes, 0);
    expect(result).toBeInstanceOf(Uint8Array);
    const doc = getPdfLibDoc();
    expect(doc.insertPage).toHaveBeenCalledWith(1, [612, 792]);
  });

  it('inserts at the beginning when afterIndex is -1', async () => {
    await insertBlankPage(fakePdfBytes, -1);
    const doc = getPdfLibDoc();
    expect(doc.insertPage).toHaveBeenCalledWith(0, expect.any(Array));
  });

  it('uses custom width and height when provided', async () => {
    await insertBlankPage(fakePdfBytes, 0, 800, 600);
    const doc = getPdfLibDoc();
    expect(doc.insertPage).toHaveBeenCalledWith(1, [800, 600]);
  });

  it('defaults to the reference page dimensions when none provided', async () => {
    await insertBlankPage(fakePdfBytes, 1);
    const doc = getPdfLibDoc();
    // Reference page at index 1 has 612x792
    expect(doc.insertPage).toHaveBeenCalledWith(2, [612, 792]);
  });
});

/* ═══════════════════ reorderPages ═══════════════════ */

describe('reorderPages', () => {
  it('returns unchanged bytes when from === to', async () => {
    const result = await reorderPages(fakePdfBytes, 1, 1);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('creates a new document with reordered pages', async () => {
    const result = await reorderPages(fakePdfBytes, 0, 2);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(window.PDFLib.PDFDocument.create).toHaveBeenCalled();
  });

  it('copies pages in the correct order', async () => {
    const mockCreated = makeMockDoc(0);
    window.PDFLib.PDFDocument.create.mockImplementation(() => Promise.resolve(mockCreated));

    await reorderPages(fakePdfBytes, 0, 2);
    // Expected order: [1, 2, 0] (move page 0 to index 2)
    expect(mockCreated.copyPages).toHaveBeenCalledWith(
      expect.anything(),
      [1, 2, 0]
    );
  });
});

/* ═══════════════════ mergePDFs ═══════════════════ */

describe('mergePDFs', () => {
  it('merges multiple PDF byte arrays into one', async () => {
    const files = [
      { bytes: new Uint8Array([1, 2]) },
      { bytes: new Uint8Array([3, 4]) },
    ];
    const result = await mergePDFs(files);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('calls PDFDocument.create for the merged document', async () => {
    await mergePDFs([{ bytes: fakePdfBytes }]);
    expect(window.PDFLib.PDFDocument.create).toHaveBeenCalled();
  });

  it('loads each input file', async () => {
    const callsBefore = window.PDFLib.PDFDocument.load.mock.calls.length;
    const files = [
      { bytes: new Uint8Array([1]) },
      { bytes: new Uint8Array([2]) },
      { bytes: new Uint8Array([3]) },
    ];
    await mergePDFs(files);
    const callsAfter = window.PDFLib.PDFDocument.load.mock.calls.length;
    // 3 donor loads
    expect(callsAfter - callsBefore).toBe(3);
  });
});

/* ═══════════════════ splitPDF ═══════════════════ */

describe('splitPDF', () => {
  it('splits a PDF into multiple documents by page ranges', async () => {
    const ranges = [[0, 1], [2]];
    const results = await splitPDF(fakePdfBytes, ranges);
    expect(results).toHaveLength(2);
    expect(results[0].bytes).toBeInstanceOf(Uint8Array);
  });

  it('assigns correct labels to split documents', async () => {
    const ranges = [[0, 1, 2], [3]];
    const results = await splitPDF(fakePdfBytes, ranges);
    expect(results[0].label).toBe('pages-1-3');
    expect(results[1].label).toBe('page-4');
  });

  it('handles a single-page range', async () => {
    const ranges = [[0]];
    const results = await splitPDF(fakePdfBytes, ranges);
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('page-1');
  });
});

/* ═══════════════════ addWatermark ═══════════════════ */

describe('addWatermark', () => {
  it('adds a watermark to all pages by default', async () => {
    const result = await addWatermark(fakePdfBytes, { text: 'DRAFT' });
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses default options when none provided', async () => {
    await addWatermark(fakePdfBytes);
    // Should call degrees with default rotation (-45)
    expect(window.PDFLib.degrees).toHaveBeenCalledWith(-45);
  });

  it('applies watermark only to the current page when pages="current"', async () => {
    const doc = await ensurePdfLib(fakePdfBytes);
    const drawTextCalls = [];
    for (let i = 0; i < 3; i++) {
      const page = doc.getPage(i);
      page.drawText = vi.fn();
      drawTextCalls.push(page.drawText);
    }

    resetPdfLib();
    setPdfLibDoc(doc);

    await addWatermark(fakePdfBytes, { pages: 'current', currentPage: 2 });
    // Only page index 1 (currentPage 2) should have drawText called
    expect(drawTextCalls[0]).not.toHaveBeenCalled();
    expect(drawTextCalls[1]).toHaveBeenCalled();
    expect(drawTextCalls[2]).not.toHaveBeenCalled();
  });

  it('parses hex color correctly', async () => {
    await addWatermark(fakePdfBytes, { color: '#FF0000' });
    expect(window.PDFLib.rgb).toHaveBeenCalledWith(1, 0, 0);
  });
});

/* ═══════════════════ appendPages ═══════════════════ */

describe('appendPages', () => {
  it('appends pages from additional PDFs to the base document', async () => {
    const result = await appendPages(fakePdfBytes, [{ bytes: fakePdfBytes }]);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('inserts pages at the specified position via new-doc pattern', async () => {
    const baseDoc = makeMockDoc(3);
    const createdDoc = makeMockDoc(0);
    window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(baseDoc));
    window.PDFLib.PDFDocument.create.mockImplementation(() => Promise.resolve(createdDoc));

    await appendPages(fakePdfBytes, [{ bytes: fakePdfBytes }], 0);
    // 3 base pages + 3 donor pages = 6 addPage calls
    expect(createdDoc.addPage).toHaveBeenCalledTimes(6);
    // copyPages called twice: once for base, once for donor
    expect(createdDoc.copyPages).toHaveBeenCalledTimes(2);
  });

  it('appends at the end when no insertAfter is specified', async () => {
    const baseDoc = makeMockDoc(3);
    const createdDoc = makeMockDoc(0);
    window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(baseDoc));
    window.PDFLib.PDFDocument.create.mockImplementation(() => Promise.resolve(createdDoc));

    await appendPages(fakePdfBytes, [{ bytes: fakePdfBytes }]);
    // 3 base pages + 3 donor pages = 6 addPage calls
    expect(createdDoc.addPage).toHaveBeenCalledTimes(6);
    expect(createdDoc.copyPages).toHaveBeenCalledTimes(2);
  });

  it('prepends donor pages when insertAfter is -1', async () => {
    const baseDoc = makeMockDoc(3);
    const donorPageObjs = [{id: 'd1'}, {id: 'd2'}];
    const basePageObjs = [{id: 'b1'}, {id: 'b2'}, {id: 'b3'}];
    const createdDoc = makeMockDoc(0);
    createdDoc.copyPages.mockImplementation((src) => {
      return Promise.resolve(src === baseDoc ? basePageObjs : donorPageObjs);
    });
    window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(baseDoc));
    window.PDFLib.PDFDocument.create.mockImplementation(() => Promise.resolve(createdDoc));

    const donorDoc = makeMockDoc(2);
    let loadCount = 0;
    window.PDFLib.PDFDocument.load.mockImplementation(() => {
      loadCount++;
      return Promise.resolve(loadCount === 1 ? baseDoc : donorDoc);
    });

    await appendPages(fakePdfBytes, [{ bytes: fakePdfBytes }], -1);
    // insertAfter=-1 means insertIdx=0, donor pages come first
    const addPageCalls = createdDoc.addPage.mock.calls.map(c => c[0]);
    expect(addPageCalls).toEqual([...donorPageObjs, ...basePageObjs]);
  });
});

/* ═══════════════════ cropPages ═══════════════════ */

describe('cropPages', () => {
  it('sets crop box on all pages by default', async () => {
    const doc = await ensurePdfLib(fakePdfBytes);
    const setCropBoxCalls = [];
    for (let i = 0; i < 3; i++) {
      const page = doc.getPage(i);
      setCropBoxCalls.push(page.setCropBox);
    }

    resetPdfLib();
    setPdfLibDoc(doc);

    await cropPages(fakePdfBytes, { top: 10, bottom: 10, left: 10, right: 10 });
    // All 3 pages should have setCropBox called
    setCropBoxCalls.forEach((fn) => expect(fn).toHaveBeenCalled());
  });

  it('only crops the current page when pages="current"', async () => {
    const doc = await ensurePdfLib(fakePdfBytes);
    const setCropBoxCalls = [];
    for (let i = 0; i < 3; i++) {
      const page = doc.getPage(i);
      setCropBoxCalls.push(page.setCropBox);
    }

    resetPdfLib();
    setPdfLibDoc(doc);

    await cropPages(fakePdfBytes, { top: 10, pages: 'current', currentPage: 2 });
    expect(setCropBoxCalls[0]).not.toHaveBeenCalled();
    expect(setCropBoxCalls[1]).toHaveBeenCalled();
    expect(setCropBoxCalls[2]).not.toHaveBeenCalled();
  });

  it('throws when crop margins are too large', async () => {
    await expect(
      cropPages(fakePdfBytes, { left: 300, right: 300 })
    ).rejects.toThrow('Crop margins too large');
  });
});

/* ═══════════════════ replacePages ═══════════════════ */

describe('replacePages', () => {
  it('replaces a page with one from the source document', async () => {
    const result = await replacePages(fakePdfBytes, fakePdfBytes, [
      { targetPage: 1, sourcePage: 1 },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('handles multiple replacement mappings', async () => {
    const mockDoc = makeMockDoc(3);
    window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(mockDoc));

    await replacePages(fakePdfBytes, fakePdfBytes, [
      { targetPage: 1, sourcePage: 2 },
      { targetPage: 3, sourcePage: 1 },
    ]);
    // removePage should be called for each valid mapping
    expect(mockDoc.removePage).toHaveBeenCalledTimes(2);
  });

  it('skips out-of-range page mappings', async () => {
    const mockDoc = makeMockDoc(3);
    window.PDFLib.PDFDocument.load.mockImplementation(() => Promise.resolve(mockDoc));

    await replacePages(fakePdfBytes, fakePdfBytes, [
      { targetPage: 99, sourcePage: 1 },
    ]);
    expect(mockDoc.removePage).not.toHaveBeenCalled();
  });
});

/* ═══════════════════ PDFLib not loaded ═══════════════════ */

describe('functions throw when PDFLib is not loaded', () => {
  it('ensurePdfLib throws when window.PDFLib is missing', async () => {
    const original = window.PDFLib;
    window.PDFLib = undefined;
    resetPdfLib();

    await expect(ensurePdfLib(fakePdfBytes)).rejects.toThrow();
    window.PDFLib = original;
  });

  it('rotatePage throws when window.PDFLib is missing', async () => {
    const original = window.PDFLib;
    window.PDFLib = undefined;
    resetPdfLib();

    await expect(rotatePage(fakePdfBytes, 0, 90)).rejects.toThrow();
    window.PDFLib = original;
  });

  it('mergePDFs throws when window.PDFLib is missing', async () => {
    const original = window.PDFLib;
    window.PDFLib = undefined;
    resetPdfLib();

    await expect(mergePDFs([{ bytes: fakePdfBytes }])).rejects.toThrow();
    window.PDFLib = original;
  });
});
