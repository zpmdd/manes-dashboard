import { strictDataNumber } from './dataSources.js';
import { VEHICLE_FIELDS } from './vehicles.js';

export const ALGORITHM_VERSION = 'daoyan-dbscan-1.0.0';
export const EARTH_RADIUS_KM = 6371.0088;
export const DEFAULT_CLUSTER_OPTIONS = Object.freeze({ epsKm: 1, minSamples: 3, windowMinutes: 5, coordinateSystem: 'unknown' });
const radians = degrees => degrees * Math.PI / 180;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sourceReference = (value, fallback) => (typeof value === 'string' && value.length <= 200) || Number.isSafeInteger(value) ? value : fallback;

export function clusterOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('算法参数必须是对象');
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_CLUSTER_OPTIONS, key))) throw new Error('存在未知算法参数');
  const options = { ...DEFAULT_CLUSTER_OPTIONS, ...input };
  if (!Number.isFinite(options.epsKm) || options.epsKm < .001 || options.epsKm > 200) throw new Error('邻域半径需为 0.001–200 km');
  if (!Number.isInteger(options.minSamples) || options.minSamples < 1 || options.minSamples > 100000) throw new Error('最少车辆数需为 1–100000 的整数');
  if (!Number.isInteger(options.windowMinutes) || options.windowMinutes < 1 || options.windowMinutes > 1440) throw new Error('时间窗需为 1–1440 分钟的整数');
  if (!['unknown', 'WGS84', 'GCJ02', 'BD09'].includes(options.coordinateSystem)) throw new Error('不支持的坐标系');
  return options;
}

export function optionsForRows(rows, override) {
  const tagged = rows.filter(row => row && Object.hasOwn(row, 'CLUSTER_OPTIONS'));
  let embedded;
  if (tagged.length) {
    if (tagged.length !== rows.length) throw new Error('不能混合原始点位与不同批次的算法结果，请分批接入');
    embedded = clusterOptions(tagged[0].CLUSTER_OPTIONS);
    if (tagged.some(row => JSON.stringify(clusterOptions(row.CLUSTER_OPTIONS)) !== JSON.stringify(embedded))) throw new Error('一个数据源中的算法参数必须一致');
  }
  const options = clusterOptions(override ?? embedded ?? {});
  if (embedded && options.windowMinutes !== embedded.windowMinutes) throw new Error('输入已按时间窗去重，无法恢复历史点；请从原 Excel 按新时间窗重算后再导入');
  return options;
}

// 无时区的原始 GPS 日期统一按北京时间解释，不依赖浏览器/服务器时区。
export function parseGpsTime(value) {
  if (typeof value !== 'string') throw new Error('GPS_DATE 需为日期文字，Excel 日期必须先转换');
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) throw new Error('GPS_DATE 格式无效');
  const [, y, m, d, h, minute, second = '0', fraction = '0', zone = '+08:00'] = match;
  const parts = [y, m, d, h, minute, second].map(Number);
  const [year, month, day, hour, min, sec] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, min, sec, Number(fraction.padEnd(3, '0'))));
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || min > 59 || sec > 59) throw new Error('GPS_DATE 日期超出范围或不存在');
  let offset = 0;
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes)) throw new Error('GPS_DATE 时区无效');
    offset = (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes) * 60000;
  }
  return date.getTime() - offset;
}

export function normalizeObservation(input, options, sourceRow = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('记录需为对象');
  if (input._IMPORT_ERROR) throw new Error(input._IMPORT_ERROR);
  const row = {};
  for (const [key] of VEHICLE_FIELDS) {
    const value = input[key];
    if (value != null && !['string', 'number'].includes(typeof value)) throw new Error(`${key} 需为文字或数字`);
    row[key] = value === '' || value == null ? null : value;
  }
  const plate = String(row.VEHICLENO ?? '').trim(), color = String(row.PALTE_COLOR ?? '').trim();
  if (!plate || !color || plate.length > 80 || color.length > 20) throw new Error('号牌号码和号牌颜色不能为空或过长');
  for (const key of ['GEO_LON', 'GEO_LAT', 'GPS_SPEED']) {
    row[key] = strictDataNumber(row[key]);
    if (row[key] === null) throw new Error(`${key} 无效`);
  }
  if (Math.abs(row.GEO_LON) > 180 || Math.abs(row.GEO_LAT) > 90 || row.GPS_SPEED < 0) throw new Error('坐标或速度超出范围');
  if (row.GEO_LON === 0 && row.GEO_LAT === 0) throw new Error('零经纬度占位记录不可用于车辆聚类');
  if (input.COORDINATE_SYSTEM && input.COORDINATE_SYSTEM !== options.coordinateSystem) throw new Error('记录坐标系与批次声明不一致');
  row.VEHICLENO = plate; row.PALTE_COLOR = color;
  const time = parseGpsTime(row.GPS_DATE), width = options.windowMinutes * 60000;
  const key = encodeURIComponent(JSON.stringify([plate, color]));
  return { row, key, time, windowStart: Math.floor(time / width) * width, sourceRow };
}

