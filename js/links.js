/**
 * Mudbrick — Link Annotations
 * Create, edit, and follow hyperlinks on PDF pages.
 */

const getFabric = () => window.fabric;

/**
 * Create a link rectangle on the Fabric canvas.
 */
export function createLinkRect(fabricCanvas, x, y, w, h, opts = {}) {
  const fabric = getFabric();
  const rect = new fabric.Rect({
    left: x, top: y, width: w, height: h,
    fill: 'rgba(0, 100, 255, 0.08)',
    stroke: '#0066cc',
    strokeWidth: 1,
    strokeDashArray: [4, 3],
    selectable: true,
    evented: true,
    mudbrickType: 'link',
    linkType: opts.linkType || 'url',
    linkURL: opts.linkURL || '',
    linkPage: opts.linkPage || 1,
  });
  fabricCanvas.add(rect);
  fabricCanvas.setActiveObject(rect);
  return rect;
}

/**
 * Follow a link — open URL or navigate to page.
 */
/**
 * Ensure a URL has a protocol prefix.
 */
export function normalizeURL(url) {
  if (!url) return url;
  url = url.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    return 'https://' + url;
  }
  return url;
}

export function followLink(obj, goToPageFn) {
  if (!obj || obj.mudbrickType !== 'link') return;
  if (obj.linkType === 'url') {
    if (!obj.linkURL) return;
    const url = normalizeURL(obj.linkURL);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else if (obj.linkType === 'page' && obj.linkPage) {
    goToPageFn(obj.linkPage);
  }
}

/**
 * Read existing link annotations from a PDF page using pdf-lib.
 * Returns array of { x, y, width, height, type, url, page }.
 */
export function extractLinksFromPage(pdfPage, pageHeight) {
  const PDFLib = window.PDFLib;
  const links = [];
  const annotsRef = pdfPage.node.lookup(PDFLib.PDFName.of('Annots'));
  if (!annotsRef || !(annotsRef instanceof PDFLib.PDFArray)) return links;

  for (let i = 0; i < annotsRef.size(); i++) {
    const annotDict = annotsRef.lookup(i);
    if (!annotDict) continue;
    const subtype = annotDict.lookup(PDFLib.PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Link') continue;

    const rect = annotDict.lookup(PDFLib.PDFName.of('Rect'));
    if (!rect) continue;
    const [x1, y1, x2, y2] = rect.asArray().map(n => n.asNumber());

    const action = annotDict.lookup(PDFLib.PDFName.of('A'));
    let linkType = 'url', url = '', page = 1;
    if (action) {
      const sType = action.lookup(PDFLib.PDFName.of('S'));
      if (sType && sType.toString() === '/URI') {
        const uriObj = action.lookup(PDFLib.PDFName.of('URI'));
        url = uriObj?.decodeText ? uriObj.decodeText() : (uriObj?.toString() || '');
        linkType = 'url';
      } else if (sType && sType.toString() === '/GoTo') {
        linkType = 'page';
      }
    }

    links.push({
      x: Math.min(x1, x2),
      y: pageHeight - Math.max(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      type: linkType, url, page,
    });
  }
  return links;
}

/**
 * Write a Fabric link object as a real PDF link annotation on export.
 */
export function writeLinkToPDF(page, linkObj, canvasW, canvasH, pageW, pageH) {
  const PDFLib = window.PDFLib;
  const sx = pageW / canvasW;
  const sy = pageH / canvasH;

  const x1 = (linkObj.left || 0) * sx;
  const y1 = pageH - ((linkObj.top || 0) * sy) - ((linkObj.height || 0) * (linkObj.scaleY || 1) * sy);
  const x2 = x1 + (linkObj.width || 0) * (linkObj.scaleX || 1) * sx;
  const y2 = y1 + (linkObj.height || 0) * (linkObj.scaleY || 1) * sy;

  const context = page.node.context;
  const annotDict = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x1, y1, x2, y2],
    Border: [0, 0, 0],
    A: linkObj.linkType === 'url'
      ? { S: 'URI', URI: PDFLib.PDFString.of(normalizeURL(linkObj.linkURL) || '') }
      : { S: 'GoTo', D: PDFLib.PDFString.of(`page${linkObj.linkPage || 1}`) },
  });

  const existingAnnots = page.node.lookup(PDFLib.PDFName.of('Annots'));
  if (existingAnnots instanceof PDFLib.PDFArray) {
    existingAnnots.push(context.register(annotDict));
  } else {
    page.node.set(PDFLib.PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  }
}
