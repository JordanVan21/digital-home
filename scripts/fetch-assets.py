"""Fetch publicly linked FurniMesh library downloads; keep provenance for normalization."""
import json, re, urllib.request, pathlib, concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEST=pathlib.Path('/tmp/house-raw-models');DEST.mkdir(exist_ok=True)
# Curated physical envelopes in meters; photo-derived models do not carry measured sizes.
MODELS=[
 ('sofa','sofa','Linen sofa',[2.16,.84,.92],129900,'sofas/sofa/a-contemporary-sofa-featuring-an-ecrucolored-slipcover-netj96/'),
 ('armchair','armchair','Bouclé lounge chair',[.85,.78,.84],44900,'seating/office-chair/a-contemporary-swivel-armchair-upholstered-in-a-tso2z4/'),
 ('coffee-table','coffee-table','Sculptural walnut coffee table',[1.02,.35,.60],32900,'tables/coffee-table/a-sculptural-multitiered-coffee-table-crafted-from-ojvaek/'),
 ('rug','rug','Natural woven rug',[2.75,.025,2.25],18900,'decor/rug/a-rectangular-rug-made-of-woven-fibers-4adwnz/'),
 ('floor-lamp','lamp','Linen shade floor lamp',[.46,1.65,.46],17900,'lighting/floor-lamp/a-modern-floor-lamp-featuring-a-cylindrical-4vxr90/'),
 ('sideboard','sideboard','Oak sideboard',[1.65,.78,.42],69900,'storage/sideboard/a-rustic-light-oak-sideboard-featuring-four-tgts4z/'),
 ('bookshelf','bookshelf','Open walnut bookshelf',[.76,1.80,.32],34900,'storage/bookshelf/a-tall-fivetier-open-wooden-bookshelf-in-rfhc3x/'),
 ('olive-tree','plant','Olive tree',[.62,1.50,.62],8900,'decor/plant/a-slender-olive-tree-with-sparse-delicate-4ya4h8/'),
 ('desk','desk','Light oak writing desk',[1.12,.76,.52],39900,'tables/desk/a-modern-lighttoned-wood-desk-featuring-a-adkgdu/'),
 ('desk-chair','chair','Cream desk chair',[.55,.82,.56],19900,'seating/office-chair/an-upholstered-swivel-office-chair-featuring-a-965gfl/'),
 ('side-table','side-table','Round brass side table',[.44,.48,.44],12900,'tables/side-table/a-round-twotier-side-table-featuring-a-job9xg/'),
 ('sofa-sculpted','sofa','Sculpted two-seat sofa',[2.05,.82,.9],119900,'sofas/sofa/a-contemporary-twoseater-sofa-upholstered-in-light-yl03d4/')
]
def fetch(row):
 slug,category,title,dims,price,path=row
 url='https://furnimesh.com/library/'+path
 s=urllib.request.urlopen(url,timeout=35).read().decode()
 # Both page and library explicitly label these public links as free commercial-use downloads.
 glb=re.search(r'https://storage.googleapis.com/[^\s<>"\\]+\.glb',s).group(0)
 urllib.request.urlretrieve(glb, DEST/(slug+'.glb'))
 ld=[json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>',s)]
 model=next(x for x in ld if x.get('@type')=='3DModel')
 thumb=model.get('thumbnailUrl')
 if thumb:
  urllib.request.urlretrieve(thumb,DEST/(slug+'.png'))
 print(slug,(DEST/(slug+'.glb')).stat().st_size,flush=True)
 return dict(slug=slug,category=category,title=title,dimensionsM=dims,price=price,sourceUrl=url,downloadUrl=glb,author='FurniMesh / UAB FURNISYSTEMS',license='Free commercial use, no attribution required',licenseUrl='https://furnimesh.com/library/',downloadDate='2026-10-17',yaw=0)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 results=list(pool.map(fetch,MODELS))
(ROOT/'scripts/asset-sources.json').write_text(json.dumps(results,indent=2)+'\n')
