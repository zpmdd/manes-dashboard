import { inFeature, lineage, shortName, NATIONAL, extent } from './geo.js';
import { strictDataNumber } from './dataSources.js';

export const VEHICLE_FIELDS = [
  ['VEHICLENO', '号牌号码'], ['PALTE_COLOR', '号牌颜色'],
  ['GEO_LON', '经度'], ['GEO_LAT', '纬度'], ['GEO_ANG', '角度'], ['GEO_ALT', '海拔'],
  ['GPS_SPEED', 'GPS速度'], ['RECORD_SPEED', '行车定位速度'], ['MILEAGE', '里程'],
  ['GPS_DATE', 'GPS时间'], ['SI_DT', '入库时间'], ['ALARM_CODE', '报警信息'],
  ['STATE_CODE', '状态信息'], ['ENCRYPT', '加密标识'], ['OPERATOR_CODE', '运营商编码'],
];

export const EMPTY_VEHICLES = [];

export function vehicleDataResult(result) {
  if (!result) return { rows: EMPTY_VEHICLES, status: 'loading' };
  try {
    const ids = new Set();
    const rows = (result.rows || []).map((row, i) => {
      for (const [key] of VEHICLE_FIELDS) if (row[key] != null && !['string', 'number'].includes(typeof row[key])) throw new Error(`第 ${i + 1} 辆车的 ${key} 需为文字或数字`);
      const id = String(row.VEHICLENO ?? '').trim();
      const identity = row.VEHICLE_KEY ?? id;
      if (typeof identity !== 'string' || identity.length > 600) throw new Error('车辆标识无效');
      const number = key => {
        const value = row[key];
        const parsed = strictDataNumber(value);
        if (parsed === null) throw new Error(`第 ${i + 1} 辆车的 ${key} 无效`);
        return parsed;
      };
      const lon = number('GEO_LON'), lat = number('GEO_LAT'), speed = number('GPS_SPEED');
      if (!id || !identity || ids.has(identity) || ['all', 'moving', 'stopped'].includes(identity)) throw new Error('车辆号牌不能为空、重复或使用联动保留名称');
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90 || speed < 0) throw new Error(`第 ${i + 1} 辆车的坐标或速度超出范围`);
      ids.add(identity);
      return { ...row, VEHICLENO: id, GEO_LON: lon, GEO_LAT: lat, GPS_SPEED: speed,
        name: `车辆 ${id}`, count: 1, code: `vehicle:${identity}`, status: speed > 0 ? '行驶' : '静止', stateCode: speed > 0 ? 'vehicle:moving' : 'vehicle:stopped' };
    });
    return { ...result, rows };
  } catch (error) { return { ...result, rows: EMPTY_VEHICLES, status: 'error', error: error.message }; }
}

export function linkedVehicles(code, vehicles = EMPTY_VEHICLES) {
  if (code === 'vehicle:all') return vehicles;
  if (code === 'vehicle:moving') return vehicles.filter(row => row.GPS_SPEED > 0);
  if (code === 'vehicle:stopped') return vehicles.filter(row => row.GPS_SPEED === 0);
  if (/^cluster:(-1|\d+)$/.test(code)) return vehicles.filter(row => row.CLUSTER_LABEL === Number(code.slice(8)));
  const vehicle = vehicles.find(row => code === (row.code || `vehicle:${row.VEHICLENO}`));
  return vehicle ? [vehicle] : null;
}

const featureBounds = new WeakMap();
function containsVehicle(feature, vehicle) {
  if (!featureBounds.has(feature)) featureBounds.set(feature, extent([feature]));
  const [west, south, east, north] = featureBounds.get(feature), x = vehicle.GEO_LON, y = vehicle.GEO_LAT;
  return x >= west && x <= east && y >= south && y <= north && inFeature([x, y], feature);
}

export async function vehicleDistrict(vehicles, index, readRegion) {
  if (!vehicles.length) return null;
  let code = NATIONAL;
  const visited = new Set();
  while (index?.[code]?.hasChildren && !visited.has(code)) {
    visited.add(code);
    const data = await readRegion(code);
    const feature = data.features.find(item => vehicles.every(vehicle => containsVehicle(item, vehicle)));
    if (!feature) return null;
    code = String(feature.properties.adcode);
    if (index[code]?.level === 'district') return code;
  }
  return null;
}

export function vehicleLocationLabel(district, index) {
  const path = lineage(district, index), province = path.find(item => item.level === 'province'), city = path.find(item => item.level === 'city');
  if (!province || index[district]?.level !== 'district') return '未匹配地区';
  const cityName = city?.name || (/市$/.test(province.name) ? province.name : '省直辖');
  return [shortName(province.name), shortName(cityName), index[district].name].join('-');
}

export function vehicleCalloutPosition(point, width, height, bounds) {
  const gap = 80, clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  let left = point.x + gap, top = point.y - height - 48;
  if (left + width > bounds.right) {
    left = point.x - gap - width;
    if (left < bounds.left) {
      left = point.x - width / 2;
      top = point.y - 24 - height >= bounds.top ? point.y - 24 - height : point.y + 24;
    }
  }
  left = clamp(left, bounds.left, bounds.right - width);
  top = clamp(top, bounds.top, bounds.bottom - height);
  const x = clamp(point.x, left, left + width), y = clamp(point.y, top, top + height);
  return { left, top, x, y };
}

export const VEHICLE_MARKER_LIMIT = 64;
export const CLUSTER_LABEL_LIMIT = 24;

export function groupVehiclePoints(points, detailed, limit = VEHICLE_MARKER_LIMIT) {
  if (detailed && points.length <= limit) return points.map(point => [point]);
  const pinned = points.filter(point => point.pinned).map(point => [point]);
  const rest = points.filter(point => !point.pinned);
  let radius = detailed ? 48 : 22, groups;
  // Screen aggregation preserves every member; only the selected individual is pinned.
  do {
    groups = []; const grid = new Map();
    for (const point of rest) {
      const x = Math.floor(point.x / radius), y = Math.floor(point.y / radius);
      let group;
      for (let dx = -1; dx <= 1 && !group; dx++) for (let dy = -1; dy <= 1 && !group; dy++) {
        group = grid.get(`${x + dx},${y + dy}`)?.find(items => Math.hypot(items[0].x - point.x, items[0].y - point.y) < radius);
      }
      if (group) group.push(point);
      else { group = [point]; groups.push(group); const cell = `${x},${y}`; if (!grid.has(cell)) grid.set(cell, []); grid.get(cell).push(group); }
    }
    radius *= 1.6;
  } while (groups.length + pinned.length > limit && groups.length > 1);
  return [...pinned, ...groups];
}
