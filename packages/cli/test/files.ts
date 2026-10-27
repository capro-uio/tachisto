import type { Files } from "../src/commands.ts";

/** Files that live only in a test, so a command can be run without touching a disk. */
export function fakeFiles(contents: Record<string, string>) {
  const written = new Map<string, string>();
  const files: Files = {
    read: (path) => {
      const text = contents[path];
      if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return text;
    },
    write: (path, text) => void written.set(path, text),
  };
  return { files, written };
}
