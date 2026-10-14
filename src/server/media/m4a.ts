// Server-side check that a stored object really is AAC audio in an M4A (ISO BMFF / MPEG-4)
// container, and how long it is (A69: AAC in M4A, at most 60 s). Reads only the box
// headers and the `moov` metadata box through ranged reads — never trusts the uploader's
// MIME type or duration, and never decodes audio.
//
// Limits of this check (documented): fragmented MP4 without a total duration (mvhd = 0 and
// no mvex/mehd) is rejected as "duration_unknown" rather than measured fragment by fragment.

export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

export type M4aInspection =
  | { ok: true; durationMs: number; durationUnits: bigint; timescale: number }
  | { ok: false; reason: "not_mp4" | "no_moov" | "not_audio_only" | "not_aac" | "duration_unknown" | "metadata_too_large" | "malformed" };

/**
 * Parse budget for the `moov` metadata box. An engineering safety bound so a hostile file
 * cannot make the server download unbounded metadata — NOT a file-size limit (none is
 * approved). A real ≤60 s AAC clip has a `moov` of a few kilobytes.
 */
export const MAX_M4A_METADATA_BYTES = 1_048_576;
const MAX_TOP_LEVEL_BOXES = 256;

/** MPEG-4 / MPEG-2 AAC objectTypeIndication values in an esds DecoderConfigDescriptor. */
const AAC_OBJECT_TYPES = new Set([0x40, 0x66, 0x67, 0x68]);

const type4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const ZERO = BigInt(0);
const THOUSAND = BigInt(1000);
const TWO = BigInt(2);
const SHIFT32 = BigInt(32);
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u64 = (b: Uint8Array, at: number) => (BigInt(u32(b, at)) << SHIFT32) + BigInt(u32(b, at + 4));

type Box = { type: string; start: number; end: number }; // start/end of the PAYLOAD

class Malformed extends Error {}

