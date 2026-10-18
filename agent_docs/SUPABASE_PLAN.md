# Supabase read-through and design inputs

**Date:** 2026-10-18. **Status:** Step 1 read-through complete; no implementation approval yet.
**Working branch:** `feature/room-scanner`, at `56650d2` before this document.
**Worktree:** `/Users/jeffreyg/Projects/digital-home/.worktrees/room-scanner`.

The user said “keep going” after the read-through document was prepared. Proceed
to the questions stage; implementation and remote deployment are not yet approved.

## 1. Scope, authority and actual starting point

The new task is to create the complete database/storage/security foundation and
connect phone sign-in/upload only. Do not implement the library import, render
agent execution, converter or desktop integration in this step. Their persistence
requirements belong in the schema now; their execution belongs in later steps.

Read all of `agent_docs/`, including the diagram and scanner status/format/backlog,
then the current scanner sources/setup and read-only branch references below.
`CONTRACTS.md` owns shared names and semantics. The later normative/revised sections
in the architecture/product docs override earlier text. Recommendations in this
read-through are not an approved migration plan.

Important corrections to the new task's assumed starting state:

- The actual branch uses a hyphen: `feature/room-scanner`, not
  `feature/room_scanner`. The user previously explicitly chose this existing branch.
  The fetched asset/render/planner branch names also use hyphens. No branch was
  renamed, merged or checked out for editing during this review.
- Phone checkpoints 1–3 are implemented and user-accepted: capture, unplugged use,
  Finish/Cancel, preview, naming, durable saving, draft recovery, list and JSON sharing.
- There is **no working ready-to-upload placeholder**. `ScanUploading` exists with
  an unused HTTP implementation accepting only `RawRoomScan`, and the local record
  has status enum values. Save currently records `saved`; nothing prepares/uploads
  files or persists retries. The new file-based uploader/session boundary must be built.
- `SCAN_FORMAT.md` describes an approved future version 2 target, explicitly not yet
  implemented. The phone and importer currently speak **version 1**. Do not create
  an upload path that assumes the version 2 example is the current export.
- Supabase's remote schema being empty is the user's supplied context. No remote
  project was queried, linked, changed or deployed during this read-through.

The broader previous handoff anticipated the whole scan-to-render connection.
This newer task narrows the executable work to scan upload/sign-in; keep later
processing supported by schema without pretending it is already running.

## 2. Repository and branch inventory

`git fetch` completed first; the scanner worktree was clean. Read other branches
with `git show`, `git ls-tree` and filename-only searches, without editing them.
The inspected reference snapshots were:

| Ref | Commit | Existing relevant implementation | Supabase state |
| --- | --- | --- | --- |
| Scanner worktree | `56650d2` | Swift capture/storage; TS contracts/importer; local sandbox/catalog | No client SDK, migrations, CLI config or Supabase env config |
| `origin/feature/asset-builder` | `c0b6980` | AssetRequest/Resolution; retrieval; GLB validation; FileAssetRegistry; render service | Registry explicitly stands in for an assets table/storage; no Supabase adapter |
| `origin/feature/render-agent-demo` | `5c0ff42` | Same asset/render packages plus local loopback HTTP/SSE demo and temporary generated library | No authenticated hosted service or durable DB jobs |
| `origin/feature/aesthetic-planner` | `7e469da` | Local room-command experiment, server model adapter, chat request/response schemas | `.env.example` for server model/provider settings; no Supabase values/client |
| `origin/feature/3d-sandbox` | `9c07024` | Baseline SceneSpec/RoomShell renderer, verified local GLB catalog | No Supabase; local state persistence stand-ins |
| `origin/feature/3d-sandblox-jordan` | `c27fed7` | Extended contracts, 39-asset catalog, ScenePersistence and AssetCatalog ports | Both ports have local implementations; Supabase appears in future-adapter comments |
| `origin/feature/3d-sandbox-merge` | `8e330e7` | Jordan-based catalog/persistence and merged editing behavior | No actual Supabase adapter/config |
| `origin/feature/3d-sandbox-codex` | `139676f` | Alternate sandbox contract module/catalog/editor | No actual Supabase adapter/config |
| Local `feature/3d-sandbox-codex-base` snapshot | `cfaf86a` | 54-asset catalog and imported Jordan room fixtures; stronger schema validation | No actual Supabase adapter/config |
| `origin/main` | `6fc23a2` | Normative agent docs/assets | No backend setup |

