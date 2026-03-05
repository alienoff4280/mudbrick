#!/usr/bin/env node
/**
 * Generate PNG icons from icon.svg for PWA manifest.
 *
 * Requires: npm install sharp (run once)
 * Usage: node scripts/generate-icons.js
 *
 * This is an optional build step. The app works without PNG icons
 * (falls back to SVG) but PNGs provide better platform support.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZES = [48, 72, 96, 128, 144, 192, 512];

async function generate() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.log('sharp not installed. Install with: npm install --save-dev sharp');
    console.log('Then run: node scripts/generate-icons.js');
    process.exit(1);
  }

  const svgPath = resolve(__dirname, '../icons/icon.svg');
  const svgBuffer = readFileSync(svgPath);

  for (const size of SIZES) {
    const outPath = resolve(__dirname, `../icons/icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`  Generated: icons/icon-${size}.png`);
  }

  // Generate maskable variant (with padding for safe zone)
  for (const size of [192, 512]) {
    const padding = Math.round(size * 0.1);
    const innerSize = size - padding * 2;
    const outPath = resolve(__dirname, `../icons/icon-${size}-maskable.png`);

    const inner = await sharp(svgBuffer)
      .resize(innerSize, innerSize)
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 192, g: 57, b: 43, alpha: 1 },
      },
    })
      .composite([{ input: inner, left: padding, top: padding }])
      .png()
      .toFile(outPath);
    console.log(`  Generated: icons/icon-${size}-maskable.png`);
  }

  console.log('\nDone! Update manifest.json to reference the new PNG icons.');
}

generate().catch(console.error);
