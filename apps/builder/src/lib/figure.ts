import tokens from "tachisto-brand/tokens.json" with { type: "json" };
import { escapeHtmlText } from "tachisto-compiler";

const LIGHT_INKS = new Map(tokens.color.tokens.map((token) => [token.name, token.value.light]));

/** A brand colour in its light ink, which figures for print always use. */
export function ink(name: string) {
  const colour = LIGHT_INKS.get(name);
  if (!colour) throw new Error(`no brand colour named ${name}`);
  return colour;
}

const FONT = "'Atkinson Hyperlegible', Arial, Helvetica, sans-serif";

/** Roughly how wide a character of 12px text is, for laying text out before it is drawn. */
export const CHAR_WIDTH = 6.6;

export const textWidth = (text: string) => text.length * CHAR_WIDTH;

// XML forbids control characters other than tab and line breaks, and a strict reader such as
// Inkscape refuses the whole file over one, so they are dropped along with escaping markup.
// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Text as it can sit in a figure's markup, whatever the author typed. */
export const svgText = (text: string) => escapeHtmlText(text.replace(XML_FORBIDDEN, ""));

export const ARROW_ID = "arrow";

export interface FigureFrame {
  width: number;
  height: number;
  title: string;
  body: string[];
  /** How wide it prints, when it is made for a page rather than a screen. */
  widthMm?: number;
}

export const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A figure as a standalone SVG for a paper or a poster: every colour and font is written on the
 * element it paints, so it opens the same in a browser, Inkscape, Illustrator or a journal's
 * system, and stays in the light inks whatever theme the builder is in.
 */
export function figureSvg({ width, height, title, body, widthMm }: FigureFrame) {
  const size = widthMm
    ? `width="${round(widthMm)}mm" height="${round((height * widthMm) / width)}mm"`
    : `width="${width}" height="${height}"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${size} viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="12" role="img">`,
    `<title>${svgText(title)}</title>`,
    `<defs><marker id="${ARROW_ID}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${ink("ink-muted")}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ...body,
    `</svg>`,
  ].join("\n");
}
