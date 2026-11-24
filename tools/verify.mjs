// Checks the entry the way the contest's gate describes it, offline:
//   1. entry.png is a whole PNG (signature, every chunk CRC, IHDR first, IEND last, image data complete)
//   2. it is at most 1024x1024 pixels and at most 1 MiB
//   3. main.ts, run twice into two fresh output folders, writes the same bytes both times, equal to entry.png
//   node tools/verify.mjs        prints a JSON report; exits 1 on any failure
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, readChunks, readHeader } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SIDE = 1024;
const MAX_BYTES = 1048576;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function checkImage(bytes) {
  const problems = [];
  let header = null;
  try {
    const chunks = readChunks(bytes);
    header = readHeader(chunks[0].data);
    decode(bytes);
  } catch (error) {
    problems.push(`not a whole PNG: ${error.message}`);
  }
  if (header && (header.width > MAX_SIDE || header.height > MAX_SIDE)) {
    problems.push(`${header.width}x${header.height} is larger than ${MAX_SIDE}x${MAX_SIDE}`);
  }
  if (bytes.length > MAX_BYTES) problems.push(`${bytes.length} bytes is over the ${MAX_BYTES}-byte cap`);
  return { header, problems };
}

function runEntry(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync(process.execPath, ['main.ts'], {
    cwd: ROOT,
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return readFileSync(join(outDir, 'entry.png'));
}

function main() {
  const source = readFileSync(join(ROOT, 'entry.png'));
  const { header, problems } = checkImage(source);
  const first = runEntry(join(ROOT, 'build', 'run1'));
  const second = runEntry(join(ROOT, 'build', 'run2'));
  if (!first.equals(second)) problems.push('the two runs of main.ts wrote different bytes');
  if (!first.equals(source)) problems.push('main.ts output differs from entry.png');
  const report = {
    ok: problems.length === 0,
    width: header?.width ?? null,
    height: header?.height ?? null,
    bytes: source.length,
    sha256: sha256(source),
    run1_sha256: sha256(first),
    run2_sha256: sha256(second),
    problems,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
