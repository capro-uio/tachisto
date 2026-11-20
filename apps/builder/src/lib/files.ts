import { assetsOfType } from "tachisto-compiler";
import type { Asset, Spec } from "tachisto-compiler";

export function download(filename: string, contents: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export function specFilename(spec: Spec) {
  return spec.name.trim() || "experiment";
}

/**
 * The added files a media field offers: those its parameter can show or play, and any file it
 * already names, so a choice made before files were sorted by type stays visible.
 */
export function fileChoices(assets: Asset[], jspsychType: string, current: unknown) {
  const names = assetsOfType(assets, jspsychType).map((asset) => asset.name);
  const keepsCurrent =
    typeof current === "string" &&
    !names.includes(current) &&
    assets.some((asset) => asset.name === current);
  return keepsCurrent ? [...names, current] : names;
}
