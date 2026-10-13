import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getStorageEnv } from "@/env";
import type { ObjectStorage } from "./object-storage";

/**
 * Supabase Storage implementation of ObjectStorage. Server-only: it uses the Supabase
 * secret key to mint short-lived signed URLs AFTER the application has authorized the
 * request. Not yet exercised against a real project (no project is connected) — verify
 * against a development project before use.
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
  };
}
