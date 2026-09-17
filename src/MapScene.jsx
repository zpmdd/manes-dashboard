import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addAfterEffect, Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, Line, MeshReflectorMaterial, OrbitControls } from '@react-three/drei';
import { Car } from '@phosphor-icons/react';
import * as THREE from 'three';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, labelPoint, layoutLabels, NATIONAL, polygons, projection, shortName } from './geo';
import { useRoadmap } from './useRoadmap';
import { VEHICLES, linkedVehicles, groupVehiclePoints, vehicleCalloutPosition } from './vehicles';
import { VehicleCallout } from './MapPanels';

const CAMERA = [0, 22, 18];
const TOP = 0.36;
export function mapPixelRatio(size, quality, deviceRatio = globalThis.devicePixelRatio || 1) {
  const cap = quality === 'high' ? 1.5 : 1, budget = quality === 'high' ? 2560 * 1440 : 1920 * 1080;
  return Math.min(deviceRatio, cap, size?.width > 0 && size?.height > 0 ? Math.sqrt(budget / (size.width * size.height)) : cap);
}
const HUBS = [
  { name: '北京', point: [116.4, 39.9], height: 1.25 },
  { name: '上海', point: [121.47, 31.23], height: 0.85 },
  { name: '武汉', point: [114.3, 30.59], height: 1.65 },
  { name: '广州', point: [113.26, 23.13], height: 1.0 },
  { name: '成都', point: [104.06, 30.57], height: 0.8 },
  { name: '西安', point: [108.94, 34.34], height: 0.65 },
];

export function modelFor(data, code, collections = [{ code, data }]) {
  const national = code === NATIONAL;
  const project = projection(extent(collections[0].data.features, true));
  const expanded = new Set(collections.slice(1).map(collection => collection.code));
  const focusCodes = new Set(data.features.map(feature => String(feature.properties.adcode)));
  const [west, south, east, north] = extent(data.features, national);
  const a = project([west, south]), b = project([east, north]);
  const scale = Math.min(1, Math.max(b[0] - a[0], b[1] - a[1]) / 16);
  const edges = [], contextEdges = [], backdrops = [];
  const regions = collections.flatMap((collection, level) => collection.data.features.flatMap(f => {
    const backing = expanded.has(String(f.properties.adcode));
    const focused = !national && focusCodes.has(String(f.properties.adcode));
    const border = national || focused ? edges : contextEdges;
    const shapes = polygons(f.geometry).filter(poly => collection.code !== NATIONAL || poly[0].some(p => p[1] >= 18)).map(poly => {
      const shape = new THREE.Shape(poly[0].map(p => new THREE.Vector2(...project(p))));
      shape.holes = poly.slice(1).map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(...project(p)))));
      if (!backing) for (const ring of poly) for (let j = 1; j < ring.length; j++) {
        const a = project(ring[j - 1]), b = project(ring[j]);
        border.push(a[0], TOP + .022 * scale, -a[1], b[0], TOP + .022 * scale, -b[1]);
      }
      return shape;
    });
    if (!shapes.length) return [];
    if (backing) {
      // Ancestor caps fill gaps between boundary files simplified at different levels.
      backdrops.push(new THREE.ShapeGeometry(shapes).rotateX(-Math.PI / 2).translate(0, TOP - .02 * scale * (collections.length - level), 0));
      return [];
    }
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: TOP, bevelEnabled: true, bevelSize: .012 * scale, bevelThickness: .012 * scale, bevelSegments: 1, steps: 1, curveSegments: 1 });
    mergeGroups(geometry);
    geometry.rotateX(-Math.PI / 2);
    const [x, y] = project(labelPoint(f));
    return [{ feature: f, geometry, focused, anchor: [x, TOP, -y], color: focused ? '#b6a077' : national ? '#aaa6a0' : '#464449' }];
  }));
  const bounds = new THREE.Box3();
  regions.forEach(r => { r.geometry.computeBoundingBox(); if (national || r.focused) bounds.union(r.geometry.boundingBox); });
  if (!national) bounds.min.y = TOP;
  const vehicles = VEHICLES.map(vehicle => {
    const [x, y] = project([vehicle.GEO_LON, vehicle.GEO_LAT]);
    return { vehicle, position: [x, bounds.max.y + .000001, -y] };
  });
  return { regions, project, edges, contextEdges, backdrops, bounds, scale, vehicles };
}

