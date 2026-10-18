# Spatial controls — full-area swivel and height movement

## Rotation

Rotate mode displays the existing ring with a full invisible disk hit area. Dragging the disk or the furniture hitbox starts the same free swivel. Move mode has no swivel target. Choosing Rotate only changes mode; the existing R shortcuts and inspector step buttons retain their 15-degree behavior. Shift snaps free swivel to 15 degrees. Each release produces one draft step, with no model render or scene writes during movement. Locked pieces expose no rotation target.

## Height movement (user decision: require support)

The later [face-snapping specification](2026-10-17-face-snapping-design.md) supersedes the original full-containment, support timing, and array-order rules below.

Use explicit Floor (XZ) and Height (Y) move controls, preserving the other coordinates. Height uses a camera-facing vertical plane through the piece and a visible up/down guide; Shift snaps to 10 cm. Details exposes an exact height field. All gestures are imperative and release one suggestion.

Drafts may float. Accept snaps changed/added pieces to the nearest eligible surface by vertical distance at their proposed XZ: floor, or the bounding-box top of a table, desk, sideboard, or shelving unit that fully contains the piece's rotated footprint. This is approximate furniture support, not mesh physics or arbitrary shelf picking. Existing wall supports retain their separate policy. Support identity uses the existing placement fields, with no schema additions.

The resolver retains its horizontal nearest-fit search and rotation preservation. Each search candidate recomputes support. Locks remain fixed. Full validation checks height/contact, support footprint containment, acyclic parent references, floor/ceiling bounds, and vertical intervals plus oriented XZ footprints for collisions. Touching surfaces are allowed. A final whole-scene validation prevents moving a support out from under untouched objects; those objects never move automatically. Such a batch remains unresolved for the user to adjust together. Floor placement can always be requested by entering height zero.

Tests cover circle/furniture swivel, model render counts, one draft step, Shift snapping, locked controls, height dragging with XZ preservation, cancellation, supported acceptance/undo, floating and intersecting rejection, contact and containment, bounds, and support changes.
