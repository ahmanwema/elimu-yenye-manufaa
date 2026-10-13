import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Same single git-ignored secrets file as the app and Prisma.
config({ path: [".env.local", ".env"], quiet: true });

// Verification against the REAL development Supabase project (A65). Never part of the
// default `npm test`. Run with: npm run test:dev-supabase   (needs .env.local)
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/real/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
