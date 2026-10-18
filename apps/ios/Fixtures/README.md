# Scanner fixtures

- `sample-scan.json`: synthetic version 1 room.
- `real-scan-1.json`: Jeffrey's first supplied real RoomPlan export, captured
  2026-10-18T10:01:46Z, scan ID `B28E90F6-44EF-44E3-9755-8D8D6C681284`.
  Preserved byte-for-byte from the AirDrop file. Reported iOS: 26.7.1; hardware model
  is not recorded beyond `iPhone` by the current exporter.

The real scan contains 5 walls, 5 doors, 2 windows, no unframed openings, 1 floor,
and 5 objects (chair, table, two sofas, fireplace). Four objects have low confidence.
These are RoomPlan detections, not confirmed real-world labels or counts.
Room name, physical measurements and unplugged operation have not yet been confirmed.

JSON syntax, UUIDs, matrix/dimension lengths, finite values and nonnegative dimensions
were checked. The TypeScript importer was not executed for this fixture: pnpm and
workspace dependencies are not currently installed in this worktree.

Important integration finding: `floors[].polygonCorners` in this export lie in the
surface's local XY plane. Applying the floor's transform yields capture-frame points.
The existing version 1 comments and importer's fallback incorrectly call/use these
as world coordinates. Correct that interpretation with a regression check before
relying on the floor-outline fallback. Keep this real source file unchanged.

A second real scan is still required; do not replace it with synthetic geometry.
