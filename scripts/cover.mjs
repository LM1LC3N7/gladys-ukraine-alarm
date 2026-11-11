// Generates cover.png (800x534) for gladys-ukraine-alarm: plain Node, no
// dependency. A siren dome sending waves, beside a grid of region tiles lit
// grey, yellow or red, on a night-blue gradient (no brand logo, no map of a
// real country, no mark of alerts.in.ua). Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = x / W;
    const u = y / H;
    set(x, y, [16 + 18 * t, 26 + 30 * t + 20 * u, 58 + 50 * t]);
  }
}
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const rect = (x0, y0, w, h, color, alpha = 1) => {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) set(x, y, color, alpha);
};
/** A ring arc (angles in radians, 0 = right, counter-clockwise up). */
const arc = (cx, cy, r, width, from, to, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const angle = Math.atan2(cy - y, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(0, Math.min(1, width / 2 - Math.abs(d - r) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const red = [225, 60, 55];
const yellow = [245, 195, 60];
const grey = [70, 82, 110];
const white = [240, 244, 250];
const dark = [24, 28, 40];

// The siren: a dome on a base, waves on both sides.
const sx = 230;
const sy = 300;
rect(sx - 90, sy + 40, 180, 34, dark);
rect(sx - 80, sy + 30, 160, 14, [60, 66, 84]);
for (let y = sy - 80; y <= sy + 30; y += 1) {
  for (let x = sx - 80; x <= sx + 80; x += 1) {
    const dx = (x - sx) / 80;
    const dy = (sy + 30 - y) / 110;
    if (dx * dx + dy * dy <= 1) {
      const shade = 1 - 0.45 * Math.max(0, dx);
      set(x, y, [red[0] * shade, red[1] * shade, red[2] * shade]);
    }
  }
}
disc(sx - 30, sy - 30, 16, white, 0.55);
for (const [i, r] of [110, 150, 190].entries()) {
  arc(sx, sy - 10, r, 10, -0.6, 0.6, yellow, 0.9 - i * 0.25);
  arc(sx, sy - 10, r, 10, Math.PI - 0.6, Math.PI, yellow, 0.9 - i * 0.25);
  arc(sx, sy - 10, r, 10, -Math.PI, -Math.PI + 0.6, yellow, 0.9 - i * 0.25);
}

// The grid of region tiles: a few in alert, most calm.
const lit = { '1,1': red, '2,1': red, '2,2': yellow, '0,3': yellow, '3,0': red, '4,3': yellow };
for (let row = 0; row < 5; row += 1) {
  for (let col = 0; col < 5; col += 1) {
    const color = lit[`${col},${row}`] ?? grey;
    rect(470 + col * 58, 125 + row * 58, 48, 48, color, color === grey ? 0.8 : 0.95);
  }
}

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
