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
  // Place one label in the main landmass, clear of both coastlines and holes.
  const area = ring => Math.abs(ring.reduce((sum, [x, y], i) => {
    const previous = ring[(i + ring.length - 1) % ring.length];
    return sum + previous[0] * y - x * previous[1];
  }, 0));
  const main = polygons(feature.geometry).reduce((largest, polygon) => area(polygon[0]) > area(largest[0]) ? polygon : largest);
  const [w, s, e, n] = extent([{ geometry: { type: 'Polygon', coordinates: main } }]);
  const longitudeScale = Math.cos((s + n) * Math.PI / 360);
  const rings = main.map(ring => ring.map(([x, y]) => [x * longitudeScale, y]));
  const width = (e - w) * longitudeScale, height = n - s;
  if (!width || !height) return main[0][0];
  const distance = (x, y) => {
    let squared = Infinity;
    for (const ring of rings) for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      squared = Math.min(squared, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2);
    }
    const inside = inRing([x, y], rings[0]) && !rings.slice(1).some(ring => inRing([x, y], ring));
    return (inside ? 1 : -1) * Math.sqrt(squared);
  };
  const cell = (x, y, halfWidth, halfHeight) => {
    const d = distance(x, y);
    return { x, y, halfWidth, halfHeight, d, max: d + Math.hypot(halfWidth, halfHeight) };
  };
  // Polylabel-style branch and bound; relative precision also works for districts.
  const precision = Math.max(width, height) / 256;
  let best = cell((w + e) / 2 * longitudeScale, (s + n) / 2, width / 2, height / 2);
  const pending = [best];
  while (pending.length) {
    const current = pending.pop();
    if (current.d > best.d) best = current;
    if (best.d > 0 && current.max - best.d <= precision) continue;
    const hw = current.halfWidth / 2, hh = current.halfHeight / 2;
    const children = [-hw, hw].flatMap(dx => [-hh, hh].map(dy => cell(current.x + dx, current.y + dy, hw, hh)));
    pending.push(...children.sort((a, b) => a.max - b.max));
  }
  return [best.x / longitudeScale, best.y];
}

export function layoutLabels(labels, bounds, gap = 2) {
  const placed = [];
  // ponytail: greedy placement suits administrative labels; use a spatial index if label counts grow into thousands.
  return [...labels].sort((a, b) => Number(!!b.focused) - Number(!!a.focused)).map(label => {
    const { x, y, width, height } = label;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return { ...label, hidden: true };
    for (let ring = 0; ring <= 8; ring++) {
      const offsets = ring ? [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]
        .map(([dx, dy]) => [dx * ring * (width / 2 + gap), dy * ring * (height + gap)])
        .sort((a, b) => Math.hypot(...a) - Math.hypot(...b)) : [[0, 0]];
      for (const [dx, dy] of offsets) {
        const box = { left: x + dx - width / 2, right: x + dx + width / 2, top: y + dy - height / 2, bottom: y + dy + height / 2 };
        if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) continue;
        if (placed.some(other => box.left < other.right + gap && box.right + gap > other.left && box.top < other.bottom + gap && box.bottom + gap > other.top)) continue;
        placed.push(box);
        return { ...label, dx, dy, hidden: false };
      }
    }
    return { ...label, hidden: true };
  });
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
