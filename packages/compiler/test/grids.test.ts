import { describe, expect, it } from "vitest";
import type { ParameterSchema } from "tachisto-schemas";
import { gridShape } from "../src/grids.ts";
import { schemas } from "./schemas.ts";

describe("gridShape", () => {
  it("tells squares, whole numbers and keys apart", () => {
    const { grid, choices } = schemas.plugins["serial-reaction-time"].properties;
    expect(gridShape(grid).place).toBe("square");
    expect(gridShape(choices).place).toBe("key");
  });

  it("knows the width of a grid whose every row holds the same number of places", () => {
    const points = schemas.plugins["webgazer-calibrate"].properties.calibration_points;
    expect(gridShape(points)).toEqual({ place: "integer", width: 2 });
    const { grid } = schemas.plugins["serial-reaction-time"].properties;
    expect(gridShape(grid).width).toBeUndefined();
  });

  it("reads decimal places as numbers", () => {
    const decimals = {
      title: "grid",
      type: "array",
      jspsychType: "FLOAT",
      items: {
        title: "row",
        type: "array",
        jspsychType: "FLOAT",
        items: { title: "cell", type: "number", jspsychType: "FLOAT" },
      },
    } as ParameterSchema;
    expect(gridShape(decimals).place).toBe("number");
  });
});
