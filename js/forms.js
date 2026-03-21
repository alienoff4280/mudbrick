/**
 * Mudbrick — Forms (Phase 6)
 * PDF form field detection and filling via pdf-lib, with PDF.js fallback.
 *
 * Architecture:
 * - Primary: Detects AcroForm fields using pdf-lib's getForm() API
 * - Fallback: Uses PDF.js page.getAnnotations() for PDFs that pdf-lib can't parse
 * - Renders HTML overlays positioned over form fields
 * - Writes filled values back to pdf-lib on export (when available)
 *
 * Supported field types:
 * - Text fields (PDFTextField / Widget.Tx)
 * - Checkboxes (PDFCheckBox / Widget.Btn)
 * - Dropdowns (PDFDropdown / Widget.Ch)
 * - Radio buttons (PDFRadioGroup / Widget.Btn)
 */

const getPDFLib = () => window.PDFLib;

/* ═══════════════════ State ═══════════════════ */

let formFieldValues = {}; // { fieldName: value }
let formOverlayContainer = null;
let _pdjsFieldSource = false; // true when fields came from PDF.js fallback

/* ═══════════════════ Detection ═══════════════════ */

/**
 * Detect all form fields in the PDF via pdf-lib.
 * @param {PDFDocument} pdfLibDoc - pdf-lib document
 * @returns {Array} Field descriptors
 */
export function detectFormFields(pdfLibDoc) {
  const PDFLib = getPDFLib();
  if (!pdfLibDoc || !PDFLib) return [];

  try {
    const form = pdfLibDoc.getForm();
    const fields = form.getFields();
    const result = fields.map(field => describeField(field, PDFLib));
    _pdjsFieldSource = false;
    return result;
  } catch (e) {
    // PDF has no form or pdf-lib can't parse it
    return [];
  }
}

/**
 * Fallback: detect form fields using PDF.js annotations API.
 * Works on complex PDFs that pdf-lib can't parse (e.g. USCIS forms).
 * @param {PDFDocumentProxy} pdfJsDoc - PDF.js document
 * @returns {Promise<Array>} Field descriptors with per-page rect info
 */
export async function detectFormFieldsPdfJs(pdfJsDoc) {
  if (!pdfJsDoc) return [];

  const allFields = [];
  const seenNames = new Set();

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const annotations = await page.getAnnotations({ intent: 'display' });
    const viewport = page.getViewport({ scale: 1.0 });

    for (const annot of annotations) {
      if (annot.subtype !== 'Widget') continue;

      const name = annot.fieldName || `field_${annot.id}`;
      const rect = annot.rect; // [x1, y1, x2, y2] in PDF coords (bottom-left origin)
      if (!rect || rect.length < 4) continue;

      const type = mapPdfJsFieldType(annot);
      if (type === 'button' || type === 'signature') continue;

      const descriptor = {
        name,
        type,
        readOnly: annot.readOnly || false,
        value: extractPdfJsValue(annot, type),
        _pdfjs: true, // mark as PDF.js-sourced
        _page: i, // 1-based page number
        _rect: rect, // raw PDF coords [x1, y1, x2, y2]
        _pageHeight: viewport.height / viewport.scale,
      };

      if (type === 'dropdown' || type === 'radio') {
        descriptor.options = annot.options?.map(o => o.displayValue || o.exportValue || '') || [];
      }
      if (annot.maxLen) descriptor.maxLength = annot.maxLen;

      // Dedupe by name+page (some forms have multiple widgets per field)
      const key = `${name}::${i}`;
      if (!seenNames.has(key)) {
        seenNames.add(key);
        allFields.push(descriptor);
      }
    }
  }

  _pdjsFieldSource = allFields.length > 0;
  return allFields;
}

function mapPdfJsFieldType(annot) {
  const ft = annot.fieldType;
  if (ft === 'Tx') return 'text';
  if (ft === 'Ch') return annot.combo ? 'dropdown' : 'dropdown';
  if (ft === 'Btn') {
    if (annot.radioButton) return 'radio';
    if (annot.checkBox) return 'checkbox';
    return 'button';
  }
  if (ft === 'Sig') return 'signature';
  return 'text'; // default to text for unknown widget types
}

