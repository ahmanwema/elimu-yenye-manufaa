import { describe, expect, it } from "vitest";
import { inspectM4a, MAX_M4A_METADATA_BYTES } from "@/server/media/m4a";
import { aacEntry, box, buildM4a, mp3Entry, videoEntry } from "../support/m4a";

const reader = (bytes: Uint8Array) => {
  const reads: [number, number][] = [];
  return {
    reads,
    read: async (offset: number, length: number) => {
      reads.push([offset, length]);
      return bytes.slice(offset, offset + length);
    },
  };
};
const inspect = (bytes: Uint8Array) => inspectM4a(reader(bytes).read, bytes.length);

describe("M4A (AAC) inspection of stored bytes (A69)", () => {
  it("accepts AAC in M4A and measures the duration from the container", async () => {
    const result = await inspect(buildM4a({ durationMs: 12_345 }));
    expect(result).toMatchObject({ ok: true, durationMs: 12_345 });
  });

  it("measures with any timescale (e.g. the 44.1 kHz sample rate)", async () => {
    expect(await inspect(buildM4a({ durationMs: 60_000, timescale: 44_100 }))).toMatchObject({ ok: true, durationMs: 60_000 });
  });

  it("finds moov after mdat with ranged reads, without downloading the audio", async () => {
    const bytes = buildM4a({ durationMs: 5000, moovLast: true, mdatBytes: 200_000 });
    const r = reader(bytes);
    expect(await inspectM4a(r.read, bytes.length)).toMatchObject({ ok: true, durationMs: 5000 });
    const bytesRead = r.reads.reduce((n, [, len]) => n + len, 0);
    expect(bytesRead).toBeLessThan(2000); // headers + moov only
  });

  it("uses the declared total of a fragmented file; rejects one without it", async () => {
    expect(await inspect(buildM4a({ durationMs: 7000, fragmented: { mehd: true } }))).toMatchObject({ ok: true, durationMs: 7000 });
    expect(await inspect(buildM4a({ durationMs: 7000, fragmented: { mehd: false } }))).toEqual({ ok: false, reason: "duration_unknown" });
  });

  it.each([
    ["MP3 inside MP4", buildM4a({ durationMs: 1000, tracks: [{ handler: "soun", entry: mp3Entry() }] }), "not_aac"],
    ["a video track", buildM4a({ durationMs: 1000, tracks: [{ handler: "soun", entry: aacEntry() }, { handler: "vide", entry: videoEntry() }] }), "not_audio_only"],
    ["a WAV/RIFF file", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]), "not_mp4"],
    ["an MP4 with no moov", (() => { const f = box("ftyp", [77, 52, 65, 32, 0, 0, 0, 0]); return f; })(), "no_moov"],
    ["random bytes", new Uint8Array(64).fill(7), "not_mp4"],
    ["an empty file", new Uint8Array(0), "not_mp4"],
  ])("rejects %s", async (_l, bytes, reason) => {
    expect(await inspect(bytes as Uint8Array)).toEqual({ ok: false, reason });
  });

  it("rejects truncated or lying box sizes instead of reading past the end", async () => {
    const good = buildM4a({ durationMs: 1000 });
    expect(await inspect(good.slice(0, good.length - 10))).toMatchObject({ ok: false });
    const lying = good.slice();
    lying[3] = 0xff; // ftyp claims to be bigger than the file
    expect(await inspect(lying)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses an oversized metadata box without downloading it (parse budget, not a file-size limit)", async () => {
    const huge = new Uint8Array(16);
    huge.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]); // ftyp, 16 bytes
    const size = 16 + MAX_M4A_METADATA_BYTES + 8;
    const header = new Uint8Array([(MAX_M4A_METADATA_BYTES + 8) >>> 24, ((MAX_M4A_METADATA_BYTES + 8) >>> 16) & 0xff, ((MAX_M4A_METADATA_BYTES + 8) >>> 8) & 0xff, (MAX_M4A_METADATA_BYTES + 8) & 0xff, 0x6d, 0x6f, 0x6f, 0x76]);
    const reads: number[] = [];
    const result = await inspectM4a(async (offset, length) => {
      reads.push(length);
      if (offset === 0) return huge.slice(0, length);
      return header.slice(0, Math.min(length, 8));
    }, size);
    expect(result).toEqual({ ok: false, reason: "metadata_too_large" });
    expect(Math.max(...reads)).toBeLessThanOrEqual(16);
  });
});
