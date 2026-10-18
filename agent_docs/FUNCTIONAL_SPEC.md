# House — Functional Specification

**Version:** 1.1 | **Date:** 2026-10-17 | **Cross-component types:** `CONTRACTS.md`

## 1. Scope and behavior model
Single-user app, one scanned space (a room or a whole house) at a time: iOS RoomPlan scan → authenticated sync → desktop 3D editing → AI design proposal → review and commit → budget roadmap and spending-stage playback (optional projected dates). All scene inputs/outputs conform to shared versioned schemas. MVP works entirely from pre-curated GLBs and can run without Blender or generated models.

## 2. Accounts, projects, scanning and import
- User signs in with Supabase Auth. `projects` contains owned `rooms`; each room references a scan and immutable shell.
- iOS scanner must check RoomPlan support/permissions and present explicit unsupported-device and camera-denied states. Use device with supported LiDAR/RoomPlan capability; do not assume every iPhone 13/14 variant works.
- Start/stop capture; preview completion; upload raw RoomPlan export and structured capture metadata using authenticated signed upload. Include file size limits, retries, checksums, progress/error and idempotent upload completion.
- Import worker parses accepted RoomPlan content, normalizes coordinate systems, meters, opening relationships, classes and dimensions, generates `RoomShell` and approximate scene objects with stable IDs. Flag unrecognized classes. Scan quality checks reject zero area, broken polygons, missing walls and corrupt content; allow remediation or demo fallback.
- For every observed classified furnishing: retrieve category/size-compatible catalog model; if unavailable, render a neutral procedural proxy labelled approximate. This is an approximation, not visual photogrammetry.
- Desktop `My Scans` lists only the authenticated user's rooms; loading a scan creates/retrieves a working SceneSpec.

## 3. Desktop editor behavior
**Camera:** orbit with pointer, zoom with scroll, pan via secondary/middle click or chosen modifier; `Reset View` frames room; camera cannot clip unpredictably into geometry. **Objects:** pointer select, visibly outline/highlight, transform modes Move/Rotate; optional Scale may be constrained or omitted to preserve real-world asset dimensions. Keyboard Delete, Esc deselect, Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo. Use accessible buttons/help labels.

**Lock:** object context toolbar lock/unlock. Locked object cannot be modified by UI gestures, agent or server-side patch. Only direct user intent unlocks; proposed agent changes cannot unlock.

**Interaction:** on pointer drag, update Three mesh imperatively for continuous feedback; on release, commit one `move` operation to Zustand, append undo inverse, schedule persistence. No database call per rendered frame. Separate ephemeral selection/camera/drag state from persisted scene state.

**Autosave:** debounce short editing bursts (~500 ms indicative). Serialize pending saves or use revision CAS and rebase; show Saving / Saved / Offline/Retry. Keep local modifications after transient failure. Reload restores latest committed scene. Reject stale updates; never silently overwrite newer state.

**Delete/replacement:** deletion of unlocked items permitted; catalog browser can add/replace; all placement goes through same validation. User may undo/redo within active session; operation history need not be part of renovation timeline.

## 4. Style capture and AI redesign
- Inputs: style selections, colors/materials, priorities, avoid tags, free-text notes, monthly budget, starting cash, start date, currently locked objects (derived from scene). Inspiration-image upload (JPEG/PNG) is supported alongside questionnaire inputs; room-reference photos are not required for scanning.
- Style Interpreter outputs validated `DesignBrief`; normalize synonyms and guard contradictory or empty preferences with defaults. Preserve user intent; do not silently drop locked items.
- Decision Maker receives room shell summary, scene objects including dimensions/locks, brief and catalog affordances. Plans **one cohesive final design**, including intended changes, relationships and desired asset properties, not unconstrained GLB geometry.
- Resolver first filters category/dimensions/license and then retrieves top-K using tags/description and optional embeddings; reranks for design style and global aesthetic coherence. Candidates must be actual catalog asset IDs. Each missing category uses fallback catalog/proxy or explicit failure; generation workers optional future extension.
- Placement phase checks real size against wall boundaries, opening clearances, object footprints and lock rules. Retry limited placement revisions or mark invalid with explanation. Never invent catalog IDs.
- Result is a `DesignProposal` with explanatory diff, expected total price and validated patch. Proposal may take time; frontend displays `planning`, `retrieving`, `validating`, `ready`, `failed` progress (implementation may map these to a simpler backend job status).

