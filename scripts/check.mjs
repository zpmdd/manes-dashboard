import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoMetrics, extent, inFeature, labelPoint, layoutLabels, lineage, polygons, projection } from '../src/geo.js';

const base = fileURLToPath(new URL('../public/data/', import.meta.url));
const read = path => JSON.parse(readFileSync(base + path, 'utf8'));
const index = read('index.json');
const cache = new Map(readdirSync(base + 'regions').map(file => [file.slice(0, -5), read('regions/' + file)]));
const checkPoint = p => assert(p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90, 'Invalid lon/lat');
let vertices = 0, labels = 0;
for (const [code, entry] of Object.entries(index)) {
  const parents = lineage(code, index);
  assert.equal(parents[0].code, '100000', `Broken ancestry: ${code}`);
  assert.equal(parents.at(-1).code, code);
  assert(new Set(parents.map(p => p.code)).size === parents.length);
  const data = cache.get(entry.hasChildren ? code : entry.parent);
  assert(data, `Missing load target: ${code}`);
  if (!entry.hasChildren) assert(data.features.some(f => String(f.properties.adcode) === code), `Leaf cannot load: ${code}`);
  if (code !== '100000') assert.equal(read('roads/' + code + '.json').type, 'FeatureCollection', `Missing roads file: ${code}`);
}
for (const [code, data] of cache) {
  assert.equal(data.type, 'FeatureCollection');
  for (const feature of data.features.filter(f => f.properties.name)) {
    assert(inFeature(labelPoint(feature), feature), `Label outside its region: ${code}/${feature.properties.name}`);
    labels++;
  }
  for (const f of data.features) for (const poly of polygons(f.geometry)) for (const ring of poly) {
    assert(ring.length >= 4, `Degenerate ring in ${code}`);
    assert.deepEqual(ring[0], ring.at(-1), `Open polygon in ${code}`);
    for (const p of ring) { checkPoint(p); vertices++; }
  }
  const project = projection(extent(data.features, code === '100000'));
  assert(project(data.features[0].geometry.coordinates.flat(5).slice(0, 2)).every(Number.isFinite));
}
const hole = { geometry: { type: 'Polygon', coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[1,2],[2,2],[2,1],[1,1]]] } };
assert(inFeature([.5,.5], hole)); assert(!inFeature([1.5,1.5], hole)); assert(!inFeature([5,5], hole));
const multi = { geometry: { type:'MultiPolygon', coordinates: [hole.geometry.coordinates, [[[10,10],[11,10],[11,11],[10,11],[10,10]]]] } };
assert(inFeature([10.5,10.5], multi)); assert(!inFeature([6,6], multi));
const square = { properties: { centroid: [.01, 2] }, geometry: { type: 'Polygon', coordinates: [hole.geometry.coordinates[0]] } };
assert.deepEqual(labelPoint(square), [2, 2], 'A valid but edge-hugging centroid must move to the interior visual center');
assert(inFeature(labelPoint(hole), hole), 'The visual center must avoid holes');
assert(inFeature(labelPoint({ ...multi, properties: { centroid: [10.5, 10.5] } }), hole), 'A small outlying island must not take the main label');
const concave = { geometry: { type: 'Polygon', coordinates: [[[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6],[0,0]]] } };
assert(!inFeature([3, 3], concave));
assert(inFeature(labelPoint(concave), concave), 'Concave regions need an interior anchor even when their bounding-box center lies outside');
const tiny = { geometry: { type: 'Polygon', coordinates: [square.geometry.coordinates[0].map(([x,y]) => [110 + x * .00001, 30 + y * .00001])] } };
assert(inFeature(labelPoint(tiny), tiny), 'Small districts must retain an interior anchor');
const labelBounds = { left: 0, top: 0, right: 320, bottom: 240 };
const crowded = Array.from({ length: 13 }, (_, i) => ({ id: i, x: 160 + i % 3 * 5, y: 120 + i % 2 * 5, width: 42, height: 16, focused: i > 0 }));
const arranged = layoutLabels(crowded, labelBounds);
assert(arranged.every(label => !label.hidden), 'Dense city districts must all fit with callouts');
assert(arranged.some(label => label.dx || label.dy), 'Overlapping labels must move');
assert(arranged[0].focused, 'Focused regions take priority over background labels');
for (const [i, a] of arranged.entries()) {
  const ax = a.x + a.dx, ay = a.y + a.dy;
  assert(ax - a.width / 2 >= 0 && ax + a.width / 2 <= 320 && ay - a.height / 2 >= 0 && ay + a.height / 2 <= 240, 'Callouts must fit inside the map viewport');
  for (const b of arranged.slice(i + 1)) assert(Math.abs(ax - b.x - b.dx) >= (a.width + b.width) / 2 + 2 || Math.abs(ay - b.y - b.dy) >= (a.height + b.height) / 2 + 2, 'Labels must not overlap');
}
assert.deepEqual(layoutLabels([{ ...crowded[0], x: 50, y: 50 }], labelBounds).map(({ dx, dy }) => [dx, dy]), [[0, 0]], 'Uncrowded names stay on their interior anchor');
assert(layoutLabels([{ ...crowded[0], x: -100 }], labelBounds)[0].hidden, 'Offscreen context must not push focused names aside');
assert(crowded.every(label => label.dx === undefined), 'Screen placement must not mutate geographic anchors');
const roadRefs = new Set(read('roads-420381.json').features.flatMap(f => (f.properties.ref || '').split(';')));
for (const ref of ['G70', 'G59', 'G209', 'G241', 'G316']) assert(roadRefs.has(ref), `Missing source road ref: ${ref}`);
assert.equal(demoMetrics('100000').devices, 2048);
assert.equal(lineage('420381', index).map(p => p.name).join('/'), '中国/湖北省/十堰市/丹江口市');
console.log(`PASS: ${Object.keys(index).length} region entries; ${cache.size} loadable maps; ${vertices.toLocaleString()} valid ring vertices; ${labels} interior labels; visual centers, hierarchy, holes, islands and road references verified.`);
