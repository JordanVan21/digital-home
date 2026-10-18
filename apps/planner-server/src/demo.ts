import { catalog, type AssetSpec } from "@house/contracts";
import { fitModelToEnvelope } from "@house/aesthetic-planner";
import type {
  PlannerInput,
  PlannerModel,
  RenderPort,
  SemanticDesignPlan,
} from "@house/aesthetic-planner";

/** Explicit scripted fallback exercises transport/rendering; it is not evidence of AI design quality. */
export function demoModel(
  input: PlannerInput,
  library: AssetSpec[] = catalog,
): PlannerModel {
  const picked = new Set(
    input.scene.objects
      .filter(
        (o) =>
          !o.locked &&
          !o.renovationDecision &&
          !input.brief.mustKeepObjectIds.includes(o.id) &&
          ["sofa", "armchair", "coffee-table"].includes(o.category) &&
          library.some(
            (a) =>
              a.id !== o.assetId &&
              a.category === o.category &&
              a.mount !== "wall" &&
              a.mount !== "ceiling" &&
              fitModelToEnvelope(a, o.dimensionsM),
          ),
      )
      .slice(0, 2)
      .map((o) => o.id),
  );
  const initial: SemanticDesignPlan = {
    schemaVersion: 1,
    roomId: input.scene.roomId,
    rationale:
      "Catalog demo: try two real furniture alternatives and a textured rug. The arrangement and review are scripted, so this demonstrates model loading rather than AI design quality.",
    items: input.scene.objects.map((o, i) => ({
      key: `existing-${i}`,
      action: o.locked
        ? "keep"
        : o.renovationDecision === "remove"
          ? "remove"
          : o.renovationDecision === "replace" || picked.has(o.id)
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
        zone: "original",
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
export function createDemoRender(
  library: AssetSpec[] = catalog,
  existingIds: Set<string> = new Set(),
): RenderPort {
  return {
    async resolve(request) {
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      const wanted = new Set(
        normalize(
          [...request.styles, ...request.colors, ...request.materials].join(
            " ",
          ),
        ).split(" "),
      );
      const candidates = library.filter(
        (a) =>
          a.category === request.category &&
          a.licenseStatus === "verified" &&
          a.mount !== "wall" &&
          a.mount !== "ceiling" &&
          fitModelToEnvelope(a, request.targetDimensionsM),
      );
      const score = (a: AssetSpec) =>
        normalize([...a.styles, ...a.colors, ...a.materials].join(" "))
          .split(" ")
          .filter((t) => wanted.has(t)).length;
      candidates.sort(
        (a, b) =>
          Number(existingIds.has(a.id)) - Number(existingIds.has(b.id)) ||
          score(b) - score(a) ||
          a.id.localeCompare(b.id),
      );
      const asset = candidates[0];
      return {
        asset: asset ?? null,
        source: asset ? "retrieved" : "placeholder",
        ...(asset ? {} : { placeholderReason: "no_match" as const }),
        notes: [
          "Catalog demo: real library model selected by a scripted example. No AI or render-worker call was made.",
        ],
      };
    },
  };
}
export const demoRender = createDemoRender();