## 5. Review workflow / version semantics
- Proposal is isolated from accepted scene. Show preview in 3D using computed patched snapshot, side-by-side/toggle before-after, and change summary grouped Add/Remove/Replace/Move/Material.
- UI offers **Accept all** and **Reject all** for MVP. Optional reconsider/regenerate starts a distinct proposal based on latest accepted version.
- Accept is atomic and idempotent: requires current expected base, validates full patch server-side and creates immutable `SceneVersion` with parent accepted version ID. Working scene changes only after success; pending operation stack may be reset or checkpointed to avoid mixed base revisions.
- Reject marks proposal rejected and leaves accepted scene unchanged. Failure/expired/stale proposal is clearly indicated and cannot silently commit.
- Every accepted snapshot includes shared shell reference and independent asset IDs, not a composite full-room GLB.

## 6. Budgeted renovation roadmap
- Initial state is current accepted or imported original room, target state is accepted redesign; initial owned furnishings carry zero purchase price, newly added/replacement assets get estimated catalog costs.
- Deterministic scheduler orders purchase stages by AI-derived priority, total spending cap, item costs and dependencies. Only when monthly savings contribution, starting cash and start date are explicitly provided does it compute earliest feasible calendar months. Avoid buying replacement before feasible; preserve existing piece until replacement. Track unfunded items.
- Generate original baseline plus cumulative spending milestone snapshots with period and cumulative costs. Dates are nullable and populated only for explicit savings plans.
- Validate `cumulativeSpend <= totalSpendingCap` when a cap exists; for dated scenarios additionally validate available cumulative savings at each date. All money uses integer cents; unknown prices are not zero.
- If budget is zero or too low, show a feasible partial roadmap or explicitly unscheduled wishlist; no invented purchases.

## 7. Timeline behavior
- Bottom tick/zoom slider maps cumulative spending stages to entries for **that room and roadmap**; dates are optional labels when a savings schedule exists.
- Browser calculates scene diff and reuses unchanged meshes; load only newly referenced uncached GLBs. Prefetch adjacent milestones where memory allows. Crossfade/animate object appearances or transforms if simple, but correctness and speed first.
- Milestone title, optional projected date, purchases and period/cumulative spend update together. Slider is read-only playback by default.
- `Edit this milestone` forks snapshot into working editor; save creates a separate new version. Explicit action required to incorporate modified version into roadmap. No implicit edit propagation to all later milestones.

## 8. Asset library ingestion and usage
- Curate 100–200 diverse, coherent GLBs as a starting target (quality > count), potentially sourced from FurniMesh if permits checked; also self-created/pre-generated models. Include at least sofa, chair, bed, desk, table, lamp, rug, shelving, plant and decor categories relevant to demo room.
- Verify provenance and rights; don't distribute assets whose license/redistribution terms are unknown. Check for embedded external media and unsafe filenames.
- Normalize axes, meter scale, origin (floor contact), mesh hierarchy, texture paths, material consistency, bounding boxes; compute triangle and texture budgets; preview every candidate in actual R3F lighting; store thumbnail, dimensions, style tags, material tags, price estimate, immutable hash.
- Search outputs only approved assets. Reuse cached GLBs by immutable ID. Optionally use variants via material overrides without regenerating geometry.