function extractPdfJsValue(annot, type) {
  switch (type) {
    case 'text': return annot.fieldValue || '';
    case 'checkbox': return annot.fieldValue === annot.exportValue || annot.fieldValue === 'Yes';
    case 'dropdown': return annot.fieldValue || '';
    case 'radio': return annot.fieldValue || '';
    default: return '';
  }
}

/** @returns {boolean} Whether fields were detected via PDF.js fallback */
export function isUsingPdfJsFallback() {
  return _pdjsFieldSource;
}

function describeField(field, PDFLib) {
  const name = field.getName();
  const type = getFieldType(field, PDFLib);

  const descriptor = {
    name,
    type,
    readOnly: field.isReadOnly?.() ?? false,
  };

  // Get current value
  switch (type) {
    case 'text': {
      const tf = field;
      descriptor.value = tf.getText?.() || '';
      descriptor.maxLength = tf.getMaxLength?.() ?? undefined;
      break;
    }
    case 'checkbox': {
      const cb = field;
      descriptor.value = cb.isChecked?.() ?? false;
      break;
    }
    case 'dropdown': {
      const dd = field;
      descriptor.options = dd.getOptions?.() || [];
      descriptor.value = dd.getSelected?.() || [];
      break;
    }
    case 'radio': {
      const rg = field;
      descriptor.options = rg.getOptions?.() || [];
      descriptor.value = rg.getSelected?.() || '';
      break;
    }
  }

  return descriptor;
}

function getFieldType(field, PDFLib) {
  if (field instanceof PDFLib.PDFTextField) return 'text';
  if (field instanceof PDFLib.PDFCheckBox) return 'checkbox';
  if (field instanceof PDFLib.PDFDropdown) return 'dropdown';
  if (field instanceof PDFLib.PDFRadioGroup) return 'radio';
  if (field instanceof PDFLib.PDFButton) return 'button';
  if (field instanceof PDFLib.PDFSignature) return 'signature';
  return 'unknown';
}

/* ═══════════════════ Rendering ═══════════════════ */

/**
 * Create the form overlay container and render field inputs.
 * @param {HTMLElement} pageContainer - The page container element
 * @param {Array} fields - Field descriptors from detectFormFields
 * @param {Object} pdfLibDoc - pdf-lib document (for widget lookup)
 * @param {number} pageIndex - 0-based page index
 * @param {number} zoom - Current zoom level
 * @param {Object} pageSize - { width, height } of the PDF page
 */
export function renderFormOverlay(pageContainer, fields, pdfLibDoc, pageIndex, zoom, pageSize) {
  // Remove existing overlay
  clearFormOverlay();

  if (!fields || fields.length === 0) return;

  formOverlayContainer = document.createElement('div');
  formOverlayContainer.id = 'form-overlay';
  formOverlayContainer.style.cssText = `
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 4;
  `;
  pageContainer.appendChild(formOverlayContainer);

  // Check if fields are from PDF.js fallback
  const isPdfJs = fields[0]?._pdfjs;

  if (isPdfJs) {
    _renderPdfJsFields(fields, pageIndex, zoom);
  } else {
    _renderPdfLibFields(fields, pdfLibDoc, pageIndex, zoom);
  }
}

/** Render fields detected via PDF.js annotations */
function _renderPdfJsFields(fields, pageIndex, zoom) {
  const pageNum = pageIndex + 1; // 1-based
  const pageFields = fields.filter(f => f._page === pageNum);

  for (const fieldDesc of pageFields) {
    if (fieldDesc.readOnly || fieldDesc.type === 'button' || fieldDesc.type === 'signature') continue;

    const [x1, y1, x2, y2] = fieldDesc._rect;
    const pdfH = fieldDesc._pageHeight;
    // PDF coords: bottom-left origin → CSS: top-left origin
    const w = (x2 - x1) * zoom;
    const h = (y2 - y1) * zoom;
    const x = x1 * zoom;
    const y = (pdfH - y2) * zoom;

    _appendFieldElement(fieldDesc, x, y, w, h);
  }
}

