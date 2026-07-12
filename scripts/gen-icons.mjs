// PWA 아이콘(초록 배경 + 흰 원)을 PNG 로 생성한다. (외부 라이브러리 없이)
// 나중에 원하는 로고 이미지로 교체하면 됩니다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT_DIR } from '../src/env.mjs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePng(size) {
  const w = size, h = size;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  const cx = w / 2, cy = h / 2, r = w * 0.28;
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 4;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; raw[o + 3] = 255; // 흰 골프공
      } else {
        raw[o] = 11; raw[o + 1] = 93; raw[o + 2] = 52; raw[o + 3] = 255;    // 초록 배경
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const publicDir = path.join(ROOT_DIR, 'public');
fs.mkdirSync(publicDir, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(publicDir, `icon-${size}.png`), makePng(size));
  console.log(`✅ public/icon-${size}.png 생성`);
}
