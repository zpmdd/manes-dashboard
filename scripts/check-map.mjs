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
  const { RegionMesh } = await vite.ssrLoadModule('/src/MapScene.jsx');
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