## 9. Validation, edge conditions, error recovery
| Case | Expected behavior |
|---|---|
| Unsupported iPhone | Show hardware requirement, stop before scan. |
| Scanner upload interrupted | Retry same scan with idempotent completion; no duplicate project entries. |
| Scan invalid | Explain issue; no broken scene; retry or fixture fallback. |
| Asset GLB missing/corrupt | Show proxy and warning, do not crash canvas; block unrenderable AI proposal if essential. |
| Proposal attempts locked item edit | Reject invalid operation; replanning permitted. |
| Proposal blocks door | Placement rejects; alternate placement or failure message. |
| User edits during proposal | Base revision mismatch makes proposal stale; do not apply blindly. |
| DB write collision | 409; retain local unsaved work and offer reload/retry/rebase. |
| AI response invalid JSON | Schema validation, bounded retry, then visible error. |
| Cost unpriced | Clearly marked estimate gap; cannot automatically schedule as zero-price item. |
| Unaffordable target | Partial roadmap with deferred purchases. |
| High GLB load/memory | Low-quality proxy, capped cache and loading indicator. |

## 10. Acceptance test matrix
| Test | Preconditions | Expected result |
|---|---|---|
| F-01 Scan roundtrip | supported scanner and auth | Import yields recognizable room shell (or house structure) in My Scans. |
| F-02 Object edit | loaded scene | 3D moves instantly, autosaves one final transform, persists after reload. |
| F-03 Lock invariant | locked desk | UI and simulated AI delete/replace both denied. |
| F-04 Patch preview | valid proposal | After scene visible before commit; accepted DB version unchanged. |
| F-05 Reject | ready proposal | Current accepted version and working scene unchanged. |
| F-06 Accept | valid current base | One new immutable version, old snapshot still accessible. |
| F-07 Stale proposal | user edited base | Accept fails with typed conflict. |
| F-08 Asset caching | adjacent milestones sharing sofa | Sofa GLB is not fetched again unnecessarily. |
| F-09 Schedule | $500/month explicitly declared as savings, $1200 sofa | No dated sofa milestone before funds accrue; a spending cap alone creates no projected date. |
| F-10 Timeline semantics | 3 milestones | Slider changes cumulative purchase snapshots, not undo stack position. |
| F-11 Ownership | second account | Other user's room, scan and storage denied. |
| F-12 Catalog integration | approved GLB sample | Model correct scale/origin/lighting and selection. |

## 11. Implementation sequence
Phase A: contracts, fixtures, Supabase auth/storage/DB/RLS. Phase B: R3F scene renderer and local editor over fixtures. Phase C: iOS scan normalization and project uploads. Phase D: catalog ingestion/search. Phase E: validated design planner with proposal diff/commit. Phase F: budget scheduler/timeline. Phase G: polish, integration, failure handling, demo rehearsal. Parallel work permitted after shared contracts freeze.


## 12. Revised functional requirements — inspiration, proposal execution, and planning
**Applies above in case of conflict.**

### Aesthetic input acceptance
1. User can upload 1+ supported JPEG/PNG inspiration images to private Supabase Storage and remove them from the design request before submission; enforce file type, size, authorization and bounded image count via config.
2. Questionnaire-only, image-only, and combined submissions all generate exactly one `DesignBrief`. At least one meaningful style input is required. Images are style cues only, never replacement room dimensions.
3. Vision Style Interpreter returns palette/material/form/lighting/style tags with source IDs and uncertainty indicators. Explicit user choices and free-text corrections override inferred traits. Validate structured output; retry once or show recoverable failure.
4. Design Planner produces one cohesive `SemanticDesignPlan`. Catalog resolution and final geometric placement produce `ScenePatch`. User must explicitly accept/reject after actual 3D preview; no partial acceptance in MVP.

