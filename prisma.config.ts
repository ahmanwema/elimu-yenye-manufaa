import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Local secrets live in ONE git-ignored file, .env.local (also read by Next.js).
// .env is read as a fallback if it exists. Values already in the environment win.
config({ path: [".env.local", ".env"], quiet: true });

// The Prisma CLI (migrations) needs a DIRECT (non-pooled) connection.
// The app runtime uses DATABASE_URL via the pg adapter (src/server/db.ts).
// Never point either at production from a local machine without explicit authorization.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL ?? "" },
});