export function vehicleBounds(project, vehicle, surfaceY = TOP) {
  const bounds = new THREE.Box3();
  for (const item of Array.isArray(vehicle) ? vehicle : vehicle ? [vehicle] : VEHICLES) {
    const [x, y] = project([item.GEO_LON, item.GEO_LAT]);
    bounds.expandByPoint(new THREE.Vector3(x, surfaceY, -y));
  }
  // Keep a usable neighborhood around one vehicle or nearly coincident points.
  const [x0, y0] = project([0, 0]), [x1, y1] = project([.005, .005]);
  return bounds.expandByVector(new THREE.Vector3(Math.abs(x1 - x0), 0, Math.abs(y1 - y0)));
}

export function districtVehicleBounds(bounds, project, vehicle) {
  const [x, y] = project([vehicle.GEO_LON, vehicle.GEO_LAT]);
  const twiceCenter = new THREE.Vector3(x, bounds.max.y + .000001, -y).multiplyScalar(2);
  // Mirror the district about the vehicle: it stays centered while the whole district still fits.
  return bounds.clone().union(new THREE.Box3(twiceCenter.clone().sub(bounds.max), twiceCenter.clone().sub(bounds.min)));
}

export function vehicleDetailVisible(camera, project, size, previous = false) {
  const points = [[116.52, 39.86], [116.53, 39.86]].map(coords => {
    const [x, y] = project(coords);
    const p = new THREE.Vector3(x, TOP, -y).project(camera);
    return new THREE.Vector2(p.x * size.width / 2, p.y * size.height / 2);
  });
  // Screen scale, rather than administrative code, also handles wheel zoom and camera focus.
  return points[0].distanceTo(points[1]) >= (previous ? 1.6 : 2);
}

