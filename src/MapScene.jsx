import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addAfterEffect, Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, Line, MeshReflectorMaterial, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, labelPoint, NATIONAL, polygons, projection, shortName } from './geo';

const CAMERA = [0, 15, 21];
const TOP = 0.36;
const PALETTE = ['#aaa6a0', '#a9a6a0', '#555357', '#8e8c88', '#c0bdb3', '#6b6869'];
const HUBS = [
  { name: '北京', point: [116.4, 39.9], height: 1.25 },
  { name: '上海', point: [121.47, 31.23], height: 0.85 },
  { name: '武汉', point: [114.3, 30.59], height: 1.65 },
  { name: '广州', point: [113.26, 23.13], height: 1.0 },
  { name: '成都', point: [104.06, 30.57], height: 0.8 },
  { name: '西安', point: [108.94, 34.34], height: 0.65 },
];

function modelFor(data, national) {
  const project = projection(extent(data.features, national));
  const edges = [];
  const regions = data.features.flatMap((f, i) => {
    const shapes = polygons(f.geometry).filter(poly => !national || poly[0].some(p => p[1] >= 18)).map(poly => {
      const shape = new THREE.Shape(poly[0].map(p => new THREE.Vector2(...project(p))));
      shape.holes = poly.slice(1).map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(...project(p)))));
      for (const ring of poly) for (let j = 1; j < ring.length; j++) {
        const a = project(ring[j - 1]), b = project(ring[j]);
        edges.push(a[0], TOP + .022, -a[1], b[0], TOP + .022, -b[1]);
      }
      return shape;
    });
    if (!shapes.length) return [];
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: TOP, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
    mergeGroups(geometry);
    geometry.rotateX(-Math.PI / 2);
    const [x, y] = project(labelPoint(f));
    return [{ feature: f, geometry, anchor: [x, TOP, -y], color: national && f.properties.adcode === 420000 ? '#b3a07c' : PALETTE[i % PALETTE.length] }];
  });
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  const bounds = new THREE.Box3();
  regions.forEach(r => { r.geometry.computeBoundingBox(); bounds.union(r.geometry.boundingBox); });
  return { regions, project, edgeGeometry, bounds };
}

function Roads({ data, project, layers, detail }) {
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
      if (selected.every(other => Math.hypot(item.point[0]-other.point[0], item.point[1]-other.point[1]) > .8)) selected.push(item);
      if (selected.length === 7) break;
    }
    return selected;
  }, [data, project, detail, layers.highway, layers.nationalRoad, layers.labels]);
  const geometries = useMemo(() => {
    const positions = [[], []];
    for (const f of data?.features || []) {
      const motorway = f.properties.class === 'motorway';
      if (detail && (motorway ? !layers.highway : !layers.nationalRoad)) continue;
      const paths = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const path of paths) for (let i = 1; i < path.length; i++) {
        const a = project(path[i - 1]), b = project(path[i]);
        positions[motorway ? 0 : 1].push(a[0], TOP + .045, -a[1], b[0], TOP + .045, -b[1]);
      }
    }
    return positions.map(points => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)));
  }, [data, project, layers.highway, layers.nationalRoad, detail]);
  useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);
  return <>{geometries.map((g, i) => <lineSegments key={i} geometry={g} renderOrder={2}>
    <lineBasicMaterial color={i === 0 ? '#e7bd78' : detail ? '#a58e68' : '#c5b591'} transparent opacity={detail ? .94 : .58} toneMapped={false} fog={false} depthWrite={false} />
  </lineSegments>)}{labels.map(({ref, name, point}) => <Html key={ref} position={[point[0],TOP+.065,-point[1]]} center zIndexRange={[8,0]} style={{pointerEvents:'none'}}><span className="road-label" title={name}>{ref}</span></Html>)}</>;
}

