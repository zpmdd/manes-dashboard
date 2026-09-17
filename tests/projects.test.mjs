import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import base from '../src/projects/base.js';
import daoyan from '../src/projects/daoyan.js';
import { DEFAULT_CONFIG, configForProject, defaultConfigForProject, legacyProject, loadConfig, saveConfig, projectStorageKey } from '../src/dashboardConfig.js';
import { saveTemplate, readTemplates, readLegacyTemplates, deleteTemplate, getBuiltinTemplates, parseTemplateFile, serializeTemplate } from '../src/templateLibrary.js';
import { getMappedData } from '../src/dataSources.js';
import { vehicleDataResult, linkedVehicles, vehicleDistrict } from '../src/vehicles.js';

const legacy = JSON.parse(await readFile(new URL('../docs/daoyan-vehicles.canvas.json', import.meta.url), 'utf8'));
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
function withStorage(store, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  try { run(); } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
}

test('两套预设共享基线功能，基线无车辆数据，道研完整保留三卡布局', () => {
  const first = defaultConfigForProject(base), second = defaultConfigForProject(daoyan);
  assert.deepEqual(first, DEFAULT_CONFIG); assert.equal(first.map.vehicleSourceId, ''); assert.deepEqual(first.dataSources, []);
  assert.equal(base.showBrand, true); assert.equal(daoyan.showBrand, false);
  assert.equal(second.projectId, 'daoyan'); assert.equal(second.dataSources.length, 1);
  assert.deepEqual(second.map.layout, legacy.map.layout);
  assert.deepEqual(second.modules.map(item => item.layout), legacy.modules.map(item => item.layout));
  assert(second.modules.every(item => item.binding.sourceId === second.map.vehicleSourceId));
  second.modules[0].title = '只改当前草稿'; assert.notEqual(defaultConfigForProject(daoyan).modules[0].title, second.modules[0].title);
  assert.equal(getBuiltinTemplates(daoyan)[0].config.projectId, 'daoyan');
});

test('同一浏览器中的两个项目独立保存、重载和管理模板', () => {
  const store = storage();
  withStorage(store, () => {
    for (const project of [base, daoyan]) {
      const config = { ...defaultConfigForProject(project), title: `${project.name}自定义标题`, theme: 'ocean', font: 'wenkai' };
      assert.deepEqual(saveConfig(config, project), config);
      saveTemplate('我的布局', config, store, project);
    }
    assert.equal(loadConfig(base).title, '基线版自定义标题'); assert.equal(loadConfig(daoyan).title, '道研版自定义标题');
    assert.equal(readTemplates(store, base)[0].config.projectId, 'base'); assert.equal(readTemplates(store, daoyan)[0].config.projectId, 'daoyan');
    deleteTemplate(readTemplates(store, base)[0].id, store, base);
    assert.equal(readTemplates(store, base).length, 0); assert.equal(readTemplates(store, daoyan).length, 1);
    assert.equal(store.values.size, 4);
  });
});

test('旧道研快照只进入道研，迁移保留布局与原始存储并合并数据源', () => {
  const store = storage(), bytes = JSON.stringify(legacy);
  store.setItem('nexus.dashboard.config.v2', bytes);
  withStorage(store, () => {
    assert.equal(legacyProject(legacy), 'daoyan'); assert.deepEqual(loadConfig(base), DEFAULT_CONFIG);
    const migrated = loadConfig(daoyan);
    assert.deepEqual(migrated.modules.map(item => item.layout), legacy.modules.map(item => item.layout));
    assert.equal(migrated.dataSources.length, 1); assert.equal(migrated.modules[1].binding.groupBy, 'name');
    assert.equal(store.values.size, 1, '读取不自动写存储');
    saveConfig(migrated, daoyan); assert.equal(store.getItem('nexus.dashboard.config.v2'), bytes);
    assert.deepEqual(loadConfig(base), DEFAULT_CONFIG);
    migrated.map.vehicleSourceId = '';
    saveConfig(migrated, daoyan);
    assert.equal(loadConfig(daoyan).map.vehicleSourceId, '', '显式解除地图绑定后不能被旧源标识再次接回');
  });
});

test('未知归属旧画布不自动串用，可显式导入；损坏的新存储不被旧数据覆盖', () => {
  const store = storage(), unknown = structuredClone(DEFAULT_CONFIG);
  delete unknown.projectId;
  unknown.dataSources = [{ id: 'ds_custom', name: '独立数据', type: 'json', content: '[]', url: '', rowsPath: '', refreshSeconds: 0 }];
  store.setItem('nexus.dashboard.config.v2', JSON.stringify(unknown));
  withStorage(store, () => {
    assert.equal(legacyProject(unknown), null);
    assert.deepEqual(loadConfig(base), DEFAULT_CONFIG); assert.equal(loadConfig(daoyan).modules.length, 3);
    assert.equal(parseTemplateFile(JSON.stringify(unknown), daoyan).projectId, 'daoyan');
    store.setItem(projectStorageKey(daoyan), '{broken');
    assert.deepEqual(loadConfig(daoyan), defaultConfigForProject(daoyan));
    assert.equal(store.getItem(projectStorageKey(daoyan)), '{broken');
  });
});

