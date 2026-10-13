import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/env";

// Prisma connects with a database role that BYPASSES Row Level Security.
// Every Prisma query that touches tenant or personal data must go through the
// authorization layer in src/server/authz first. See docs/system/security.md §2.1.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Interactive transactions (e.g. accepting an invitation, ~7 statements) must survive real
// network latency to the database. Measured 2026-10-13 from the development machine to
// Supabase eu-central-1: ~230 ms per round trip, which exceeded Prisma's 5 s default.
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: getServerEnv().DATABASE_URL });
    globalForPrisma.prisma = new PrismaClient({ adapter, transactionOptions: TRANSACTION_OPTIONS });
  }
  return globalForPrisma.prisma;
}
