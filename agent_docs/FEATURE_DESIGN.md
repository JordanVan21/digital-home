# House — Feature Design Document

**Version:** 1.1  
**Date:** 2026-10-17  
**Related docs:** `PRD.md`, `FUNCTIONAL_SPEC.md`, `SYSTEM_ARCHITECTURE.md`, `CONTRACTS.md`

## 1. Purpose of this document
This document translates the product and functional requirements into concrete user-facing feature designs. It focuses on interaction model, major screens, state transitions, UI responsibilities, and implementation notes that frontend and full-stack coding agents can directly act on.

The intended product feel is:
- minimal and visually calm
- 3D-first rather than form-first
- fast and direct like an editor
- proposal-driven like a coding assistant
- understandable even when AI is involved

The main interaction metaphor is:

```text
Scan a real room
   ↓
Open it in a 3D editor
   ↓
Ask AI for a redesign
   ↓
Review a proposed diff
   ↓
Accept / reject
   ↓
Explore a cumulative-spending roadmap (with optional estimated dates)
```

---

## 2. Design principles

### 2.1 3D canvas is the primary workspace
The 3D scene is the product. Side panels and forms should support it, not dominate it.

Implications:
- full-window 3D canvas on desktop
- small collapsible overlays for controls
- avoid permanently heavy left/right sidebars
- direct object interaction should feel more important than menu navigation

### 2.2 Proposal, not silent mutation
AI should never silently overwrite the room. The user should feel like AI is proposing edits, similar to a code agent creating a patch.

Implications:
- redesign creates a `DesignProposal`
- preview before commit is mandatory
- accept/reject is explicit
- show what changed, not just the final room

### 2.3 Distinguish editor history from renovation time
Undo/redo is an editor concern. Timeline is a real-world budgeted roadmap.

Implications:
- undo/redo is hidden editor infrastructure with optional UI affordances
- timeline is a user-visible story about the future state of the room
- do not overload the slider with raw operation history

### 2.4 Retrieval-first > generation-first
For MVP, good catalog curation is more important than runtime asset generation.

Implications:
- asset picker and AI proposal use curated catalog assets
- object quality and consistency matter more than novelty
- Blender/runtime generation is optional future work

### 2.5 A recognizable room beats perfect furniture fidelity
The room shell matters most. Existing furniture can be approximate.

Implications:
- accurate walls, doors, windows, room footprint
- initial furniture may be category-based approximations
- no photo-dependent pipeline in MVP

---

## 3. Core screens and views

## 3.1 My Scans / Projects
**Purpose:** entry point after sign-in; lists rooms the user can open.

### Content
- project/room cards or list rows
- room name
- scan created date
- import status: processing / ready / failed
- preview thumbnail if available
- CTA: `Open`
- optional CTA: `Scan on iPhone` with instructions / account link

### Key actions
- open ready room
- retry failed import
- rename room/project
- create demo project from fixture if needed

### Notes
This view should remain simple. It is not the hero experience.

---

## 3.2 Main 3D workspace
This is the central screen.

### Layout
```text
┌───────────────────────────────────────────────────────────────┐
│ top bar: room name | saved state | style | preview | timeline │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                    Full-screen 3D canvas                      │
│                                                               │
│   [floating left tools]       [floating right inspector]      │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ bottom timeline / milestone scrubber                          │
└───────────────────────────────────────────────────────────────┘
```

### Required floating UI groups

#### A. Top bar
Minimal horizontal bar containing:
- project / room name
- current mode label: `Edit`, `Preview Proposal`, `Timeline`
- save status: `Saved`, `Saving…`, `Offline changes`
- buttons:
  - `Design`
  - `Preview` (when proposal exists)
  - `Timeline`
  - `Reset View`

#### B. Left tool cluster
Primary editor controls:
- select tool (default)
- move mode
- rotate mode
- add object
- delete selected
- lock / unlock selected
- undo / redo

Optional if time allows:
- focus selected
- duplicate selected
- camera preset buttons

#### C. Right inspector panel
Collapsible panel. Context-sensitive.

If nothing is selected:
- room metadata
- scene version info
- current lighting preset
- current proposal state if any

If object is selected:
- object title/category
- locked state
- asset source
- transform summary
- replace object button
- delete button
- maybe material override controls

