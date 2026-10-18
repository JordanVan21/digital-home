# House — Product Requirements Document (PRD)

**Version:** 1.1 (architecture baseline)  
**Date:** 2026-10-17  
**Status:** Agreed product direction; technical interfaces defined in `CONTRACTS.md`  
**Product:** AI-assisted, scan-to-3D home redesign and budgeted renovation roadmap for DubHacks 2026.

## 1. Executive summary
House lets a user scan a real room on a LiDAR-capable iPhone, view a recognizable approximation of it in a high-quality interactive desktop 3D editor, describe their desired aesthetic and renovation budget, and receive a coherent proposed redesign. The user previews a visually rendered before/after scene and a semantic change list, accepts or rejects the proposal, and explores a time-based renovation plan whose milestones introduce prioritized purchases as budget accumulates. The product combines a personal room model, AI interior design, a retrieval-first 3D asset library, editing controls, and purchase-cost planning in one minimal interface.

The product is **not** a photogrammetry/digital-twin system. Correct room footprint and opening placement are more important than exact visual reproduction of the original furniture. The scanner is the only mobile experience; the main application is desktop-browser-first.

## 2. Problem and product promise
Current design tools force users to recreate their rooms manually, present appealing but context-free designs, or fail to show the affordable sequence from existing room to finished design. House aims to make a redesigned room visibly *their room* and make the redesign actionable over time.

Promise: **Scan your room → see it in 3D → describe your style → review a tailored redesign → see how to build it over time.**

## 3. Users and jobs-to-be-done
Primary: renter, homeowner, or student who wants to visualize changes to an actual room without learning 3D modeling. Secondary: demo judges and users exploring multiple room styles.

- Import a recognizable room quickly without manually measuring every wall.
- Manipulate furniture fluidly in an appealing 3D editor.
- Generate a design that obeys room boundaries and honors locked belongings.
- Review exactly what AI intends to add, remove, replace, or move before committing.
- Understand a renovation roadmap constrained by a monthly furniture/decor budget.

## 4. MVP end-to-end journey
1. User authenticates and creates a project.
2. From iPhone scanner, captures a room using Apple RoomPlan; authenticated upload stores raw scan and normalized geometry.
3. Desktop **My Scans** lists completed scans. User opens one. Browser loads the canonical scene: structural room shell plus approximate furniture chosen from a pre-curated GLB library (or placeholders for unmatched objects).
4. User orbits/zooms, selects and edits objects, locks critical belongings, and autosaves the working scene.
5. User completes a style questionnaire and/or uploads inspiration images (JPEG/PNG, stored privately). Both input routes are supported in the MVP. They submit one redesign request.
6. Style Interpreter produces structured `DesignBrief`. Decision Maker proposes a cohesive whole-room plan. Asset resolver retrieves and reranks eligible GLBs. Deterministic placement checks and pricing complete the proposal. Any generation is optional, never a blocking MVP dependency.
7. User previews the proposed scene in the same 3D viewer and reviews a textual/visual diff. **Accept all** commits a new immutable version; **Reject** preserves the base scene. Per-change staging and merges are future work.
8. Accepted design produces budget-feasible cumulative spending milestones, optionally projected onto calendar dates when savings information is explicit.
9. User may open a milestone for editing, but edits create a **new working copy/version**, not an implicit mutation of historical/future milestones.

## 5. Functional product requirements
| ID | Requirement | Priority | Acceptance |
|---|---|---|---|
| P-01 | iOS RoomPlan scanning (one room **or a whole house**) and signed-in upload | P0 | Scan appears in same user's My Scans and opens in desktop viewer; a house scan opens as one navigable house. |
| P-02 | Accurate-enough immutable shell (room or house structure) | P0 | Dimensions, wall polygons, doors/windows retain scan geometry; in a house, rooms keep their relative positions (±10 cm), shared walls appear once and interior doors connect rooms; redesign cannot change the shell. |
| P-03 | Approximate initial furniture | P0 | Classified furniture appears near detected coordinates at plausible size, in the correct room of a house; unmatched types have explicit fallback. |
| P-04 | Desktop interactive 3D editor | P0 | Orbit/pan/zoom, select, move, rotate; smooth local manipulation, no round trip per frame. |
| P-05 | Locked objects | P0 | UI toggles lock; all human/AI mutation APIs reject disallowed updates. |
| P-06 | Autosave and undo/redo | P0 | Debounced persistence; local reversible operation history; errors visible. |
| P-07 | Structured style questionnaire | P0 | Produces validated DesignBrief from fixed inputs + free text. Questionnaire and inspiration-image inputs are both P0; a vision-capable Style Interpreter normalizes either/both to a DesignBrief. |
| P-08 | AI room redesign | P0 | Exactly one coherent proposal per run; validated, grounded in catalog objects and limits. |
| P-09 | Curated asset retrieval | P0 | Asset records include source, license review, categories, dimensions, GLB URI, style tags, preview and cost. |
| P-10 | Preview & accept/reject | P0 | No accepted scene changes until accept; reject keeps previous saved scene intact. |
| P-11 | Budget milestones | P0 | Cumulative spending stages respect funding caps; optional dated schedule requires explicit monthly savings assumptions. |
| P-12 | Timeline scene playback | P0 | Slider loads milestone-specific scene snapshots and reuses cached assets. |
| P-13 | Shareable polished demo | P1 | Stable desktop performance on target laptop; fixed demo scan and robust fallback design. |
| P-14 | Style-fit top-K ranking | P1 | Filter by dimensions/category before style+coherence ranking; include traceable scores/rationale. |
| P-15 | Milestone edit / fork | P1 | Editing opens working copy; explicit save creates new version. |
| P-16 | Version branching and merge | Future | Data model allows parent versions; merge algorithms excluded. |
| P-17 | Runtime Blender and neural 3D generation | Future | Can plug into asset resolver interface; not necessary to demo. |
| P-18 | Image-based item reconstruction | Future | Optional photos, no dependency in initial onboarding. |

