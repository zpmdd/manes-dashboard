import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoMetrics, extent, inFeature, lineage, polygons, projection } from '../src/geo.js';

const base = fileURLToPath(new URL('../public/data/', import.meta.url));
const read = path => JSON.parse(readFileSync(base + path, 'utf8'));
const index = read('index.json');
const cache = new Map(readdirSync(base + 'regions').map(file => [file.slice(0, -5), read('regions/' + file)]));
const checkPoint = p => assert(p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90, 'Invalid lon/lat');
let vertices = 0;
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
const roadRefs = new Set(read('roads-420381.json').features.flatMap(f => (f.properties.ref || '').split(';')));
for (const ref of ['G70', 'G59', 'G209', 'G241', 'G316']) assert(roadRefs.has(ref), `Missing source road ref: ${ref}`);
assert.equal(demoMetrics('100000').devices, 2048);
assert.equal(lineage('420381', index).map(p => p.name).join('/'), '中国/湖北省/十堰市/丹江口市');
console.log(`PASS: ${Object.keys(index).length} region entries; ${cache.size} loadable maps; ${vertices.toLocaleString()} valid ring vertices; hierarchy, holes, islands and road references verified.`);
