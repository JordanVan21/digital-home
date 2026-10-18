# Face snapping and immediate support

## Reproduced problem

A mouse-dragged piece at the exact height of a tabletop still reports invalid support because move operations preserve the previous floor placement. Support is assigned only on Accept. Floor contact also requires impractical precision. The fixture plant (62 cm box) is wider than the coffee table's 60 cm depth, so full-footprint containment makes that example impossible.

## Behavior

Movement magnetically snaps the moving box's bottom face to the floor or any other object’s bounding-box top within 12 cm. Every category uses the same geometry rules; sofas and chairs are valid supports. Self-support and cyclic support remain prohibited. The same helper applies to height and horizontal gestures and numeric height entry. Alt bypasses proximity snapping during dragging; exact contact still establishes valid support. Shift retains 10 cm grid snapping, with face contact taking precedence. Rotation remains separate.

Snaps show the target face outline and an explicit surface label. Free states and genuine collisions remain permitted suggestions. Snapped contact establishes support immediately, so feasible stacking has no support error before Accept. Accepted contact is preserved; Accept does not drop a snapped stack to the floor. Support parents are resolved before their edited children, regardless of array order.

Support uses the center of the bottom bounding face within the support polygon, allowing overhanging boxes such as leafy plants. Keep existing bounds, upright rotation, acyclic support references and volume collision checks. This remains bounding-box placement rather than exact physical stability or mesh contact. Only edits move; untouched pieces and locks remain protected.

## Architecture

Pure scene-engine helpers enumerate surface faces, choose proximity snaps, and infer exact contact from the resulting transform. Existing move operations can therefore establish support without a new operation schema. Rendering adapts results imperatively; no model rerenders or persisted edits during pointer movement. Release records one draft step. Draft undo/redo, Accept history, and reload preserve placement.

The user chose floor/object-top snapping first; ceiling feasibility is deferred. Surface descriptors use top/bottom face semantics so ceiling contact can share the same implementation without making arbitrary side contact count as gravity support.

## Validation

Engine: floor contact, rotated/scaled furniture tops, plant overhang, free heights, cycles, collisions, unchanged accepted snaps and dependency order. GPU-free gestures: floor/table magnetic contact, Alt bypass, Shift precedence, no model renders, single draft step and live validity. Browser: actual mouse placement on a tabletop and back to the floor, accept/reload, and smoke checks with console errors captured.
