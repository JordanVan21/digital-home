# Fixture models

These six GLBs contain original Poly Haven meshes and 2K PBR textures.
All are CC0; commercial use, modification, and redistribution are permitted:
https://polyhaven.com/license (reviewed 2026-10-17).

Source asset pages, immutable SHA-256 hashes, dimensions, triangle counts,
and embedded texture byte totals are recorded in
`apps/web/src/fixtures/assetCatalog.json`. The model files are self-contained;
no external texture URLs are requested at runtime. These are visual
approximations of existing belongings, not purchasable product matches.
No price is invented for them.

Reimport from the repository root:

```sh
python3 scripts/import-polyhaven.py
node scripts/normalize-catalog.mjs
```

The first command downloads each source glTF and its referenced files via
Poly Haven's public API, verifies file MD5s, and embeds the original buffers
and images into a GLB. The second centers the floor-contact origin, rotates
the shelf's source axes, and computes catalog metadata. Neither constructs
furniture geometry. Asset IDs and filenames derive from the normalized
GLB's hash; changed content gets a different ID and URL.

Powered by Poly Haven: https://polyhaven.com
Public API terms: https://github.com/Poly-Haven/Public-API/blob/master/ToS.md

Rug and floor lamp intentionally remain approximate proxies. Poly Haven's
catalog did not contain suitable models for those categories at review time.
FurniMesh's public library advertises commercial use, but the linked terms
do not explicitly settle raw-file redistribution in a public source repo.
No FurniMesh binary is included pending confirmation of that permission.

The fixture uniformly fits each source model inside its previous scan
envelope, preserving proportions and shrinking the collision/selection
dimensions to the fitted model. The approved catalog retains native meter
dimensions. Runtime GLB loading also fits conservative object dimensions;
missing, pending, restricted, corrupt, and failed downloads retain the
category proxy with a visible approximation/loading/error label.
