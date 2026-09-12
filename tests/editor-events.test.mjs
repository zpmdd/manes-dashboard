import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';
import { DEFAULT_CONFIG, createModule } from '../src/dashboardConfig.js';
import { changeLayout, editHistory, layoutStyle } from '../src/layout.js';

// Compile the real component to small VNodes so its pointer handlers run without a browser dependency.
const source = await readFile(new URL('../src/DashboardEditor.jsx', import.meta.url), 'utf8');
const start = source.indexOf('export function CanvasItem(');
assert.notEqual(start, -1);
const { code } = await transformWithEsbuild(source.slice(start).replace('export function', 'function'), 'CanvasItem.jsx', { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Fragment', sourcemap: false });
const createComponent = new Function('useRef', 'useEffect', 'changeLayout', 'layoutStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'h', 'Fragment', `${code}; return CanvasItem;`);

function canvas({ isMap = true, locked = false } = {}) {
  const node = { style: {}, parentElement: { getBoundingClientRect: () => ({ width: 1000, height: 500 }) } };
  const refs = [{ current: node }, { current: null }, { current: 0 }], frames = new Map(), previews = [], patches = [], cleanup = [];
  let refIndex = 0, frameId = 0, captured = false, handlers;
  const component = createComponent(() => refs[refIndex++], effect => cleanup.push(effect()), changeLayout, layoutStyle, fn => { frames.set(++frameId, fn); return frameId; }, id => frames.delete(id), (type, props, ...children) => ({ type, props, children }), 'fragment');
  const layout = { x: 10, y: 10, w: 40, h: 40 };
  const editor = { editing: true, preview: false, selected: 'test', select: () => {}, config: { canvas: { snap: false, grid: 1 } }, patch: (id, patch) => patches.push({ id, patch }) };
  const tree = component({ id: 'test', title: '组件', item: { layout, visible: true, locked }, editor, isMap, onLayoutPreview: () => previews.push({ ...node.style }) });
  Object.assign(node.style, tree.props.style);
  const buttons = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') { if (value.type === 'button') buttons.push(value); value.children?.forEach(visit); }
  };
  visit(tree);
  const capture = { focus() {}, setPointerCapture() { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; handlers.onLostPointerCapture(); } };
  const event = { button: 0, pointerId: 9, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {}, currentTarget: capture };
  return {
    node, layout, previews, patches, frames,
    begin: (handle = 'move') => { handlers = buttons.find(button => button.props['aria-label'] === (handle === 'move' ? '移动组件' : `缩放组件 ${handle}`)).props; handlers.onPointerDown(event); },
    move: (x, y) => handlers.onPointerMove({ ...event, clientX: x, clientY: y }),
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    end: () => handlers.onPointerUp(event),
    cancel: () => handlers.onPointerCancel(event),
    loseCapture: () => { captured = false; handlers.onLostPointerCapture(event); },
    escape: () => { const calls = []; handlers.onKeyDown({ key: 'Escape', preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') }); return calls; },
    dispose: () => cleanup.forEach(fn => fn?.()),
  };
}

test('同帧地图移动合并为一次预览，松手只提交一次最终布局', () => {
  const item = canvas(); item.begin(); item.move(100, 50); item.move(200, 100);
  assert.equal(item.frames.size, 1);
  assert.equal(item.patches.length, 0);
  assert.equal(item.previews.length, 0);
  item.flush();
  assert.deepEqual(item.previews, [{ left: '30%', top: '30%', width: '40%', height: '40%' }]);
  item.end(); item.end(); item.loseCapture();
  assert.deepEqual(item.patches, [{ id: 'test', patch: { layout: { x: 30, y: 30, w: 40, h: 40 } } }]);
  assert.equal(item.previews.length, 2);
  assert.equal(item.frames.size, 0);
});

test('地图缩放取消、失去捕获和 Escape 都恢复视口，不产生历史记录', () => {
  for (const method of ['cancel', 'loseCapture', 'escape']) {
    const item = canvas(); item.begin('se'); item.move(100, 50); item.flush();
    assert.deepEqual(item.previews[0], { left: '10%', top: '10%', width: '50%', height: '50%' });
    item.move(200, 100);
    const outcome = item[method]();
    if (method === 'escape') assert.deepEqual(outcome, ['prevent', 'stop']);
    item.flush(); item.end();
    assert.deepEqual(item.node.style, layoutStyle(item.layout));
    assert.deepEqual(item.previews.at(-1), layoutStyle(item.layout));
    assert.equal(item.patches.length, 0);
    assert.equal(item.frames.size, 0);
    assert.deepEqual(item.escape(), []);
  }
});

test('松手可提交尚未绘制的最后一次移动，普通组件不触发地图测量', () => {
  const item = canvas({ isMap: false }); item.begin(); item.move(100, 50); item.end(); item.flush();
  assert.deepEqual(item.node.style, { left: '20%', top: '20%', width: '40%', height: '40%' });
  assert.equal(item.patches.length, 1);
  assert.deepEqual(item.previews, []);
  assert.equal(item.frames.size, 0);
});

test('锁定组件不启动拖动，卸载清理尚未执行的动画帧', () => {
  const locked = canvas({ locked: true }); locked.begin(); locked.move(100, 50); locked.end();
  assert.deepEqual(locked.node.style, layoutStyle(locked.layout));
  assert.equal(locked.patches.length, 0);
  assert.equal(locked.frames.size, 0);
  const item = canvas(); item.begin(); item.move(100, 50); item.dispose();
  assert.equal(item.frames.size, 0);
});

test('地图和业务组件的边界无变化操作不误标未保存，也不挤掉真实历史', () => {
  const saved = structuredClone(DEFAULT_CONFIG);
  let history = { past: [], present: saved, future: [] }, stateIndex = 0;
  const hookSource = source.slice(source.indexOf('export function useDashboardEditor('), source.indexOf('export function EditorToolbar(')).replace('export function', 'function');
  const hook = new Function('useState', 'useReducer', 'useCallback', 'useEffect', 'loadConfig', 'saveConfig', 'createModule', 'changeLayout', 'editHistory', `${hookSource}; return useDashboardEditor;`)(
    () => [[saved, true, false, null][stateIndex++], () => {}],
    () => [history, action => { history = editHistory(history, action); }],
    callback => callback, () => {}, () => saved, config => config, createModule, changeLayout, editHistory,
  );
  const render = () => { stateIndex = 0; return hook(() => {}); };
  let editor = render();
  const repeatBoundary = () => {
    for (let i = 0; i < 80; i++) {
      editor.patch('devices', { layout: changeLayout(editor.config.modules[0].layout, -1, 0) });
      editor.patch('map', { layout: changeLayout(editor.config.map.layout, 1, 0), visible: true });
    }
  };
  repeatBoundary(); editor = render();
  assert.equal(editor.dirty, false);
  assert.equal(editor.canUndo, false);
  editor.patch('devices', { title: '真正修改' }); editor = render();
  assert.equal(editor.dirty, true);
  repeatBoundary(); editor = render();
  assert.equal(history.past.length, 1);
  editor.undo(); editor = render();
  assert.strictEqual(editor.config, saved);
  assert.equal(editor.dirty, false);
  editor.redo(); editor = render();
  assert.equal(editor.config.modules[0].title, '真正修改');
});
