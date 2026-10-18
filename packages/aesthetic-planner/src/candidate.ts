import {
  AssetSpecSchema,
  type AssetSpec,
  type SceneObject,
  type SceneOp,
} from "@house/contracts";
import {
  applyOp,
  resolveDraft,
  stableStringify,
  supportedDescendants,
  validateObject,
} from "@house/scene-engine";
import { placeObject } from "./placement";
import { SemanticDesignPlanSchema, type SemanticDesignPlan } from "./schema";
import type {
  DesignCandidate,
  ModelResolution,
  PlannerInput,
  ProposalItem,
  RenderPort,
} from "./ports";

/** No model output can unlock a piece or reinterpret an explicit user instruction. */
export function checkPlan(
  raw: unknown,
  input: PlannerInput,
): SemanticDesignPlan {
  const plan = SemanticDesignPlanSchema.parse(raw);
  if (plan.roomId !== input.scene.roomId)
    throw new Error("Plan belongs to another room.");
  const keys = new Set<string>(),
    ids = new Set<string>();
  for (const item of plan.items) {
    if (keys.has(item.key)) throw new Error("Repeated item key.");
    const base = input.scene.objects.find((o) => o.id === item.objectId);
    if (item.action === "add") {
      if (item.objectId)
        throw new Error("An addition cannot use an existing object ID.");
    } else {
      if (!base || ids.has(base.id))
        throw new Error(
          "Every existing item must appear exactly once with its real ID.",
        );
      ids.add(base.id);
      if (base.locked) {
        item.action = "keep";
        item.placementIntent = { zone: "original" };
      } else {
        const kept =
          base.renovationDecision === "keep" ||
          input.brief.mustKeepObjectIds.includes(base.id);
        if (kept && item.action !== "keep" && item.action !== "move")
          throw new Error(`${base.displayName} must be kept.`);
        if (base.renovationDecision === "remove" && item.action !== "remove")
          throw new Error(`${base.displayName} must be removed.`);
        if (base.renovationDecision === "replace" && item.action !== "replace")
          throw new Error(`${base.displayName} must be replaced.`);
        if (
          item.action === "move" ||
          item.action === "remove" ||
          item.action === "replace"
        ) {
          const descendants = supportedDescendants(input.scene, base.id);
          if (
            input.scene.objects.some((o) => descendants.has(o.id) && o.locked)
          )
            throw new Error("Cannot alter a support carrying a locked piece.");
        }
      }
      if (item.action === "keep" && item.placementIntent.zone !== "original")
        item.action = "move";
      if (
        item.action === "move" &&
        (base.placement?.support === "object" ||
          base.placement?.support === "wall" ||
          base.placement?.support === "ceiling")
      )
        throw new Error(
          "This first experiment preserves mounted and attached pieces in place.",
        );
    }
    if (item.action === "add" || item.action === "replace") {
      if (item.description === "Existing item")
        throw new Error("New pieces need a specific appearance description.");
      if (!item.desiredCategory || !item.maxDimensionsM)
        throw new Error("New pieces need a category and maximum dimensions.");
      if (item.action === "add" && item.placementIntent.zone === "original")
        throw new Error("New pieces need an explicit placement relationship.");
    }
    keys.add(item.key);
  }
  if (ids.size !== input.scene.objects.length)
    throw new Error("Plan omitted existing furniture.");
  const byKey = new Map(plan.items.map((i) => [i.key, i]));
  const sorted: typeof plan.items = [],
    visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (item: (typeof plan.items)[number]) => {
    if (done.has(item.key)) return;
    if (visiting.has(item.key))
      throw new Error("Placement relationships contain a cycle.");
    visiting.add(item.key);
    const intent = item.placementIntent;
    if (intent.zone === "near" || intent.zone === "on") {
      const anchor = byKey.get(intent.anchorKey ?? "");
      if (!anchor || anchor.action === "remove")
        throw new Error(
          `Unknown/removed anchor '${intent.anchorKey}'. Use a real item key from: ${[...keys].join(", ")}`,
        );
      visit(anchor);
    }
    visiting.delete(item.key);
    done.add(item.key);
    sorted.push(item);
  };
  plan.items.forEach(visit);
  plan.items = sorted;
  return plan;
}

