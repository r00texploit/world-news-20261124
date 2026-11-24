// Unit tests for the PNG tools: run with  node --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunk, crc32, decode, encodePalette, encodeRgb, exactPalette, readChunks } from '../tools/png.mjs';
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
  const rgb = Buffer.alloc(8 * 4 * 3);
  for (let i = 0; i < 32; i += 1) rgb.set(i % 3 === 0 ? [200, 30, 30] : [10, 20, 40], i * 3);
  const { indices, palette } = exactPalette(rgb);
  assert.equal(palette.length, 6);
  assert.deepEqual(decode(encodePalette(8, 4, indices, palette)).rgb, rgb);
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

test('exactPalette gives up past 256 colours', () => {
  const rgb = Buffer.alloc(300 * 3);
  for (let i = 0; i < 300; i += 1) rgb.set([i & 0xff, i >> 8, 7], i * 3);
  assert.equal(exactPalette(rgb), null);
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
