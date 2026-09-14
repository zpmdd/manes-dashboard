import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addAfterEffect, Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, Line, MeshReflectorMaterial, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, labelPoint, NATIONAL, polygons, projection, shortName } from './geo';

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
  return { regions, project, edges, contextEdges, backdrops, bounds, scale };
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

export const RegionMesh = memo(function RegionMesh({ region, selected, onSelect, onHover }) {
  const [hover, setHover] = useState(false);
  const { feature, geometry, color } = region;
  const active = selected || hover;
  return <mesh geometry={geometry} castShadow receiveShadow onPointerOver={e => { e.stopPropagation(); setHover(true); onHover(feature.properties.name); }} onPointerOut={() => { setHover(false); onHover(''); }} onClick={e => { if (e.delta > 5 || !feature.properties.name) return; e.stopPropagation(); onSelect(feature); }}>
    <meshStandardMaterial attach="material-0" color={active ? '#e0d3a8' : color} roughness={.48} metalness={.28} fog={false} />
    <meshStandardMaterial attach="material-1" color={active ? '#ac9771' : '#6b6667'} roughness={.65} metalness={.22} fog={false} />
  </mesh>;
});

const heatFragment = `varying vec2 vUv; void main(){float d=length(vUv-0.5)*2.0; float a=pow(max(0.0,1.0-d),2.0)*0.4; gl_FragColor=vec4(1.0,0.70,0.32,a);}`;
const heatVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

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
  camera.near = Math.min(.1, distance / 1000);
  camera.far = Math.max(200, distance + bounds.getSize(new THREE.Vector3()).length() + 10);
  // A full-canvas off-axis frustum places the map inside its editable DOM rectangle.
  camera.setViewOffset(size.width, size.height, size.width * (.5 - (usable.left + usable.right) / 2), size.height * (.5 - (usable.top + usable.bottom) / 2), size.width, size.height);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return { target, distance, usable };
}

function CameraControls({ command, onTelemetry, bounds, viewport }) {
  const controls = useRef();
  const { camera, size, gl, invalidate } = useThree();
  const frames = useRef(0), rendered = useRef(false);
  const flight = useRef(null), initialized = useRef(false), direction = useRef(new THREE.Vector3(...CAMERA));
  const cancelFlight = () => { flight.current = null; if (controls.current) controls.current.enableDamping = true; };
  const fit = (animate = true) => {
    const c = controls.current;
    if (!c) return;
    const destination = camera.clone();
    const framed = fitMapViewport(destination, bounds, size, viewport || { x: 0, y: 0, width: 1, height: 1 }, direction.current.toArray());
    if (!framed) return;
    c.minDistance = Math.max(.0001, framed.distance * .2);
    c.maxDistance = Math.max(90, framed.distance * 1.2);
    camera.near = destination.near; camera.far = destination.far; camera.view = { ...destination.view };
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
    if (!c || !command.sequence) return;
    if (command.type === 'reset' || command.type === 'top') {
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
  }, [command, camera, invalidate]);
  useFrame(() => {
    const f = flight.current, c = controls.current;
    if (!f || !c) return;
    const progress = Math.min(1, (performance.now() - f.start) / 720), eased = progress * progress * (3 - 2 * progress);
    camera.position.lerpVectors(f.from, f.to, eased); c.target.lerpVectors(f.fromTarget, f.toTarget, eased);
    camera.zoom = THREE.MathUtils.lerp(f.zoom, 1, eased);
    camera.updateProjectionMatrix(); c.update();
    if (progress === 1) cancelFlight(); else invalidate();
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

function World({ data, collections, roadData, labelPortal, code, layers, selected, onSelect, onHover, command, quality, onTelemetry, viewport }) {
  const national = code === NATIONAL;
  const model = useMemo(() => modelFor(data, code, collections), [data, code, collections]);
  const { gl, invalidate } = useThree();
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
    {model.backdrops.map((geometry, i) => <mesh key={i} geometry={geometry} receiveShadow><meshStandardMaterial color="#464449" roughness={.48} metalness={.28} fog={false} /></mesh>)}
    {model.regions.map(region => <RegionMesh key={region.feature.properties.adcode} region={region} selected={String(region.feature.properties.adcode) === selected} onSelect={onSelect} onHover={onHover} />)}
    <Line points={model.edges} segments color="#8f8578" lineWidth={.75} transparent opacity={.75} toneMapped={false} fog={false} depthWrite={false} renderOrder={3} />
    {model.contextEdges.length > 0 && <Line points={model.contextEdges} segments color="#bfb6a7" lineWidth={.65} transparent opacity={.6} toneMapped={false} fog={false} depthWrite={false} renderOrder={2} />}
    {layers.roads && <Roads data={roadData} project={model.project} scale={model.scale} labelPortal={labelPortal} layers={layers} detail={code === '420381'} />}
    {layers.arcs && arcs.map((p, i) => <Line key={i} points={p} color="#f5e3b9" transparent opacity={.55} lineWidth={1} depthWrite={false} />)}
    {layers.beacons && hubs.map(h => <Beacon key={h.name} position={h.position} height={h.height} scale={model.scale} />)}
    {layers.labels && model.regions.filter(r => r.feature.properties.name).map(({ feature, anchor, focused }) => <Html key={feature.properties.adcode} portal={labelPortal} position={[anchor[0], TOP + .08 * model.scale, anchor[2]]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}><span className={`map-region-label${focused ? ' is-focused' : ''}`} data-adcode={feature.properties.adcode} title={feature.properties.name}>{shortName(feature.properties.name)}</span></Html>)}
    {layers.heat && hubs.map(h => <mesh key={h.name} rotation={[-Math.PI / 2, 0, 0]} position={[h.position[0], TOP + .025 * model.scale, h.position[2]]}>
      <planeGeometry args={[2.0 * model.scale, 2.0 * model.scale]} /><shaderMaterial vertexShader={heatVertex} fragmentShader={heatFragment} transparent depthWrite={false} />
    </mesh>)}
    <CameraControls command={command} onTelemetry={onTelemetry} bounds={model.bounds} viewport={viewport} />
  </>;
}

export const MapScene = memo(function MapScene(props) {
  return <Canvas shadows={{ type: THREE.PCFShadowMap }} frameloop="demand" dpr={mapPixelRatio(props.sceneSize, props.quality)} camera={{ position: CAMERA, fov: 34, near: .1, far: 200 }} gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true; }} fallback={<span>三维行政区地图，可通过区域选择与视角按钮操作。</span>}>
    <Suspense fallback={null}><World {...props} /></Suspense>
  </Canvas>;
});
