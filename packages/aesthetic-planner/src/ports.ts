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
export type PlannerReadiness = {
  liveReady: boolean;
  aiConfigured: boolean;
  renderStatus:
    | "ready"
    | "queue_missing"
    | "sign_in_required"
    | "not_configured"
    | "unavailable";
  catalogCount: number;
  catalogSource: "shared" | "bundled";
  message: string;
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
  placeholderReason?: ModelIssue;
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
export type ModelIssue =
  | "no_match"
  | "queue_missing"
  | "request_failed"
  | "worker_pending"
  | "worker_timeout"
  | "worker_failed"
  | "invalid_model"
  | "size_mismatch"
  | "unverified_license"
  | "unsupported_mount";
export class ModelSourcingError extends Error {
  constructor(
    public reason: ModelIssue,
    message: string,
  ) {
    super(message);
    this.name = "ModelSourcingError";
  }
}
export interface RenderPort {
  resolve(
    request: ModelRequestSpec,
    signal: AbortSignal,
  ): Promise<ModelResolution>;
}
export type ProposalItem = {
  placeholderReason?: ModelIssue;
  matchQuality?: "closest_available";
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