Also enumerated tracked files across all local/fetched branch refs: no SQL
migrations, `supabase/` configuration or `.xcconfig` files were found. The only
tracked env file found was the aesthetic branch's `.env.example`; it names
`AGENT_PROVIDER`, `AGENT_REASONING_EFFORT`, provider API keys and model selectors.
It is not a Supabase configuration. No actual env credential values were printed.

The scanner branch ignores `.env`, `.env.*` (except `.env.example`), build output,
generated Xcode projects and user settings. It needs a committed placeholder iOS
configuration example and a matching ignore rule for its real configuration.
The production service-role credential must remain exclusively server-side.

Existing server code is TypeScript. The render branches also contain a Python
Blender bridge and model-authored Blender Python; retain those as later service
internals. No need to change the language of the new backend or phone app.

## 3. What the four proposed concepts need to represent

Four giant JSON tables would lose distinctions already required by the docs.
Keep lowercase snake_case table names while preserving the existing domain names.
These are candidate mappings for the next discussion, not final approved SQL.

| User concept | Existing contract meaning / proposed mapping | Why the split is needed |
| --- | --- | --- |
| `assets` | `assets` with AssetSpec JSON, searchable metadata and immutable GLB reference | Both scanned objects and future planner requests resolve to the same reusable asset library |
| `House` | `projects` as a house/project container, with `rooms`, `scans`, `room_shells`, `scenes` and original `scene_versions` | Original raw capture, immutable structure and editable furniture state have different meanings/lifetimes |
| `House_design` | `design_proposals` for unaccepted patches; `scene_versions` for accepted designs; `roadmaps` for their implementation plans | A pending AI proposal must not overwrite the original or count as an accepted design |
| `Milestone` | `milestones` under a room's roadmap, pointing at an immutable scene version and purchases | A milestone is a budget stage, not an editor undo record or merely a copy of a design name |

A single-room upload can allocate its project/room context and attach the original
raw file. Future multi-room scans can produce several rooms under that project.
Do not put raw RoomPlan matrices into a column promised to contain `SceneSpec`.
Do not create a second competing `houses`/`house_designs` domain without agreeing
how it maps to `CONTRACTS.md` first. A UI may still call a project a house.

### Complete storage/query inventory from docs and code

All new application tables need `id`, `created_at`, `updated_at`, and `user_id`
where user-owned. Owner checks must also enforce parent ownership, not merely trust
a user-supplied owner column. Shared library assets are server-managed, not owned
by whichever signed-in user happens to query them. Immutable records can have an
`updated_at` initialized at creation without permitting arbitrary later mutation.

