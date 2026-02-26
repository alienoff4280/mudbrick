/**
 * Mudbrick — Forms (Phase 6)
 * PDF form field detection and filling via pdf-lib.
 *
 * Architecture:
 * - Detects AcroForm fields using pdf-lib's getForm() API
 * - Renders HTML overlays positioned over form fields
 * - Writes filled values back to pdf-lib on export
 *
 * Supported field types:
 * - Text fields (PDFTextField)
 * - Checkboxes (PDFCheckBox)
 * - Dropdowns (PDFDropdown)
 * - Radio buttons (PDFRadioGroup)
 */

const getPDFLib = () => window.PDFLib;

/* ═══════════════════ State ═══════════════════ */

let formFieldValues = {}; // { fieldName: value }
let formOverlayContainer = null;

/* ═══════════════════ Detection ═══════════════════ */

/**
 * Detect all form fields in the PDF.
 * @param {PDFDocument} pdfLibDoc - pdf-lib document
 * @returns {Array} Field descriptors
 */
export function detectFormFields(pdfLibDoc) {
  const PDFLib = getPDFLib();
  if (!pdfLibDoc || !PDFLib) return [];

  try {
    const form = pdfLibDoc.getForm();
    const fields = form.getFields();
    return fields.map(field => describeField(field, PDFLib));
  } catch (e) {
    // PDF has no form
    return [];
  }
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

  const PDFLib = getPDFLib();
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

  const form = pdfLibDoc.getForm();
  const page = pdfLibDoc.getPage(pageIndex);
  const { width: pdfW, height: pdfH } = page.getSize();

  for (const fieldDesc of fields) {
    if (fieldDesc.readOnly || fieldDesc.type === 'button' || fieldDesc.type === 'signature') continue;

    const field = form.getField(fieldDesc.name);
    if (!field) continue;

    // Get widget annotations for this field on this page
    const widgets = field.acroField?.getWidgets?.() || [];

    for (const widget of widgets) {
      const rect = widget.getRectangle();
      if (!rect) continue;

      // Check if widget is on this page
      const widgetPage = widget.P?.();
      const pageRef = pdfLibDoc.getPage(pageIndex).ref;
      // If we can't determine page, show it anyway (single-page forms)
      if (widgetPage && pageRef && widgetPage !== pageRef) continue;

      // Convert PDF coords (bottom-left origin) to CSS coords (top-left origin)
      const x = rect.x * zoom;
      const y = (pdfH - rect.y - rect.height) * zoom;
      const w = rect.width * zoom;
      const h = rect.height * zoom;

      const el = createFieldElement(fieldDesc, w, h);
      if (!el) continue;

      el.style.position = 'absolute';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.pointerEvents = 'auto';

      // Restore previously filled value
      if (formFieldValues[fieldDesc.name] !== undefined) {
        setElementValue(el, fieldDesc.type, formFieldValues[fieldDesc.name]);
      }

      // Save value on change
      el.addEventListener('change', () => {
        formFieldValues[fieldDesc.name] = getElementValue(el, fieldDesc.type);
      });
      el.addEventListener('input', () => {
        formFieldValues[fieldDesc.name] = getElementValue(el, fieldDesc.type);
      });

      formOverlayContainer.appendChild(el);
    }
  }
}

function createFieldElement(fieldDesc, w, h) {
  const baseStyle = `
    font-family: Helvetica, Arial, sans-serif;
    font-size: ${Math.max(10, Math.min(h * 0.6, 16))}px;
    box-sizing: border-box;
    border: 1.5px solid rgba(0, 100, 255, 0.4);
    border-radius: 2px;
    background: rgba(200, 220, 255, 0.15);
    outline: none;
    padding: 2px 4px;
  `;

  switch (fieldDesc.type) {
    case 'text': {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = fieldDesc.value || '';
      input.placeholder = fieldDesc.name;
      input.style.cssText = baseStyle;
      if (fieldDesc.maxLength) input.maxLength = fieldDesc.maxLength;
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
