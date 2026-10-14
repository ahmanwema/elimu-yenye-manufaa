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
 * - Objects are removed only by the approved purge (after the grace period) or when an
 *   upload was never finalized — never as part of a normal request.
 */
export interface ObjectStorage {
  createSignedUploadUrl(bucket: string, key: string): Promise<{ url: string }>;
  createSignedDownloadUrl(bucket: string, key: string, expiresInSeconds: number): Promise<{ url: string }>;
  /** Server-side check of what was actually stored (never trust a client-reported size). */
  statObject(bucket: string, key: string): Promise<{ exists: false } | { exists: true; byteSize: number }>;
  /** Server-side ranged read, used to inspect a stored file's container metadata. */
  readRange(bucket: string, key: string, offset: number, length: number): Promise<Uint8Array>;
  /** Removes an object. Missing objects are not an error (idempotent purge). */
  deleteObject(bucket: string, key: string): Promise<void>;
}

/** Private bucket for standalone correction clips. Not created by this code. */
export const CORRECTION_CLIP_BUCKET = "correction-clips";

/**
 * Private bucket for full-session recordings and their approved segments (Option C).
 * NOT created yet — creating it on the dev project needs owner approval (see
 * docs/testing/dev-supabase-verification.md). No capture pipeline writes to it yet.
 */
export const RECORDING_BUCKET = "recordings";

/** Engineering default; not a business rule. */
export const SIGNED_DOWNLOAD_TTL_SECONDS = 300;

/** A69: correction clips are AAC audio in an M4A container. Stored MIME type of a finalized clip. */
export const CORRECTION_CLIP_MIME_TYPE = "audio/mp4";
/** MIME types a client may declare for an M4A upload (the server still inspects the bytes). */
export const ACCEPTED_CLIP_UPLOAD_TYPES = ["audio/mp4", "audio/x-m4a", "audio/m4a"] as const;
/** A69: maximum correction clip duration. */
export const MAX_CORRECTION_CLIP_MS = 60_000;

/**
 * Non-guessable key for a new object. Deliberately contains no tenant, student, teacher or
 * correction identifiers: those relationships live in the database and are never derived
 * from the path.
 */
function newObjectKey(prefix: string): string {
  return `${prefix}/${randomUUID()}/${randomBytes(16).toString("base64url")}`;
}

export function newCorrectionClipObjectKey(): string {
  return newObjectKey("clips");
}

export function newRecordingObjectKey(): string {
  return newObjectKey("recordings");
}

export function newRecordingSegmentObjectKey(): string {
  return newObjectKey("segments");
}
