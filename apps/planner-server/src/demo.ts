import { catalog } from "@house/contracts";
import type {
  PlannerInput,
  PlannerModel,
  RenderPort,
  SemanticDesignPlan,
} from "@house/aesthetic-planner";

/** Explicit scripted fallback exercises transport/rendering; it is not evidence of AI design quality. */
export function demoModel(input: PlannerInput): PlannerModel {
  const initial: SemanticDesignPlan = {
    schemaVersion: 1,
    roomId: input.scene.roomId,
    rationale:
      "Demo fallback: preserve furniture and try a textured rug at the room center.",
    items: input.scene.objects.map((o, i) => ({
      key: `existing-${i}`,
      action: o.locked
        ? "keep"
        : o.renovationDecision === "remove"
          ? "remove"
          : o.renovationDecision === "replace"
            ? "replace"
            : "keep",
      objectId: o.id,
      description: o.displayName,
      desiredCategory: o.category,
      desiredStyleTags: input.brief.styleTags,
      colors: input.brief.palette,
      materials: input.brief.preferredMaterials,
      maxDimensionsM: o.dimensionsM,
      placementIntent: {
        zone:
          o.renovationDecision === "replace" && !o.locked
            ? "center"
            : "original",
      },
    })),
  };
  return {
    async complete(request) {
      if (request.task === "plan") return initial;
      const current = (
        request.data as { candidate: { plan: SemanticDesignPlan } }
      ).candidate.plan;
      const repaired = structuredClone(current);
      if (!repaired.items.some((i) => i.key === "demo-rug")) {
        repaired.items.push({
          key: "demo-rug",
          action: "add",
          desiredCategory: "rug",
          description: "Textured natural rug",
          desiredStyleTags: ["minimal"],
          colors: ["cream"],
          materials: ["wool"],
          maxDimensionsM: [2, 0.04, 1.4],
          placementIntent: { zone: "center" },
        });
        return {
          verdict: "repair",
          scores: { style: 2, composition: 3, usability: 3 },
          findings: [
            {
              objectKey: current.items[0].key,
              issue: "Scripted demonstration: try a rug to anchor the seating.",
              repair: "Add a textured rug.",
            },
          ],
          revisedPlan: repaired,
        };
      }
      return {
        verdict: "ready",
        scores: { style: 3, composition: 3, usability: 3 },
        findings: [],
      };
    },
  };
}
export const demoRender: RenderPort = {
  async resolve(request) {
    const asset = catalog.find(
      (a) =>
        a.category === request.category &&
        a.dimensionsM.every((n, i) => n <= request.targetDimensionsM[i]),
    );
    return {
      asset: asset ?? null,
      source: asset ? "retrieved" : "placeholder",
      notes: [
        "Demo fallback: scripted catalog response, not a live render-agent request.",
      ],
    };
  },
};
