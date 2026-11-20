import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
// vitest's defineConfig, because the `test` block is not part of vite's own config type.
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  base: "./",
  // The brand's logos are served as they are, so only the one the theme shows is fetched.
  publicDir: dirname(fileURLToPath(import.meta.resolve("tachisto-brand/logos/favicon.svg"))),
  server: { port: 5180 },
  test: {
    fileParallelism: false,
    testTimeout: 180_000,
    // Components run only inside the browser in the end-to-end suites, where V8 coverage in Node
    // cannot see them; what is measured here is the logic in plain modules.
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