If proposal mode is active:
- change summary grouped by Add / Remove / Replace / Move / Material
- proposal explanation
- estimated added cost
- warnings
- buttons: `Accept all`, `Reject`, `Regenerate`

### Canvas behavior
- orbit / pan / zoom
- click select
- gizmo or direct manipulation for move/rotate
- hover highlight optional
- object bounding outline or selected accent ring
- room shell visually calm and neutral
- furniture assets visually grounded with shadows and environment lighting

---

## 3.3 Design intake panel
Triggered by `Design`.

### Purpose
Collect enough structured information to build a `DesignBrief`.

### Inputs
- style tags (multi-select or chips)
  - examples: warm minimal, japandi, cozy modern, industrial, scandinavian
- palette preferences
- material preferences
- avoid tags
- priorities
  - more seating
  - less clutter
  - more storage
  - better desk setup
  - brighter room
- total spending cap and/or monthly spending limit
- optional monthly savings contribution, starting cash and start date for calendar projections
- free text note

### Output
A validated `DesignBrief` object.

### Interaction design notes
- should feel lightweight, not like a long onboarding flow
- ideally a sheet or modal panel over the 3D scene
- prefill defaults where possible
- show locked items that will be preserved
- inspiration-image uploads are required in MVP; original-room photo reconstruction is not

---

## 3.4 Proposal preview mode
This is one of the most important experiences.

### Goal
Make AI changes easy to understand before commit.

### Required elements
- clear label: `Proposal Preview`
- before/after toggle or overlay mode
- textual diff grouped by operation type
- cost estimate summary
- explanation of design intent
- `Accept all` / `Reject`

### Recommended visualization strategies
At least one of the following should exist:
1. **Before/after toggle**: quickly switch between base scene and proposed scene.
2. **Ghost overlay**: removed/moved objects shown semi-transparently.
3. **Color coding**:
   - green = added
   - red = removed
   - blue/orange = moved or replaced

### Proposal copy example
```text
AI proposes:
- Replace sofa with lower-profile cream sectional
- Add oak coffee table
- Remove black accent chair
- Move desk closer to window
- Add floor lamp and textured rug
```

### MVP behavior
- whole-proposal accept/reject only
- no per-item staging
- stale proposal clearly marked if base changed

---

## 3.5 Asset browser / replacement picker
**Purpose:** user manually adds or replaces an object from the catalog.

### Contents
- category filter
- style filters
- search
- card/grid list with thumbnail, title, size, style tags, price estimate
- preview on hover or quick placement preview if easy

### Behaviors
- selecting an asset opens placement flow or directly replaces selected object
- replacement preserves reasonable position and orientation when possible
- all additions/replacements still go through validation

### Importance
This feature allows manual correction and provides a fallback even if AI is imperfect.

---

## 3.6 Timeline / renovation roadmap view
The bottom timeline is persistent or quickly accessible from the workspace.

### Purpose
Show how the accepted target design is achieved over time given budget.

### Visible concepts
- cumulative spending milestones (optional date labels)
- cumulative spend
- period spend
- purchases introduced at each milestone
- 3D room state at each milestone

### Timeline controls
- horizontal scrubber / slider with milestone ticks
- previous / next milestone buttons
- selected milestone summary bubble/panel
- `Edit this milestone` button

### Timeline semantics
- timeline represents future implementation, not editing history
- dates may be absent entirely; calendar display may skip months with no purchases
- assets should stream/reuse efficiently between milestones

### Milestone detail panel
- optional projected date
- title (e.g. `Month 2 – seating upgrade`)
- list of purchases made this period
- period spend
- cumulative spend
- notes or deferred items if relevant

---

## 3.7 Milestone editing flow
Since direct in-timeline editing is flexible but history must stay consistent, the workflow should be:

```text
Open milestone
   ↓
Click “Edit this milestone”
   ↓
Fork working copy from milestone snapshot
   ↓
Open normal editor on that working copy
   ↓
Save as new version
   ↓
Optionally apply to roadmap later
```

This avoids accidental mutation of historical milestones.

---

## 4. Feature-by-feature interaction design

## 4.1 Scan import feature
### User story
As a user, I want to scan a room — or walk through my whole house — on iPhone and open it on desktop without manually rebuilding it.

### UX states
- uploading
- processing
- ready
- failed

