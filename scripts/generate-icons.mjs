import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const out = new URL('../public/icons/', import.meta.url);
await mkdir(out, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const radius = size * .22;
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4;
      const dx = Math.max(Math.abs(x - size / 2) - (size / 2 - radius), 0);
      const dy = Math.max(Math.abs(y - size / 2) - (size / 2 - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      let [r,g,b,a] = inside ? [79,70,229,255] : [11,17,32,255];
      const t = size / 18;
      const d1 = Math.abs((y - size*.55) - .9 * (x - size*.34));
      const d2 = Math.abs((y - size*.55) + .78 * (x - size*.60));
      const check = (x > size*.23 && x < size*.49 && y > size*.42 && y < size*.72 && d1 < t) ||
                    (x > size*.42 && x < size*.79 && y > size*.28 && y < size*.61 && d2 < t);
      if (check) [r,g,b,a] = [255,255,255,255];
      raw[o]=r; raw[o+1]=g; raw[o+2]=b; raw[o+3]=a;
    }
  }
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([signature, chunk('IHDR',ihdr), chunk('IDAT',deflateSync(raw)), chunk('IEND',Buffer.alloc(0))]);
}

for (const size of [192,512]) await writeFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png(size));
console.log('Generated MyRoutine icons.');
