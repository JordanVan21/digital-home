# House — System Design / Architecture

**Version:** 1.1  
**Date:** 2026-10-17  
**Related docs:** `PRD.md`, `FUNCTIONAL_SPEC.md`, `FEATURE_DESIGN.md`, `CONTRACTS.md`

## 1. Purpose of this document
This document defines the end-to-end technical architecture for the House MVP. It explains system boundaries, component responsibilities, data flow, persistence model, queue usage, AI pipeline, security boundaries, and the recommended implementation plan.

This architecture is optimized for:
- a hackathon MVP
- desktop-first 3D editing
- low-latency interaction
- retrieval-heavy AI redesign
- clear version semantics
- minimal unnecessary infrastructure

The architecture is intentionally designed so the product can function **without Blender, without distributed GPU infrastructure, and without runtime 3D asset generation**.

---

## 2. Top-level architecture decisions

### 2.1 Canonical scene contract is the system center
The most important architectural decision is that every subsystem operates on the same schema-defined scene model.

That means:
- iPhone scan import produces normalized shell + approximate objects
- frontend renders and edits `SceneSpec`
- AI proposal operates on `SceneSpec`
- timeline milestones reference `SceneVersion`
- cost planner uses scene diffs and purchases, not raw 3D geometry

### 2.2 Room shell is immutable for MVP
Walls, doors, windows, and room footprint come from RoomPlan import and are not editable by users or AI.

### 2.3 Scene state is not a full-room GLB
The authoritative room state is structured JSON. Furniture assets may each reference independent GLBs. Floor/walls/openings may be generated procedurally in Three.js.

### 2.4 Direct editing path != queue path
User editing is local-first and persists directly using a validated save call.

Use queue/background jobs only for:
- scan processing
- proposal generation
- optional asset preprocessing
- roadmap generation if async

Do **not** put normal move/rotate edits onto a background queue.

### 2.5 Proposal workflow mirrors code-assistant patterns
AI creates a `DesignProposal` patch against a base version. Preview is computed without mutating the accepted version. Accept creates a new immutable `SceneVersion`.

### 2.6 Retrieval-first asset strategy
Approved catalog assets are the main runtime content source. Asset generation is an optional fallback capability, not core MVP infrastructure.

---

## 3. System components

## 3.1 iPhone scanner app / module
### Responsibilities
- sign in user
- check device support and permissions
- capture room using Apple RoomPlan
- export raw scan data and metadata
- upload through authenticated/signed flow
- show upload and processing state

### Outputs
- raw RoomPlan export
- capture metadata
- scan record creation/update

### Non-responsibilities
- no heavy 3D editing
- no AI redesign
- no catalog browsing

---

## 3.2 Scan import / normalization worker
### Responsibilities
- validate uploaded scan artifacts
- parse RoomPlan output
- normalize units, coordinates, shell geometry, openings, object classes
- create `RoomShell`
- create approximate initial `SceneSpec`
- map detected objects to plausible catalog assets where possible
- create fallback proxies for unmatched objects

### Why this exists
Raw RoomPlan data should not be used directly by independent frontend or AI code. One normalization pipeline reduces ambiguity and inconsistent coordinate handling.

---

## 3.3 Desktop web app
### Main stack
- React
- React Three Fiber
- Three.js
- Drei
- Zustand
- Supabase client for auth and approved data access

### Responsibilities
- render room shell and assets
- manage editor interactions
- local undo/redo
- autosave working scene
- collect design brief
- present proposal preview
- play timeline milestones
- fork milestone snapshots for editing

### Key performance rule
All continuous 3D interactions must remain local to the browser render loop. Network is secondary.

---

## 3.4 Trusted backend / edge layer
The MVP uses a persistent Node.js TypeScript trusted API server, with a separate Node TypeScript worker process (initially deployable to the same host).

### Responsibilities
- verify auth and ownership
- validate scene patch writes
- orchestrate proposal jobs
- call LLM / retrieval systems
- validate and commit proposals
- generate roadmap milestones
- provide signed storage URLs when needed

### Why needed even with Supabase
Client-side direct DB writes alone are insufficient for authoritative validation of AI proposals and constrained mutations. A trusted path should own validation and commit logic.

---

