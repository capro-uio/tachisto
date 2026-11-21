import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

interface Workspace {
  name: string;
  directory: string;
  private: boolean;
}

/** Every workspace this repository has. Derived, so a new one is covered without being listed. */
export function allWorkspaces(): Workspace[] {
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
      return [{ name: pkg.name, directory, private: pkg.private === true }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every workspace npm would publish. */
export function publishedWorkspaces(): string[] {
  return allWorkspaces()
    .filter((workspace) => !workspace.private)
    .map((workspace) => workspace.name);
}

/**
 * Where each workspace is, asked of the workspace rather than guessed from its name. An unscoped
 * name says nothing about its directory — `tachisto` lives in `packages/cli` — so a test that
 * rebuilt the path from the name would break on any package that is not named after its folder.
 */
export function workspaceDirectories(): Map<string, string> {
  return new Map(allWorkspaces().map((workspace) => [workspace.name, workspace.directory]));
}
