import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, MODULE_TYPES, SOURCES, STORAGE_KEY, loadConfig, normalizeConfig, saveConfig } from '../src/dashboardConfig.js';

const draft = () => structuredClone(DEFAULT_CONFIG);

test('配置可往返保存，裁剪空白且保持独立草稿和固定模块位置', () => {
  const config = draft(); config.title = '  运行中心  '; config.modules.reverse();
  const result = normalizeConfig(config);
  assert.equal(result.title, '运行中心');
  assert.deepEqual(result.modules.map(module => module.id), DEFAULT_CONFIG.modules.map(module => module.id));
  result.modules[0].columns[0].label = '变更';
  assert.equal(DEFAULT_CONFIG.modules[0].columns[0].label, '区域');
  assert.deepEqual(normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG))), DEFAULT_CONFIG);
});

test('所有可选图表与数据源组合均为有效配置', () => {
  for (const type of MODULE_TYPES) for (const source of type.sources) {
    const config = draft();
    Object.assign(config.modules[0], { type: type.id, source, unit: SOURCES[source].unit, columns: SOURCES[source].columns });
    assert.equal(normalizeConfig(config).modules[0].type, type.id);
  }
});

test('损坏、危险文字、未知字段与不兼容组合拒绝导入', () => {
  const invalid = [
    config => { config.version = 2; },
    config => { config.title = ''; },
    config => { config.title = '字'.repeat(37); },
    config => { config.title = '<script>alert(1)</script>'; },
    config => { config.title = 'javascript:alert(1)'; },
    config => { config.title = '非法\u0000文字'; },
    config => { config.brand = 123; },
    config => { config.showClock = 'true'; },
    config => { config.navLabels.pop(); },
    config => { config.modules.pop(); },
    config => { config.modules[1].id = 'devices'; },
    config => { config.modules[0].id = 'unknown'; },
    config => { config.modules[0].source = 'toString'; },
    config => { config.modules[0].type = 'gauge'; },
    config => { config.modules[1].unit = '台'; },
    config => { config.modules[0].rowCount = 9; },
    config => { config.modules[0].rowCount = '5'; },
    config => { config.modules[0].rowCount = 3.5; },
    config => { config.modules[0].visible = 1; },
    config => { config.modules[0].columns = []; },
    config => { config.modules[0].columns[0].key = 'html'; },
    config => { config.modules[0].columns[1].key = 'name'; },
    config => { config.modules[0].columns[0].label = '字'.repeat(13); },
    config => { config.modules[0].columns[0].onclick = 'alert(1)'; },
    config => { config.modules[0].html = '<b>test</b>'; },
    config => { config.extra = 'unknown'; },
    config => { delete config.title; },
  ];
  for (const change of invalid) { const config = draft(); change(config); assert.throws(() => normalizeConfig(config), Error); }
  for (const value of [null, [], {}, 123, 'config', Object.create(DEFAULT_CONFIG)]) assert.throws(() => normalizeConfig(value), Error);
  assert.throws(() => normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG).replace('"version":1', '"version":1,"__proto__":{}'))), /未知字段/);
});

test('保存失败不报告成功；损坏和不可用存储可恢复默认', () => {
  let stored = null;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => { assert.equal(key, STORAGE_KEY); return stored; }, setItem: (key, value) => { assert.equal(key, STORAGE_KEY); stored = value; } } });
    assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
    const config = draft(); config.brand = 'CUSTOM';
    assert.deepEqual(saveConfig(config), config);
    assert.deepEqual(loadConfig(), config);
    stored = '{broken'; assert.deepEqual(loadConfig(), DEFAULT_CONFIG); assert.equal(stored, '{broken');
    stored = 'x'.repeat(65537); assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
    assert.throws(() => saveConfig(config), /配置未保存/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});
