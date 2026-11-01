import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": path.resolve(__dirname, "tests/stubs/empty.ts") } },
  test: {
    // Live tests call real external APIs; run them with LIVE=1 npm test.
    include: process.env.LIVE ? ["tests/live/**/*.test.ts"] : ["tests/**/*.test.ts"],
    exclude: process.env.LIVE ? [] : ["tests/live/**", "node_modules/**"],
    testTimeout: process.env.LIVE ? 60_000 : 5_000,
  },
});
