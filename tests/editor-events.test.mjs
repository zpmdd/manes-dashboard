import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';
import { DEFAULT_CHART_OPTIONS, DEFAULT_CONFIG, MODULE_TYPES, SOURCES, createModule, normalizeConfig } from '../src/dashboardConfig.js';
import { analyzeDataContent, suggestDataWidgets } from '../src/dataInference.js';
import { arrangeLayouts, changeLayout, editHistory, layoutStyle, snapLayout } from '../src/layout.js';

// Compile the real component to small VNodes so its handlers run without a browser dependency.
const source = await readFile(new URL('../src/DashboardEditor.jsx', import.meta.url), 'utf8');
const componentStart = source.indexOf('export function CanvasItem(');
assert.notEqual(componentStart, -1);
const { code } = await transformWithEsbuild(source.slice(componentStart).replace('export function', 'function'), 'CanvasItem.jsx', { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Fragment', sourcemap: false });
const createComponent = new Function('useRef', 'useEffect', 'changeLayout', 'snapLayout', 'layoutStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'h', 'Fragment', `${code}; return CanvasItem;`);
const hookSource = source.slice(source.indexOf('export function useDashboardEditor('), source.indexOf('export function EditorToolbar(')).replace('export function', 'function');
const createHook = new Function('useState', 'useReducer', 'useCallback', 'useEffect', 'loadConfig', 'saveConfig', 'createModule', 'changeLayout', 'arrangeLayouts', 'editHistory', 'window', 'document', `${hookSource}; return useDashboardEditor;`);
const [appSource, inspectorSource] = await Promise.all(['../src/App.jsx', '../src/EditorPanels.jsx'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const inspectorCallbacks = inspectorSource.slice(inspectorSource.indexOf('  const changeSource = '), inspectorSource.indexOf('  return <section className="ep-inspector" aria-label="组件属性">'));
const sourceCallback = appSource.slice(appSource.indexOf('  const createFromSource = '), appSource.indexOf('  const navigate = '));
assert.match(inspectorCallbacks, /const changeBinding =/); assert.match(sourceCallback, /const createFromSource =/);
const inspectorActions = (item, onChange) => new Function('item', 'binding', 'custom', 'source', 'SOURCES', 'MODULE_TYPES', 'DEFAULT_CHART_OPTIONS', 'onChange', `${inspectorCallbacks}; return { changeType, changeBinding };`)(item, item.binding, item.binding.sourceId !== 'demo', SOURCES[item.source], SOURCES, MODULE_TYPES, DEFAULT_CHART_OPTIONS, onChange);
const sourceAction = (editor, setSidePanel) => new Function('config', 'createModule', 'normalizeConfig', 'DEFAULT_CHART_OPTIONS', 'editor', 'setSidePanel', `${sourceCallback}; return createFromSource;`)(editor.config, createModule, normalizeConfig, DEFAULT_CHART_OPTIONS, editor, setSidePanel);
const module = (id, layout, extra = {}) => ({ ...structuredClone(DEFAULT_CONFIG.modules[0]), id, layout, visible: true, locked: false, ...extra });
const configWith = (items, canvas = {}) => {
  const map = items.find(item => item.id === 'map');
  return { ...structuredClone(DEFAULT_CONFIG), map: map ? { layout: map.layout, visible: map.visible, locked: map.locked } : { layout: { x: 10, y: 10, w: 40, h: 40 }, visible: false, locked: false }, modules: items.filter(item => item.id !== 'map'), canvas: { ...DEFAULT_CONFIG.canvas, snap: false, magnet: false, ...canvas } };
};

function editorHarness(saved = structuredClone(DEFAULT_CONFIG), selectedIds = []) {
  const state = [], cleanups = [], listeners = new Map(), notices = [];
  let cursor = 0;
  const useState = initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  };
  const useReducer = (reducer, initial) => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], action => { state[index] = reducer(state[index], action); }];
  };
  const window = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); }, confirm: () => true };
  const hook = createHook(useState, useReducer, callback => callback, effect => cleanups.push(effect()), () => saved, normalizeConfig, createModule, changeLayout, arrangeLayouts, editHistory, window, { querySelector: () => null });
  const render = () => { cleanups.splice(0).forEach(fn => fn?.()); cursor = 0; return hook(message => notices.push(message)); };
  const first = render(); first.start();
  for (const [index, id] of selectedIds.entries()) first.select(id, { toggle: index > 0 });
  return { render, notices, get history() { return state[1]; }, key: (key, options = {}) => { const event = { key, target: { closest: () => null }, preventDefault() {}, ...options }; listeners.get('keydown')?.(event); } };
}

