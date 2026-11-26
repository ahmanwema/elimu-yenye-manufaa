import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenVerifier, TrackSource } from "livekit-server-sdk";
import { EnvError, getLiveKitEnv, isLiveKitConfigured } from "@/env";
import { audioGrantFor, identityForConnection, roomNameForSession, sessionIdFromRoomName } from "@/server/rtc/rtc";
import { createLiveKitProvider, videoGrantFor } from "@/server/rtc/livekit";
import { createFakeRtcProvider } from "@/server/rtc/fake";
import type { DeviceCapabilities } from "@/server/services/live-sessions";

// Live Class media phase M0 (docs/features/live-class-media-plan.md): the vendor-neutral audio
// boundary. Everything here runs offline — no request reaches LiveKit.

afterEach(() => vi.unstubAllEnvs());

const SESSION = "3f2b6c1e-8d4a-4b7e-9c2d-1a5e6f7b8c9d";
const CONNECTION = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TEST_ENV = { LIVEKIT_URL: "wss://example.livekit.cloud", LIVEKIT_API_KEY: "APItestkey", LIVEKIT_API_SECRET: "s".repeat(43) };

const caps = (over: Partial<DeviceCapabilities> = {}): DeviceCapabilities => ({
  live: true,
  viewOnly: false,
  admitted: true,
  publishMic: false,
  writeWhiteboard: false,
  screenShare: false,
  ...over,
});

describe("room and identity names", () => {
  it("derive the room from the session id only, and reverse it", () => {
    const room = roomNameForSession(SESSION);
    expect(room).toBe(`lc_${SESSION}`);
    expect(sessionIdFromRoomName(room)).toBe(SESSION);
  });

  it("ignore rooms this app did not create", () => {
    expect(sessionIdFromRoomName("pilot-room")).toBeNull();
    expect(sessionIdFromRoomName(`lc_${SESSION}x`)).toBeNull();
    expect(sessionIdFromRoomName(`xlc_${SESSION}`)).toBeNull();
  });

  it("refuse anything but a UUID", () => {
    expect(() => roomNameForSession("../other")).toThrow();
    expect(() => identityForConnection("someone@example.com")).toThrow();
  });
});

describe("audio grant from device capabilities (fails closed)", () => {
  it("gives no token to a device that is not live or not admitted", () => {
    expect(audioGrantFor(caps({ live: false }))).toBeNull();
    expect(audioGrantFor(caps({ admitted: false }))).toBeNull();
  });

  it("lets a device listen without publishing by default", () => {
    expect(audioGrantFor(caps())).toEqual({ canPublishMicrophone: false });
  });

  it("opens the mic only with publishMic, and never on a view-only device (A121)", () => {
    expect(audioGrantFor(caps({ publishMic: true }))).toEqual({ canPublishMicrophone: true });
    expect(audioGrantFor(caps({ publishMic: true, viewOnly: true }))).toEqual({ canPublishMicrophone: false });
  });
});

describe("LiveKit grants", () => {
  it("a listener can publish nothing: no sources, no data", () => {
    const g = videoGrantFor("lc_x", { canPublishMicrophone: false });
    expect(g).toMatchObject({ room: "lc_x", roomJoin: true, canSubscribe: true, canPublish: false, canPublishSources: [], canPublishData: false, canUpdateOwnMetadata: false });
  });

  it("a speaker may publish the microphone and nothing else", () => {
    const g = videoGrantFor("lc_x", { canPublishMicrophone: true });
    expect(g.canPublish).toBe(true);
    expect(g.canPublishSources).toEqual([TrackSource.MICROPHONE]);
    expect(g.canPublishData).toBe(false);
  });

  it("issues a signed, short-lived token bound to one room and one device", async () => {
    const provider = createLiveKitProvider(TEST_ENV);
    const issued = await provider.issueAudioToken({ sessionId: SESSION, connectionId: CONNECTION, displayName: "Ustadh", grant: { canPublishMicrophone: false } });
    expect(issued.url).toBe(TEST_ENV.LIVEKIT_URL);
    const claims = await new TokenVerifier(TEST_ENV.LIVEKIT_API_KEY, TEST_ENV.LIVEKIT_API_SECRET).verify(issued.token);
    expect(claims.sub).toBe(CONNECTION);
    expect(claims.name).toBe("Ustadh");
    expect(claims.video).toMatchObject({ room: roomNameForSession(SESSION), roomJoin: true, canPublish: false, canPublishData: false });
    expect(claims.exp! - claims.nbf!).toBeLessThanOrEqual(600);
  });

  it("a token signed with another secret is rejected", async () => {
    const issued = await createLiveKitProvider(TEST_ENV).issueAudioToken({ sessionId: SESSION, connectionId: CONNECTION, displayName: "x", grant: { canPublishMicrophone: true } });
    await expect(new TokenVerifier(TEST_ENV.LIVEKIT_API_KEY, "t".repeat(43)).verify(issued.token)).rejects.toThrow();
  });
});

describe("fake provider", () => {
  it("reports setPublish false until the device has joined the room", async () => {
    const rtc = createFakeRtcProvider();
    const room = roomNameForSession(SESSION);
    expect(await rtc.setPublish(room, CONNECTION, { canPublishMicrophone: true })).toBe(false);
    rtc.connect(room, CONNECTION);
    expect(await rtc.setPublish(room, CONNECTION, { canPublishMicrophone: true })).toBe(true);
    await rtc.closeRoom(room);
    expect(rtc.inRoom(room)).toEqual([]);
  });
});

describe("LiveKit environment", () => {
  it("accepts a valid configuration and trims a trailing slash", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://example.livekit.cloud/");
    vi.stubEnv("LIVEKIT_API_KEY", "APItestkey");
    vi.stubEnv("LIVEKIT_API_SECRET", "s".repeat(43));
    expect(getLiveKitEnv().LIVEKIT_URL).toBe("wss://example.livekit.cloud");
    expect(isLiveKitConfigured()).toBe(true);
  });

  it("is not configured when a value is missing, and never echoes the secret", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://example.livekit.cloud");
    vi.stubEnv("LIVEKIT_API_KEY", "APItestkey");
    vi.stubEnv("LIVEKIT_API_SECRET", "short-secret");
    expect(isLiveKitConfigured()).toBe(false);
    try {
      getLiveKitEnv();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect(String(e)).toContain("LIVEKIT_API_SECRET");
      expect(String(e)).not.toContain("short-secret");
    }
  });

  it("rejects a non-websocket URL", () => {
    vi.stubEnv("LIVEKIT_URL", "https://example.livekit.cloud");
    vi.stubEnv("LIVEKIT_API_KEY", "k");
    vi.stubEnv("LIVEKIT_API_SECRET", "s".repeat(43));
    expect(isLiveKitConfigured()).toBe(false);
  });
});