## 3.5 Catalog / asset library
### Contents
- curated GLBs
- thumbnails
- metadata / dimensions / tags / style descriptors
- cost estimates
- provenance and license review status

### Likely source
FurniMesh and/or self-authored assets, subject to license and redistribution review.

### Responsibilities
- supply approved assets to user edits and AI proposals
- support retrieval and reranking
- provide consistent, performant geometry for browser rendering

---

## 3.6 Design pipeline
The redesign flow is logically composed of five stages.

### Stage 1: DesignBrief construction
Questionnaire + room context -> structured `DesignBrief`

### Stage 2: Decision Maker
Scene + DesignBrief + locked objects + catalog affordances -> target room plan

### Stage 3: Asset retrieval + reranking
For each desired item category:
- hard filters
- top-K retrieval
- style/coherence/geometric reranking
- chosen asset IDs

### Stage 4: Placement validation
Check actual bounding boxes, room shell constraints, door clearances, overlap rules, lock constraints.

### Stage 5: Proposal packaging
Create `ScenePatch`, explanation, estimated added cost, validation report -> `DesignProposal`

This may be executed in one orchestration flow even if multiple internal models/helpers are used.

---

## 3.7 Roadmap / budget planner
### Inputs
- accepted target redesign
- original/accepted base room
- estimated prices
- total spending cap
- optional monthly savings contribution, starting cash and start date
- AI-derived priorities
- replacement dependencies

### Output
ordered purchases and cumulative spending milestones with optional projected dates referencing immutable scene snapshots

### Important rule
This is a scheduling/problem-solving module, not a rendering engine.
It should consume scene diffs / purchases rather than inspecting raw meshes.

---

## 4. Logical data flow

## 4.1 Scan import flow
```text
User scans room on iPhone
   ↓
Upload raw scan to storage
   ↓
Create scan record
   ↓
Import worker normalizes RoomPlan data
   ↓
Create RoomShell
   ↓
Approximate initial SceneSpec
   ↓
Room becomes visible in My Scans
```

## 4.2 Editing flow
```text
User manipulates object in browser
   ↓
Local 3D transform updates immediately
   ↓
Commit scene operation to local store on pointer-up
   ↓
Debounced saveScenePatch call
   ↓
Server validates + persists
   ↓
Scene revision increments
```

## 4.3 Redesign flow
```text
User submits design brief
   ↓
Create proposal job
   ↓
Design pipeline plans target room
   ↓
Retrieve and rerank catalog assets
   ↓
Validate placements and locked-item constraints
   ↓
Emit DesignProposal patch
   ↓
Frontend previews proposal
   ↓
Accept -> new immutable SceneVersion
Reject -> no scene mutation
```

## 4.4 Roadmap flow
```text
Accepted target redesign
   ↓
Compute purchasable diffs
   ↓
Assign priority and dependencies
   ↓
Schedule purchases using monthly budget + starting cash
   ↓
Materialize milestone SceneVersions
   ↓
Timeline playback in browser
```

---

## 5. Detailed component responsibilities

## 5.1 Frontend modules
### `scene-renderer`
- room shell mesh construction
- GLB loading and caching
- object instantiation
- selection visuals
- timeline scene switching

### `editor-tools`
- selection state
- move/rotate interactions
- object add/delete/replace
- lock toggle
- undo/redo stack

### `proposal-review`
- proposal load/polling
- diff summary
- before/after toggle
- accept/reject actions

### `timeline-ui`
- milestone scrubber
- current milestone state
- purchase summary
- edit milestone flow

### `asset-browser`
- catalog search/filtering
- replacement/add UX

### `data-client`
- auth session handling
- fetch/save functions
- typed API wrappers
- optimistic/pending state handling

---

## 5.2 Backend modules
### `scan-import`
- RoomPlan normalization
- shell/object creation
- import status tracking

### `scene-service`
- get current scene
- save validated scene patch
- create immutable scene version
- fork from milestone/version

### `proposal-service`
- construct design prompt/input
- call model(s)
- parse and validate output
- resolve asset IDs
- produce proposal
- mark stale/accepted/rejected

### `asset-service`
- approved asset metadata lookup
- top-K candidate retrieval
- style/coherence reranking
- signed URL generation

