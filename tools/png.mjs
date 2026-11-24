// Minimal PNG reader and writer for this entry's build and checks (Node standard library only).
// Reads 8-bit, non-interlaced greyscale, RGB and RGBA images; writes 8-bit RGB or palette images.
import { deflateSync, inflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Splits a PNG file into its chunks, checking the signature and every CRC. Throws on any defect. */
export function readChunks(file) {
  if (file.length < 8 || !file.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG: bad signature');
  const chunks = [];
  let at = 8;
  while (at < file.length) {
    if (at + 12 > file.length) throw new Error(`truncated chunk header at byte ${at}`);
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > file.length) throw new Error(`chunk ${type} runs past the end of the file`);
    const data = file.subarray(at + 8, at + 8 + length);
    const stored = file.readUInt32BE(at + 8 + length);
    const actual = crc32(file.subarray(at + 4, at + 8 + length));
    if (stored !== actual) throw new Error(`chunk ${type} has a bad CRC`);
    chunks.push({ type, data });
    at = end;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0 || chunks[0].type !== 'IHDR') throw new Error('first chunk is not IHDR');
  if (chunks[chunks.length - 1].type !== 'IEND') throw new Error('no IEND chunk');
  if (at !== file.length) throw new Error(`${file.length - at} stray bytes after IEND`);
  return chunks;
}

export function readHeader(ihdr) {
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    interlace: ihdr[12],
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the per-row filters of inflated image data, in a new buffer. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  if (raw.length !== height * (stride + 1)) throw new Error(`image data is ${raw.length} bytes, expected ${height * (stride + 1)}`);
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      const v = raw[src + x];
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) r = v + paeth(a, b, c);
      else throw new Error(`unknown filter type ${filter} on row ${y}`);
      out[row + x] = r & 0xff;
    }
  }
  return out;
}

/** Decodes a PNG to { width, height, rgb } (alpha composited onto white), checking every structure. */
export function decode(file) {
  const chunks = readChunks(file);
  const header = readHeader(chunks[0].data);
  const { width, height, bitDepth, colorType, interlace } = header;
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} is not supported here`);
  if (interlace !== 0) throw new Error('interlaced images are not supported here');
  const bpp = CHANNELS[colorType];
  if (!bpp) throw new Error(`colour type ${colorType} is invalid`);
  const palette = chunks.find((c) => c.type === 'PLTE')?.data;
  if (colorType === 3 && !palette) throw new Error('palette image without PLTE');
  if (palette && (palette.length % 3 !== 0 || palette.length < 3 || palette.length > 768)) {
    throw new Error(`PLTE of ${palette.length} bytes is malformed`);
  }
  if (chunks.some((c) => c.type === 'tRNS')) throw new Error('tRNS transparency is not supported here');
  if (width < 1 || height < 1) throw new Error(`image is ${width}x${height}`);
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const pixels = unfilter(inflateSync(idat), width, height, bpp);
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let b;
    let alpha = 255;
    if (colorType === 0 || colorType === 4) {
      r = g = b = pixels[i * bpp];
      if (colorType === 4) alpha = pixels[i * bpp + 1];
    } else if (colorType === 3) {
      const k = pixels[i] * 3;
      if (k + 2 >= palette.length) throw new Error(`palette index ${pixels[i]} out of range`);
      [r, g, b] = [palette[k], palette[k + 1], palette[k + 2]];
    } else {
      [r, g, b] = [pixels[i * bpp], pixels[i * bpp + 1], pixels[i * bpp + 2]];
      if (colorType === 6) alpha = pixels[i * bpp + 3];
    }
    const blend = (v) => Math.round((v * alpha + 255 * (255 - alpha)) / 255);
    rgb[i * 3] = blend(r);
    rgb[i * 3 + 1] = blend(g);
    rgb[i * 3 + 2] = blend(b);
  }
  return { width, height, rgb };
}

/** One PNG chunk: length, type, data and CRC (exported so the tests can build malformed files). */
export function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Filters each row with the filter whose output has the smallest sum of absolute values (the usual heuristic). */
function filterRows(pixels, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(height * (stride + 1));
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const prev = row - stride;
    let best = null;
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;
      for (let x = 0; x < stride; x += 1) {
        const v = pixels[row + x];
        const a = x >= bpp ? pixels[row + x - bpp] : 0;
        const b = y > 0 ? pixels[prev + x] : 0;
        const c = x >= bpp && y > 0 ? pixels[prev + x - bpp] : 0;
        let f;
        if (filter === 0) f = v;
        else if (filter === 1) f = v - a;
        else if (filter === 2) f = v - b;
        else if (filter === 3) f = v - ((a + b) >> 1);
        else f = v - paeth(a, b, c);
        candidate[x] = f & 0xff;
        score += candidate[x] < 128 ? candidate[x] : 256 - candidate[x];
      }
      if (score < bestScore) {
        bestScore = score;
        best = { filter, bytes: Buffer.from(candidate) };
      }
    }
    out[y * (stride + 1)] = best.filter;
    best.bytes.copy(out, y * (stride + 1) + 1);
  }
  return out;
}

function header(width, height, colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return chunk('IHDR', ihdr);
}

/** Encodes 8-bit RGB pixels as a PNG with no ancillary chunks, so equal pixels give equal bytes. */
export function encodeRgb(width, height, rgb) {
  const idat = deflateSync(filterRows(rgb, width, height, 3), { level: 9, memLevel: 9 });
  return Buffer.concat([PNG_SIGNATURE, header(width, height, 2), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Encodes indexed pixels (one byte each) with an RGB palette; palette images take no row filter. */
export function encodePalette(width, height, indices, paletteRgb) {
  const stride = width;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) indices.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const idat = deflateSync(raw, { level: 9, memLevel: 9 });
  return Buffer.concat([PNG_SIGNATURE, header(width, height, 3), chunk('PLTE', paletteRgb), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Exact palette of an RGB image, or null when it has more than 256 colours. */
export function exactPalette(rgb) {
  const index = new Map();
  const indices = Buffer.alloc(rgb.length / 3);
  for (let i = 0; i < indices.length; i += 1) {
    const key = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
    let k = index.get(key);
    if (k === undefined) {
      if (index.size === 256) return null;
      k = index.size;
      index.set(key, k);
    }
    indices[i] = k;
  }
  const palette = Buffer.alloc(index.size * 3);
  for (const [key, k] of index) {
    palette[k * 3] = key >> 16;
    palette[k * 3 + 1] = (key >> 8) & 0xff;
    palette[k * 3 + 2] = key & 0xff;
  }
  return { indices, palette };
}
