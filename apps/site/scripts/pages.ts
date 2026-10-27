import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PagesSources = {
  site: string;
  builder: string;
  specSchema: string;
  /** What an agent reads first: where the schema is, and what builds a study from a spec. */
  llms: string;
};

/**
 * Lays out what GitHub Pages serves: the website at the root, the builder under app/, and the
 * spec schema and llms.txt at the root, where specs' `$schema` and a crawler both point.
 */
export function assemblePages(sources: PagesSources, out: string) {
  for (const [name, path] of Object.entries(sources)) {
    if (!existsSync(path)) throw new Error(`${name} not found at ${path}; build it first`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(sources.site, out, { recursive: true });
  cpSync(sources.builder, join(out, "app"), { recursive: true });
  cpSync(sources.specSchema, join(out, "spec-schema.json"));
  cpSync(sources.llms, join(out, "llms.txt"));
}

/** Where this repository keeps each build, and where the pages go. */
export function repositoryLayout(root: string) {
  return {
    sources: {
      site: join(root, "apps/site/dist"),
      builder: join(root, "apps/builder/dist"),
      specSchema: join(root, "packages/compiler/spec-schema.json"),
      llms: join(root, "apps/site/llms.txt"),
    },
    out: join(root, "dist-pages"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { sources, out } = repositoryLayout(resolve(import.meta.dirname, "../../.."));
  assemblePages(sources, out);
  console.log(`pages -> ${out}`);
}
