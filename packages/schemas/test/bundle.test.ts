import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/bundle.ts";

describe("the schemas shipped with the package", () => {
  it("reads without any jsPsych plugin installed", () => {
    const bundle = loadBundle();
    expect(bundle.jspsych).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(bundle.plugins).length).toBeGreaterThan(40);
  });

  it("describes a plugin fully enough to build a form from it", () => {
    const { plugins } = loadBundle();
    const plugin = plugins["html-keyboard-response"];
    expect(plugin.properties.stimulus.jspsychType).toBe("HTML_STRING");
    expect(plugin.required).toContain("stimulus");
  });

  it("names a file and its hash for every package a page can load", () => {
    const { packages } = loadBundle();
    for (const [name, files] of Object.entries(packages)) {
      expect(Object.keys(files.files).length, name).toBeGreaterThan(0);
      for (const integrity of Object.values(files.files)) {
        expect(integrity, name).toMatch(/^sha384-/);
      }
    }
  });
});
