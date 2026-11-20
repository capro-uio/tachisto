import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "src");
// The command line is the one part of the compiler that only ever runs under Node.
const NODE_ONLY = new Set(["cli.ts"]);

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(folder, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(folder, entry.name)]
        : [],
  );
}

// Type-only imports vanish when compiled, so only imports that bring values along count: named
// ones, bare ones for their side effects, and ones made while running.
const valueImports = (source: string) =>
  [
    ...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
    ...source.matchAll(/^import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);

describe("the compiler", () => {
  const files = sourceFiles(SOURCE).filter((file) => !NODE_ONLY.has(relative(SOURCE, file)));

  it.each(files.map((file) => [relative(SOURCE, file), file]))(
    "runs in a browser: %s brings in nothing that needs Node",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      // Node's own globals are not there in a browser either.
      expect(source).not.toMatch(/\b(?:process|Buffer|__dirname|require)\s*[.(]/);
      for (const specifier of valueImports(source)) {
        expect(specifier).not.toMatch(/^node:/);
        // The schemas package's main entry holds the extraction code, which reads the disk.
        expect(specifier).not.toBe("tachisto-schemas");
      }
    },
  );
});
