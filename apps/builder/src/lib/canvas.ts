import { isVariableReference, type ParameterValue } from "tachisto-compiler";
import { asText } from "./text.ts";

export type CanvasObject = Record<string, unknown>;

export interface Stage {
  width: number;
  height: number;
  background: string;
  /** Whether the step fixes the canvas size; otherwise it fills the participant's window. */
  sized: boolean;
}

export interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export interface Placement {
  object: CanvasObject;
  /** The centre lines the object snapped to, for drawing as guides. */
  snapped: { vertical: boolean; horizontal: boolean };
}

export const SNAP_DISTANCE = 8;
// The plugin's own spacing between lines of text, which it does not scale with the font.
export const TEXT_LINE_SPACING = 20;
const STAND_IN_SIZE = 40;

export const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positive = (value: unknown, fallback: number) => {
  const number = numberOr(value, fallback);
  return number > 0 ? number : fallback;
};

export const fromColumn = (value: unknown): value is { var: string } =>
  isVariableReference(value as ParameterValue);

export function stageFor(params: Record<string, unknown> | undefined): Stage {
  const width = params?.canvas_width;
  const height = params?.canvas_height;
  const sized = typeof width === "number" && width > 0 && typeof height === "number" && height > 0;
  const background = params?.background_color;
  return {
    width: sized ? width : 800,
    height: sized ? height : 600,
    background: typeof background === "string" && background ? background : "grey",
    sized,
  };
}

function origin(object: CanvasObject, stage: Stage): Point {
  return object.origin_center === false
    ? { x: 0, y: 0 }
    : { x: stage.width / 2, y: stage.height / 2 };
}

/** Which coordinates come from a conditions column, and so cannot be set by dragging. */
export function lockedAxes(object: CanvasObject) {
  return { x: fromColumn(object.startX), y: fromColumn(object.startY) };
}

export function pinned(object: CanvasObject) {
  const locked = lockedAxes(object);
  return locked.x && locked.y;
}

/** Where the plugin draws an object's centre, in canvas pixels from the top left. */
export function toStage(object: CanvasObject, stage: Stage): Point {
  const offset = origin(object, stage);
  return { x: numberOr(object.startX, 0) + offset.x, y: numberOr(object.startY, 0) + offset.y };
}

export function fromStage(point: Point, object: CanvasObject, stage: Stage): Point {
  const offset = origin(object, stage);
  return { x: Math.round(point.x - offset.x), y: Math.round(point.y - offset.y) };
}

/** Moves an object's centre to a point on the canvas, snapping onto the centre lines nearby. */
export function placeAt(
  object: CanvasObject,
  point: Point,
  stage: Stage,
  { snap }: { snap: boolean },
): Placement {
  const locked = lockedAxes(object);
  const centre = { x: stage.width / 2, y: stage.height / 2 };
  const vertical = snap && !locked.x && Math.abs(point.x - centre.x) <= SNAP_DISTANCE;
  const horizontal = snap && !locked.y && Math.abs(point.y - centre.y) <= SNAP_DISTANCE;
  const target = fromStage(
    { x: vertical ? centre.x : point.x, y: horizontal ? centre.y : point.y },
    object,
    stage,
  );
  const placed = { ...object };
  if (!locked.x) placed.startX = target.x;
  if (!locked.y) placed.startY = target.y;
  return { object: placed, snapped: { vertical, horizontal } };
}

export function samePlacement(a: Placement | null, b: Placement) {
  return (
    a !== null &&
    a.object.startX === b.object.startX &&
    a.object.startY === b.object.startY &&
    a.snapped.vertical === b.snapped.vertical &&
    a.snapped.horizontal === b.snapped.horizontal
  );
}

export function nudge(object: CanvasObject, dx: number, dy: number): CanvasObject {
  const locked = lockedAxes(object);
  const nudged = { ...object };
  if (!locked.x && dx !== 0) nudged.startX = Math.round(numberOr(object.startX, 0) + dx);
  if (!locked.y && dy !== 0) nudged.startY = Math.round(numberOr(object.startY, 0) + dy);
  return nudged;
}

/** The size an image is drawn at, following the plugin's rules for scale, width and height. */
export function imageSize(object: CanvasObject, natural: Size): Size {
  let scale = 1;
  if (typeof object.scale === "number") scale = object.scale;
  if (typeof object.image_width === "number") scale = object.image_width / natural.width;
  if (typeof object.image_height === "number") scale = object.image_height / natural.height;
  return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * The measurements an object is drawn with. Sizes that come from a column, or are not set yet,
 * get a stand-in so the object can still be seen and picked up.
 */
export function geometry(object: CanvasObject) {
  const lines = typeof object.content === "string" ? object.content.split("\n") : [""];
  const fontSize = Number.parseFloat(asText(object.fontSize ?? "20px"));
  return {
    lineWidth: positive(object.line_width, 1),
    radius: positive(object.radius, STAND_IN_SIZE / 2),
    width: positive(object.width, STAND_IN_SIZE),
    height: positive(object.height, STAND_IN_SIZE),
    length: positive(object.line_length, STAND_IN_SIZE),
    theta: (numberOr(object.angle, 0) * Math.PI) / 180,
    lines,
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 20,
  };
}

/** The area an object covers around its centre, for picking it up and outlining it. */
export function extent(
  object: CanvasObject,
  shape: ReturnType<typeof geometry>,
  natural?: Size,
): Size {
  const { lineWidth } = shape;
  switch (object.obj_type) {
    case "circle":
      return { width: shape.radius * 2 + lineWidth, height: shape.radius * 2 + lineWidth };
    case "rect":
      return { width: shape.width + lineWidth, height: shape.height + lineWidth };
    case "cross":
      return { width: shape.length + lineWidth, height: shape.length + lineWidth };
    case "line":
      return {
        width: Math.abs(shape.length * Math.cos(shape.theta)) + lineWidth,
        height: Math.abs(shape.length * Math.sin(shape.theta)) + lineWidth,
      };
    case "text": {
      const longest = Math.max(1, ...shape.lines.map((line) => line.length));
      return {
        width: longest * shape.fontSize * 0.6,
        height: shape.fontSize + TEXT_LINE_SPACING * (shape.lines.length - 1),
      };
    }
    case "image":
      return natural ? imageSize(object, natural) : { width: STAND_IN_SIZE, height: STAND_IN_SIZE };
    default:
      return { width: STAND_IN_SIZE, height: STAND_IN_SIZE };
  }
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Asks for each image address once and reports its natural size when it has loaded. The record of
 * what was asked for is a plain lookup, not state: reading it must not make anything re-run.
 */
export function imageSizeLoader(
  onSize: (url: string, size: ImageSize) => void,
  createImage: () => HTMLImageElement = () => new Image(),
) {
  const requested = new Set<string>();
  return (url: string) => {
    if (requested.has(url)) return;
    requested.add(url);
    const image = createImage();
    image.onload = () => onSize(url, { width: image.naturalWidth, height: image.naturalHeight });
    image.src = url;
  };
}
