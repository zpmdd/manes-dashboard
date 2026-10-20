import DAOYAN_RESTRICTIONS from '../src/projects/daoyan-restrictions.json' with { type: 'json' };
import test from 'node:test';
import assert from 'node:assert/strict';
import { projection } from '../src/geo.js';
import { loadRestrictions, restrictionFromDraft, restrictionToDraft, RESTRICTION_STORAGE_KEY } from '../src/restrictionStore.js';


test('projection inverse restores longitude and latitude', () => {
  const project = projection([115, 39, 117, 41]);
  const point = [116.397128, 39.916527];
  const actual = project.inverse(project(point));
  assert.ok(Math.abs(actual[0] - point[0]) < 1e-10);
  assert.ok(Math.abs(actual[1] - point[1]) < 1e-10);
});

test('restriction draft saves structured time, target and boundary fields', () => {
  const draft = restrictionToDraft(DAOYAN_RESTRICTIONS[0]);
  draft.name = '页面绘制区域';
  draft.start = '08:30'; draft.end = '19:00';
  draft.vehicleTypes = '危化品运输车、重型货车'; draft.cargoTypes = '危险货物';
  const value = restrictionFromDraft(draft);
  assert.equal(value.schedule, '每日 08:30–19:00');
  assert.deepEqual(value.targetRules.vehicleTypes, ['危化品运输车', '重型货车']);
  assert.equal(value.boundary.length, draft.boundary.length);
});

test('restriction settings round-trip through storage', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  storage.setItem(RESTRICTION_STORAGE_KEY, JSON.stringify(DAOYAN_RESTRICTIONS));
  assert.deepEqual(loadRestrictions([], storage), DAOYAN_RESTRICTIONS);
});

test('浏览器拒绝访问存储时保留默认规则', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
  try { assert.equal(loadRestrictions(DAOYAN_RESTRICTIONS), DAOYAN_RESTRICTIONS); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('restriction rejects an unfinished polygon', () => {
  const draft = { ...restrictionToDraft(DAOYAN_RESTRICTIONS[0]), boundary: [[116, 39], [117, 40]] };
  assert.throws(() => restrictionFromDraft(draft), /至少需要 3 个/);
});

test('空坐标、非法边界和歧义时段不能保存', () => {
  for (const value of ['', ' ', null, false, NaN, Infinity]) {
    const draft = restrictionToDraft(DAOYAN_RESTRICTIONS[0]); draft.boundary[0][0] = value;
    assert.throws(() => restrictionFromDraft(draft), /经纬度/);
  }
  const draft = restrictionToDraft(DAOYAN_RESTRICTIONS[0]);
  draft.boundary = [[0, 0], [3, 3], [0, 3], [2, 0]];
  assert.throws(() => restrictionFromDraft(draft), /自相交/);
  draft.boundary = DAOYAN_RESTRICTIONS[0].boundary; draft.end = draft.start;
  assert.throws(() => restrictionFromDraft(draft), /不能相同/);
});
