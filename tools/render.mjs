// Builds entry.png from design/page.html: a local headless Chrome screenshot at 1024x1024, then a
// re-encode with no metadata (so the committed bytes depend only on the pixels).
//   node tools/render.mjs            writes entry.png at the repository root
//   CHROME=/path/to/chrome node tools/render.mjs
// The build needs no network: the page loads no remote resource and uses fonts installed on this machine.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decode, encodeRgb } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const MAX_BYTES = 1048576;
const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error(`no Chrome or Edge found; set CHROME to its path (looked in: ${CANDIDATES.join(', ')})`);
  return found;
}

function screenshot(page, out) {
  // a fresh browser profile per render, so no cache or state from an earlier run can change the pixels
  const profile = mkdtempSync(join(tmpdir(), 'entry-chrome-'));
  try {
    runChrome(profile, page, out);
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function runChrome(profile, page, out) {
  execFileSync(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--font-render-hinting=none',
    `--user-data-dir=${profile}`,
    `--window-size=${SIZE},${SIZE}`,
    `--screenshot=${out}`,
    pathToFileURL(page).href,
  ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 });
}

function main() {
  const page = join(ROOT, process.argv[2] ?? 'design/page.html');
  const target = join(ROOT, process.argv[3] ?? 'entry.png');
  const shot = join(ROOT, 'build', 'screenshot.png');
  mkdirSync(dirname(shot), { recursive: true });
  rmSync(shot, { force: true });
  screenshot(page, shot);
  const { width, height, rgb } = decode(readFileSync(shot));
  if (width !== SIZE || height !== SIZE) throw new Error(`screenshot is ${width}x${height}, expected ${SIZE}x${SIZE}`);
  const png = encodeRgb(width, height, rgb);
  if (png.length > MAX_BYTES) throw new Error(`encoded image is ${png.length} bytes, over the ${MAX_BYTES}-byte cap`);
  writeFileSync(target, png);
  const sha = createHash('sha256').update(png).digest('hex');
  console.log(JSON.stringify({ file: target, width, height, bytes: png.length, sha256: sha }));
}

main();