### Edge behavior
- if import fails, show explicit retry/fallback
- if a detected object has no catalog match, show neutral proxy

---

## 4.2 Object editing feature
### User story
As a user, I want to move, rotate, delete, replace, and lock room objects fluidly.

### UX rules
- dragging should feel local and immediate
- save is asynchronous and secondary
- invalid drop should snap back or show rejection clearly
- locked objects visibly communicate their state

### Suggested lock visuals
- small lock badge near selection outline
- lock toggle in inspector
- disabled transform/delete controls when locked

---

## 4.3 AI redesign feature
### User story
As a user, I want AI to redesign the room based on my style and budget preferences without modifying locked items.

### UI stages
- `Preparing brief`
- `Planning layout`
- `Finding assets`
- `Validating proposal`
- `Ready`
- `Failed`

### Copy guidance
Avoid implying certainty or final purchase truth. Use phrasing like:
- `Estimated cost`
- `Suggested redesign`
- `Proposed changes`
- `Budget roadmap`

---

## 4.4 Proposal review feature
### User story
As a user, I want to understand what AI changed before I commit.

### Success criteria
A user should be able to answer:
- What was added?
- What was removed?
- What was replaced?
- What moved?
- How much more will this cost?
- Why is this a coherent design?

If the UI cannot answer these, the proposal mode is not successful.

---

## 4.5 Budget roadmap feature
### User story
As a user, I want to know which purchases matter most at each cumulative spending level, and optionally when they become affordable based on my explicit savings plan.

### UX rules
- milestone order must feel sensible, not arbitrary
- expensive items may be delayed until enough cash accumulates
- preserve old items until replacement becomes feasible
- if something is unaffordable, say so clearly

### Suggested copy patterns
- `Month 1: lighting + rug refresh`
- `Month 3: desk replacement`
- `Deferred: shelving exceeds current budget horizon`

---

## 5. Frontend state design

Use distinct state domains. Do not collapse everything into one store blob.

### 5.1 Scene/editor state
Persistent working scene and selected object state.

### 5.2 Ephemeral interaction state
Drag in progress, gizmo mode, hover, camera state, open panels.

### 5.3 Proposal state
Current proposal ID/status, preview snapshot, diff summary.

### 5.4 Timeline state
Loaded milestones, selected milestone, preloaded neighbor scenes.

### 5.5 Save/network state
Pending autosave, error state, stale revision, loading states.

### Recommended store layout
Zustand is a good fit. Keep render-loop-sensitive data separate from frequently changing UI state when necessary.

---

## 6. UI components list
Minimum component inventory:
- `AppShell`
- `TopBar`
- `SceneCanvas`
- `FloatingToolbar`
- `InspectorPanel`
- `DesignBriefModal`
- `ProposalReviewPanel`
- `AssetBrowser`
- `TimelineBar`
- `MilestoneDetailPanel`
- `SaveStatusIndicator`
- `ProposalProgressIndicator`
- `EmptyState / ErrorState`

3D-specific components:
- `RoomShellMesh`
- `SceneObjectMesh`
- `SelectionOutline`
- `TransformControlsWrapper`
- `CameraController`
- `MilestoneSceneLoader`

---

## 7. Visual style guidance
The visual design should feel like a polished creative tool.

### Recommended traits
- dark or neutral editor chrome around a high-quality scene
- clean typography
- restrained color palette
- soft rounded panels
- subtle translucency
- minimal but informative iconography

### Avoid
- cluttered dashboard feel
- excessive persistent panels
- large card-heavy layout
- bright, noisy accent colors
- making the UI more visually dominant than the room itself

---

## 8. Keyboard / productivity behavior
Desktop-first means keyboard support matters.

Suggested shortcuts:
- `V` = select
- `G` = move (optional, if desired)
- `R` = rotate
- `Delete` / `Backspace` = delete selected
- `Cmd/Ctrl + Z` = undo
- `Shift + Cmd/Ctrl + Z` = redo
- `Esc` = deselect / close modal
- `L` = toggle lock for selected if allowed

Only implement shortcuts that clearly improve flow and do not create confusion.

---

## 9. MVP simplifications
The following are intentionally acceptable simplifications:
- one design proposal at a time
- no side-by-side branch comparison
- no collaborative editing
- no mobile editor
- no direct vendor checkout integration
- no partial proposal acceptance
- image-based inspiration is supported, but no image-based room reconstruction
- no room shell editing
- no mandatory runtime asset generation

