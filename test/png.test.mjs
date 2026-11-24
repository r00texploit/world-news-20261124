// Unit tests for the PNG tools: run with  node --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { chunk, crc32, decode, encodePalette, encodeRgb, PNG_SIGNATURE, readChunks } from '../tools/png.mjs';
import { downscale } from '../tools/preview.mjs';
import { checkImage } from '../tools/verify.mjs';

function pattern(width, height) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = (i * 37) & 0xff;
    rgb[i * 3 + 1] = (i * 11 + 5) & 0xff;
    rgb[i * 3 + 2] = (i % width) * 9 & 0xff;
  }
  return rgb;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('an RGB image survives encode then decode unchanged', () => {
  const rgb = pattern(17, 9);
  const out = decode(encodeRgb(17, 9, rgb));
  assert.equal(out.width, 17);
  assert.equal(out.height, 9);
  assert.deepEqual(out.rgb, rgb);
});

test('encoding is deterministic: equal pixels give equal bytes', () => {
  const rgb = pattern(32, 32);
  assert.ok(encodeRgb(32, 32, rgb).equals(encodeRgb(32, 32, Buffer.from(rgb))));
});

test('a palette image survives encode then decode unchanged', () => {
  const indices = Buffer.alloc(32);
  const rgb = Buffer.alloc(32 * 3);
  for (let i = 0; i < 32; i += 1) {
    indices[i] = i % 3 === 0 ? 1 : 0;
    rgb.set(i % 3 === 0 ? [200, 30, 30] : [10, 20, 40], i * 3);
  }
  const palette = Buffer.from([10, 20, 40, 200, 30, 30]);
  assert.deepEqual(decode(encodePalette(8, 4, indices, palette)).rgb, rgb);
});

test('encodePalette refuses an index past the end of the palette', () => {
  assert.throws(() => encodePalette(2, 1, Buffer.from([0, 1]), Buffer.from([1, 2, 3])), /palette index 1/);
});

test('decode refuses a palette in a greyscale image', () => {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  const parts = [chunk('IHDR', ihdr), chunk('PLTE', Buffer.from([1, 2, 3])), chunk('IDAT', deflateSync(Buffer.from([0, 77]))), chunk('IEND', Buffer.alloc(0))];
  assert.throws(() => decode(Buffer.concat([PNG_SIGNATURE, ...parts])), /PLTE in a greyscale image/);
  assert.equal(decode(Buffer.concat([PNG_SIGNATURE, parts[0], ...parts.slice(2)])).rgb[0], 77);
});

test('decode refuses a malformed palette and a tRNS chunk', () => {
  const good = encodePalette(2, 1, Buffer.from([0, 1]), Buffer.from([1, 2, 3, 4, 5, 6]));
  const parts = readChunks(good);
  const rebuild = (list) => Buffer.concat([good.subarray(0, 8), ...list.map((c) => chunk(c.type, c.data))]);
  const shortPalette = parts.map((c) => (c.type === 'PLTE' ? { type: 'PLTE', data: Buffer.from([1, 2, 3, 4]) } : c));
  assert.throws(() => decode(rebuild(shortPalette)), /PLTE/);
  const withTrns = [parts[0], parts[1], { type: 'tRNS', data: Buffer.from([0]) }, ...parts.slice(2)];
  assert.throws(() => decode(rebuild(withTrns)), /tRNS/);
});

test('readChunks rejects a bad signature, a bad CRC and a truncated file', () => {
  const good = encodeRgb(4, 4, pattern(4, 4));
  assert.throws(() => readChunks(Buffer.concat([Buffer.from('GIF89a'), good.subarray(6)])), /signature/);
  const corrupt = Buffer.from(good);
  corrupt[20] ^= 0xff;
  assert.throws(() => readChunks(corrupt), /CRC/);
  assert.throws(() => readChunks(good.subarray(0, good.length - 6)), /truncated|past the end|IEND/);
});

test('checkImage flags oversize dimensions and passes a small valid image', () => {
  assert.deepEqual(checkImage(encodeRgb(8, 8, pattern(8, 8))).problems, []);
  const wide = encodeRgb(1025, 1, Buffer.alloc(1025 * 3, 128));
  assert.match(checkImage(wide).problems.join(' '), /larger than 1024x1024/);
});

test('downscale keeps a flat colour flat and gives the requested size', () => {
  const flat = Buffer.alloc(10 * 10 * 3);
  for (let i = 0; i < 100; i += 1) flat.set([12, 200, 99], i * 3);
  const small = downscale(flat, 10, 10, 3, 3);
  assert.equal(small.length, 27);
  for (let i = 0; i < 9; i += 1) assert.deepEqual([...small.subarray(i * 3, i * 3 + 3)], [12, 200, 99]);
});
