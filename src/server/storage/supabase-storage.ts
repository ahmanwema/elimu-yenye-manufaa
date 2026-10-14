import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getStorageEnv } from "@/env";
import type { ObjectStorage } from "./object-storage";

/** Lifetime of the internal URL used for one server-side ranged read. Never leaves the server. */
const INTERNAL_READ_TTL_SECONDS = 60;

/**
 * Supabase Storage implementation of ObjectStorage. Server-only: it uses the Supabase
 * secret key to mint short-lived signed URLs AFTER the application has authorized the
 * request. Verified against the development project by tests/real (signed upload, stat,
 * signed read); readRange/deleteObject are exercised there once the 2026-10-14 migrations
 * are applied to that project (owner approval required).
 */
export function createSupabaseObjectStorage(): ObjectStorage {
  const client = createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, getStorageEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async createSignedUploadUrl(bucket, key) {
      const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(key);
      if (error || !data) throw new Error("Storage: could not create upload URL");
      return { url: data.signedUrl };
    },
    async createSignedDownloadUrl(bucket, key, expiresInSeconds) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(key, expiresInSeconds);
      if (error || !data) throw new Error("Storage: could not create download URL");
      return { url: data.signedUrl };
    },
    async statObject(bucket, key) {
      const { data, error } = await client.storage.from(bucket).info(key);
      if (error || !data) return { exists: false };
      return { exists: true, byteSize: Number(data.size ?? 0) };
    },
    async readRange(bucket, key, offset, length) {
      if (length <= 0) return new Uint8Array(0);
      const { data, error } = await client.storage.from(bucket).createSignedUrl(key, INTERNAL_READ_TTL_SECONDS);
      if (error || !data) throw new Error("Storage: could not read object");
      const res = await fetch(data.signedUrl, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error("Storage: could not read object");
      const bytes = new Uint8Array(await res.arrayBuffer());
      // A server that ignores Range returns the whole object: cut out the requested window.
      return res.status === 200 ? bytes.slice(offset, offset + length) : bytes;
    },
    async deleteObject(bucket, key) {
      const { error } = await client.storage.from(bucket).remove([key]);
      if (error) throw new Error("Storage: could not delete object");
    },
  };
}
