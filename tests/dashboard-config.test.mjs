import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_FILE_LIMIT, DEFAULT_CONFIG, MODULE_TYPES, SOURCES, STORAGE_KEY, createModule, loadConfig, normalizeConfig, saveConfig } from '../src/dashboardConfig.js';
import { parseTemplateFile, readTemplates, saveTemplate, serializeTemplate } from '../src/templateLibrary.js';
import { DEFAULT_FONT, FONTS } from '../src/fonts.js';

const draft = () => structuredClone(DEFAULT_CONFIG);
const LEGACY_KEY = 'nexus.dashboard.config.v1';
const source = () => ({ id: 'ds_custom', name: '业务数据', type: 'json', content: '[{"device":{"name":"城区"},"count":12,"goal":20}]', url: '', rowsPath: '', refreshSeconds: 0 });
function legacyDraft() {
  const config = draft();
  const legacy = Object.fromEntries(['brand', 'title', 'mapTitle', 'navLabels', 'showClock'].map(key => [key, config[key]]));
  return { version: 1, ...legacy, modules: config.modules.map(item => Object.fromEntries(['id', 'title', 'subtitle', 'type', 'source', 'visible', 'unit', 'rowCount', 'columns'].map(key => [key, item[key]]))) };
}
function withStorage(storage, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
}

test('两套内置字体兼容旧画布并随保存和模板往返，保留业务布局与数据', () => {
  const old = draft(); delete old.font;
  assert.equal(normalizeConfig(old).font, DEFAULT_FONT.id);
  assert.equal(normalizeConfig(legacyDraft()).font, DEFAULT_FONT.id);
  for (const font of [null, undefined, {}, 'unknown', 'url(https://example.com/font)', 0]) assert.throws(() => normalizeConfig({ ...old, font }), /字体/);
  let saved;
  withStorage({ getItem: () => saved, setItem: (_, value) => { saved = value; } }, () => {
    for (const { id } of FONTS) {
      const config = { ...old, font: id, modules: [...old.modules].reverse(), dataSources: [source()] };
      assert.deepEqual(saveConfig(config), config);
      assert.deepEqual(loadConfig(), config);
      assert.deepEqual(parseTemplateFile(serializeTemplate(config)), config);
    }
  });
});

test('v2 往返保存保留画布图层顺序，返回独立的配置数据', () => {
  const config = draft(); config.title = '  运行中心  '; config.modules.reverse();
  const result = normalizeConfig(config);
  assert.equal(result.title, '运行中心');
  assert.equal(result.version, 2);
  assert.deepEqual(result.modules.map(module => module.id), config.modules.map(module => module.id));
  result.modules[0].columns[0].label = '变更';
  result.modules[0].layout.x = 0;
  result.modules[0].binding.fields.name = 'changed';
  result.map.layout.w = 30;
  result.canvas.snap = false;
  assert.equal(config.modules[0].columns[0].label, '发生时间');
  assert.notEqual(config.modules[0].layout.x, 0);
  assert.equal(config.modules[0].binding.fields.name, 'name');
  assert.equal(config.map.layout.w, 80);
  assert.equal(config.canvas.snap, true);
  assert.deepEqual(normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG))), DEFAULT_CONFIG);
});

test('MANES replaces only the former default brand across saved canvases and template imports', () => {
  assert.equal(DEFAULT_CONFIG.brand, 'MANES');
  for (const make of [draft, legacyDraft]) for (const oldBrand of ['NEXUS', 'Nexus', ' nexus ']) {
    const original = make(); original.brand = oldBrand; original.title = '保留业务标题';
    const before = structuredClone(original), result = normalizeConfig(original);
    assert.equal(result.brand, 'MANES'); assert.equal(result.title, original.title);
    assert.deepEqual(original, before); assert.deepEqual(parseTemplateFile(JSON.stringify(original)), result);
    const key = original.version === 1 ? LEGACY_KEY : STORAGE_KEY;
    withStorage({ getItem: current => current === key ? JSON.stringify(original) : null, setItem: () => assert.fail('loading must not rewrite storage') }, () => assert.deepEqual(loadConfig(), result));
  }
  for (const custom of ['用户品牌', 'Nexus East', 'Manes工作室']) assert.equal(normalizeConfig({ ...draft(), brand: custom }).brand, custom);
  for (const invalid of [null, '<MANES>', '', 123]) assert.throws(() => normalizeConfig({ ...draft(), brand: invalid }), /品牌名称/);
});