### `roadmap-service`
- derive purchases from redesign diff
- schedule milestones
- materialize milestone scene versions

---

## 6. Persistence model

## 6.1 Database tables (minimum)
Recommended Supabase/Postgres tables:
- `users` (implicit via auth)
- `projects`
- `rooms`
- `scans`
- `room_shells`
- `scenes` (mutable working scene)
- `scene_versions` (immutable accepted snapshots)
- `design_proposals`
- `roadmaps`
- `milestones`
- `assets`
- `purchases`

Optional if needed:
- `scan_jobs`
- `proposal_jobs`
- `asset_embeddings`
- `scene_operations` (durable log)

### Table intent summary
- `rooms` = user-level room container
- `room_shells` = immutable geometry extracted from scan
- `scenes` = latest editable mutable state
- `scene_versions` = immutable historical versions
- `design_proposals` = previewable AI patches
- `milestones` = time-indexed future roadmap states
- `assets` = library metadata and storage references

## 6.2 Storage buckets
Recommended storage groups:
- raw scan artifacts
- normalized derived artifacts if needed
- asset GLBs
- asset thumbnails
- room thumbnails / preview images

Use immutable storage keys or content hashes for assets where possible.

---

## 7. Security and access control

### Auth
- Supabase Auth for user identity
- JWT verified by trusted backend / edge path

### Authorization
- every room/project/scene/query scoped to owner
- signed URLs for private or controlled storage access
- no service role keys in client

### RLS
Use Row Level Security to enforce ownership. However, RLS is **not** the only integrity mechanism.

### Validation boundary
All authoritative scene changes should pass through validated write paths. Direct unrestricted client mutation of JSON scene blobs is not acceptable for proposal commit or lock-sensitive changes.

---

## 8. Queue and background job strategy

## 8.1 What should be async jobs
Good job candidates:
- scan normalization
- proposal generation
- roadmap generation if it becomes slow
- heavy asset preprocessing

## 8.2 What should NOT be async jobs
Do not queue:
- object dragging
- ordinary move/rotate/delete UI interactions
- selection state
- camera movement

## 8.3 MVP queue implementation guidance
For hackathon scope, a simple job abstraction is enough:
- one app/server process
- async worker tasks / simple queue table
- maybe a few concurrent workers

Do not build distributed infrastructure unless it becomes necessary.

---

## 9. Performance strategy

## 9.1 Rendering
Targets:
- smooth interaction in curated demo room
- 60 FPS target during common manipulation on demo laptop

Strategies:
- cache GLBs by asset ID
- keep object count and polygon count reasonable
- prefer moderate high-quality assets over many heavy ones
- use compressed textures where possible
- keep shadow/light configuration controlled
- avoid excessive React rerenders during manipulation

## 9.2 Networking
- debounce saves
- prefetch adjacent timeline milestone assets
- use signed URL caching carefully
- avoid re-downloading shared assets between milestones

## 9.3 Proposal latency
Keep redesign latency acceptable by:
- using structured inputs
- retrieval-heavy catalog selection
- limiting number of items to change
- avoiding runtime asset generation

---

## 10. AI system design details

## 10.1 Why separate planning from rendering
If AI is asked to "make the room Japandi" directly in 3D, the system becomes fragile. Instead, AI should decide semantic changes and let deterministic systems enforce geometry and asset selection.

### Good AI responsibilities
- interpret style
- prioritize changes
- propose layout intent
- select among candidate assets
- explain rationale

### Non-AI responsibilities
- final validation
- collision/clearance rules
- lock enforcement
- persistence
- scene commit semantics

## 10.2 Retrieval and ranking model
Suggested multi-step strategy:
1. filter by category
2. filter by dimensional fit
3. filter by approved provenance/license state
4. retrieve top-K by tags/description/embedding similarity
5. rerank by:
   - aesthetic fit
   - compatibility with rest of design set
   - geometric fit
   - budget alignment

## 10.3 Failure handling
If proposal generation fails:
- preserve original room
- expose readable error
- allow retry/regenerate
- optionally fall back to a simpler deterministic asset-selection strategy

---

## 11. Recommended technology choices
These are suggestions, not absolute requirements.

### Frontend
- React
- React Three Fiber
- Three.js
- Drei
- Zustand
- TypeScript