test('导入导出标记项目并拒绝串项目、未知模式及保存失败', () => {
  for (const project of [base, daoyan]) {
    const config = defaultConfigForProject(project);
    assert.deepEqual(parseTemplateFile(serializeTemplate(config, project), project), config);
    assert.throws(() => parseTemplateFile(serializeTemplate(config, project), project === base ? daoyan : base), /属于/);
    withStorage({ getItem: () => null, setItem() { throw new Error('quota'); } }, () => assert.throws(() => saveConfig(config, project), /未保存/));
  }
  assert.throws(() => projectStorageKey({ id: '../daoyan' }), /未知项目/);
  assert.throws(() => configForProject({ ...DEFAULT_CONFIG, projectId: 'missing' }, base), /属于|未知/);
  assert.throws(() => configForProject({ ...DEFAULT_CONFIG, projectId: null }, base), /未知/);
  assert.throws(() => configForProject({ ...defaultConfigForProject(daoyan), projectId: 'base' }, base), /车辆/);
});

test('地图和三卡来自同一组车辆，增删改、数字字符串和空数据均同步', () => {
  const config = defaultConfigForProject(daoyan), initial = JSON.parse(config.dataSources[0].content);
  const raw = [...initial.slice(0, 2), { ...initial[2], VEHICLENO: 'NEW', GPS_SPEED: '22.5', GEO_LON: '116.52' }];
  const result = vehicleDataResult({ rows: raw, status: 'ready' });
  assert.equal(result.status, 'ready'); assert.equal(result.rows.length, 3);
  const cards = config.modules.map(item => getMappedData(result, item.binding, item));
  assert.equal(cards[0].value, result.rows.length);
  assert.deepEqual(cards[1].rows.map(row => [row.name, row.value]).sort(), [['行驶', 1], ['静止', 2]].sort());
  assert.deepEqual(cards[2].rows.map(row => row.value), [0, 0, 22.5]);
  assert.equal(linkedVehicles('vehicle:NEW', result.rows)[0].GPS_SPEED, 22.5);
  assert.equal(linkedVehicles('vehicle:3', result.rows), null);
  for (const card of cards) for (const row of card.rows) assert(linkedVehicles(row.code, result.rows).length);
  const empty = vehicleDataResult({ rows: [], status: 'ready' });
  assert.equal(getMappedData(empty, config.modules[0].binding, config.modules[0]).value, null);
  assert.deepEqual(empty.rows, []);
});

test('非法车辆不会回退固定快照，失败保留上次数据的语义；分组编码冲突不能错误联动', async () => {
  const config = defaultConfigForProject(daoyan), row = JSON.parse(config.dataSources[0].content)[0];
  for (const bad of [{ ...row, GEO_LAT: 91 }, { ...row, GEO_LON: null }, { ...row, GPS_SPEED: '' }, { ...row, VEHICLENO: '' }, { ...row, VEHICLENO: 'all' }, { ...row, ALARM_CODE: { nested: true } }]) {
    const result = vehicleDataResult({ rows: [bad], status: 'ready' });
    assert.equal(result.status, 'error'); assert.deepEqual(result.rows, []); assert(result.error);
  }
  assert.equal(vehicleDataResult({ rows: [row, row], status: 'ready' }).status, 'error');
  const stale = vehicleDataResult({ rows: [row], status: 'error', stale: true, error: '服务暂不可用' });
  assert.equal(stale.rows.length, 1); assert.equal(stale.error, '服务暂不可用'); assert.equal(stale.stale, true);
  assert.equal(await vehicleDistrict([], {}, () => assert.fail('空车队不能遍历地图')), null);
  assert.throws(() => getMappedData({ rows: [{ name: '同名', value: 1, code: 'a' }, { name: '同名', value: 2, code: 'b' }] }, { sourceId: 'ds_x', fields: { name: 'name', value: 'value', code: 'code' }, groupBy: 'name' }, { type: 'donut' }), /联动编码/);
});

test('旧模板按归属复制，损坏或重复记录拒绝迁移且保留原字节', () => {
  const store = storage(), oldKey = 'nexus.dashboard.templates.v1';
  const record = (id, config) => ({ id, name: '历史布局', createdAt: '2026-09-13T00:00:00Z', config });
  const oldBase = structuredClone(DEFAULT_CONFIG); delete oldBase.projectId;
  const items = [record('template-base', oldBase), record('template-daoyan', legacy)];
  const bytes = JSON.stringify({ version: 1, items }); store.setItem(oldKey, bytes);
  assert.deepEqual(readTemplates(store, base).map(item => item.id), ['template-base']);
  assert.deepEqual(readTemplates(store, daoyan).map(item => item.id), ['template-daoyan']);
  saveTemplate('新道研布局', defaultConfigForProject(daoyan), store, daoyan);
  assert.equal(readTemplates(store, daoyan).length, 2); assert.equal(store.getItem(oldKey), bytes);
  for (const broken of [[items[0], items[0]], [{ ...items[0], id: 'invalid' }], [{ ...items[0], createdAt: 'invalid' }]]) {
    const raw = JSON.stringify({ version: 1, items: broken }); store.setItem(oldKey, raw);
    assert.throws(() => readLegacyTemplates(store), /记录/); assert.equal(store.getItem(oldKey), raw);
  }
});
