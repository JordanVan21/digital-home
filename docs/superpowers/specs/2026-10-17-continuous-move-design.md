# Continuous horizontal/height movement and Poly Haven imports

## Movement

Keep normal horizontal dragging and the existing explicit Height mode. While dragging in horizontal mode, hold Space to move vertically; release Space to resume horizontal movement without releasing the pointer. Rebase the drag plane and pointer offset at each transition using the current candidate transform, preserving position with no jump. All segments form one draft step on release. Snapping, Shift grid snapping, Alt bypass, cancellation, locks and imperative mesh updates remain unchanged. Blur and keyup clear the temporary modifier. Ignore text fields and dialogs; prevent Space scrolling only while it controls an editable selection. Rotate stays separate.

## Assets

Import three real CC0 Poly Haven models: dining_chair_02, potted_plant_04 and ceramic_vase_01. Fetch 1K glTF manifests using an identifying user-agent, download listed geometry/textures with checksums, embed local GLBs, preserve source PBR materials and meter scale, center the origin at floor contact, and cap triangle/texture budgets. Append stable catalog IDs without changing FurniMesh IDs or model bytes. Use source `other` and original Poly Haven URLs within the existing contract. Store author, source URLs, file hashes and license in provenance records. The app remains offline with no live API dependency.

Generate our own thumbnails from licensed model geometry; Poly Haven website example renders are not asset files. Show the correct provider in the catalog and inspector. Keep existing ingestion reproducible without dropping separately imported assets. Physical item prices remain curated catalog estimates, not Poly Haven quotes. Validate all GLBs, bounds, hashes, textures and licenses, and browser-load each new asset.

## Checks

Test continuous plane transitions without jumps, model rerenders, intermediate draft writes or extra undo entries. Test modifier cleanup and text-field exclusions. Verify catalog schemas and GLB budgets, browser asset loading, and one continuous move/raise/slide gesture with snapping.
