import type {
  AssetSpec,
  RoomShell,
  SceneOp,
  SceneSpec,
} from "@house/contracts";
import type {
  DesignBrief,
  DesignReview,
  PriceRecord,
  RoomView,
  SemanticDesignPlan,
} from "./schema";

export type PlannerInput = {
  scene: SceneSpec;
  shell: RoomShell;
  brief: DesignBrief;
};
export type ModelRequest = {
  task: "plan" | "review";
  instructions: string;
  data: unknown;
  views: RoomView[];
};
export interface PlannerModel {
  complete(request: ModelRequest, signal: AbortSignal): Promise<unknown>;
}

/** Matches the scanner worker's request shape; this port does not select or build models itself. */
export type ModelRequestSpec = {
  schemaVersion: 1;
  category: string;
  description: string;
  styles: string[];
  colors: string[];
  materials: string[];
  targetDimensionsM: [number, number, number];
  allowGeneration: boolean;
};
export type ModelResolution = {
  asset: AssetSpec | null;
  source:
    | "retrieved"
    | "reused"
    | "modified"
    | "generated"
    | "best_effort"
    | "placeholder";
  notes: string[];
};
export interface RenderPort {
  resolve(
    request: ModelRequestSpec,
    signal: AbortSignal,
  ): Promise<ModelResolution>;
}
export type ProposalItem = {
  placement?: "applied" | "dropped";
  key: string;
  objectId?: string;
  replacesObjectId?: string;
  action: "keep" | "remove" | "move" | "replace" | "add";
  name: string;
  method: "existing" | "retrieved" | "edited" | "generated" | "placeholder";
  notes: string[];
  price: PriceRecord;
};
export type DesignCandidate = {
  id: string;
  plan: SemanticDesignPlan;
  scene: SceneSpec;
  operations: SceneOp[];
  assets: AssetSpec[];
  items: ProposalItem[];
  warnings: string[];
  review?: DesignReview;
};
