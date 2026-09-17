import { inFeature, NATIONAL } from './geo.js';
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
      const number = key => {
        const value = row[key];
        const parsed = strictDataNumber(value);
        if (parsed === null) throw new Error(`第 ${i + 1} 辆车的 ${key} 无效`);
        return parsed;
      };
      const lon = number('GEO_LON'), lat = number('GEO_LAT'), speed = number('GPS_SPEED');
      if (!id || ids.has(id) || ['all', 'moving', 'stopped'].includes(id)) throw new Error('车辆号牌不能为空、重复或使用联动保留名称');
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90 || speed < 0) throw new Error(`第 ${i + 1} 辆车的坐标或速度超出范围`);
      ids.add(id);
      return { ...row, VEHICLENO: id, GEO_LON: lon, GEO_LAT: lat, GPS_SPEED: speed,
        name: `车辆 ${id}`, count: 1, code: `vehicle:${id}`, status: speed > 0 ? '行驶' : '静止', stateCode: speed > 0 ? 'vehicle:moving' : 'vehicle:stopped' };
    });
    return { ...result, rows };
  } catch (error) { return { ...result, rows: EMPTY_VEHICLES, status: 'error', error: error.message }; }
}

export function linkedVehicles(code, vehicles = EMPTY_VEHICLES) {
  if (code === 'vehicle:all') return vehicles;
  if (code === 'vehicle:moving') return vehicles.filter(row => row.GPS_SPEED > 0);
  if (code === 'vehicle:stopped') return vehicles.filter(row => row.GPS_SPEED === 0);
  const vehicle = vehicles.find(row => code === `vehicle:${row.VEHICLENO}`);
  return vehicle ? [vehicle] : null;
}

export async function vehicleDistrict(vehicles, index, readRegion) {
  if (!vehicles.length) return null;
  let code = NATIONAL;
  const visited = new Set();
  while (index?.[code]?.hasChildren && !visited.has(code)) {
    visited.add(code);
    const data = await readRegion(code);
    const feature = data.features.find(item => vehicles.every(vehicle => inFeature([vehicle.GEO_LON, vehicle.GEO_LAT], item)));
    if (!feature) return null;
    code = String(feature.properties.adcode);
    if (index[code]?.level === 'district') return code;
  }
  return null;
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

export function groupVehiclePoints(points, detailed) {
  const groups = [];
  // ponytail: linear scan is sufficient for this five-vehicle snapshot; use a spatial index for large fleets.
  for (const point of points) {
    const group = !detailed && groups.find(items => Math.hypot(items[0].x - point.x, items[0].y - point.y) < 22);
    if (group) group.push(point); else groups.push([point]);
  }
  return groups;
}
