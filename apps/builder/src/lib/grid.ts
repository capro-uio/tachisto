import { gridShape } from "tachisto-compiler";
import type { ParameterSchema } from "tachisto-schemas";

export type Grid = unknown[][];

/** What a new place in a grid holds: a square, nought, or a key to be filled in. */
export function blankCell(grid: ParameterSchema) {
  return { square: 1, integer: 0, number: 0, key: "" }[gridShape(grid).place];
}

function width(grid: Grid) {
  return Math.max(1, ...grid.map((row) => row.length));
}

/** A grid of one row, for a grid with nothing in it yet. */
export function firstRow(parameter: ParameterSchema): Grid {
  return [Array.from({ length: gridShape(parameter).width ?? 1 }, () => blankCell(parameter))];
}

export function addRow(grid: Grid, parameter: ParameterSchema): Grid {
  if (grid.length === 0) return firstRow(parameter);
  return [...grid, Array.from({ length: width(grid) }, () => blankCell(parameter))];
}

export function addColumn(grid: Grid, parameter: ParameterSchema): Grid {
  if (grid.length === 0) return firstRow(parameter);
  return grid.map((row) => [...row, blankCell(parameter)]);
}

// A grid keeps one row and one column, since a plugin given none draws nothing to respond to.
export function removeRow(grid: Grid): Grid {
  return grid.length > 1 ? grid.slice(0, -1) : grid;
}

export function removeColumn(grid: Grid): Grid {
  return grid.every((row) => row.length > 1) ? grid.map((row) => row.slice(0, -1)) : grid;
}

export function setCell(grid: Grid, row: number, column: number, value: unknown): Grid {
  return grid.map((cells, index) =>
    index === row
      ? cells.map((existing, position) => (position === column ? value : existing))
      : cells,
  );
}
