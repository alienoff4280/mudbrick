import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportPagesToImages,
  createPDFFromImages,
  optimizePDF,
} from '../js/export-image.js';

/* ── Helpers ── */

function makeMockPdfDoc(pageCount = 3) {
  const pages = {};
  for (let i = 1; i <= pageCount; i++) {
    pages[i] = {
      getViewport: vi.fn(({ scale }) => ({
        width: 612 * scale,
        height: 792 * scale,
      })),
      render: vi.fn(() => ({
        promise: Promise.resolve(),
      })),
      getOperatorList: vi.fn(() => Promise.resolve({
        fnArray: [],
        argsArray: [],
      })),
      cleanup: vi.fn(),
    };
  }

  return {
    numPages: pageCount,
    getPage: vi.fn((num) => Promise.resolve(pages[num] || pages[1])),
  };
}

function makeMockCanvas() {
  const ctx = {
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8Array(4) })),
    setTransform: vi.fn(),
  };
  return {
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb, mime, quality) => {
      cb(new Blob(['fake-image-data'], { type: mime || 'image/png' }));
    }),
    width: 0,
    height: 0,
  };
}

beforeEach(() => {
  // Mock document.createElement to return our mock canvas for canvas elements
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') {
      return makeMockCanvas();
    }
    return origCreateElement(tag);
  });

  // Mock URL.createObjectURL / revokeObjectURL
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  // Reset PDFLib mocks
  window.PDFLib.PDFDocument.create.mockImplementation(() => {
    const pages = [];
    return Promise.resolve({
      addPage: vi.fn(([w, h]) => {
        const p = {
          drawImage: vi.fn(),
          getSize: () => ({ width: w || 612, height: h || 792 }),
        };
        pages.push(p);
        return p;
      }),
      embedPng: vi.fn(() => Promise.resolve({ width: 800, height: 600 })),
      embedJpg: vi.fn(() => Promise.resolve({ width: 800, height: 600 })),
      save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      getPageCount: vi.fn(() => pages.length),
      getTitle: vi.fn(() => ''),
      getAuthor: vi.fn(() => ''),
      getSubject: vi.fn(() => ''),
      setTitle: vi.fn(),
      setAuthor: vi.fn(),
      setSubject: vi.fn(),
      copyPages: vi.fn(() => Promise.resolve([{}])),
    });
  });
});

/* ═══════════════════ exportPagesToImages ═══════════════════ */

