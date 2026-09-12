"""Prepare offline, level-by-level assets from the user's existing Daoyan data.
Run with PYTHONPATH=../work/python python3 scripts/prepare-geo.py from dashboard.
"""
import hashlib
import json
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/Users/manes/Work/Java/Daoyan/src/main/resources/ChinaGeoJson')
WORK = ROOT.parent / 'work'
OUT = ROOT / 'public/data'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'regions').mkdir(exist_ok=True)
(OUT / 'roads').mkdir(exist_ok=True)


def read(path):
    return json.loads(path.read_text())


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')


def bbox(geo):
    return list(shape(geo).bounds)


def collection(features):
    return {'type': 'FeatureCollection', 'features': features}


national = read(WORK / 'china-provinces.json')
index = {'100000': {'name': '中国', 'level': 'country', 'parent': None, 'hasChildren': True}}
hashes = {}
geometries = {}


def save(code, data, origin):
    for f in data['features']:
        f['bbox'] = bbox(f['geometry'])
        p = f['properties']
        if isinstance(p.get('adcode'), int):
            k = str(p['adcode'])
            geometries[k] = shape(f['geometry'])
            index[k] = {**index.get(k, {}), 'name': p['name'], 'level': p.get('level', 'district'),
                        'parent': str(p.get('parent', {}).get('adcode') or code),
                        'center': p.get('centroid') or p.get('center')}
    write(OUT / 'regions' / (str(code) + '.json'), data)
    hashes[str(code)] = hashlib.sha256(origin.read_bytes()).hexdigest()


save('100000', national, WORK / 'china-provinces.json')
for p in national['features']:
    props = p['properties']
    if not isinstance(props.get('adcode'), int):
        continue
    path = SOURCE / 'province' / (props['name'] + '.json')
    if path.exists():
        data = read(path)
        save(props['adcode'], data, path)
        index[str(props['adcode'])]['hasChildren'] = any(f['properties'].get('adcode') != props['adcode'] for f in data['features'])

for path in sorted((SOURCE / 'citys').glob('*.json')):
    data = read(path)
    if not data.get('features'):
        continue
    p = data['features'][0]['properties']
    parent = str(p.get('parent', {}).get('adcode'))
    # Leaf districts are already included in their parent file.
    if len(data['features']) == 1 and path.stem == p['name']:
        continue
    if parent in index and not (OUT / 'regions' / (parent + '.json')).exists():
        save(parent, data, path)
        index[parent]['hasChildren'] = True

for item in index.values():
    item.setdefault('hasChildren', False)
write(OUT / 'index.json', index)

# Natural Earth is a generalized overview, without reliable Chinese route refs.
# Clip the actual geometry; never connect unrelated road segments across gaps.
polygons = [shape(f['geometry']) for f in national['features'] if isinstance(f['properties'].get('adcode'), int)]
boundary = unary_union([g if g.is_valid else g.buffer(0) for g in polygons])
roads = []
for f in read(WORK / 'roads-global.geojson')['features']:
    if f['properties']['type'] != 'Major Highway':
        continue
    line = shape(f['geometry'])
    if not boundary.intersects(line):
        continue
    clipped = boundary.intersection(line)
    parts = list(clipped.geoms) if hasattr(clipped, 'geoms') else [clipped]
    for part in parts:
        if part.geom_type not in ('LineString', 'MultiLineString') or part.is_empty:
            continue
        roads.append({'type': 'Feature', 'properties': {'class': 'overview', 'name': '主要道路（概化）',
                      'source': 'Natural Earth 1:10m', 'ref': None}, 'bbox': list(part.bounds), 'geometry': mapping(part)})
write(OUT / 'roads-overview.json', collection(roads))
road_shapes = [shape(f['geometry']) for f in roads]
road_tree = STRtree(road_shapes)
for code, geometry in geometries.items():
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    features = []
    for road_id in road_tree.query(geometry, predicate='intersects'):
        clipped = road_shapes[road_id].intersection(geometry)
        parts = list(clipped.geoms) if hasattr(clipped, 'geoms') else [clipped]
        for part in parts:
            if part.geom_type in ('LineString', 'MultiLineString') and not part.is_empty:
                features.append({'type': 'Feature', 'properties': roads[road_id]['properties'], 'geometry': mapping(part)})
    write(OUT / 'roads' / (code + '.json'), collection(features))

local_path = Path('/Users/manes/Work/Java/危货/www-front-ui/src/views/danjiangkou/transportTwin/assets/roads.json')
local = read(local_path)
local_boundary = geometries.get('420381')
detail_features = []
for f in local['features']:
    clipped = shape(f['geometry']).intersection(local_boundary)
    parts = list(clipped.geoms) if hasattr(clipped, 'geoms') else [clipped]
    for part in parts:
        if part.geom_type in ('LineString', 'MultiLineString') and not part.is_empty:
            detail_features.append({'type': 'Feature', 'properties': f['properties'], 'geometry': mapping(part)})
local = collection(detail_features)
write(OUT / 'roads-420381.json', local)
write(OUT / 'provenance.json', {
    'preparedAt': '2026-09-12', 'administrativeSource': str(SOURCE), 'upstream': 'DataV.GeoAtlas',
    'nationalSource': 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
    'coordinateStatus': 'Source lon/lat retained. Administrative files do not declare a CRS; precise alignment is unverified.',
    'regionCount': len(index), 'regionFileCount': len(hashes), 'sourceSha256': hashes,
    'roadOverview': {'source': 'Natural Earth', 'license': 'public-domain', 'scale': '1:10m', 'features': len(roads), 'complete': False},
    'roadDetail': {'source': str(local_path), 'license': 'ODbL-1.0', 'crs': 'WGS84', 'area': '丹江口市及周边',
                   'snapshot': '2026-09-07T23:07:56Z', 'sha256': hashlib.sha256(local_path.read_bytes()).hexdigest(), 'complete': False},
    'metrics': 'All monitoring metrics, beacons, heat values and connection arcs are demonstration data.'
})
print(json.dumps({'regions': len(index), 'files': len(hashes), 'overviewRoads': len(roads)}, ensure_ascii=False))
