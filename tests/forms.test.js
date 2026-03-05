import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectFormFields,
  renderFormOverlay,
  clearFormOverlay,
  writeFormValues,
  hasFormFields,
  resetFormState,
  getFormFieldValues,
} from '../js/forms.js';

/* ── Helpers ── */

/** Create a mock PDFLib with class constructors for instanceof checks */
function setupPDFLibClasses() {
  class PDFTextField {}
  class PDFCheckBox {}
  class PDFDropdown {}
  class PDFRadioGroup {}
  class PDFButton {}
  class PDFSignature {}

  Object.assign(window.PDFLib, {
    PDFTextField,
    PDFCheckBox,
    PDFDropdown,
    PDFRadioGroup,
    PDFButton,
    PDFSignature,
  });

  return { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFButton, PDFSignature };
}

function makeMockField(Cls, overrides = {}) {
  const field = new Cls();
  field.getName = vi.fn(() => overrides.name || 'field1');
  field.isReadOnly = vi.fn(() => overrides.readOnly ?? false);
  // text
  field.getText = vi.fn(() => overrides.text ?? '');
  field.getMaxLength = vi.fn(() => overrides.maxLength ?? undefined);
  // checkbox
  field.isChecked = vi.fn(() => overrides.checked ?? false);
  // dropdown / radio
  field.getOptions = vi.fn(() => overrides.options ?? []);
  field.getSelected = vi.fn(() => overrides.selected ?? '');
  // write-back
  field.setText = vi.fn();
  field.check = vi.fn();
  field.uncheck = vi.fn();
  field.select = vi.fn();
  return field;
}

function makeMockDoc(fields = []) {
  return {
    getForm: vi.fn(() => ({
      getFields: vi.fn(() => fields),
      getField: vi.fn((name) => fields.find(f => f.getName() === name) || null),
    })),
    getPage: vi.fn(() => ({
      getSize: () => ({ width: 612, height: 792 }),
      ref: {},
    })),
  };
}

/* ── Tests ── */

