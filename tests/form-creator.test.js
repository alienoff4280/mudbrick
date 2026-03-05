import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addFormField,
  removeFormField,
  getTabOrder,
  setTabOrder,
  exportFormDataJSON,
  importFormDataJSON,
  exportFormDataXFDF,
  importFormDataXFDF,
  exportFormDataCSV,
  importFormDataCSV,
  flattenFormFields,
} from '../js/form-creator.js';

/* ── Helpers ── */

function setupPDFLibClasses() {
  class PDFTextField {}
  class PDFCheckBox {}
  class PDFDropdown {}
  class PDFRadioGroup {}
  class PDFButton {}
  class PDFSignature {}
  class PDFName {
    constructor(v) { this.value = v; }
    static of(v) { return new PDFName(v); }
  }

  Object.assign(window.PDFLib, {
    PDFTextField,
    PDFCheckBox,
    PDFDropdown,
    PDFRadioGroup,
    PDFButton,
    PDFSignature,
    PDFName,
  });

  return { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFButton, PDFSignature };
}

function makeMockForm(fields = []) {
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f._name] = f;
  }
  return {
    getFields: vi.fn(() => fields),
    getField: vi.fn((name) => fieldMap[name] || null),
    getRadioGroup: vi.fn((name) => fieldMap[name] || null),
    createTextField: vi.fn((name) => {
      const f = { _name: name, addToPage: vi.fn(), enableMultiline: vi.fn(), setMaxLength: vi.fn(), setText: vi.fn(), enableReadOnly: vi.fn() };
      fields.push(f);
      fieldMap[name] = f;
      return f;
    }),
    createCheckBox: vi.fn((name) => {
      const f = { _name: name, addToPage: vi.fn(), check: vi.fn() };
      fields.push(f);
      fieldMap[name] = f;
      return f;
    }),
    createDropdown: vi.fn((name) => {
      const f = { _name: name, addToPage: vi.fn(), setOptions: vi.fn(), enableEditing: vi.fn(), enableMultiselect: vi.fn() };
      fields.push(f);
      fieldMap[name] = f;
      return f;
    }),
    createRadioGroup: vi.fn((name) => {
      const f = { _name: name, addOptionToPage: vi.fn() };
      fields.push(f);
      fieldMap[name] = f;
      return f;
    }),
    createButton: vi.fn((name) => {
      const f = { _name: name, addToPage: vi.fn() };
      fields.push(f);
      fieldMap[name] = f;
      return f;
    }),
    removeField: vi.fn(),
    flatten: vi.fn(),
  };
}

function makeMockDoc(form = null) {
  const f = form || makeMockForm();
  return {
    getForm: vi.fn(() => f),
    getPage: vi.fn(() => ({
      getSize: () => ({ width: 612, height: 792 }),
      node: { set: vi.fn() },
    })),
    getPageCount: vi.fn(() => 3),
    save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
  };
}

/* ── Tests ── */

