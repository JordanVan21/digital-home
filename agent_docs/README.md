# House — DubHacks 2026: Single Source of Truth

**Revision:** 1.1 · 2026-10-17

Read in order: `PRD.md` → `FEATURE_DESIGN.md` → `FUNCTIONAL_SPEC.md` → `SYSTEM_ARCHITECTURE.md` → `CONTRACTS.md`. All five are normative; `CONTRACTS.md` owns cross-module schemas and invariants. Later **Revised/Merged/Implementation decision** sections in each document override older text where noted. Coding agents must NOT revive features from the earlier teammate PDF that are explicitly deferred here.

## Product in one sentence
Redesign your real room with AI, then see how to bring that vision to life over time.

## Settled implementation
- iOS Swift + RoomPlan is the scan capture surface; desktop is React/TypeScript + R3F/Three.js/Drei + Zustand.
- Node.js/TypeScript API and durable worker handle auth-checked writes, structured agent orchestration, validation, and background jobs. Supabase provides Auth, Postgres, Storage.
- Shared pure TypeScript scene operations define both user and AI mutations; browser-only continuous drag uses Three.js, committed user edits autosave through authenticated API.
- Style input includes **questionnaire and private inspiration image uploads**, separately or together; image analysis informs style only, never structural room geometry.
- One AI redesign proposal per request, preview + accept/reject; no direct AI scene writes.
- Asset retrieval uses curated, licensed GLBs (FurniMesh candidate + pre-authored assets); runtime Blender generation is not required.
- Budget stages track real purchased furniture/decor, owned item Keep/Replace/Remove, price provenance and unfunded gaps. Show optional calendar projection only from explicit savings assumptions.
- Undo/redo is editor history, not the spending milestone timeline. Immutable accepted scene versions support future Git-like branches.

## Agent stages
Required model-driven: Style Interpreter, Design Planner, Budget Priority Planner. Optional: Critic. Ordinary deterministic code handles catalog retrieval/filtering, geometric placement/validation, persistence, budget arithmetic and snapshot construction. Orchestrator uses typed ports, bounded retries, persisted job status.

## Build order
1. Contracts + fixtures + basic DB/RLS
2. Shared pure scene engine + browser renderer/editing
3. Catalog ingestion and RoomPlan importer
4. Authenticated API + autosave/versioned proposal persistence
5. Image and questionnaire style capture + agent proposal pipeline
6. Review/accept workflow + owned-item budget ledger + timeline
7. Integration tests, fallback fixtures, performance and demo rehearsal

## Non-goals for hackathon
Photo-based room reconstruction, three-way design comparison, structural remodeling, multiplayer editing, full Git merge, mandatory Blender/GPU runtime generation, live retailer checkout, labor/construction estimation.

## Scanner implementation handoff (2026-10-18)

- `SCANNER_STATUS.md`: implementation history, builds/tests and accepted phone checkpoints.
- `PHONE_SCANNER_BACKLOG.md`: deferred phone work and the next Supabase/Storage/end-to-end milestone.
- `SCAN_FORMAT.md`: approved future version 2 target; current phone/importer still use version 1.
- `SUPABASE_PLAN.md`: backend read-through, branch/schema examples, upload artifacts and
  local tooling findings; design and implementation approval still pending.

The user prioritized the single-room database/render connection after accepting
phone capture, preview, durable saving and the scan list. Whole-house scanning and
remaining phone management/diagnostic features are deferred; shared contracts above
remain authoritative.
