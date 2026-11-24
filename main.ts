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
// greyscale, RGB, grey+alpha, RGBA: palette images are refused, since this build's encoder never writes one
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const KNOWN_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

interface PngParts {
  header: Buffer;
  idat: Buffer;
}

function fail(why: string): never {
  throw new Error(`entry.png: ${why}`);
}

/** Walks the chunks: lengths, CRCs, legal type bytes, one IHDR first, consecutive IDATs, an empty IEND last. */
function readParts(image: Buffer): PngParts {
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE)) fail('not a PNG');
  const idat: Buffer[] = [];
  let header: Buffer | null = null;
  let hasPalette = false;
  let idatState: 'before' | 'inside' | 'after' = 'before';
  let at = 8;
  let type = '';
  while (at < image.length && type !== 'IEND') {
    if (at + 12 > image.length) fail(`truncated chunk at byte ${at}`);
    const end = at + 12 + image.readUInt32BE(at);
    if (end > image.length) fail(`chunk at byte ${at} runs past the end`);
    type = image.toString('latin1', at + 4, at + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) fail(`illegal chunk type at byte ${at}`);
    if (crc32(image.subarray(at + 4, end - 4)) !== image.readUInt32BE(end - 4)) fail(`bad CRC in ${type}`);
    if ((header === null) !== (type === 'IHDR')) fail(header === null ? 'does not start with IHDR' : 'has a second IHDR');
    if (type[0] <= 'Z' && !KNOWN_CRITICAL.has(type)) fail(`unknown critical chunk ${type}`);
    if (type === 'IDAT' && idatState === 'after') fail('IDAT chunks are not consecutive');
    if (type === 'PLTE' && (hasPalette || idatState !== 'before')) fail('PLTE is repeated or comes after IDAT');
    const size = end - at - 12;
    if (type === 'PLTE' && (size < 3 || size > 768 || size % 3 !== 0)) fail(`PLTE of ${size} bytes is malformed`);
    if (type === 'PLTE' && (header?.[9] === 0 || header?.[9] === 4)) fail('PLTE in a greyscale image');
    idatState = type === 'IDAT' ? 'inside' : idatState === 'inside' ? 'after' : idatState;
    const data = image.subarray(at + 8, end - 4);
    if (type === 'IHDR') header = data;
    if (type === 'IDAT') idat.push(data);
    if (type === 'PLTE') hasPalette = true;
    if (type === 'IEND' && data.length !== 0) fail('IEND is not empty');
    at = end;
  }
  if (type !== 'IEND' || at !== image.length) fail('does not end with IEND');
  if (header === null || header.length !== 13) fail('has no valid IHDR');
  return { header, idat: Buffer.concat(idat) };
}

/**
 * Refuses an image the contest's gate would refuse (so a bad build fails loudly here instead of scoring 0):
 * the size cap, a well-formed chunk stream, 1..1024 pixels a side, and image data that inflates to exactly
 * the rows the header describes, each row with a legal filter byte (8-bit, non-interlaced).
 */
function assertGateLimits(image: Buffer): void {
  if (image.length > MAX_BYTES) fail(`${image.length} bytes, over ${MAX_BYTES}`);
  const { header, idat } = readParts(image);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const channels = CHANNELS[header[9]];
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) fail(`${width}x${height} pixels`);
  if (header[8] !== 8 || header[12] !== 0 || channels === undefined) fail('not an 8-bit non-interlaced PNG');
  if (header[10] !== 0 || header[11] !== 0) fail('unknown compression or filter method');
  const stride = 1 + width * channels;
  const inflated = inflateSync(idat, { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  const rows = inflated.buffer;
  if (inflated.engine.bytesWritten !== idat.length) fail('stray bytes after the compressed image data');
  if (rows.length !== height * stride) fail('image data is incomplete');
  for (let y = 0; y < height; y += 1) if (rows[y * stride] > 4) fail(`row ${y} has filter type ${rows[y * stride]}`);
}

const image: Buffer = readFileSync(new URL('./entry.png', import.meta.url));
assertGateLimits(image);
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'entry.png'), image);
