import type { ParameterSchema } from "tachisto-schemas";

/** What each place of a grid holds: a square that is there (1) or not (0), a number, or a key. */
export type GridPlace = "square" | "integer" | "number" | "key";

export interface GridShape {
  place: GridPlace;
  /** How many places every row holds, where the plugin reads a fixed number, as a point's two. */
  width?: number;
}

export function gridShape(parameter: ParameterSchema): GridShape {
  const row = parameter.items;
  const cell = row?.items ?? parameter;
  const place: GridPlace =
    cell.jspsychType === "BOOL"
      ? "square"
      : cell.type === "integer" || cell.type === "number"
        ? cell.type
        : "key";
  const fixed = row?.minItems !== undefined && row.minItems === row.maxItems;
  return fixed ? { place, width: row.minItems } : { place };
}
