// Integration test of the entry itself: run with  node --test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chunk, encodePalette, encodeRgb, PNG_SIGNATURE } from '../tools/png.mjs';
import { checkImage } from '../tools/verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(outDir) {
  execFileSync(process.execPath, ['--experimental-strip-types', 'main.ts'], {
    cwd: ROOT,
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return readFileSync(join(outDir, 'entry.png'));
}

test('entry.png passes the gate rules: whole PNG, <= 1024x1024, <= 1 MiB', () => {
  const { header, problems } = checkImage(readFileSync(join(ROOT, 'entry.png')));
  assert.deepEqual(problems, []);
  assert.equal(header.width, 1024);
  assert.equal(header.height, 1024);
});

/** Runs a copy of main.ts beside the given image bytes; returns true when it wrote the image. */
function runWithImage(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'entry-img-'));
  try {
    copyFileSync(join(ROOT, 'main.ts'), join(dir, 'main.ts'));
    writeFileSync(join(dir, 'entry.png'), bytes);
    execFileSync(process.execPath, ['--experimental-strip-types', 'main.ts'], {
      cwd: dir,
      env: { ...process.env, MAKEFUN_OUTPUT_DIR: join(dir, 'out') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return readFileSync(join(dir, 'out', 'entry.png')).equals(bytes);
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('main.ts accepts a small valid PNG and refuses corrupt, oversize or empty ones', () => {
  const good = encodeRgb(4, 3, Buffer.alloc(36, 90));
  assert.equal(runWithImage(good), true);
  const badCrc = Buffer.from(good);
  badCrc[good.length - 20] ^= 0xff;
  assert.equal(runWithImage(badCrc), false);
  assert.equal(runWithImage(encodeRgb(1025, 1, Buffer.alloc(1025 * 3, 1))), false);
  assert.equal(runWithImage(encodeRgb(0, 0, Buffer.alloc(0))), false);
  assert.equal(runWithImage(good.subarray(0, good.length - 12)), false);
});

/** A 2x2 RGB PNG built chunk by chunk, so a test can break one part of it. */
function handBuilt({ filter = 0, extra = [], iendData = Buffer.alloc(0), trailing = Buffer.alloc(0) } = {}) {
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  const row = Buffer.from([filter, 10, 20, 30, 40, 50, 60]);
  const idat = Buffer.concat([deflateSync(Buffer.concat([row, row])), trailing]);
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...extra, chunk('IDAT', idat), chunk('IEND', iendData)]);
}

test('main.ts refuses malformed chunk streams and bad filter bytes', () => {
  assert.equal(runWithImage(handBuilt()), true);
  assert.equal(runWithImage(handBuilt({ filter: 7 })), false);
  assert.equal(runWithImage(handBuilt({ iendData: Buffer.from([1]) })), false);
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  assert.equal(runWithImage(handBuilt({ extra: [chunk('IHDR', ihdr)] })), false);
  assert.equal(runWithImage(handBuilt({ extra: [chunk('ABCD', Buffer.alloc(0))] })), false);
  assert.equal(runWithImage(handBuilt({ extra: [chunk('tEXt', Buffer.from('Title\0ok'))] })), true);
  assert.equal(runWithImage(handBuilt({ trailing: Buffer.from([1, 2, 3]) })), false);
  const plte = chunk('PLTE', Buffer.from([1, 2, 3]));
  assert.equal(runWithImage(handBuilt({ extra: [plte, plte] })), false);
  const palette = encodePalette(2, 2, Buffer.from([0, 0, 0, 0]), Buffer.from([9, 9, 9]));
  assert.equal(runWithImage(palette), false);
  assert.equal(checkImage(handBuilt({ trailing: Buffer.from([1, 2, 3]) })).problems.length > 0, true);
});

test('checkImage flags an image with no pixels', () => {
  assert.notDeepEqual(checkImage(encodeRgb(0, 0, Buffer.alloc(0))).problems, []);
});

test('main.ts writes identical bytes on two runs, equal to entry.png', () => {
  const a = mkdtempSync(join(tmpdir(), 'entry-a-'));
  const b = mkdtempSync(join(tmpdir(), 'entry-b-'));
  try {
    const first = run(a);
    const second = run(b);
    assert.ok(first.equals(second));
    assert.ok(first.equals(readFileSync(join(ROOT, 'entry.png'))));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
