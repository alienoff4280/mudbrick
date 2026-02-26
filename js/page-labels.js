/**
 * Mudbrick — Page Labels
 * Custom page numbering schemes: roman numerals, alpha, decimal, custom prefixes.
 * Labels are display-only metadata — they don't modify the PDF itself.
 */

/* ═══════════════════ Format Converters ═══════════════════ */

export function toRoman(num) {
  if (num <= 0) return String(num);
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) { result += syms[i]; num -= vals[i]; }
  }
  return result;
}

export function toAlpha(num) {
  if (num <= 0) return String(num);
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

const FORMAT_FN = {
  'decimal':      n => String(n),
  'roman-upper':  n => toRoman(n),
  'roman-lower':  n => toRoman(n).toLowerCase(),
  'alpha-upper':  n => toAlpha(n),
  'alpha-lower':  n => toAlpha(n).toLowerCase(),
};

export const LABEL_FORMATS = Object.keys(FORMAT_FN);

/* ═══════════════════ Label Ranges ═══════════════════ */

/**
 * @typedef {Object} LabelRange
 * @property {number} startPage - 1-based first page of range
 * @property {number} endPage   - 1-based last page of range
 * @property {string} format    - One of LABEL_FORMATS
 * @property {string} prefix    - Prefix string (e.g. "A-")
 * @property {number} startNum  - Starting number within range (default 1)
 */

let _ranges = [];

/**
 * Set a label range. Replaces any existing range that overlaps.
 */
export function setLabelRange(startPage, endPage, format, prefix = '', startNum = 1) {
  // Remove overlapping ranges
  _ranges = _ranges.filter(r =>
    r.endPage < startPage || r.startPage > endPage
  );
  _ranges.push({ startPage, endPage, format, prefix, startNum });
  _ranges.sort((a, b) => a.startPage - b.startPage);
}

/**
 * Get the display label for a given page number.
 * Returns the formatted label if a range covers this page, else the raw number string.
 */
export function getPageLabel(pageNum) {
  for (const r of _ranges) {
    if (pageNum >= r.startPage && pageNum <= r.endPage) {
      const offset = pageNum - r.startPage;
      const num = r.startNum + offset;
      const fn = FORMAT_FN[r.format] || FORMAT_FN.decimal;
      return r.prefix + fn(num);
    }
  }
  return String(pageNum);
}

/**
 * Get all label ranges.
 */
export function getLabelRanges() {
  return [..._ranges];
}

/**
 * Clear all label ranges.
 */
export function clearLabels() {
  _ranges = [];
}

/**
 * Remove a specific range by index.
 */
export function removeLabelRange(index) {
  if (index < 0 || index >= _ranges.length) return;
  _ranges.splice(index, 1);
}

/**
 * Generate a preview of labels for pages startPage..endPage.
 * Returns an array of { page, label } objects.
 */
export function previewLabels(totalPages) {
  const result = [];
  for (let i = 1; i <= totalPages; i++) {
    result.push({ page: i, label: getPageLabel(i) });
  }
  return result;
}