| Candidate table / data group | Data to retain and relationships | Main reads/writes needed later |
| --- | --- | --- |
| Supabase `auth.users`; optional `profiles` | Common identity for phone/web; optional display preferences | Sign-in/session refresh, current user; avoid duplicating passwords |
| `projects` | User owner, display name; house/project context | List owned projects, rename, contain rooms/scans |
| `rooms` | Project/owner, name, source scan; optional source-room ID/type/story; accepted/working scene references | My Scans, load one room, allow multiple rooms per house later |
| `scans` | Client scan ID, format version, capture date/device, name, original raw JSON reference, project/created-room relationship; uploading/uploaded/processing/done/failed; failure/attempt metadata | Idempotent upload reservation/completion and status listing |
| `scan_files` | Per-scan artifact kind, server-assigned storage key, MIME, bytes, checksum, completion state | Verify upload manifest, fetch artifacts, prevent duplicate files or mismatched replacements |
| `room_shells` | Immutable RoomShell JSON, room/source scan, coordinate version and scan-to-world transform/provenance | Fetch structural geometry once; preserve source coordinate interpretation |
| `scenes` | Working SceneSpec JSON, room/shell, revision, accepted base reference | Revision-checked validated autosave, not unrestricted client JSON updates |
| `scene_versions` | Immutable SceneSpec snapshot, room, parent version, import/user/accepted_proposal/milestone_edit source | Reopen original/designs, compare, fork, roadmap playback |
| Optional `scene_operations` / mutation receipts | Operation/idempotency key, base/result revision, actor/source, validated result | Deduplicate save retries and audit committed mutations; not the budget timeline |
| `assets` | AssetSpec JSON plus indexed category/dimensions/tags/source/license/description/hash; GLB ID/key; creation method and parent asset | Category/size-first retrieval, signed URLs, verified library reads, server-only registration |
| `design_inputs` / `design_briefs` | Questionnaire/free text, image refs, DesignBrief and StyleTrait provenance, room/base version | Reproduce/review inferred style without changing captured geometry |
| `inspiration_images` | Owner/room, storage key, MIME/size/checksum, upload state | Private style-image upload/removal and authorized model input |
| `design_proposals` | Base accepted version/revision, SemanticDesignPlan, ScenePatch, explanation/cost/validation, status | Preview/accept/reject; atomic acceptance only against the expected base |
| `roadmaps` | RenovationPlan: baseline, desired/adjusted/funded target version IDs; budget caps, savings assumptions, start date, estimate gaps | Preserve dream and funded partial targets; do not infer dates from a spending cap |
| `purchases` | New physical object ID, asset ID, replaced object lineage, quantity, integer cents/currency, price source/status, priority/dependencies | Cost once per actual new purchase; retained furniture stays free; unknown price is null |
| `milestones` and purchase links | Room/roadmap, ordered stage, optional planning date, scene version, stage and cumulative spend, purchase IDs | Fetch timeline by room/plan and render a materialized snapshot |
| `scan_jobs` (or equivalent typed processing job) | Scan/owner, input version/hash, processing version, attempt/lease/status/errors | Later importer/converter runs; this task must not fake completed normalization |
| `render_jobs` | One scan job identity with attempts/progress/lease/errors; allow separate design-triggered jobs via explicit source type/reference | Later durable claim/retry/progress; scan job unique per scan, not a new row per network retry |
| `render_object_results` plus attempt history | Job + source object ID, request/result JSON, asset ID/lineage, method/source, reasons, candidate scores, timing/usage/errors | Partial per-object completion, retries, traceability and asset handoff |
| `proposal_jobs` / other typed job support | Owner, input/base refs, stage/progress/result IDs, bounded attempts, provenance | Later style/design/roadmap execution; no model calls or workers implemented here |
| Optional later `asset_embeddings` | Asset ID, embedding model/version/dimension and vector | Semantic retrieval once a real library/query evaluation warrants it |

The later revised requirements allow undated spending stages, but the current
`Milestone` Zod schema still requires a date. Database dates should be nullable;
reconcile the runtime schema when that API is implemented. Preserve the normative
`fundedFinalVersionId` name rather than introducing another competing alias.

Likely indexes: owner/project creation-date lists; room/version parent lookups;
unique owner/client-scan identity and per-scan artifact kind; active job claim and
retry indexes; render result job/object/attempt identity; assets by category and
width/height/depth plus GIN tag filters and text search. Database constraints/RPC
checks must prevent links to another user's project/room/version even if the child
row's `user_id` looks correct.

## 4. Actual asset JSON today