### Backend
- Supabase Auth
- Supabase Postgres
- Supabase Storage
- a persistent Node.js TypeScript API and worker (Supabase remains Auth/Postgres/Storage)

### AI orchestration
- typed JSON outputs
- schema validation with Zod
- deterministic post-processing/validation

### Search / retrieval
- Postgres metadata filtering
- optional pgvector for embeddings

### iOS
- Swift
- RoomPlan
- authenticated upload flow

---

## 12. Observability and debugging
Minimum useful telemetry/logging:
- scan import success/failure counts
- scene save success/failure
- proposal generation duration/status
- proposal validation failures
- asset retrieval cache hit rate
- milestone generation success/failure
- frontend save conflict frequency
- GLB load errors

A strong hackathon demo still benefits from good logs because integration failures are likely.

---

## 13. Implementation roadmap

### Phase 0 — contracts and fixtures
- freeze `SceneSpec`, `AssetSpec`, `ScenePatch`, `DesignProposal`
- create sample room JSON and asset metadata fixtures

### Phase 1 — rendering and editing core
- desktop workspace shell
- room shell rendering
- object loading
- selection, move, rotate, lock, autosave

### Phase 2 — import pipeline
- iPhone scanner upload
- scan normalization worker
- My Scans list

### Phase 3 — asset library
- curate approved GLBs
- normalize assets
- load catalog into DB/storage
- search + replacement UI

### Phase 4 — proposal pipeline
- design brief UI
- backend proposal service
- review/diff/accept/reject

### Phase 5 — roadmap timeline
- purchase derivation
- milestone scheduling
- timeline playback
- milestone fork/edit

### Phase 6 — polish and hardening
- fallbacks
- error states
- visual polish
- demo rehearsal

---

## 14. Architecture diagram (text form)
```text
 iPhone Scanner (Swift + RoomPlan)
          │
          │ raw scan upload
          ▼
    Scan Import / Normalization Worker
          │
          ├──────────────► RoomShell (immutable)
          │
          └──────────────► Initial SceneSpec (approximate)
                                │
                                ▼
                        Supabase / Backend
                   ┌────────────┼────────────┐
                   │            │            │
                   ▼            ▼            ▼
                Scenes      Assets       Proposals/Roadmaps
                   │            │            │
                   └──────┬─────┴─────┬──────┘
                          │           │
                          ▼           ▼
                 Desktop Web Editor   Design Pipeline
               (React + R3F + Zustand)│
                          │            ├─ Style / brief interpretation
                          │            ├─ Whole-room decision maker
                          │            ├─ Asset retrieval + reranking
                          │            ├─ Validation
                          │            └─ Proposal patch output
                          │
                          ├─ Local editing / autosave
                          ├─ Proposal preview / accept / reject
                          └─ Timeline playback / milestone fork
```

---

## 15. Final architectural summary
If implemented correctly, the House MVP behaves like a 3D editor with an AI design assistant layered on top, not like a static rendering pipeline.

The most important implementation truths are:
- the **scene schema is the contract**
- the **browser owns interaction latency**
- AI produces **proposals**, not direct mutations
- the timeline is a **budgeted future roadmap**, not undo history
- the asset library is a **retrieval system**, not an afterthought

If a coding agent follows those five rules, it will likely build components that integrate cleanly with the rest of the system.


## 16. Implementation decision record — TypeScript monorepo and agent system
This section is **normative** and supersedes optional backend language/framework suggestions above.

### Stack and package boundaries
```text
house/
  apps/web/             React + TS + Vite, R3F/Three/Drei, Zustand
  apps/api/             Node TS authenticated HTTP endpoints, validated writes
  apps/worker/          Node TS job runner, model calls and orchestrators
  apps/ios/             Swift RoomPlan capture/upload only
  packages/contracts/  Zod schemas, TS types, versioned fixtures
  packages/scene-engine/ pure TS operations, constraints, patch application (no React/Three)
  packages/agents/     style interpretation, planning, budgeting prompts/tools
  packages/asset-service/ metadata search, top-K retrieval/reranking
  packages/budget-engine/ purchase derivation, decimal money scheduling
  supabase/migrations/  SQL tables, RLS, storage policy, RPCs
  docs/                 this specification set
```
Use a workspace monorepo (pnpm is suitable). TypeScript is authoritative outside iOS. One canonical Zod source defines contracts; API clients and worker share types. The frontend visual renderer is an adapter and must never be used as the geometry authority on the server.