function Beacon({ position, height, name, label }) {
  return <group position={position}>
    <mesh position={[0, .035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[.11, .15, 32]} /><meshBasicMaterial color="#efe3bb" transparent opacity={.65} toneMapped={false} />
    </mesh>
    <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[.028, .028, height, 5]} /><meshBasicMaterial color="#fff0ce" toneMapped={false} /></mesh>
    <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[.07, .12, height, 8, 1, true]} /><meshBasicMaterial color="#ebd8a3" transparent opacity={.13} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, height, 0]}><sphereGeometry args={[.068, 12, 8]} /><meshBasicMaterial color="#fff6db" toneMapped={false} /></mesh>
    {label && <Html position={[0, height + .12, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[8, 0]}><span className="map-hub-label">{name}</span></Html>}
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

export function fitMapViewport(camera, bounds, size, viewport) {
  if (!viewport || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(viewport[key])) || bounds.isEmpty() || size.width <= 0 || size.height <= 0) return null;
  const left = Math.max(0, viewport.x), right = Math.min(1, viewport.x + viewport.width);
  const top = Math.max(0, viewport.y), bottom = Math.min(1, viewport.y + viewport.height);
  const width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  const usable = { left: left + width * .08, right: right - width * .08, top: top + height * .12, bottom };
  const target = bounds.getCenter(new THREE.Vector3()), direction = new THREE.Vector3(...CAMERA).normalize();
  const horizontal = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
  const vertical = new THREE.Vector3().crossVectors(direction, horizontal);
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfWidth = (usable.right - usable.left) * tangent * size.width / size.height;
  const halfHeight = (usable.bottom - usable.top) * tangent;
  if (halfWidth <= 0 || halfHeight <= 0) return null;
  let distance = 10;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const relative = new THREE.Vector3(x, y, z).sub(target), depth = relative.dot(direction);
    distance = Math.max(distance, depth + Math.abs(relative.dot(horizontal)) / halfWidth, depth + Math.abs(relative.dot(vertical)) / halfHeight);
  }
  distance *= 1.015;
  if (!Number.isFinite(distance)) return null;
  camera.zoom = 1;
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
  const fit = () => {
    const framed = fitMapViewport(camera, bounds, size, viewport);
    if (framed) {
      if (controls.current) controls.current.maxDistance = Math.max(90, framed.distance * 1.2);
      return framed.target;
    }
    const narrow = size.width <= 650;
    const usableWidth = narrow ? .92 : .79;
    let distance = Math.max(23, 16 / (usableWidth * .92 * 2 * Math.tan(17 * Math.PI / 180) * (size.width / size.height)));
    camera.zoom = 1;
    camera.far = 200;
    if (controls.current) controls.current.maxDistance = 90;
    camera.setViewOffset(size.width, size.height, narrow ? 0 : -size.width * .105, size.height * (narrow ? .10 : 0), size.width, size.height);
    const corners = [];
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) corners.push(new THREE.Vector3(x,y,z));
    // Fit the complete region in perspective, including its nearest corners.
    for (let i=0;i<24;i++) {
      camera.position.copy(new THREE.Vector3(...CAMERA).normalize().multiplyScalar(distance));
      camera.lookAt(0,0,0); camera.updateMatrixWorld();
      const projected = corners.map(p => p.clone().project(camera));
      if (projected.every(p => p.x >= (narrow ? -.9 : -.57) && p.x <= .93 && p.y >= (narrow ? -.58 : -.486) && p.y <= (narrow ? .64 : .734))) break;
      distance *= 1.045;
    }
    return new THREE.Vector3();
  };
  useLayoutEffect(() => {
    const target = fit();
    camera.updateProjectionMatrix();
    controls.current?.target.copy(target);
    controls.current?.update();
    invalidate();
  }, [size.width, size.height, camera, invalidate, bounds, viewport?.x, viewport?.y, viewport?.width, viewport?.height]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (command.type === 'reset') {
      c.target.copy(fit());
    } else if (command.type === 'zoomIn') camera.zoom = Math.min(4, camera.zoom * 1.2);
    else if (command.type === 'zoomOut') camera.zoom = Math.max(.6, camera.zoom / 1.2);
    else if (command.type === 'top') { camera.position.set(0, 25, .1); c.target.set(0, 0, 0); }
    else if (command.type === 'rotate') {
      const offset = camera.position.clone().sub(c.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 12);
      camera.position.copy(c.target).add(offset);
    }
    camera.updateProjectionMatrix(); c.update(); invalidate();
  }, [command, camera, invalidate]);
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
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.12} enablePan screenSpacePanning minDistance={10} maxDistance={90} minPolarAngle={.01} maxPolarAngle={Math.PI / 2.12} onChange={() => invalidate()} />;
}

