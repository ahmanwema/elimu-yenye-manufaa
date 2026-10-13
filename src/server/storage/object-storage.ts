import { randomBytes, randomUUID } from "node:crypto";

/**
 * Vendor-neutral object storage contract. The approved backend is Supabase Storage
 * (A38); see ./supabase-storage.ts. Application code depends only on this interface.
 *
 * Rules:
 * - Buckets are PRIVATE. Nothing is served from a public URL.
 * - Object keys are generated server-side and are never accepted from a client.
 * - Access is decided by the database + authz layer, then granted with a short-lived
 *   signed URL. The key itself confers no authority, and nothing is inferred from it.
 */
export interface ObjectStorage {
  createSignedUploadUrl(bucket: string, key: string): Promise<{ url: string }>;
  createSignedDownloadUrl(bucket: string, key: string, expiresInSeconds: number): Promise<{ url: string }>;
  /** Server-side check of what was actually stored (never trust a client-reported size). */
  statObject(bucket: string, key: string): Promise<{ exists: false } | { exists: true; byteSize: number }>;
}

/** Private bucket for standalone correction clips. Not created by this code. */
export const CORRECTION_CLIP_BUCKET = "correction-clips";

/** Engineering default; not a business rule. */
export const SIGNED_DOWNLOAD_TTL_SECONDS = 300;

/**
 * Non-guessable key for a new correction clip. Deliberately contains no tenant,
 * student, teacher or correction identifiers: those relationships live in the database
 * (correction_audio_clips) and are never derived from the path.
 */
export function newCorrectionClipObjectKey(): string {
  return `clips/${randomUUID()}/${randomBytes(16).toString("base64url")}`;
}