export async function buildCandidate(
  raw: unknown,
  input: PlannerInput,
  render: RenderPort,
  library: AssetSpec[],
  signal: AbortSignal,
  uuid: () => string,
): Promise<DesignCandidate> {
  const plan = checkPlan(raw, input);
  const base = structuredClone(input.scene);
  const assets = Object.fromEntries(library.map((a) => [a.id, a]));
  const ctx = { room: input.shell, assets, roomId: base.roomId };
  const fixed = new Set(
    plan.items.filter((i) => i.action === "keep").map((i) => i.objectId),
  );
  let proposed = {
    ...base,
    objects: base.objects.filter((o) => fixed.has(o.id)),
  };
  const placed = new Map<string, SceneObject>();
  const items: ProposalItem[] = [],
    warnings: string[] = [];
  const resolutions = new Map<string, ModelResolution>();
  const requested = plan.items.filter(
    (i) => i.action === "add" || i.action === "replace",
  );
  // Bound concurrency, but avoid waiting a full worker timeout separately for every piece.
  for (let start = 0; start < requested.length; start += 4) {
    await Promise.all(
      requested.slice(start, start + 4).map(async (item) => {
        try {
          const response = await render.resolve(
            {
              schemaVersion: 1,
              category: item.desiredCategory!,
              description: item.description,
              styles: item.desiredStyleTags.length
                ? item.desiredStyleTags
                : input.brief.styleTags,
              colors: item.colors.length ? item.colors : input.brief.palette,
              materials: item.materials.length
                ? item.materials
                : input.brief.preferredMaterials,
              targetDimensionsM: item.maxDimensionsM!,
              allowGeneration: false,
            },
            signal,
          );
          resolutions.set(item.key, structuredClone(response));
        } catch {
          signal.throwIfAborted();
          resolutions.set(item.key, {
            asset: null,
            source: "placeholder",
            notes: ["Model service unavailable; appearance unverified."],
          });
        }
      }),
    );
  }
  for (const item of plan.items) {
    signal.throwIfAborted();
    const old = base.objects.find((o) => o.id === item.objectId);
    if (
      old?.locked &&
      (old.renovationDecision === "remove" ||
        old.renovationDecision === "replace")
    )
      warnings.push(
        `${old.displayName}: Lock overrides its ${old.renovationDecision} instruction.`,
      );
    const line: ProposalItem = {
      key: item.key,
      objectId: old?.id,
      action: item.action,
      name: old?.displayName ?? item.description,
      method: "existing",
      notes: [],
      price: {
        estimatedUnitCost: { currency: "USD", minor: 0 },
        priceStatus: "estimated",
        priceSource: "Existing item",
      },
    };
    if (item.action === "remove") {
      items.push(line);
      continue;
    }
    let object = old;
    if (
      item.action === "add" &&
      ["wall-art", "pendant"].includes(item.desiredCategory ?? "")
    ) {
      line.placement = "dropped";
      line.method = "placeholder";
      line.price = { estimatedUnitCost: null, priceStatus: "unknown" };
      line.notes.push(
        "Left out: new wall/ceiling mounting is not supported in this experiment.",
      );
      warnings.push(
        `${line.name}: left out because mounting is not supported yet.`,
      );
      items.push(line);
      continue;
    }
    if (item.action === "replace" || item.action === "add") {
      const result = resolutions.get(item.key)!;
      let asset = result.asset ? AssetSpecSchema.parse(result.asset) : null;
      const dimensions = item.maxDimensionsM!;
      const scale = asset
        ? Math.min(1, ...dimensions.map((v, i) => v / asset!.dimensionsM[i]))
        : 1;
      if (
        asset &&
        (asset.licenseStatus !== "verified" ||
          asset.mount === "wall" ||
          asset.mount === "ceiling" ||
          scale < 0.75 ||
          result.source === "best_effort")
      ) {
        result.notes.push(
          "Returned model is unsuitable for this request; using a labelled placeholder.",
        );
        asset = null;
      }
      if (asset) assets[asset.id] = asset;
      object = {
        id: uuid(),
        assetId: asset?.id ?? null,
        category: item.desiredCategory!,
        displayName:
          asset?.title ??
          `Planned ${item.desiredCategory!.replaceAll("-", " ")}`,
        dimensionsM: asset
          ? (asset.dimensionsM.map((n) => n * scale) as [
              number,
              number,
              number,
            ])
          : dimensions,
        transform: {
          position: [0, input.shell.floor.elevationY, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        locked: false,
        source: "agent",
        ownership: "planned_new",
        placement: { support: "floor" },
        ...(old ? { replacesObjectId: old.id } : {}),
      };
      if (old && item.placementIntent.zone === "original")
        object.transform = {
          ...object.transform,
          position: [...old.transform.position],
          rotation: [...old.transform.rotation],
        };
      line.objectId = object.id;
      line.replacesObjectId = old?.id;
      line.name = object.displayName;
      line.method = !asset
        ? "placeholder"
        : result.source === "modified"
          ? "edited"
          : result.source === "generated"
            ? "generated"
            : "retrieved";
      line.notes = [...result.notes];
      if (!asset) line.notes.push(`Requested: ${item.description}`);
      line.price = asset?.estimatedPrice
        ? {
            estimatedUnitCost: asset.estimatedPrice,
            priceStatus: "estimated",
            priceSource: "Catalog estimate",
          }
        : { estimatedUnitCost: null, priceStatus: "unknown" };
    }
    if (!object) throw new Error("Missing existing object.");
    if (item.action !== "keep") {
      const anchor = placed.get(item.placementIntent.anchorKey ?? "");
      const anchorMissing =
        (item.placementIntent.zone === "near" ||
          item.placementIntent.zone === "on") &&
        !anchor;
      const fit = anchorMissing
        ? null
        : placeObject(
            object,
            item.placementIntent,
            proposed,
            input.shell,
            ctx,
            anchor,
          );
      if (!fit && item.action === "add") {
        line.placement = "dropped";
        line.notes.push(
          "Left out: no valid placement or supporting surface was found.",
        );
        warnings.push(`${line.name}: left out because it could not fit.`);
        items.push(line);
        continue;
      }
      if (!fit)
        throw new Error(
          `${line.name} could not fit. Change its size or placement instruction and retry.`,
        );
      object = fit;
      proposed = { ...proposed, objects: [...proposed.objects, object] };
    }
    placed.set(item.key, object);
    items.push(line);
  }
  const resolved = resolveDraft(base, proposed, ctx);
  if (!resolved.ok)
    throw new Error(resolved.unresolved.map((e) => e.message).join("; "));
  const scene = resolved.scene;
  for (const object of scene.objects) {
    const validation = validateObject(scene, object, ctx);
    if (!validation.ok) throw new Error(validation.error.message);
  }
  // The resolver can revert/drop pieces. Do not claim a required instruction succeeded if it didn't.
  for (const item of items) {
    if (item.placement === "dropped") continue;
    if (item.action === "remove") {
      if (scene.objects.some((o) => o.id === item.objectId))
        throw new Error("Required removal was reverted.");
    } else if (!scene.objects.some((o) => o.id === item.objectId))
      throw new Error(`Required item ${item.name} was dropped.`);
  }
  for (const old of base.objects) {
    const next = scene.objects.find((o) => o.id === old.id);
    if (old.locked && stableStringify(next) !== stableStringify(old))
      throw new Error("Locked piece changed.");
    if (
      old.renovationDecision === "keep" ||
      input.brief.mustKeepObjectIds.includes(old.id)
    ) {
      if (
        !next ||
        stableStringify({
          ...next,
          transform: old.transform,
          placement: old.placement,
        }) !== stableStringify(old)
      )
        throw new Error("Kept physical piece changed.");
    }
  }
  const operations: SceneOp[] = [];
  for (const item of items) {
    if (item.placement === "dropped") continue;
    if (item.action === "keep") continue;
    if (item.action === "remove")
      operations.push({ type: "delete", objectId: item.objectId! });
    else {
      const object = scene.objects.find((o) => o.id === item.objectId)!;
      if (item.action === "replace")
        operations.push({
          type: "replacePhysicalItem",
          oldObjectId: item.replacesObjectId!,
          newObject: object,
        });
      else if (item.action === "add") operations.push({ type: "add", object });
      else
        operations.push({
          type: "move",
          objectId: object.id,
          transform: object.transform,
        });
    }
  }
  let replayed = base;
  for (const op of operations) {
    const result = applyOp(replayed, op, ctx, { allowConflicts: true });
    if (!result.ok) throw new Error(result.error.message);
    replayed = result.scene;
  }
  const objectsKey = (s: typeof base) =>
    stableStringify([...s.objects].sort((a, b) => a.id.localeCompare(b.id)));
  if (objectsKey(replayed) !== objectsKey(scene))
    throw new Error(
      "Proposal could not be reproduced using safe scene operations.",
    );
  if (
    scene.shellId !== base.shellId ||
    stableStringify(scene.appearance) !== stableStringify(base.appearance)
  )
    throw new Error("Shell/finish mutation blocked.");
  return {
    id: uuid(),
    plan,
    scene: { ...scene, revision: base.revision },
    operations,
    assets: Object.values(assets).filter((asset) =>
      scene.objects.some((o) => o.assetId === asset.id),
    ),
    items,
    warnings,
  };
}
