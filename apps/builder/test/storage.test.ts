// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readStored, writeStored } from "../src/lib/storage.ts";

describe("remembered settings", () => {
  beforeEach(() => localStorage.clear());

  it("reads back what was written", () => {
    writeStored("theme", "dark");
    expect(readStored("theme")).toBe("dark");
    expect(localStorage.getItem("tachisto:theme")).toBe("dark");
  });

  it("has nothing for a setting never saved", () => {
    expect(readStored("theme")).toBeNull();
  });

  it("overwrites a setting saved earlier", () => {
    writeStored("theme", "light");
    writeStored("theme", "dark");
    expect(readStored("theme")).toBe("dark");
  });
});
