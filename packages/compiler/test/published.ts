import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** Every workspace npm would publish. Derived, so a new one is covered without being listed. */
export function publishedWorkspaces(): string[] {
  const { workspaces } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  return workspaces
    .flatMap((pattern) => {
      const parent = pattern.replace("/*", "");
      return readdirSync(join(root, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(parent, entry.name));
    })
    .flatMap((directory) => {
      const manifest = join(root, directory, "package.json");
      if (!existsSync(manifest)) return [];
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name: string; private?: boolean };
      return pkg.private === true ? [] : [pkg.name];
    })
    .sort();
}