describe('form-creator.js', () => {
  let classes;

  beforeEach(() => {
    classes = setupPDFLibClasses();
  });

  /* ── addFormField ── */

  describe('addFormField', () => {
    it('creates a text field and returns a descriptor', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const result = addFormField(doc, {
        type: 'text',
        name: 'firstName',
        pageIndex: 0,
        x: 100,
        y: 500,
      });

      expect(result).toMatchObject({
        name: 'firstName',
        type: 'text',
        pageIndex: 0,
        x: 100,
        y: 500,
      });
      expect(result.width).toBe(200); // default width
      expect(result.height).toBe(24); // default height
      expect(form.createTextField).toHaveBeenCalledWith('firstName');
    });

    it('creates a checkbox field', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const result = addFormField(doc, {
        type: 'checkbox',
        name: 'agree',
        pageIndex: 0,
        x: 50,
        y: 300,
      });

      expect(result.type).toBe('checkbox');
      expect(result.width).toBe(14); // default checkbox width
      expect(form.createCheckBox).toHaveBeenCalledWith('agree');
    });

    it('creates a dropdown field with options', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const result = addFormField(doc, {
        type: 'dropdown',
        name: 'country',
        pageIndex: 0,
        x: 100,
        y: 400,
        props: { options: ['US', 'UK', 'CA'] },
      });

      expect(result.type).toBe('dropdown');
      expect(form.createDropdown).toHaveBeenCalledWith('country');
    });

    it('creates a radio group field', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const result = addFormField(doc, {
        type: 'radio',
        name: 'gender',
        pageIndex: 0,
        x: 100,
        y: 300,
        props: { optionValue: 'Male' },
      });

      expect(result.type).toBe('radio');
      expect(form.createRadioGroup).toHaveBeenCalledWith('gender');
    });

    it('creates a button field', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const result = addFormField(doc, {
        type: 'button',
        name: 'submit',
        pageIndex: 0,
        x: 100,
        y: 200,
      });

      expect(result.type).toBe('button');
      expect(form.createButton).toHaveBeenCalledWith('submit');
    });

    it('uses custom width and height when provided', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const result = addFormField(doc, {
        type: 'text',
        name: 'custom',
        pageIndex: 0,
        x: 10,
        y: 10,
        width: 300,
        height: 40,
      });

      expect(result.width).toBe(300);
      expect(result.height).toBe(40);
    });

    it('throws for unsupported field type', () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      expect(() => addFormField(doc, {
        type: 'unsupported',
        name: 'x',
        pageIndex: 0,
        x: 0,
        y: 0,
      })).toThrow('Unsupported field type');
    });

    it('throws when pdfLibDoc is null', () => {
      expect(() => addFormField(null, {
        type: 'text',
        name: 'x',
        pageIndex: 0,
        x: 0,
        y: 0,
      })).toThrow('pdf-lib not loaded');
    });
  });

  /* ── removeFormField ── */

  describe('removeFormField', () => {
    it('calls form.removeField for existing field', () => {
      const mockField = { _name: 'field1', getName: () => 'field1' };
      const form = makeMockForm();
      form.getField = vi.fn(() => mockField);
      const doc = makeMockDoc(form);

      removeFormField(doc, 'field1');
      expect(form.removeField).toHaveBeenCalledWith(mockField);
    });

    it('does not throw when field not found', () => {
      const form = makeMockForm();
      form.getField = vi.fn(() => { throw new Error('not found'); });
      const doc = makeMockDoc(form);

      expect(() => removeFormField(doc, 'nonexistent')).not.toThrow();
    });

    it('does nothing when pdfLibDoc is null', () => {
      expect(() => removeFormField(null, 'field1')).not.toThrow();
    });
  });

  /* ── Tab Order ── */

  describe('getTabOrder', () => {
    it('returns empty array when doc is null', () => {
      expect(getTabOrder(null, 0)).toEqual([]);
    });

    it('returns empty array when no fields exist', () => {
      const form = makeMockForm([]);
      const doc = makeMockDoc(form);
      expect(getTabOrder(doc, 0)).toEqual([]);
    });

    it('returns field names sorted by position (top-to-bottom, left-to-right)', () => {
      const field1 = {
        getName: () => 'top_left',
        acroField: {
          getWidgets: () => [{
            getRectangle: () => ({ x: 100, y: 700, width: 200, height: 24 }),
          }],
        },
      };
      const field2 = {
        getName: () => 'bottom_right',
        acroField: {
          getWidgets: () => [{
            getRectangle: () => ({ x: 300, y: 100, width: 200, height: 24 }),
          }],
        },
      };
      const form = makeMockForm();
      form.getFields = vi.fn(() => [field2, field1]);
      const doc = makeMockDoc(form);

      const order = getTabOrder(doc, 0);
      expect(order).toEqual(['top_left', 'bottom_right']);
    });
  });

  describe('setTabOrder', () => {
    it('sets the Tabs entry on the page dictionary', () => {
      const doc = makeMockDoc();
      expect(() => setTabOrder(doc, 0, ['field1', 'field2'])).not.toThrow();
    });

    it('does nothing when doc is null', () => {
      expect(() => setTabOrder(null, 0, [])).not.toThrow();
    });

    it('handles errors gracefully', () => {
      const doc = {
        getPage: vi.fn(() => ({
          node: { set: vi.fn(() => { throw new Error('fail'); }) },
          getSize: () => ({ width: 612, height: 792 }),
        })),
        getForm: vi.fn(() => makeMockForm()),
      };
      expect(() => setTabOrder(doc, 0, ['a'])).not.toThrow();
    });
  });

  /* ── JSON Import/Export ── */

  describe('exportFormDataJSON / importFormDataJSON', () => {
    it('returns empty object when doc is null', () => {
      expect(exportFormDataJSON(null)).toEqual({});
    });

    it('exports text field values', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'name';
      tf.getText = () => 'Alice';
      tf.isChecked = undefined;

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      const doc = makeMockDoc(form);

      const data = exportFormDataJSON(doc);
      expect(data).toEqual({ name: 'Alice' });
    });

    it('exports checkbox field values', () => {
      const cb = new classes.PDFCheckBox();
      cb.getName = () => 'agree';
      cb.isChecked = () => true;

      const form = makeMockForm();
      form.getFields = vi.fn(() => [cb]);
      const doc = makeMockDoc(form);

      const data = exportFormDataJSON(doc);
      expect(data).toEqual({ agree: true });
    });

    it('importFormDataJSON returns 0 for null data', () => {
      const doc = makeMockDoc();
      expect(importFormDataJSON(doc, null)).toBe(0);
    });

    it('round-trips text field data through JSON export/import', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'email';
      tf.getText = () => 'test@example.com';
      tf.setText = vi.fn();

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      form.getField = vi.fn((name) => name === 'email' ? tf : null);
      const doc = makeMockDoc(form);

      const exported = exportFormDataJSON(doc);
      expect(exported).toEqual({ email: 'test@example.com' });

      const filled = importFormDataJSON(doc, exported);
      expect(filled).toBe(1);
      expect(tf.setText).toHaveBeenCalledWith('test@example.com');
    });
  });

  /* ── CSV Export/Import ── */

  describe('exportFormDataCSV / importFormDataCSV', () => {
    it('returns empty string when no fields exist', () => {
      const form = makeMockForm();
      form.getFields = vi.fn(() => []);
      const doc = makeMockDoc(form);

      expect(exportFormDataCSV(doc)).toBe('');
    });

    it('exports CSV with header and value rows', () => {
      const tf1 = new classes.PDFTextField();
      tf1.getName = () => 'name';
      tf1.getText = () => 'Alice';

      const tf2 = new classes.PDFTextField();
      tf2.getName = () => 'city';
      tf2.getText = () => 'Portland';

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf1, tf2]);
      const doc = makeMockDoc(form);

      const csv = exportFormDataCSV(doc);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('name,city');
      expect(lines[1]).toBe('Alice,Portland');
    });

    it('escapes values containing commas', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'address';
      tf.getText = () => '123 Main St, Apt 4';

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      const doc = makeMockDoc(form);

      const csv = exportFormDataCSV(doc);
      expect(csv).toContain('"123 Main St, Apt 4"');
    });

    it('importFormDataCSV returns 0 for single-line input', () => {
      const doc = makeMockDoc();
      expect(importFormDataCSV(doc, 'just-a-header')).toBe(0);
    });

    it('round-trips CSV data', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'color';
      tf.getText = () => 'blue';
      tf.setText = vi.fn();

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      form.getField = vi.fn((name) => name === 'color' ? tf : null);
      const doc = makeMockDoc(form);

      const csv = exportFormDataCSV(doc);
      const filled = importFormDataCSV(doc, csv);
      expect(filled).toBe(1);
      expect(tf.setText).toHaveBeenCalledWith('blue');
    });
  });

  /* ── XFDF Export/Import ── */

  describe('exportFormDataXFDF / importFormDataXFDF', () => {
    it('exports valid XFDF XML', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'name';
      tf.getText = () => 'Bob';

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      const doc = makeMockDoc(form);

      const xfdf = exportFormDataXFDF(doc, 'test.pdf');
      expect(xfdf).toContain('<?xml version="1.0"');
      expect(xfdf).toContain('<xfdf');
      expect(xfdf).toContain('href="test.pdf"');
      expect(xfdf).toContain('<field name="name">');
      expect(xfdf).toContain('<value>Bob</value>');
    });

    it('escapes special XML characters', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'note';
      tf.getText = () => 'A & B < C';

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      const doc = makeMockDoc(form);

      const xfdf = exportFormDataXFDF(doc);
      expect(xfdf).toContain('A &amp; B &lt; C');
    });

    it('round-trips XFDF data', () => {
      const tf = new classes.PDFTextField();
      tf.getName = () => 'city';
      tf.getText = () => 'Paris';
      tf.setText = vi.fn();

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      form.getField = vi.fn((name) => name === 'city' ? tf : null);
      const doc = makeMockDoc(form);

      const xfdf = exportFormDataXFDF(doc);
      const filled = importFormDataXFDF(doc, xfdf);
      expect(filled).toBe(1);
      expect(tf.setText).toHaveBeenCalledWith('Paris');
    });
  });

  /* ── flattenFormFields ── */

  describe('flattenFormFields', () => {
    it('throws when pdfLibDoc is null', async () => {
      await expect(flattenFormFields(null)).rejects.toThrow('pdf-lib not loaded');
    });

    it('calls flatten on the form and returns saved bytes', async () => {
      const form = makeMockForm();
      const doc = makeMockDoc(form);

      const bytes = await flattenFormFields(doc);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(doc.save).toHaveBeenCalled();
    });

    it('makes text fields read-only before flattening', async () => {
      const tf = new classes.PDFTextField();
      tf.enableReadOnly = vi.fn();

      const form = makeMockForm();
      form.getFields = vi.fn(() => [tf]);
      const doc = makeMockDoc(form);

      await flattenFormFields(doc);
      expect(tf.enableReadOnly).toHaveBeenCalled();
    });
  });
});