function MapLabelLayout({ model, labelPortal, viewport, onVehicleDetailChange }) {
  const { size, invalidate } = useThree();
  const detail = useRef(null);
  const regions = useMemo(() => new Map(model.regions.map(region => [String(region.feature.properties.adcode), region])), [model]);
  useLayoutEffect(() => { invalidate(); }, [model, size, viewport, invalidate]);
  useFrame(({ camera }) => {
    const detailed = vehicleDetailVisible(camera, model.project, size, detail.current);
    if (labelPortal.current) labelPortal.current.dataset.vehicleDetail = String(detailed);
    if (detail.current !== detailed) { detail.current = detailed; onVehicleDetailChange?.(detailed); }
    const elements = [...(labelPortal.current?.querySelectorAll('.vehicle-marker') || []), ...(labelPortal.current?.querySelectorAll('.map-region-label') || [])];
    const labels = elements.flatMap(element => {
      const region = regions.get(element.dataset.adcode);
      const vehicle = model.vehicles[Number(element.dataset.vehicle)];
      if (!region && !vehicle) return [];
      const position = vehicle?.position || [region.anchor[0], TOP + .08 * model.scale, region.anchor[2]];
      const point = new THREE.Vector3(...position).project(camera);
      const rect = element.getBoundingClientRect();
      return [{ element, vehicle, focused: !!vehicle || region.focused, x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2, width: rect.width, height: rect.height }];
    });
    const groups = groupVehiclePoints(labels.filter(label => label.vehicle).sort((a, b) => Number(b.element.dataset.highlighted === 'true') - Number(a.element.dataset.highlighted === 'true')), detailed);
    for (const group of groups) for (const [i, point] of group.entries()) {
      const highlighted = group.some(p => p.element.dataset.highlighted === 'true');
      point.element.dataset.members = group.map(p => p.element.dataset.vehicle).join(',');
      point.element.dataset.count = group.length;
      point.element.classList.toggle('is-selected', highlighted);
      point.element.setAttribute('aria-pressed', String(highlighted));
      point.element.setAttribute('aria-label', detailed ? `查看车辆 ${point.vehicle.vehicle.VEHICLENO}` : `车辆点 · ${group.length} 辆 · 点击放大`);
      point.element.style.visibility = i ? 'hidden' : 'visible';
      point.element.tabIndex = i ? -1 : 0;
    }
    const placed = [...groups.map(group => group[0]), ...labels.filter(label => !label.vehicle)];
    const bounds = viewport ? { left: (viewport.x + viewport.width * .02) * size.width, right: (viewport.x + viewport.width * .98) * size.width, top: (viewport.y + viewport.height * .12) * size.height, bottom: (viewport.y + viewport.height * .98) * size.height } : { left: 0, right: size.width, top: 0, bottom: size.height };
    const arranged = layoutLabels(placed, bounds);
    for (const { element, vehicle, x, y, dx = 0, dy = 0, width, height, hidden } of arranged) {
      const length = Math.hypot(dx, dy), edge = Math.min(dx ? width / 2 / Math.abs(dx) : Infinity, dy ? height / 2 / Math.abs(dy) : Infinity);
      // Broad-view dots stay at their actual coordinates; only detailed labels are displaced.
      if (vehicle && !detailed) {
        element.style.visibility = x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom ? 'hidden' : 'visible';
        element.style.setProperty('--label-x', '0px'); element.style.setProperty('--label-y', '0px'); element.style.setProperty('--leader-length', '0px');
        continue;
      }
      element.style.visibility = hidden ? 'hidden' : 'visible';
      element.style.setProperty('--label-x', `${dx}px`);
      element.style.setProperty('--label-y', `${dy}px`);
      element.style.setProperty('--leader-length', `${length ? Math.max(0, length * (1 - edge) - 2) : 0}px`);
      element.style.setProperty('--leader-angle', `${Math.atan2(dy, dx)}rad`);
    }
    const callout = labelPortal.current?.querySelector('.vehicle-callout');
    if (callout) {
      const anchor = arranged.find(label => label.element.dataset.vehicle === callout.dataset.vehicle);
      callout.style.visibility = !anchor || anchor.hidden ? 'hidden' : 'visible';
      if (anchor && !anchor.hidden) {
        const card = callout.querySelector('.vehicle-callout-card');
        card.style.maxWidth = `${bounds.right - bounds.left}px`;
        const rect = card.getBoundingClientRect(), dx = detailed ? anchor.dx || 0 : 0, dy = detailed ? anchor.dy || 0 : 0;
        const position = vehicleCalloutPosition({ x: anchor.x + dx, y: anchor.y + dy }, rect.width, rect.height, bounds);
        card.style.transform = `translate(${position.left - anchor.x}px, ${position.top - anchor.y}px)`;
        const endX = position.x - anchor.x, endY = position.y - anchor.y;
        const direction = Math.sign(endX - dx);
        callout.querySelector('path').setAttribute('d', `M${dx},${dy} L${dx + direction * 28},${dy} L${endX - direction * 20},${endY} L${endX},${endY}`);
        const dot = callout.querySelector('circle'); dot.setAttribute('cx', dx); dot.setAttribute('cy', dy);
      }
    }
  });
  return null;
}

