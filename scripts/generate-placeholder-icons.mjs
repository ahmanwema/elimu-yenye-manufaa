// Generates PLACEHOLDER PWA icons (solid colour with a lighter centre block) using
// only Node built-ins. Replace with real brand icons before any public release.
// Usage: node scripts/generate-placeholder-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [0x10, 0x15, 0x1b];
const FG = [0x4f, 0xb3, 0xa5];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// `inset` is the fraction of the canvas kept as background around the centre block.
function png(size, inset) {
  const lo = Math.round(size * inset);
  const hi = size - lo;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const c = x >= lo && x < hi && y >= lo && y < hi ? FG : BG;
      row.set(c, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 0.25));
writeFileSync("public/icons/icon-512.png", png(512, 0.25));
// Maskable icons need the important content inside the central 80% safe zone.
writeFileSync("public/icons/icon-maskable-512.png", png(512, 0.35));
writeFileSync("public/icons/apple-touch-icon.png", png(180, 0.25));
console.log("Placeholder icons written to public/icons/");
