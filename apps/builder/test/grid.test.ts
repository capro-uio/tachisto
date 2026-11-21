import { describe, expect, it } from "vitest";
import type { ParameterSchema } from "tachisto-schemas";
import {
  addColumn,
  addRow,
  blankCell,
  firstRow,
  removeColumn,
  removeRow,
  setCell,
} from "../src/lib/grid.ts";

const gridOf = (cell: Partial<ParameterSchema>, width?: number) =>
  ({
    title: "grid",
    type: "array",
    format: "grid",
    jspsychType: cell.jspsychType,
    items: {
      title: "row",
      type: "array",
      ...(width !== undefined && { minItems: width, maxItems: width }),
      items: { title: "cell", ...cell },
    },
  }) as ParameterSchema;

const square = gridOf({ type: "integer", jspsychType: "BOOL" });
const key = gridOf({ type: "string", jspsychType: "KEYS" });
const point = gridOf({ type: "integer", jspsychType: "INT" }, 2);

describe("grids", () => {
  it("starts a new place as a square, nought, or an empty key", () => {
    expect([blankCell(square), blankCell(point), blankCell(key)]).toEqual([1, 0, ""]);
  });

  it("adds a row as wide as the grid, and a column to every row", () => {
    expect(addRow([[1, 0, 1]], square)).toEqual([
      [1, 0, 1],
      [1, 1, 1],
    ]);
    expect(addColumn([["a"], ["b"]], key)).toEqual([
      ["a", ""],
      ["b", ""],
    ]);
  });

  it("removes the last row or column, but keeps one of each", () => {
    expect(removeRow([[1], [0]])).toEqual([[1]]);
    expect(removeRow([[1]])).toEqual([[1]]);
    expect(
      removeColumn([
        [1, 0],
        [0, 1],
      ]),
    ).toEqual([[1], [0]]);
    expect(removeColumn([[1], [0]])).toEqual([[1], [0]]);
    expect(removeColumn([[1, 1], [0]])).toEqual([[1, 1], [0]]);
  });

  it("starts an empty grid from one row, as wide as its rows must be", () => {
    expect(addColumn([], square)).toEqual([[1]]);
    expect(addRow([], key)).toEqual([[""]]);
    expect(firstRow(point)).toEqual([[0, 0]]);
  });

  it("changes one place and leaves the rest", () => {
    const grid = [
      [1, 1],
      [1, 1],
    ];
    expect(setCell(grid, 1, 0, 0)).toEqual([
      [1, 1],
      [0, 1],
    ]);
    expect(grid).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });
});
