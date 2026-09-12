import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { act, createElement, Profiler } from 'react';
import { createRoot, extend } from '@react-three/fiber';
import * as THREE from 'three';
import { createServer } from 'vite';

// Exercise the real R3F components without a browser or a GPU render loop.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
extend(THREE);
const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, logLevel: 'error' });
const root = createRoot({});
try {
  const { RegionMesh, fitMapViewport } = await vite.ssrLoadModule('/src/MapScene.jsx');
  const bounds = new THREE.Box3(new THREE.Vector3(-5, 0, -8), new THREE.Vector3(11, .38, 2));
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 200);
  const viewports = [
    { size: { width: 1920, height: 1080 }, viewport: { x: .22, y: .14, width: .74, height: .55 } },
    { size: { width: 3840, height: 2160 }, viewport: { x: .22, y: .14, width: .74, height: .55 } },
    { size: { width: 1280, height: 900 }, viewport: { x: .08, y: .18, width: .3, height: .58 } },
    { size: { width: 1920, height: 1080 }, viewport: { x: .7, y: .42, width: .18, height: .19 } },
    { size: { width: 390, height: 844 }, viewport: { x: 0, y: .1, width: 1, height: .5 } },
  ];
  for (const { size, viewport } of viewports) {
    const fitted = fitMapViewport(camera, bounds, size, viewport);
    const left = viewport.x + viewport.width * .08, right = viewport.x + viewport.width * .92;
    const top = viewport.y + viewport.height * .12, bottom = viewport.y + viewport.height;
    assert(fitted && Number.isFinite(fitted.distance), 'A usable viewport must produce a finite camera');
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera), screenX = (point.x + 1) / 2, screenY = (1 - point.y) / 2;
      assert(screenX >= left - 1e-8 && screenX <= right + 1e-8 && screenY >= top - 1e-8 && screenY <= bottom + 1e-8, 'Every geometry corner must fit with 8% side and 12% title margins');
      assert(point.z > -1 && point.z < 1, 'Fitted geometry must stay inside the near and far clipping planes');
    }
    const center = bounds.getCenter(new THREE.Vector3()).project(camera);
    assert(Math.abs((center.x + 1) / 2 - (left + right) / 2) < 1e-8);
    assert(Math.abs((1 - center.y) / 2 - (top + bottom) / 2) < 1e-8);
    const previousProjection = camera.projectionMatrix.clone();
    assert.equal(fitMapViewport(camera, bounds, size, undefined), null);
    assert.equal(fitMapViewport(camera, bounds, size, { ...viewport, width: 0 }), null);
    assert(camera.projectionMatrix.equals(previousProjection), 'An absent or empty viewport must not change the legacy camera');
  }
  console.log('PASS: 40 real Three projections fit resized viewports, centered bounds, reserved margins and clipping planes.');
  const scene = new THREE.Scene();
  await root.configure({ scene, frameloop: 'never', size: { width: 800, height: 600, top: 0, left: 0 }, dpr: 1, gl: { render() {}, setPixelRatio() {}, setSize() {} } });
  const regions = ['湖北省', '湖南省'].map((name, i) => ({ feature: { properties: { adcode: 420000 + i, name } }, geometry: new THREE.BoxGeometry(), color: '#aaa6a0' }));
  const commits = [0, 0], picked = [], labels = [];
  const onSelect = feature => picked.push(feature), onHover = name => labels.push(name);
  let worldRenders = 0;
  function WorldProbe({ selected = false }) {
    worldRenders++;
    return regions.map((region, i) => createElement(Profiler, { id: String(i), key: i, onRender: () => commits[i]++ }, createElement(RegionMesh, { region, selected: selected && i === 0, onSelect, onHover })));
  }
  await act(async () => root.render(createElement(WorldProbe)));
  const [first, second] = scene.children;
  const materials = [...first.material];
  const initialCommits = [...commits], initialWorldRenders = worldRenders;
  const event = (delta = 0) => ({ delta, stopPropagation() {} });
  await act(async () => first.__r3f.handlers.onPointerOver(event()));
  assert.equal(first.material[0].color.getHexString(), 'e0d3a8');
  assert.equal(second.material[0].color.getHexString(), 'aaa6a0');
  assert.equal(labels.at(-1), '湖北省');
  assert.equal(worldRenders, initialWorldRenders, 'Hover must not rerender the world');
  assert.equal(commits[1], initialCommits[1], 'Hover must not rerender a sibling region');
  assert(commits[0] > initialCommits[0]);
  assert(first.material.every((material, i) => material === materials[i]), 'Hover must reuse materials');
  first.__r3f.handlers.onClick(event(6));
  assert.equal(picked.length, 0, 'A camera drag must not select a region');
  first.__r3f.handlers.onClick(event());
  assert.equal(picked[0], regions[0].feature);
  await act(async () => first.__r3f.handlers.onPointerOut());
  assert.equal(first.material[0].color.getHexString(), 'aaa6a0');
  assert.equal(labels.at(-1), '');
  await act(async () => root.render(createElement(WorldProbe, { selected: true })));
  await act(async () => { first.__r3f.handlers.onPointerOver(event()); first.__r3f.handlers.onPointerOut(); });
  assert.equal(first.material[0].color.getHexString(), 'e0d3a8', 'Selected regions stay highlighted after pointer exit');
  console.log('PASS: hover isolation, material reuse, region selection, drag guard and selected highlighting.');
} finally {
  await act(async () => root.unmount());
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
