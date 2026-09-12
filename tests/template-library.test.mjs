import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_FILE_LIMIT, DEFAULT_CONFIG, normalizeConfig } from '../src/dashboardConfig.js';
import { TEMPLATE_LIMIT, TEMPLATE_STORAGE_KEY, deleteTemplate, getBuiltinTemplates, parseTemplateFile, readTemplates, saveTemplate, serializeTemplate } from '../src/templateLibrary.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('模板快照可往返保存、删除且独立于画布', () => {
  const storage = memoryStorage(), config = structuredClone(DEFAULT_CONFIG);
  assert.deepEqual(readTemplates(storage), []);
  const saved = saveTemplate('  值班监测  ', config, storage);
  assert.equal(saved[0].name, '值班监测');
  config.title = '之后编辑的标题';
  const loaded = readTemplates(storage);
  assert.deepEqual(loaded[0].config, DEFAULT_CONFIG);
  loaded[0].config.modules[0].title = '本地修改';
  assert.equal(readTemplates(storage)[0].config.modules[0].title, DEFAULT_CONFIG.modules[0].title);
  assert.deepEqual(parseTemplateFile(serializeTemplate(DEFAULT_CONFIG)), DEFAULT_CONFIG);
  assert.deepEqual(deleteTemplate(saved[0].id, storage), []);
});

test('模板名称、条数、损坏存储及写入错误均阻止覆盖', () => {
  const storage = memoryStorage();
  for (const name of ['', ' ', '<script>', 'x'.repeat(41), null]) assert.throws(() => saveTemplate(name, DEFAULT_CONFIG, storage), /模板名称/);
  for (let index = 0; index < TEMPLATE_LIMIT; index++) saveTemplate(`模板 ${index}`, DEFAULT_CONFIG, storage);
  const before = storage.getItem(TEMPLATE_STORAGE_KEY);
  assert.throws(() => saveTemplate('第十一个', DEFAULT_CONFIG, storage), /最多保存/);
  assert.equal(storage.getItem(TEMPLATE_STORAGE_KEY), before);
  assert.throws(() => deleteTemplate('missing', storage), /不存在/);
  storage.setItem(TEMPLATE_STORAGE_KEY, '{broken');
  assert.throws(() => readTemplates(storage), /无法读取/);
  assert.throws(() => saveTemplate('不能覆盖', DEFAULT_CONFIG, storage), /无法读取/);
  assert.equal(storage.getItem(TEMPLATE_STORAGE_KEY), '{broken');
  assert.throws(() => saveTemplate('空间不足', DEFAULT_CONFIG, { getItem: () => null, setItem: () => { throw new Error('quota'); } }), /模板未保存/);
});

test('导入通过共享配置校验，限制文件大小并拒绝损坏 JSON', () => {
  assert.throws(() => parseTemplateFile('{broken'), /有效的 JSON/);
  assert.throws(() => parseTemplateFile('x'.repeat(CONFIG_FILE_LIMIT + 1)), /不能超过/);
  assert.throws(() => parseTemplateFile('中'.repeat(Math.ceil(CONFIG_FILE_LIMIT / 3) + 1)), /不能超过/);
  assert.throws(() => parseTemplateFile(JSON.stringify({ ...DEFAULT_CONFIG, title: '<script>' })), /纯文字/);
  const legacy = Object.fromEntries(['brand', 'title', 'mapTitle', 'navLabels', 'showClock'].map(key => [key, DEFAULT_CONFIG[key]]));
  legacy.version = 1;
  legacy.modules = DEFAULT_CONFIG.modules.map(item => Object.fromEntries(['id', 'title', 'subtitle', 'type', 'source', 'visible', 'unit', 'rowCount', 'columns'].map(key => [key, item[key]])));
  assert.deepEqual(parseTemplateFile(JSON.stringify(legacy)), DEFAULT_CONFIG);
});

test('接近大小上限的有效配置仍能完整导出并重新导入', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const source = id => ({ id, name: id, type: 'json', content: '[{"name":"","value":1}]', url: '', rowsPath: '', refreshSeconds: 0 });
  config.dataSources = [source('ds_first'), source('ds_second')];
  const fillSize = CONFIG_FILE_LIMIT - new TextEncoder().encode(JSON.stringify(config)).length - 100;
  config.dataSources[0].content = JSON.stringify([{ name: 'x'.repeat(Math.floor(fillSize / 2)), value: 1 }]);
  config.dataSources[1].content = JSON.stringify([{ name: 'x'.repeat(Math.ceil(fillSize / 2)), value: 1 }]);
  const content = serializeTemplate(config);
  assert.ok(new TextEncoder().encode(content).length <= CONFIG_FILE_LIMIT);
  assert.deepEqual(parseTemplateFile(content), normalizeConfig(config));
});

test('三套内置模板均可使用且不会共享可变数据', () => {
  const templates = getBuiltinTemplates();
  assert.equal(templates.length, 3);
  for (const template of templates) assert.deepEqual(normalizeConfig(template.config), template.config);
  assert.notDeepEqual(templates[0].config.map.layout, templates[1].config.map.layout);
  assert.notDeepEqual(templates[1].config.modules[0].layout, templates[2].config.modules[0].layout);
  templates[0].config.modules[0].title = '修改';
  assert.equal(getBuiltinTemplates()[0].config.modules[0].title, DEFAULT_CONFIG.modules[0].title);
});