### Item intent and purchase semantics
- `locked` blocks modification; `renovationDecision` controls planning (Keep/Replace/Remove). These properties must not be collapsed into one boolean.
- Keep preserves the same physical item ID; replacing an item creates a **new** object ID with `replacesObjectId` referencing its predecessor. Merely changing the visual approximation of a currently owned item may keep the physical ID if no purchase occurs.
- A purchase ledger holds one event per newly purchased physical object, quantity, cents, price provenance and optional retail match. Old owned furniture is not repurchased. Unknown price stays null and flags an incomplete affordability determination.
- Persist `desiredTargetVersionId`, `adjustedTargetVersionId` (when differs), and `fundedStageVersionId`; when funding is insufficient show a distinct partial result plus unfunded backlog.
- Budget engine always supports ordered **cumulative spending** stages. Attach projected calendar dates only if starting cash, a real monthly savings contribution, and start date were explicitly provided. A spending cap is not savings.

### Shared edit/AI behavior
- Every completed user gesture emits one typed scene operation; React/Three handlers use a shared pure TypeScript reducer/validator. Agent tool calls use a backend wrapper around the same reducer/validator, on an isolated proposal clone.
- The backend validates locked items, asset authorization, immutable shell, bounds, collisions, stale base versions, IDs and price references before accepting a patch. An agent must never execute `setLock` or directly write scene rows.
- Save working edits through revision-CAS API with serialized debounce, not worker queue. Save status is acknowledged only for latest local edit revision. AI and scan work run as persisted jobs.

### Additional acceptance tests
| ID | Input/action | Expected result |
|---|---|---|
| F-13 | Inspiration image only | StyleInterpreter outputs valid provenance-aware DesignBrief and one proposal |
| F-14 | Questionnaire + contradictory image | Explicit questionnaire instructions prevail |
| F-15 | User marks owned desk Keep | Same physical object remains and costs zero throughout plan |
| F-16 | Replace owned sofa | New object ID, `replacesObjectId`, exactly one purchase event |
| F-17 | Unknown-priced asset | Incomplete cost flag; no automatic zero-dollar schedule |
| F-18 | Monthly spending cap, no savings data | Spending stages shown with no invented dates |
| F-19 | Insufficient budget | Funded partial stage and unfunded target remain separately accessible |
| F-20 | AI tries to unlock item | Tool input denied before proposal commit |

## 13. House scanning (2026-10-17)
**Change note.** Multi-room house scans are in scope alongside single rooms (PRD §12). Behavior added; earlier sections apply unless overridden here.
- **Scanner:** start screen offers *Scan a room* or *Scan a house*. House mode keeps one `ARSession` across rooms (`stop(pauseARSession: false)` between rooms), names each room (prefilled from the detected room type), and merges with `StructureBuilder` at the end. Every captured room is kept; a failed merge or lost tracking offers retry merge / rescan last room / save rooms as separate single-room scans — captured rooms are never lost.
- **Export & upload:** one scan = one room or one house; export schema `structurescan/1` (`kind: room | house`, per-room data plus merged structure), Apple raw JSON archives per room and for the structure; same signed, checksummed, idempotent upload; larger size limits for houses.
- **Import:** the import worker produces one immutable structure shell (levels, rooms with floor polygons and names, walls with the rooms on each side, openings with the rooms they connect) and one scene. Shared walls and doors seen from two rooms are deduplicated; objects are assigned to the room containing them; merge-failed houses import as disconnected rooms with a warning. Old single-room exports are upcast.
- **Desktop:** houses open in a dollhouse view with a room list, room focus, floor plan, walk mode (through doors/openings) and a level selector for multi-story houses; single-room scans show no house UI. Objects can be moved between rooms through doorways; on release the footprint must sit inside one room (else snap back); door clearance applies on both sides of interior doors.
- **Added tests:** F-21 house scan roundtrip (≥3 rooms, relative positions ±10 cm, shared walls once, interior doors connect rooms, rooms named); F-22 merge failure keeps rooms; F-23 move object between rooms through a doorway (room membership updates, undo restores); F-24 single-room scans unchanged.
