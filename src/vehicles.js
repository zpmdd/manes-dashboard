import { inFeature, NATIONAL } from './geo.js';

export const VEHICLE_FIELDS = [
  ['VEHICLENO', '号牌号码'], ['PALTE_COLOR', '号牌颜色'],
  ['GEO_LON', '经度'], ['GEO_LAT', '纬度'], ['GEO_ANG', '角度'], ['GEO_ALT', '海拔'],
  ['GPS_SPEED', 'GPS速度'], ['RECORD_SPEED', '行车定位速度'], ['MILEAGE', '里程'],
  ['GPS_DATE', 'GPS时间'], ['SI_DT', '入库时间'], ['ALARM_CODE', '报警信息'],
  ['STATE_CODE', '状态信息'], ['ENCRYPT', '加密标识'], ['OPERATOR_CODE', '运营商编码'],
];

// 用户提供的固定快照；保留原字段 PALTE_COLOR、空值及二进制字符串。
export const VEHICLES = [
  ['1', '1', 116.522857, 39.862656, 206, null, 0, 0, null, '2026/9/13 00:00', '2026/9/15 00:00', '00000000000000000000000000000011', '00000000000000000000000000000010', '1', '10'],
  ['2', '1', 116.522857, 39.8627, 206, null, 0, 0, null, '2026/9/13 00:00', '2026/9/15 00:00', '00000000000000000000000000000011', '00000000000000000000000000000010', '1', '10'],
  ['3', '1', 116.522857, 39.863, 206, null, 10, 10, null, '2026/9/13 00:00', '2026/9/15 00:00', '00000000000000000000000000000011', '00000000000000000000000000000010', '1', '10'],
  ['4', '1', 116.522858, 39.862656, 206, null, 0, 0, null, '2026/9/13 00:00', '2026/9/15 00:00', '00000000000000000000000000000011', '00000000000000000000000000000010', '1', '10'],
  ['5', '2', 117.522858, 40, 206, null, 0, 0, null, '2026/9/13 00:00', '2026/9/15 00:00', '00000000000000000000000000000011', '00000000000000000000000000000010', '1', '10'],
].map(values => Object.fromEntries(VEHICLE_FIELDS.map(([key], i) => [key, values[i]])));

// Vehicle links are scoped to this branch; ordinary region links keep their behavior.
export function linkedVehicles(code) {
  if (code === 'vehicle:all') return VEHICLES;
  if (code === 'vehicle:moving') return VEHICLES.filter(row => row.GPS_SPEED > 0);
  if (code === 'vehicle:stopped') return VEHICLES.filter(row => row.GPS_SPEED === 0);
  const vehicle = VEHICLES.find(row => code === `vehicle:${row.VEHICLENO}`);
  return vehicle ? [vehicle] : null;
}

export async function vehicleDistrict(vehicles, index, readRegion) {
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