test('二十种组件可动态添加、删除与重排，达到 40 个时停止添加', () => {
  assert.equal(MODULE_TYPES.length, 20);
  const config = draft();
  config.modules = MODULE_TYPES.map(type => createModule(type.id));
  assert.equal(new Set(config.modules.map(item => item.id)).size, 20);
  assert.deepEqual(normalizeConfig(config).modules, config.modules);
  for (const type of MODULE_TYPES) for (const id of type.sources) {
    const module = createModule(type.id);
    Object.assign(module, { source: id, unit: SOURCES[id].unit, columns: structuredClone(SOURCES[id].columns) });
    assert.equal(normalizeConfig({ ...config, modules: [module] }).modules[0].source, id);
  }
  while (config.modules.length < 40) config.modules.push(createModule('metric', config.modules));
  assert.equal(normalizeConfig(config).modules.length, 40);
  assert.throws(() => createModule('metric', config.modules), /40/);
  assert.throws(() => createModule('unknown'), /不支持/);
  config.modules.push({ ...config.modules[0], id: 'overflow' });
  assert.throws(() => normalizeConfig(config), /40/);
  config.modules = [];
  assert.deepEqual(normalizeConfig(config).modules, []);
  const module = createModule('metric'); module.columns[0].label = '独立列名';
  assert.equal(SOURCES.devices.columns[0].label, '区域');
});

test('v1 文件及旧存储迁移保留原有内容，显式保存才写入 v2', () => {
  const legacy = legacyDraft(); legacy.title = '现场监测'; legacy.modules[0].title = '现场设备'; legacy.modules[4].visible = false; legacy.modules.reverse();
  const result = normalizeConfig(legacy);
  assert.equal(result.version, 2);
  assert.equal(result.title, '现场监测');
  assert.equal(result.modules[0].title, '现场设备');
  assert.equal(result.modules[4].visible, false);
  assert.deepEqual(result.modules.map(item => item.id), DEFAULT_CONFIG.modules.map(item => item.id));
  assert.deepEqual(result.map, DEFAULT_CONFIG.map);
  assert.deepEqual(result.dataSources, []);
  const savedLegacy = JSON.stringify(legacy), values = new Map([[LEGACY_KEY, savedLegacy]]), writes = [];
  withStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } }, () => {
    assert.deepEqual(loadConfig(), result);
    assert.deepEqual(writes, []);
    assert.deepEqual(saveConfig(result), result);
    assert.deepEqual(writes, [STORAGE_KEY]);
    assert.equal(values.get(LEGACY_KEY), savedLegacy);
    assert.deepEqual(loadConfig(), result);
    values.set(STORAGE_KEY, JSON.stringify({ ...result, title: '新版优先' }));
    assert.equal(loadConfig().title, '新版优先');
  });
  legacy.modules.pop();
  assert.throws(() => normalizeConfig(legacy), /五个模块/);
});

test('自定义数据绑定可保存字段映射、汇总方式及目标值', () => {
  const config = draft(); config.dataSources = [source()];
  Object.assign(config.modules[0], { binding: { sourceId: 'ds_custom', fields: { name: 'device.name', value: 'count', target: 'goal' } }, columns: [{ key: 'name', label: '中心' }, { key: 'target', label: '目标值' }], aggregate: 'average', unit: '次', rowCount: 100, target: 1000 });
  const result = normalizeConfig(config);
  assert.deepEqual(result.modules[0].binding, config.modules[0].binding);
  assert.equal(result.modules[0].aggregate, 'average');
  assert.equal(result.modules[0].rowCount, 100);
  assert.equal(result.modules[0].target, 1000);
  result.dataSources[0].content = '[]';
  assert.notEqual(config.dataSources[0].content, '[]');
  config.modules[0].binding.sourceId = 'demo';
  assert.throws(() => normalizeConfig(config), /表格列/);
  config.modules[0].columns = structuredClone(SOURCES.devices.columns);
  assert.equal(normalizeConfig(config).modules[0].binding.sourceId, 'demo');
});