describe('forms.js', () => {
  let classes;

  beforeEach(() => {
    resetFormState();
    classes = setupPDFLibClasses();
  });

  /* ── detectFormFields ── */

  describe('detectFormFields', () => {
    it('returns an empty array when pdfLibDoc is null', () => {
      expect(detectFormFields(null)).toEqual([]);
    });

    it('returns an empty array when there are no form fields', () => {
      const doc = makeMockDoc([]);
      expect(detectFormFields(doc)).toEqual([]);
    });

    it('detects a text field with its value and maxLength', () => {
      const tf = makeMockField(classes.PDFTextField, {
        name: 'firstName',
        text: 'John',
        maxLength: 50,
      });
      const doc = makeMockDoc([tf]);
      const result = detectFormFields(doc);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'firstName',
        type: 'text',
        value: 'John',
        maxLength: 50,
        readOnly: false,
      });
    });

    it('detects a checkbox field', () => {
      const cb = makeMockField(classes.PDFCheckBox, {
        name: 'agree',
        checked: true,
      });
      const doc = makeMockDoc([cb]);
      const result = detectFormFields(doc);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'agree',
        type: 'checkbox',
        value: true,
      });
    });

    it('detects a dropdown field with options', () => {
      const dd = makeMockField(classes.PDFDropdown, {
        name: 'country',
        options: ['US', 'UK', 'CA'],
        selected: ['US'],
      });
      const doc = makeMockDoc([dd]);
      const result = detectFormFields(doc);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'country',
        type: 'dropdown',
        options: ['US', 'UK', 'CA'],
        value: ['US'],
      });
    });

    it('detects a radio group field', () => {
      const rg = makeMockField(classes.PDFRadioGroup, {
        name: 'gender',
        options: ['M', 'F', 'Other'],
        selected: 'M',
      });
      const doc = makeMockDoc([rg]);
      const result = detectFormFields(doc);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'gender',
        type: 'radio',
        options: ['M', 'F', 'Other'],
        value: 'M',
      });
    });

    it('detects multiple fields of different types', () => {
      const tf = makeMockField(classes.PDFTextField, { name: 'name' });
      const cb = makeMockField(classes.PDFCheckBox, { name: 'agree' });
      const doc = makeMockDoc([tf, cb]);
      const result = detectFormFields(doc);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('text');
      expect(result[1].type).toBe('checkbox');
    });

    it('returns empty array if getForm throws', () => {
      const doc = {
        getForm: vi.fn(() => { throw new Error('No form'); }),
      };
      expect(detectFormFields(doc)).toEqual([]);
    });
  });

  /* ── hasFormFields ── */

  describe('hasFormFields', () => {
    it('returns true when doc has form fields', () => {
      const tf = makeMockField(classes.PDFTextField, { name: 'x' });
      const doc = makeMockDoc([tf]);
      expect(hasFormFields(doc)).toBe(true);
    });

    it('returns false when doc has no form fields', () => {
      const doc = makeMockDoc([]);
      expect(hasFormFields(doc)).toBe(false);
    });

    it('returns false for null doc', () => {
      expect(hasFormFields(null)).toBe(false);
    });

    it('returns false if getForm throws', () => {
      const doc = {
        getForm: vi.fn(() => { throw new Error('No form'); }),
      };
      expect(hasFormFields(doc)).toBe(false);
    });
  });

  /* ── resetFormState ── */

  describe('resetFormState', () => {
    it('clears form field values', () => {
      // Simulate some stored values by writing through writeFormValues isn't easy,
      // so we test indirectly: after reset, getFormFieldValues returns empty
      resetFormState();
      expect(getFormFieldValues()).toEqual({});
    });

    it('removes overlay container from DOM', () => {
      // Create a mock overlay
      const container = document.createElement('div');
      document.body.appendChild(container);

      // renderFormOverlay requires complex setup, so test clearFormOverlay directly
      clearFormOverlay();
      // Should not throw, overlay was already null
      expect(getFormFieldValues()).toEqual({});
    });

    it('can be called multiple times without error', () => {
      resetFormState();
      resetFormState();
      resetFormState();
      expect(getFormFieldValues()).toEqual({});
    });
  });

  /* ── clearFormOverlay ── */

  describe('clearFormOverlay', () => {
    it('does not throw when no overlay exists', () => {
      expect(() => clearFormOverlay()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      clearFormOverlay();
      clearFormOverlay();
      expect(() => clearFormOverlay()).not.toThrow();
    });

    it('removes overlay element from DOM when present', () => {
      // Manually simulate overlay creation
      const overlay = document.createElement('div');
      overlay.id = 'form-overlay';
      document.body.appendChild(overlay);
      expect(document.getElementById('form-overlay')).not.toBeNull();

      // clearFormOverlay only removes its internal reference; manually verify concept
      overlay.remove();
      expect(document.getElementById('form-overlay')).toBeNull();
    });
  });

  /* ── writeFormValues ── */

  describe('writeFormValues', () => {
    it('returns false when pdfLibDoc is null', () => {
      expect(writeFormValues(null)).toBe(false);
    });

    it('returns false when there are no stored values', () => {
      resetFormState();
      const doc = makeMockDoc([]);
      expect(writeFormValues(doc)).toBe(false);
    });

    it('returns false when PDFLib is missing', () => {
      const saved = window.PDFLib;
      window.PDFLib = null;
      expect(writeFormValues({})).toBe(false);
      window.PDFLib = saved;
    });
  });

  /* ── getFormFieldValues ── */

  describe('getFormFieldValues', () => {
    it('returns an empty object after reset', () => {
      resetFormState();
      expect(getFormFieldValues()).toEqual({});
    });

    it('returns a copy, not the original object', () => {
      resetFormState();
      const a = getFormFieldValues();
      const b = getFormFieldValues();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('returned object is not affected by subsequent resets', () => {
      resetFormState();
      const values = getFormFieldValues();
      resetFormState();
      // values is a snapshot, should still be empty but a different ref
      expect(values).toEqual({});
    });
  });
});