function World({ data, roadData, code, layers, selected, onSelect, onHover, command, quality, onTelemetry, viewport }) {
  const national = code === NATIONAL;
  const model = useMemo(() => modelFor(data, national), [data, national]);
  const { gl, invalidate, size, setDpr } = useThree();
  const hubs = useMemo(() => national ? HUBS.map(h => {
    const [x, y] = model.project(h.point); return { ...h, position: [x, TOP + .035, -y] };
  }) : model.regions.filter(r => typeof r.feature.properties.adcode === 'number').slice(0, 8).map((r, i) => ({ name: shortName(r.feature.properties.name), position: r.anchor, height: .55 + (i % 3) * .27 })), [model, national]);
  const arcs = useMemo(() => {
    if (hubs.length < 2) return [];
    const origin = hubs[national ? 2 : 0].position;
    return hubs.filter((_, i) => i !== (national ? 2 : 0)).slice(0, 4).map(h => {
      const from = new THREE.Vector3(...origin), to = new THREE.Vector3(...h.position);
      const mid = from.clone().lerp(to, .5); mid.y = Math.min(2.8, from.distanceTo(to) * .32 + .5);
      return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(40);
    });
  }, [hubs, national]);
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, [model, gl, invalidate, layers.beacons]);
  useEffect(() => {
    const pixelBudget = quality === 'high' ? 2560 * 1440 : 1920 * 1080;
    setDpr(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1, Math.sqrt(pixelBudget / (size.width * size.height))));
  }, [size.width, size.height, quality, setDpr]);
  useEffect(() => () => { model.regions.forEach(r => r.geometry.dispose()); model.edgeGeometry.dispose(); }, [model]);
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
    {model.regions.map(region => <RegionMesh key={`${code}-${region.feature.properties.adcode}`} region={region} selected={String(region.feature.properties.adcode) === selected} onSelect={onSelect} onHover={onHover} />)}
    <lineSegments geometry={model.edgeGeometry}><lineBasicMaterial color="#ede7d3" transparent opacity={.56} /></lineSegments>
    {layers.roads && <Roads data={roadData} project={model.project} layers={layers} detail={code === '420381'} />}
    {layers.arcs && arcs.map((p, i) => <Line key={i} points={p} color="#f5e3b9" transparent opacity={.55} lineWidth={1} depthWrite={false} />)}
    {layers.beacons && hubs.map(h => <Beacon key={h.name} position={h.position} height={h.height} name={h.name} label={layers.labels} />)}
    {layers.heat && hubs.map(h => <mesh key={h.name} rotation={[-Math.PI / 2, 0, 0]} position={[h.position[0], TOP + .025, h.position[2]]}>
      <planeGeometry args={[2.0, 2.0]} /><shaderMaterial vertexShader={heatVertex} fragmentShader={heatFragment} transparent depthWrite={false} />
    </mesh>)}
    <CameraControls command={command} onTelemetry={onTelemetry} bounds={model.bounds} viewport={viewport} />
  </>;
}

class MapErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="map-error" role="alert"><strong>三维地图暂时无法显示</strong><p>请检查浏览器硬件加速，或重新加载页面。</p><button onClick={() => location.reload()}>重新加载</button><small>{this.state.error.message}</small></div>;
    return this.props.children;
  }
}

export const MapScene = memo(function MapScene(props) {
  return <MapErrorBoundary><Canvas shadows={{ type: THREE.PCFShadowMap }} frameloop="demand" dpr={props.quality === 'high' ? [1, 1.5] : 1} camera={{ position: CAMERA, fov: 34, near: .1, far: 200 }} gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true; }} fallback={<div className="map-error">此浏览器不支持 WebGL，请启用硬件加速。</div>}>
    <Suspense fallback={null}><World {...props} /></Suspense>
  </Canvas></MapErrorBoundary>;
});