/** Child boxes of buf[from, to). */
function children(buf: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(buf, at);
    const type = type4(buf, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) throw new Malformed();
      const big = u64(buf, at + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Malformed();
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) throw new Malformed();
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const child = (buf: Uint8Array, box: Box, type: string) => children(buf, box.start, box.end).find((c) => c.type === type);

function readDescriptorLength(buf: Uint8Array, at: number): { length: number; next: number } {
  let length = 0;
  for (let i = 0; i < 4; i++) {
    const byte = buf[at + i];
    if (byte === undefined) throw new Malformed();
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { length, next: at + i + 1 };
  }
  throw new Malformed();
}

/** objectTypeIndication from an esds box payload, or null. */
function esdsObjectType(buf: Uint8Array, esds: Box): number | null {
  let at = esds.start + 4; // FullBox version + flags
  if (buf[at] !== 0x03) return null; // ES_Descriptor
  at = readDescriptorLength(buf, at + 1).next;
  const flags = buf[at + 2];
  at += 3; // ES_ID (2) + flags (1)
  if (flags & 0x80) at += 2; // dependsOn_ES_ID
  if (flags & 0x40) at += 1 + buf[at]; // URL
  if (flags & 0x20) at += 2; // OCR_ES_Id
  if (buf[at] !== 0x04) return null; // DecoderConfigDescriptor
  at = readDescriptorLength(buf, at + 1).next;
  return at < esds.end ? buf[at] : null;
}

/** Is this stsd sample entry AAC audio? */
function isAacSampleEntry(buf: Uint8Array, entry: Box): boolean {
  if (entry.type !== "mp4a") return false;
  // SampleEntry (8) + AudioSampleEntry (20); QuickTime sound description v1/v2 add 16/36.
  const version = u16(buf, entry.start + 8);
  const extra = version === 1 ? 16 : version === 2 ? 36 : 0;
  const boxes = children(buf, entry.start + 28 + extra, entry.end);
  const esds = boxes.find((b) => b.type === "esds") ?? (() => {
    const wave = boxes.find((b) => b.type === "wave");
    return wave ? child(buf, wave, "esds") : undefined;
  })();
  if (!esds) return false;
  const oti = esdsObjectType(buf, esds);
  return oti !== null && AAC_OBJECT_TYPES.has(oti);
}

function inspectMoov(moov: Uint8Array): M4aInspection {
  const root: Box = { type: "moov", start: u32(moov, 0) === 1 ? 16 : 8, end: moov.length };
  const top = children(moov, root.start, root.end);
  const mvhd = top.find((b) => b.type === "mvhd");
  if (!mvhd) return { ok: false, reason: "malformed" };
  const v1 = moov[mvhd.start] === 1;
  const timescale = v1 ? u32(moov, mvhd.start + 20) : u32(moov, mvhd.start + 12);
  let duration = v1 ? u64(moov, mvhd.start + 24) : BigInt(u32(moov, mvhd.start + 16));

  const traks = top.filter((b) => b.type === "trak");
  if (traks.length === 0) return { ok: false, reason: "not_audio_only" };
  for (const trak of traks) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = mdia && child(moov, mdia, "hdlr");
    if (!mdia || !hdlr) return { ok: false, reason: "malformed" };
    if (type4(moov, hdlr.start + 8) !== "soun") return { ok: false, reason: "not_audio_only" };
    const stsd = (() => {
      const minf = child(moov, mdia, "minf");
      const stbl = minf && child(moov, minf, "stbl");
      return stbl && child(moov, stbl, "stsd");
    })();
    if (!stsd) return { ok: false, reason: "malformed" };
    const entries = children(moov, stsd.start + 8, stsd.end); // FullBox (4) + entry_count (4)
    if (entries.length === 0 || !entries.every((e) => isAacSampleEntry(moov, e))) return { ok: false, reason: "not_aac" };
  }

  if (duration === ZERO) {
    // Fragmented MP4: the total may be declared in mvex/mehd.
    const mvex = top.find((b) => b.type === "mvex");
    const mehd = mvex && child(moov, mvex, "mehd");
    if (mehd) duration = moov[mehd.start] === 1 ? u64(moov, mehd.start + 4) : BigInt(u32(moov, mehd.start + 4));
  }
  if (timescale === 0 || duration === ZERO) return { ok: false, reason: "duration_unknown" };
  const durationMs = Number((duration * THOUSAND + BigInt(timescale) / TWO) / BigInt(timescale));
  return { ok: true, durationMs, durationUnits: duration, timescale };
}

/** Is the object at `read`/`size` AAC-in-M4A, and how long is it? */
export async function inspectM4a(read: RangeReader, size: number): Promise<M4aInspection> {
  try {
    let at = 0;
    let first = true;
    let moov: Uint8Array | null = null;
    for (let n = 0; at < size && n < MAX_TOP_LEVEL_BOXES; n++) {
      const head = await read(at, Math.min(16, size - at));
      if (head.length < 8) return { ok: false, reason: first ? "not_mp4" : "malformed" };
      let boxSize = u32(head, 0);
      const type = type4(head, 4);
      if (first && type !== "ftyp") return { ok: false, reason: "not_mp4" };
      first = false;
      if (boxSize === 1) {
        if (head.length < 16) return { ok: false, reason: "malformed" };
        const big = u64(head, 8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "malformed" };
        boxSize = Number(big);
      } else if (boxSize === 0) {
        boxSize = size - at;
      }
      if (boxSize < 8 || at + boxSize > size) return { ok: false, reason: "malformed" };
      if (type === "moov") {
        if (boxSize > MAX_M4A_METADATA_BYTES) return { ok: false, reason: "metadata_too_large" };
        if (moov) return { ok: false, reason: "malformed" }; // two moov boxes
        moov = await read(at, boxSize);
        if (moov.length !== boxSize) return { ok: false, reason: "malformed" };
      }
      at += boxSize;
    }
    // Every top-level box must end exactly at the end of the file (no truncated audio).
    if (at !== size) return { ok: false, reason: first ? "not_mp4" : "malformed" };
    if (first) return { ok: false, reason: "not_mp4" };
    if (!moov) return { ok: false, reason: "no_moov" };
    return inspectMoov(moov);
  } catch (error) {
    if (error instanceof Malformed || error instanceof RangeError) return { ok: false, reason: "malformed" };
    throw error;
  }
}
