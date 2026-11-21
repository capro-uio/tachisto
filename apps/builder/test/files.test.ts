import { describe, expect, it } from "vitest";
import type { Asset } from "tachisto-compiler";
import { fileChoices } from "../src/lib/files.ts";

const file = (name: string, type: string): Asset => ({
  name,
  url: `data:${type};base64,AAAA`,
});

const assets = [
  file("face.png", "image/png"),
  file("tone.wav", "audio/wav"),
  file("voice.webm", "audio/webm"),
  file("clip.webm", "video/webm"),
  file("words.txt", "text/plain"),
];

describe("fileChoices", () => {
  it("offers a field only the files its parameter can show or play", () => {
    expect(fileChoices(assets, "IMAGE", undefined)).toEqual(["face.png"]);
    expect(fileChoices(assets, "AUDIO", undefined)).toEqual(["tone.wav", "voice.webm"]);
    expect(fileChoices(assets, "VIDEO", "")).toEqual(["clip.webm"]);
  });

  it("keeps showing a file the field already names, whatever its type", () => {
    expect(fileChoices(assets, "AUDIO", "face.png")).toEqual([
      "tone.wav",
      "voice.webm",
      "face.png",
    ]);
  });

  it("does not offer a name that is not an added file", () => {
    expect(fileChoices(assets, "AUDIO", "https://example.org/tone.mp3")).toEqual([
      "tone.wav",
      "voice.webm",
    ]);
  });

  it("offers nothing for a parameter that is not media", () => {
    expect(fileChoices(assets, "HTML_STRING", undefined)).toEqual([]);
  });
});