The canonical base is `packages/contracts/src/asset.ts`, matching `CONTRACTS.md`.
Here is an unchanged real entry from
`origin/feature/asset-builder:apps/web/src/fixtures/assetCatalog.json` (also present
in the scanner branch's six-model fixture library):

```json
{
  "schemaVersion": 1,
  "id": "421adb90-7cb5-4dde-815d-ebccc35f29ad",
  "category": "sofa",
  "title": "Sofa 03",
  "tags": ["fixture", "CC0"],
  "styles": ["contemporary"],
  "colors": [],
  "materials": [],
  "dimensionsM": [2.73117733001709, 1.1182640366605483, 0.9250842034816742],
  "glbStorageKey": "models/polyhaven/sofa_03-421adb907cb5.glb",
  "source": "other",
  "sourceUrl": "https://polyhaven.com/a/sofa_03",
  "licenseStatus": "verified",
  "attribution": "Sofa 03 · Poly Haven · CC0",
  "textureBytes": 2060026,
  "triangleCount": 8004,
  "contentHash": "421adb907cb5edde415debccc35f29adbd561c95f1e1ee33987cb6fb877a2411",
  "searchableDescription": "Sofa 03, CC0 Poly Haven furniture fixture"
}
```

Use this established JSON shape as the `assets` description baseline, not a new
category/size schema invented for SQL. `dimensionsM` is **width, height, depth**;
map explicitly to `width_m`, `height_m`, `depth_m` when making query columns.

Differences requiring explicit adapters/additive contract agreement:

- No current AssetSpec has a separate `glbId`. Add a GLB identity (`glb_id` in SQL
  and proposed `glbId` in descriptions) while retaining `glbStorageKey`. Proposed
  hosted key: `<glb_id>.glb`, as requested. Asset ID identifies an immutable asset
  version; GLB ID identifies its binary. They may be 1:1 initially, but that mapping
  must be explicit. Old fixture paths are local URLs, not hosted bucket keys.
- Asset-builder adds `derivedFromAssetId`; its registry tags modified/generated
  outputs and registers a new immutable content-derived asset. Preserve lineage in
  `derived_from_asset_id`; separate creation method from source/provider.
- Existing source values are `furnimesh`, `self_authored`, `other`, `generated`.
  Poly Haven is currently `other`, identified by URL/attribution. Do not silently
  rewrite the shared enum to `polyhaven` without updating contracts/adapters.
- Jordan's catalog (39 entries) adds thumbnail, named license, front axis, collision
  profiles/support surfaces, light and variant metadata. The merged local catalog
  has 54 entries and some different extension names (`mount` versus placement
  class, for example). Preserve agreed extensions in JSON; reconcile validators
  before round-tripping, since default Zod object parsing can strip unknown fields.
- Hash strings vary: bare SHA-256 versus `sha256:` prefix. Normalize for uniqueness
  while retaining provenance. Content-addressed UUID generation differs by branch;
  treat existing asset IDs as opaque immutable IDs instead of recomputing them.
- Catalog `licenseStatus: verified` is existing metadata, not a new license audit
  performed in this task. The actual shared import is later work.

`FileAssetRegistry` already provides `list` / `registerGenerated`; it validates,
normalizes and hashes GLBs, serializes writes, and keeps a local catalog beside
model files. `FileGlbStore.readGlb(key)` is another explicit storage port. A future
Supabase adapter should implement those ports. Do not build or import it in this step.

There are already small development catalogs despite there being no hosted/shared
library yet: scanner/asset-builder has 6 GLBs (largest about 9.2 MB), Jordan has 39,
and the observed local merged sandbox has 54. No models were uploaded by this review.

## 5. Scene JSON and the House/design relationship

Sandbox code uses **two related artifacts**, not one whole-room GLB:

- `RoomShell`: immutable floor polygon/elevation, wall segments/thickness/heights,
  openings attached to wall IDs, source scan ID and coordinate version.
- `SceneSpec`: room/shell references, independent furniture instances, transforms,
  asset references, revision, lighting and update timestamp.

A real sandbox SceneSpec excerpt from the Jordan demo fixture (one of its objects
shown; other objects omitted here) demonstrates the format:

```json
{
  "schemaVersion": 1,
  "id": "5ce70000-0000-4000-8000-000000000001",
  "roomId": "400a0000-0000-4000-8000-000000000001",
  "shellId": "5e110000-0000-4000-8000-000000000001",
  "revision": 0,
  "lightingPreset": "warm-interior",
  "updatedAt": "2026-10-17T12:00:00.000Z",
  "objects": [{
    "id": "0b1ec700-0000-4000-8000-000000000001",
    "assetId": "a55e7000-0000-4000-8000-000000000001",
    "category": "sofa",
    "transform": {
      "position": [1.641, 0, -0.6],
      "rotation": [0, -0.707106781186547, 0, 0.707106781186548],
      "scale": [1, 1, 1]
    },
    "dimensionsM": [1.571, 0.797, 0.658],
    "locked": false,
    "source": "roomplan_approximation",
    "displayName": "Sofa",
    "ownership": "existing",
    "placement": { "support": "floor" }
  }]
}
```

Normalized distances are meters, X right/Y up/Z forward; stored rotation is a
quaternion `[x,y,z,w]`. Preserve physical object identity when merely replacing
its visual model. A physical furniture purchase/replacement gets a new object ID
with predecessor lineage. Asset records are shared reusable models, not room instances.

The original house must retain the unmodified scan artifact and, once later
normalization happens, an immutable imported shell/scene version. Working edits
belong in `scenes`; accepted redesigned snapshots belong in `scene_versions`,
linked to a `design_proposals` result. Roadmaps/milestones point to those versions.
A new design must never overwrite the raw scan or immutable baseline.

The current scanner branch manually imports JSON in the browser, uses local
fixtures and `useGLTF` paths, and has no database load. Jordan/merge expose
`ScenePersistence.getScene/ensureScene/saveScenePatch` and `AssetCatalog` ports,
but their implementations are localStorage/in-memory and local catalog URLs.
Codex variants use their own module organization/additive schemas. These are
future integration adapters, not ready Supabase clients. Later signed URL resolution
must preserve caching by asset identity/hash rather than treating URL expiry as
an asset change.

## 6. Aesthetic planner and render service contracts

There is no production aesthetic-planner → render-agent connection in the inspected
branches. `origin/feature/aesthetic-planner` explicitly describes a **local command
experiment**, not the aesthetic interpreter/proposal pipeline. Its request is:

```text
{ scene: SceneSpec, shell: RoomShell, selectedId: UUID | null,
  messages: [{ role: "user" | "assistant", content: string }] }
```

Its response contains message, add/move/delete SceneOps, tool trace, provider/model,
request/token usage and elapsed time. Tools inspect the current scene/local approved
catalog and edit a private working copy; completed commands are automatically
applied by the experiment UI. This differs from the normative future proposal
preview + explicit accept/reject workflow. Do not make automatic AI acceptance the
production database write contract.

The render branches already define the future asset request:

```json
{
  "schemaVersion": 1,
  "category": "chair",
  "description": "walnut dining chair",
  "styles": ["mid-century"],
  "colors": ["brown"],
  "materials": ["wood"],
  "targetDimensionsM": [0.5, 0.9, 0.55],
  "allowGeneration": true
}
```

That is an illustrative valid `AssetRequest`, not an observed planner transmission.
Both a scanned object and a future semantic design item can map to it; the planner
bridge is not implemented. `SemanticDesignPlan`/`AssetResolverPort` in the shared
docs describe the intended higher-level workflow.

`RenderService.resolve/resolveMany` returns an outcome with a canonical request
key, request, nullable asset/asset ID, source, lineage, notes, retrieval classification
and model usage. Sources are `retrieved`, `reused`, `modified`, `generated`,
`best_effort`, `placeholder`; preserve all of them:

- Method (a): `retrieved` / `reused`; retain `best_effort` as an explicit fallback.
- Method (b): `modified`, with a parent asset and a new reusable asset/GLB.
- Method (c): `generated`, with a new reusable asset/GLB.
- `placeholder`: no asset, with a reason; do not falsely classify it as success (a/b/c).

Candidate score breakdowns exist in `AssetCandidate` (category, size, style, color,
material, text, fit scale). The public RenderOutcome does not currently return all
candidate scores or per-object timing; later instrumentation/adapters must persist
those explicitly. The demo adds elapsed seconds around a request. Current request
deduplication is in-memory, not a persistent database job guarantee.

The render demo runs a loopback Node server and local Blender, not an authenticated
remote job service. It cannot be exposed to the phone as the Supabase backend as-is.

## 7. Phone export and storage contract

Current on-phone directory: `Application Support/HouseScans/<scan UUID>/`.

| File | Actual current contents | Proposed hosted destination |
| --- | --- | --- |
| `scan.json` | Immutable raw `RawRoomScan` version 1, sorted object keys, RoomPlan array ordering, ISO capture date, source element IDs/transforms/dimensions/confidence | Private `scan-files/<user_id>/<scan_id>/scan.json` |
| `roomplan.json` | Apple's native Codable CapturedRoom; keeps details the simplified version 1 adapter omits | Same private scan folder as `roomplan.json`; recommend uploading it too |
| `scan.usdz` | Optional parametric RoomPlan preview/backup; created after durable JSON and may fail independently | Same private scan folder when available |
| `record.json` | Local metadata: scan name/date, draft/saved state, counts, status vocabulary, preview flag/warning | Keep device metadata local; send explicit name/capture/manifest fields to database rather than trusting it as server state |
| Log file | No centralized phone log file exists yet | Optional future logs under that user's scan prefix; do not claim to upload a nonexistent artifact |

The bucket name is a proposal; actual object key begins `<user_id>/<scan_id>/...`
inside that bucket. Server assigns/validates keys. File bytes stay on the phone
before, during and after upload; upload success never means the local copy is deleted.

Current raw JSON shape is `{schemaVersion:1,scanId,capturedAt,device?,walls,doors,
windows,openings,floors,objects}`. Surface/object transforms are 16-value column-major
RoomPlan matrices; dimensions are source-local `[x,y,z]` (objects: width/height/depth).
Floor corners are surface-local despite current v1 comments calling them world-space.
Capture origin/axis semantics must be written down and versioned independently from
the normalized room frame. No coordinate conversion belongs in the upload client.

Two genuine fixtures exist: 6,346 bytes/5 objects and 7,470 bytes/9 objects. They have
been structurally checked but not verified through the actual TypeScript importer
in this worktree. The documented expanded v2 shape must not replace their wire
interpretation silently. Recommend the existing v1 plus native JSON as the first
upload contract, then a separately versioned v2 upgrade, pending the user's decision.

Known later importer fixes: transform local floor corners before the fallback,
persist/reuse room/shell/scene identities across retries, and persist scan-to-world
metadata. Current importer allocates new IDs on each invocation and browser import
drops its returned scan-to-world transform. Track these before converter integration;
fixing/running the converter is outside this task's upload-only scope.

## 8. Proposed boundaries for the next design discussion

### Storage and access

Candidate private buckets: `glbs` (`<glb_id>.glb`), `asset-previews`, `scan-files`,
and `inspiration-images` for the later style pipeline. User scan/log/preview paths
are owner-prefixed. Shared library reads require an authenticated user; writes are
server-only. Recommend only published/verified library assets be selectable.

Initial proposed limits, to approve before migrations: GLBs 50 MB; scans bucket
50 MB per object, with API-level JSON/native JSON 20 MB and logs 1 MB; thumbnails
5 MB; inspiration images 10 MB. These are proposed application limits, not claims
about the remote plan's configured allowance. Measure phone USDZ sizes before final
limits. Explicit MIME allowlists: GLB `model/gltf-binary`; scans `application/json`,
`model/vnd.usdz+zip`, `text/plain`; previews PNG/JPEG/WebP; inspiration JPEG/PNG.
Bucket limits and per-kind validation both matter; a JSON filename alone is not validation.

Supabase Storage file access is controlled by `storage.objects` policies scoped to
bucket/key and authenticated owner; buckets stay private. Do not mistake a public
bucket plus table RLS for protected downloads. See [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
and [private buckets and limits](https://supabase.com/docs/guides/storage/buckets/fundamentals).

All application tables get RLS plus appropriate grants. Own-row RLS alone must not
permit forging job success, changing someone else's parent reference, editing an
immutable baseline, or bypassing scene validation. Use narrow authenticated
functions/API operations for those transitions; no client service-role secret.
Write pgTAP two-user tests under the authenticated role, not just a superuser, plus
negative anonymous/shared-library-write tests and Storage API checks. SQL metadata
policy tests alone do not prove actual signed file transfers work.

### Upload/session lifecycle

Implement the logical `createScanUpload` → signed file upload → `completeScan`
contract from `CONTRACTS.md`. Reserve IDs/allowed paths before file transfer;
completion verifies the manifest and commits scan/House context together. This
reservation differs from blindly creating trusted rows after an arbitrary upload.
Resolve exact project/room allocation semantics in the approved design.

Persist upload/retry receipts and associate them with the signed-in user and target
Supabase environment. Same-user/same-client-scan retries must not duplicate scans,
House rows, jobs or files, and a reused ID with different bytes must be rejected.
Do not accidentally upload one account's queued scan after switching accounts.
Local `uploaded` means confirmed remote receipt, not processing/render completion.
Server statuses can later advance uploaded → processing → done/failed.

Automatic retry must survive app restarts and respond to restored connectivity.
On iOS, distinguish background file transfers from application finalization: if
force-quit/suspended, reconcile and finish pending work when the app next runs.
Do not promise unlimited execution after a user force-quits the app. Preserve JSON
sharing and local persistence after any network/auth/upload failure.

Recommend email + password for the first phone/web account flow because it avoids
mobile magic-link routing while sharing the same Supabase identity; confirm this
with the user. Use the public Supabase URL/anon key plus the user's session JWT;
store session credentials securely in Keychain. No server key in app/web config.
See [password auth](https://supabase.com/docs/guides/auth/passwords). Email confirmation,
reset and mail-provider settings also need a reproducible setup/runbook.

### Jobs, search and updates — schema only in this step

Completion can enqueue one pending render job transactionally; the later worker
claims it with a lease, tracks attempts and per-object outcomes, and safely retries.
Without the worker connected, show uploaded/queued, not processing/done. Proposal-
triggered asset requests need their own source identity even when a scan is absent.

Follow the normative architecture: a separate TypeScript worker/server (initially
one host), with Blender as a managed subprocess/service when required. Edge
Functions may validate requests or enqueue jobs; they are not a Blender host.
Hosted Edge Functions have limited CPU/memory/wall time, unlike a long-running
Blender process; see [official runtime limits](https://supabase.com/docs/guides/functions/limits).
Do not execute/build that worker in this step.

Plan Realtime publication for owner-readable scan/job/progress and later scene
updates, with normal RLS and a refetch path. A change notification is not the
canonical scene, and must not overwrite unsaved editor edits. Enable the required
publication entries via migration rather than manual dashboard switches. See
[Postgres Changes setup](https://supabase.com/docs/guides/realtime/postgres-changes).

Recommend metadata/tag filtering and basic Postgres full-text search now; defer
pgvector until there is a populated library and evaluated semantic-search need.
That keeps initial schema/query work useful without choosing an embedding model
and dimensionality prematurely. This is a recommendation awaiting approval.

## 9. Mac tooling, local testing and remote link status

Observed locally, without installing or starting anything:

| Check | Result |
| --- | --- |
| Supabase CLI | Not on PATH; no repo-local CLI dependency/config found |
| Docker CLI | Installed: 28.3.3, context `desktop-linux` |
| Docker Desktop app | `/Applications/Docker.app` exists |
| Docker engine | Unreachable after retrying outside sandbox; engine is not currently running/reachable |
| Node / npm | 25.2.1 / 11.6.2 |
| pnpm | Not on PATH in the earlier scan-fixture check; repo declares pnpm 12.14.0 |
| Xcode / XcodeGen | 27.1 / 2.46.0 |
| Local Supabase config | No `supabase/config.toml` in scanner worktree |
| Repository link | No `supabase/.temp/project-ref` or alternate checked link marker in any listed worktree |
| Remote access | No CLI login/project access or remote schema contents verified; project reference/URL not supplied in this task |

No remote link is evident. A Supabase account existing in the browser would not
by itself link this worktree. Never print login tokens/service keys in diagnostics.

Recommend **local Supabase first**: Docker is already installed, and local reset/
pgTAP tests can prove a fresh migration and cross-user isolation before any remote
project changes. Later, a separate hosted test project makes real phone uploads
possible without keeping the Mac's local server reachable. Recommend separate test
and production projects so test resets/scans cannot affect real data. No paid
resource or remote project creation has been authorized by this recommendation.

For the later setup checkpoint, exact starting actions will be:

1. Open **Finder → Applications → Docker** (or launch Docker from Spotlight) and
   wait for Docker Desktop to show the engine running. Then `docker info` should
   succeed. No need to reinstall Docker based on current evidence.
2. Install/pin the Supabase CLI (Homebrew's `supabase/tap/supabase` or a pinned repo
   dev dependency), and restore the declared workspace package manager as needed.
3. In this worktree root, `supabase init`, then `supabase start`; inspect the local
   Studio URL printed by the CLI. These have **not** been run yet.
4. Create versioned SQL with `supabase migration new <name>`. Replay against a local
   fresh database and run `supabase test db` for pgTAP security checks. Do not use a
   remote reset as a substitute for a local test.
5. Link the intended hosted project only with the user's project reference and
   approved setup step; obtain separate explicit approval before applying remote
   migrations/config or deploying functions.

Reference: [CLI/local setup](https://supabase.com/docs/guides/local-development/cli/getting-started),
[database tests](https://supabase.com/docs/guides/local-development/testing/overview),
[environment separation](https://supabase.com/docs/guides/deployment/managing-environments).
Earlier table/bucket review checkpoints can use **local Studio**; requesting a
remote dashboard review before approving remote migrations would conflict with
the remote-approval rule.

## 10. Decisions to ask about next — not yet approved

After the user reviews this read-through, ask no more than five questions at once:

- Confirm the intended hosted test project/reference and eventual separate production project.
- Confirm House/design labels mapping to the normative projects/rooms/proposals/versions/roadmaps tables.
- Confirm first upload uses current v1 + native RoomPlan JSON + optional USDZ, with v2 deferred.
- Confirm email/password or choose another shared phone/web sign-in method.
- Confirm automatic upload after Save and handling of already saved local scans (recommend one explicit Upload saved scans action, then automatic upload for new saves).

Things to fix rather than ask the user to design: implement the missing upload/
retry/session boundary; preserve stored artifacts; make idempotent verified upload
completion; use proper RLS/parent ownership and server-only immutable writes; add
config examples/ignores and SQL/security tests; reconcile schema differences through
explicit adapters; keep the known floor-corner issue on the later converter checklist.

The next approved design must settle exact columns/constraints/indexes/bucket limits,
security policy matrix, auth configuration, upload protocol and staged checks.
Database tables, buckets, policies and publication changes belong in SQL migrations.
Platform Auth/provider settings also need versioned Supabase CLI configuration and
environment placeholders where supported; they are not ordinary application-table
rows. Record any hosted settings the CLI cannot reproduce in the setup runbook
rather than claiming SQL alone configures the entire hosted account/email system.
Then implement one checkpoint at a time, commit on the existing scanner branch,
and stop for the user's check. No pushes, merges or remote mutations without the
separate authorization already required by the task. The finished implementation
must add `agent_docs/SUPABASE.md` as the setup/table/bucket runbook.
