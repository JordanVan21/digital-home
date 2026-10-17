"""Download selected CC0 glTFs and package their original meshes/textures as GLB.

No geometry is generated. Uses the public API for one-time local ingestion;
the application serves committed files and never depends on the live API.
"""
import hashlib
import json
import pathlib
import struct
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/models/polyhaven"
ASSETS = {
    "sofa": "sofa_03",
    "armchair": "modern_arm_chair_01",
    "coffee_table": "coffee_table_round_01",
    "bookshelf": "wooden_display_shelves_01",
    "credenza": "modern_wooden_cabinet",
    "plant": "potted_plant_02",
}


def fetch(url):
    print(url, flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "House-local-asset-import/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def align(data, fill=b"\0"):
    return data + fill * ((-len(data)) % 4)


OUT.mkdir(parents=True, exist_ok=True)
records = []
for category, name in ASSETS.items():
    manifest = json.loads(fetch(f"https://api.polyhaven.com/files/{name}"))
    entry = manifest["gltf"]["2k"]["gltf"]
    doc = json.loads(fetch(entry["url"]))
    includes = entry["include"]
    binary = bytearray()
    offsets = []
    for buffer in doc["buffers"]:
        offsets.append(len(binary))
        data = fetch(includes[buffer["uri"]]["url"])
        assert hashlib.md5(data).hexdigest() == includes[buffer["uri"]]["md5"]
        binary.extend(align(data))
    for view in doc["bufferViews"]:
        view["byteOffset"] = view.get("byteOffset", 0) + offsets[view["buffer"]]
        view["buffer"] = 0
    texture_bytes = 0
    for image in doc.get("images", []):
        uri = image.pop("uri")
        data = fetch(includes[uri]["url"])
        assert hashlib.md5(data).hexdigest() == includes[uri]["md5"]
        image["bufferView"] = len(doc["bufferViews"])
        image["mimeType"] = "image/png" if uri.endswith(".png") else "image/jpeg"
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
        binary.extend(align(data))
        texture_bytes += len(data)
    doc["buffers"] = [{"byteLength": len(binary)}]
    encoded = align(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(encoded) + 8 + len(binary))
    glb += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    glb += struct.pack("<II", len(binary), 0x004E4942) + binary
    digest = hashlib.sha256(glb).hexdigest()
    filename = f"{name}-{digest[:12]}.glb"
    (OUT / filename).write_bytes(glb)
    records.append({"category": category, "name": name, "filename": filename,
                    "contentHash": digest, "textureBytes": texture_bytes})
    print(f"Packaged {filename}: {len(glb):,} bytes", flush=True)
(OUT / "manifest.json").write_text(json.dumps(records, indent=2) + "\n")
