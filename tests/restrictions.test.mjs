import DAOYAN_RESTRICTIONS from '../src/projects/daoyan-restrictions.json' with { type: 'json' };
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeRestrictionTrajectory, isRestrictedTarget, isRestrictionActive, pointInPolygon, restrictionMembership } from '../src/restrictions.js';
import validationRows from '../测试数据/restriction-validation-1000.json' with { type: 'json' };

const raw = JSON.parse(readFileSync(new URL('../src/projects/daoyan-vehicles.json', import.meta.url), 'utf8'));

test('限行区域包含前四辆车且排除第五辆车', () => {
  const result = restrictionMembership(DAOYAN_RESTRICTIONS[0], raw);
  assert.deepEqual(result.filter(item => item.inside).map(item => item.vehicle.VEHICLENO), ['1', '2', '3', '4']);
  assert.deepEqual(result.filter(item => !item.inside).map(item => item.vehicle.VEHICLENO), ['5']);
});

test('多边形判定不依赖车牌硬编码', () => {
  const polygon = DAOYAN_RESTRICTIONS[0].boundary;
  assert.equal(pointInPolygon([116.522857, 39.862700], polygon), true);
  assert.equal(pointInPolygon([117.522858, 40], polygon), false);
});

test('边界点按范围内处理', () => {
  assert.equal(pointInPolygon(DAOYAN_RESTRICTIONS[0].boundary[0], DAOYAN_RESTRICTIONS[0].boundary), true);
});

test('限行时段与对象参与判定', () => {
  const restriction = DAOYAN_RESTRICTIONS[0];
  assert.equal(isRestrictionActive(restriction, '2026-10-20T08:00:00+08:00'), true);
  assert.equal(isRestrictionActive(restriction, '2026-10-20T02:00:00+08:00'), false);
  assert.equal(isRestrictedTarget(restriction, { VEHICLE_TYPE: '重型货车' }), true);
  assert.equal(isRestrictedTarget(restriction, { VEHICLE_TYPE: '小型客车', CARGO_TYPE: '普通货物' }), false);
});

test('1000 辆唯一车辆验证限行区内外判定与处理性能', () => {
  const rows = structuredClone(validationRows);
  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map(row => row.VEHICLENO)).size, 1000);
  const started = performance.now();
  const membership = restrictionMembership(DAOYAN_RESTRICTIONS[0], rows);
  const result = analyzeRestrictionTrajectory(DAOYAN_RESTRICTIONS[0], rows);
  const elapsedMs = performance.now() - started;
  assert.equal(membership.filter(item => item.inside).length, 800);
  assert.equal(membership.filter(item => !item.inside).length, 200);
  assert.equal(result.acceptedRows, 1000);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.observations.filter(item => item.inside).length, 800);
  assert.equal(result.observations.filter(item => item.matched).length, 800);
  assert.equal(result.events.length, 0, '单点车辆快照不应伪造连续轨迹事件');
  assert.ok(elapsedMs < 1000, `1000 条处理耗时 ${elapsedMs.toFixed(1)} ms`);
});

test('小型轨迹样本验证连续点确认和边界插值', () => {
  const coordinates = [116.5219, 116.5225, 116.5227, 116.5229, 116.5231, 116.5238];
  const rows = coordinates.map((longitude, index) => ({ VEHICLENO: 'TRACE-001', VEHICLE_TYPE: '重型货车', CARGO_TYPE: '危险品', GEO_LON: longitude, GEO_LAT: 39.8627, GPS_DATE: `2026-10-20 08:0${index}:00` }));
  const result = analyzeRestrictionTrajectory(DAOYAN_RESTRICTIONS[0], rows);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].pointCount, 4);
  assert.equal(result.crossings.length, 2);
});

test('重复点不能形成连续事件，同车同刻冲突记录被隔离', () => {
  const row = validationRows[0], restriction = DAOYAN_RESTRICTIONS[0];
  const repeated = analyzeRestrictionTrajectory(restriction, [row, row, row]);
  assert.equal(repeated.acceptedRows, 1); assert.equal(repeated.events.length, 0);
  const conflict = analyzeRestrictionTrajectory(restriction, [row, { ...row, GEO_LON: 117 }]);
  assert.equal(conflict.acceptedRows, 0); assert.equal(conflict.rejected.length, 1);
  const bad = analyzeRestrictionTrajectory(restriction, [{ ...row, GEO_LON: '' }, { ...row, GEO_LAT: null }, { ...row, GPS_DATE: '2026-02-30 08:00:00' }]);
  assert.equal(bad.acceptedRows, 0); assert.equal(bad.rejected.length, 3);
});

test('空间、北京时间与对象联合判定，缺失字段不伪造命中或违规', () => {
  const restriction = DAOYAN_RESTRICTIONS[0], row = validationRows[0];
  const result = restrictionMembership(restriction, [row, { ...row, GPS_DATE: '2026-10-20 02:00:00' }, { ...row, VEHICLE_TYPE: '', CARGO_TYPE: '' }, { ...row, GPS_DATE: '' }]);
  assert.deepEqual(result.map(item => item.status), ['命中规则', '未命中', '信息不足', '信息不足']);
  assert.equal(isRestrictionActive(restriction, '2026-10-20 08:00:00'), true);
  assert.equal(isRestrictionActive(restriction, '2026-10-20 22:00:00'), false);
  const night = { ...restriction, activePeriods: [{ start: '22:00', end: '07:00' }] };
  assert.equal(isRestrictionActive(night, '2026-10-20 02:00:00'), true);
  assert.equal(isRestrictionActive(night, '2026-10-20 12:00:00'), false);
});

test('长间隔分段不复用旧入界时间，同号牌不同颜色不合并连续点', () => {
  const restriction = DAOYAN_RESTRICTIONS[0], row = validationRows[0];
  const rows = [0, 1, 2, 20, 21, 22].map(minute => ({ ...row, GPS_DATE: `2026-10-20 08:${String(minute).padStart(2, '0')}:00` }));
  const result = analyzeRestrictionTrajectory(restriction, rows);
  assert.equal(result.events.length, 2);
  assert.equal(new Date(result.events[1].entryTime).toISOString(), '2026-10-20T00:20:00.000Z');
  assert.equal(analyzeRestrictionTrajectory(restriction, rows.slice(0, 3).map((r, i) => ({ ...r, PALTE_COLOR: String(i) }))).events.length, 0);
});
