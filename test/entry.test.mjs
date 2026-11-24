// Integration test of the entry itself: run with  node --test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodeRgb } from '../tools/png.mjs';
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
