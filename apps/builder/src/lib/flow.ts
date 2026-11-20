import {
  childrenOf,
  conditionColumns,
  isVariableReference,
  orderColumn,
  slotsOf,
} from "tachisto-compiler";
import type { Retention, Slot, Spec, SpecNode } from "tachisto-compiler";
import { CHAR_WIDTH, textWidth } from "./figure.ts";
import { describeAccuracy, describeBranchRule } from "./rules.ts";
import { pluginTitle } from "./schemas.ts";

export type FlowPath = number[];

export type FlowShape = "terminal" | "step" | "marker" | "frame" | "decision" | "lane" | "empty";

export interface Point {
  x: number;
  y: number;
}

export interface FlowBox {
  key: string;
  path: FlowPath | null;
  kind: string;
  shape: FlowShape;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string[];
  details: string[];
  label: string;
}

export interface FlowEdge {
  points: Point[];
  arrow: boolean;
  repeat: boolean;
  label?: string;
  labelAt?: Point;
}

export interface FlowLayout {
  width: number;
  height: number;
  boxes: FlowBox[];
  edges: FlowEdge[];
}

interface Description {
  title: string;
  details: string[];
}

interface KindLayout<Node> {
  describe: (node: Node, spec: Spec) => Description;
  marker?: boolean;
  repeats?: boolean;
}

type NodeOfKind<Kind extends SpecNode["kind"]> = Extract<SpecNode, { kind: Kind }>;

type KindLayouts = { [Kind in SpecNode["kind"]]?: KindLayout<NodeOfKind<Kind>> };

export const STEP_WIDTH = 220;
export const LINE_HEIGHT = 16;
export const PAD_X = 12;
export const PAD_Y = 8;
export const DECISION_INSET = 14;
const GAP = 28;
const FRAME_PAD = 14;
const LOOP_GUTTER = 22;
const LOOP_TAIL = 30;
const LANE_GAP = 24;
const MARGIN = 16;
const BASELINE = 12;

export const centred = (box: FlowBox) => box.shape !== "frame";

export function textX(box: FlowBox) {
  return centred(box) ? box.x + box.width / 2 : box.x + PAD_X;
}

export function lineY(box: FlowBox, line: number) {
  return box.y + PAD_Y + BASELINE + line * LINE_HEIGHT;
}

export function decisionOutline(box: FlowBox) {
  const { x, y, width, height } = box;
  const middle = y + height / 2;
  return (
    `M ${x + DECISION_INSET} ${y} H ${x + width - DECISION_INSET} L ${x + width} ${middle} ` +
    `L ${x + width - DECISION_INSET} ${y + height} H ${x + DECISION_INSET} L ${x} ${middle} Z`
  );
}

export const edgePath = (edge: FlowEdge) =>
  edge.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

export const cornerRadius = (box: FlowBox) =>
  box.shape === "terminal" || box.shape === "lane" ? box.height / 2 : 6;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function scoreText(score: NonNullable<NodeOfKind<"trial">["score"]>) {
  const expected = score.correct_if_response_equals;
  const answer = isVariableReference(expected)
    ? `column ${expected.var}`
    : JSON.stringify(expected);
  return `correct when the response matches ${answer}`;
}

const KIND_LAYOUTS: KindLayouts = {
  trial: {
    describe: (node) => ({
      title: pluginTitle(node.plugin),
      details: [
        ...(node.tag ? [`tagged ${node.tag}`] : []),
        ...(node.score ? [scoreText(node.score)] : []),
      ],
    }),
  },
  block: {
    describe: (node, spec) => {
      const rows = spec.conditions?.[node.conditions]?.length ?? 0;
      const repetitions = node.repetitions ?? 1;
      const columns = conditionColumns(spec, node.conditions);
      return {
        title: `block · ${node.conditions || "no table"}`,
        details: [
          `${plural(rows, "row")} × ${plural(repetitions, "repetition")}`,
          node.randomize_order ? "rows in random order" : "rows in table order",
          ...(columns.length > 0 ? [`columns: ${columns.join(", ")}`] : []),
        ],
      };
    },
  },
  loop: {
    repeats: true,
    describe: (node) => ({
      title: node.id ? `loop · ${node.id}` : "loop",
      details: [`repeat while accuracy ${describeAccuracy(node.repeat_while)}`],
    }),
  },
  branch: {
    describe: (node) => ({
      title: "branch",
      details: [describeBranchRule(node.when)],
    }),
  },
  assign: {
    describe: (node) => ({
      title: `split · ${node.method}`,
      details: [
        node.method === "balanced"
          ? "the data service picks the next group"
          : "each participant gets a group at random",
        ...(node.record_as ? [`recorded as ${node.record_as}`] : []),
      ],
    }),
  },
  counterbalance: {
    describe: (node) => ({
      title: `counterbalance · ${node.method === "latin_square" ? "Latin square" : "random"}`,
      details: [
        node.method === "latin_square"
          ? "the data service picks the next order"
          : "each participant gets an order at random",
        `recorded as ${orderColumn(node)}`,
      ],
    }),
  },
  checkpoint: {
    marker: true,
    describe: (node) => ({ title: "checkpoint", details: [`reached “${node.name}”`] }),
  },
  end: {
    marker: true,
    describe: (node, spec) => {
      const ending = spec.recruitment?.endings?.[node.ending];
      const outcome = ending?.url ? "sends the participant on" : "shows a message";
      return {
        title: "end early",
        details: [
          `ending “${node.ending}”`,
          ...(ending ? [outcome, RETENTION_TEXT[ending.keep ?? "all"]] : []),
        ],
      };
    },
  },
};

