import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// vitest's defineConfig, because the `test` block is not part of vite's own config type.
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  // The brand's logos are served as they are, so the page names them as plain files: one of each
  // light and dark pair is shown, and the other is never fetched.
  publicDir: dirname(fileURLToPath(import.meta.resolve("tachisto-brand/logos/favicon.svg"))),
  server: { port: 5181 },
  test: {
    coverage: {
      provider: "v8",
      include: ["scripts/**/*.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
