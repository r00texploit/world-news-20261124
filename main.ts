// Entry for make.fun's news-image-20261124: one infographic of the world's news on Tuesday 24 November 2026.
// The image is entry.png beside this file (built from design/page.html by tools/render.mjs); this program
// writes those exact bytes to /output/entry.png. Node 22, standard library only, no network.
//
// Locally, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1048576;
const MAX_SIDE = 1024;

/** Refuses an image the contest's gate would refuse, so a bad build fails loudly here instead of scoring 0. */
function assertGateLimits(image: Buffer): void {
  if (image.length > MAX_BYTES) throw new Error(`entry.png is ${image.length} bytes, over ${MAX_BYTES}`);
  if (image.length < 33 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('entry.png is not a PNG');
  if (image.toString('latin1', 12, 16) !== 'IHDR') throw new Error('entry.png does not start with an IHDR chunk');
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error(`entry.png is ${width}x${height}, over ${MAX_SIDE}x${MAX_SIDE}`);
  if (image.toString('latin1', image.length - 8, image.length - 4) !== 'IEND') throw new Error('entry.png does not end with IEND');
}

const image: Buffer = readFileSync(new URL('./entry.png', import.meta.url));
assertGateLimits(image);
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'entry.png'), image);
