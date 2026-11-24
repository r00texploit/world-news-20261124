// Entry for make.fun's news-image-20261124: one infographic of the world's news on Tuesday 24 November 2026.
// The image is entry.png beside this file (built from design/page.html by tools/render.mjs); this program
// writes those exact bytes to /output/entry.png. Node 22, standard library only, no network.
//
// Locally, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';

const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1048576;
const MAX_SIDE = 1024;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Refuses an image the contest's gate would refuse (so a bad build fails loudly here instead of scoring 0):
 * the size cap, the signature, every chunk's length and CRC, IHDR first and IEND last, 1..1024 pixels a side,
 * and image data that inflates to exactly the rows the header describes (8-bit, non-interlaced).
 */
function assertGateLimits(image: Buffer): void {
  if (image.length > MAX_BYTES) throw new Error(`entry.png is ${image.length} bytes, over ${MAX_BYTES}`);
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('entry.png is not a PNG');
  const idat: Buffer[] = [];
  let header: Buffer | null = null;
  let at = 8;
  let last = '';
  while (at < image.length && last !== 'IEND') {
    if (at + 12 > image.length) throw new Error(`entry.png: truncated chunk at byte ${at}`);
    const length = image.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > image.length) throw new Error(`entry.png: chunk at byte ${at} runs past the end`);
    last = image.toString('latin1', at + 4, at + 8);
    if (crc32(image.subarray(at + 4, end - 4)) !== image.readUInt32BE(end - 4)) throw new Error(`entry.png: bad CRC in ${last}`);
    const data = image.subarray(at + 8, end - 4);
    if (header === null && last !== 'IHDR') throw new Error('entry.png does not start with an IHDR chunk');
    if (last === 'IHDR') header = data;
    if (last === 'IDAT') idat.push(data);
    at = end;
  }
  if (last !== 'IEND' || at !== image.length) throw new Error('entry.png does not end with IEND');
  if (header === null || header.length !== 13) throw new Error('entry.png has no valid IHDR');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const channels = CHANNELS[header[9]];
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error(`entry.png is ${width}x${height}`);
  if (header[8] !== 8 || header[12] !== 0 || channels === undefined) throw new Error('entry.png is not an 8-bit non-interlaced PNG');
  if (inflateSync(Buffer.concat(idat)).length !== height * (1 + width * channels)) throw new Error('entry.png image data is incomplete');
}

const image: Buffer = readFileSync(new URL('./entry.png', import.meta.url));
assertGateLimits(image);
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'entry.png'), image);
