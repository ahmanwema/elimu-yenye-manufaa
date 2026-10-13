import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the React Server environment; in tests it is a no-op.
      "server-only": fileURLToPath(new URL("./tests/support/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-Supabase checks run only via `npm run test:dev-supabase` (vitest.real.config.mts).
    exclude: ["tests/real/**", "node_modules/**"],
    // PGlite boots a WASM Postgres per suite; give it room on slower machines.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
