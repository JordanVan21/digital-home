import type { AssetSpec } from "@house/contracts";
import { buildCandidate, checkPlan } from "./candidate";
import { PLAN_INSTRUCTIONS, REVIEW_INSTRUCTIONS } from "./prompts";
import { ReviewSchema, ViewsSchema, type RoomView } from "./schema";
import type {
  DesignCandidate,
  ModelRequest,
  PlannerInput,
  PlannerModel,
  RenderPort,
} from "./ports";

export type LoopState = {
  candidate: DesignCandidate;
  done: boolean;
  repairs: number;
  history: { candidateId: string; score: number; findings: string[] }[];
  messages: string[];
};
type Dependencies = {
  model: PlannerModel;
  render: RenderPort;
  assets: AssetSpec[];
  uuid: () => string;
  maxRepairs?: number;
  timeLimitMs?: number;
};

/** Server-owned session. The only feedback entry is candidate-bound, three-view evidence. */
export class PlannerSession {
  private input: PlannerInput;
  private current?: DesignCandidate;
  private best?: DesignCandidate;
  private bestScore = -1;
  private repairs = 0;
  private done = false;
  private busy = false;
  private deadline: number;
  private history: LoopState["history"] = [];
  private messages = ["Planning a separate copy of your room."];
  constructor(
    input: PlannerInput,
    private deps: Dependencies,
  ) {
    // Do not carry transport-only fields (especially the entire asset library) into model prompts.
    this.input = structuredClone({
      scene: input.scene,
      shell: input.shell,
      brief: input.brief,
    });
    this.deadline = Date.now() + (deps.timeLimitMs ?? 240_000);
  }
  private signal() {
    return AbortSignal.timeout(Math.max(1, this.deadline - Date.now()));
  }
  private affordances() {
    return this.deps.assets.map((a) => ({
      category: a.category,
      dimensionsM: a.dimensionsM,
      styles: a.styles,
      materials: a.materials,
    }));
  }
  private state(): LoopState {
    if (!this.current) throw new Error("No candidate exists yet.");
    return structuredClone({
      candidate: this.current,
      done: this.done,
      repairs: this.repairs,
      history: this.history,
      messages: this.messages,
    });
  }
  private async json<T>(
    request: ModelRequest,
    parse: (raw: unknown) => T | Promise<T>,
  ): Promise<T> {
    let error = "";
    let previousOutput: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.deps.model.complete(
        {
          ...request,
          data: attempt
            ? {
                originalInput: request.data,
                previousOutput,
                validationErrors: error,
              }
            : request.data,
          instructions:
            request.instructions +
            (attempt
              ? `\nPrevious output was invalid: ${error}. Correct the previousOutput in data, preserving its valid parts. Return corrected JSON.`
              : ""),
        },
        this.signal(),
      );
      try {
        return await parse(
          typeof result === "string" ? JSON.parse(result) : result,
        );
      } catch (e) {
        previousOutput = result;
        error = e instanceof Error ? e.message : "Schema mismatch";
      }
    }
    throw new Error(
      "AI could not return a valid design after one retry. Try again or change the brief.",
    );
  }
  async start(): Promise<LoopState> {
    if (this.current || this.busy) throw new Error("Session already started.");
    this.busy = true;
    try {
      const candidate = await this.json(
        {
          task: "plan",
          instructions: PLAN_INSTRUCTIONS,
          data: { ...this.input, catalogAffordances: this.affordances() },
          views: [],
        },
        (raw) =>
          buildCandidate(
            raw,
            this.input,
            this.deps.render,
            this.deps.assets,
            this.signal(),
            this.deps.uuid,
          ),
      );
      this.current = candidate;
      this.best = this.current;
      this.messages.push(
        "Placed furniture and checked shared geometry rules. Ready for three-view visual review.",
      );
      return this.state();
    } finally {
      this.busy = false;
    }
  }
  async observe(candidateId: string, rawViews: unknown): Promise<LoopState> {
    if (this.busy) throw new Error("A review is already running.");
    if (!this.current || candidateId !== this.current.id)
      throw new Error("Screenshots belong to a different candidate.");
    if (this.done) return this.state();
    const views = ViewsSchema.parse(rawViews);
    const unavailable = new Set(views.flatMap((v) => v.unavailableObjectIds));
    if (
      [...unavailable].some(
        (id) => !this.current!.scene.objects.some((o) => o.id === id),
      )
    )
      throw new Error("Unknown object in capture report.");
    this.busy = true;
    try {
      if (Date.now() >= this.deadline)
        return this.finish(
          "Time limit reached; keeping the best valid candidate.",
        );
      const current = this.current;
      const review = await this.json(
        {
          task: "review",
          instructions: REVIEW_INSTRUCTIONS,
          data: {
            brief: this.input.brief,
            shell: this.input.shell,
            originalScene: this.input.scene,
            candidate: current,
            plannerFormat: PLAN_INSTRUCTIONS,
            appearanceUnverified: current.scene.objects
              .filter((o) => !o.assetId || unavailable.has(o.id))
              .map((o) => o.id),
          },
          views: views as RoomView[],
        },
        (raw) => {
          const parsed = ReviewSchema.parse(raw);
          for (const finding of parsed.findings)
            if (!current.plan.items.some((i) => i.key === finding.objectKey))
              throw new Error("Review references an unknown piece.");
          if (parsed.verdict === "repair") {
            if (!parsed.revisedPlan)
              throw new Error("Repair verdict needs a complete revised plan.");
            parsed.revisedPlan = checkPlan(parsed.revisedPlan, this.input);
          }
          return parsed;
        },
      );
      current.review = review;
      const score =
        review.scores.style +
        review.scores.composition +
        review.scores.usability;
      this.history.push({
        candidateId: current.id,
        score,
        findings: review.findings.map((f) => f.issue),
      });
      if (score > this.bestScore) {
        this.bestScore = score;
        this.best = current;
      }
      if (review.verdict === "ready")
        return this.finish(
          "Visual review completed. Review this proposal yourself before accepting any design.",
        );
      if (this.repairs >= Math.min(2, this.deps.maxRepairs ?? 2))
        return this.finish(
          "Repair limit reached; keeping the highest-rated valid candidate. Visual scores are subjective.",
        );
      this.repairs++;
      this.messages.push(
        `Repair ${this.repairs}: ${review.findings.map((f) => f.repair).join("; ") || "Refining the composition."}`,
      );
      try {
        this.current = await buildCandidate(
          review.revisedPlan!,
          this.input,
          this.deps.render,
          this.deps.assets,
          this.signal(),
          this.deps.uuid,
        );
      } catch {
        return this.finish(
          "The suggested repair failed placement or instruction checks; keeping the best valid candidate.",
        );
      }
      return this.state();
    } catch {
      return this.finish(
        "Visual review could not finish; keeping the best valid candidate. Appearance is not fully verified.",
      );
    } finally {
      this.busy = false;
    }
  }
  private finish(message: string) {
    this.current = this.best ?? this.current;
    this.done = true;
    this.messages.push(message);
    return this.state();
  }
}