function Roads({ data, project, layers, detail, scale, labelPortal }) {
  const labels = useMemo(() => {
    if (!detail || !layers.labels) return [];
    const byRef = new Map();
    for (const f of data?.features || []) {
      const motorway = f.properties.class === 'motorway';
      if (motorway ? !layers.highway : !layers.nationalRoad) continue;
      const ref = (f.properties.ref || '').split(';')[0];
      if (!ref || !/^[GS]\d+$/.test(ref)) continue;
      const paths = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const path of paths) {
        const points = path.map(project);
        const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
        if (length > (byRef.get(ref)?.length || 0)) byRef.set(ref, { ref, name: f.properties.name, rank: motorway ? 0 : ref.startsWith('G') ? 1 : 2, length, point: points[Math.floor(points.length / 2)] });
      }
    }
    const selected = [];
    for (const item of [...byRef.values()].sort((a,b) => a.rank - b.rank || b.length - a.length)) {
      if (selected.every(other => Math.hypot(item.point[0]-other.point[0], item.point[1]-other.point[1]) > .8 * scale)) selected.push(item);
      if (selected.length === 7) break;
    }
    return selected;
  }, [data, project, detail, scale, layers.highway, layers.nationalRoad, layers.labels]);
  const geometries = useMemo(() => {
    const positions = [[], []];
    for (const f of data?.features || []) {
      const motorway = f.properties.class === 'motorway';
      if (detail && (motorway ? !layers.highway : !layers.nationalRoad)) continue;
      const paths = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const path of paths) for (let i = 1; i < path.length; i++) {
        const a = project(path[i - 1]), b = project(path[i]);
        positions[motorway ? 0 : 1].push(a[0], TOP + .045 * scale, -a[1], b[0], TOP + .045 * scale, -b[1]);
      }
    }
    return positions.map(points => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)));
  }, [data, project, scale, layers.highway, layers.nationalRoad, detail]);
  useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);
  return <>{geometries.map((g, i) => <lineSegments key={i} geometry={g} renderOrder={2}>
    <lineBasicMaterial color={i === 0 ? '#e7bd78' : detail ? '#a58e68' : '#c5b591'} transparent opacity={detail ? .94 : .58} toneMapped={false} fog={false} depthWrite={false} />
  </lineSegments>)}{labels.map(({ref, name, point}) => <Html key={ref} portal={labelPortal} position={[point[0],TOP+.065 * scale,-point[1]]} center zIndexRange={[8,0]} style={{pointerEvents:'none'}}><span className="road-label" title={name}>{ref}</span></Html>)}</>;
}

function Beacon({ position, height, scale }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, .035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[.11, .15, 32]} /><meshBasicMaterial color="#efe3bb" transparent opacity={.65} toneMapped={false} />
    </mesh>
    <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[.028, .028, height, 5]} /><meshBasicMaterial color="#fff0ce" toneMapped={false} /></mesh>
    <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[.07, .12, height, 8, 1, true]} /><meshBasicMaterial color="#ebd8a3" transparent opacity={.13} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, height, 0]}><sphereGeometry args={[.068, 12, 8]} /><meshBasicMaterial color="#fff6db" toneMapped={false} /></mesh>
  </group>;
}

export const RegionMesh = memo(function RegionMesh({ region, selected, onSelect, onHover, roadmap }) {
  const [hover, setHover] = useState(false);
  const { feature, geometry, color } = region;
  const active = selected || hover;
  return <mesh geometry={geometry} castShadow receiveShadow onPointerOver={e => { e.stopPropagation(); setHover(true); onHover(feature.properties.name); }} onPointerOut={() => { setHover(false); onHover(''); }} onClick={e => { if (e.delta > 5 || !feature.properties.name) return; e.stopPropagation(); onSelect(feature); }}>
    {roadmap ? <meshBasicMaterial key={roadmap.key} attach="material-0" color={active ? '#ffedc5' : region.focused ? '#fff8e8' : color === '#464449' ? '#77736c' : '#ffffff'} toneMapped={false} fog={false} {...roadmap.props} />
      : <meshStandardMaterial key="plain" attach="material-0" color={active ? '#e0d3a8' : color} roughness={.48} metalness={.28} fog={false} />}
    <meshStandardMaterial attach="material-1" color={active ? '#ac9771' : '#6b6667'} roughness={.65} metalness={.22} fog={false} />
  </mesh>;
});

const heatFragment = `varying vec2 vUv; void main(){float d=length(vUv-0.5)*2.0; float a=pow(max(0.0,1.0-d),2.0)*0.4; gl_FragColor=vec4(1.0,0.70,0.32,a);}`;
const heatVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

export function updateMapClipping(camera, target, surfaceY = TOP) {
  const distance = camera.position.distanceTo(target);
  // A district-sized near plane loses depth precision when the camera pulls back.
  // Keep it relative to the live camera, below the visible surface even at grazing angles.
  camera.near = Math.max(.000001, Math.min(distance / 20, (camera.position.y - surfaceY) / 2));
  camera.far = Math.max(200, distance * 2);
  camera.updateProjectionMatrix();
}

