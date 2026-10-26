import bundled from "../plugin-schemas.json" with { type: "json" };
import type { SchemaBundle } from "./types.ts";

/**
 * The schemas as they were extracted when this package was built, read from the file shipped
 * beside the source. Everything that only consumes schemas — the compiler, its CLI, the builder —
 * reads them this way: `extractBundle` needs every jsPsych plugin package installed to import, so
 * an installed copy of this package could not run it, and would not want its 49 dependencies.
 */
export function loadBundle(): SchemaBundle {
  return bundled as unknown as SchemaBundle;
}
