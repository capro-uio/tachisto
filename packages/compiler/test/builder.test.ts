import { describe, expect, it } from "vitest";
import { builderLink, BUILDER_URL, SPEC_PARAMETER } from "../src/builder.ts";

describe("a link that hands the builder a spec", () => {
  it("names the spec by its address, in the published builder by default", () => {
    expect(builderLink("https://osf.io/x/study.json")).toBe(
      `${BUILDER_URL}?${SPEC_PARAMETER}=https%3A%2F%2Fosf.io%2Fx%2Fstudy.json`,
    );
  });

  it("can point at another copy of the builder, such as one running locally", () => {
    expect(builderLink("https://osf.io/x/study.json", "http://localhost:5180/")).toBe(
      `http://localhost:5180/?${SPEC_PARAMETER}=https%3A%2F%2Fosf.io%2Fx%2Fstudy.json`,
    );
  });

  it("keeps a query the builder's own address already carries", () => {
    expect(builderLink("https://osf.io/s.json", "https://example.org/app/?tab=timeline")).toContain(
      "tab=timeline",
    );
  });
});