function canvas({ isMap = true, locked = false, harness, id = isMap ? 'map' : 'test', canvasOptions = {}, selectedIds } = {}) {
  const layout = { x: 10, y: 10, w: 40, h: 40 };
  harness ??= editorHarness(configWith([module(id, layout, { locked })], canvasOptions), selectedIds ?? [id]);
  const current = harness.render(), nodes = new Map(current.items.map(item => [item.id, { style: layoutStyle(item.layout) }]));
  const parent = { getBoundingClientRect: () => ({ width: 1000, height: 500 }), querySelector: selector => nodes.get(selector.match(/data-canvas-id="([^"]+)"/)?.[1]) };
  for (const node of nodes.values()) node.parentElement = parent;
  const node = nodes.get(id), item = current.items.find(entry => entry.id === id);
  const refs = [{ current: node }, { current: null }, { current: 0 }], frames = new Map(), previews = [], patches = [], guideUpdates = [], cleanup = [];
  let refIndex = 0, frameId = 0, captured = false, handlers;
  const component = createComponent(() => refs[refIndex++], effect => cleanup.push(effect()), changeLayout, snapLayout, layoutStyle, fn => { frames.set(++frameId, fn); return frameId; }, frame => frames.delete(frame), (type, props, ...children) => ({ type, props, children }), 'fragment');
  const editor = { ...current, patchMany: updates => { patches.push(updates); current.patchMany(updates); }, setGuides: guides => { guideUpdates.push(guides); current.setGuides(guides); } };
  const tree = component({ id, title: '组件', item, editor, isMap, onLayoutPreview: () => previews.push({ ...nodes.get('map')?.style }) });
  const buttons = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') { if (value.type === 'button') buttons.push(value); value.children?.forEach(visit); }
  };
  visit(tree);
  const capture = { focus() {}, setPointerCapture() { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; handlers.onLostPointerCapture(); } };
  const event = { button: 0, pointerId: 9, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {}, currentTarget: capture };
  return {
    node, nodes, layout: item.layout, previews, patches, guideUpdates, frames, harness, buttons,
    begin: (handle = 'move', options = {}) => { handlers = buttons.find(button => button.props['aria-label'] === (handle === 'move' ? '移动组件' : `缩放组件 ${handle}`))?.props; assert.ok(handlers, `缺少 ${handle} 手柄`); handlers.onPointerDown({ ...event, ...options }); },
    move: (x, y, options = {}) => handlers.onPointerMove({ ...event, clientX: x, clientY: y, ...options }),
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    end: () => handlers.onPointerUp(event),
    cancel: () => handlers.onPointerCancel(event),
    loseCapture: () => { captured = false; handlers.onLostPointerCapture(event); },
    escape: () => { const calls = []; handlers.onKeyDown({ key: 'Escape', preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') }); return calls; },
    dispose: () => cleanup.forEach(fn => fn?.()),
  };
}

test('同帧地图移动合并为一次预览，松手仅一次批量提交和历史', () => {
  const item = canvas(); item.begin(); item.move(100, 50); item.move(200, 100);
  assert.equal(item.frames.size, 1); assert.equal(item.patches.length, 0); assert.equal(item.previews.length, 0);
  item.flush();
  assert.deepEqual(item.previews, [{ left: '30%', top: '30%', width: '40%', height: '40%' }]);
  item.end(); item.end(); item.loseCapture();
  assert.deepEqual(item.patches, [{ map: { layout: { x: 30, y: 30, w: 40, h: 40 } } }]);
  assert.equal(item.harness.history.past.length, 1); assert.equal(item.previews.length, 2); assert.equal(item.frames.size, 0);
});

test('地图缩放取消、失去捕获和 Escape 都恢复视口，不产生历史记录', () => {
  for (const method of ['cancel', 'loseCapture', 'escape']) {
    const item = canvas(); item.begin('se'); item.move(100, 50); item.flush();
    assert.deepEqual(item.previews[0], { left: '10%', top: '10%', width: '50%', height: '50%' });
    item.move(200, 100);
    const outcome = item[method]();
    if (method === 'escape') assert.deepEqual(outcome, ['prevent', 'stop']);
    item.flush(); item.end();
    assert.deepEqual(item.node.style, layoutStyle(item.layout)); assert.deepEqual(item.previews.at(-1), layoutStyle(item.layout));
    assert.equal(item.patches.length, 0); assert.equal(item.harness.history.past.length, 0); assert.equal(item.frames.size, 0);
    assert.deepEqual(item.escape(), []); assert.deepEqual(item.guideUpdates.at(-1), []);
  }
});

test('松手提交尚未绘制的最后移动，普通组件不触发地图测量', () => {
  const item = canvas({ isMap: false }); item.begin(); item.move(100, 50); item.end(); item.flush();
  assert.deepEqual(item.node.style, { left: '20%', top: '20%', width: '40%', height: '40%' });
  assert.equal(item.patches.length, 1); assert.deepEqual(item.previews, []); assert.equal(item.frames.size, 0);
});

test('锁定组件不启动拖动，卸载清理尚未执行的动画帧', () => {
  const locked = canvas({ locked: true }); locked.begin(); locked.move(100, 50); locked.end();
  assert.deepEqual(locked.node.style, layoutStyle(locked.layout)); assert.equal(locked.patches.length, 0); assert.equal(locked.frames.size, 0);
  const item = canvas(); item.begin(); item.move(100, 50); item.dispose(); assert.equal(item.frames.size, 0);
});

const groupConfig = () => configWith([
  module('map', { x: 10, y: 10, w: 20, h: 20 }), module('peer', { x: 60, y: 35, w: 15, h: 10 }),
  module('locked', { x: 0, y: 0, w: 10, h: 10 }, { locked: true }), module('hidden', { x: 80, y: 80, w: 20, h: 20 }, { visible: false }),
]);

test('多选整组受共同边界约束，保持相对位置，锁定和隐藏不移动且仅记一步历史', () => {
  const harness = editorHarness(groupConfig(), ['map', 'peer', 'locked', 'hidden']);
  const before = harness.render().config;
  const item = canvas({ harness, isMap: false, id: 'peer' });
  assert.equal(item.buttons.length, 1, '多选不显示缩放手柄');
  item.begin(); item.move(1000, 1000); item.flush();
  assert.deepEqual(item.nodes.get('map').style, layoutStyle({ x: 35, y: 65, w: 20, h: 20 }));
  assert.deepEqual(item.nodes.get('peer').style, layoutStyle({ x: 85, y: 90, w: 15, h: 10 }));
  assert.deepEqual(item.nodes.get('locked').style, layoutStyle(before.modules[1].layout));
  assert.deepEqual(item.nodes.get('hidden').style, layoutStyle(before.modules[2].layout));
  assert.equal(item.previews.length, 1, '业务组件带地图一起拖动也测量地图');
  item.end(); item.end();
  assert.deepEqual(Object.keys(item.patches[0]).sort(), ['map', 'peer']); assert.equal(item.patches.length, 1);
  assert.equal(harness.history.past.length, 1);
  const after = harness.render(); assert.equal(after.config.modules[0].layout.x - after.config.map.layout.x, 50);
  after.undo(); assert.strictEqual(harness.render().config, before);
  harness.render().redo(); assert.equal(harness.render().config.map.layout.x, 35);
});

test('多选拖动三条取消路径恢复全部组件和地图，并清除待绘制帧与辅助线', () => {
  for (const method of ['cancel', 'loseCapture', 'escape']) {
    const harness = editorHarness(groupConfig(), ['map', 'peer']);
    const item = canvas({ harness, isMap: false, id: 'peer' }), initial = new Map([...item.nodes].map(([id, node]) => [id, { ...node.style }]));
    item.begin(); item.move(100, 50); item.flush(); item.move(150, 100); item[method](); item.flush(); item.end();
    for (const [id, style] of initial) assert.deepEqual(item.nodes.get(id).style, style);
    assert.deepEqual(item.previews.at(-1), initial.get('map')); assert.deepEqual(item.guideUpdates.at(-1), []);
    assert.equal(item.patches.length, 0); assert.equal(harness.history.past.length, 0); assert.equal(harness.render().dirty, false);
  }
});

test('整组磁吸使用组边界并排除所有组内锚点，Alt 临时关闭网格和磁吸', () => {
  const items = [module('a', { x: 10, y: 12, w: 10, h: 10 }), module('b', { x: 30, y: 32, w: 10, h: 10 })];
  const harness = editorHarness(configWith(items, { snap: true, magnet: true, grid: 1, threshold: 6 }), ['a', 'b']);
  const item = canvas({ harness, id: 'a', isMap: false });
  item.begin(); item.move(4, 2); item.flush();
  assert.deepEqual(item.guideUpdates.at(-1), [], '组内现有边不应吸住整组');
  item.move(98, 0); item.flush();
  assert.equal(item.nodes.get('a').style.left, '20%'); assert.equal(item.nodes.get('b').style.left, '40%');
  assert.ok(item.guideUpdates.at(-1).some(guide => guide.axis === 'x' && guide.position === 50));
  item.move(98, 0, { altKey: true }); item.flush();
  assert.equal(item.nodes.get('a').style.left, '19.8%'); assert.equal(item.nodes.get('b').style.left, '39.8%');
  assert.deepEqual(item.guideUpdates.at(-1), []);
  item.end(); assert.equal(harness.history.past.length, 1);
});

test('关闭磁吸时精确命中组件锚点也不覆盖网格结果，Alt 恢复自由移动', () => {
  const items = [module('a', { x: 10, y: 12, w: 13, h: 10 }), module('peer', { x: 31.2, y: 60, w: 10, h: 10 })];
  const harness = editorHarness(configWith(items, { snap: true, magnet: false, grid: 1 }), ['a']);
  const item = canvas({ harness, id: 'a', isMap: false });
  item.begin(); item.move(212, 0); item.flush();
  assert.equal(item.node.style.left, '31%'); assert.deepEqual(item.guideUpdates.at(-1), []);
  item.move(214, 0, { altKey: true }); item.flush();
  assert.ok(Math.abs(parseFloat(item.node.style.left) - 31.4) < 1e-8); assert.deepEqual(item.guideUpdates.at(-1), []);
  item.end(); assert.equal(harness.history.past.length, 1);
});

test('选择修饰键只切换多选，只有单选未锁定组件有八个缩放手柄', () => {
  const item = canvas({ isMap: false }); assert.equal(item.buttons.length, 9);
  item.begin('move', { shiftKey: true }); item.move(100, 50); item.end();
  assert.deepEqual(item.harness.render().selectedIds, []); assert.equal(item.patches.length, 0);
  const locked = canvas({ locked: true }); assert.equal(locked.buttons.length, 1);
});

test('同宽和对齐按整批写入，可逐步撤销重做，重复操作不消耗历史', () => {
  const items = [module('wide', { x: 10, y: 10, w: 30, h: 20 }), module('small', { x: 75, y: 50, w: 15, h: 10 }), module('locked', { x: 45, y: 60, w: 10, h: 10 }, { locked: true })];
  const harness = editorHarness(configWith(items), ['wide', 'small', 'locked']), before = harness.render().config;
  harness.render().align('same-width');
  const wide = harness.render().config;
  assert.deepEqual(wide.modules.map(item => item.layout.w), [30, 30, 10]); assert.equal(wide.modules[1].layout.x, 70);
  assert.strictEqual(wide.modules[2], before.modules[2]); assert.equal(harness.history.past.length, 1);
  harness.render().align('left'); const aligned = harness.render().config;
  assert.deepEqual(aligned.modules.map(item => item.layout.x), [10, 10, 45]); assert.equal(harness.history.past.length, 2);
  for (let i = 0; i < 80; i++) harness.render().align('left'); assert.equal(harness.history.past.length, 2);
  harness.render().undo(); assert.strictEqual(harness.render().config, wide);
  harness.render().undo(); assert.strictEqual(harness.render().config, before); assert.equal(harness.render().dirty, false);
  harness.render().redo(); harness.render().redo(); assert.strictEqual(harness.render().config, aligned);
});

test('键盘整组移动保持共同边界且跳过锁定项，一次按键仅产生一步历史', () => {
  const harness = editorHarness(groupConfig(), ['map', 'peer', 'locked']); harness.render();
  harness.key('ArrowRight', { shiftKey: true });
  assert.equal(harness.history.past.length, 1);
  let editor = harness.render(); assert.equal(editor.config.map.layout.x, 15); assert.equal(editor.config.modules[0].layout.x, 65); assert.equal(editor.config.modules[1].layout.x, 0);
  for (let i = 0; i < 20; i++) { harness.key('ArrowRight', { shiftKey: true }); harness.render(); }
  const steps = harness.history.past.length;
  harness.key('ArrowRight'); editor = harness.render();
  assert.equal(editor.config.modules[0].layout.x, 85); assert.equal(editor.config.map.layout.x, 35); assert.equal(harness.history.past.length, steps);
});

test('地图和业务组件的边界无变化操作不误标未保存，也不挤掉真实历史', () => {
  const saved = structuredClone(DEFAULT_CONFIG), harness = editorHarness(saved);
  const repeatBoundary = () => {
    for (let i = 0; i < 80; i++) {
      const editor = harness.render();
      editor.patch('devices', { layout: changeLayout(editor.config.modules[0].layout, -1, 0) });
      editor.patch('map', { layout: changeLayout(editor.config.map.layout, 1, 0), visible: true });
    }
  };
  repeatBoundary(); let editor = harness.render(); assert.equal(editor.dirty, false); assert.equal(editor.canUndo, false);
  editor.patch('devices', { title: '真正修改' }); assert.equal(harness.render().dirty, true);
  repeatBoundary(); assert.equal(harness.history.past.length, 1);
  harness.render().undo(); editor = harness.render(); assert.strictEqual(editor.config, saved); assert.equal(editor.dirty, false);
  editor.redo(); assert.equal(harness.render().config.modules[0].title, '真正修改');
});

const externalSource = (id = 'ds_test') => ({ id, name: '收入与成本', type: 'json', content: JSON.stringify([{ name: '一月', value: 100, value2: 60, x: 0, y: 10 }, { name: '二月', value: 120, value2: 70, x: 10, y: 20 }]), url: '', rowsPath: '', refreshSeconds: 0 });

test('真实属性回调切换自定义图表类型保留业务单位、列和绑定，且可撤销', () => {
  const item = { ...createModule('bar'), unit: '万元', columns: [{ key: 'name', label: '项目' }, { key: 'value', label: '营收' }], binding: { sourceId: 'ds_test', fields: { name: 'name', value: 'value' } } };
  const saved = { ...configWith([item]), dataSources: [externalSource()] }, harness = editorHarness(saved, [item.id]);
  const editor = harness.render();
  inspectorActions(item, values => editor.patch(item.id, values)).changeType('line');
  const changed = harness.render().config.modules[0];
  assert.equal(changed.type, 'line'); assert.equal(changed.source, 'trend'); assert.equal(changed.unit, '万元');
  assert.strictEqual(changed.columns, item.columns); assert.strictEqual(changed.binding, item.binding);
  assert.equal(harness.history.past.length, 1); normalizeConfig(harness.render().config);
  harness.render().undo(); assert.strictEqual(harness.render().config, saved);
});

test('真实属性回调由示例改接外部数据清除演示单位和轴名称，外部源间切换保留自定义设置', () => {
  for (const type of ['combo', 'scatter']) {
    const item = createModule(type), harness = editorHarness({ ...configWith([item]), dataSources: [externalSource(), externalSource('ds_second')] }, [item.id]);
    let editor = harness.render();
    inspectorActions(item, values => editor.patch(item.id, values)).changeBinding('ds_test');
    let changed = harness.render().config.modules[0];
    assert.equal(changed.binding.sourceId, 'ds_test'); assert.equal(changed.unit, '');
    assert.deepEqual(changed.chartOptions, DEFAULT_CHART_OPTIONS); assert.equal(harness.history.past.length, 1);
    editor = harness.render();
    editor.patch(item.id, { unit: '万元', chartOptions: { ...changed.chartOptions, primaryName: '收入', secondaryName: '成本', secondaryUnit: '万元', xName: '数量', yName: '金额' } });
    editor = harness.render(); const customized = editor.config.modules[0];
    inspectorActions(customized, values => editor.patch(item.id, values)).changeBinding('ds_second');
    changed = harness.render().config.modules[0];
    assert.equal(changed.unit, '万元'); assert.strictEqual(changed.chartOptions, customized.chartOptions);
    normalizeConfig(harness.render().config);
  }
});

test('真实推荐创建回调使用中性图表语义，数据源与组件同一步撤销，失败不部分保存', () => {
  const source = externalSource(), suggestions = suggestDataWidgets(analyzeDataContent(source.content));
  for (const type of ['combo', 'scatter']) {
    const harness = editorHarness(), saved = harness.render().config, panels = [];
    sourceAction(harness.render(), panel => panels.push(panel))({ sources: [source], sourceId: source.id, ...suggestions.find(item => item.type === type) });
    let editor = harness.render(); const item = editor.config.modules.at(-1);
    assert.equal(item.type, type); assert.equal(item.unit, ''); assert.deepEqual(item.chartOptions, DEFAULT_CHART_OPTIONS);
    assert.equal(editor.config.dataSources.length, 1); assert.equal(editor.config.modules.length, saved.modules.length + 1);
    assert.equal(editor.selected, item.id); assert.deepEqual(panels, ['inspector']); assert.equal(harness.history.past.length, 1);
    editor.undo(); assert.strictEqual(harness.render().config, saved);
    harness.render().redo(); editor = harness.render(); assert.equal(editor.config.dataSources[0].id, source.id); assert.equal(editor.config.modules.at(-1).id, item.id);
  }
  for (const failure of ['invalid-mapping', 'component-limit', 'used-source']) {
    const saved = structuredClone(DEFAULT_CONFIG);
    if (failure === 'component-limit') saved.modules = Array.from({ length: 40 }, (_, i) => ({ ...structuredClone(saved.modules[0]), id: `item_${i}` }));
    if (failure === 'used-source') { saved.dataSources = [externalSource('ds_used')]; saved.modules[0].binding.sourceId = 'ds_used'; }
    const harness = editorHarness(saved), panels = [], payload = { sources: [source], sourceId: source.id, ...suggestions.find(item => item.type === 'combo') };
    if (failure === 'invalid-mapping') payload.fields = { ...payload.fields, name: 'constructor' };
    assert.throws(() => sourceAction(harness.render(), panel => panels.push(panel))(payload), failure === 'component-limit' ? /40/ : failure === 'used-source' ? /仍被/ : /字段路径/);
    assert.strictEqual(harness.render().config, saved); assert.equal(harness.history.past.length, 0); assert.equal(harness.render().dirty, false);
    assert.deepEqual(harness.render().selectedIds, []); assert.deepEqual(panels, []);
  }
});
