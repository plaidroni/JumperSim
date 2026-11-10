import { defineConfig } from "vitest/config";

// Unit tests run the physics in Node (no browser, no map): `npm test`
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    silent: "passed-only", // show sim logs only for failing tests
  },
});