## 6. Design and visual requirements
- Full-window high-quality R3F/Three.js 3D canvas; minimal translucent/collapsible overlay controls instead of heavy permanent sidebars.
- Primary actions are Scan selection, Design, Edit, Lock, Preview Diff, Accept/Reject and Timeline.
- Bottom timeline uses sparse cumulative-spend ticks, or dated ticks when explicitly funded; never map the editor undo stack onto the timeline.
- Scene keeps an intentionally consistent visual language: PBR materials, predictable lighting, shadows, environment, camera presets, realistic scale, asset quality controls.
- Preview should be comparable to coding tool proposals: additions/removals/replacements/movements listed clearly, coupled to before/after 3D highlighting or toggle.
- Responsive to laptop screen sizes; no mobile editor requirement. iPhone UI only supports scan and upload status.

## 7. Non-functional requirements and measurable targets
Targets are provisional and must be validated on the actual demo laptop/network:
- Already-loaded object movement feels immediate; aim for 60 FPS (~16.7 ms total frame budget) during manipulation of the curated demo room.
- No interactive edit waits for AI, queue, or database; edited transform is committed locally immediately and persisted on a debounce (~500 ms after end-of-gesture/change).
- Common library-backed redesigns should feel fast; target <30 seconds for an ordinary proposal on a healthy external AI service, with progress indication and a repeatable fallback.
- Scene switching reuses shared assets; prefetch adjacent milestone assets where reasonable.
- All project rows scoped by authenticated owner via Supabase RLS; uploads constrained and validated; private raw room scans.
- Stable IDs, explicit units/axes, schema versions, strict tool validation, idempotent mutation calls, atomic proposal commit, bounded retries, basic logs and metrics.
- Handle import failures, missing asset URIs, offline/degraded network and save conflicts without discarding local changes silently.

## 8. Scope boundaries / assumptions
**In scope:** single-room scans and multi-room house scans (RoomPlan MultiRoom, iOS 17; one story is the P0 target, multiple stories supported where scanned), approximate existing belongings, furniture/decor edits, retrieval-heavy one-proposal AI redesign, catalog-based price estimates, purchase-time roadmap, scene diff, basic undo/redo, sign-in and project/scan listing.

**Out of scope MVP:** wall/door/window remodeling; exact photorealistic digital twins; real manufacturer product guarantees, precise market pricing, labor/construction budgets, mobile editing, collaboration, multiple initial alternatives, partial AI diff acceptance, git-style merge, GPU cluster or obligatory Blender, dynamic public scraping of FurniMesh at redesign time.

**Asset provenance:** FurniMesh is a proposed primary sourcing candidate. Confirm actual export compatibility, individual asset licenses, distribution/hosting permissions, attribution and commercial terms before placing assets into shared Supabase storage. Do not assume all models are redistribution-safe. Alternative sources or self-authored GLBs are allowed.

## 9. Metrics and launch gate
Demo is successful if a signed-in user completes: scan/upload (a room or a house) → desktop open → camera navigation and one object edit → lock → submit aesthetic → view AI diff → accept → view 3+ budget milestones, without hand-edited database records.

Observe: scan import success, first load time, median local edit FPS, AI proposal completion/validation rate, cache hit rate, user-visible save failures, milestone schedule feasibility. Demo assets and fallback proposals must be ready before presentation.

