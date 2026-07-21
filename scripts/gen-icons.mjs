// PWA 아이콘 생성 — '핑' 디자인(라이트 크림 배경 + 딥그린 골프공 발신기 + 동심원 2개).
//  외부 라이브러리 없이 픽셀을 직접 계산해 PNG로 인코딩. 3배 슈퍼샘플링으로 안티에일리어싱.
//  기준 좌표는 512 공간, 마크는 중앙(256,256)에 크게 배치(마스커블 안전영역 내).
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

// ── 디자인 파라미터 (512 공간) — 반전: 딥그린 배경 + 크림 오브젝트 ──
const CREAM = [241, 235, 221];
const GREEN_CTR = [23, 102, 63];   // 배경 중심(살짝 밝은 그린)
const GREEN_EDGE = [9, 55, 33];    // 배경 가장자리(어둡게 — 비네트)
const DIMPLE = [12, 64, 40];       // 크림 공 위의 그린 딤플
const CX = 256, CY = 256;
const BALL_R = 84;
const RINGS = [ { r: 128, s: 20, op: 0.46 }, { r: 180, s: 20, op: 0.22 } ]; // 안쪽 진하게 / 바깥 옅게 (크림)
// 골프공 딤플(공 중심 기준 오프셋, 반지름) — 승인된 '핑' 시안 패턴을 키움
const DIMPLES = [ [-30, -30, 11], [18, -40, 11], [35, 10, 11], [-20, 25, 11], [3, -5, 9] ];

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;

// 512 공간의 한 점 (u,v) 색상 (하드 엣지 — AA는 슈퍼샘플 다운스케일이 담당)
function colorAt(u, v) {
  const dx = u - CX, dy = v - CY;
  const d = Math.sqrt(dx * dx + dy * dy);
  // 1) 딥그린 배경 + 은은한 비네트(중심 밝고 가장자리 어둡게)
  let col = mix(GREEN_CTR, GREEN_EDGE, clamp01((d - 30) / 260));
  // 2) 동심원(공 뒤) — 반투명 크림
  for (const ring of RINGS) {
    if (Math.abs(d - ring.r) <= ring.s / 2) col = mix(col, CREAM, ring.op);
  }
  // 3) 골프공(불투명 크림)
  if (d <= BALL_R) {
    col = CREAM;
    // 4) 딤플(그린)
    for (const [ox, oy, dr] of DIMPLES) {
      const ex = u - (CX + ox), ey = v - (CY + oy);
      if (ex * ex + ey * ey <= dr * dr) { col = DIMPLE; break; }
    }
  }
  return col;
}

function makePng(size) {
  const SS = 3;                 // 슈퍼샘플 배율
  const W = size * SS;
  const scale = W / 512;        // 512 → 하이레스 픽셀
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const inv = 1 / (SS * SS);
  for (let py = 0; py < size; py++) {
    raw[py * stride] = 0;       // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px * SS + sx + 0.5) / scale;
          const v = (py * SS + sy + 0.5) / scale;
          const c = colorAt(u, v);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = py * stride + 1 + px * 4;
      raw[o] = Math.round(r * inv);
      raw[o + 1] = Math.round(g * inv);
      raw[o + 2] = Math.round(b * inv);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;     // 8bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const publicDir = path.join(ROOT_DIR, 'public');
fs.mkdirSync(publicDir, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(publicDir, `icon-${size}.png`), makePng(size));
  console.log(`✅ public/icon-${size}.png 생성 (핑 디자인)`);
}
