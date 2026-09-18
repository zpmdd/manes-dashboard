import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_FILE_LIMIT, DEFAULT_CONFIG, normalizeConfig, configForProject, defaultConfigForProject, legacyProject } from '../src/dashboardConfig.js';
import { TEMPLATE_LIMIT, TEMPLATE_STORAGE_KEY, deleteTemplate, getBuiltinTemplates, parseTemplateFile, readTemplates, saveTemplate, serializeTemplate } from '../src/templateLibrary.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('模板文件只载入最后选择，关闭后不显示旧结果，当前校验与回调错误仍可见', async () => {
  const [{ readFile }, { transformWithEsbuild }] = await Promise.all([import('node:fs/promises'), import('vite')]);
  const source = await readFile(new URL('../src/EditorPanels.jsx', import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source.slice(source.indexOf('export function TemplatePanel(')).replace('export function', 'function'), 'TemplatePanel.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false });
  const setup = (onLoad = () => {}) => {
    const state = [], refs = [], effects = [], loaded = []; let stateIndex = 0, refIndex = 0, closes = 0;
    const element = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
    const runtime = { config: DEFAULT_CONFIG, CONFIG_FILE_LIMIT, TEMPLATE_LIMIT, normalizeConfig, configForProject, defaultConfigForProject, legacyProject, readLegacyConfig: () => null, readLegacyTemplates: () => [], parseTemplateFile, getBuiltinTemplates: () => [], readTemplates: () => [],
      useState: initial => { const i = stateIndex++; state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = value; }]; },
      useRef: initial => { const ref = { current: initial }; refs[refIndex++] = ref; return ref; }, useEffect: effect => effects.push(effect),
      document: { activeElement: null }, h: (type, props, ...children) => ({ type, props: props || {}, children }),
      ...Object.fromEntries(['TemplateThumbnail', 'Plus', 'Trash', 'X', 'UploadSimple', 'DownloadSimple'].map(name => [name, name])),
    };
    const Panel = new Function(...Object.keys(runtime), `${code}; return TemplatePanel;`)(...Object.values(runtime));
    let cleanup;
    const tree = Panel({ config: DEFAULT_CONFIG, onLoad: next => { loaded.push(next.title); return onLoad(next); }, onClose: () => { closes++; cleanup?.(); } });
    refs[0].current = element; cleanup = effects[0]();
    const nodes = [], visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { nodes.push(node); node.children?.forEach(visit); } }; visit(tree);
    const input = nodes.find(node => node.type === 'input' && node.props.type === 'file');
    return { loaded, get error() { return state[2]; }, get closes() { return closes; }, choose: file => input.props.onChange({ target: { files: file ? [file] : [], value: 'selected' } }), close: () => nodes.find(node => node.props['aria-label'] === '关闭模板库').props.onClick(), unmount: () => cleanup() };
  };
  const file = (name = 'valid.json', size = 1) => { const pending = Promise.withResolvers(); return { name, size, text: () => pending.promise, ...pending }; };
  const content = title => serializeTemplate({ ...DEFAULT_CONFIG, title });
  for (const newestFirst of [false, true]) {
    const panel = setup(), old = file(), latest = file();
    const oldRead = panel.choose(old), latestRead = panel.choose(latest);
    if (newestFirst) { latest.resolve(content('最新选择')); await latestRead; old.resolve(content('旧选择')); await oldRead; }
    else { old.resolve(content('旧选择')); await oldRead; assert.deepEqual(panel.loaded, [], 'A slower new selection must not be displaced by an older file finishing first'); latest.resolve(content('最新选择')); await latestRead; }
    assert.deepEqual(panel.loaded, ['最新选择']); assert.equal(panel.closes, 1); assert.equal(panel.error, '');
  }
  const stale = setup(), older = file(), newer = file();
  const olderRead = stale.choose(older), newerRead = stale.choose(newer);
  older.reject(new Error('旧读取异常')); await olderRead; assert.equal(stale.error, '');
  newer.resolve('{broken'); await newerRead; assert.match(stale.error, /有效的 JSON/); assert.equal(stale.closes, 0);
  for (const exit of ['close', 'unmount']) {
    const panel = setup(), pending = file(), reading = panel.choose(pending);
    panel[exit](); pending.reject(new Error('关闭后的读取异常')); await reading;
    assert.equal(panel.error, ''); assert.deepEqual(panel.loaded, []);
  }
  for (const [selected, expected] of [[file('wrong.csv'), /JSON/], [file('large.json', CONFIG_FILE_LIMIT + 1), /不能超过/]]) {
    const panel = setup(); await panel.choose(selected); assert.match(panel.error, expected); assert.equal(panel.closes, 0);
  }
  for (const [callback, expected] of [[() => false, /模板未载入/], [() => { throw new Error('画布保存失败'); }, /画布保存失败/]]) {
    const panel = setup(callback), pending = file(), reading = panel.choose(pending); pending.resolve(content('有效选择')); await reading;
    assert.match(panel.error, expected); assert.equal(panel.closes, 0);
  }
});

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

test('六套内置模板均可使用且不会共享可变数据', () => {
  const templates = getBuiltinTemplates();
  assert.equal(templates.length, 6);
  for (const template of templates) assert.deepEqual(normalizeConfig(template.config), template.config);
  assert.notDeepEqual(templates[0].config.map.layout, templates[1].config.map.layout);
  assert.notDeepEqual(templates[1].config.modules[0].layout, templates[2].config.modules[0].layout);
  templates[0].config.modules[0].title = '修改';
  assert.equal(getBuiltinTemplates()[0].config.modules[0].title, DEFAULT_CONFIG.modules[0].title);
});
