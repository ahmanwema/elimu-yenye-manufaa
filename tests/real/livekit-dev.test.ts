import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitEnv, isLiveKitConfigured } from "@/env";
import { createLiveKitProvider } from "@/server/rtc/livekit";
import { roomNameForSession } from "@/server/rtc/rtc";

// Live Class media M0: the LiveKit adapter against the owner's LiveKit Cloud project (A154).
// Creates nothing that lasts: a token is only signed locally, and the calls target a random room
// that does not exist, so they exercise authentication and the "not found" handling.
// Run with: npx vitest run --config vitest.real.config.mts tests/real/livekit-dev.test.ts

describe.skipIf(!isLiveKitConfigured())("LiveKit Cloud (real)", () => {
  const room = roomNameForSession(randomUUID());

  it("the API key and secret are accepted by the server", async () => {
    const env = getLiveKitEnv();
    const client = new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, "http"), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    await expect(client.listRooms([room])).resolves.toEqual([]);
  });

  it("changing permissions of someone not in the room reports false instead of failing", async () => {
    await expect(createLiveKitProvider().setPublish(room, randomUUID(), { canPublishMicrophone: true })).resolves.toBe(false);
  });

  it("removing from, and closing, a room that does not exist is not an error", async () => {
    const rtc = createLiveKitProvider();
    await expect(rtc.removeFromRoom(room, randomUUID())).resolves.toBeUndefined();
    await expect(rtc.closeRoom(room)).resolves.toBeUndefined();
  });

  it("issues a token for the project's URL", async () => {
    const issued = await createLiveKitProvider().issueAudioToken({ sessionId: randomUUID(), connectionId: randomUUID(), displayName: "test", grant: { canPublishMicrophone: false } });
    expect(issued.url).toBe(getLiveKitEnv().LIVEKIT_URL);
    expect(issued.token.split(".")).toHaveLength(3);
  });
});
