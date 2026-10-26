import bundled from "../plugin-schemas.json" with { type: "json" };
import type { SchemaBundle } from "./types.ts";

/**
 * The schemas as they were extracted when this package was built, read from the file shipped
 * beside the source. Everything that only consumes schemas — the compiler, its CLI, the builder —
 * reads them this way: `extractBundle` imports every jsPsych plugin package to read its
 * parameters, so an installed copy of this package could not run it, and would not want those
 * dependencies.
 *
 * Every call hands back the same object. Nothing in this repository writes to a bundle, and a
 * caller that needs to should copy it first.
 */
export function loadBundle(): SchemaBundle {
  return bundled as unknown as SchemaBundle;
}
