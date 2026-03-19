/**
 * Mudbrick v2 -- Color Sampler Utility
 *
 * Ported from v1 js/text-edit.js (lines 27-155).
 * Samples background and text colors from a rendered PDF canvas.
 */

/**
 * Sample the background color from the text region itself.
 * The lightest frequent color within the area is the background.
 *
 * Ported from v1 sampleBackgroundColor().
 */
export function sampleBackgroundColor(
  canvas: HTMLCanvasElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  if (!canvas) return '#ffffff';
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#ffffff';

  const dpr =
    canvas.width /
      (parseFloat(canvas.style.width) || canvas.offsetWidth) || 1;

  const sx = Math.max(0, Math.round(x * dpr));
  const sy = Math.max(0, Math.round(y * dpr));
  const sw = Math.min(Math.round(width * dpr), canvas.width - sx);
  const sh = Math.min(Math.round(height * dpr), canvas.height - sy);
  if (sw <= 0 || sh <= 0) return '#ffffff';

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data;
  } catch {
    return '#ffffff';
  }

  // Count light pixel colors (background), skip dark pixels (text/borders).
  // Quantize lightly (round to nearest 4) to group anti-aliased background.
  const counts: Record<string, number> = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum < 150) continue; // skip text/dark pixels
    const qr = (r >> 2) << 2;
    const qg = (g >> 2) << 2;
    const qb = (b >> 2) << 2;
    const key = `${qr},${qg},${qb}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  let maxCount = 0;
  let best: string | null = null;
  for (const [key, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      best = key;
    }
  }

  if (!best) return '#ffffff';
  const [r, g, b] = best.split(',').map(Number);
  return (
    '#' +
    [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Sample the dominant text color from a rendered PDF canvas at the given region.
 * Scans pixels and returns the most common non-background color as a hex string.
 *
 * Ported from v1 sampleTextColor().
 */
export function sampleTextColor(
  canvas: HTMLCanvasElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
  bgHex?: string,
): string {
  if (!canvas) return '#000000';
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#000000';

  const dpr =
    canvas.width /
      (parseFloat(canvas.style.width) || canvas.offsetWidth) || 1;

  const sx = Math.max(0, Math.round(x * dpr));
  const sy = Math.max(0, Math.round(y * dpr));
  const sw = Math.min(Math.round(width * dpr), canvas.width - sx);
  const sh = Math.min(Math.round(height * dpr), canvas.height - sy);
  if (sw <= 0 || sh <= 0) return '#000000';

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data;
  } catch {
    return '#000000';
  }

  // Determine background luminance to use as filter threshold
  let bgLum = 230;
  if (bgHex && bgHex.length === 7) {
    const bgR = parseInt(bgHex.slice(1, 3), 16);
    const bgG = parseInt(bgHex.slice(3, 5), 16);
    const bgB = parseInt(bgHex.slice(5, 7), 16);
    bgLum = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
  }
  // Skip any pixel within 40 luminance units of the background
  const skipThreshold = bgLum - 40;

  // Count dark pixel colors (text), skipping background-like pixels
  const colorCounts: Record<string, number> = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum > skipThreshold) continue;
    // Quantize to reduce noise (round to nearest 4)
    const qr = (r >> 2) << 2;
    const qg = (g >> 2) << 2;
    const qb = (b >> 2) << 2;
    const key = `${qr},${qg},${qb}`;
    colorCounts[key] = (colorCounts[key] || 0) + 1;
  }

  let maxCount = 0;
  let bestColor: string | null = null;
  for (const [key, count] of Object.entries(colorCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestColor = key;
    }
  }

  if (!bestColor) return '#000000';
  const [r, g, b] = bestColor.split(',').map(Number);
  return (
    '#' +
    [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Sample a single pixel color from the PDF canvas at (x, y).
 * Returns hex string or null if out of bounds.
 *
 * Ported from v1 samplePixelColor().
 */
export function samplePixelColor(
  canvas: HTMLCanvasElement | null,
  x: number,
  y: number,
): string | null {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height)
    return null;

  try {
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
    return (
      '#' +
      [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
    );
  } catch {
    return null;
  }
}
