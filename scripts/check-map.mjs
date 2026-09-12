import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { act, Component, createElement, lazy, Profiler, Suspense } from 'react';
import { createRoot, extend, getRootState } from '@react-three/fiber';
import * as THREE from 'three';
import { createServer, transformWithEsbuild } from 'vite';

// Exercise the real R3F components without a browser or a GPU render loop.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
extend(THREE);
const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, logLevel: 'error' });
const reportedErrors = [], previousReporter = globalThis.reportError;
globalThis.reportError = error => reportedErrors.push(error);
const root = createRoot({});
if (previousReporter === undefined) delete globalThis.reportError; else globalThis.reportError = previousReporter;
try {
  const { RegionMesh, fitMapViewport, mapPixelRatio, MapScene } = await vite.ssrLoadModule('/src/MapScene.jsx');
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
  const scene = new THREE.Scene(), renderWrites = [];
  const renderer = { render() {}, setPixelRatio(value) { renderWrites.push(['dpr', value]); }, setSize(width, height) { renderWrites.push(['size', width, height]); } };
  const configuration = { scene, frameloop: 'never', size: { width: 2560, height: 1205, top: 0, left: 0 }, gl: renderer };
  for (const [size, quality, deviceRatio, expected] of [
    [{ width: 1280, height: 720 }, 'high', 2, 1.5], [{ width: 1280, height: 720 }, 'balanced', 2, 1],
    [{ width: 3840, height: 2160 }, 'high', 2, 2 / 3], [{ width: 3840, height: 2160 }, 'balanced', 2, .5],
    [{ width: 1280, height: 720 }, 'high', .75, .75], [undefined, 'high', 2, 1.5], [{ width: 0, height: 0 }, 'balanced', 2, 1],
  ]) assert.equal(mapPixelRatio(size, quality, deviceRatio), expected, 'Keep both quality caps, pixel budgets, device limit and unmeasured fallback');
  const previousDeviceRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 2;
  try {
    for (const quality of ['high', 'balanced']) {
      const dpr = mapPixelRatio(configuration.size, quality, 2);
      assert.equal(MapScene.type({ sceneSize: configuration.size, quality }).props.dpr, dpr, 'Canvas must use the centralized numeric budget');
      await root.configure({ ...configuration, dpr });
      const before = renderWrites.length;
      for (let sequence = 0; sequence < 10; sequence++) {
        const canvas = MapScene.type({ sceneSize: configuration.size, quality, command: { type: 'reset', sequence } });
        await root.configure({ ...configuration, dpr: canvas.props.dpr });
      }
      assert.equal(getRootState(scene).viewport.dpr, dpr, 'Camera commands must retain the pixel budget');
      assert.equal(renderWrites.length, before, 'Unchanged canvas configuration must not rewrite DPR or resize the renderer');
    }
  } finally { if (previousDeviceRatio === undefined) delete globalThis.devicePixelRatio; else globalThis.devicePixelRatio = previousDeviceRatio; }
  console.log('PASS: original pixel budgets and quality limits; 20 real R3F reconfigurations cause no DPR or renderer resize writes.');
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

  // Run the actual lazy loader, visibility guard and outer error boundary in R3F's React renderer.
  const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const measureSource = appSource.slice(appSource.indexOf('const measure = () => {'), appSource.indexOf('    measureRef.current = measure;'));
  let measuredSize = { width: 0, height: 0 };
  const backdrop = { getBoundingClientRect: () => ({ width: 2560, height: 1205 }) };
  const measure = new Function('node', 'setSceneSize', 'setViewport', `${measureSource}; return measure;`)(
    { getBoundingClientRect: backdrop.getBoundingClientRect, querySelector: selector => selector === '.world-backdrop' ? backdrop : null, style: { setProperty() {} } },
    next => { measuredSize = typeof next === 'function' ? next(measuredSize) : next; }, () => assert.fail('An absent map must not update its region viewport'),
  );
  measure(); assert.deepEqual(measuredSize, { width: 2560, height: 1205 }, 'Scene size must update even while the map is hidden');
  const previousSize = measuredSize; measure(); assert.strictEqual(measuredSize, previousSize, 'Unchanged measurements must reuse state');
  const loaderSource = appSource.slice(appSource.indexOf('const loadMapScene = '), appSource.indexOf('const ComponentLibrary = ')).replace("import('./MapScene')", 'load()');
  const makeLazy = new Function('lazy', 'load', `${loaderSource}; return { MapScene, loadMapScene };`);
  const preloadSource = appSource.split('\n').find(line => line.includes('void loadMapScene()'));
  assert(preloadSource, 'Visible maps must preload independently of GeoJSON readiness');
  const preload = new Function('useEffect', 'config', 'loadMapScene', preloadSource);
  const boundarySource = appSource.slice(appSource.indexOf('class MapErrorBoundary '), appSource.indexOf('const BoundWidget = '));
  const mapBranch = appSource.match(/\{(loaded && config\.map\.visible && [^\n]+?)\}<\/div>/)?.[1];
  assert(mapBranch, 'The canvas must remain conditional on loaded data and map visibility');
  const [{ code: boundaryCode }, { code: branchCode }] = await Promise.all([
    transformWithEsbuild(boundarySource, 'MapErrorBoundary.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false }),
    transformWithEsbuild(`const branch = ${mapBranch};`, 'MapBranch.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false }),
  ]);
  // HTML tags become inert groups only in this check; React still owns Suspense and error handling.
  const h = (type, props, ...children) => typeof type === 'string'
    ? createElement('group', { ...props, name: props?.className || type, userData: { role: props?.role, text: children.filter(child => typeof child === 'string').join('') } }, ...children.filter(child => typeof child !== 'string'))
    : createElement(type, props, ...children);
  const Boundary = new Function('Component', 'h', `${boundaryCode}; return MapErrorBoundary;`)(Component, h);
  const renderMap = new Function('h', 'MapErrorBoundary', 'Suspense', 'MapScene', 'context', `const { loaded, config, layers, pickFeature, setHover, command, quality, captureTelemetry, viewport, sceneSize } = context; ${branchCode}; return branch;`);
  const context = { sceneSize: { width: 2560, height: 1205 }, loaded: { data: {}, roads: {}, code: '100000' }, config: { map: { visible: false } }, layers: {}, pickFeature() {}, setHover() {}, command: { type: 'reset', sequence: 1 }, quality: 'high', captureTelemetry() {}, viewport: { x: .2, y: .1, width: .8, height: .7 } };
  let loads = 0, received;
  const loadedMap = makeLazy(lazy, async () => { loads++; return { MapScene: props => { received = props; return createElement('group', { name: 'loaded-map' }); } }; });
  preload(effect => effect(), context.config, loadedMap.loadMapScene);
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert.equal(loads, 0, 'Hidden maps must neither preload nor render the engine');
  const loadedData = context.loaded; context.loaded = null; context.config.map.visible = true;
  preload(effect => effect(), context.config, loadedMap.loadMapScene);
  assert.equal(loads, 1, 'Visible maps must start the engine before GeoJSON completes');
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert.equal(scene.children.length, 0, 'The scene still waits for GeoJSON before mounting');
  context.loaded = loadedData;
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert(scene.getObjectByName('loaded-map'));
  assert.strictEqual(received.data, context.loaded.data); assert.strictEqual(received.roadData, context.loaded.roads);
  assert.strictEqual(received.sceneSize, context.sceneSize); assert.strictEqual(received.viewport, context.viewport); assert.strictEqual(received.layers, context.layers);
  assert.strictEqual(received.command, context.command); assert.equal(received.quality, 'high');
  await act(async () => root.render(null));
  const failure = new Error('Map chunk unavailable'), failedMap = makeLazy(lazy, () => Promise.reject(failure));
  preload(effect => effect(), context.config, failedMap.loadMapScene);
  await new Promise(resolve => setImmediate(resolve)); // An unhandled preload rejection would fail this Node process.
  await act(async () => root.render(renderMap(h, Boundary, Suspense, failedMap.MapScene, context)));
  assert(scene.getObjectByName('map-error'), 'Chunk failures must reach the original outer error UI');
  assert.equal(scene.getObjectByName('map-error').userData.role, 'alert');
  assert.equal(scene.getObjectByName('small').userData.text, failure.message);
  assert(reportedErrors.length && reportedErrors.every(error => error === failure), 'React must report only the expected caught import failure');
  console.log('PASS: hidden maps skip engine loading; visible preloads preserve props; chunk failures reach the original error boundary.');

  // Reuse this real React root to exercise the complete widget and its lazy chart boundary.
  const [widgetSource, React, widgetHelpers, { DATA_FIELDS }] = await Promise.all([
    readFile(new URL('../src/DashboardWidget.jsx', import.meta.url), 'utf8'), import('react'), import('../src/widgetData.js'), import('../src/dataSources.js'),
  ]);
  const { code: widgetCode } = await transformWithEsbuild(widgetSource.slice(widgetSource.indexOf('const PALETTE = ')).replace("import('./ProfessionalChart.jsx')", 'load()').replace('export const DashboardWidget', 'const DashboardWidget'), 'DashboardWidget.jsx', { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Fragment', sourcemap: false });
  const widgetH = (type, props, ...children) => h(type, typeof type === 'string' ? { key: props?.key, className: props?.className, role: props?.role, onClick: props?.onClick } : props, ...children);
  const widgetRuntime = { ...widgetHelpers, DATA_FIELDS, number: widgetHelpers.formatWidgetNumber, Component, lazy, Suspense, h: widgetH, Fragment: React.Fragment, memo: React.memo, useEffect: React.useEffect, useId: React.useId, useMemo: React.useMemo, useState: React.useState };
  let reloads = 0;
  const makeWidget = load => new Function(...Object.keys(widgetRuntime), 'load', 'location', `${widgetCode}; return DashboardWidget;`)(...Object.values(widgetRuntime), load, { reload: () => reloads++ });
  const chartData = { rows: [{ name: '真实点', value: 12 }], value: 12 }, metricData = { value: 42, rows: [] };
  const widgetTree = (Widget, type) => createElement(React.Fragment, null,
    createElement('group', { name: 'sibling-map', key: 'map' }, createElement(WorldProbe)),
    createElement(Widget, { key: 'metric', config: { id: 'metric', type: 'metric', title: '保留指标' }, data: metricData }),
    createElement(Widget, { key: 'chart', config: { id: 'chart', type, title: '专业图表' }, data: chartData }),
  );
  let rejectChunk, chartLoads = 0;
  const chunkFailure = new Error('Professional chart chunk unavailable');
  const RejectedWidget = makeWidget(() => { chartLoads++; return new Promise((_, reject) => { rejectChunk = reject; }); });
  await act(async () => root.render(widgetTree(RejectedWidget, 'multiLine')));
  const siblingMap = scene.getObjectByName('sibling-map'), siblingMesh = siblingMap.children[0];
  const siblingMetric = scene.getObjectByName('dashboard-widget widget-type-metric widget-surface-glass');
  await act(async () => rejectChunk(chunkFailure));
  const chartError = scene.getObjectByName('widget-empty');
  assert.equal(chartError?.userData.role, 'alert');
  assert.strictEqual(scene.getObjectByName('sibling-map'), siblingMap);
  assert.strictEqual(siblingMap.children[0], siblingMesh, 'A rejected chart chunk must not unmount its real map sibling');
  assert.strictEqual(scene.getObjectByName('dashboard-widget widget-type-metric widget-surface-glass'), siblingMetric);
  chartError.getObjectByName('button').__r3f.handlers.onClick();
  assert.equal(reloads, 1, 'Recovery explicitly reloads the page rather than retrying a cached rejection');
  assert.equal(chartLoads, 1);
  await act(async () => root.render(widgetTree(RejectedWidget, 'text')));
  assert.equal(scene.getObjectByName('widget-empty')?.userData.role, 'status', 'Changing to an ordinary widget leaves the chart boundary');
  assert(scene.getObjectByName('dashboard-widget widget-type-text widget-surface-glass'));
  assert.equal(chartLoads, 1, 'Changing widget types must not start an automatic import retry');

  const renderFailure = new Error('Professional chart render failure');
  let healthy = false;
  const RenderWidget = makeWidget(async () => ({ default: ({ config }) => {
    if (!healthy) throw renderFailure;
    return createElement('group', { name: `loaded-chart-${config.type}` });
  } }));
  await act(async () => root.render(widgetTree(RenderWidget, 'radar')));
  assert.equal(scene.getObjectByName('widget-empty')?.userData.role, 'alert');
  healthy = true;
  await act(async () => root.render(widgetTree(RenderWidget, 'radar')));
  assert.equal(scene.getObjectByName('widget-empty')?.userData.role, 'alert', 'An unchanged failed type stays contained until explicit recovery');
  await act(async () => root.render(widgetTree(RenderWidget, 'heatmap')));
  assert(scene.getObjectByName('loaded-chart-heatmap'), 'Changing the type key clears the old rendering error');
  assert.equal(scene.getObjectByName('widget-empty'), undefined);
  assert(reportedErrors.includes(chunkFailure) && reportedErrors.includes(renderFailure));
  assert(reportedErrors.every(error => [failure, chunkFailure, renderFailure].includes(error)), 'Only intentional caught errors may be reported');
  console.log('PASS: real React chart import/render failures preserve map and metric siblings; explicit reload and ordinary/type-key recovery work.');
} finally {
  await act(async () => root.unmount());
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
