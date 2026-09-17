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
import { VEHICLE_FIELDS, linkedVehicles as resolveVehicles, groupVehiclePoints, vehicleDistrict, vehicleCalloutPosition } from '../src/vehicles.js';
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
  const { RegionMesh, modelFor, heatPointsFor, vehicleBounds, districtVehicleBounds, vehicleDetailVisible, fitMapViewport, updateMapClipping, mapPixelRatio, MapScene } = await vite.ssrLoadModule('/src/MapScene.jsx');
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
  for (const model of models) {
    const heat = heatPointsFor(model, demoHeat, true);
    assert.deepEqual(heat.map(point => point.name), VEHICLES.map(row => row.VEHICLENO));
    assert.deepEqual(heat.map(point => [point.position[0], point.position[2]]), VEHICLES.map(row => { const [x, y] = model.project([row.GEO_LON, row.GEO_LAT]); return [x, -y]; }), 'Heat stays at actual GPS coordinates through drill-down');
  }
  const changedHeatModel = modelFor(nationalData, '100000', [{ code: '100000', data: nationalData }], [{ ...VEHICLES[0], VEHICLENO: 'NEW', GEO_LON: 108.94, GEO_LAT: 34.34 }]);
  const changedHeat = heatPointsFor(changedHeatModel, demoHeat, true);
  assert.equal(changedHeat.length, 1); assert.equal(changedHeat[0].name, 'NEW');
  assert.notDeepEqual(changedHeat[0].position, heatPointsFor(models[0], demoHeat, true)[0].position, 'Replacing vehicles moves heat and removes obsolete points');
  changedHeatModel.regions.forEach(region => region.geometry.dispose()); changedHeatModel.backdrops.forEach(geometry => geometry.dispose());
  console.log('PASS: GPS heat follows vehicle additions, removals, coordinates and drill-down; empty data never shows demo points.');
  baseModel.regions.forEach(region => region.geometry.dispose()); baseModel.backdrops.forEach(geometry => geometry.dispose());
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 200);
  const vehicleModel = models[0], vehicleSize = { width: 1280, height: 720 }, vehicleViewport = { x: .21, y: .15, width: .78, height: .61 };
  assert.equal(VEHICLES.length, 5); assert.equal(VEHICLE_FIELDS.length, 15);
  const vehicleCanvas = normalizeConfig(JSON.parse(await readFile(new URL('../docs/daoyan-vehicles.canvas.json', import.meta.url), 'utf8')));
  const rawVehicleSource = vehicleCanvas.dataSources.find(source => source.id === vehicleCanvas.modules[0].binding.sourceId);
  const rawVehicles = parseSourceContent(rawVehicleSource.content, rawVehicleSource.type, rawVehicleSource.rowsPath);
  assert.deepEqual(rawVehicles.map(row => Object.fromEntries(VEHICLE_FIELDS.map(([key]) => [key, row[key]]))), VEHICLES, 'The page data and map use the same original fifteen-field snapshot');
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
    assert.deepEqual(Object.keys(row), VEHICLE_FIELDS.map(([key]) => key));
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
  const markerExpression = mapSource.split('\n').find(line => line.includes('{layers.vehicles && model.vehicles.map')).trim().slice(1, -1);
  const { code: markerCode } = await transformWithEsbuild(`(model, highlightedVehicles) => (${markerExpression})`, 'vehicle-markers.jsx', { loader: 'jsx', jsx: 'transform', jsxFactory: 'createElement' });
  const renderMarkers = new Function('createElement', 'Html', 'Car', 'layers', 'labelPortal', 'invalidate', 'hoverVehicle', 'onVehicleHover', 'onVehicleSelect', `return ${markerCode}`)(createElement, 'html', 'car', { vehicles: true }, { current: null }, () => {}, () => {}, () => {}, () => {});
  for (const highlighted of [[], [VEHICLES[3]], linkedVehicles('vehicle:stopped')]) {
    const markers = renderMarkers(vehicleModel, vehicleModel.vehicles.map(point => point.vehicle).filter(vehicle => highlighted.some(item => item.VEHICLENO === vehicle.VEHICLENO)));
    assert.equal(markers.length, 5, 'Selections highlight without filtering any markers');
    assert.equal(markers.filter(marker => marker.props.children.props['data-highlighted']).length, highlighted.length);
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

  // Run the actual lazy loader, visibility guard and outer error boundary in R3F's React renderer.
  const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const vehicleHookSource = await readFile(new URL('../src/useVehicleLayer.js', import.meta.url), 'utf8');
  const focusSource = vehicleHookSource.slice(vehicleHookSource.indexOf('  const focusVehicles = '), vehicleHookSource.indexOf('  const pickVehicle = '));
  const pendingVehicles = [], focusedVehicles = [], vehicleNotices = [], vehicleHighlights = [], vehicleRequest = { current: null };
  const focusVehicle = new Function('context', 'useCallback', 'vehicleDistrict', 'fetchJson', 'allVehicles', `const { index, vehicleRequest, navigate, sendCommand, setLayers, setDialog, setVehicleHover, setVehicleHighlight, setVehicle, setToast } = context; ${focusSource}; return focusVehicles;`)(
    { index: vehicleRegionIndex, vehicleRequest, navigate: (code, vehicle) => focusedVehicles.push([code, vehicle.VEHICLENO]), sendCommand: () => assert.fail('Single vehicles must never use point-radius zoom'), setLayers() {}, setDialog() {}, setVehicleHover() {}, setVehicleHighlight: code => vehicleHighlights.push(code), setVehicle() {}, setToast: message => vehicleNotices.push(message) },
    fn => fn, () => new Promise((resolve, reject) => pendingVehicles.push({ resolve, reject })), () => {}, VEHICLES,
  );
  const obsoleteFocus = focusVehicle([VEHICLES[0]]), obsoleteRequest = vehicleRequest.current;
  const currentFocus = focusVehicle(VEHICLES[4]);
  assert(obsoleteRequest.signal.aborted, 'A new vehicle selection cancels the prior lookup');
  pendingVehicles[1].resolve('120119'); await currentFocus;
  pendingVehicles[0].resolve('110105'); await obsoleteFocus;
  assert.deepEqual(focusedVehicles, [['120119', '5']], 'Late district lookup results cannot steal the selected vehicle focus');
  assert.deepEqual(vehicleHighlights, ['vehicle:1', 'vehicle:5']);
  const cancelledFocus = focusVehicle(VEHICLES[2]); vehicleRequest.current.abort(); pendingVehicles[2].resolve('110105'); await cancelledFocus;
  assert.equal(focusedVehicles.length, 1, 'Clearing selection or navigating away cancels a pending focus');
  const failedFocus = focusVehicle(VEHICLES[1]); pendingVehicles[3].reject(new Error('Offline boundary unavailable')); await failedFocus;
  assert(vehicleNotices[0].includes('Offline boundary unavailable'), 'Boundary failures surface without overzooming or hiding vehicles');
  console.log('PASS: all single-vehicle entrypoints share district focus; rapid selection, cancellation and boundary failure preserve the latest intent.');
  const defaults = new Function(`${appSource.split('\n').find(line => line.startsWith('const DEFAULT_LAYERS = '))}; return DEFAULT_LAYERS;`)();
  let presetLayers = defaults;
  const setView = new Function('project', 'DEFAULT_LAYERS', 'setMode', 'setLayers', 'setDialog', `${appSource.slice(appSource.indexOf('  const setView = '), appSource.indexOf('  const fullScreen = '))}; return setView;`)({ vehicles: false }, defaults, () => {}, next => { presetLayers = typeof next === 'function' ? next(presetLayers) : next; }, () => {});
  assert.equal(defaults.beacons, false);
  for (const mode of ['overview', 'monitor', 'traffic', 'regions']) {
    presetLayers = { ...presetLayers, beacons: true }; setView(mode);
    assert.equal(presetLayers.beacons, false, `${mode} must start with monitoring pillars disabled`);
  }
  console.log('PASS: initial map and all four business view presets leave demo pillars disabled.');
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
  const renderMap = new Function('h', 'MapErrorBoundary', 'Suspense', 'MapScene', 'context', `const { project, vehicles, theme, fontFamily, loaded, config, layers, pickFeature, pickVehicle, hoverVehicle, setVehicleDetailed, vehicleHighlight, clearVehicleSelection, showVehicleDetails, setHover, command, quality, captureTelemetry, viewport, sceneSize, mapLabels } = context; ${branchCode}; return branch;`);
  const context = { project: { vehicles: true }, theme: DEFAULT_THEME, sceneSize: { width: 2560, height: 1205 }, loaded: { data: {}, roads: {}, code: '100000' }, config: { map: { visible: false } }, layers: {}, pickFeature() {}, setHover() {}, command: { type: 'reset', sequence: 1 }, quality: 'high', captureTelemetry() {}, viewport: { x: .2, y: .1, width: .8, height: .7 } };
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
    const renderPanel = new Function('h', 'PanelErrorBoundary', 'Suspense', ...panelNames, 'editor', 'setDialog', `const project = { id: 'base', name: '基线版', vehicles: false, showBrand: true }, config = editor.config, selection = config.modules[0], results = {}, activeCode = '100000'; const setSidePanel = () => {}, applySources = () => {}, createFromSource = () => {}, applyConfig = () => {}; ${panelBranchCode}; return panel;`);
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
