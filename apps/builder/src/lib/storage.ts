const PREFIX = "tachisto:";

/** A remembered setting. */
export function readStored(name: string): string | null {
  return localStorage.getItem(PREFIX + name);
}

export function writeStored(name: string, value: string) {
  localStorage.setItem(PREFIX + name, value);
}