export function haversineKm(a, b) {
  const lat1 = radians(a[1]), lat2 = radians(b[1]);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

const vector = ([lon, lat]) => [Math.cos(radians(lat)) * Math.cos(radians(lon)), Math.cos(radians(lat)) * Math.sin(radians(lon)), Math.sin(radians(lat))];

// 三维单位球网格仅筛候选，最终逐对使用 haversine；跨日期线和极区也不漏邻居。
export function dbscan(points, options = DEFAULT_CLUSTER_OPTIONS, maxChecks = 50000000) {
  const { epsKm, minSamples } = clusterOptions(options);
  if (points.length > 100000) throw new Error('单窗超过 100000 辆，需在服务端提升容量后处理');
  const sites = [], byPosition = new Map();
  points.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('聚类坐标无效');
    const key = JSON.stringify(point);
    if (!byPosition.has(key)) { byPosition.set(key, sites.length); sites.push({ point, indices: [] }); }
    sites[byPosition.get(key)].indices.push(index);
  });
  const cellSize = 2 * Math.sin(epsKm / (2 * EARTH_RADIUS_KM)) * (1 + 1e-12), grid = new Map();
  for (const [i, site] of sites.entries()) {
    site.cell = vector(site.point).map(value => Math.floor(value / cellSize));
    const key = site.cell.join(',');
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  let checks = 0;
  const neighbors = i => {
    const found = [], [x, y, z] = sites[i].cell;
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${x + dx},${y + dy},${z + dz}`) || []) {
        // ponytail: 密集但不重合的数据仍可能 O(n²)；超预算明确失败，后续按实测更换精确空间索引。
        if (++checks > maxChecks) throw new Error('邻域查询超过计算预算，请减小时间窗或在批处理服务调整容量；未输出部分聚类');
        if (haversineKm(sites[i].point, sites[j].point) <= epsKm) { found.push(j); count += sites[j].indices.length; }
      }
    }
    return { found, core: count >= minSamples };
  };
  const labels = new Int32Array(sites.length).fill(-1), visited = new Uint8Array(sites.length), core = new Uint8Array(sites.length), queued = new Uint8Array(sites.length);
  let clusters = 0;
  for (let i = 0; i < sites.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const first = neighbors(i); core[i] = Number(first.core);
    if (!first.core) continue;
    labels[i] = clusters;
    const queue = [];
    const enqueue = indices => { for (const j of indices) if (!queued[j]) { queued[j] = 1; queue.push(j); } };
    enqueue(first.found);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const j = queue[cursor];
      if (!visited[j]) {
        visited[j] = 1;
        const next = neighbors(j); core[j] = Number(next.core);
        if (next.core) enqueue(next.found);
      }
      if (labels[j] === -1) labels[j] = clusters;
    }
    clusters++;
  }
  const assignments = new Array(points.length);
  sites.forEach((site, i) => site.indices.forEach(index => { assignments[index] = { label: labels[i], role: core[i] ? 'core' : labels[i] === -1 ? 'noise' : 'border' }; }));
  return { assignments, clusterCount: clusters, distanceChecks: checks, uniquePositions: sites.length };
}

export function createWindowAccumulator(windowStart, options) {
  const latest = new Map();
  let inputRows = 0, collapsedRows = 0;
  return {
    add(point) {
      if (point.windowStart !== windowStart) throw new Error('不同时间窗不可混算');
      inputRows++;
      const old = latest.get(point.key);
      if (old) collapsedRows++;
      if (!old || point.time > old.time) latest.set(point.key, { ...point, conflict: false });
      else if (point.time === old.time) {
        const conflict = old.conflict || point.row.GEO_LON !== old.row.GEO_LON || point.row.GEO_LAT !== old.row.GEO_LAT;
        if (compare(JSON.stringify(point.row), JSON.stringify(old.row)) < 0) latest.set(point.key, { ...point, conflict });
        else old.conflict = conflict;
      }
      if (latest.size > 100000) throw new Error('单窗超过 100000 辆，请缩小时间窗或提升处理容量');
    },
    finish() {
      const records = [...latest.values()].filter(point => !point.conflict).sort((a, b) => compare(a.key, b.key));
      const points = records.map(({ row }) => [row.GEO_LON, row.GEO_LAT]);
      const result = dbscan(points, options);
      const rows = records.map(({ row, key, sourceRow }, i) => ({ ...row, VEHICLE_KEY: key, SOURCE_ROW: sourceRow, CLUSTER_OPTIONS: options, CLUSTER_LABEL: result.assignments[i].label, POINT_ROLE: result.assignments[i].role }));
      const groups = Array.from({ length: result.clusterCount }, (_, label) => ({ label, memberKeys: [], coords: [], coreCount: 0 }));
      rows.forEach((row, i) => { if (row.CLUSTER_LABEL >= 0) { const group = groups[row.CLUSTER_LABEL]; group.memberKeys.push(row.VEHICLE_KEY); group.coords.push(points[i]); group.coreCount += Number(row.POINT_ROLE === 'core'); } });
      const clusters = groups.map(({ coords, ...group }) => {
        const sum = coords.reduce((sum, point) => vector(point).map((v, i) => sum[i] + v), [0, 0, 0]);
        const center = Math.hypot(...sum) < 1e-12 ? coords[0] : [Math.atan2(sum[1], sum[0]) * 180 / Math.PI, Math.atan2(sum[2], Math.hypot(sum[0], sum[1])) * 180 / Math.PI];
        return { ...group, id: `${windowStart}:${group.label}`, vehicleCount: coords.length, center, radiusKm: coords.reduce((max, point) => Math.max(max, haversineKm(center, point)), 0) };
      });
      const noiseKeys = rows.filter(row => row.CLUSTER_LABEL === -1).map(row => row.VEHICLE_KEY);
      const conflicts = [...latest.values()].filter(point => point.conflict).map(point => ({ vehicleKey: point.key, sourceRow: point.sourceRow, reason: '同车最新 GPS 时刻出现不同坐标，整车在此窗隔离' }));
      return { windowStart: new Date(windowStart).toISOString(), windowEnd: new Date(windowStart + options.windowMinutes * 60000).toISOString(), rows, clusters, noiseKeys,
        quality: { inputRows, collapsedRows, conflictVehicles: conflicts.length, usableVehicles: rows.length }, conflicts,
        metrics: { clusterCount: clusters.length, clusteredVehicles: rows.length - noiseKeys.length, noiseVehicles: noiseKeys.length, coreVehicles: rows.filter(row => row.POINT_ROLE === 'core').length, distanceChecks: result.distanceChecks, uniquePositions: result.uniquePositions } };
    },
  };
}

export function analyzeVehicles(rows, inputOptions) {
  if (!Array.isArray(rows)) throw new Error('数据必须为记录列表');
  const options = optionsForRows(rows, inputOptions), groups = new Map(), rejected = [];
  rows.forEach((row, i) => {
    let point;
    try { point = normalizeObservation(row, options, sourceReference(row?.SOURCE_ROW, i + 1)); }
    catch (error) { rejected.push({ sourceRow: sourceReference(row?.SOURCE_ROW, i + 1), reason: error.message }); return; }
    if (!groups.has(point.windowStart)) groups.set(point.windowStart, createWindowAccumulator(point.windowStart, options));
    groups.get(point.windowStart).add(point);
  });
  return { schemaVersion: 1, algorithmVersion: ALGORITHM_VERSION, options, inputRows: rows.length, rejected,
    windows: [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group.finish()) };
}
