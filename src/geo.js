export const NATIONAL = '100000';

export function polygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function pointsIn(geometry) {
  return polygons(geometry).flat(2);
}

export function extent(features, national = false) {
  const points = features.flatMap(f => pointsIn(f.geometry)).filter(p => !national || p[1] >= 18);
  if (!points.length) throw new Error('地图中没有可用的多边形坐标');
  return points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
}

export function projection(bounds) {
  const [west, south, east, north] = bounds;
  const lng = (west + east) / 2, lat = (south + north) / 2;
  const longitudeScale = Math.cos(lat * Math.PI / 180);
  const scale = 16 / Math.max((east - west) * longitudeScale, (north - south) * 1.1, 0.001);
  return ([x, y]) => [(x - lng) * longitudeScale * scale, (y - lat) * scale];
}

export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function inFeature(point, feature) {
  return polygons(feature.geometry).some(([outer, ...holes]) => inRing(point, outer) && !holes.some(hole => inRing(point, hole)));
}

export function labelPoint(feature) {
  const p = feature.properties.centroid || feature.properties.center;
  if (p && inFeature(p, feature)) return p;
  // GeoJSON centroids can fall in a lake or outside a concave polygon.
  const [w, s, e, n] = feature.bbox || extent([feature]);
  for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
    const candidate = [w + (e - w) * x / 10, s + (n - s) * y / 10];
    if (inFeature(candidate, feature)) return candidate;
  }
  return polygons(feature.geometry)[0][0][0];
}

export function lineage(code, index) {
  const result = [], visited = new Set();
  while (code && index[code] && !visited.has(code)) {
    visited.add(code);
    result.unshift({ code, ...index[code] });
    code = index[code].parent;
  }
  return result;
}

export function demoMetrics(code) {
  const seed = Number(code) || 100000;
  const devices = code === NATIONAL ? 2048 : 64 + seed % 357;
  return { devices, online: (97.8 + (seed % 14) / 10).toFixed(1), flow: code === NATIONAL ? 25 : 25 + seed % 17 };
}

export function shortName(name) {
  return name.replace(/壮族自治区|维吾尔自治区|回族自治区|特别行政区|自治区|省|市$/g, '');
}
