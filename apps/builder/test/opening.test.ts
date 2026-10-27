import { describe, expect, it } from "vitest";
import {
  invitationFrom,
  specFromPasted,
  isInvitation,
  linkTo,
  MAXIMUM_SPEC_LENGTH,
  specFrom,
} from "../src/lib/opening.ts";

const runnable = {
  name: "beep",
  timeline: [
    { kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>hi</p>" } },
  ],
};

const answering = (body: string, init: ResponseInit = {}) =>
  (() => Promise.resolve(new Response(body, init))) as unknown as typeof fetch;

describe("the spec a link asks to open", () => {
  it("reads the address out of the query and names its host", () => {
    expect(invitationFrom("?spec=https://osf.io/x/study.json")).toEqual({
      url: "https://osf.io/x/study.json",
      host: "osf.io",
    });
  });

  it("finds nothing to open when nothing was asked for", () => {
    expect(invitationFrom("")).toBeNull();
    expect(invitationFrom("?tab=timeline")).toBeNull();
    expect(invitationFrom("?spec=")).toBeNull();
    expect(invitationFrom("?spec=%20")).toBeNull();
  });

  // A spec holds code that runs for every participant, so where it came from has to be knowable.
  it("opens nothing but https", () => {
    for (const address of [
      "http://example.org/study.json",
      "javascript:alert(1)",
      "data:application/json,{}",
      "file:///etc/passwd",
    ]) {
      const invitation = invitationFrom(`?spec=${encodeURIComponent(address)}`);
      expect(isInvitation(invitation), address).toBe(false);
      expect(invitation).toHaveProperty("problem");
    }
  });

  it("says so when the address is not an address", () => {
    expect(invitationFrom("?spec=not%20a%20url")).toEqual({
      problem: "not a url is not an address",
    });
  });

  it("builds a link that opens the same spec in this builder", () => {
    expect(
      linkTo("https://osf.io/x/study.json", {
        origin: "https://www.capro.dev",
        pathname: "/tachisto/app/",
      }),
    ).toBe("https://www.capro.dev/tachisto/app/?spec=https%3A%2F%2Fosf.io%2Fx%2Fstudy.json");
  });
});

describe("fetching a spec someone left somewhere", () => {
  it("opens a spec that is there", async () => {
    const spec = await specFrom("https://osf.io/study.json", answering(JSON.stringify(runnable)));
    expect(spec.name).toBe("beep");
  });

  it("says what went wrong in the words of what it was doing", async () => {
    await expect(
      specFrom("https://osf.io/gone.json", answering("", { status: 404 })),
    ).rejects.toThrow("answered 404");

    const refused = (() => Promise.reject(new Error("Failed to fetch"))) as unknown as typeof fetch;
    await expect(specFrom("https://osf.io/study.json", refused)).rejects.toThrow(
      "could not be reached (Failed to fetch)",
    );

    await expect(specFrom("https://osf.io/study.json", answering("{ oh no"))).rejects.toThrow();
  });

  it("refuses an answer too big to be a spec", async () => {
    const huge = answering(" ".repeat(MAXIMUM_SPEC_LENGTH + 1));
    await expect(specFrom("https://osf.io/huge.json", huge)).rejects.toThrow(
      "is larger than a spec can be",
    );
  });

  it("refuses an answer that is not a spec at all", async () => {
    await expect(specFrom("https://osf.io/list.json", answering("[1,2,3]"))).rejects.toThrow();
  });
});

describe("what someone pasted", () => {
  it("opens a spec pasted as JSON", async () => {
    const spec = await specFromPasted(`  ${JSON.stringify(runnable)}\n`);
    expect(spec.name).toBe("beep");
  });

  it("fetches a spec pasted as an https address", async () => {
    const spec = await specFromPasted(
      " https://osf.io/study.json ",
      answering(JSON.stringify(runnable)),
    );
    expect(spec.name).toBe("beep");
  });

  it("refuses an address that is not https, and says nothing is there when nothing is", async () => {
    await expect(specFromPasted("http://example.org/study.json")).rejects.toThrow(
      "only https addresses are opened",
    );
    await expect(specFromPasted("javascript:alert(1)")).rejects.toThrow(
      "only https addresses are opened",
    );
    await expect(specFromPasted("   ")).rejects.toThrow("there is nothing here to open");
  });

  it("reads a spec whose own text could be mistaken for a scheme", async () => {
    const spec = await specFromPasted(JSON.stringify({ ...runnable, name: "a:b" }));
    expect(spec.name).toBe("a:b");
  });
});