export function fitMapViewport(camera, bounds, size, viewport, viewDirection = CAMERA) {
  if (!viewport || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(viewport[key])) || bounds.isEmpty() || size.width <= 0 || size.height <= 0) return null;
  const left = Math.max(0, viewport.x), right = Math.min(1, viewport.x + viewport.width);
  const top = Math.max(0, viewport.y), bottom = Math.min(1, viewport.y + viewport.height);
  const width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  const usable = { left: left + width * .08, right: right - width * .08, top: top + height * .12, bottom };
  const target = bounds.getCenter(new THREE.Vector3()), direction = new THREE.Vector3(...viewDirection).normalize();
  const horizontal = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
  const vertical = new THREE.Vector3().crossVectors(direction, horizontal);
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfWidth = (usable.right - usable.left) * tangent * size.width / size.height;
  const halfHeight = (usable.bottom - usable.top) * tangent;
  if (halfWidth <= 0 || halfHeight <= 0) return null;
  let distance = .001;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const relative = new THREE.Vector3(x, y, z).sub(target), depth = relative.dot(direction);
    distance = Math.max(distance, depth + Math.abs(relative.dot(horizontal)) / halfWidth, depth + Math.abs(relative.dot(vertical)) / halfHeight);
  }
  distance *= 1.015;
  if (!Number.isFinite(distance)) return null;
  camera.zoom = 1;
  // A full-canvas off-axis frustum places the map inside its editable DOM rectangle.
  camera.setViewOffset(size.width, size.height, size.width * (.5 - (usable.left + usable.right) / 2), size.height * (.5 - (usable.top + usable.bottom) / 2), size.width, size.height);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  updateMapClipping(camera, target, bounds.max.y);
  return { target, distance, usable };
}

