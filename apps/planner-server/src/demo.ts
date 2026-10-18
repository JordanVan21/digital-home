import { catalog, type AssetSpec } from "@house/contracts";
import { fitModelToEnvelope } from "@house/aesthetic-planner";
import type {
  PlannerInput,
  PlannerModel,
  RenderPort,
  SemanticDesignPlan,
} from "@house/aesthetic-planner";

/** A hand-designed look for a living room; pieces are named by exact library title. */
type CuratedRecipe = {
  match: (brief: PlannerInput["brief"]) => boolean;
  rationale: string;
  sofa: string;
  lounge: string;
  coffee: string;
  accentChair: string;
  adds: {
    key: string;
    title: string;
    category: string;
    intent: SemanticDesignPlan["items"][number]["placementIntent"];
    optional?: boolean;
  }[];
  refinement: { key: string; title: string; category: string; finding: string };
  review: { style: number; composition: number; usability: number };
};
const has = (brief: PlannerInput["brief"], tag: string) =>
  brief.styleTags.some((t) => t.toLowerCase().includes(tag));
export const curatedRecipes: CuratedRecipe[] = [
  {
    match: (b) => has(b, "japanese") || has(b, "scandinavian"),
    rationale:
      "A calm Japanese–Scandinavian living room: a low linen sofa faces the fireplace, pale walnut and white-painted wood replace the mixed metal pieces, and a natural woven rug anchors the seating. Layered light from a linen floor lamp and an olive tree bring warmth without clutter.",
    sofa: "Linen sofa",
    lounge: "Bouclé lounge chair",
    coffee: "Modern Walnut Coffee Table",
    accentChair: "White painted wood chair",
    adds: [
      {
        key: "rug",
        title: "Natural woven rug",
        category: "rug",
        intent: { zone: "center" },
      },
      {
        key: "floor-lamp",
        title: "Linen shade floor lamp",
        category: "lamp",
        intent: { zone: "near", anchorKey: "main-sofa", relation: "beside" },
      },
      {
        key: "side-table",
        title: "Round brass side table",
        category: "side-table",
        intent: { zone: "near", anchorKey: "main-sofa", relation: "beside" },
        optional: true,
      },
    ],
    refinement: {
      key: "plant",
      title: "Olive tree",
      category: "plant",
      finding:
        "The window corner feels bare; a tall olive tree would soften it and balance the floor lamp.",
    },
    review: { style: 5, composition: 4, usability: 5 },
  },
  {
    match: (b) => has(b, "warm minimal"),
    rationale:
      "A warm-minimal living room built on a tight palette of ivory, stone and oak: a cream bouclé sofa and barrel chair around a round travertine table, a jute rug for texture, and a sculptural stone lamp as the single focal accent. Extra chairs are removed to open the floor.",
    sofa: "Modern cream sofa",
    lounge: "Boucle barrel chair",
    coffee: "Round travertine coffee table",
    accentChair: "Contemporary Boucle Armchair",
    adds: [
      {
        key: "rug",
        title: "Bordered jute rug",
        category: "rug",
        intent: { zone: "center" },
      },
      {
        key: "floor-lamp",
        title: "Organic Sculptural Floor Lamp",
        category: "lamp",
        intent: { zone: "near", anchorKey: "main-sofa", relation: "beside" },
      },
      {
        key: "vase",
        title: "Round clay vase",
        category: "decor",
        intent: { zone: "on", anchorKey: "coffee-table", relation: "on" },
        optional: true,
      },
    ],
    refinement: {
      key: "plant",
      title: "Tall Green Plant",
      category: "plant",
      finding:
        "The palette is calm but a little flat; one slim plant near the wall adds life without breaking the minimal look.",
    },
    review: { style: 5, composition: 5, usability: 4 },
  },
];
const byTitle = (library: AssetSpec[], title: string) =>
  library.find((a) => a.title === title && a.licenseStatus === "verified");

