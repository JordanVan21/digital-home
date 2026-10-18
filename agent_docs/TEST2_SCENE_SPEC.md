# test2 scene spec

Source: `assets/test2.png` (1586 × 992). It's an AI-rendered, tilt-shift-styled cut-away of a warm-minimal living room at golden hour. This spec is the target for `packages/contracts/fixtures/test2-room.json`.

**Scale cues used:** sofa seat height ≈ 0.45 m and depth ≈ 0.95 m; glass door ≈ 2.3 m tall; sideboard ≈ 0.75 m tall; coffee-table height ≈ 0.38 m; rug ≈ 3.2 m long. Estimates are ±15%.

## 1. Room frame (defined for this spec)
- Rectangle, **5.4 m (X) × 4.8 m (Z)**, origin at the floor center, Y up, meters. Corners in the image: **F** (far, top), **L** (left), **R** (right), **N** (near, off-screen bottom).
- **North wall** z = −2.4 (F→R, image top-right): sideboard, art, lanterns, bookshelf.
- **West wall** x = −2.7 (F→L, image top-left): glazed sliding door.
- **South wall** z = +2.4 (L→N, image bottom-left): cut low, with a doorway near L.
- **East wall** x = +2.7 (R→N, image bottom-right): cut low, with a long dark-framed window.
- **Ceiling height** 2.7 m (not visible; inferred). **Walls** are thick (~0.2 m) with flat white caps, a "dollhouse" cut-away: the far walls are full height, the two near walls are shown low.