function CameraControls({ command, code, onTelemetry, bounds, viewport, project }) {
  const controls = useRef();
  const { camera, size, gl, invalidate } = useThree();
  const frames = useRef(0), rendered = useRef(false);
  const flight = useRef(null), initialized = useRef(false), direction = useRef(new THREE.Vector3(...CAMERA));
  const focusBounds = useRef(bounds);
  const appliedCommand = useRef(0);
  useLayoutEffect(() => { focusBounds.current = bounds; }, [bounds]);
  const cancelFlight = () => { flight.current = null; if (controls.current) controls.current.enableDamping = true; };
  const fit = (animate = true) => {
    const c = controls.current;
    if (!c) return;
    const destination = camera.clone();
    const framed = fitMapViewport(destination, focusBounds.current, size, viewport || { x: 0, y: 0, width: 1, height: 1 }, direction.current.toArray());
    if (!framed) return;
    c.minDistance = Math.max(.0001, framed.distance * .2);
    c.maxDistance = Math.max(90, framed.distance * 1.2);
    camera.view = { ...destination.view };
    if (animate && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      flight.current = { start: performance.now(), from: camera.position.clone(), to: destination.position, fromTarget: c.target.clone(), toTarget: framed.target, zoom: camera.zoom };
      c.enableDamping = false;
    } else {
      cancelFlight(); camera.position.copy(destination.position); c.target.copy(framed.target); camera.zoom = 1; c.update();
    }
    camera.updateProjectionMatrix(); invalidate();
  };
  useLayoutEffect(() => {
    fit(initialized.current);
    initialized.current = true;
  }, [size.width, size.height, camera, invalidate, bounds, viewport?.x, viewport?.y, viewport?.width, viewport?.height]);
  useEffect(() => {
    const c = controls.current;
    if (!c || !command.sequence || appliedCommand.current === command.sequence) return;
    if (command.type === 'region' && command.vehicle !== code) return;
    if (command.type === 'vehicle' && command.regionCode !== code) return;
    appliedCommand.current = command.sequence;
    if (command.type === 'vehicle') { focusBounds.current = districtVehicleBounds(bounds, project, command.vehicle); fit(); return; }
    if (command.type === 'region') { focusBounds.current = bounds; fit(); return; }
    if (command.type === 'vehicles') { focusBounds.current = vehicleBounds(project, command.vehicle, bounds.max.y); fit(); return; }
    if (command.type === 'reset' || command.type === 'top') {
      if (command.type === 'reset') focusBounds.current = bounds;
      direction.current.set(...(command.type === 'top' ? [0, 1, .011] : CAMERA)); fit(); return;
    }
    cancelFlight();
    if (command.type === 'zoomIn') camera.zoom = Math.min(4, camera.zoom * 1.2);
    else if (command.type === 'zoomOut') camera.zoom = Math.max(.6, camera.zoom / 1.2);
    else if (command.type === 'rotate') {
      const offset = camera.position.clone().sub(c.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 12);
      camera.position.copy(c.target).add(offset);
      direction.current.copy(offset);
    }
    camera.updateProjectionMatrix(); c.update(); invalidate();
  }, [command, code, camera, invalidate]);
  useFrame(() => {
    const f = flight.current, c = controls.current;
    if (!c) return;
    if (f) {
      const progress = Math.min(1, (performance.now() - f.start) / 720), eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(f.from, f.to, eased); c.target.lerpVectors(f.fromTarget, f.toTarget, eased);
      camera.zoom = THREE.MathUtils.lerp(f.zoom, 1, eased);
      camera.updateProjectionMatrix(); c.update();
      if (progress === 1) cancelFlight(); else invalidate();
    }
    updateMapClipping(camera, c.target, bounds.max.y);
  });
  // Count a whole displayed frame, including reflection and shadow passes.
  useFrame(() => { gl.info.reset(); rendered.current = true; frames.current++; }, -1000);
  useEffect(() => {
    gl.info.autoReset = false;
    const unsubscribe = addAfterEffect(() => {
      if (!rendered.current) return;
      rendered.current = false;
      const info = gl.info;
      onTelemetry({ calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, dpr: gl.getPixelRatio().toFixed(2), frames: frames.current, camera: camera.position.toArray().map(n => n.toFixed(1)).join(', '), zoom: camera.zoom.toFixed(1) });
    });
    return () => { unsubscribe(); gl.info.autoReset = true; };
  }, [gl, camera, onTelemetry]);
  useEffect(() => {
    const lose = event => { event.preventDefault(); onTelemetry({ error: '图形上下文已中断，请重新加载页面。' }); };
    gl.domElement.addEventListener('webglcontextlost', lose);
    return () => gl.domElement.removeEventListener('webglcontextlost', lose);
  }, [gl, onTelemetry]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.12} enablePan screenSpacePanning minDistance={.0001} maxDistance={90} minPolarAngle={.01} maxPolarAngle={Math.PI / 2.12} onStart={cancelFlight} onEnd={() => direction.current.copy(camera.position).sub(controls.current.target)} onChange={() => invalidate()} />;
}

