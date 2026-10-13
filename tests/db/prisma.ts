import type { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { loadActor } from "@/server/authz/load-actor";
import type { Actor } from "@/server/authz/policy";
import type { ObjectStorage } from "@/server/storage/object-storage";
import { createTestDatabase } from "./harness";
import { seed } from "./seed";

// Real Prisma Client over the in-process PGlite database, with the real migrations and
// the shared fixture. Prisma connects as the owner role here, so — exactly like
// production — RLS does NOT apply to these queries; the services' own authorization does.

export async function createTestPrisma(): Promise<{ pg: PGlite; db: PrismaClient }> {
  const pg = await createTestDatabase();
  await seed(pg);
  return { pg, db: new PrismaClient({ adapter: new PrismaPGlite(pg) }) };
}

/** Loads the Actor exactly as the server does (memberships, grants, links from the DB). */
export async function actor(db: PrismaClient, profileId: string): Promise<Actor> {
  const a = await loadActor(db, profileId);
  if (!a) throw new Error(`no profile ${profileId}`);
  return a;
}

/**
 * Wraps a client and records every database call (model operations and $-methods),
 * so tests can prove that a denied request never reached the database.
 */
export function spyDb(db: PrismaClient): { db: PrismaClient; calls: string[] } {
  const calls: string[] = [];
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string") return value;
      if (prop.startsWith("$") && typeof value === "function") {
        return (...args: unknown[]) => {
          calls.push(prop);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (value && typeof value === "object" && !prop.startsWith("_")) {
        return new Proxy(value as object, {
          get(delegate, op) {
            const fn = Reflect.get(delegate, op);
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              calls.push(`${prop}.${String(op)}`);
              return (fn as (...a: unknown[]) => unknown).apply(delegate, args);
            };
          },
        });
      }
      return value;
    },
  });
  return { db: proxy, calls };
}

/** In-memory ObjectStorage for tests. `put` simulates a client upload / worker copy. */
export class FakeStorage implements ObjectStorage {
  readonly objects = new Map<string, number>();
  readonly signedDownloads: string[] = [];
  put(bucket: string, key: string, byteSize: number) {
    this.objects.set(`${bucket}/${key}`, byteSize);
  }
  delete(bucket: string, key: string) {
    this.objects.delete(`${bucket}/${key}`);
  }
  async createSignedUploadUrl(bucket: string, key: string) {
    return { url: `https://storage.test/upload/${bucket}/${key}?sig=x` };
  }
  async createSignedDownloadUrl(bucket: string, key: string, expiresInSeconds: number) {
    this.signedDownloads.push(`${bucket}/${key}`);
    return { url: `https://storage.test/download/${bucket}/${key}?ttl=${expiresInSeconds}` };
  }
  async statObject(bucket: string, key: string) {
    const size = this.objects.get(`${bucket}/${key}`);
    return size === undefined ? ({ exists: false } as const) : ({ exists: true, byteSize: size } as const);
  }
}