const RETENTION_TEXT: Record<Retention, string> = {
  all: "keeps all data",
  checkpoint: "keeps only where they ended",
  nothing: "keeps no data",
};

const GENERIC_LAYOUT: KindLayout<SpecNode> = {
  describe: (node) => ({ title: node.kind, details: [] }),
};

function layoutFor(node: SpecNode): KindLayout<SpecNode> {
  const layouts = KIND_LAYOUTS as Record<string, KindLayout<SpecNode> | undefined>;
  return layouts[node.kind] ?? GENERIC_LAYOUT;
}

export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= maxChars) line = `${line} ${rest}`;
    else {
      lines.push(line);
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

const charsWithin = (width: number) => Math.max(1, Math.floor((width - 2 * PAD_X) / CHAR_WIDTH));

const textHeight = (lineCount: number) => 2 * PAD_Y + lineCount * LINE_HEIGHT;

interface Fragment {
  width: number;
  height: number;
  boxes: FlowBox[];
  edges: FlowEdge[];
}

function shifted(fragment: Fragment, dx: number, dy: number): Fragment {
  const move = (point: Point) => ({ x: point.x + dx, y: point.y + dy });
  return {
    width: fragment.width,
    height: fragment.height,
    boxes: fragment.boxes.map((box) => ({ ...box, x: box.x + dx, y: box.y + dy })),
    edges: fragment.edges.map((edge) => ({
      ...edge,
      points: edge.points.map(move),
      ...(edge.labelAt ? { labelAt: move(edge.labelAt) } : {}),
    })),
  };
}

function textBox(
  fields: Omit<FlowBox, "x" | "y" | "height" | "title" | "details" | "label">,
  description: Description,
  wrapWidth = fields.width,
): FlowBox {
  const chars = charsWithin(wrapWidth);
  const title = wrapText(description.title, chars);
  const details = description.details.flatMap((detail) => wrapText(detail, chars));
  return {
    ...fields,
    x: 0,
    y: 0,
    height: textHeight(title.length + details.length),
    title,
    details,
    label: [description.title, ...description.details].join(", "),
  };
}

function single(box: FlowBox): Fragment {
  return { width: box.width, height: box.height, boxes: [box], edges: [] };
}

const flowEdge = (points: Point[], extra: Partial<FlowEdge> = {}): FlowEdge => ({
  points,
  arrow: true,
  repeat: false,
  ...extra,
});

function stack(fragments: Fragment[]): Fragment {
  const width = Math.max(...fragments.map((fragment) => fragment.width));
  const centre = width / 2;
  const boxes: FlowBox[] = [];
  const edges: FlowEdge[] = [];
  let y = 0;
  fragments.forEach((fragment, index) => {
    if (index > 0) {
      edges.push(
        flowEdge([
          { x: centre, y },
          { x: centre, y: y + GAP },
        ]),
      );
      y += GAP;
    }
    const placed = shifted(fragment, (width - fragment.width) / 2, y);
    boxes.push(...placed.boxes);
    edges.push(...placed.edges);
    y += fragment.height;
  });
  return { width, height: y, boxes, edges };
}

function emptySequence(key: string): Fragment {
  return single(
    textBox(
      { key, path: null, kind: "empty", shape: "empty", width: STEP_WIDTH * 0.6 },
      { title: "no steps", details: [] },
    ),
  );
}

function layoutSequence(nodes: SpecNode[], parentPath: FlowPath, spec: Spec): Fragment {
  if (nodes.length === 0) return emptySequence(`empty-${parentPath.join("-")}`);
  return stack(nodes.map((node, index) => layoutNode(node, [...parentPath, index], spec)));
}

const keyOf = (path: FlowPath) => `node-${path.join("-")}`;

function layoutLeaf(node: SpecNode, path: FlowPath, kind: KindLayout<SpecNode>, spec: Spec) {
  const shape = kind.marker ? "marker" : "step";
  return single(
    textBox(
      { key: keyOf(path), path, kind: node.kind, shape, width: STEP_WIDTH },
      kind.describe(node, spec),
    ),
  );
}

function layoutContainer(
  node: SpecNode,
  path: FlowPath,
  children: SpecNode[],
  kind: KindLayout<SpecNode>,
  spec: Spec,
): Fragment {
  const inner = layoutSequence(children, path, spec);
  const gutter = kind.repeats ? LOOP_GUTTER : 0;
  const width = Math.max(STEP_WIDTH, inner.width) + 2 * (FRAME_PAD + gutter);
  const frame = textBox(
    { key: keyOf(path), path, kind: node.kind, shape: "frame", width },
    kind.describe(node, spec),
    STEP_WIDTH,
  );
  const headerHeight = frame.height;
  const innerTop = headerHeight + GAP;
  const innerBottom = innerTop + inner.height;
  const centre = width / 2;
  const height = innerBottom + (kind.repeats ? LOOP_TAIL : FRAME_PAD);
  const placedInner = shifted(inner, (width - inner.width) / 2, innerTop);
  const edges: FlowEdge[] = [
    flowEdge([
      { x: centre, y: headerHeight },
      { x: centre, y: innerTop },
    ]),
    ...placedInner.edges,
  ];
  if (kind.repeats) {
    const turnX = (width - inner.width) / 2 - gutter / 2;
    const bottomY = innerBottom + LOOP_TAIL / 3;
    const topY = innerTop - GAP / 2;
    edges.push(
      flowEdge(
        [
          { x: centre, y: innerBottom },
          { x: centre, y: bottomY },
          { x: turnX, y: bottomY },
          { x: turnX, y: topY },
          { x: centre, y: topY },
        ],
        {
          repeat: true,
          label: "repeat",
          labelAt: { x: (turnX + centre) / 2, y: bottomY + LINE_HEIGHT - 2 },
        },
      ),
    );
  }
  return {
    width,
    height,
    boxes: [{ ...frame, height }, ...placedInner.boxes],
    edges,
  };
}

function layoutLane(slot: Slot, path: FlowPath, kind: string, spec: Spec): Fragment {
  const labelWidth = Math.ceil(textWidth(slot.name) + 2 * PAD_X);
  const label = textBox(
    {
      key: `lane-${path.join("-")}`,
      path,
      kind,
      shape: "lane",
      width: Math.min(STEP_WIDTH, Math.max(STEP_WIDTH * 0.4, labelWidth)),
    },
    { title: slot.name || "unnamed", details: [] },
  );
  return stack([single(label), layoutSequence(slot.children, path, spec)]);
}

function layoutSplit(
  node: SpecNode,
  path: FlowPath,
  slots: Slot[],
  kind: KindLayout<SpecNode>,
  spec: Spec,
): Fragment {
  const decision = textBox(
    { key: keyOf(path), path, kind: node.kind, shape: "decision", width: STEP_WIDTH },
    kind.describe(node, spec),
    STEP_WIDTH - 2 * DECISION_INSET,
  );
  const lanes = slots.map((slot, index) => layoutLane(slot, [...path, index], node.kind, spec));
  const lanesWidth =
    lanes.reduce((sum, lane) => sum + lane.width, 0) + LANE_GAP * Math.max(0, lanes.length - 1);
  const width = Math.max(STEP_WIDTH, lanesWidth);
  const centre = width / 2;
  const forkY = decision.height + GAP / 2;
  const lanesTop = decision.height + GAP;
  const lanesBottom = lanesTop + Math.max(0, ...lanes.map((lane) => lane.height));
  const joinY = lanesBottom + GAP / 2;
  const boxes: FlowBox[] = [{ ...decision, x: (width - STEP_WIDTH) / 2 }];
  const edges: FlowEdge[] = [];
  let laneX = (width - lanesWidth) / 2;
  for (const lane of lanes) {
    const laneCentre = laneX + lane.width / 2;
    const placed = shifted(lane, laneX, lanesTop);
    edges.push(
      flowEdge([
        { x: centre, y: decision.height },
        { x: centre, y: forkY },
        { x: laneCentre, y: forkY },
        { x: laneCentre, y: lanesTop },
      ]),
      flowEdge(
        [
          { x: laneCentre, y: lanesTop + lane.height },
          { x: laneCentre, y: joinY },
          { x: centre, y: joinY },
        ],
        { arrow: false },
      ),
      ...placed.edges,
    );
    boxes.push(...placed.boxes);
    laneX += lane.width + LANE_GAP;
  }
  return { width, height: joinY, boxes, edges };
}

function layoutNode(node: SpecNode, path: FlowPath, spec: Spec): Fragment {
  const kind = layoutFor(node);
  const slots = slotsOf(node);
  if (slots) return layoutSplit(node, path, slots, kind, spec);
  const children = childrenOf(node);
  if (children) return layoutContainer(node, path, children, kind, spec);
  return layoutLeaf(node, path, kind, spec);
}

function terminal(key: string, title: string): Fragment {
  return single(
    textBox(
      { key, path: null, kind: key, shape: "terminal", width: STEP_WIDTH * 0.5 },
      { title, details: [] },
    ),
  );
}

/** The study as a top-to-bottom diagram: every step placed, every way between them drawn. */
export function layoutFlow(spec: Spec): FlowLayout {
  const flow = shifted(
    stack([
      terminal("start", "Start"),
      layoutSequence(spec.timeline, [], spec),
      terminal("end", "End"),
    ]),
    MARGIN,
    MARGIN,
  );
  return {
    width: flow.width + 2 * MARGIN,
    height: flow.height + 2 * MARGIN,
    boxes: flow.boxes,
    edges: flow.edges,
  };
}
