import { strictDataNumber } from './dataSources.js';

export const RESTRICTION_STORAGE_KEY = 'manes.dashboard.daoyan.restrictions.20261020';

const splitValues = value => String(value || '').split(/[，,、]/).map(item => item.trim()).filter(Boolean);
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function restrictionToDraft(restriction) {
  const period = restriction.activePeriods?.[0] || {};
  return {
    ...restriction,
    boundary: restriction.boundary.map(point => [...point]),
    start: period.start || '07:00',
    end: period.end || '22:00',
    vehicleTypes: (restriction.targetRules?.vehicleTypes || []).join('、'),
    cargoTypes: (restriction.targetRules?.cargoTypes || []).join('、')
  };
}

export function restrictionFromDraft(draft) {
  if (typeof draft?.name !== 'string' || !draft.name.trim() || draft.name.length > 80) throw new Error('限行区域名称需为 1–80 个字');
  if (typeof draft.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(draft.id)) throw new Error('限行区域标识无效');
  if (!validTime(draft.start) || !validTime(draft.end)) throw new Error('请填写正确的限行时段');
  if (draft.start === draft.end) throw new Error('开始时间和结束时间不能相同');
  if (!Array.isArray(draft.boundary) || draft.boundary.length > 512 || draft.boundary.some(point => !Array.isArray(point) || point.length !== 2)) throw new Error('限行边界需为最多 512 个经纬度顶点');
  const boundary = draft.boundary.map(point => point.map(strictDataNumber));
  const unique = new Set(boundary.map(point => point.join(',')));
  if (boundary.length < 3 || unique.size < 3) throw new Error('限行区域至少需要 3 个不同顶点');
  if (boundary.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)) throw new Error('限行边界含无效经纬度');
  const area = Math.abs(boundary.reduce((sum, [x, y], index) => { const [px, py] = boundary[(index + boundary.length - 1) % boundary.length]; return sum + px * y - x * py; }, 0));
  if (area < 1e-10) throw new Error('限行边界不能位于同一直线上');
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < boundary.length; i++) for (let j = i + 2; j < boundary.length; j++) {
    if (i === 0 && j === boundary.length - 1) continue;
    const a = boundary[i], b = boundary[(i + 1) % boundary.length], c = boundary[j], d = boundary[(j + 1) % boundary.length];
    const overlaps = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
      && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
    if (overlaps && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) throw new Error('限行边界不能自相交或重复顶点');
  }
  if ([draft.vehicleTypes, draft.cargoTypes].some(value => typeof value !== 'string' || value.length > 500)) throw new Error('车型和货种需为最多 500 字的文字');
  const vehicleTypes = splitValues(draft.vehicleTypes), cargoTypes = splitValues(draft.cargoTypes);
  if (!vehicleTypes.length && !cargoTypes.length) throw new Error('请至少填写一种受限车型或货种');
  if (draft.coordinateSystem != null && (typeof draft.coordinateSystem !== 'string' || draft.coordinateSystem.length > 100)) throw new Error('坐标系说明无效');
  return {
    id: draft.id,
    name: draft.name.trim(),
    type: '区域限行',
    dataType: '经纬度坐标',
    coordinateSystem: draft.coordinateSystem || '与车辆 GPS 数据一致（未声明）',
    schedule: `每日 ${draft.start}–${draft.end}`,
    targets: [...vehicleTypes, ...cargoTypes].join('、'),
    activePeriods: [{ start: draft.start, end: draft.end }],
    targetRules: { vehicleTypes, cargoTypes },
    boundary
  };
}

export function normalizeRestrictions(value) {
  if (!Array.isArray(value) || value.length > 1) throw new Error('当前支持一个限行区域');
  return value.map(item => {
    if (!Array.isArray(item?.activePeriods) || item.activePeriods.length !== 1 || !validTime(item.activePeriods[0]?.start) || !validTime(item.activePeriods[0]?.end)) throw new Error('限行时段无效');
    for (const key of ['vehicleTypes', 'cargoTypes']) if (!Array.isArray(item.targetRules?.[key]) || item.targetRules[key].some(entry => typeof entry !== 'string')) throw new Error('限行对象格式无效');
    const normalized = restrictionFromDraft(restrictionToDraft(item));
    return { ...normalized, targets: typeof item.targets === 'string' && item.targets.length <= 1000 ? item.targets : normalized.targets };
  });
}

export function loadRestrictions(fallback, storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const value = JSON.parse(storage?.getItem(RESTRICTION_STORAGE_KEY) || 'null');
    return value === null ? fallback : normalizeRestrictions(value);
  } catch { return fallback; }
}