---

## 10. Future design directions
These are intentionally compatible with current architecture:
- git-like version graph view
- proposal history
- per-change staging and selective accept
- branch compare / merge
- style image inspiration upload
- multi-room projects
- real product marketplace integration
- collaboration and shared room review
- generated custom assets when catalog retrieval fails

---

## 11. Implementation priorities for coding agents
1. Build the 3D workspace shell and room renderer.
2. Implement selection, movement, rotation, locking, autosave.
3. Add design intake modal and proposal preview mode.
4. Add asset browser and manual replace/add flows.
5. Add roadmap/timeline playback.
6. Add milestone fork/edit workflow.

The product is successful when the editor and proposal review feel coherent and trustworthy. Visual polish matters, but clarity of state and predictable semantics matter more.


## 12. Revised experience design — merged MVP decisions
**This section overrides contradictory earlier intake wording.**

### Design panel: two ways to describe a style
Create tabs/sections inside the existing Design modal: (A) **Choose preferences** (styles, colors, materials, priorities, free text) and (B) **Add inspiration** (one or more user-selected JPEG/PNG photos, removable thumbnails, upload status). Both may be provided in the same request. Show an optional `Interpreted Style` summary so users can correct surprising model assumptions. Image uploads affect the style brief only, never the scanned floor plan.

### Proposal review details
One proposal per generation request. Show a focused before/after toggle, item-level changes (Add, Delete, Move, Replace, Material), high-level rationale, approximate purchase subtotal, and Accept/Reject. Base scene remains unmodified in preview. If stale, disable Accept and offer regenerate against current version. Preserve one camera framing across toggle. Future: simultaneous multi-design gallery and selective staging.

### Furniture control and ownership decisions
Keep `Lock` in the editor inspector. Add a **renovation decision** control when planning a roadmap: Keep / Replace / Remove. A locked object cannot be changed by AI, regardless of renovation intent; surface this conflict rather than silently overriding. When replacing a physical sofa, create a new identity and purchase event; when swapping its display model merely to better approximate the same owned sofa, do not charge again.

### Milestone UI: spending and time
Bottom slider displays ordered cumulative stages with per-stage purchases, subtotal, cumulative total, and unfunded backlog. Label axis `Spending` if only budget caps are known. Optionally label axis with calendar months if the user confirmed savings contribution, starting amount, and start date. Never infer wages or savings from a spending ceiling. If target cannot be funded, show `Funded through $X` and `Still needed` separately.

### Component additions
- `InspirationImageUploader` (private asset upload, validation, progress, thumbnails)
- `InterpretedStyleSummary` (explicit vs inferred attributes)
- `OwnershipDecisionPicker`
- `BudgetCoverageStatus` (known/estimated/missing)
- `ProposalBeforeAfterToggle`

### User-facing copy
Prefer `Your design`, `Preview changes`, `Keep this`, `Replace this`, `Estimated purchase cost`, `Transformation stages`, `Projected month (assuming savings)`; do not expose `ScenePatch`, Git SHA, SQL table names or tool orchestration in consumer UI.

## 13. House scanning (2026-10-17)
**Change note.** Adds whole-house scans (PRD §12); single-room flows are unchanged.
- **iPhone:** start screen *Scan a room* / *Scan a house*. Between rooms: room count, name field (prefilled from detected type), *Scan next room*, *Finish house*; coaching to walk straight to the next room with the camera up and not lock the phone. Merge-failure sheet: retry merge, rescan last room, save rooms separately.
- **My Scans:** badge *Room* or *House · N rooms*; rooms listed under a house; import warnings visible. Opening a house opens Dollhouse view; opening a room opens it directly.
- **Workspace views for houses** (switcher overlay, animated transitions): *Dollhouse* (default; current level, walls facing the camera faded or cut), *Room focus* (pick from the room list or double-click a floor; other rooms dim and become non-interactive), *Floor plan* (top-down orthographic with room names, areas and furniture footprints), *Walk* (first person, through open doors and openings). A *level selector* appears only for multi-story houses.
- **Room list overlay:** name, type label, area, object count; click to focus; rename (stored on the scene, not the immutable structure).
- Single-room scans show none of the house controls (room list collapsed, no level selector).
