import { strictDataNumber } from './dataSources.js';
import { parseGpsTime } from './vehicleClustering.js';

const EPSILON = 1e-10;

function pointOnSegment([x, y], [ax, ay], [bx, by]) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > EPSILON) return false;
  return x >= Math.min(ax, bx) - EPSILON && x <= Math.max(ax, bx) + EPSILON
    && y >= Math.min(ay, by) - EPSILON && y <= Math.max(ay, by) + EPSILON;
}

export function pointInPolygon([longitude, latitude], boundary) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Array.isArray(boundary) || boundary.length < 3) return false;
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [xi, yi] = boundary[i], [xj, yj] = boundary[j];
    // 边界点按“进入限行区”处理，避免不同射线方向导致结果飘移。
    if (pointOnSegment([longitude, latitude], [xi, yi], [xj, yj])) return true;
    const intersects = yi > latitude !== yj > latitude && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function restrictionMembership(restriction, vehicles) {
  return vehicles.map(vehicle => {
    const inside = pointInPolygon([vehicle.GEO_LON, vehicle.GEO_LAT], restriction.boundary);
    const time = observationTime(vehicle), active = time === null ? null : isRestrictionActive(restriction, time);
    const target = isRestrictedTarget(restriction, vehicle);
    const matched = inside && active === true && target === true;
    const status = !inside || active === false || target === false ? '未命中' : matched ? '命中规则' : '信息不足';
    return { vehicle, inside, active, target, matched, status };
  });
}

const minutesOfDay = timestamp => {
  const date = new Date(typeof timestamp === 'string' ? observationTime({ GPS_DATE: timestamp }) ?? NaN : timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  // 当前业务数据按北京时间判定；无时区 GPS_DATE 也统一按 UTC+8 解释。
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

const clockMinutes = value => {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`限行时间无效：${value}`);
  const result = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`限行时间无效：${value}`);
  return result;
};

export function isRestrictionActive(restriction, timestamp) {
  const minute = minutesOfDay(timestamp);
  if (minute === null) return false;
  return (restriction.activePeriods || []).some(period => {
    const start = clockMinutes(period.start), end = clockMinutes(period.end);
    return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  });
}

export function isRestrictedTarget(restriction, vehicle) {
  const rules = restriction.targetRules || {};
  const vehicleType = String(vehicle.VEHICLE_TYPE || '').trim(), cargoType = String(vehicle.CARGO_TYPE || '').trim();
  if ((rules.vehicleTypes || []).includes(vehicleType) || (rules.cargoTypes || []).includes(cargoType)) return true;
  if ((rules.vehicleTypes?.length && !vehicleType) || (rules.cargoTypes?.length && !cargoType)) return null;
  return false;
}

function segmentBoundaryCrossings(from, to, boundary) {
  const [x1, y1] = from, [x2, y2] = to, results = [];
  for (let i = 0; i < boundary.length; i++) {
    const [x3, y3] = boundary[i], [x4, y4] = boundary[(i + 1) % boundary.length];
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denominator) <= EPSILON) continue;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
    if (t > EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
      const point = [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
      if (!results.some(item => Math.abs(item.point[0] - point[0]) < EPSILON && Math.abs(item.point[1] - point[1]) < EPSILON)) results.push({ ratio: t, point });
    }
  }
  return results.sort((a, b) => a.ratio - b.ratio);
}

const observationTime = row => {
  try { return parseGpsTime(row.GPS_DATE); } catch { return null; }
};

/**
 * 轨迹级限行验证：空间、时段、对象三项同时命中，并连续多点确认后才形成事件。
 * 同时返回轨迹与边界的插值交点，供稀疏采样场景复核。
 */
export function analyzeRestrictionTrajectory(restriction, rows, { confirmPoints = 3, maxGapMinutes = 5 } = {}) {
  if (!Number.isFinite(maxGapMinutes) || maxGapMinutes <= 0) throw new Error('最大间隔必须为正数');
  if (!Number.isInteger(confirmPoints) || confirmPoints < 1) throw new Error('连续点阈值必须为正整数');
  const observations = [], rejected = [], seen = new Map();
  rows.forEach((row, index) => {
    const longitude = strictDataNumber(row?.GEO_LON), latitude = strictDataNumber(row?.GEO_LAT), time = observationTime(row || {}), vehicleNo = String(row?.VEHICLENO || '').trim();
    if (!vehicleNo || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90 || time === null) {
      rejected.push({ sourceRow: row?.SOURCE_ROW ?? index + 1, reason: '车辆、坐标或 GPS_DATE 无效' }); return;
    }
    const vehicleKey = JSON.stringify([vehicleNo, String(row.PALTE_COLOR ?? '')]);
    const key = JSON.stringify([vehicleKey, time]);
    const signature = JSON.stringify([longitude, latitude, row.VEHICLE_TYPE ?? '', row.CARGO_TYPE ?? '']);
    if (seen.has(key)) {
      const previous = seen.get(key);
      if (previous.signature !== signature) {
        previous.invalid = true;
        rejected.push({ sourceRow: row.SOURCE_ROW ?? index + 1, reason: '同车同一时刻存在冲突记录' });
      }
      return;
    }
    const inside = pointInPolygon([longitude, latitude], restriction.boundary);
    const active = isRestrictionActive(restriction, time), target = isRestrictedTarget(restriction, row);
    const item = { row, vehicleNo, vehicleKey, signature, point: [longitude, latitude], time, inside, active, target, matched: inside && active && target === true };
    observations.push(item); seen.set(key, item);
  });
  const groups = new Map();
  observations.forEach(item => { if (item.invalid) return; if (!groups.has(item.vehicleKey)) groups.set(item.vehicleKey, []); groups.get(item.vehicleKey).push(item); });
  const events = [], crossings = [], maxGap = maxGapMinutes * 60000;
  for (const [vehicleKey, vehicleRows] of groups) {
    const vehicleNo = vehicleRows[0].vehicleNo;
    vehicleRows.sort((a, b) => a.time - b.time);
    let pending = [], entry = null;
    const flush = () => {
      if (pending.length >= confirmPoints) {
        const first = pending[0], last = pending.at(-1);
        events.push({ restrictionId: restriction.id, vehicleNo, vehicleKey, entryTime: entry?.time ?? first.time, exitTime: last.time, entryPoint: entry?.point ?? first.point, pointCount: pending.length });
      }
      pending = []; entry = null;
    };
    for (let i = 0; i < vehicleRows.length; i++) {
      const current = vehicleRows[i], previous = vehicleRows[i - 1];
      if (!current.matched || (pending.length && current.time - pending.at(-1).time > maxGap)) flush();
      if (previous && current.time - previous.time <= maxGap && current.target && current.active) {
        for (const crossing of segmentBoundaryCrossings(previous.point, current.point, restriction.boundary)) {
          const point = { vehicleNo, vehicleKey, time: Math.round(previous.time + crossing.ratio * (current.time - previous.time)), point: crossing.point };
          crossings.push(point);
          if (!previous.inside && current.matched && !pending.length && isRestrictionActive(restriction, point.time)) entry = point;
        }
      }
      if (current.matched) pending.push(current);
    }
    flush();
  }
  return { inputRows: rows.length, acceptedRows: observations.filter(item => !item.invalid).length, rejected, observations: observations.filter(item => !item.invalid), crossings, events };
}