## 2. Shell
| Element | Wall | Position | Size | Notes |
|---|---|---|---|---|
| Glazed sliding door | West | z −1.35 → +1.15 (offset 1.05 from F) | 2.5 W × 2.3 H, sill 0 | 3 glass panels, slim **black metal frames** and a black corner post at the F end; deep reveal from the thick wall. Golden light pours through. |
| Doorway (no door) | South | x −2.2 → −1.3 | 0.9 W × 2.1 H | Partly hidden by the cut-away pier; inferred. |
| Window | East | z +1.9 → −0.6 | 2.5 W × 1.4 H, sill 0.9 | Shown as a black top rail on the cut wall; inferred as a dark-framed window. |
| Floor | — | — | — | Light honey-oak wide planks, satin. |
| Walls | — | — | — | Warm white plaster (#efe6da) with slightly brighter caps (#f6f0e7). No skirting or crown visible. |
| Built-ins | — | — | — | Thick pier at the L end of the west wall and at the R corner (wall ends). No beams visible. |

## 3. Object inventory
Positions are footprint centers (x, z) in the room frame. "Yaw" means the direction the front faces: 0° = +Z (toward the south/near-left wall); −90° = −X.

| id | category | name / look | W × D × H (m) | x, z | yaw | support | material / color | kind |
|---|---|---|---|---|---|---|---|---|
| sofa | sofa | modern 3-seat, 2 big seat cushions, square arms | 2.30 × 0.95 × 0.80 | −0.25, −0.40 | 0° | floor (on rug edge) | cream bouclé/linen #ece4d6, dark legs | large furniture |
| pillow-rust | pillow | square pillow | 0.45 × 0.15 × 0.45 | −0.95, −0.60 | 0° | sofa seat | terracotta #b4643a | soft |
| pillow-beige-1 | pillow | square pillow | 0.45 × 0.15 × 0.45 | 0.35, −0.60 | −15° | sofa seat | sand #d8c4a6 | soft |
| pillow-beige-2 | pillow | square pillow | 0.45 × 0.15 × 0.45 | 0.68, −0.62 | 10° | sofa seat | oat #e2d3bc | soft |
| throw | throw | folded knit throw over the right seat | 0.60 × 0.45 × 0.05 | 0.45, −0.25 | 15° | sofa seat | cream knit #efe7da | soft |
| rug | rug | woven jute, darker border | 3.20 × 2.30 × 0.012 | −0.30, 0.55 | 0° | floor | jute #b08a5c | flat |
| coffee-table | coffee_table | round travertine top, 4 chunky round legs | Ø0.90 × 0.38 | −0.85, 0.80 | 0° | rug → floor | travertine #d8c9b0 | large furniture |
| ct-plant | plant | small olive sprig in white pot | 0.25 × 0.25 × 0.35 | −1.00, 0.75 | 0° | coffee table | white ceramic, sage | plant |
| ct-book-1 | book | hardcover lying flat | 0.24 × 0.17 × 0.03 | −0.62, 0.92 | 20° | coffee table | sand cover | small decor |
| ct-book-2 | book | hardcover on book 1 | 0.22 × 0.15 × 0.03 | −0.62, 0.92 | 28° | ct-book-1 | dark taupe | small decor |
| ct-bowl | bowl | small ceramic dish | Ø0.14 × 0.05 | −0.62, 0.92 | 0° | ct-book-2 | warm grey stoneware | small decor |
| armchair | armchair | round bouclé barrel chair | 0.85 × 0.80 × 0.75 | 0.55, 1.65 | −125° | rug → floor | cream bouclé #efe8dd | large furniture |
| arc-lamp | floor_lamp | arc lamp, black base, white dome shade | 0.40 × 1.10 × 1.90 | −1.65, −1.05 | 35° | floor | black metal, opal shade (lit) | light fixture |
| tree | plant | potted olive/ficus tree, stone planter | 0.70 × 0.70 × 1.60 | −2.15, −1.90 | 0° | floor | stone planter, green | plant |
| door-plant | plant | potted shrub, white pot | 0.55 × 0.55 × 0.85 | −2.35, 1.65 | 0° | floor | white pot | plant |
| sideboard | cabinet | oak 4-door credenza, slim legs | 2.10 × 0.48 × 0.75 | −0.55, −2.13 | 0° | floor | honey oak #b9844f | large furniture |
| art | wall_art | abstract circles print, oak frame, portrait | 0.60 × 0.04 × 0.78 | −0.85, −2.38 (bottom at y 0.85) | 0° | north wall | beige/terracotta print | small decor |
| sb-vase-1 | vase | tall bottle vase | 0.12 × 0.12 × 0.30 | −1.45, −2.15 | 0° | sideboard | terracotta | small decor |
| sb-vase-2 | vase | round vase | 0.16 × 0.16 × 0.22 | −1.30, −2.10 | 0° | sideboard | clay | small decor |
| sb-vase-3 | vase | small bud vase | 0.10 × 0.10 × 0.18 | −1.18, −2.18 | 0° | sideboard | sand | small decor |
| sb-book-1 / -2 | book | two books lying flat | 0.26 × 0.19 × 0.03 | −0.35, −2.12 | 5° | sideboard / sb-book-1 | white, beige | small decor |
| sb-tray | tray | small wooden tray with a book | 0.25 × 0.15 × 0.04 | 0.05, −2.10 | 10° | sideboard | walnut | small decor |
| sb-plant | plant | leafy potted plant | 0.30 × 0.30 × 0.45 | 0.35, −2.12 | 0° | sideboard | grey pot, green | plant |
| lantern-tall | lamp | glass cylinder lantern (lit) | Ø0.22 × 0.55 | 1.05, −2.15 | 0° | floor | clear glass, oak cap | light fixture |
| lantern-small | lamp | glowing orb lantern (lit) | Ø0.20 × 0.24 | 1.10, −1.80 | 0° | floor | frosted glass | light fixture |
| bookshelf | shelf | open oak shelving, black metal frame, 5 boards | 1.00 × 0.35 × 1.90 | 2.05, −2.20 | 0° | floor | oak boards, black frame | large furniture |
| shelf books, plants, bowls | book / plant / bowl | upright rows, flat stacks, 3 small pots, 1 bowl | various | on boards 1–4 | 0° | bookshelf boards | mixed neutrals | small decor |

Not reproduced (out of scope): exterior terraces, planters and trees outside the room; the tilt-shift blur.

## 4. Stacking graph
```
floor ─┬─ rug (flat) ─┬─ coffee-table ─┬─ ct-plant
       │              │                └─ ct-book-1 ── ct-book-2 ── ct-bowl
       │              └─ armchair (front legs on rug)
       ├─ sofa ─┬─ pillow-rust, pillow-beige-1, pillow-beige-2 (seat surface)
       │        └─ throw (seat surface)
       ├─ sideboard ─┬─ sb-vase-1..3, sb-tray, sb-plant
       │             └─ sb-book-1 ── sb-book-2
       ├─ bookshelf ─┬─ board 1 ── flat books ── small plant
       │             ├─ board 2 ── upright books
       │             ├─ board 3 ── small plant, bowl
       │             └─ board 4 ── upright books, small plant
       ├─ arc-lamp, tree, door-plant, lantern-tall, lantern-small
north wall ── art
```
The sofa, armchair and coffee table sit on the floor. The rug is flat and never a parent, because large furniture can't rest on a rug in the support table.

## 5. Lighting & mood
- **Golden hour, late afternoon.** A low warm sun (elevation ≈ 15–20°) comes from the **west, slightly north**, through the glazed door. It casts long, fairly crisp shadows of the mullions and furniture toward +X/+Z (down-right in the image). Warm color ≈ 2700–3200 K (#ffbf80).
- **Fill:** soft warm bounce from the outdoor environment. The interior shadows are amber, not blue.
- **Practical lights (on):** arc-lamp shade, both lanterns. A weak warm glow; shadows only from the sun.
- **Mood:** warm minimal, calm, high key. Whites read cream and wood reads honey.

## 6. Camera
- High oblique ("dollhouse") view from the **N** corner (+X, +Z), looking at the **F** corner.
- **Estimate:** position ≈ (5.6, 7.2, 6.4), look-at ≈ (−0.4, 0.2, −0.5), vertical FOV ≈ 32°, aspect 1.6 (1586 × 992). That's an elevation of about 45° and an azimuth of about 45°. Tuned against the reference overlay; the final values are in `apps/web/src/scene/CameraRig.tsx` (preset `match`).
- **Lens:** near-orthographic feel with mild perspective. The tilt-shift blur at the edges is not reproduced (see the gap list).

## 7. Gap list (from the audit) and resolution
| # | Needed by test2 | Resolution |
|---|---|---|
| G1 | Multi-panel glazed sliding door with black frames; dark window frames | Shell opening `glazing` (panels, frame color); rendered with mullions and glass |
| G2 | Thick walls shown cut low (dollhouse) | Wall display mode `cutaway` (camera-facing walls drop smoothly to a low height with caps), alongside `fade` |
| G3 | Golden-hour sun through the door, warm fill, outdoor backdrop | Scene lighting presets `day` / `evening` / `golden`; sun direction per preset; CC0 outdoor golden-hour HDR as a blurred background |
| G4 | Lit lamps / lanterns | Light-emitting catalog assets (`light` field), on/off per object, ≤ 2 shadow casters |
| G5 | Pillows and a throw resting on the sofa seat | `soft` collision profile; sofa `seat` support surface |
| G6 | Small decor stacks (books, bowl on books, plants on shelves) | Support surfaces + stacking + gravity; decor tilt (books lie flat) |
| G7 | Shelves holding items on several levels | `open` profile with per-board support surfaces |
| G8 | Round table with chunky legs; chair tuck | `table` profile with custom legs |
| G9 | Arc lamp overhanging the sofa | Compound collision boxes (base, pole, shade) |
| G10 | Assets: modern cream sofa, barrel bouclé chair, travertine round table, arc lamp, oak sideboard, open oak/black shelf, lanterns, pillows, throw, books, tray, bowl, jute rug, abstract art | Self-authored procedural GLBs (CC0, ours) plus Poly Haven CC0 (vases, plants). See §8. |
| G11 | Warm-white walls, honey-oak floor | Scene appearance (wall color, floor material), separate from the immutable shell |
| G12 | Selection box with corner dots (as drawn in test2) | Selection overlay adds corner markers |
| G13 | Tilt-shift depth-of-field blur | **Deferred:** needs a post-processing pass (`@react-three/postprocessing`); cost on Intel UHD is uncertain and it's not needed for editing. Revisit for screenshots only. |
| G14 | Draped throw (cloth) | **Deferred:** no cloth simulation; a folded throw slab is used |
| G15 | Exterior terraces and planters | **Out of scope:** not part of the room; the blurred HDR backdrop stands in |
| G16 | Many small objects (~45–100) | Performance pass (memoized nodes, demand frameloop, shadow limits; instancing evaluated) |

## 8. Assets needed (higher-fidelity replacements)
The scene uses self-authored geometric approximations, so it works now. These are the models worth sourcing (CC0, or FurniMesh once licensing is confirmed) to get closer to the image:

| name | category | target W × D × H (m) | style notes |
|---|---|---|---|
| Modern 3-seat sofa | sofa | 2.30 × 0.95 × 0.80 | cream bouclé/linen, deep seat, square track arms, low dark legs |
| Barrel lounge chair | armchair | 0.85 × 0.80 × 0.75 | rounded bouclé shell, wraparound back, no visible legs |
| Round travertine coffee table | coffee_table | Ø0.90 × 0.38 | honed travertine top, 4 thick cylindrical legs |
| Arc floor lamp | floor_lamp | 0.40 × 1.10 × 1.90 | black base and arc, opal dome shade |
| Oak sideboard | cabinet | 2.10 × 0.48 × 0.75 | honey oak, 4 flat doors, slim tapered legs |
| Open bookshelf | shelf | 1.00 × 0.35 × 1.90 | oak boards, black steel ladder frame |
| Glass lanterns (tall / orb) | lamp | Ø0.22 × 0.55 / Ø0.20 × 0.24 | clear/frosted glass with candle glow |
| Square throw pillows | pillow | 0.45 × 0.15 × 0.45 | linen; rust, sand, oat |
| Knit throw | throw | 1.30 × 1.70 unfolded | chunky cream knit with fringe |
| Large jute rug | rug | 3.20 × 2.30 | chunky woven jute, darker border |
| Abstract circles print | wall_art | 0.60 × 0.78 | oak frame, beige and terracotta overlapping circles |
| Olive tree in stone planter | plant | 0.70 × 1.60 | round textured stone planter |

## 9. Result and remaining differences (2026-10-17)
`pnpm capture:test2 [--gpu]` writes `test-output/test2-render.png` (1586 × 992, "Match photo" camera, UI hidden). The reproduction matches the layout, every inventory item, the stacking graph, warm-white walls, honey floor, golden low sun through the glazed door (mullion shadows across the floor), lit lanterns and arc lamp, and the cut-away near walls. The `photoCamera` in the fixture ([5.6, 7.2, 6.4] → [−0.4, 0.2, −0.5], 32° FOV) was kept from §6.

Still different, and why:
- **Models are geometric stand-ins** (§8). Sofa cushions are boxy, the bouclé is a texture rather than geometry, and the throw is folded rather than draped. Swapping in sourced models only needs a catalog change.
- **Surroundings:** a warm flat backdrop with fog stands in for the blurred garden. A ground-projected outdoor HDR was tried, but it showed cold paving and was worse. Tilt-shift DOF is deferred (G13).
- **Olive tree** uses a terracotta pot (Poly Haven `potted_plant_01`), not a stone planter.
- **Pillows** stand upright instead of leaning back about 15°. Tilt is limited to 90° steps by design.
- **Exposure:** the reference is more saturated and warmer overall. The lighting is tuned by eye, not colour-matched.