/** Builds a curated plan from whatever living-room pieces the scan contains. */
function curatedPlan(
  input: PlannerInput,
  recipe: CuratedRecipe,
  library: AssetSpec[],
): SemanticDesignPlan {
  const objects = input.scene.objects;
  const free = (o: (typeof objects)[number]) =>
    !o.locked && !input.brief.mustKeepObjectIds.includes(o.id);
  const area = (o: (typeof objects)[number]) =>
    o.dimensionsM[0] * o.dimensionsM[2];
  const seats = objects
    .filter((o) => free(o) && ["sofa", "armchair"].includes(o.category))
    .sort((a, b) => area(b) - area(a));
  const mainSofa = seats[0];
  const coffee = objects.find(
    (o) =>
      free(o) &&
      ["coffee-table", "table"].includes(o.category) &&
      o.dimensionsM[1] < 0.6,
  );
  const chairs = objects.filter((o) => free(o) && o.category === "chair");
  const dims = (title: string, fallback: [number, number, number]) =>
    (byTitle(library, title)?.dimensionsM ?? fallback) as [
      number,
      number,
      number,
    ];
  const items: SemanticDesignPlan["items"] = objects.map((o, i) => {
    const base = {
      objectId: o.id,
      desiredStyleTags: input.brief.styleTags,
      colors: input.brief.palette,
      materials: input.brief.preferredMaterials,
      placementIntent: { zone: "original" as const },
    };
    const replace = (key: string, title: string, category: string) => ({
      ...base,
      key,
      action: "replace" as const,
      description: title,
      desiredCategory: category,
      maxDimensionsM: dims(title, o.dimensionsM as [number, number, number]),
    });
    if (o === mainSofa) return replace("main-sofa", recipe.sofa, "sofa");
    if (seats.includes(o))
      return replace(`lounge-${i}`, recipe.lounge, "armchair");
    if (o === coffee)
      return replace("coffee-table", recipe.coffee, "coffee-table");
    if (o === chairs[0])
      return replace(
        `accent-chair-${i}`,
        recipe.accentChair,
        byTitle(library, recipe.accentChair)?.category ?? "chair",
      );
    if (chairs.includes(o))
      return {
        ...base,
        key: `existing-${i}`,
        action: "remove" as const,
        description: o.displayName,
      };
    return {
      ...base,
      key: `existing-${i}`,
      action: "keep" as const,
      description: o.displayName,
      desiredCategory: o.category,
      maxDimensionsM: o.dimensionsM as [number, number, number],
    };
  });
  for (const add of recipe.adds) {
    if (
      add.intent.anchorKey &&
      !items.some((i) => i.key === add.intent.anchorKey)
    )
      continue;
    items.push({
      key: add.key,
      action: "add",
      description: add.title,
      desiredCategory: add.category,
      desiredStyleTags: input.brief.styleTags,
      colors: input.brief.palette,
      materials: input.brief.preferredMaterials,
      maxDimensionsM: dims(add.title, [1, 1, 1]),
      placementIntent: add.intent,
    });
  }
  return {
    schemaVersion: 1,
    roomId: input.scene.roomId,
    rationale: recipe.rationale,
    items,
  };
}

function curatedModel(
  input: PlannerInput,
  recipe: CuratedRecipe,
  library: AssetSpec[],
): PlannerModel {
  const initial = curatedPlan(input, recipe, library);
  return {
    async complete(request) {
      if (request.task === "plan") return initial;
      const current = (
        request.data as { candidate: { plan: SemanticDesignPlan } }
      ).candidate.plan;
      const { refinement } = recipe;
      if (!current.items.some((i) => i.key === refinement.key)) {
        const revised = structuredClone(current);
        revised.items.push({
          key: refinement.key,
          action: "add",
          description: refinement.title,
          desiredCategory: refinement.category,
          desiredStyleTags: input.brief.styleTags,
          colors: input.brief.palette,
          materials: input.brief.preferredMaterials,
          maxDimensionsM: (byTitle(library, refinement.title)?.dimensionsM ?? [
            0.6, 1.5, 0.6,
          ]) as [number, number, number],
          // Against the window wall when the scan has one, so it softens that corner.
          placementIntent: {
            zone: "wall",
            wallId:
              input.shell.openings.find((o) => o.kind === "window")?.wallId ??
              input.shell.walls[0].id,
          },
        });
        return {
          verdict: "repair",
          scores: { style: 4, composition: 3, usability: 4 },
          findings: [
            {
              objectKey: current.items[0].key,
              issue: refinement.finding,
              repair: `Add a ${refinement.title.toLowerCase()}.`,
            },
          ],
          revisedPlan: revised,
        };
      }
      return { verdict: "ready", scores: recipe.review, findings: [] };
    },
  };
}

/** Explicit scripted fallback exercises transport/rendering; it is not evidence of AI design quality. */
export function demoModel(
  input: PlannerInput,
  library: AssetSpec[] = catalog,
): PlannerModel {
  const recipe = curatedRecipes.find((r) => r.match(input.brief));
  if (recipe) return curatedModel(input, recipe, library);
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
      const named = library.find(
        (a) =>
          a.title === request.description &&
          !existingIds.has(a.id) &&
          a.licenseStatus === "verified" &&
          a.mount !== "wall" &&
          a.mount !== "ceiling",
      );
      const asset = named ?? candidates[0];
      return {
        asset: asset ?? null,
        source: asset ? "retrieved" : "placeholder",
        ...(asset ? {} : { placeholderReason: "no_match" as const }),
        notes: named
          ? []
          : [
              "Catalog demo: real library model selected by a scripted example. No AI or render-worker call was made.",
            ],
      };
    },
  };
}
export const demoRender = createDemoRender();
