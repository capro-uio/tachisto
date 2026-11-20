import { defineConfig } from "vitest/config";

// The end-to-end suites each launch a browser and a server, which is more than enough work to
// have in flight at once.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 180_000,
    // Closing a browser and a preview server is routinely slower than vitest's 10s default for
    // hooks, which `testTimeout` does not cover, and a teardown that times out fails the file with
    // every test in it already passed.
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "scripts/**/*.ts"],
      // Entry points: argument parsing and process exits, with their logic in release.ts.
      exclude: ["scripts/cli.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
