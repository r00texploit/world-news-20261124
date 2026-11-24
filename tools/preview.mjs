// Writes an area-averaged downscale of entry.png, to check what stays legible at small sizes.
//   node tools/preview.mjs [width]     (default 300) -> build/preview-<width>.png
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encodeRgb } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Box-filter resample: each output pixel is the coverage-weighted mean of the source pixels under it. */
export function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 3);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const y0 = y * fy;
    const y1 = y0 + fy;
    for (let x = 0; x < dw; x += 1) {
      const x0 = x * fx;
      const x1 = x0 + fx;
      const acc = [0, 0, 0];
      let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * sw + sx) * 3;
          acc[0] += src[i] * w;
          acc[1] += src[i + 1] * w;
          acc[2] += src[i + 2] * w;
          weight += w;
        }
      }
      for (let c = 0; c < 3; c += 1) out[(y * dw + x) * 3 + c] = Math.round(acc[c] / weight);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const width = Number(process.argv[2] ?? 300);
  const { width: sw, height: sh, rgb } = decode(readFileSync(join(ROOT, 'entry.png')));
  const height = Math.round((sh / sw) * width);
  const out = join(ROOT, 'build', `preview-${width}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodeRgb(width, height, downscale(rgb, sw, sh, width, height)));
  console.log(out);
}
