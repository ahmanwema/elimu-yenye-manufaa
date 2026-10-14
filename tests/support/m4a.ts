// Builds minimal but structurally valid ISO BMFF (MP4/M4A) files for tests, following
// ISO/IEC 14496-12 (boxes) and 14496-14 (esds). No audio is decoded by the server, so the
// mdat payload is filler; everything the server inspects (ftyp, moov, mvhd, trak/hdlr,
// stsd/mp4a/esds, mvex/mehd, box sizes) is real.

const enc = new TextEncoder();

function u32(n: number) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

export function box(type: string, ...payload: (Uint8Array | number[])[]): Uint8Array {
  const body = payload.flatMap((p) => Array.from(p));
  return new Uint8Array([...u32(8 + body.length), ...enc.encode(type), ...body]);
}

const fullbox = (type: string, version: number, ...payload: (Uint8Array | number[])[]) => box(type, [version, 0, 0, 0], ...payload);

function mvhd(timescale: number, duration: number) {
  // version 0: creation(4) modification(4) timescale(4) duration(4) + rest (80 bytes)
  return fullbox("mvhd", 0, u32(0), u32(0), u32(timescale), u32(duration), new Array(80).fill(0));
}

function hdlr(handler: string) {
  return fullbox("hdlr", 0, u32(0), Array.from(enc.encode(handler)), new Array(12).fill(0), [0]);
}

function esds(objectType: number) {
  const decoderConfig = [0x04, 13, objectType, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const es = [0x03, 3 + decoderConfig.length, 0, 1, 0, ...decoderConfig];
  return fullbox("esds", 0, es);
}

function mp4a(objectType: number) {
  // SampleEntry(6 reserved + 2 dref) + AudioSampleEntry(8 reserved, channels, size, 4, rate)
  const header = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 16, 0, 0, 0, 0, ...u32(44100 << 16)];
  return box("mp4a", header, esds(objectType));
}

function trak(handler: string, sampleEntry: Uint8Array) {
  const stsd = fullbox("stsd", 0, u32(1), sampleEntry);
  return box("trak", box("mdia", hdlr(handler), box("minf", box("stbl", stsd))));
}

export type M4aOptions = {
  durationMs: number;
  timescale?: number;
  /** "soun" + AAC by default. */
  tracks?: { handler: string; entry: Uint8Array }[];
  /** Put moov after mdat (exercises ranged reads beyond the first bytes). */
  moovLast?: boolean;
  /** Fragmented: mvhd duration 0 and the total in mvex/mehd (or none if mehd is false). */
  fragmented?: { mehd: boolean };
  ftypBrand?: string;
  mdatBytes?: number;
};

export const aacEntry = () => mp4a(0x40);
export const mp3Entry = () => mp4a(0x6b);
export const videoEntry = () => box("avc1", new Array(78).fill(0));

export function buildM4a(o: M4aOptions): Uint8Array {
  const timescale = o.timescale ?? 1000;
  const duration = Math.round((o.durationMs * timescale) / 1000);
  const tracks = o.tracks ?? [{ handler: "soun", entry: aacEntry() }];
  const moovChildren = [
    mvhd(timescale, o.fragmented ? 0 : duration),
    ...tracks.map((t) => trak(t.handler, t.entry)),
    ...(o.fragmented?.mehd ? [box("mvex", fullbox("mehd", 0, u32(duration)))] : o.fragmented ? [box("mvex")] : []),
  ];
  const moov = box("moov", ...moovChildren);
  const ftyp = box("ftyp", Array.from(enc.encode(o.ftypBrand ?? "M4A ")), u32(0), Array.from(enc.encode("M4A isommp42")));
  const mdat = box("mdat", new Array(o.mdatBytes ?? 64).fill(0xaa));
  const parts = o.moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