/** Render fields detected via pdf-lib */
function _renderPdfLibFields(fields, pdfLibDoc, pageIndex, zoom) {
  const PDFLib = getPDFLib();
  if (!pdfLibDoc || !PDFLib) return;

  let form, pdfH;
  try {
    form = pdfLibDoc.getForm();
    const page = pdfLibDoc.getPage(pageIndex);
    pdfH = page.getSize().height;
  } catch { return; }

  for (const fieldDesc of fields) {
    if (fieldDesc.readOnly || fieldDesc.type === 'button' || fieldDesc.type === 'signature') continue;

    let field;
    try { field = form.getField(fieldDesc.name); } catch { continue; }
    if (!field) continue;

    const widgets = field.acroField?.getWidgets?.() || [];

    for (const widget of widgets) {
      const rect = widget.getRectangle();
      if (!rect) continue;

      const widgetPage = widget.P?.();
      const pageRef = pdfLibDoc.getPage(pageIndex).ref;
      if (widgetPage && pageRef && widgetPage !== pageRef) continue;

      const x = rect.x * zoom;
      const y = (pdfH - rect.y - rect.height) * zoom;
      const w = rect.width * zoom;
      const h = rect.height * zoom;

      _appendFieldElement(fieldDesc, x, y, w, h);
    }
  }
}

/** Create and position a form field element in the overlay */
function _appendFieldElement(fieldDesc, x, y, w, h) {
  const el = createFieldElement(fieldDesc, w, h);
  if (!el) return;

  el.style.position = 'absolute';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.pointerEvents = 'auto';

  if (formFieldValues[fieldDesc.name] !== undefined) {
    setElementValue(el, fieldDesc.type, formFieldValues[fieldDesc.name]);
    el.dispatchEvent(new Event('input'));
  }

  el.addEventListener('change', () => {
    formFieldValues[fieldDesc.name] = getElementValue(el, fieldDesc.type);
  });
  el.addEventListener('input', () => {
    formFieldValues[fieldDesc.name] = getElementValue(el, fieldDesc.type);
  });

  formOverlayContainer.appendChild(el);
}

