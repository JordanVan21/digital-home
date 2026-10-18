# Asking the render agent for a model (for the aesthetic planner)

The planner decides **what** objects a design needs and **where** they go. To get a
3D model for each object, insert one row per object into `asset_requests`. The scan
worker (`apps/worker`, running on the demo Mac) answers in the same row.

## 1. Request (browser or server, signed-in user, public anon key)

```js
const { data: row } = await supabase
  .from("asset_requests")
  .insert({
    object_key: "planned-credenza-1",          // your own id for the planned object
    room_id: roomId,                           // optional: the room being redesigned
    design_id: designId,                       // optional: your designs row
    request: {                                 // AssetRequest (packages/contracts/src/assetRequest.ts)
      schemaVersion: 1,
      category: "sideboard",                   // see "Categories" below
      description: "walnut mid-century credenza with sliding doors",
      styles: ["mid-century"],
      colors: ["walnut"],
      materials: ["wood"],
      targetDimensionsM: [1.6, 0.8, 0.45],     // width (x), height (y), depth (z), meters
      allowGeneration: true,                   // false = library only, never Blender
    },
  })
  .select()
  .single();
```

Only those five columns can be set by a client; the answer columns are written by
the worker only.

## 2. Answer

| status | meaning |
| --- | --- |
| `pending` | waiting for the worker |
| `processing` | `asset_id`/`asset` already hold the best **library** match; the agent may still edit or build something better |
| `done` | final answer (`asset_id` may be null = no model; show a placeholder box) |
| `failed` | see `error` (e.g. invalid request) |

Answer columns: `asset_id`, `asset` (the AssetSpec plus `glbUrl`, a public GLB URL),
`method` (`a` library, `b` edited library model, `c` built in Blender, `placeholder`),
`source`, `notes` (why), `seconds`.

Library matches answer in about a second. Editing takes ~30 s and a Blender build
~1–3 min (capped by `REQUEST_TIME_LIMIT_S`, default 300 s). Every edited/built model
is saved to the shared library, so the next identical request is instant.

Listen for the answer with Realtime (or poll the row):

```js
supabase
  .channel(`asset-request-${row.id}`)
  .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "asset_requests", filter: `id=eq.${row.id}` },
      ({ new: r }) => { if (r.asset_id) usePlacedObject(r.object_key, r.asset_id, r.asset); })
  .subscribe();
```

## 3. Using it in a scene

Put `asset_id` in the `SceneObject.assetId` of your planned object (your transform,
your dimensions). The sandbox resolves any library asset id, including models the
agent built, from the `assets` table. Size: the model is uniformly scaled to fit
`targetDimensionsM`; `asset.dimensionsM` is its natural size.

## Categories

Use sandbox catalog categories where possible: `sofa`, `armchair`, `chair`, `stool`,
`ottoman`, `bench`, `table`, `coffee-table`, `side-table`, `desk`, `bed`, `sideboard`,
`cabinet`, `dresser`, `bookshelf`, `lamp`, `pendant`, `plant`, `decor`, `wall-art`,
`rug`, `textile`, `stove`, `fireplace`, `television`. Close categories still match
(e.g. `storage` finds cabinets and sideboards); anything else is built in Blender.
