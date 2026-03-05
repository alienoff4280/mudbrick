import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPDFMagicBytes,
  classifyPDFError,
  withTimeout,
} from '../js/error-handler.js';

describe('isPDFMagicBytes', () => {
  it('returns true for valid PDF magic bytes', () => {
    // %PDF- = 0x25 0x50 0x44 0x46 0x2D
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E]);
    expect(isPDFMagicBytes(bytes)).toBe(true);
  });

  it('returns false for non-PDF bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D]); // PNG header
    expect(isPDFMagicBytes(bytes)).toBe(false);
  });

  it('returns false for null or undefined input', () => {
    expect(isPDFMagicBytes(null)).toBe(false);
    expect(isPDFMagicBytes(undefined)).toBe(false);
  });

  it('returns false for bytes shorter than 5', () => {
    expect(isPDFMagicBytes(new Uint8Array([0x25, 0x50]))).toBe(false);
    expect(isPDFMagicBytes(new Uint8Array([]))).toBe(false);
  });

  it('returns false when only some bytes match', () => {
    // Correct first 4 bytes but wrong 5th byte
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00]);
    expect(isPDFMagicBytes(bytes)).toBe(false);
  });

  it('returns true for exactly 5 bytes matching', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]);
    expect(isPDFMagicBytes(bytes)).toBe(true);
  });
});

describe('classifyPDFError', () => {
  it('returns file-encrypted for PasswordException', () => {
    const err = new Error('Need password');
    err.name = 'PasswordException';
    expect(classifyPDFError(err)).toBe('file-encrypted');
  });

  it('returns file-encrypted when message contains "password"', () => {
    expect(classifyPDFError(new Error('password required'))).toBe('file-encrypted');
    expect(classifyPDFError(new Error('Password needed'))).toBe('file-encrypted');
  });

  it('returns file-corrupt for InvalidPDFException', () => {
    const err = new Error('bad data');
    err.name = 'InvalidPDFException';
    expect(classifyPDFError(err)).toBe('file-corrupt');
  });

  it('returns file-corrupt for "Invalid PDF" in message', () => {
    expect(classifyPDFError(new Error('Invalid PDF structure'))).toBe('file-corrupt');
  });

  it('returns file-corrupt for "bad XRef" in message', () => {
    expect(classifyPDFError(new Error('bad XRef entry'))).toBe('file-corrupt');
  });

  it('returns file-corrupt for "not a valid PDF"', () => {
    expect(classifyPDFError(new Error('not a valid PDF file'))).toBe('file-corrupt');
  });

  it('returns memory for out of memory errors', () => {
    expect(classifyPDFError(new Error('out of memory'))).toBe('memory');
    expect(classifyPDFError(new Error('allocation failed somewhere'))).toBe('memory');
  });

  it('returns memory for RangeError Maximum call stack', () => {
    expect(classifyPDFError(new Error('RangeError: Maximum call stack size exceeded'))).toBe('memory');
  });

  it('returns timeout for AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(classifyPDFError(err)).toBe('timeout');
  });

  it('returns timeout for "timed out" in message', () => {
    expect(classifyPDFError(new Error('Operation timed out'))).toBe('timeout');
    expect(classifyPDFError(new Error('request timeout'))).toBe('timeout');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyPDFError(new Error('something weird happened'))).toBe('unknown');
  });

  it('handles null/undefined error gracefully', () => {
    expect(classifyPDFError(null)).toBe('unknown');
    expect(classifyPDFError(undefined)).toBe('unknown');
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when promise resolves before timeout', async () => {
    const promise = Promise.resolve('done');
    const result = await withTimeout(promise, 5000, 'Test');
    expect(result).toBe('done');
  });

  it('rejects with timeout error when promise takes too long', async () => {
    const promise = new Promise(() => {}); // never resolves
    const wrapped = withTimeout(promise, 3000, 'Load');

    vi.advanceTimersByTime(3000);

    await expect(wrapped).rejects.toThrow('Load timed out after 3s');
  });

  it('uses default label "Operation" when not provided', async () => {
    const promise = new Promise(() => {});
    const wrapped = withTimeout(promise, 2000);

    vi.advanceTimersByTime(2000);

    await expect(wrapped).rejects.toThrow('Operation timed out after 2s');
  });

  it('rejects with original error if promise rejects before timeout', async () => {
    const promise = Promise.reject(new Error('network fail'));
    const wrapped = withTimeout(promise, 5000, 'Fetch');

    await expect(wrapped).rejects.toThrow('network fail');
  });

  it('clears timeout when promise resolves', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const promise = Promise.resolve('ok');
    await withTimeout(promise, 5000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('rounds timeout seconds in error message', async () => {
    const promise = new Promise(() => {});
    const wrapped = withTimeout(promise, 1500, 'Task');

    vi.advanceTimersByTime(1500);

    await expect(wrapped).rejects.toThrow('Task timed out after 2s');
  });
});