function createFieldElement(fieldDesc, w, h) {
  const emptyBg = 'rgba(200, 220, 255, 0.15)';
  const filledBg = 'rgba(255, 255, 255, 1)';
  const baseStyle = `
    font-family: Helvetica, Arial, sans-serif;
    font-size: ${Math.max(10, Math.min(h * 0.6, 16))}px;
    box-sizing: border-box;
    border: 1.5px solid rgba(0, 100, 255, 0.4);
    border-radius: 2px;
    background: ${emptyBg};
    outline: none;
    padding: 2px 4px;
  `;

  // Toggle background to opaque white when field has content (or is focused)
  // so original PDF text (underlines, labels) underneath doesn't bleed through.
  function syncBg(el) {
    const hasVal = el.value && el.value.trim().length > 0;
    const isFocused = document.activeElement === el;
    el.style.background = (hasVal || isFocused) ? filledBg : emptyBg;
  }

  switch (fieldDesc.type) {
    case 'text': {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = fieldDesc.value || '';
      input.placeholder = fieldDesc.name;
      input.style.cssText = baseStyle;
      if (fieldDesc.maxLength) input.maxLength = fieldDesc.maxLength;
      // Opaque background when field has content or is focused
      syncBg(input);
      input.addEventListener('input', () => syncBg(input));
      input.addEventListener('focus', () => syncBg(input));
      input.addEventListener('blur', () => syncBg(input));
      return input;
    }
    case 'checkbox': {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        ${baseStyle}
      `;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = fieldDesc.value || false;
      cb.style.cssText = 'width: 70%; height: 70%; cursor: pointer;';
      cb.dataset.fieldName = fieldDesc.name;
      wrapper.appendChild(cb);
      // Save checkbox state on change
      cb.addEventListener('change', () => {
        formFieldValues[fieldDesc.name] = cb.checked;
      });
      cb.addEventListener('input', () => {
        formFieldValues[fieldDesc.name] = cb.checked;
      });
      Object.defineProperty(wrapper, '_checkbox', { value: cb });
      return wrapper;
    }
    case 'dropdown': {
      const sel = document.createElement('select');
      sel.style.cssText = baseStyle;
      (fieldDesc.options || []).forEach(opt => {
        const optEl = document.createElement('option');
        optEl.value = opt;
        optEl.textContent = opt;
        sel.appendChild(optEl);
      });
      if (fieldDesc.value?.length > 0) {
        sel.value = fieldDesc.value[0];
      }
      syncBg(sel);
      sel.addEventListener('change', () => syncBg(sel));
      return sel;
    }
    case 'radio': {
      // Radio groups are complex — render as dropdown for simplicity
      const sel = document.createElement('select');
      sel.style.cssText = baseStyle;
      (fieldDesc.options || []).forEach(opt => {
        const optEl = document.createElement('option');
        optEl.value = opt;
        optEl.textContent = opt;
        sel.appendChild(optEl);
      });
      if (fieldDesc.value) sel.value = fieldDesc.value;
      syncBg(sel);
      sel.addEventListener('change', () => syncBg(sel));
      return sel;
    }
    default:
      return null;
  }
}

function getElementValue(el, type) {
  switch (type) {
    case 'text': return el.value;
    case 'checkbox': {
      const cb = el._checkbox || el.querySelector('input[type="checkbox"]');
      return cb?.checked ?? false;
    }
    case 'dropdown':
    case 'radio':
      return el.value;
    default: return null;
  }
}

function setElementValue(el, type, value) {
  switch (type) {
    case 'text': el.value = value; break;
    case 'checkbox': {
      const cb = el._checkbox || el.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = value;
      break;
    }
    case 'dropdown':
    case 'radio':
      el.value = value;
      break;
  }
}

/* ═══════════════════ Write Back ═══════════════════ */

/**
 * Write filled form values back to the pdf-lib document.
 * Call before saving/exporting.
 * @param {PDFDocument} pdfLibDoc
 * @returns {boolean} true if any fields were written
 */
export function writeFormValues(pdfLibDoc) {
  const PDFLib = getPDFLib();
  if (!pdfLibDoc || !PDFLib) return false;

  const entries = Object.entries(formFieldValues);
  if (entries.length === 0) return false;

  try {
    const form = pdfLibDoc.getForm();
    let written = 0;

    for (const [name, value] of entries) {
      try {
        const field = form.getField(name);
        if (!field) continue;

        const type = getFieldType(field, PDFLib);

        switch (type) {
          case 'text':
            field.setText(String(value));
            written++;
            break;
          case 'checkbox':
            if (value) field.check();
            else field.uncheck();
            written++;
            break;
          case 'dropdown':
            field.select(value);
            written++;
            break;
          case 'radio':
            field.select(value);
            written++;
            break;
        }
      } catch (fieldErr) {
        console.warn(`Could not set form field "${name}":`, fieldErr);
      }
    }

    return written > 0;
  } catch (e) {
    console.warn('Form write-back failed:', e);
    return false;
  }
}

/* ═══════════════════ Cleanup ═══════════════════ */

export function clearFormOverlay() {
  if (formOverlayContainer) {
    formOverlayContainer.remove();
    formOverlayContainer = null;
  }
}

export function getFormFieldValues() {
  return { ...formFieldValues };
}

export function hasFormFields(pdfLibDoc) {
  try {
    const form = pdfLibDoc?.getForm();
    return form?.getFields()?.length > 0;
  } catch {
    return false;
  }
}

export function resetFormState() {
  formFieldValues = {};
  clearFormOverlay();
}
