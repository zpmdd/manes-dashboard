import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function tilePoint([longitude, latitude], zoom) {
  const radians = THREE.MathUtils.degToRad(Math.max(-85.05112878, Math.min(85.05112878, latitude)));
  return [(longitude + 180) / 360 * 2 ** zoom, (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom];
}

export function atlasGrid(index, zoom, bounds) {
  const columns = index.levels[zoom];
  const low = bounds && tilePoint([bounds[0], bounds[3]], zoom).map(Math.floor);
  const high = bounds && tilePoint([bounds[2], bounds[1]], zoom).map(Math.floor);
  const tiles = Object.entries(columns).flatMap(([x, rows]) => rows.map(y => [Number(x), y]))
    .filter(([x, y]) => !bounds || (x >= low[0] && y >= low[1] && x <= high[0] && y <= high[1]));
  const x = tiles.length ? Math.min(...tiles.map(t => t[0])) : 0, y = tiles.length ? Math.min(...tiles.map(t => t[1])) : 0;
  const width = tiles.length ? Math.max(...tiles.map(t => t[0])) - x + 1 : 1, height = tiles.length ? Math.max(...tiles.map(t => t[1])) - y + 1 : 1;
  return { zoom, x, y, width, height, key: [zoom, x, y, width, height].join('/'), tiles };
}

export function viewAtlas(index, project, camera, size, viewport, maxTextureSize = 2048, pixelRatio = 1) {
  const origin = project([0, 0]), unit = project([1, 1]).map((n, i) => n - origin[i]);
  const area = viewport || { x: 0, y: 0, width: 1, height: 1 };
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.36);
  const points = [];
  // The map is shared behind every panel, so detail must cover the whole visible canvas.
  for (const x of [0, 1]) for (const y of [0, 1]) {
    ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return atlasGrid(index, Math.min(5, index.maxZoom));
    points.push([(hit.x - origin[0]) / unit[0], (-hit.z - origin[1]) / unit[1]]);
  }
  const bounds = [Math.max(-180, Math.min(...points.map(p => p[0]))), Math.max(-85, Math.min(...points.map(p => p[1]))), Math.min(180, Math.max(...points.map(p => p[0]))), Math.min(85, Math.max(...points.map(p => p[1])))];
  if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) return atlasGrid(index, Math.min(5, index.maxZoom));
  ray.setFromCamera(new THREE.Vector2((area.x + area.width / 2) * 2 - 1, 1 - (area.y + area.height / 2) * 2), camera);
  const center = ray.ray.intersectPlane(plane, new THREE.Vector3());
  const [tx, ty] = tilePoint([(center.x - origin[0]) / unit[0], (-center.z - origin[1]) / unit[1]], index.maxZoom);
  const screen = (x, y) => {
    const world = project([x / 2 ** index.maxZoom * 360 - 180, THREE.MathUtils.radToDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** index.maxZoom))))]);
    const point = new THREE.Vector3(world[0], .36, -world[1]).project(camera);
    return new THREE.Vector2(point.x * size.width / 2, point.y * size.height / 2);
  };
  const start = screen(tx, ty), dx = screen(tx + 1 / 256, ty).sub(start), dy = screen(tx, ty + 1 / 256).sub(start);
  // Largest screen scale of a source pixel, including perspective, both axes and renderer DPR.
  const a = dx.lengthSq(), b = dx.dot(dy), c = dy.lengthSq();
  const footprint = Math.sqrt((a + c + Math.hypot(a - c, 2 * b)) / 2) * pixelRatio;
  const zoom = THREE.MathUtils.clamp(Math.ceil(index.maxZoom + Math.log2(footprint)), index.minZoom, index.maxZoom);
  // ponytail: one level around the view center; per-tile LOD only if larger packs exceed GPU texture limits.
  const limit = Math.max(1, Math.floor(maxTextureSize / 256));
  for (let z = zoom; z >= index.minZoom; z--) {
    const grid = atlasGrid(index, z, bounds);
    if (grid.width <= limit && grid.height <= limit) return grid;
  }
  return atlasGrid(index, index.minZoom);
}

export async function loadAtlas(grid, signal) {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width * 256; canvas.height = grid.height * 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('离线底图暂时无法绘制');
  const results = await Promise.allSettled(grid.tiles.map(async ([x, y]) => {
    const response = await fetch(`/roadmap/${grid.zoom}/${x}/${y}.png`, { signal, cache: 'force-cache' });
    if (!response.ok) throw new Error('瓦片读取失败');
    const bitmap = await createImageBitmap(await response.blob());
    try { if (!signal.aborted) context.drawImage(bitmap, (x - grid.x) * 256, (y - grid.y) * 256); }
    finally { bitmap.close(); }
  }));
  signal.throwIfAborted();
  const failures = results.filter(result => result.status === 'rejected').length;
  if (grid.tiles.length && failures === grid.tiles.length) throw new Error('离线底图读取失败，请关闭后重新开启');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { ...grid, texture, failures };
}