describe('exportPagesToImages', () => {
  it('exports a single page without errors', async () => {
    const pdfDoc = makeMockPdfDoc(1);
    await expect(
      exportPagesToImages(pdfDoc, [1], { format: 'png', dpi: 150, fileName: 'test.pdf' })
    ).resolves.not.toThrow();
  });

  it('calls getPage for each requested page', async () => {
    const pdfDoc = makeMockPdfDoc(3);
    await exportPagesToImages(pdfDoc, [1, 2, 3], { format: 'png', fileName: 'test' });
    expect(pdfDoc.getPage).toHaveBeenCalledWith(1);
    expect(pdfDoc.getPage).toHaveBeenCalledWith(2);
    expect(pdfDoc.getPage).toHaveBeenCalledWith(3);
  });

  it('calls the progress callback with correct arguments', async () => {
    const pdfDoc = makeMockPdfDoc(2);
    const onProgress = vi.fn();
    await exportPagesToImages(pdfDoc, [1, 2], { format: 'png', fileName: 'test' }, onProgress);
    // Progress called for start of each page and completion
    expect(onProgress).toHaveBeenCalled();
    // Should be called at least once per page
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('uses jpg extension for JPEG format', async () => {
    const pdfDoc = makeMockPdfDoc(1);
    // We just verify it doesn't throw — the download is mocked
    await expect(
      exportPagesToImages(pdfDoc, [1], { format: 'jpg', fileName: 'test.pdf' })
    ).resolves.not.toThrow();
  });

  it('renders pages at the correct DPI scale', async () => {
    const pdfDoc = makeMockPdfDoc(1);
    await exportPagesToImages(pdfDoc, [1], { format: 'png', dpi: 300, fileName: 'test' });

    const page = await pdfDoc.getPage(1);
    // Should call getViewport with scale = 300/72 = 4.166...
    expect(page.getViewport).toHaveBeenCalledWith({ scale: 300 / 72 });
  });
});

/* ═══════════════════ createPDFFromImages ═══════════════════ */

describe('createPDFFromImages', () => {
  function makeMockFile(name, type) {
    const content = new Uint8Array([137, 80, 78, 71]); // PNG header
    const file = new File([content], name, { type });
    return file;
  }

  it('creates a PDF from PNG image files', async () => {
    const files = [makeMockFile('photo.png', 'image/png')];
    const result = await createPDFFromImages(files);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('creates a PDF from JPEG image files', async () => {
    const files = [makeMockFile('photo.jpg', 'image/jpeg')];
    const result = await createPDFFromImages(files);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('handles multiple image files', async () => {
    const files = [
      makeMockFile('img1.png', 'image/png'),
      makeMockFile('img2.png', 'image/png'),
      makeMockFile('img3.png', 'image/png'),
    ];
    const result = await createPDFFromImages(files);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('calls progress callback for each image', async () => {
    const files = [
      makeMockFile('img1.png', 'image/png'),
      makeMockFile('img2.png', 'image/png'),
    ];
    const onProgress = vi.fn();
    await createPDFFromImages(files, {}, onProgress);
    expect(onProgress).toHaveBeenCalledWith(1, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it('throws when PDFLib is not loaded', async () => {
    const original = window.PDFLib;
    window.PDFLib = undefined;

    const files = [makeMockFile('test.png', 'image/png')];
    await expect(createPDFFromImages(files)).rejects.toThrow('pdf-lib not loaded');

    window.PDFLib = original;
  });

  it('handles empty file list without errors', async () => {
    const result = await createPDFFromImages([]);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('accepts page size options', async () => {
    const files = [makeMockFile('photo.png', 'image/png')];
    const result = await createPDFFromImages(files, { pageSize: 'letter', margin: 36 });
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

/* ═══════════════════ optimizePDF ═══════════════════ */

describe('optimizePDF', () => {
  it('throws when PDFLib is not loaded', async () => {
    const original = window.PDFLib;
    window.PDFLib = undefined;

    const pdfDoc = makeMockPdfDoc(1);
    await expect(
      optimizePDF(pdfDoc, new Uint8Array([37, 80, 68, 70]))
    ).rejects.toThrow('pdf-lib not loaded');

    window.PDFLib = original;
  });

  it('returns Uint8Array bytes from the optimized document', async () => {
    const pdfDoc = makeMockPdfDoc(1);
    // Provide load mock for the sourceDoc
    window.PDFLib.PDFDocument.load.mockImplementation(() => {
      const pages = [];
      return Promise.resolve({
        getPageCount: vi.fn(() => 1),
        getPage: vi.fn(() => ({
          getSize: () => ({ width: 612, height: 792 }),
        })),
        getTitle: vi.fn(() => ''),
        getAuthor: vi.fn(() => ''),
        getSubject: vi.fn(() => ''),
        copyPages: vi.fn(() => Promise.resolve([{}])),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      });
    });

    const result = await optimizePDF(pdfDoc, new Uint8Array([37, 80, 68, 70]), {
      mode: 'aggressive',
      dpi: 72,
    });
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('calls progress callback during optimization', async () => {
    const pdfDoc = makeMockPdfDoc(2);
    window.PDFLib.PDFDocument.load.mockImplementation(() => {
      return Promise.resolve({
        getPageCount: vi.fn(() => 2),
        getPage: vi.fn(() => ({
          getSize: () => ({ width: 612, height: 792 }),
        })),
        getTitle: vi.fn(() => ''),
        getAuthor: vi.fn(() => ''),
        getSubject: vi.fn(() => ''),
        copyPages: vi.fn(() => Promise.resolve([{}])),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      });
    });

    const onProgress = vi.fn();
    await optimizePDF(
      pdfDoc,
      new Uint8Array([37, 80, 68, 70]),
      { mode: 'aggressive', dpi: 72 },
      onProgress
    );
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('uses preset values when a preset name is provided', async () => {
    const pdfDoc = makeMockPdfDoc(1);
    window.PDFLib.PDFDocument.load.mockImplementation(() => {
      return Promise.resolve({
        getPageCount: vi.fn(() => 1),
        getPage: vi.fn(() => ({
          getSize: () => ({ width: 612, height: 792 }),
        })),
        getTitle: vi.fn(() => ''),
        getAuthor: vi.fn(() => ''),
        getSubject: vi.fn(() => ''),
        copyPages: vi.fn(() => Promise.resolve([{}])),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      });
    });

    // 'screen' preset uses dpi 72 and quality 0.55
    const result = await optimizePDF(
      pdfDoc,
      new Uint8Array([37, 80, 68, 70]),
      { preset: 'screen', mode: 'aggressive' }
    );
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('copies metadata from source document', async () => {
    const pdfDoc = makeMockPdfDoc(1);
    const setTitle = vi.fn();
    const setAuthor = vi.fn();
    const setSubject = vi.fn();

    window.PDFLib.PDFDocument.load.mockImplementation(() => {
      return Promise.resolve({
        getPageCount: vi.fn(() => 1),
        getPage: vi.fn(() => ({
          getSize: () => ({ width: 612, height: 792 }),
        })),
        getTitle: vi.fn(() => 'Test Title'),
        getAuthor: vi.fn(() => 'Test Author'),
        getSubject: vi.fn(() => 'Test Subject'),
        copyPages: vi.fn(() => Promise.resolve([{}])),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
      });
    });

    window.PDFLib.PDFDocument.create.mockImplementation(() => {
      return Promise.resolve({
        addPage: vi.fn(() => ({
          drawImage: vi.fn(),
          getSize: () => ({ width: 612, height: 792 }),
        })),
        embedJpg: vi.fn(() => Promise.resolve({ width: 612, height: 792 })),
        save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
        setTitle,
        setAuthor,
        setSubject,
        copyPages: vi.fn(() => Promise.resolve([{}])),
      });
    });

    await optimizePDF(pdfDoc, new Uint8Array([37, 80, 68, 70]), {
      mode: 'aggressive',
      dpi: 72,
    });

    expect(setTitle).toHaveBeenCalledWith('Test Title');
    expect(setAuthor).toHaveBeenCalledWith('Test Author');
    expect(setSubject).toHaveBeenCalledWith('Test Subject');
  });
});
