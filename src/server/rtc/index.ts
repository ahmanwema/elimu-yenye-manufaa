import "server-only";
import { isLiveKitConfigured } from "@/env";
import { createLiveKitProvider } from "./livekit";
import type { RtcProvider } from "./rtc";

let cached: RtcProvider | null | undefined;

/**
 * The configured audio provider, or null when LiveKit is not configured (the live page then
 * stays a business-state shell, as before M1). Created once per server instance.
 */
export function getRtcProvider(): RtcProvider | null {
  if (cached === undefined) cached = isLiveKitConfigured() ? createLiveKitProvider() : null;
  return cached;
}