## 10. Decisions and remaining risks
**Decided:** desktop-only editor; iPhone scanner only; RoomPlan shell immutable; room reference photos not needed for scanning; aesthetic inspiration-image uploads required; initial furniture approximation acceptable; one AI proposal; whole-proposal review; curated GLB retrieval first; furniture/decor budget only; monthly AI-prioritized milestones; isolated undo and timeline; no collaboration.

**Risks:** RoomPlan captures may omit/misclassify geometry; catalog assets may not match footprint/style; GLB files may be oversized or incompatible; licensed redistribution may be restricted; prompt output may be inconsistent; highly constrained budgets may defer some purchases indefinitely. Mitigate through fixtures, catalog normalization, strict validation, fallback assets, budget feasibility warnings and safe preview states.

## 11. Further documents
- `FUNCTIONAL_SPEC.md`: detailed behavior and acceptance test conditions.
- `FEATURE_DESIGN.md`: UX interactions and information architecture.
- `SYSTEM_ARCHITECTURE.md`: deployment, systems, algorithms and implementation modules.
- `CONTRACTS.md`: shared data contracts, operations, API and invariants; authoritative for agent implementations.


## 11. Merged scope decisions (2026-10-17)
These decisions override conflicting legacy language above. **Primary pitch:** "Redesign your real room with AI, then see how to bring that vision to life over time." The core sequence is RoomPlan scan → desktop sandbox → questionnaire and/or inspiration-image aesthetic capture → **one** AI redesign proposal → 3D diff and accept/reject → ownership-aware budget milestones. Multiple simultaneously generated alternative designs are future scope. A user can regenerate one proposal later; accepted versions remain accessible.

### Required aesthetic inputs
- Both guided questionnaire and private inspiration-image upload are supported in MVP. User may use either or combine them. Do not make original-room photographic reconstruction a dependency.
- Image interpretation extracts style, palette, materials, shape language, lighting mood, avoidance cues and focal objects; it **does not** copy photograph geometry into the RoomPlan shell.
- In conflicts, explicit questionnaire/free-text instructions override inferred image characteristics. Store source/provenance and allow user review of interpreted style.

### Ownership and budget clarity
- User can mark existing items Keep / Replace / Remove for planning, separate from `locked` edit protection. Replaced physical belongings get new instance IDs, preserving `replacesObjectId` linkage; retained belongings cost $0 in the purchase ledger.
- Store desired accepted target, adjusted target (after retention/substitution decisions), and funded final milestone separately. A partially funded scene must never be labeled as the completed dream design.
- Show cumulative spending milestones independent of dates. When the user explicitly provides a starting balance, monthly **savings contribution**, and start date, optionally assign estimated calendar months; a monthly **spending limit** alone does not imply saved cash. Display unknown prices as incomplete estimates, never zero.

### Fixed engineering direction
- TypeScript across web, shared domain engine, backend API, AI worker/orchestration, retrieval, and budget scheduler; Swift solely for iOS RoomPlan.
- Desktop React + TypeScript + R3F + Drei + Three.js + Zustand. Supabase Auth, Postgres, Storage. Persistent Node.js TypeScript server/worker for model calls and trusted writes; model/provider credentials remain server-side.
- AI reasoning specialists: Style Interpreter, Design Planner, Budget Priority Planner; Design Critic optional. Deterministic services: asset resolver, spatial solver/validator, budget arithmetic, and commit. Prefer explicit pipeline orchestration instead of autonomous agents exchanging unrestricted tool calls.
- Core scene operations live in a **pure TypeScript shared package without React/Three imports**, used by user edits and backend proposal validation. Agents invoke typed safe adapters and cannot directly write DB scene blobs or unlock objects.

### Additional P0 acceptance gates
- User can submit a PNG/JPEG inspiration picture and receive an interpreted DesignBrief that influences an actual catalog-grounded proposal; also works with questionnaire only or both combined.
- A proposed AI patch is previewable without mutating the accepted scene; accepting performs server-side validation and an atomic versioned commit.
- Purchase ledger distinguishes retained, newly purchased and physically replaced items and exposes per-item price provenance and funding shortfalls.

## 12. House scanning (2026-10-17)
**Change note.** Reverses the earlier exclusion of "complete-house scan merging". A user can scan **one room** (unchanged) **or a whole house** on the iPhone: rooms captured in one continuous RoomPlan session are merged on device (`StructureBuilder`) and open on desktop as one navigable, editable 3D house with rooms in their relative positions, shared walls, interior doors, room names and (where scanned) multiple stories. Edits made: §5 P-01/P-02/P-03 wording, §8 scope (in scope / out of scope), §9 launch gate wording. Redesign, budget and timeline behavior for houses is **not** changed yet; open questions are recorded in `HOUSE_SCAN_NOTES.md`. Still out of scope: editing on iPhone, room photo reconstruction.