test('小数位数兼容旧配置并在画布保存、模板和 JSON 往返中保留 0', () => {
  for (const type of MODULE_TYPES) assert.equal(createModule(type.id).precision, 1);
  assert.deepEqual(normalizeConfig(legacyDraft()), DEFAULT_CONFIG);
  const old = draft(); old.modules.forEach(item => delete item.precision);
  assert.deepEqual(parseTemplateFile(JSON.stringify(old)), DEFAULT_CONFIG);
  const config = draft(); config.modules.forEach((item, index) => { item.precision = index % 4; });
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  withStorage(storage, () => {
    assert.deepEqual(saveConfig(config), config);
    assert.deepEqual(loadConfig(), config);
    assert.deepEqual(parseTemplateFile(serializeTemplate(config)), config);
    saveTemplate('精度配置', config, storage);
    assert.deepEqual(readTemplates(storage)[0].config, config);
  });
  for (const precision of [-1, 4, 1.5, '2', null, undefined, NaN, Infinity, true]) {
    const invalid = draft(); invalid.modules[0].precision = precision;
    assert.throws(() => normalizeConfig(invalid), /小数位数/);
  }
});

test('损坏、危险文字、未知字段与不兼容组件拒绝导入', () => {
  const invalid = [
    ['未知版本', config => { config.version = 3; }],
    ['空标题', config => { config.title = ''; }],
    ['超长标题', config => { config.title = '字'.repeat(37); }],
    ['HTML 标题', config => { config.title = '<script>alert(1)</script>'; }],
    ['脚本标题', config => { config.title = 'javascript:alert(1)'; }],
    ['控制字符', config => { config.title = '非法\u0000文字'; }],
    ['品牌类型', config => { config.brand = 123; }],
    ['时钟类型', config => { config.showClock = 'true'; }],
    ['导航数量', config => { config.navLabels.pop(); }],
    ['重复模块', config => { config.modules[1].id = 'devices'; }],
    ['地图保留标识', config => { config.modules[0].id = 'map'; }],
    ['非法标识', config => { config.modules[0].id = 'bad/id'; }],
    ['未知示例源', config => { config.modules[0].source = 'toString'; }],
    ['不兼容类型', config => { config.modules[0].type = 'gauge'; }],
    ['零条记录', config => { config.modules[0].rowCount = 0; }],
    ['超过记录上限', config => { config.modules[0].rowCount = 101; }],
    ['条数类型', config => { config.modules[0].rowCount = '5'; }],
    ['小数条数', config => { config.modules[0].rowCount = 3.5; }],
    ['显隐类型', config => { config.modules[0].visible = 1; }],
    ['锁定类型', config => { config.modules[0].locked = 'false'; }],
    ['面板材质', config => { config.modules[0].surface = 'unknown'; }],
    ['汇总方式', config => { config.modules[0].aggregate = 'eval'; }],
    ['过低目标', config => { config.modules[0].target = 0; }],
    ['无限目标', config => { config.modules[0].target = Infinity; }],
    ['公告 HTML', config => { config.modules[0].text = '<b>公告</b>'; }],
    ['空表格列', config => { config.modules[0].columns = []; }],
    ['未知表格列', config => { config.modules[0].columns[0].key = 'html'; }],
    ['重复表格列', config => { config.modules[0].columns[1].key = 'name'; }],
    ['超长列名', config => { config.modules[0].columns[0].label = '字'.repeat(13); }],
    ['未知列属性', config => { config.modules[0].columns[0].onclick = 'alert(1)'; }],
    ['未知模块属性', config => { config.modules[0].html = '<b>test</b>'; }],
    ['未知全局属性', config => { config.extra = 'unknown'; }],
    ['缺少标题', config => { delete config.title; }],
  ];
  for (const [label, change] of invalid) { const config = draft(); change(config); assert.throws(() => normalizeConfig(config), Error, label); }
  for (const value of [null, [], {}, 123, 'config', Object.create(DEFAULT_CONFIG)]) assert.throws(() => normalizeConfig(value), Error);
  const polluted = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  Object.defineProperty(polluted, '__proto__', { enumerable: true, value: {} });
  assert.throws(() => normalizeConfig(polluted), /未知字段/);
});