### AI architecture (explicit orchestrator, not an unrestricted swarm)
```text
createDesignProposal (trusted API; job record)
  -> worker loads authorized base snapshot and image/brief inputs
  -> StyleInterpreter (vision + questionnaire -> structured DesignBrief)
  -> DesignPlanner (AI -> SemanticDesignPlan for ONE design)
  -> AssetResolver (TS: eligibility filter, top-K search, aesthetic rerank)
  -> PlacementSolver (pure TS: candidate transforms + constraints)
  -> optional DesignCritic (AI, bounded one revision)
  -> build + validate ScenePatch (server authority)
  -> persist DesignProposal READY (not scene commit)
  -> client previews locally
  -> explicit acceptDesignProposal (CAS + atomic SceneVersion transaction)
```
The Budget Priority Planner is a separate AI step after proposal acceptance, followed by deterministic purchase ledger and milestone scheduler. Only **Style Interpreter, Design Planner, and Budget Priority Planner** are required model-driven specialists. The Critic is optional; search, validation, scheduling and scene manipulation should be conventional code. Use a TypeScript agent framework (OpenAI Agents SDK is the preferred starting point), but keep orchestration interfaces framework-neutral. Models can be swapped through adapters; no model-specific assumptions in `SceneSpec`.

### Agent tools and authority
- Read-only / candidate tools: `getRoomSummary`, `getSceneObjects`, `searchAssets`, `getAssetDetails`, `proposeSemanticLayout`, `validateCandidatePatch`. Tools return only authorized project data.
- Agent cannot call raw SQL, mutate Storage or update a live scene; cannot unlock furniture. Only a trusted backend method can commit a user-approved validated proposal.
- Frontend and worker import the same pure reducers (`applyMove`, `applyAdd`, `applyDelete`, `applyPhysicalReplacement`, `applyMaterial`, `validatePatch`), while the browser handles transient drag transforms imperatively in Three.js.
- Keep tool loops bounded, schema-validate every model return, allow targeted retries by stage, persist job progress/errors and input/output provenance. Async network/model requests may run concurrently; GPU/CPU distributed rendering is not a required runtime dependency.

### Inspiration image handling
MVP supports user-uploaded JPEG/PNG style references. Browser requests limited signed uploads; the API verifies object ownership, stores input refs, and the worker passes authorized images to a vision-capable model. Style output includes provenance and preferences reconciliation; do **not** replace RoomPlan geometry with image-estimated geometry. Room photo reconstruction remains out of scope.

### Budget and physical identity
Distinguish `locked` edit protection from renovation `Keep|Replace|Remove`. Maintain a physical-item lineage on replacements and a transactionally deduplicated purchase ledger; inherited owned assets incur no purchase cost. Preserve accepted dream version, adjusted target and funded partial milestone separately. Store price source/status; unknown values make estimates incomplete. Spending stages are always valid; calendar projections require explicit savings assumptions. Edits to base/target invalidate derived plan status rather than silently rewriting immutable snapshots.

### Server/worker deployment
- `apps/api` is a persistent HTTPS service on a simple managed Node host; Supabase supplies database, identity and asset storage.
- `apps/worker` may run as a process on the **same host** initially, with jobs claimed transactionally from Postgres and durable retry/idempotency keys. A single worker process can concurrently await several model/API calls without one CPU core per agent. Heavy CPU work can use worker threads/processes later.
- User pointer moves never enter the job table; autosave uses normal authenticated API + optimistic concurrency.
- Secrets for model access and Supabase service role exist only in server/worker environment. RLS plus explicit authorization apply even where workers use elevated credentials.

### Required integration smoke test
Given a fixture RoomShell, real GLB catalog items and one inspiration image: produce one validated proposal; preview without changing accepted version; reject preserves scene; accept creates exactly one immutable SceneVersion; budget planner uses owned inventory to generate cumulative priced milestones without double-counting; browser toggles milestones without reloading unchanged assets.
