import tokens from "tachisto-brand/tokens.json" with { type: "json" };

type Theme = "light" | "dark";

/** A brand colour as the browser reports it once computed, such as `rgb(246, 244, 238)`. */
export function brandColour(name: string, theme: Theme) {
  const token = tokens.color.tokens.find((candidate) => candidate.name === name);
  if (!token) throw new Error(`no brand colour named ${name}`);
  const hex = token.value[theme].replace("#", "");
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