test('模块和地图越界、非法吸附及无效数据绑定均被拒绝', () => {
  const invalidLayouts = [null, [], { x: 0, y: 0, w: 9, h: 20 }, { x: -1, y: 0, w: 20, h: 20 }, { x: 80, y: 0, w: 21, h: 20 }, { x: 0, y: 85, w: 20, h: 16 }, { x: 0, y: 0, w: Infinity, h: 20 }, { x: '0', y: 0, w: 20, h: 20 }, { x: 0, y: 0, w: 20, h: 20, z: 1 }];
  for (const target of ['map', 'module']) for (const layout of invalidLayouts) {
    const config = draft();
    (target === 'map' ? config.map : config.modules[0]).layout = layout;
    assert.throws(() => normalizeConfig(config), Error, `${target}: ${JSON.stringify(layout)}`);
  }
  const invalid = [
    config => { config.canvas.snap = 1; },
    config => { config.canvas.grid = 0; },
    config => { config.canvas.grid = 6; },
    config => { config.map.visible = 'true'; },
    config => { config.modules[0].binding.sourceId = 'ds_missing'; },
    config => { config.modules[0].binding.token = 'disallowed'; },
    config => { config.modules[0].binding.fields.value = '__proto__.value'; },
    config => { config.modules[0].binding.fields.value = 'row.constructor'; },
    config => { config.modules[0].binding.fields.value = 'value[0]'; },
    config => { config.modules[0].binding.fields.value = 'x'.repeat(161); },
    config => { config.modules[0].binding.fields.extra = 'value'; },
    config => { config.modules[0].binding.fields = []; },
    config => { config.dataSources = [source(), source()]; },
    config => { config.dataSources = [{ ...source(), content: '{broken' }]; },
  ];
  for (const change of invalid) { const config = draft(); change(config); assert.throws(() => normalizeConfig(config), Error); }
});

test('保存失败不报告成功，坏配置与不可用存储保留原数据', () => {
  const values = new Map(), writes = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
  withStorage(storage, () => {
    assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
    const config = draft(); config.brand = 'CUSTOM';
    assert.deepEqual(saveConfig(config), config);
    assert.deepEqual(loadConfig(), config);
    const previous = values.get(STORAGE_KEY), writeCount = writes.length;
    assert.throws(() => saveConfig({ ...config, title: '' }), Error);
    assert.equal(values.get(STORAGE_KEY), previous);
    assert.equal(writes.length, writeCount);
    values.set(LEGACY_KEY, JSON.stringify({ ...legacyDraft(), title: '旧版不能覆盖新版损坏记录' }));
    for (const broken of ['{broken', 'x'.repeat(CONFIG_FILE_LIMIT + 1)]) {
      values.set(STORAGE_KEY, broken);
      assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
      assert.equal(values.get(STORAGE_KEY), broken);
      assert.equal(writes.length, writeCount);
    }
  });
  withStorage({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, () => assert.throws(() => saveConfig(draft()), /配置未保存/));
  withStorage(null, () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
    assert.throws(() => saveConfig(draft()), /配置未保存/);
  });
});

 test('旧 v2 配置补齐磁吸和专业图表选项，未知或非法扩展仍拒绝', () => {
  const old = draft(); delete old.canvas.magnet; delete old.canvas.threshold;
  old.modules.forEach(item => delete item.chartOptions);
  const migrated = normalizeConfig(old);
  assert.equal(migrated.canvas.magnet, true); assert.equal(migrated.canvas.threshold, 6);
  assert.equal(migrated.modules[0].chartOptions.legend, true);
  for (const mutate of [c => c.canvas.threshold = 99, c => c.canvas.magnet = 'true', c => c.canvas.extra = 1, c => c.modules[0].chartOptions = null, c => c.modules[0].chartOptions = { palette: 'unknown' }, c => c.modules[0].chartOptions = { formatter: 'eval' }, c => c.modules[0].chartOptions = { labels: 1 }]) {
    const c = draft(); mutate(c); assert.throws(() => normalizeConfig(c));
  }
});