function World({ data, collections, roadData, labelPortal, code, layers, selected, onSelect, onHover, onVehicleSelect, onVehicleHover, onVehicleDetailChange, onVehicleClear, onVehicleDetails, vehicleHighlight = 'vehicle:all', command, quality, onTelemetry, viewport }) {
  const national = code === NATIONAL;
  const model = useMemo(() => modelFor(data, code, collections), [data, code, collections]);
  const { gl, invalidate } = useThree();
  const highlightedVehicles = vehicleHighlight === 'vehicle:all' ? [] : linkedVehicles(vehicleHighlight) || [];
  const selectedVehicle = highlightedVehicles.length === 1 ? model.vehicles.find(point => point.vehicle === highlightedVehicles[0]) : null;
  const vehicleMembers = element => (element.dataset.members || element.dataset.vehicle).split(',').map(i => model.vehicles[Number(i)].vehicle);
  const hoverVehicle = event => { if (event.currentTarget.dataset.vehicle !== String(VEHICLES.indexOf(selectedVehicle?.vehicle))) onVehicleHover?.({ vehicles: vehicleMembers(event.currentTarget), rect: event.currentTarget.getBoundingClientRect() }); };
  const { material: roadmap, status: roadmapStatus } = useRoadmap(layers.roadmap, model.project, viewport);
  const hubs = useMemo(() => national ? HUBS.map(h => {
    const [x, y] = model.project(h.point); return { ...h, position: [x, TOP + .035, -y] };
  }) : model.regions.filter(r => r.focused).slice(0, 8).map((r, i) => ({ name: shortName(r.feature.properties.name), position: r.anchor, height: .55 + (i % 3) * .27 })), [model, national]);
  const arcs = useMemo(() => {
    if (hubs.length < 2) return [];
    const origin = hubs[national ? 2 : 0].position;
    return hubs.filter((_, i) => i !== (national ? 2 : 0)).slice(0, 4).map(h => {
      const from = new THREE.Vector3(...origin), to = new THREE.Vector3(...h.position);
      const mid = from.clone().lerp(to, .5); mid.y = TOP + Math.min(2.8 * model.scale, from.distanceTo(to) * .32 + .5 * model.scale);
      return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(40);
    });
  }, [hubs, national, model.scale]);
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, [model, gl, invalidate, layers.beacons]);
  useEffect(() => () => { model.regions.forEach(r => r.geometry.dispose()); model.backdrops.forEach(g => g.dispose()); }, [model]);
  return <>
    <color attach="background" args={['#6f6f75']} />
    <fog attach="fog" args={['#6f6f75', 21, 42]} />
    <ambientLight intensity={.3} />
    <hemisphereLight args={['#fffaea', '#55515a', 1.0]} />
    <directionalLight position={[-6, 12, 5]} intensity={2.0} color="#fff1d4" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-.0004} shadow-normalBias={.035} shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={13} shadow-camera-bottom={-13} shadow-camera-near={.5} shadow-camera-far={40} />
    <pointLight position={[-9, 2.2, 6]} color="#ffe0b0" intensity={13} distance={14} decay={2} />
    <pointLight position={[-13, 1.4, 2]} color="#f8e1c4" intensity={11} distance={9} decay={2} />
    <Environment frames={1} resolution={128}>
      <Lightformer intensity={2.5} position={[0, 7, -4]} rotation={[Math.PI / 2, 0, 0]} scale={[20, 14, 1]} color="#fff7e7" />
      <Lightformer intensity={1.5} position={[-10, 4, 1]} rotation={[0, Math.PI / 2, 0]} scale={[8, 12, 1]} />
    </Environment>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.04, 0]} receiveShadow>
      <planeGeometry args={[180, 180]} />
      {quality === 'high' ? <MeshReflectorMaterial resolution={512} blur={[140, 80]} mixBlur={1} mixStrength={1.9} mirror={.16} color="#57565f" metalness={.2} roughness={.85} depthScale={.8} minDepthThreshold={.4} maxDepthThreshold={1.4} /> : <meshStandardMaterial color="#57565f" roughness={.88} metalness={.1} />}
    </mesh>
    <ContactShadows key={code} position={[0, -.02, 0]} scale={35} opacity={.4} blur={2.5} far={4} resolution={512} frames={1} color="#27222a" />
    {model.backdrops.map((geometry, i) => <mesh key={i} geometry={geometry} receiveShadow><meshStandardMaterial color="#464449" roughness={.48} metalness={.28} fog={false} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={4} /></mesh>)}
    {model.regions.map(region => <RegionMesh key={region.feature.properties.adcode} region={region} selected={String(region.feature.properties.adcode) === selected} onSelect={onSelect} onHover={onHover} roadmap={roadmap} />)}
    {roadmapStatus && <Html portal={labelPortal} position={model.bounds.getCenter(new THREE.Vector3()).toArray()} center style={{ pointerEvents: 'none' }}><span className="road-label" role="status">{roadmapStatus}</span></Html>}
    <Line points={model.edges} segments color="#8f8578" lineWidth={.75} transparent opacity={.75} toneMapped={false} fog={false} depthWrite={false} renderOrder={3} />
    {model.contextEdges.length > 0 && <Line points={model.contextEdges} segments color="#bfb6a7" lineWidth={.65} transparent opacity={.6} toneMapped={false} fog={false} depthWrite={false} renderOrder={2} />}
    {layers.roads && <Roads data={roadData} project={model.project} scale={model.scale} labelPortal={labelPortal} layers={layers} detail={code === '420381'} />}
    {layers.arcs && arcs.map((p, i) => <Line key={i} points={p} color="#f5e3b9" transparent opacity={.55} lineWidth={1} depthWrite={false} />)}
    {layers.beacons && hubs.map(h => <Beacon key={h.name} position={h.position} height={h.height} scale={model.scale} />)}
    {layers.vehicles && model.vehicles.map(({ vehicle, position }, i) => <Html key={vehicle.VEHICLENO} portal={labelPortal} position={position} center zIndexRange={[12, 9]} style={{ pointerEvents: 'none' }}><button ref={element => { if (element) invalidate(); }} className={`vehicle-marker${vehicle.GPS_SPEED > 0 ? ' is-moving' : ''}${highlightedVehicles.includes(vehicle) ? ' is-selected' : ''}`} data-vehicle={i} data-highlighted={highlightedVehicles.includes(vehicle)} aria-label={`查看车辆 ${vehicle.VEHICLENO}`} aria-pressed={highlightedVehicles.includes(vehicle)} aria-describedby="vehicle-hover-details" onPointerEnter={hoverVehicle} onPointerLeave={() => onVehicleHover?.(null)} onFocus={hoverVehicle} onBlur={() => onVehicleHover?.(null)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onVehicleHover?.(null); const detailed = labelPortal.current?.dataset.vehicleDetail === 'true'; onVehicleSelect(detailed ? vehicle : vehicleMembers(event.currentTarget), detailed); }}><i className="vehicle-dot" aria-hidden="true"/><span className="vehicle-symbol"><Car size={14} weight="fill"/><span>{vehicle.VEHICLENO}</span></span></button></Html>)}
    {layers.vehicles && selectedVehicle && <Html portal={labelPortal} position={selectedVehicle.position} zIndexRange={[15, 13]} style={{ pointerEvents: 'none' }}><VehicleCallout vehicle={selectedVehicle.vehicle} onClose={onVehicleClear} onDetails={onVehicleDetails}/></Html>}
    {layers.labels && model.regions.filter(r => r.feature.properties.name).map(({ feature, anchor, focused }) => <Html key={feature.properties.adcode} portal={labelPortal} position={[anchor[0], TOP + .08 * model.scale, anchor[2]]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}><span ref={element => { if (element) invalidate(); }} className={`map-region-label${focused ? ' is-focused' : ''}`} data-adcode={feature.properties.adcode} title={feature.properties.name}>{shortName(feature.properties.name)}</span></Html>)}
    {layers.heat && hubs.map(h => <mesh key={h.name} rotation={[-Math.PI / 2, 0, 0]} position={[h.position[0], TOP + .025 * model.scale, h.position[2]]}>
      <planeGeometry args={[2.0 * model.scale, 2.0 * model.scale]} /><shaderMaterial vertexShader={heatVertex} fragmentShader={heatFragment} transparent depthWrite={false} />
    </mesh>)}
    <CameraControls command={command} code={code} onTelemetry={onTelemetry} bounds={model.bounds} viewport={viewport} project={model.project} />
    {(layers.labels || layers.vehicles) && <MapLabelLayout model={model} labelPortal={labelPortal} viewport={viewport} onVehicleDetailChange={onVehicleDetailChange} />}
  </>;
}

export const MapScene = memo(function MapScene(props) {
  return <Canvas shadows={{ type: THREE.PCFShadowMap }} frameloop="demand" dpr={mapPixelRatio(props.sceneSize, props.quality)} camera={{ position: CAMERA, fov: 34, near: .1, far: 200 }} gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true; }} fallback={<span>三维行政区地图，可通过区域选择与视角按钮操作。</span>}>
    <Suspense fallback={null}><World {...props} /></Suspense>
  </Canvas>;
});
