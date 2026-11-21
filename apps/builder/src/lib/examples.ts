import flanker from "../../../../examples/flanker.json";
import stroop from "../../../../examples/stroop.json";
import shapes from "../../../../examples/shapes.json";
import type { Spec } from "tachisto-compiler";

export interface Example {
  id: string;
  title: string;
  description: string;
  spec: Spec;
}

export const examples: Example[] = [
  {
    id: "flanker",
    title: "Flanker task",
    description: "Practice block that repeats until accuracy reaches 75%.",
    spec: flanker as unknown as Spec,
  },
  {
    id: "stroop",
    title: "Stroop task",
    description: "Instructions, a checkpoint, and a randomised block scored against a key.",
    spec: stroop as unknown as Spec,
  },
  {
    id: "shapes",
    title: "Shape judgement",
    description:
      "Image stimuli: four PNGs shown from a conditions table, shape judged, colour ignored.",
    spec: shapes as unknown as Spec,
  },
];
