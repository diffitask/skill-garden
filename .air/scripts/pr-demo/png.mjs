// Just enough PNG for screenshots: 8-bit RGB/RGBA, non-interlaced, in and out.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes) => {
  let c = -1;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

/** @returns {{width: number, height: number, data: Uint8Array}} RGBA pixels */
export function decodePNG(buffer) {
  const bytes = Buffer.from(buffer);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let width = 0, height = 0, channels = 0;
  const idat = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const [depth, color, , , interlace] = chunk.subarray(8);
      channels = { 2: 3, 6: 4 }[color] ?? 0;
      if (depth !== 8 || !channels || interlace) throw new Error('Unsupported PNG format');
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      pixels[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: pixels };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) data.set([pixels[i], pixels[i + 1], pixels[i + 2], 255], j);
  return { width, height, data };
}

/** RGBA pixels to PNG bytes, unfiltered. */
export function encodePNG({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Where two screenshots differ, as rectangles. Changed pixels are marked on a grid of
 * `cell`-pixel squares; touching cells merge into one rectangle, padded by `padding`.
 * Outside the smaller image everything counts as changed.
 * @returns {{x: number, y: number, width: number, height: number}[]}
 */
export function diffRegions(before, after, { threshold = 24, cell = 8, padding = 6 } = {}) {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const columns = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const marked = new Uint8Array(columns * rows);
  const pixel = (image, x, y) => (x < image.width && y < image.height ? (y * image.width + x) * 4 : -1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixel(before, x, y), b = pixel(after, x, y);
      let changed = a < 0 || b < 0;
      for (let c = 0; !changed && c < 4; c++) changed = Math.abs(before.data[a + c] - after.data[b + c]) > threshold;
      if (changed) marked[Math.floor(y / cell) * columns + Math.floor(x / cell)] = 1;
    }
  }
  const regions = [];
  const seen = new Uint8Array(marked.length);
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || seen[start]) continue;
    let [left, top, right, bottom] = [columns, rows, 0, 0];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop();
      const cx = index % columns, cy = Math.floor(index / columns);
      [left, top, right, bottom] = [Math.min(left, cx), Math.min(top, cy), Math.max(right, cx), Math.max(bottom, cy)];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy, next = ny * columns + nx;
          if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && marked[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
        }
      }
    }
    const x = Math.max(0, left * cell - padding), y = Math.max(0, top * cell - padding);
    regions.push({ x, y,
      width: Math.min(width, (right + 1) * cell + padding) - x,
      height: Math.min(height, (bottom + 1) * cell + padding) - y });
  }
  return mergeOverlapping(regions);
}

/** Padding can make neighbouring regions overlap; one outline reads better than a stack. */
function mergeOverlapping(regions) {
  const overlap = (a, b) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < regions.length && !merged; i++) {
      for (let j = i + 1; j < regions.length && !merged; j++) {
        if (!overlap(regions[i], regions[j])) continue;
        const [a, b] = [regions[i], regions[j]];
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        regions[i] = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        regions.splice(j, 1);
        merged = true;
      }
    }
  }
  return regions.sort((a, b) => a.y - b.y || a.x - b.x);
}
