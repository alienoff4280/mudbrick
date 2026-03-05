import { describe, it, expect } from 'vitest';
import { REDACTION_PATTERNS } from '../js/redact-patterns.js';

/**
 * Helper: test whether a pattern's regex matches a string,
 * and optionally whether the validate function accepts it.
 */
function matchesPattern(patternName, text) {
  const pattern = REDACTION_PATTERNS[patternName];
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (pattern.validate(m[0])) {
      matches.push(m[0]);
    }
  }
  return matches;
}

function regexOnly(patternName, text) {
  const pattern = REDACTION_PATTERNS[patternName];
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push(m[0]);
  }
  return matches;
}

/* ── SSN ── */

describe('SSN pattern', () => {
  it('matches valid SSN with dashes', () => {
    expect(matchesPattern('ssn', '123-45-6789')).toEqual(['123-45-6789']);
  });

  it('matches valid SSN with spaces', () => {
    expect(matchesPattern('ssn', '123 45 6789')).toEqual(['123 45 6789']);
  });

  it('matches valid SSN without separators', () => {
    expect(matchesPattern('ssn', '123456789')).toEqual(['123456789']);
  });

  it('rejects SSN starting with 000', () => {
    expect(matchesPattern('ssn', '000-12-3456')).toEqual([]);
  });

  it('rejects SSN starting with 666', () => {
    expect(matchesPattern('ssn', '666-12-3456')).toEqual([]);
  });

  it('rejects SSN starting with 9xx', () => {
    expect(matchesPattern('ssn', '900-12-3456')).toEqual([]);
    expect(matchesPattern('ssn', '999-12-3456')).toEqual([]);
  });

  it('rejects SSN with group 00', () => {
    expect(matchesPattern('ssn', '123-00-6789')).toEqual([]);
  });

  it('rejects SSN with serial 0000', () => {
    expect(matchesPattern('ssn', '123-45-0000')).toEqual([]);
  });

  it('finds SSN embedded in text', () => {
    const text = 'My SSN is 234-56-7890 and that is private.';
    expect(matchesPattern('ssn', text)).toEqual(['234-56-7890']);
  });
});

/* ── Email ── */

describe('Email pattern', () => {
  it('matches simple email', () => {
    expect(matchesPattern('email', 'user@example.com')).toEqual(['user@example.com']);
  });

  it('matches email with dots and plus', () => {
    expect(matchesPattern('email', 'first.last+tag@sub.domain.org')).toEqual([
      'first.last+tag@sub.domain.org',
    ]);
  });

  it('matches email in surrounding text', () => {
    const text = 'Contact us at info@company.co.uk for details.';
    const matches = matchesPattern('email', text);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('info@company.co.uk');
  });
});

/* ── Phone ── */

describe('Phone pattern', () => {
  it('matches (555) 123-4567', () => {
    expect(matchesPattern('phone', '(555) 123-4567')).toEqual(['(555) 123-4567']);
  });

  it('matches 555-123-4567', () => {
    expect(matchesPattern('phone', '555-123-4567')).toEqual(['555-123-4567']);
  });

  it('matches +1 555 123 4567', () => {
    expect(matchesPattern('phone', '+1 555 123 4567')).toEqual(['+1 555 123 4567']);
  });

  it('matches 5551234567 (no separators)', () => {
    expect(matchesPattern('phone', '5551234567')).toEqual(['5551234567']);
  });

  it('rejects numbers that are too short', () => {
    expect(matchesPattern('phone', '555-1234')).toEqual([]);
  });
});

/* ── Date ── */

describe('Date pattern', () => {
  it('matches MM/DD/YYYY', () => {
    expect(regexOnly('date', '12/25/2024')).toEqual(['12/25/2024']);
  });

  it('matches MM-DD-YYYY', () => {
    expect(regexOnly('date', '01-15-2023')).toEqual(['01-15-2023']);
  });

  it('matches "January 1, 2024"', () => {
    expect(regexOnly('date', 'January 1, 2024')).toEqual(['January 1, 2024']);
  });

  it('matches abbreviated month "Jan 1, 2024"', () => {
    expect(regexOnly('date', 'Jan 1, 2024')).toEqual(['Jan 1, 2024']);
  });

  it('matches "Dec 25, 2023"', () => {
    expect(regexOnly('date', 'Dec 25, 2023')).toEqual(['Dec 25, 2023']);
  });

  it('matches date in surrounding text', () => {
    const text = 'The deadline is 03/15/2025 for submission.';
    expect(regexOnly('date', text)).toEqual(['03/15/2025']);
  });
});

/* ── Credit Card (regex + Luhn) ── */

describe('Credit Card pattern', () => {
  it('matches a valid Visa number with spaces', () => {
    // 4111 1111 1111 1111 passes Luhn
    expect(matchesPattern('creditCard', '4111 1111 1111 1111')).toEqual([
      '4111 1111 1111 1111',
    ]);
  });

  it('matches a valid Visa number with dashes', () => {
    expect(matchesPattern('creditCard', '4111-1111-1111-1111')).toEqual([
      '4111-1111-1111-1111',
    ]);
  });

  it('rejects numbers that fail Luhn check', () => {
    expect(matchesPattern('creditCard', '4111 1111 1111 1112')).toEqual([]);
  });
});

/* ── Pattern metadata ── */

describe('REDACTION_PATTERNS structure', () => {
  it('has expected pattern keys', () => {
    expect(Object.keys(REDACTION_PATTERNS)).toEqual(
      expect.arrayContaining(['ssn', 'creditCard', 'email', 'phone', 'date', 'custom'])
    );
  });

  it('each pattern has label, description, and validate', () => {
    for (const [key, pattern] of Object.entries(REDACTION_PATTERNS)) {
      expect(pattern).toHaveProperty('label');
      expect(pattern).toHaveProperty('description');
      expect(pattern).toHaveProperty('validate');
      expect(typeof pattern.validate).toBe('function');
      // custom has null regex by default
      if (key !== 'custom') {
        expect(pattern.regex).toBeInstanceOf(RegExp);
      }
    }
  });
});
