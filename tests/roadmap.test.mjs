import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { extent, projection } from '../src/geo.js';
import { atlasGrid, loadAtlas, roadmapMaterial, tilePoint, viewAtlas } from '../src/useRoadmap.js';

const root = new URL('../public/roadmap/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', root)));
const national = JSON.parse(readFileSync(new URL('../public/data/regions/100000.json', import.meta.url)));
const project = projection(extent(national.features, true));

test('本地瓦片索引对应全部 13822 张图片，上海 XYZ 坐标与原图一致', () => {
  let count = 0;
  for (const [z, columns] of Object.entries(index.levels)) for (const [x, rows] of Object.entries(columns)) for (const y of rows) {
    assert(Number(x) >= 0 && Number(x) < 2 ** z && y >= 0 && y < 2 ** z);
    assert(existsSync(new URL(`${z}/${x}/${y}.png`, root))); count++;
  }
  assert.equal(count, index.count); assert.equal(count, 13822);
  assert.deepEqual(tilePoint([121.47, 31.23], 10).map(Math.floor), [857, 418]);
  assert.deepEqual(tilePoint([0, 0], 1), [1, 1]);
  assert(tilePoint([0, 90], 10).every(Number.isFinite));
  const png = readFileSync(new URL('10/857/418.png', root));
  assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
});

test('缩放与平移只选已有瓦片，按实际显卡上限分配纹理', () => {
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, .0001, 200);
  const selected = new Set(); let largerAtlas = false;
  for (const point of [[104, 35], [121.47, 31.23], [111.5, 32.5]]) for (const distance of [28, 5, .8, .1]) for (const zoom of [1, 4]) {
    const [x, y] = project(point), target = new THREE.Vector3(x, .36, -y);
    camera.position.copy(target).add(new THREE.Vector3(0, distance, distance * .4)); camera.lookAt(target);
    camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const grid = viewAtlas(index, project, camera, { width: 1920, height: 1080 }, null);
    assert(grid.width <= 8 && grid.height <= 8 && grid.width > 0 && grid.height > 0);
    assert(grid.zoom <= 10); selected.add(grid.zoom);
    assert(grid.tiles.every(([tx, ty]) => index.levels[grid.zoom][tx]?.includes(ty)));
    const small = viewAtlas(index, project, camera, { width: 1920, height: 1080 }, null, 1024);
    assert(small.width <= 4 && small.height <= 4);
    const large = viewAtlas(index, project, camera, { width: 1920, height: 1080 }, null, 16384, 1.5);
    assert(large.width <= 64 && large.height <= 64);
    assert(large.zoom >= grid.zoom, 'More texture capacity and display pixels must not lower the detail level');
    largerAtlas ||= large.width > 8 || large.height > 8;
  }
  assert(largerAtlas, 'Do not reduce detail to satisfy an arbitrary 8×8 cap');
  assert(selected.size > 2); assert(selected.has(10), 'Close views must use the finest available tiles');
  assert.equal(atlasGrid(index, 10, [-180, -80, -179, -79]).tiles.length, 0);
});

test('地图材质逐像素投影，切换纹理有独立标识且不改写原始几何', () => {
  const base = { ...atlasGrid(index, 5), texture: new THREE.Texture() };
  const detail = { ...atlasGrid(index, 10, [121.4, 31.2, 121.6, 31.4]), texture: new THREE.Texture() };
  const material = roadmapMaterial(base, detail, project);
  const shader = { ...THREE.ShaderLib.basic, uniforms: {} };
  material.props.onBeforeCompile(shader);
  assert.strictEqual(shader.uniforms.roadmapDetail.value, detail.texture);
  assert(shader.vertexShader.includes('vRoadmapPosition = vec2(position.x, -position.z)'));
  assert(shader.fragmentShader.includes('log(tan(PI / 4.0 + latitude / 2.0))'));
  assert(shader.fragmentShader.includes('1.0 - uv.y'), 'XYZ north must stay at the top of the bitmap');
  assert.notEqual(material.key, roadmapMaterial(base, null, project).key);
  const position = project([121.47, 31.23]), origin = shader.uniforms.roadmapOrigin.value, unit = shader.uniforms.roadmapUnit.value;
  assert(Math.abs((position[0] - origin.x) / unit.x - 121.47) < 1e-9);
  assert(Math.abs((position[1] - origin.y) / unit.y - 31.23) < 1e-9);
  base.texture.dispose(); detail.texture.dispose();
});

test('纹理加载保留缺片透明区域、报告读失败并关闭取消请求解码出的图片', async () => {
  const saved = { document: globalThis.document, fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap };
  const draws = [], closed = [];
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage: (...args) => draws.push(args) }) }) };
  globalThis.fetch = async path => new Response('', { status: path.endsWith('/1.png') ? 404 : 200 });
  globalThis.createImageBitmap = async () => ({ close: () => closed.push(true) });
  try {
    const grid = { zoom: 5, x: 22, y: 0, width: 2, height: 2, tiles: [[22, 0], [23, 1]] };
    const atlas = await loadAtlas(grid, new AbortController().signal);
    assert.equal(atlas.failures, 1); assert.equal(draws.length, 1); assert.equal(closed.length, 1);
    assert.deepEqual(draws[0].slice(1), [0, 0]); assert.equal(atlas.texture.image.width, 512); atlas.texture.dispose();
    await assert.rejects(loadAtlas({ ...grid, tiles: [[23, 1]] }, new AbortController().signal), /读取失败/);
    const abort = new AbortController();
    globalThis.createImageBitmap = async () => { abort.abort(); return { close: () => closed.push(true) }; };
    await assert.rejects(loadAtlas({ ...grid, tiles: [[22, 0]] }, abort.signal), { name: 'AbortError' });
    assert.equal(draws.length, 1); assert.equal(closed.length, 2);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