export function roadmapMaterial(base, detail, project) {
  const origin = project([0, 0]), unit = project([1, 1]).map((n, i) => n - origin[i]);
  const uniforms = {
    roadmapOrigin: { value: new THREE.Vector2(...origin) }, roadmapUnit: { value: new THREE.Vector2(...unit) },
    roadmapBase: { value: base.texture }, roadmapDetail: { value: (detail || base).texture },
    roadmapBaseGrid: { value: new THREE.Vector4(base.x, base.y, base.width, base.height) },
    roadmapDetailGrid: { value: new THREE.Vector4(...['x', 'y', 'width', 'height'].map(key => (detail || base)[key])) },
    roadmapZoom: { value: new THREE.Vector2(2 ** base.zoom, 2 ** (detail || base).zoom) },
  };
  return { key: `${base.texture.uuid}/${(detail || base).texture.uuid}`, props: {
    customProgramCacheKey: () => 'offline-roadmap-v1',
    onBeforeCompile(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec2 vRoadmapPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadmapPosition = vec2(position.x, -position.z);');
      shader.fragmentShader = `varying vec2 vRoadmapPosition;
uniform vec2 roadmapOrigin, roadmapUnit, roadmapZoom;
uniform sampler2D roadmapBase, roadmapDetail;
uniform vec4 roadmapBaseGrid, roadmapDetailGrid;
vec4 readRoadmap(sampler2D atlas, vec4 grid, vec2 tile) {
  vec2 uv = (tile - grid.xy) / grid.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture2D(atlas, vec2(uv.x, 1.0 - uv.y));
}
` + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
vec2 lngLat = (vRoadmapPosition - roadmapOrigin) / roadmapUnit;
float latitude = clamp(lngLat.y, -85.05112878, 85.05112878) * PI / 180.0;
vec2 tile = vec2((lngLat.x + 180.0) / 360.0, (1.0 - log(tan(PI / 4.0 + latitude / 2.0)) / PI) / 2.0);
vec4 baseColor = readRoadmap(roadmapBase, roadmapBaseGrid, tile * roadmapZoom.x);
vec4 detailColor = readRoadmap(roadmapDetail, roadmapDetailGrid, tile * roadmapZoom.y);
vec4 roadmapColor = mix(baseColor, detailColor, detailColor.a);
diffuseColor.rgb *= mix(vec3(1.0), roadmapColor.rgb, roadmapColor.a);`);
    },
  } };
}

export function useRoadmap(enabled, project, viewport) {
  const { camera, controls, size, gl, invalidate, viewport: { dpr } } = useThree();
  const [source, setSource] = useState(null), [detail, setDetail] = useState(null), [status, setStatus] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let base;
    setStatus('离线底图加载中…');
    (async () => {
      const response = await fetch('/roadmap/index.json', { signal: abort.signal, cache: 'force-cache' });
      if (!response.ok) throw new Error('离线底图索引读取失败，请关闭后重新开启');
      const index = await response.json();
      base = await loadAtlas(atlasGrid(index, Math.min(5, index.maxZoom)), abort.signal);
      base.texture.anisotropy = gl.capabilities.getMaxAnisotropy();
      setSource({ index, base }); setStatus(base.failures ? '部分底图未载入' : ''); invalidate();
    })().catch(error => { if (!abort.signal.aborted) setStatus(error.message); });
    return () => { abort.abort(); base?.texture.dispose(); setSource(null); setStatus(''); };
  }, [enabled, gl, invalidate]);
  useEffect(() => () => detail?.texture.dispose(), [detail]);
  useEffect(() => {
    if (!enabled || !source) return;
    let timer, abort, lastKey;
    const update = async () => {
      const grid = viewAtlas(source.index, project, camera, size, viewport, gl.capabilities.maxTextureSize, gl.getPixelRatio());
      if (grid.key === lastKey) return;
      lastKey = grid.key; abort?.abort();
      const request = new AbortController(); abort = request;
      if (grid.zoom <= source.base.zoom || !grid.tiles.length) { setDetail(null); return; }
      try {
        const atlas = await loadAtlas(grid, request.signal);
        atlas.texture.anisotropy = gl.capabilities.getMaxAnisotropy();
        setDetail(atlas); setStatus(atlas.failures || source.base.failures ? '部分底图未载入，暂显示概览' : ''); invalidate();
      } catch (error) { if (!request.signal.aborted) { setStatus(error.message); lastKey = null; } }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 160); };
    void update(); controls?.addEventListener('change', schedule);
    return () => { clearTimeout(timer); abort?.abort(); controls?.removeEventListener('change', schedule); setDetail(null); };
  }, [enabled, source, project, camera, controls, size.width, size.height, viewport?.x, viewport?.y, viewport?.width, viewport?.height, dpr, gl, invalidate]);
  const material = useMemo(() => enabled && source ? roadmapMaterial(source.base, detail, project) : null, [enabled, source, detail, project]);
  return { material, status: enabled ? status : '' };
}
