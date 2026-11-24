// Integration test of the entry itself: run with  node --test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkImage } from '../tools/verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(outDir) {
  execFileSync(process.execPath, ['main.ts'], { cwd: ROOT, env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir } });
  return readFileSync(join(outDir, 'entry.png'));
}

test('entry.png passes the gate rules: whole PNG, <= 1024x1024, <= 1 MiB', () => {
  const { header, problems } = checkImage(readFileSync(join(ROOT, 'entry.png')));
  assert.deepEqual(problems, []);
  assert.equal(header.width, 1024);
  assert.equal(header.height, 1024);
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
