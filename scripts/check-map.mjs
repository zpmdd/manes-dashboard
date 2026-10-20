import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { act, Component, createElement, lazy, Profiler, Suspense } from 'react';
import { createRoot, extend, getRootState } from '@react-three/fiber';
import * as THREE from 'three';
import { createServer, transformWithEsbuild } from 'vite';
import { createDataSourceController, validateSourceUrl, getMappedData, parseSourceContent } from '../src/dataSources.js';
import { normalizeConfig } from '../src/dashboardConfig.js';
import { DEFAULT_THEME, THEMES } from '../src/themes.js';
import { layoutLabels, lineage, shortName } from '../src/geo.js';
import { EMPTY_VEHICLES, vehicleDataResult, VEHICLE_FIELDS, linkedVehicles as resolveVehicles, groupVehiclePoints, vehicleDistrict, vehicleLocationLabel, vehicleCalloutPosition } from '../src/vehicles.js';
import { atlasGrid, roadmapMaterial, viewAtlas } from '../src/useRoadmap.js';

import VEHICLES from '../src/projects/daoyan-vehicles.json' with { type: 'json' };
const linkedVehicles = code => resolveVehicles(code, VEHICLES);

// Exercise the real R3F components without a browser or a GPU render loop.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
extend(THREE);
const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, logLevel: 'error' });
const reportedErrors = [], previousReporter = globalThis.reportError;
globalThis.reportError = error => reportedErrors.push(error);
const root = createRoot({});
if (previousReporter === undefined) delete globalThis.reportError; else globalThis.reportError = previousReporter;
try {
  const { RegionMesh, ClusterPoints, Beacons, modelFor, heatPointsFor, beaconPointsFor, vehicleBounds, districtVehicleBounds, vehicleDetailVisible, fitMapViewport, updateMapClipping, mapPixelRatio, MapScene } = await vite.ssrLoadModule('/src/MapScene.jsx');
  const mapSource = await readFile(new URL('../src/MapScene.jsx', import.meta.url), 'utf8');
  const labelExpression = mapSource.split('\n').find(line => line.includes('{layers.labels && model.regions'))?.trim().slice(1, -1);
  assert(labelExpression, 'National labels must have an independent rendering path');
  const { code: labelCode } = await transformWithEsbuild(`(national, layers, model) => (${labelExpression})`, 'province-labels.jsx', { loader: 'jsx', jsx: 'transform', jsxFactory: 'createElement' });
  let labelInvalidations = 0;
  const renderLabels = new Function('createElement', 'Html', 'shortName', 'TOP', 'labelPortal', 'invalidate', `return ${labelCode}`)(createElement, 'html', shortName, .36, { current: null }, () => { labelInvalidations++; });
  const nationalData = JSON.parse(await readFile(new URL('../public/data/regions/100000.json', import.meta.url), 'utf8'));
  const labelModel = { scale: 1, regions: nationalData.features.map(feature => ({ feature, anchor: [0, .36, 0] })) };
  const provinceNames = nationalData.features.filter(f => f.properties.name).map(f => shortName(f.properties.name));
  assert.equal(provinceNames.length, 34);
  for (const beacons of [true, false]) {
    const provinceLabels = renderLabels(true, { labels: true, beacons }, labelModel);
    assert.deepEqual(provinceLabels.map(element => element.props.children.props.children), provinceNames, 'All 34 province-level names must remain visible regardless of beacons');
    assert(provinceLabels.every(element => element.props.style.pointerEvents === 'none'), 'Labels must allow map dragging and selection through them');
    provinceLabels[0].props.children.props.ref({});
    assert(labelInvalidations > 0, 'Labels mounted by the HTML portal must request a frame for initial collision layout');
    assert.equal(renderLabels(true, { labels: false, beacons }, labelModel), false, 'The labels switch must hide province names');
  }
  assert.equal(renderLabels(false, { labels: true }, labelModel).length, 34, 'Surrounding province labels remain available during drill-down');
  console.log('PASS: all 34 province names, independent beacon and label switches, pointer passthrough and surrounding labels.');
  const collections = [{ code: '100000', data: nationalData }], models = [modelFor(nationalData, '100000', collections, VEHICLES)];
  for (const code of ['420000', '420300', '420381']) {
    let data;
    if (code === '420381') data = { ...collections.at(-1).data, features: collections.at(-1).data.features.filter(f => String(f.properties.adcode) === code) };
    else { data = JSON.parse(await readFile(new URL(`../public/data/regions/${code}.json`, import.meta.url), 'utf8')); collections.push({ code, data }); }
    const model = modelFor(data, code, collections, VEHICLES), parent = models.at(-1);
    assert.deepEqual(model.project([111, 32]), models[0].project([111, 32]), 'Every level must keep the same coordinates for smooth camera zoom');
    assert(model.regions.some(r => String(r.feature.properties.adcode) === '610000' && !r.focused), 'Neighboring provinces must remain in the scene');
    assert.deepEqual(model.regions.filter(r => r.focused).map(r => r.feature.properties.adcode), data.features.map(f => f.properties.adcode), 'Only the current region or its children are highlighted');
    assert(!model.regions.some(r => collections.slice(1).some(c => c.code === String(r.feature.properties.adcode))), 'Expanded parent meshes must not overlap their children');
    assert.equal(model.backdrops.length, collections.length - 1, 'Every expanded ancestor needs one lower cap to fill simplification gaps');
    for (const geometry of model.backdrops) { geometry.computeBoundingBox(); assert(geometry.boundingBox.max.y < model.bounds.min.y, 'Gap covers must stay below the focused surface'); }
    assert(model.bounds.getSize(new THREE.Vector3()).length() < parent.bounds.getSize(new THREE.Vector3()).length(), 'Focus bounds must shrink through province, city and district');
    assert.equal(renderLabels(false, { labels: true }, model).filter(el => el.props.children.props.className.includes('is-focused')).length, data.features.length);
    if (code === '420381') assert(model.regions.some(r => String(r.feature.properties.adcode) === '420322' && !r.focused), 'A leaf focus must preserve its neighboring districts');
    models.push(model);
  }
  console.log('PASS: national → Hubei → Shiyan → Danjiangkou retain context, highlight the focus and share fixed coordinates.');
  const baseModel = modelFor(nationalData, '100000', collections);
  assert.equal(baseModel.vehicles.length, 0, 'The shared map never supplies project vehicles implicitly');
  const demoHeat = [{ name: '演示节点', position: [0, .36, 0] }];
  assert.strictEqual(heatPointsFor(baseModel, demoHeat, false), demoHeat, 'Base heat retains its demo source');
  assert.deepEqual(heatPointsFor(baseModel, demoHeat, true), [], 'Empty vehicle data must never fall back to demo heat');
  assert.deepEqual(heatPointsFor(models[0], demoHeat, true), [], 'Unprocessed GPS rows must not imply algorithm clusters');
  for (const model of models) {
    const clusteredModel = { ...model, vehicles: model.vehicles.map((point, i) => ({ ...point, vehicle: { ...point.vehicle, CLUSTER_LABEL: i < 4 ? 0 : -1 } })) };
    const heat = heatPointsFor(clusteredModel, demoHeat, true);
    assert.deepEqual(heat.map(point => point.name), VEHICLES.slice(0, 4).map(row => row.VEHICLENO), 'Heat includes cluster zero and excludes noise');
    assert.deepEqual(heat.map(point => [point.position[0], point.position[2]]), VEHICLES.slice(0, 4).map(row => { const [x, y] = model.project([row.GEO_LON, row.GEO_LAT]); return [x, -y]; }), 'Cluster heat stays at member GPS coordinates through drill-down');
    assert.deepEqual(heatPointsFor({ ...model, vehicles: model.vehicles.map(point => ({ ...point, vehicle: { ...point.vehicle, CLUSTER_LABEL: -1 } })) }, demoHeat, true), [], 'No clusters means no heat, including after parameter or window changes');
  }
  const changedHeatModel = modelFor(nationalData, '100000', [{ code: '100000', data: nationalData }], [{ ...VEHICLES[0], VEHICLENO: 'NEW', GEO_LON: 108.94, GEO_LAT: 34.34, CLUSTER_LABEL: 1 }]);
  const changedHeat = heatPointsFor(changedHeatModel, demoHeat, true);
  assert.equal(changedHeat.length, 1); assert.equal(changedHeat[0].name, 'NEW');
  assert.notDeepEqual(changedHeat[0].position, models[0].vehicles[0].position, 'Replacing vehicles moves heat and removes obsolete points');
  changedHeatModel.regions.forEach(region => region.geometry.dispose()); changedHeatModel.backdrops.forEach(geometry => geometry.dispose());
  console.log('PASS: heat uses only DBSCAN members at actual GPS coordinates; noise, pending analysis and zero clusters never create heat.');
  baseModel.regions.forEach(region => region.geometry.dispose()); baseModel.backdrops.forEach(geometry => geometry.dispose());
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 200);
  const vehicleModel = models[0], vehicleSize = { width: 1280, height: 720 }, vehicleViewport = { x: .21, y: .15, width: .78, height: .61 };
  assert.equal(VEHICLES.length, 5); assert.equal(VEHICLE_FIELDS.length, 17);
  const vehicleCanvas = normalizeConfig(JSON.parse(await readFile(new URL('../docs/daoyan-vehicles.canvas.json', import.meta.url), 'utf8')));
  const rawVehicleSource = vehicleCanvas.dataSources.find(source => source.id === vehicleCanvas.modules[0].binding.sourceId);
  const rawVehicles = parseSourceContent(rawVehicleSource.content, rawVehicleSource.type, rawVehicleSource.rowsPath);
  assert.deepEqual(rawVehicles.map(row => Object.fromEntries(VEHICLE_FIELDS.filter(([key]) => Object.hasOwn(row, key)).map(([key]) => [key, row[key]]))), VEHICLES, 'The page data and map use the same original fifteen-field snapshot');
  const cardData = vehicleCanvas.modules.map(item => {
    const source = vehicleCanvas.dataSources.find(source => source.id === item.binding.sourceId);
    return getMappedData({ rows: parseSourceContent(source.content, source.type, source.rowsPath) }, item.binding, item);
  });
  assert.deepEqual(vehicleCanvas.modules.map(item => item.layout), [{ x: 0, y: 0, w: 19, h: 32 }, { x: 0, y: 34, w: 19, h: 32 }, { x: 0, y: 68, w: 19, h: 32 }], 'The exported page preserves the saved three-card layout');
  assert.equal(cardData[0].value, VEHICLES.length);
  assert.deepEqual(cardData[1].rows.map(row => row.value), [1, 4]);
  assert.deepEqual(cardData[2].rows.map(row => row.value), VEHICLES.map(row => row.GPS_SPEED));
  for (const row of cardData.flatMap(data => data.rows)) assert(linkedVehicles(row.code)?.length, 'Every configured chart link resolves to actual vehicles');
  assert.deepEqual(VEHICLES.map(row => [row.GEO_LON, row.GEO_LAT]), [[116.522857, 39.862656], [116.522857, 39.8627], [116.522857, 39.863], [116.522858, 39.862656], [117.522858, 40]]);
  assert.equal(VEHICLES[2].GPS_SPEED, 10); assert.equal(VEHICLES[4].PALTE_COLOR, '2');
  for (const row of VEHICLES) {
    assert.deepEqual(Object.keys(row), VEHICLE_FIELDS.filter(([key]) => !['VEHICLE_TYPE', 'CARGO_TYPE'].includes(key)).map(([key]) => key));
    assert.equal(row.GEO_ALT, null); assert.equal(row.MILEAGE, null);
    assert.equal(row.ALARM_CODE, '00000000000000000000000000000011');
    assert.equal(row.STATE_CODE, '00000000000000000000000000000010');
  }
  camera.aspect = vehicleSize.width / vehicleSize.height;
  assert.deepEqual(linkedVehicles('vehicle:moving').map(v => v.VEHICLENO), ['3']);
  assert.deepEqual(linkedVehicles('vehicle:stopped').map(v => v.VEHICLENO), ['1', '2', '4', '5']);
  assert.equal(linkedVehicles('vehicle:all').length, 5);
  assert.equal(linkedVehicles('110000'), null);
  assert.equal(linkedVehicles('vehicle:99'), null);
  assert.equal(linkedVehicles('vehicle:5')[0].GPS_SPEED, 0, 'Stationary vehicles remain selectable');
  fitMapViewport(camera, vehicleModel.bounds, vehicleSize, vehicleViewport);
  assert.equal(vehicleDetailVisible(camera, vehicleModel.project, vehicleSize), false, 'National view uses breathing points');
  const points = vehicleModel.vehicles.map(({ position }, i) => {
    const p = new THREE.Vector3(...position).project(camera);
    return { i, x: (p.x + 1) * vehicleSize.width / 2, y: (1 - p.y) * vehicleSize.height / 2 };
  });
  assert.equal(groupVehiclePoints(points, false).flat().length, 5, 'Clustering preserves every vehicle');
  assert(groupVehiclePoints(points, false).length < 5, 'Nearly identical coordinates share an overview point');
  assert.equal(groupVehiclePoints(points, true).length, 5, 'Detail view separates all vehicle labels');
  const vehicleRegionIndex = JSON.parse(await readFile(new URL('../public/data/index.json', import.meta.url), 'utf8'));
  const readVehicleRegion = async code => JSON.parse(await readFile(new URL(`../public/data/regions/${code}.json`, import.meta.url), 'utf8'));
  const districts = await Promise.all(VEHICLES.map(vehicle => vehicleDistrict([vehicle], vehicleRegionIndex, readVehicleRegion)));
  assert.deepEqual(districts, ['110105', '110105', '110105', '110105', '120119'], 'Resolve actual boundaries, including municipalities without a city tier');
  assert.deepEqual(districts.map(code => vehicleLocationLabel(code, vehicleRegionIndex)), ['北京-北京-朝阳区', '北京-北京-朝阳区', '北京-北京-朝阳区', '北京-北京-朝阳区', '天津-天津-蓟州区']);
  assert.equal(vehicleLocationLabel('440106', vehicleRegionIndex), '广东-广州-天河区');
  assert.equal(vehicleLocationLabel(null, vehicleRegionIndex), '未匹配地区');
  assert.equal(await vehicleDistrict(VEHICLES.slice(0, 4), vehicleRegionIndex, readVehicleRegion), '110105', 'Overlapping groups stop at their shared district too');
  assert.equal(await vehicleDistrict(VEHICLES, vehicleRegionIndex, readVehicleRegion), null, 'Cross-district fleet focus stays separate from single-vehicle focus');
  assert.equal(await vehicleDistrict([{ GEO_LON: 0, GEO_LAT: 0 }], vehicleRegionIndex, readVehicleRegion), null);
  await assert.rejects(vehicleDistrict([VEHICLES[0]], vehicleRegionIndex, async () => { throw new DOMException('Cancelled', 'AbortError'); }), { name: 'AbortError' });
  for (const item of [null, ...VEHICLES]) {
    let bounds = vehicleBounds(vehicleModel.project, VEHICLES, vehicleModel.bounds.max.y), districtModel;
    if (item) {
      const district = districts[VEHICLES.indexOf(item)], parent = vehicleRegionIndex[district].parent;
      const data = await readVehicleRegion(parent);
      districtModel = modelFor({ ...data, features: data.features.filter(f => String(f.properties.adcode) === district) }, district, [{ code: '100000', data: nationalData }, { code: parent, data }], VEHICLES);
      bounds = districtVehicleBounds(districtModel.bounds, districtModel.project, item);
      assert(bounds.containsBox(districtModel.bounds), 'Centering a vehicle must retain the full district boundary');
      assert.equal(districtModel.vehicles.length, 5, 'Drill-down retains all vehicles, including those outside the viewport');
    }
    const frame = fitMapViewport(camera, bounds, vehicleSize, vehicleViewport);
    assert.equal(vehicleDetailVisible(camera, vehicleModel.project, vehicleSize), true, 'Fleet and individual focus reveal vehicle icons');
    assert(frame && camera.position.y > vehicleModel.bounds.max.y, 'Vehicle focus must remain above the map surface, including individual vehicles');
    if (item) {
      const position = districtModel.vehicles.find(point => point.vehicle.VEHICLENO === item.VEHICLENO).position;
      const centered = new THREE.Vector3(...position).project(camera);
      assert(Math.abs((centered.x + 1) / 2 - (frame.usable.left + frame.usable.right) / 2) < 1e-8);
      assert(Math.abs((1 - centered.y) / 2 - (frame.usable.top + frame.usable.bottom) / 2) < 1e-8, 'The selected vehicle, not the district centroid, is centered');
      districtModel.regions.forEach(region => region.geometry.dispose()); districtModel.backdrops.forEach(geometry => geometry.dispose());
    }
    const visible = item ? vehicleModel.vehicles.filter(point => point.vehicle.VEHICLENO === item.VEHICLENO) : vehicleModel.vehicles;
    const projected = visible.map(({ vehicle, position }) => {
      const [x, y] = vehicleModel.project([vehicle.GEO_LON, vehicle.GEO_LAT]);
      assert.equal(position[0], x); assert.equal(position[2], -y, 'Vehicle coordinates must never be offset to separate labels');
      const point = new THREE.Vector3(...position).project(camera);
      assert(point.z > -1 && point.z < 1, 'Vehicle must stay inside the camera clipping range');
      return { x: (point.x + 1) * vehicleSize.width / 2, y: (1 - point.y) * vehicleSize.height / 2, width: 44, height: 28 };
    });
    const labels = layoutLabels(projected, { left: vehicleViewport.x * vehicleSize.width, right: (vehicleViewport.x + vehicleViewport.width) * vehicleSize.width, top: (vehicleViewport.y + vehicleViewport.height * .12) * vehicleSize.height, bottom: (vehicleViewport.y + vehicleViewport.height) * vehicleSize.height });
    assert(labels.every(label => !label.hidden), 'All five vehicles must remain individually selectable, even at nearly identical coordinates');
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      assert(Math.abs(a.x + a.dx - b.x - b.dx) >= 44 || Math.abs(a.y + a.dy - b.y - b.dy) >= 28, 'Vehicle labels must not overlap');
    }
  }
  const fleetPoints = Array.from({ length: 10000 }, (_, i) => ({ i, x: i % 100 * 12, y: Math.floor(i / 100) * 8, pinned: i === 9999 }));
  for (const detailed of [true, false]) {
    const groups = groupVehiclePoints(fleetPoints, detailed);
    assert(groups.length <= 64, 'Large fleets have bounded map labels');
    assert.deepEqual(groups.flat().map(point => point.i).sort((a, b) => a - b), fleetPoints.map(point => point.i), 'Screen grouping preserves all vehicle identities exactly once');
    assert.deepEqual(groups.find(group => group.some(point => point.pinned)), [fleetPoints[9999]], 'Selected vehicle stays individually selectable');
  }
  for (const bounds of [{ left: 280, right: 1200, top: 160, bottom: 680 }, { left: 18, right: 372, top: 180, bottom: 510 }]) {
    for (const x of [bounds.left + 10, (bounds.left + bounds.right) / 2, bounds.right - 10]) for (const y of [bounds.top + 10, (bounds.top + bounds.bottom) / 2, bounds.bottom - 10]) {
      const position = vehicleCalloutPosition({ x, y }, 260, 204, bounds);
      assert(position.left >= bounds.left && position.left + 260 <= bounds.right && position.top >= bounds.top && position.top + 204 <= bounds.bottom, 'Callouts stay inside desktop and narrow map viewports');
      assert(position.x >= position.left && position.x <= position.left + 260 && position.y >= position.top && position.y <= position.top + 204, 'The leader ends on the information card');
    }
  }
  const narrowCallout = vehicleCalloutPosition({ x: 187.5, y: 371.4 }, 248, 150, { left: 20, right: 355, top: 178, bottom: 556 });
  assert(narrowCallout.top + 150 < 371.4 - 14, 'A compact callout leaves the centered vehicle visible in narrow containers');
  console.log('PASS: five vehicles retained, boundary-based district focus centered on selection, bounded callouts and overlapping label separation.');
  const viewports = [
    { size: { width: 1920, height: 1080 }, viewport: { x: .22, y: .14, width: .74, height: .55 } },
    { size: { width: 3840, height: 2160 }, viewport: { x: .22, y: .14, width: .74, height: .55 } },
    { size: { width: 1280, height: 900 }, viewport: { x: .08, y: .18, width: .3, height: .58 } },
    { size: { width: 1920, height: 1080 }, viewport: { x: .7, y: .42, width: .18, height: .19 } },
    { size: { width: 390, height: 844 }, viewport: { x: 0, y: .1, width: 1, height: .5 } },
  ];
  for (const bounds of models.map(model => model.bounds)) for (const viewDirection of [undefined, [0, 1, .011]]) for (const { size, viewport } of viewports) {
    camera.zoom = 4;
    const fitted = fitMapViewport(camera, bounds, size, viewport, viewDirection);
    const left = viewport.x + viewport.width * .08, right = viewport.x + viewport.width * .92;
    const top = viewport.y + viewport.height * .12, bottom = viewport.y + viewport.height;
    assert(fitted && Number.isFinite(fitted.distance), 'A usable viewport must produce a finite camera');
    const direction = camera.position.clone().sub(fitted.target);
    const elevation = THREE.MathUtils.radToDeg(Math.atan2(direction.y, Math.hypot(direction.x, direction.z)));
    assert(viewDirection ? elevation > 89 : elevation >= 50 && elevation <= 55, 'Framing must preserve the requested perspective or top view');
    assert.equal(camera.zoom, 1, 'Changing perspective must clear previous manual zoom');
    const projected = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera), screenX = (point.x + 1) / 2, screenY = (1 - point.y) / 2;
      projected.push({ x: screenX, y: screenY });
      assert(screenX >= left - 1e-8 && screenX <= right + 1e-8 && screenY >= top - 1e-8 && screenY <= bottom + 1e-8, 'Every geometry corner must fit with 8% side and 12% title margins');
      assert(point.z > -1 && point.z < 1, 'Fitted geometry must stay inside the near and far clipping planes');
    }
    assert(Math.max((Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) / (right - left), (Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y))) / (bottom - top)) > (viewDirection ? .97 : .85), 'Every focus must fill the usable container, allowing perspective foreshortening');
    const center = bounds.getCenter(new THREE.Vector3()).project(camera);
    assert(Math.abs((center.x + 1) / 2 - (left + right) / 2) < 1e-8);
    assert(Math.abs((1 - center.y) / 2 - (top + bottom) / 2) < 1e-8);
    const previousProjection = camera.projectionMatrix.clone();
    assert.equal(fitMapViewport(camera, bounds, size, undefined), null);
    assert.equal(fitMapViewport(camera, bounds, size, { ...viewport, width: 0 }), null);
    assert(camera.projectionMatrix.equals(previousProjection), 'An absent or empty viewport must not change the legacy camera');
  }
  const tileIndex = JSON.parse(await readFile(new URL('../public/roadmap/index.json', import.meta.url), 'utf8'));
  for (const [size, expected] of [[{ width: 977, height: 1255 }, [5, 8, 10, 10]], [{ width: 1920, height: 1080 }, [5, 9, 10, 10]]]) {
    const viewport = { x: .206, y: .15, width: .784, height: .618 };
    for (const [i, model] of models.entries()) {
      fitMapViewport(camera, model.bounds, size, viewport);
      const grid = viewAtlas(tileIndex, model.project, camera, size, viewport, 16384, 1.5);
      assert(grid.zoom >= expected[i], `Level ${i} at ${size.width}×${size.height} needs z${expected[i]}, got z${grid.zoom}`);
      if (i === 2 && size.width === 977) {
        const [x, y] = model.project([108.2, 34.34]), visible = new THREE.Vector3(x, .36, -y).project(camera);
        assert(visible.x > -1 && (visible.x + 1) / 2 < viewport.x, 'The regression point must be visible behind the left cards, outside the map panel');
        assert(grid.tiles.some(([tx, ty]) => tx === 819 && ty === 407), 'Visible background must use detail tiles too, without an enlarged overview seam');
      }
      const standard = viewAtlas(tileIndex, model.project, camera, size, viewport, 16384, 1);
      assert(grid.zoom >= standard.zoom, 'Renderer DPR must participate in tile level selection');
    }
  }
  console.log('PASS: province/city/county tile levels match native pixel size in portrait and landscape, including renderer DPR.');
  const xianCollections = [{ code: '100000', data: nationalData }];
  for (const code of ['610000', '610100']) xianCollections.push({ code, data: JSON.parse(await readFile(new URL(`../public/data/regions/${code}.json`, import.meta.url), 'utf8')) });
  const yantaData = { ...xianCollections.at(-1).data, features: xianCollections.at(-1).data.features.filter(f => String(f.properties.adcode) === '610113') };
  const yanta = modelFor(yantaData, '610113', xianCollections), target = yanta.bounds.getCenter(new THREE.Vector3());
  const backY = Math.max(...yanta.backdrops.map(g => { g.computeBoundingBox(); return g.boundingBox.max.y; }));
  const backdropExpression = mapSource.split('\n').find(line => line.includes('{model.backdrops.map')).trim().slice(1, -1);
  const { code: backdropCode } = await transformWithEsbuild(`model => (${backdropExpression})`, 'map-backdrops.jsx', { loader: 'jsx', jsx: 'transform', jsxFactory: 'createElement' });
  const renderBackdrops = new Function('createElement', 'theme', `return ${backdropCode}`)(createElement, DEFAULT_THEME);
  assert(renderBackdrops(yanta).every(el => el.props.children.props.polygonOffset && el.props.children.props.polygonOffsetFactor >= 1 && el.props.children.props.polygonOffsetUnits >= 4), 'Gap caps need a depth bias when distant surfaces share a depth-buffer value');
  for (const elevation of [89.37, 50.71, 5.1]) for (const distance of [.0191, .095, .5167, 5, 30, 90]) for (const zoom of [.6, 1, 4]) {
    camera.clearViewOffset(); camera.aspect = 2547 / 1192; camera.zoom = zoom;
    camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(elevation * Math.PI / 180) * distance, Math.cos(elevation * Math.PI / 180) * distance));
    camera.lookAt(target); camera.updateMatrixWorld(); camera.near = .00009509142985802406;
    updateMapClipping(camera, target, yanta.bounds.max.y);
    assert(camera.near > distance * .04 && camera.near <= (camera.position.y - yanta.bounds.max.y) / 2, 'Clipping must track the live distance without clipping the nearby map surface');
    const surface = new THREE.Vector3(target.x, .36, target.z).project(camera), backing = new THREE.Vector3(target.x, backY, target.z).project(camera);
    assert(surface.z > -1 && surface.z < 1 && backing.z > surface.z);
    if (distance <= .5167) assert((backing.z - surface.z) / 2 * (2 ** 24 - 1) > 16, 'The reported district zoom needs enough depth precision to separate surfaces');
    assert.equal(camera.zoom, zoom, 'Clipping updates must preserve the user zoom');
  }
  yanta.regions.forEach(r => r.geometry.dispose()); yanta.backdrops.forEach(g => g.dispose());
  console.log('PASS: Yanta district zoom/retreat at three elevations and three zoom factors preserves clipping, depth separation and biased gap caps.');
  models.forEach(model => { model.regions.forEach(region => region.geometry.dispose()); model.backdrops.forEach(geometry => geometry.dispose()); });
  console.log('PASS: 320 real Three projections cover four levels, both perspectives, five container sizes, prior zoom, complete fit and fill.');
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
  function WorldProbe({ selected = false, roadmap, theme = DEFAULT_THEME }) {
    worldRenders++;
    return regions.map((region, i) => createElement(Profiler, { id: String(i), key: i, onRender: () => commits[i]++ }, createElement(RegionMesh, { region, selected: selected && i === 0, onSelect, onHover, roadmap, theme })));
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
  const baseAtlas = { ...atlasGrid(tileIndex, 5), texture: new THREE.Texture() };
  const roadmap = roadmapMaterial(baseAtlas, null, models[0].project);
  await act(async () => root.render(createElement(WorldProbe, { roadmap })));
  const rasterCap = first.material[0];
  assert(rasterCap.isMeshBasicMaterial && !rasterCap.toneMapped && !rasterCap.fog, 'Raster text must retain contrast without lighting or tone mapping');
  assert.equal(rasterCap.color.getHexString(), 'ffffff');
  assert.strictEqual(first.material[1], materials[1], 'The extruded side must retain its original 3D material');
  await act(async () => first.__r3f.handlers.onPointerOver(event()));
  assert.strictEqual(first.material[0], rasterCap);
  assert.equal(rasterCap.color.getHexString(), 'ffedc5', 'Raster hover must remain visible');
  await act(async () => { first.__r3f.handlers.onPointerOut(); root.render(createElement(WorldProbe)); });
  assert(first.material[0].isMeshStandardMaterial && first.material[0].toneMapped, 'Turning off the raster layer must restore the original cap');
  baseAtlas.texture.dispose();
  console.log('PASS: unlit raster contrast, hover reuse, original 3D sides and material restoration after layer toggle.');
  const themedCap = first.material[0], geometry = first.geometry;
  for (const theme of THEMES) {
    await act(async () => root.render(createElement(WorldProbe, { theme })));
    assert.equal(first.material[0].color.getHexString(), theme.map.land.slice(1));
    assert.equal(first.material[1].color.getHexString(), theme.map.side.slice(1));
    assert.strictEqual(first.geometry, geometry); assert.strictEqual(first.material[0], themedCap);
  }
  await act(async () => root.render(createElement(WorldProbe)));
  console.log('PASS: all eight themes update real R3F surfaces while reusing geometry and materials.');

  const clusterPoints = Array.from({ length: 40 }, (_, label) => ({ label, center: [100 + label * .1, 30], vehicleCount: label + 2 }));
  const clusterModel = { project: models[0].project, scale: 1 }, clusterSelections = [];
  await act(async () => root.render(createElement(ClusterPoints, { clusters: clusterPoints, model: clusterModel, onSelect: value => clusterSelections.push(value) })));
  const clusterMesh = scene.getObjectByName('cluster-points'), matrix = new THREE.Matrix4();
  assert.equal(clusterMesh.count, 40, 'All algorithm centers remain visible beyond the 24 text-label cap');
  clusterPoints.forEach((cluster, i) => {
    clusterMesh.getMatrixAt(i, matrix);
    const [x, y] = clusterModel.project(cluster.center);
    assert(Math.abs(matrix.elements[12] - x) < 1e-5 && Math.abs(matrix.elements[14] + y) < 1e-5, 'Each point uses its own algorithm center');
  });
  clusterMesh.__r3f.handlers.onClick({ instanceId: 39, delta: 0, stopPropagation() {} });
  clusterMesh.__r3f.handlers.onClick({ instanceId: 1, delta: 6, stopPropagation() {} });
  assert.deepEqual(clusterSelections, ['cluster:39'], 'Unlabelled centers select the correct cluster; camera drags do not select');
  await act(async () => root.render(createElement(ClusterPoints, { clusters: [clusterPoints[2]], model: clusterModel, onSelect() {} })));
  assert.equal(scene.getObjectByName('cluster-points').count, 1, 'Changing the analysis replaces old centers');
  await act(async () => root.render(createElement(ClusterPoints, { clusters: [], model: clusterModel, onSelect() {} })));
  assert(!scene.getObjectByName('cluster-points'), 'A zero-cluster window leaves no obsolete points');
  console.log('PASS: all 40 cluster centers share one draw batch, retain coordinates and click linkage, and clear on empty results.');

  const beaconGlobalNames = ['document', 'matchMedia', 'setInterval', 'clearInterval'];
  const beaconGlobals = Object.fromEntries(beaconGlobalNames.map(name => [name, globalThis[name]]));
  const pulseListeners = new Map(), visibilityListeners = new Map(), pulseTimers = new Map(); let pulseTimerId = 0;
  const pulsePreference = { matches: true, addEventListener: (name, fn) => pulseListeners.set(name, fn), removeEventListener: name => pulseListeners.delete(name) };
  globalThis.document = { hidden: false, addEventListener: (name, fn) => visibilityListeners.set(name, fn), removeEventListener: name => visibilityListeners.delete(name) };
  globalThis.matchMedia = () => pulsePreference;
  globalThis.setInterval = (fn, delay) => { assert.equal(delay, 100, 'Soft breathing uses a low frequency timer'); pulseTimers.set(++pulseTimerId, fn); return pulseTimerId; };
  globalThis.clearInterval = id => pulseTimers.delete(id);
  const demoBeacons = [{ position: [1, .395, 2], height: .85 }], beaconSelections = [];
  assert.strictEqual(beaconPointsFor(clusterModel, demoBeacons, [], false), demoBeacons, 'Base keeps its original demo pillars');
  assert.deepEqual(beaconPointsFor(clusterModel, demoBeacons, [], true), [], 'No algorithm clusters must never fall back to demo pillars');
  for (const model of models) {
    const points = beaconPointsFor(model, demoBeacons, clusterPoints, true);
    assert.equal(points.length, clusterPoints.length);
    assert(points.every(point => point.height === .95), 'Cluster pillars use the compact soft-light profile without changing cluster coordinates');
    assert.deepEqual(points.map(point => [point.position[0], point.position[2]]), clusterPoints.map(cluster => { const [x, y] = model.project(cluster.center); return [x, -y]; }), 'Pillars retain algorithm centers through drill-down');
  }
  const renderBeacons = (points, selected, clustered = true, theme = DEFAULT_THEME) => act(async () => root.render(createElement(Beacons, { points, scale: .5, selected, clustered, theme, onSelect: value => beaconSelections.push(value) })));
  const pillars = beaconPointsFor(clusterModel, demoBeacons, clusterPoints, true);
  await renderBeacons(pillars);
  const beaconGroup = scene.getObjectByName('monitor-beacons');
  assert.equal(beaconGroup.children.length, 4, 'All cluster pillars share four draw batches for soft feet, thin cores, halos and round tips');
  assert(beaconGroup.children.every(mesh => mesh.isInstancedMesh && mesh.count === 40));
  pillars.forEach((point, i) => {
    beaconGroup.children.forEach(mesh => {
      mesh.getMatrixAt(i, matrix);
      assert(Math.abs(matrix.elements[12] - point.position[0]) < 1e-5 && Math.abs(matrix.elements[14] - point.position[2]) < 1e-5, 'Every visual part remains at the algorithm center');
    });
    beaconGroup.children[1].getMatrixAt(i, matrix);
    assert(Math.abs(matrix.elements[13] - (point.position[1] + point.height * .25)) < 1e-5, 'The pillar sits on the map with its full height');
  });
  const [foot, coreMesh, halo, tip] = beaconGroup.children;
  assert.equal(foot.geometry.type, 'PlaneGeometry'); assert.equal(foot.material.type, 'ShaderMaterial');
  assert(foot.material.transparent && !foot.material.depthWrite, 'The soft foot blends into the map without occluding neighboring features');
  assert.equal(foot.material.uniforms.opacity.value, .34);
  assert.equal(coreMesh.geometry.parameters.radiusTop, coreMesh.geometry.parameters.radiusBottom, 'The thin core is a straight cylinder');
  assert(coreMesh.geometry.parameters.radiusTop <= .02);
  assert.equal(halo.geometry.parameters.radiusTop, halo.geometry.parameters.radiusBottom, 'Soft light has no tapered flare'); assert(halo.material.opacity <= .12);
  assert.equal(tip.geometry.type, 'SphereGeometry'); assert(tip.geometry.parameters.radius <= .04, 'The tip is a small round light, without a diamond or outline shell');
  assert(beaconGroup.children.every(({ material }) => !material.fog && !material.toneMapped), 'Fog and tone mapping must not wash out the cluster marker colors');
  assert.equal(pulseTimers.size, 0, 'Reduced-motion preference keeps the soft pillars static');
  beaconGroup.__r3f.handlers.onClick({ instanceId: 39, delta: 0, stopPropagation() {} });
  beaconGroup.__r3f.handlers.onClick({ instanceId: 1, delta: 6, stopPropagation() {} });
  assert.deepEqual(beaconSelections, ['cluster:39'], 'Pillars beyond the text cap locate the correct cluster and ignore drags');
  await renderBeacons(pillars, 'cluster:39');
  beaconGroup.children[3].getMatrixAt(39, matrix); assert(Math.abs(matrix.elements[0] - .7) < 1e-5, 'Cluster selection highlights its pillar');
  await renderBeacons([pillars[2]]);
  assert(scene.getObjectByName('monitor-beacons').children.every(mesh => mesh.count === 1), 'Changing windows removes old pillars');
  await renderBeacons([]); assert(!scene.getObjectByName('monitor-beacons'), 'Zero clusters clears every pillar');
  await renderBeacons(pillars);
  const originalClusterGroup = scene.getObjectByName('monitor-beacons'), originalClusterMeshes = [...originalClusterGroup.children];
  const themeCoreColors = new Set();
  for (const theme of THEMES) {
    await renderBeacons(pillars, undefined, true, theme);
    const current = scene.getObjectByName('monitor-beacons');
    assert.strictEqual(current, originalClusterGroup, 'Theme changes retain the cluster batches');
    current.children.forEach((mesh, i) => assert.strictEqual(mesh, originalClusterMeshes[i]));
    themeCoreColors.add(current.children[1].material.color.getHexString());
    assert.equal(current.children.length, 4);
    assert.equal(current.children[0].material.uniforms.color.value.getHexString(), current.children[1].material.color.getHexString(), 'The soft foot follows the active theme core color');
  }
  assert.equal(themeCoreColors.size, THEMES.length, 'Every theme updates the actual cluster-core material');
  await renderBeacons(pillars);
  const breathingGroup = scene.getObjectByName('monitor-beacons'), staticMatrices = breathingGroup.children.map(mesh => Array.from(mesh.instanceMatrix.array));
  pulsePreference.matches = false; pulseListeners.get('change')(); assert.equal(pulseTimers.size, 1);
  pulseTimers.values().next().value();
  assert(breathingGroup.children[0].material.uniforms.opacity.value >= .34 * .8 && breathingGroup.children[0].material.uniforms.opacity.value <= .34);
  assert(breathingGroup.children[2].material.opacity >= .12 * .8 && breathingGroup.children[2].material.opacity <= .12);
  assert.deepEqual(breathingGroup.children.map(mesh => Array.from(mesh.instanceMatrix.array)), staticMatrices, 'Breathing changes opacity without shifting or resizing any GPS marker');
  document.hidden = true; visibilityListeners.get('visibilitychange')();
  assert.equal(pulseTimers.size, 0, 'Hidden pages stop the breathing timer'); assert.equal(breathingGroup.children[0].material.uniforms.opacity.value, .34); assert.equal(breathingGroup.children[2].material.opacity, .12);
  document.hidden = false; visibilityListeners.get('visibilitychange')(); assert.equal(pulseTimers.size, 1);
  pulsePreference.matches = true; pulseListeners.get('change')(); assert.equal(pulseTimers.size, 0, 'Enabling reduced motion stops an already active timer');
  pulsePreference.matches = false; pulseListeners.get('change')(); assert.equal(pulseTimers.size, 1);
  await renderBeacons([]); assert.equal(pulseTimers.size, 0, 'An empty result stops animation');
  await renderBeacons(pillars); assert.equal(pulseTimers.size, 1);
  await act(async () => root.render(null));
  assert.equal(pulseTimers.size, 0); assert.equal(pulseListeners.size, 0); assert.equal(visibilityListeners.size, 0, 'Unmount removes timers and all preference/visibility listeners');
  await renderBeacons(demoBeacons, undefined, false);
  const baseBeaconGroup = scene.getObjectByName('monitor-beacons');
  assert.equal(baseBeaconGroup.children.length, 4, 'Base keeps its original four batches');
  const baseGeometries = [new THREE.RingGeometry(.11, .15, 32), new THREE.CylinderGeometry(.028, .028, 1, 5), new THREE.CylinderGeometry(.07, .12, 1, 8, 1, true), new THREE.SphereGeometry(.068, 12, 8)];
  baseBeaconGroup.children.forEach((mesh, i) => { assert.equal(mesh.geometry.type, baseGeometries[i].type); assert.deepEqual(mesh.geometry.parameters, baseGeometries[i].parameters, 'Base geometry dimensions remain unchanged'); baseGeometries[i].dispose(); });
  assert.deepEqual(baseBeaconGroup.children.map(({ material }) => [material.color.getHexString(), material.transparent, material.opacity, material.toneMapped, material.depthWrite, material.side, material.fog]), [
    ['efe3bb', true, .65, false, true, THREE.FrontSide, true], ['fff0ce', false, 1, false, true, THREE.FrontSide, true], ['ebd8a3', true, .13, true, false, THREE.DoubleSide, true], ['fff6db', false, 1, false, true, THREE.FrontSide, true],
  ], 'Base keeps the original ring/core/halo/tip colors and material behavior');
  baseBeaconGroup.children[1].getMatrixAt(0, matrix);
  assert(Math.abs(matrix.elements[5] - .425) < 1e-5, 'Base pillar heights and scaling are preserved');
  assert.equal(pulseTimers.size, 0, 'Base pillars do not start animation');
  for (const name of beaconGlobalNames) { if (beaconGlobals[name] === undefined) delete globalThis[name]; else globalThis[name] = beaconGlobals[name]; }
  console.log('PASS: four soft-light pillar batches preserve centers/clicks/selection, theme updates and base materials; breathing stops for empty/hidden/reduced-motion/unmounted states.');

  const beaconGate = mapSource.split('\n').find(line => line.includes('<Beacons points='))?.trim().slice(1, -1);
  const { code: beaconGateCode } = await transformWithEsbuild(`const branch = ${beaconGate};`, 'beacon-mode.jsx', { loader: 'jsx', jsxFactory: 'createElement', sourcemap: false });
  const renderBeaconGate = new Function('createElement', 'Beacons', 'layers', 'beaconPoints', 'model', 'theme', 'vehicleHighlight', 'onClusterSelect', 'vehicleHeat', `${beaconGateCode}; return branch;`);
  for (const vehicleHeat of [false, true]) {
    const onClusterSelect = () => {};
    const element = renderBeaconGate(createElement, Beacons, { beacons: true }, pillars, clusterModel, DEFAULT_THEME, 'vehicle:all', onClusterSelect, vehicleHeat);
    assert.equal(element.props.clustered, vehicleHeat, 'Only vehicle-analysis projects enable the new pillar profile');
    assert.strictEqual(element.props.onSelect, vehicleHeat ? onClusterSelect : undefined, 'Base demo pillars remain noninteractive');
  }

  // Compile the actual map-layer gates so all four independent switch combinations are covered.
  const layerLines = mapSource.split('\n');
  const pointGate = layerLines.find(line => line.includes('<ClusterPoints clusters='))?.trim().slice(1, -1);
  const heatGate = layerLines.find(line => line.includes('<HeatLayer points='))?.trim().slice(1, -1);
  const labelStart = mapSource.indexOf('    {clusterMode && labeledClusters.map');
  const labelEnd = mapSource.indexOf('    {layers.vehicles && selectedVehicle', labelStart);
  assert(pointGate && heatGate && labelStart >= 0 && labelEnd > labelStart, 'Map layers expose their independent display gates');
  const labelGate = mapSource.slice(labelStart, labelEnd).trim().slice(1, -1);
  const { code: gatesCode } = await transformWithEsbuild(`const rendered = [${pointGate}, ${heatGate}, ${labelGate}];`, 'layer-gates.jsx', { loader: 'jsx', jsxFactory: 'createElement', sourcemap: false });
  const renderGates = new Function('createElement', 'layers', 'clusterMode', 'clusters', 'model', 'theme', 'vehicleHighlight', 'onClusterSelect', 'labelPortal', 'TOP', 'heatPoints', 'labeledClusters', 'ClusterPoints', 'HeatLayer', 'Html', `${gatesCode}; return rendered;`);
  const layoutSource = mapSource.slice(mapSource.indexOf('function MapLabelLayout('), mapSource.indexOf('function Roads('));
  const { code: layoutCode } = await transformWithEsbuild(layoutSource, 'map-label-layout.jsx', { loader: 'jsx', jsxFactory: 'createElement', sourcemap: false });
  const markerLayout = new Function('createElement', 'useThree', 'useRef', 'useMemo', 'useLayoutEffect', 'useFrame', 'THREE', 'Html', 'Car', 'VEHICLE_MARKER_LIMIT', 'screenOrigin', 'screenOcclusion', `${layoutCode}; return MapLabelLayout;`)(createElement, () => ({ size: vehicleSize, invalidate() {} }), current => ({ current }), fn => fn(), () => {}, () => {}, THREE, 'html', 'car', 500, () => {}, () => {});
  for (const vehicles of [false, true]) for (const clusters of [false, true]) for (const heat of [false, true]) {
    const layers = { vehicles, clusters, heat };
    const [points, heatLayer, labels] = renderGates(createElement, layers, clusters, clusterPoints, clusterModel, DEFAULT_THEME, 'vehicle:all', () => {}, { current: null }, .36, demoHeat, clusterPoints.slice(0, 24), ClusterPoints, 'heat', 'html');
    assert.equal(Boolean(points), clusters, 'Cluster centers depend only on the label layer');
    assert.equal(Boolean(labels), clusters, 'Cluster text labels are independent of raw points and heat');
    assert.equal(Boolean(heatLayer), heat, 'Heat never requires cluster labels or vehicle points');
    const markers = markerLayout({ model: { regions: [], vehicles: VEHICLES }, clusters: clusterPoints, vehiclesEnabled: vehicles, clusterMode: clusters, highlightedVehicles: [], labelPortal: { current: null } });
    assert.equal(Boolean(markers), vehicles, 'Raw marker pools remain available with either state of the cluster-label switch');
    if (vehicles) assert.equal(markers.props.children.length, VEHICLES.length);
  }
  console.log('PASS: eight actual map render combinations keep raw points, cluster labels and heat independent.');

  // Run the actual lazy loader, visibility guard and outer error boundary in R3F's React renderer.
  const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const vehicleHookSource = await readFile(new URL('../src/useVehicleLayer.js', import.meta.url), 'utf8');
  const focusSource = vehicleHookSource.slice(vehicleHookSource.indexOf('  const focusVehicles = '), vehicleHookSource.indexOf('  const pickVehicle = '));
  let focusLayers = { vehicles: false, clusters: false, heat: true, beacons: false };
  const pendingVehicles = [], focusedVehicles = [], vehicleNotices = [], vehicleHighlights = [], vehicleRequest = { current: null };
  const focusVehicle = new Function('context', 'useCallback', 'vehicleDistrict', 'fetchJson', 'allVehicles', `const NATIONAL = '100000'; const { index, vehicleRequest, navigate, setLayers, setDialog, setVehicleHover, setVehicleHighlight, setVehicle, setToast } = context; ${focusSource}; return focusVehicles;`)(
    { index: vehicleRegionIndex, vehicleRequest, navigate: (code, vehicle) => focusedVehicles.push([code, Array.isArray(vehicle) ? vehicle.map(item => item.VEHICLENO) : vehicle?.VEHICLENO]), setLayers: next => { focusLayers = next(focusLayers); }, setDialog() {}, setVehicleHover() {}, setVehicleHighlight: code => vehicleHighlights.push(code), setVehicle() {}, setToast: message => vehicleNotices.push(message) },
    fn => fn, () => new Promise((resolve, reject) => pendingVehicles.push({ resolve, reject })), () => {}, VEHICLES,
  );
  const restoredRegions = [];
  const selectionNavigation = new Function('useCallback', 'vehicleRequest', 'setVehicleHighlight', 'setVehicleHover', 'navigate', 'code', `${vehicleHookSource.slice(vehicleHookSource.indexOf('  const navigateRegion = '), vehicleHookSource.indexOf('  const hoverVehicle = '))}; return { navigateRegion, clearVehicleSelection };`)(fn => fn, vehicleRequest, code => vehicleHighlights.push(code), () => {}, code => restoredRegions.push(code), '100000');
  const obsoleteFocus = focusVehicle([VEHICLES[0]]), obsoleteRequest = vehicleRequest.current;
  const currentFocus = focusVehicle(VEHICLES[4]);
  assert(obsoleteRequest.signal.aborted, 'A new vehicle selection cancels the prior lookup');
  pendingVehicles[1].resolve('120119'); await currentFocus;
  pendingVehicles[0].resolve('110105'); await obsoleteFocus;
  assert.deepEqual(focusedVehicles, [['120119', '5']], 'Late district lookup results cannot steal the selected vehicle focus');
  assert.deepEqual(vehicleHighlights, ['vehicle:1', 'vehicle:5']);
  const cancelledFocus = focusVehicle(VEHICLES[2]); selectionNavigation.clearVehicleSelection(); pendingVehicles[2].resolve('110105'); await cancelledFocus;
  assert.equal(focusedVehicles.length, 1, 'Clearing selection or navigating away cancels a pending focus');
  assert.deepEqual(restoredRegions, ['100000'], 'Cancelling a fleet selection refits the current national region instead of leaving the fleet zoom');
  assert.equal(vehicleHighlights.at(-1), 'vehicle:all');
  selectionNavigation.navigateRegion('110000');
  assert.equal(restoredRegions.at(-1), '110000', 'Explicit hierarchy navigation clears vehicle focus and visits the requested region');
  const failedFocus = focusVehicle(VEHICLES[1]); pendingVehicles[3].reject(new Error('Offline boundary unavailable')); await failedFocus;
  assert(vehicleNotices[0].includes('Offline boundary unavailable'), 'Boundary failures surface without overzooming or hiding vehicles');
  const stoppedVehicles = linkedVehicles('vehicle:stopped'), groupFocus = focusVehicle(stoppedVehicles, 'vehicle:stopped'); pendingVehicles[4].resolve(null); await groupFocus;
  assert.deepEqual(focusedVehicles.at(-1), ['100000', ['1', '2', '4', '5']], 'Cross-region selections restore the full map before framing all selected vehicles');
  const sameDistrictFocus = focusVehicle(VEHICLES.slice(0, 2), 'vehicle:all'); pendingVehicles[5].resolve('110105'); await sameDistrictFocus;
  assert.deepEqual(focusedVehicles.at(-1), ['110105', undefined], 'Same-district groups show the complete district');
  focusLayers = { vehicles: false, clusters: false, heat: true, beacons: false };
  const clusterFocus = focusVehicle(VEHICLES.slice(0, 2), 'cluster:0'); pendingVehicles[6].resolve('110105'); await clusterFocus;
  assert.deepEqual(focusLayers, { vehicles: false, clusters: true, heat: true, beacons: false }, 'Explicit cluster focus enables only cluster labels');
  focusLayers.clusters = false;
  const noiseFocus = focusVehicle(VEHICLES.slice(0, 2), 'cluster:-1'); pendingVehicles[7].resolve('110105'); await noiseFocus;
  assert.deepEqual(focusLayers, { vehicles: true, clusters: false, heat: true, beacons: false }, 'Nonclustered vehicle focus enables only raw points');
  const dispatchedGroups = [];
  const navigateGroup = new Function('useCallback', 'linkedVehicles', 'allVehicles', 'focusVehicles', `${vehicleHookSource.slice(vehicleHookSource.indexOf('  const navigateWidget = '), vehicleHookSource.indexOf('  return { vehicle,'))}; return navigateWidget;`)(fn => fn, resolveVehicles, VEHICLES, (vehicles, code) => dispatchedGroups.push([code, vehicles.map(item => item.VEHICLENO)]));
  for (const code of ['vehicle:moving', 'vehicle:stopped', 'vehicle:all']) assert.equal(navigateGroup(code), true);
  assert.deepEqual(dispatchedGroups.slice(0, 2), [['vehicle:moving', ['3']], ['vehicle:stopped', ['1', '2', '4', '5']]], 'National-view chart clicks run the same focus path as individual GPS rows');
  console.log('PASS: all single-vehicle entrypoints share district focus; rapid selection, cancellation and boundary failure preserve the latest intent.');
  const defaults = new Function(`${appSource.split('\n').find(line => line.startsWith('const DEFAULT_LAYERS = '))}; return DEFAULT_LAYERS;`)();
  const makeSetView = new Function('project', 'DEFAULT_LAYERS', 'setMode', 'setLayers', 'setDialog', 'navigateRegion', 'NATIONAL', `${appSource.slice(appSource.indexOf('  const setView = '), appSource.indexOf('  const fullScreen = '))}; return setView;`);
  assert.equal(defaults.beacons, false);
  assert.equal(defaults.clusters, false);
  const vehicleModes = [], vehicleDialogs = [], vehicleOverviewRegions = [];
  const setVehicleView = makeSetView({ vehicles: true }, defaults, next => vehicleModes.push(next), () => assert.fail('Daoyan navigation must preserve every independent layer'), next => vehicleDialogs.push(next), code => vehicleOverviewRegions.push(code), '100000');
  for (const mode of ['monitor', 'analysis', 'traffic', 'regions', 'overview']) setVehicleView(mode);
  assert.deepEqual(vehicleModes, ['monitor', 'analysis', 'traffic', 'regions', 'overview']);
  assert.deepEqual(vehicleDialogs, ['regions']);
  assert.deepEqual(vehicleOverviewRegions, ['100000'], 'Vehicle overview returns to the national view');
  let presetLayers = defaults;
  const setBaseView = makeSetView({ vehicles: false }, defaults, () => {}, next => { presetLayers = typeof next === 'function' ? next(presetLayers) : next; }, () => {}, () => assert.fail('Base navigation keeps its region'), '100000');
  for (const mode of ['overview', 'monitor', 'traffic', 'regions']) {
    presetLayers = { ...presetLayers, beacons: true }; setBaseView(mode);
    assert.equal(presetLayers.beacons, false, `${mode} retains the base pillar-off preset`);
    assert.equal(presetLayers.heat, mode === 'monitor', 'Base heat presets are unchanged');
  }
  // No window setter is in scope: neither navigation path can silently reset the selected window.
  console.log('PASS: five Daoyan pages preserve independent layers/time; base keeps its four original presets.');
  // Exercise App's actual region selection/effect with deferred map reads and the real source controller.
  const activeCodeSource = appSource.split('\n').find(line => line.includes('const activeCode = '));
  const scopeSource = appSource.split('\n').find(line => line.includes('const scope = '));
  const dataSourceCall = appSource.split('\n').find(line => line.includes('= useDataSources('));
  assert(activeCodeSource && scopeSource && dataSourceCall, 'App must expose one shared business region');
  for (const component of ['BoundWidget', 'RegionPicker', 'DataSourcePanel']) {
    assert.match(appSource, new RegExp(`<${component}\\b[^>]*\\bcode=\\{activeCode\\}`), `${component} must receive the shared region`);
  }
  const readBusiness = new Function('context', 'lineage', 'useDataSources', `const { config, loaded, index, code, usedSources } = context, NATIONAL = '100000'; ${activeCodeSource}\n${scopeSource}\n${dataSourceCall}\nreturn { activeCode, scope, path };`);
  const geoStart = appSource.lastIndexOf('  useEffect(() => {', appSource.indexOf('    const regionFile = '));
  const geoEnd = appSource.indexOf('\n  useEffect(() => { const change = ', geoStart);
  assert(geoStart >= 0 && geoEnd > geoStart, 'The real GeoJSON effect must be available for the regression');
  const runGeo = new Function('context', 'useEffect', 'fetchJson', 'setLoaded', 'setLoading', 'setError', 'setHover', 'sendCommand', 'lineage', `const { config, index, code, retry } = context, NATIONAL = '100000'; ${appSource.slice(geoStart, geoEnd)}`);
  const sourceCalls = [], geoReads = [], mapCommands = [];
  const businessSources = ['fixed', 'region'].map(id => ({ id: `ds_${id}`, name: id, type: 'http', url: id === 'region' ? '/api/region?adcode={adcode}' : '/api/fixed', content: '', rowsPath: '', refreshSeconds: 0 }));
  const regionIndex = { '100000': { name: '中国', hasChildren: true }, '420000': { name: '湖北省', parent: '100000', hasChildren: true }, '430000': { name: '湖南省', parent: '100000', hasChildren: true } };
  const geoState = { config: { map: { visible: false } }, index: null, code: '100000', loaded: null, loading: true, error: 'old error', hover: 'old hover', retry: 0, usedSources: businessSources };
  const sourceController = createDataSourceController({ onChange() {}, loader: async (source, code) => {
    sourceCalls.push(validateSourceUrl(source.url, code, 'https://example.test/'));
    return [{ name: code, value: 1 }];
  } });
  const business = () => readBusiness(geoState, lineage, (sources, code) => { sourceController.reconcile(sources, code); return {}; });
  const fetchGeo = (path, signal) => new Promise((resolve, reject) => geoReads.push({ path, signal, resolve, reject }));
  const sendMapCommand = type => mapCommands.push(type);
  let geoCleanup, geoDependencies;
  const changeGeo = patch => {
    Object.assign(geoState, patch); business();
    runGeo(geoState, (effect, dependencies) => {
      if (geoDependencies && dependencies.every((value, i) => Object.is(value, geoDependencies[i]))) return;
      geoCleanup?.(); geoDependencies = dependencies; geoCleanup = effect();
    }, fetchGeo, value => { geoState.loaded = value; business(); }, value => { geoState.loading = value; }, value => { geoState.error = value; }, value => { geoState.hover = value; }, sendMapCommand, lineage);
    return business();
  };
  const settleGeo = async reads => {
    for (const request of reads) request.resolve({ type: 'FeatureCollection', features: request.path.includes('/regions/') ? [{ properties: { adcode: request.path.match(/(\d+)\.json$/)[1] } }] : [] });
    await new Promise(resolve => setImmediate(resolve));
  };
  const regionCalls = () => sourceCalls.filter(url => url.includes('/api/region?')).map(url => new URL(url).searchParams.get('adcode'));
  try {
    changeGeo({}); changeGeo({ index: regionIndex });
    assert.equal(geoReads.length, 0, 'A hidden national dashboard must fetch neither GeoJSON nor roads');
    assert.equal(geoState.loading, false); assert.equal(geoState.error, ''); assert.equal(geoState.hover, '');
    const initialRegion = changeGeo({ code: '420000' });
    assert.equal(initialRegion.scope.name, '湖北省'); assert.equal(initialRegion.path.at(-1).code, '420000');
    assert.equal(regionCalls().at(-1), '420000', 'Hidden regional sources must use the validated target without waiting for a map');
    assert.equal(geoReads.length, 0);
    changeGeo({ config: { map: { visible: true } } });
    assert.deepEqual(geoReads.map(read => read.path), ['/data/regions/420000.json', '/data/roads/420000.json', '/data/regions/100000.json']);
    await settleGeo(geoReads.slice(-3));
    assert.equal(geoState.loaded.code, '420000');
    assert.deepEqual(geoState.loaded.collections.map(c => c.code), ['100000', '420000'], 'Context must be ordered from national to the focused region');

    changeGeo({ config: { map: { visible: false } } });
    assert.equal(geoState.loaded, null, 'Hiding must discard the old map so showing cannot restore an obsolete region');
    changeGeo({ code: '430000' });
    assert.equal(geoReads.length, 3); assert.equal(regionCalls().at(-1), '430000');
    const beforeShow = [...regionCalls()];
    changeGeo({ config: { map: { visible: true } } });
    assert.equal(business().activeCode, '430000'); assert.equal(geoState.loaded, null);
    assert.deepEqual(regionCalls(), beforeShow, 'Showing must not request the previously displayed region again');
    await settleGeo([geoReads.at(-3), geoReads.at(-1)]); geoReads.at(-2).reject(new Error('Road file unavailable'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(geoState.loaded, null); assert.equal(geoState.loading, false); assert.equal(geoState.error, 'Road file unavailable');
    assert.equal(business().activeCode, '430000', 'A failed map must not invalidate the independent business region');
    assert.deepEqual(regionCalls(), beforeShow);
    changeGeo({ retry: 1 });
    await settleGeo(geoReads.slice(-3));
    assert.equal(geoState.loaded.code, '430000'); assert.deepEqual(regionCalls(), beforeShow);

    changeGeo({ code: '420000' });
    assert.equal(business().activeCode, '430000', 'A visible map keeps business data in its displayed region while the next region loads');
    assert.deepEqual(regionCalls(), beforeShow);
    await settleGeo(geoReads.slice(-3));
    assert.equal(geoState.loaded.code, '420000'); assert.equal(regionCalls().at(-1), '420000');

    changeGeo({ code: '430000' });
    const lateReads = geoReads.slice(-3), commandsBeforeHide = mapCommands.length, readsBeforeHide = geoReads.length;
    changeGeo({ config: { map: { visible: false } } });
    assert(lateReads.every(read => read.signal.aborted), 'Hiding must cancel the focus, roads and surrounding map reads');
    assert.equal(geoReads.length, readsBeforeHide); assert.equal(business().activeCode, '430000');
    await settleGeo(lateReads); // Deliberately resolve despite abort to exercise App's stale-result guard.
    assert.equal(geoState.loaded, null); assert.equal(geoState.loading, false); assert.equal(geoState.error, '');
    assert.equal(mapCommands.length, commandsBeforeHide, 'Late map results must not restore the map or reset its camera');
    assert.deepEqual(regionCalls(), ['100000', '420000', '430000', '420000', '430000']);
    assert.equal(sourceCalls.filter(url => url.endsWith('/api/fixed')).length, 1, 'Fixed sources must survive every visibility and region change');
    assert.equal(changeGeo({ code: '999999' }).activeCode, '100000', 'An unknown target must not become a business region');
  } finally { geoCleanup?.(); sourceController.dispose(); }
  console.log('PASS: hidden maps skip Geo/roads; business regions remain correct across hide/show; visible transitions stay synchronized and canceled results cannot restore a map.');
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
  const renderMap = new Function('h', 'MapErrorBoundary', 'Suspense', 'MapScene', 'context', `const { project, vehicles, theme, fontFamily, loaded, config, layers, pickFeature, pickVehicle, hoverVehicle, setVehicleDetailed, vehicleHighlight, clearVehicleSelection, showVehicleDetails, setHover, command, quality, captureTelemetry, viewport, sceneSize, mapLabels, analysis, analysisWindow, focusCluster, mode, restrictionPreview, restrictionDraft, restrictionDrawing, addRestrictionPoint } = context; const clusterMode = project.vehicles && Boolean(layers.clusters); ${branchCode}; return branch;`);
  const context = { project: { vehicles: true }, analysis: { status: 'ready' }, theme: DEFAULT_THEME, sceneSize: { width: 2560, height: 1205 }, loaded: { data: {}, roads: {}, code: '100000' }, config: { map: { visible: false } }, layers: {}, pickFeature() {}, setHover() {}, command: { type: 'reset', sequence: 1 }, quality: 'high', captureTelemetry() {}, viewport: { x: .2, y: .1, width: .8, height: .7 } };
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
  assert.strictEqual(received.collections, context.loaded.collections);
  assert.strictEqual(received.labelPortal, context.mapLabels);
  assert.strictEqual(received.sceneSize, context.sceneSize); assert.strictEqual(received.viewport, context.viewport); assert.strictEqual(received.layers, context.layers);
  assert.strictEqual(received.command, context.command); assert.equal(received.quality, 'high');
  assert.equal(received.vehicleHeat, true, 'Daoyan passes the vehicle heat source even before rows arrive');
  assert.equal(received.clusterMode, false);
  context.layers.clusters = true; context.analysisWindow = { clusters: [{ label: 0 }] }; context.focusCluster = () => {};
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert.strictEqual(received.clusters, context.analysisWindow.clusters);
  assert.strictEqual(received.onClusterSelect, context.focusCluster); assert.equal(received.clusterMode, true);
  context.mode = 'monitor'; context.layers.clusters = false;
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert.equal(received.clusterMode, false, 'Data monitoring does not force algorithm labels on');
  assert.strictEqual(received.clusters, context.analysisWindow.clusters);
  context.mode = 'overview';
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert.equal(received.clusterMode, false);
  assert.strictEqual(received.clusters, context.analysisWindow.clusters, 'Independent heat and beacon layers retain algorithm results while labels are off');
  const vehicleResultSource = appSource.split('\n').find(line => line.includes('const vehicleResult = useMemo('));
  assert(vehicleResultSource, 'App must adapt analysis rows before passing them to the map');
  const evaluateVehicleResult = new Function('context', 'vehicleDataResult', 'EMPTY_VEHICLES', `const { project, rawResults, config, analysisWindow, analysis } = context, useMemo = fn => fn(); ${vehicleResultSource}; return vehicleResult;`);
  context.config.map.vehicleSourceId = 'vehicle-source';
  context.analysisWindow.rows = VEHICLES.map((row, i) => ({ ...row, CLUSTER_LABEL: i ? -1 : 0 }));
  context.analysis.result = { windows: [context.analysisWindow] };
  context.rawResults = { 'vehicle-source': { rows: context.analysisWindow.rows, status: 'ready' } };
  for (const status of ['ready', 'loading', 'error']) {
    context.analysis.status = status;
    context.analysis.error = status === 'error' ? 'Source refresh failed' : undefined;
    const result = evaluateVehicleResult(context, vehicleDataResult, EMPTY_VEHICLES); context.vehicles = result.rows;
    assert.equal(context.vehicles.length, status === 'ready' ? VEHICLES.length : 0, 'Retained analysis results must not reintroduce stale vehicle rows while refreshing or failed');
    assert.equal(result.status, status);
    await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
    assert.strictEqual(received.vehicles, context.vehicles);
    assert.equal(heatPointsFor({ vehicles: received.vehicles.map(vehicle => ({ vehicle, position: [0, 0, 0] })) }, demoHeat, received.vehicleHeat).length, status === 'ready' ? 1 : 0, 'The actual App adaptation and heat source clear stale member heat');
    if (status !== 'ready') assert.equal(received.clusters, undefined, 'Pending or failed analysis must clear stale cluster pillars');
  }
  context.analysis.status = 'ready';
  context.project.vehicles = false;
  await act(async () => root.render(renderMap(h, Boundary, Suspense, loadedMap.MapScene, context)));
  assert.equal(received.clusterMode, false); assert.equal(received.vehicleHeat, false);
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

  // Exercise time navigation, playback and independent layer controls with real React state/effects.
  const uiSource = await readFile(new URL('../src/VehicleAnalysis.jsx', import.meta.url), 'utf8');
  const timelineCss = await readFile(new URL('../src/vehicle-analysis.css', import.meta.url), 'utf8');
  const reducedMotionRule = timelineCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]+)\}/)?.[1];
  assert(reducedMotionRule?.includes('.vehicle-timeline *'), 'Reduced-motion styles must include every timeline child');
  for (const declaration of ['animation:none!important', 'transition:none!important', 'scroll-behavior:auto!important']) assert(reducedMotionRule.replaceAll(/\s/g, '').includes(declaration), `Reduced motion must disable ${declaration.split(':')[0]}`);
  assert.match(timelineCss, /\.timeline-preview\s*\{[^}]*pointer-events:\s*auto/, 'The floating playback card must receive pointer events');
  const uiReact = await import('react');
  const uiFragment = uiSource.slice(uiSource.indexOf('export const windowLabel'), uiSource.indexOf('export function VehicleAnalysisDetails')).replaceAll('export ', '');
  const { code: uiCode } = await transformWithEsbuild(uiFragment, 'analysis-controls.jsx', { loader: 'jsx', jsxFactory: 'uiH', jsxFragment: 'Fragment', sourcemap: false });
  const timelineRect = { top: 100, height: 300 };
  const uiH = (type, props, ...children) => {
    if (type === 'div' && props?.ref) {
      if (props.className?.startsWith('timeline-track')) props.ref.current = { getBoundingClientRect: () => timelineRect };
    }
    return typeof type === 'string'
      ? createElement('group', { key: props?.key, name: props?.className || type, userData: { props: props || {}, text: children.flat().filter(value => typeof value === 'string').join('') } }, ...children.flat().filter(value => value && typeof value === 'object'))
      : createElement(type, props, ...children);
  };
  const timers = new Map(); let timerId = 0;
  const runtime = { uiH, useEffect: uiReact.useEffect, useRef: uiReact.useRef, useState: uiReact.useState, Fragment: uiReact.Fragment, setTimeout: (fn, delay) => { assert.equal(delay, 2000); timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), CaretLeft: 'icon', CaretRight: 'icon', Pause: 'icon', Play: 'icon', MapPin: 'icon', Fire: 'icon', Tag: 'icon', Sparkle: 'icon' };
  const { VehicleTimeline, VehicleLayerControls } = new Function(...Object.keys(runtime), `${uiCode}; return { VehicleTimeline, VehicleLayerControls };`)(...Object.values(runtime));
  let timeWindows = [0, 10, 30, 40].map(minutes => ({ windowStart: new Date(Date.UTC(2026, 8, 28, 1, minutes)).toISOString(), windowEnd: new Date(Date.UTC(2026, 8, 28, 1, minutes + 10)).toISOString() }));
  const timeAnalysis = { status: 'ready', result: { windows: timeWindows } }; let timeIndex = 0; const timeSelections = [];
  const renderTimeline = () => root.render(createElement(VehicleTimeline, { analysis: timeAnalysis, window: timeWindows[timeIndex], onWindow: value => { timeSelections.push(value); timeIndex = timeWindows.findIndex(item => item.windowStart === value); renderTimeline(); } }));
  const uiNode = label => { let found; scene.traverse(node => { if (node.userData.props?.['aria-label'] === label) found = node; }); assert(found, `Control must exist: ${label}`); return found.userData.props; };
  const timelineTrack = () => { let found; scene.traverse(node => { if (node.name.split(' ')[0] === 'timeline-track') found = node; }); assert(found); return found.userData.props; };
  let pointerCaptured = false;
  const pointerTarget = { setPointerCapture() { pointerCaptured = true; }, hasPointerCapture() { return pointerCaptured; }, releasePointerCapture() { pointerCaptured = false; } };
  const pointer = index => ({ button: 0, pointerId: 1, clientY: timelineRect.top + index / (timeWindows.length - 1) * timelineRect.height, currentTarget: pointerTarget, preventDefault() {} });
  await act(async () => renderTimeline());
  assert(!scene.getObjectByName('timeline-arrows')); assert(!scene.getObjectByName('timeline-play')); assert(!scene.getObjectByName('timeline-preview'), 'The resting rail shows no permanent playback controls');
  await act(async () => timelineTrack().onPointerMove(pointer(1)));
  assert(scene.getObjectByName('timeline-preview')); assert.equal(uiNode('时间窗预览').role, 'group');
  await act(async () => uiNode('分析时间窗').onPointerLeave({ currentTarget: { contains: () => true }, relatedTarget: {} }));
  assert(scene.getObjectByName('timeline-preview')?.getObjectByName('timeline-play'), 'Moving the pointer into the floating card must keep its playback action mounted');
  await act(async () => uiNode('分析时间窗').onPointerLeave({ currentTarget: { contains: () => false }, relatedTarget: null }));
  assert(!scene.getObjectByName('timeline-preview'), 'Leaving the whole idle rail closes the floating card');
  await act(async () => uiNode('切换分析时间窗').onFocus());
  assert(scene.getObjectByName('timeline-preview')?.getObjectByName('timeline-play'), 'Keyboard focus exposes the same interactive playback card');
  await act(async () => uiNode('分析时间窗').onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} }));
  assert(scene.getObjectByName('timeline-play'), 'Tabbing from a tick into the card must preserve the action');
  assert.equal(uiNode('切换分析时间窗')['aria-orientation'], 'vertical');
  const pressTimeKey = async key => act(async () => uiNode('切换分析时间窗').onKeyDown({ key, preventDefault() {} }));
  await pressTimeKey('ArrowDown'); assert.equal(timeIndex, 1, 'Down moves to the next chronological window');
  await pressTimeKey('ArrowUp'); assert.equal(timeIndex, 0, 'Up moves to the preceding chronological window');
  await pressTimeKey('ArrowUp'); assert.equal(timeIndex, 0, 'Up clamps at the first window');
  await act(async () => uiNode('切换分析时间窗').onKeyDown({ key: 'End', preventDefault() {} }));
  assert.equal(timeIndex, timeWindows.length - 1); await pressTimeKey('ArrowDown'); assert.equal(timeIndex, timeWindows.length - 1, 'Down clamps at the last window');
  await act(async () => uiNode('播放分窗变化').onClick());
  assert.equal(timeIndex, 0, 'Playing from the last window restarts at the first actual window'); assert.equal(timers.size, 1);
  await act(async () => uiNode('分析时间窗').onPointerLeave({ currentTarget: { contains: () => false }, relatedTarget: null }));
  assert.equal(uiNode('暂停分窗播放')['aria-pressed'], true, 'Playback retains an operable pause action after the pointer leaves');
  await act(async () => uiNode('暂停分窗播放').onClick());
  assert.equal(timers.size, 0, 'The floating pause action cancels the pending step'); assert(scene.getObjectByName('timeline-preview'));
  await act(async () => uiNode('播放分窗变化').onClick()); assert.equal(timers.size, 1);
  for (let i = 1; i < timeWindows.length; i++) {
    const [id, tick] = timers.entries().next().value; timers.delete(id);
    await act(async () => tick()); assert.equal(timeIndex, i);
  }
  assert.equal(timers.size, 0, 'Playback stops at the last window'); assert.equal(uiNode('播放分窗变化')['aria-pressed'], false);
  await act(async () => timelineTrack().onPointerDown(pointer(1.2)));
  await act(async () => timelineTrack().onPointerMove(pointer(1.7)));
  assert(pointerCaptured); assert.equal(timeIndex, 3, 'Vertical dragging previews without switching data until release');
  assert.equal(uiNode('切换分析时间窗').value, 1.7); assert(scene.getObjectByName('timeline-preview'), 'Hover/drag reveals the compact time preview');
  await act(async () => timelineTrack().onPointerUp(pointer(1.7)));
  assert.equal(timeIndex, 2, 'Vertical pointer release snaps to an actual data window, including noncontiguous times'); assert(!pointerCaptured);
  await act(async () => timelineTrack().onPointerDown(pointer(0)));
  await act(async () => timelineTrack().onPointerCancel());
  assert.equal(timeIndex, 2, 'Canceled dragging retains the current data window'); assert.equal(uiNode('切换分析时间窗').value, 2); assert(!scene.getObjectByName('timeline-preview'));
  await act(async () => uiNode('切换分析时间窗').onFocus());
  await act(async () => uiNode('播放分窗变化').onClick()); assert.equal(timers.size, 1);
  timeAnalysis.status = 'loading';
  await act(async () => renderTimeline()); assert.equal(timers.size, 0, 'Recalculation cancels playback and removes obsolete controls');
  assert(scene.getObjectByName('vehicle-timeline timeline-empty'));
  assert(timeSelections.every(value => timeWindows.some(item => item.windowStart === value)), 'Navigation never invents missing windows');
  timeWindows = Array.from({ length: 240 }, (_, minute) => ({ windowStart: new Date(Date.UTC(2026, 8, 28, 1, minute)).toISOString(), windowEnd: new Date(Date.UTC(2026, 8, 28, 1, minute + 1)).toISOString() }));
  timeIndex = 0; timeAnalysis.status = 'ready'; timeAnalysis.result = { windows: timeWindows };
  await act(async () => renderTimeline());
  const ticks = () => scene.getObjectByName('timeline-ticks')?.children || [];
  assert.equal(ticks().length, 240, 'All one-minute windows remain rendered in a dense timeline');
  assert(!scene.getObjectByName('timeline-scroll'), 'Dense timelines do not introduce a scrolling viewport');
  assert.equal(ticks()[0].userData.props.style.top, '0%'); assert.equal(ticks().at(-1).userData.props.style.top, '100%');
  const tickPositions = ticks().map(node => Number.parseFloat(node.userData.props.style.top));
  assert(tickPositions.every((position, i) => position >= 0 && position <= 100 && (!i || position > tickPositions[i - 1])), 'Every dense tick fits between the endpoints without being dropped or stacked');
  await act(async () => timelineTrack().onPointerDown(pointer(119.6)));
  await act(async () => timelineTrack().onPointerUp(pointer(119.6)));
  assert.equal(timeIndex, 120, 'The compressed rail maps its middle to the correct one-minute window');
  await act(async () => timelineTrack().onPointerDown(pointer(239)));
  await act(async () => timelineTrack().onPointerUp(pointer(239)));
  assert.equal(timeIndex, 239, 'The final dense tick remains reachable without scrolling');
  await act(async () => ticks()[0].userData.props.onClick({ detail: 0 })); assert.equal(timeIndex, 0, 'All dense tick buttons retain direct selection');
  await pressTimeKey('End'); assert.equal(timeIndex, 239); await pressTimeKey('ArrowDown'); assert.equal(timeIndex, 239);
  timeWindows = [timeWindows[0]]; timeIndex = 0; timeAnalysis.result = { windows: timeWindows };
  await act(async () => renderTimeline());
  assert.equal(ticks().length, 1); assert.equal(ticks()[0].userData.props.style.top, '0%');
  assert.equal(uiNode('切换分析时间窗').disabled, true); assert.equal(Number(uiNode('切换分析时间窗').max), 0);
  await act(async () => ticks()[0].userData.props.onFocus()); assert.equal(uiNode('播放分窗变化').disabled, true, 'A single-window rail cannot start playback');
  timeWindows = []; timeAnalysis.result = { windows: timeWindows };
  await act(async () => renderTimeline());
  assert.equal(ticks().length, 0); assert(scene.getObjectByName('vehicle-timeline timeline-empty')); assert.equal(timers.size, 0, 'An empty timeline has no ticks or playback timers');
  let controlLayers = { vehicles: false, heat: true, clusters: false, beacons: false, roads: true };
  await act(async () => root.render(createElement(VehicleLayerControls, { layers: controlLayers, setLayers: fn => { controlLayers = fn(controlLayers); } })));
  await act(async () => uiNode('聚集标签').onClick());
  assert.deepEqual(controlLayers, { vehicles: false, heat: true, clusters: true, beacons: false, roads: true });
  await act(async () => uiNode('聚集热区').onClick());
  assert.deepEqual(controlLayers, { vehicles: false, heat: false, clusters: true, beacons: false, roads: true });
  console.log('PASS: vertical timeline keys, preview-card pointer/focus/play/pause, drag snap/cancel, sparse and dense windows, single/empty states, reduced-motion, end/loading cleanup and independent layer buttons run through actual React state.');
  const settingsSource = uiSource.slice(uiSource.indexOf('export function VehiclePageSettings'), uiSource.indexOf('export function VehicleAnalysisCard')).replace('export ', '');
  const { code: settingsCode } = await transformWithEsbuild(settingsSource, 'page-settings.jsx', { loader: 'jsx', jsxFactory: 'uiH', sourcemap: false });
  const { clusterOptions, DEFAULT_CLUSTER_OPTIONS, optionsForRows } = await import('../src/vehicleClustering.js');
  const Settings = new Function('uiH', 'useState', 'Dialog', 'Layout', 'CaretRight', 'clusterOptions', 'DEFAULT_CLUSTER_OPTIONS', 'optionsForRows', `${settingsCode}; return VehiclePageSettings;`)(uiH, uiReact.useState, props => props.children, 'icon', 'icon', clusterOptions, DEFAULT_CLUSTER_OPTIONS, optionsForRows);
  const savedOptions = { ...DEFAULT_CLUSTER_OPTIONS, epsKm: 1, minSamples: 2, windowMinutes: 10 }, appliedOptions = []; let settingsClosed = 0, editorOpened = 0;
  await act(async () => root.render(createElement(Settings, { options: savedOptions, rows: [], onApply: value => appliedOptions.push(value), onClose: () => settingsClosed++, onEdit: () => editorOpened++ })));
  const form = () => scene.getObjectByName('vehicle-page-settings analysis-settings').userData.props;
  const textButton = text => { let found; scene.traverse(node => { if (node.name === 'button' && node.userData.text === text) found = node; }); assert(found); return found.userData.props; };
  await act(async () => uiNode('邻域半径').onChange({ target: { value: '0' } }));
  await act(async () => form().onSubmit({ preventDefault() {} }));
  assert.equal(appliedOptions.length, 0, 'Invalid parameters cannot reach configuration');
  let validationError; scene.traverse(node => { if (node.userData.props?.role === 'alert') validationError = node.userData.text; }); assert(validationError);
  await act(async () => uiNode('邻域半径').onChange({ target: { value: '2' } }));
  assert.equal(savedOptions.epsKm, 1, 'Changing a setting only edits the draft');
  await act(async () => textButton('取消').onClick()); assert.equal(settingsClosed, 1); assert.equal(appliedOptions.length, 0);
  await act(async () => form().onSubmit({ preventDefault() {} }));
  assert.equal(appliedOptions.length, 1); assert.deepEqual(appliedOptions[0], { ...savedOptions, epsKm: 2 });
  await act(async () => textButton('恢复默认参数').onClick());
  assert.equal(uiNode('最少车辆数').value, DEFAULT_CLUSTER_OPTIONS.minSamples); assert.equal(appliedOptions.length, 1, 'Restoring defaults remains a draft until save');
  scene.getObjectByName('settings-editor-entry').getObjectByName('button').userData.props.onClick(); assert.equal(editorOpened, 1);
  console.log('PASS: page settings validate before saving, keep edits/defaults in a draft, and retain cancel/editor actions.');

  // Reuse this real React root to exercise the complete widget and its lazy chart boundary.
  const [widgetSource, React, widgetHelpers, { DATA_FIELDS }] = await Promise.all([
    readFile(new URL('../src/DashboardWidget.jsx', import.meta.url), 'utf8'), import('react'), import('../src/widgetData.js'), import('../src/dataSources.js'),
  ]);
  const { code: widgetCode } = await transformWithEsbuild(widgetSource.slice(widgetSource.indexOf('const COLUMN_KEYS = ')).replace("import('./ProfessionalChart.jsx')", 'load()').replace('export const DashboardWidget', 'const DashboardWidget'), 'DashboardWidget.jsx', { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Fragment', sourcemap: false });
  const widgetH = (type, props, ...children) => h(type, typeof type === 'string' ? { key: props?.key, className: props?.className, role: props?.role, onClick: props?.onClick } : props, ...children);
  const widgetRuntime = { ...widgetHelpers, DATA_FIELDS, DEFAULT_THEME, number: widgetHelpers.formatWidgetNumber, Component, lazy, Suspense, h: widgetH, Fragment: React.Fragment, memo: React.memo, useEffect: React.useEffect, useId: React.useId, useMemo: React.useMemo, useState: React.useState };
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

  // Keep real editor state and toolbar callbacks while each optional panel import rejects.
  const [editorSource, editorConfig, layout] = await Promise.all([
    readFile(new URL('../src/DashboardEditor.jsx', import.meta.url), 'utf8'), import('../src/dashboardConfig.js'), import('../src/layout.js'),
  ]);
  const editorRuntime = { ...layout, ...editorConfig, h: widgetH, useState: React.useState, useReducer: React.useReducer, useCallback: React.useCallback, useEffect: React.useEffect,
    loadConfig: () => structuredClone(editorConfig.DEFAULT_CONFIG), saveConfig: editorConfig.normalizeConfig,
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, document: { querySelector: () => null },
    ...Object.fromEntries(['ArrowCounterClockwise', 'ArrowClockwise', 'Check', 'Copy', 'Database', 'Eye', 'FloppyDisk', 'GridFour', 'Palette', 'SlidersHorizontal', 'SquaresFour', 'X'].map(name => [name, () => null])),
  };
  const { code: editorCode } = await transformWithEsbuild(editorSource.slice(editorSource.indexOf('export function useDashboardEditor('), editorSource.indexOf('export function CanvasItem(')).replaceAll('export function', 'function'), 'EditorState.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false });
  const { useDashboardEditor, EditorToolbar } = new Function(...Object.keys(editorRuntime), `${editorCode}; return { useDashboardEditor, EditorToolbar };`)(...Object.values(editorRuntime));
  const panelBoundarySource = appSource.slice(appSource.indexOf('class PanelErrorBoundary '), appSource.indexOf('const BoundWidget = '));
  const { code: panelBoundaryCode } = await transformWithEsbuild(panelBoundarySource, 'PanelErrorBoundary.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false });
  // Dialog's native focus/close behavior is browser-tested; this host forwards its real onClose.
  const PanelDialog = ({ title, onClose, children }) => createElement('group', { name: 'failed-panel-dialog', userData: { title } }, createElement('group', { name: 'close-panel-dialog', onClick: onClose }), children);
  const PanelBoundary = new Function('Component', 'h', 'Dialog', 'location', `${panelBoundaryCode}; return PanelErrorBoundary;`)(Component, widgetH, PanelDialog, { reload: () => reloads++ });
  const panelNames = ['ComponentLibrary', 'ComponentInspector', 'TemplatePanel', 'DataSourcePanel', 'ConfigPanel'];
  const panelLoaderSource = appSource.slice(appSource.indexOf('const ComponentLibrary = '), appSource.indexOf('const DEFAULT_LAYERS = ')).replace(/import\('[^']+'\)/g, 'load()');
  const makePanels = new Function('lazy', 'load', `${panelLoaderSource}; return { ${panelNames.join(', ')} };`);
  const panelBranches = appSource.match(/<PanelErrorBoundary\b[\s\S]*?<\/PanelErrorBoundary>/g);
  assert.equal(panelBranches?.length, 5, 'Every optional editor panel must have its own local boundary');
  const panelErrors = [];
  for (const name of panelNames) {
    const panelFailure = new Error(`${name} chunk unavailable`); panelErrors.push(panelFailure);
    let panelLoads = 0, editorState, openPanel;
    const panels = makePanels(lazy, () => { panelLoads++; return Promise.reject(panelFailure); });
    const branch = panelBranches.find(branch => branch.includes(`<${name} `));
    assert(branch, `${name} must be inside the boundary`);
    const { code: panelBranchCode } = await transformWithEsbuild(`const panel = ${branch};`, 'PanelBranch.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false });
    const renderPanel = new Function('h', 'PanelErrorBoundary', 'Suspense', ...panelNames, 'editor', 'setDialog', `const project = { id: 'base', name: '基线版', vehicles: false, showBrand: true }, config = editor.config, selection = config.modules[0], results = {}, analysis = {}, activeCode = '100000'; const setSidePanel = () => {}, applySources = () => {}, createFromSource = () => {}, applyConfig = () => {}; ${panelBranchCode}; return panel;`);
    function PanelProbe() {
      editorState = useDashboardEditor(() => {});
      const [opened, setOpened] = React.useState(false); openPanel = () => setOpened(true);
      return createElement(React.Fragment, null,
        createElement('group', { name: 'panel-map', key: 'map' }, createElement(WorldProbe)),
        createElement(RejectedWidget, { key: 'metric', config: { id: 'metric', type: 'metric', title: '保留指标' }, data: metricData }),
        editorState.editing && createElement(EditorToolbar, { editor: editorState, onDialog: () => {} }),
        editorState.editing && opened && renderPanel(widgetH, PanelBoundary, Suspense, ...Object.values(panels), editorState, value => setOpened(Boolean(value))),
      );
    }
    await act(async () => root.render(createElement(PanelProbe)));
    await act(async () => editorState.start());
    await act(async () => editorState.change({ ...editorState.config, title: `未保存-${name}` }));
    const draft = editorState.config, mapBefore = scene.getObjectByName('panel-map'), meshBefore = mapBefore.children[0], toolbarBefore = scene.getObjectByName('editor-toolbar');
    await act(async () => openPanel());
    assert(editorState.dirty); assert.strictEqual(editorState.config, draft, 'Panel failure cannot replace or save the draft');
    assert.strictEqual(scene.getObjectByName('panel-map'), mapBefore); assert.strictEqual(mapBefore.children[0], meshBefore);
    assert.strictEqual(scene.getObjectByName('editor-toolbar'), toolbarBefore, 'Save/cancel toolbar must remain mounted');
    assert.equal(scene.getObjectByName('editor-layer-list')?.userData.role, 'alert');
    assert.equal(panelLoads, 1); assert.equal(reloads, 1, 'Panel failure must not reload the page automatically');
    if (['TemplatePanel', 'DataSourcePanel', 'ConfigPanel'].includes(name)) {
      assert(scene.getObjectByName('failed-panel-dialog'));
      await act(async () => scene.getObjectByName('close-panel-dialog').__r3f.handlers.onClick());
      assert.equal(scene.getObjectByName('failed-panel-dialog'), undefined);
      assert.strictEqual(editorState.config, draft); assert(editorState.dirty, 'Closing the failure dialog must retain unsaved work');
    } else assert.equal(scene.getObjectByName('failed-panel-dialog'), undefined, 'Side-panel failures stay inline');
    await act(async () => toolbarBefore.getObjectByName('editor-primary').__r3f.handlers.onClick());
    assert.equal(editorState.editing, false); assert.equal(editorState.dirty, false);
    assert.equal(editorState.config.title, draft.title, 'The actual toolbar can still save the original draft');
    assert.equal(panelLoads, 1);
  }
  assert(panelErrors.every(error => reportedErrors.includes(error)));
  assert(reportedErrors.every(error => [failure, chunkFailure, renderFailure, ...panelErrors].includes(error)));
  console.log('PASS: five optional panel failures preserve real editor drafts, map and toolbar; failed dialogs close and the toolbar still saves.');
} finally {
  await act(async () => root.unmount());
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
