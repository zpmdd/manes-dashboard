import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/dashboardConfig.js';
import { arrangeLayouts, changeLayout, editHistory, layoutStyle, snapLayout } from '../src/layout.js';

const start = { x: 20, y: 30, w: 40, h: 25 };
const valid = layout => {
  assert.ok(layout.x >= 0 && layout.y >= 0 && layout.w >= 10 && layout.h >= 10);
  assert.ok(layout.x + layout.w <= 100.001 && layout.y + layout.h <= 100.001, `越界布局 ${JSON.stringify(layout)}`);
  const config = structuredClone(DEFAULT_CONFIG); config.modules[0].layout = layout;
  assert.deepEqual(normalizeConfig(config).modules[0].layout, layout);
};

test('拖动遵循吸附网格，关闭吸附保留小数，边界内保持组件大小', () => {
  assert.deepEqual(changeLayout(start, 2.6, -3.4, 'move', 1), { ...start, x: 23, y: 27 });
  assert.deepEqual(changeLayout(start, 2.6, -3.4, 'move', .5), { ...start, x: 22.5, y: 26.5 });
  assert.deepEqual(changeLayout(start, 2.6, -3.4), { ...start, x: 22.6, y: 26.6 });
  assert.deepEqual(changeLayout(start, -1000, -1000), { ...start, x: 0, y: 0 });
  assert.deepEqual(changeLayout(start, 1000, 1000), { ...start, x: 60, y: 75 });
  assert.deepEqual(start, { x: 20, y: 30, w: 40, h: 25 });
  assert.deepEqual(layoutStyle(start), { left: '20%', top: '30%', width: '40%', height: '25%' });
});

test('八个缩放方向保持对侧边界，最小尺寸与画布边界始终有效', () => {
  assert.deepEqual(changeLayout(start, 5, 7, 'se'), { ...start, w: 45, h: 32 });
  assert.deepEqual(changeLayout(start, 5, 7, 'nw'), { x: 25, y: 37, w: 35, h: 18 });
  assert.deepEqual(changeLayout(start, 4.6, 0, 'e', 1), { ...start, w: 45 });
  for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const delta of [-1000, -3.6, 3.6, 1000]) {
      const layout = changeLayout(start, delta, delta, handle, .5);
      valid(layout);
      if (handle.includes('w')) assert.equal(layout.x + layout.w, start.x + start.w);
      else assert.equal(layout.x, start.x);
      if (handle.includes('n')) assert.equal(layout.y + layout.h, start.y + start.h);
      else assert.equal(layout.y, start.y);
    }
  }
});

test('合法导入的小数尺寸拖动至边缘后仍可保存', () => {
  const fractional = { x: 20.005, y: 25.005, w: 33.335, h: 24.995 };
  valid(fractional);
  for (const handle of ['move', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const delta of [-1000, 1000]) valid(changeLayout(fractional, delta, delta, handle));
  }
});

test('撤销、重做和撤销后新编辑保留正确分支，不改写已有快照', () => {
  const initial = { title: '基线' };
  let history = editHistory(undefined, { type: 'reset', config: initial });
  assert.strictEqual(editHistory(history, { type: 'undo' }), history);
  assert.strictEqual(editHistory(history, { type: 'redo' }), history);
  history = editHistory(history, { type: 'edit', config: { title: '第一次' } });
  history = editHistory(history, { type: 'edit', config: config => ({ ...config, title: '第二次' }) });
  const before = structuredClone(history);
  const undone = editHistory(history, { type: 'undo' });
  assert.deepEqual(history, before);
  assert.equal(undone.present.title, '第一次');
  assert.equal(undone.future[0].title, '第二次');
  assert.deepEqual(editHistory(undone, { type: 'redo' }), history);
  assert.strictEqual(editHistory(undone, { type: 'edit', config: config => config }), undone);
  const branched = editHistory(undone, { type: 'edit', config: { title: '新分支' } });
  assert.equal(branched.present.title, '新分支');
  assert.deepEqual(branched.future, []);
  assert.strictEqual(editHistory(branched, { type: 'redo' }), branched);
  assert.equal(editHistory(branched, { type: 'undo' }).present.title, '第一次');
  assert.deepEqual(initial, { title: '基线' });
  assert.deepEqual(editHistory(branched, { type: 'reset', config: initial }), { past: [], present: initial, future: [] });
});

test('历史记录只保留最近 50 步，旧历史删除后仍能正确撤销重做', () => {
  let history = editHistory(undefined, { type: 'reset', config: { revision: 0 } });
  for (let revision = 1; revision <= 80; revision++) history = editHistory(history, { type: 'edit', config: { revision } });
  assert.equal(history.past.length, 50);
  assert.equal(history.past[0].revision, 30);
  for (let step = 0; step < 50; step++) history = editHistory(history, { type: 'undo' });
  assert.equal(history.present.revision, 30);
  assert.strictEqual(editHistory(history, { type: 'undo' }), history);
  for (let step = 0; step < 50; step++) history = editHistory(history, { type: 'redo' });
  assert.equal(history.present.revision, 80);
  assert.equal(history.past.length, 50);
  assert.deepEqual(history.future, []);
});

const rect = (id, x, y, w = 10, h = 10, extra = {}) => ({ id, layout: { x, y, w, h }, visible: true, locked: false, ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('磁吸按实际 CSS 像素距离匹配画布边与中心，磁吸优先于网格', () => {
  const layout = { x: 10, y: 12, w: 10, h: 10 };
  const options = { width: 1000, height: 500 };
  const center = snapLayout(layout, 34.6, 0, options);
  assert.equal(center.layout.x, 45);
  assert.deepEqual(center.guides, [{ axis: 'x', position: 50, from: 0, to: 100, kind: 'canvas', sourceId: null }]);
  assert.equal(snapLayout(layout, 34.6, 0, { ...options, width: 2000 }).layout.x, 44.6);
  assert.equal(snapLayout(layout, 0, 31.9, options).layout.y, 45);
  assert.equal(snapLayout(layout, -9.5, 0, options).layout.x, 0);
  assert.equal(snapLayout(layout, 1000, 1000, options).layout.x, 90);
  const peer = rect('peer', 31.2, 60, 10, 10);
  assert.equal(snapLayout({ ...layout, w: 13 }, 20.8, 0, { ...options, grid: 1, items: [peer] }).layout.x, 31.2);
  assert.equal(snapLayout(layout, 1.4, 1.4, { width: 0, height: 0, grid: 1 }).layout.x, 11);
  assert.deepEqual(snapLayout(layout, 1.4, 1.4, { width: 0, height: 0 }).guides, []);
  const disabled = snapLayout({ ...layout, w: 13 }, 21.2, 0, { ...options, items: [peer], grid: 1, threshold: 0, previousGuides: [{ axis: 'x', position: 31.2, kind: 'component', sourceId: 'peer' }] });
  assert.equal(disabled.layout.x, 31);
  assert.deepEqual(disabled.guides, []);
});

test('磁吸忽略自己、同组及隐藏参照，锁定参照仍可用，辅助线覆盖两对象', () => {
  const layout = { x: 10, y: 12, w: 13, h: 10 };
  const items = [rect('self', 30, 12), rect('hidden', 31, 40, 10, 10, { visible: false }), rect('group', 31.2, 30), rect('locked', 32, 50, 10, 10, { locked: true })];
  const options = { id: 'self', excludedIds: ['group'], items, width: 1000, height: 1000 };
  const free = snapLayout(layout, 20.4, 0, { ...options, excludedIds: ['group', 'locked'] });
  assert.equal(free.layout.x, 30.4);
  assert.equal(free.guides.length, 0);
  const snapped = snapLayout(layout, 21.6, 0, options);
  assert.equal(snapped.layout.x, 32);
  assert.deepEqual(snapped.guides, [{ axis: 'x', position: 32, from: 12, to: 60, kind: 'component', sourceId: 'locked' }]);
  const center = snapLayout({ ...layout, w: 10 }, 41.6, 0, { ...options, items: [rect('center', 56, 40, 12, 10)] });
  assert.equal(center.layout.x, 52);
  assert.equal(center.guides[0].position, 62);
  assert.equal(center.guides[0].sourceId, 'center');
});

test('最近锚点稳定选取，并列不受图层顺序影响，1px滞回避免细小抖动', () => {
  const layout = { x: 10, y: 12, w: 13, h: 10 }, items = [rect('a', 30, 60), rect('b', 30.8, 40)];
  const options = { width: 1000, height: 1000, items };
  const first = snapLayout(layout, 20.4, 0, options);
  assert.deepEqual(snapLayout(layout, 20.4, 0, { ...options, items: [...items].reverse() }), first);
  const held = snapLayout(layout, 20.45, 0, { ...options, previousGuides: first.guides });
  assert.equal(held.layout.x, first.layout.x);
  const switched = snapLayout(layout, 20.55, 0, { ...options, previousGuides: first.guides });
  assert.equal(switched.layout.x, 30.8);
  const single = { ...options, items: [items[0]], previousGuides: [{ axis: 'x', position: 30, kind: 'component', sourceId: 'a' }] };
  assert.equal(snapLayout(layout, 20.65, 0, single).layout.x, 30);
  assert.equal(snapLayout(layout, 20.71, 0, single).layout.x, 30.71);
});

test('八向缩放磁吸仅改变活动边，保留对边且不突破最小尺寸和画布', () => {
  const layout = { x: 20, y: 20, w: 20, h: 20 };
  for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const result = snapLayout(layout, handle.includes('w') ? -19.6 : 9.6, handle.includes('n') ? -19.6 : 9.6, { handle, width: 1000, height: 1000 });
    valid(result.layout);
    if (handle.includes('w')) { assert.equal(result.layout.x, 0); assert.equal(result.layout.x + result.layout.w, 40); }
    else if (handle.includes('e')) { assert.equal(result.layout.x, 20); assert.equal(result.layout.w, 30); }
    else { assert.equal(result.layout.x, 20); assert.equal(result.layout.w, 20); }
    if (handle.includes('n')) { assert.equal(result.layout.y, 0); assert.equal(result.layout.y + result.layout.h, 40); }
    else if (handle.includes('s')) { assert.equal(result.layout.y, 20); assert.equal(result.layout.h, 30); }
    else { assert.equal(result.layout.y, 20); assert.equal(result.layout.h, 20); }
  }
  const limited = snapLayout({ x: 30, y: 12, w: 20, h: 20 }, 30, 0, { handle: 'w', width: 1000, height: 1000, items: [rect('too-small', 40.4, 70)] });
  assert.equal(limited.layout.w, 10);
  assert.equal(limited.guides.length, 0);
  const fractional = { x: 20.005, y: 25.005, w: 33.335, h: 24.995 };
  const moved = snapLayout(fractional, 1000, 1000, { width: 1000, height: 1000 }).layout;
  assert.equal(moved.w, fractional.w); assert.equal(moved.h, fractional.h); valid(moved);
  const east = changeLayout(fractional, 1, 0, 'e');
  assert.equal(east.x, fractional.x); assert.equal(east.y, fractional.y); assert.equal(east.h, fractional.h);
});

test('小数锚点缩到最小尺寸后仍可保存，西北侧缩放保留对边与未动轴', () => {
  for (const handle of ['w', 'n']) {
    const horizontal = handle === 'w';
    const layout = horizontal ? { x: 10.1, y: 12, w: 20.2, h: 20 } : { x: 12, y: 10.1, w: 20, h: 20.2 };
    const peer = horizontal ? rect('peer', 20.3, 50, 15, 20) : rect('peer', 50, 20.3, 20, 15);
    const result = snapLayout(layout, horizontal ? 10.2 : 0, horizontal ? 0 : 10.2, { handle, width: 1000, height: 1000, items: [peer] });
    const axis = horizontal ? 'x' : 'y', size = horizontal ? 'w' : 'h';
    assert.equal(result.layout[size], 10);
    assert.equal(result.layout[axis] + result.layout[size], layout[axis] + layout[size]);
    for (const key of horizontal ? ['y', 'h'] : ['x', 'w']) assert.equal(result.layout[key], layout[key]);
    assert.equal(result.guides[0].sourceId, 'peer');
    valid(result.layout);
  }
});

test('六种批量对齐使用所选包围盒或画布，不改锁定、隐藏与非选中项', () => {
  const items = [rect('a', 10, 20, 20, 10), rect('b', 50, 60, 10, 20), rect('lock', 30, 5, 10, 15, { locked: true }), rect('hidden', 0, 0, 100, 100, { visible: false }), rect('other', 80, 80)];
  const ids = ['a', 'b', 'lock', 'hidden'];
  const expected = { left: [10, 10], 'center-x': [25, 30], right: [40, 50], top: [5, 5], 'center-y': [37.5, 32.5], bottom: [70, 60] };
  for (const [operation, positions] of Object.entries(expected)) {
    const result = arrangeLayouts(items, { operation, ids });
    const axis = ['left', 'center-x', 'right'].includes(operation) ? 'x' : 'y';
    assert.deepEqual(result.slice(0, 2).map(item => item.layout[axis]), positions);
    for (let index = 2; index < items.length; index++) assert.strictEqual(result[index], items[index]);
    result.forEach(item => valid(item.layout));
  }
  for (const [operation, axis, position] of [['left', 'x', 0], ['center-x', 'x', 40], ['right', 'x', 80], ['top', 'y', 0], ['center-y', 'y', 45], ['bottom', 'y', 90]]) {
    const result = arrangeLayouts(items, { operation, reference: 'canvas', ids: ['a'] });
    assert.equal(result[0].layout[axis], position);
    assert.strictEqual(result[1], items[1]);
  }
  assert.strictEqual(arrangeLayouts(items, { operation: 'left', ids: ['a'] }), items);
  assert.strictEqual(arrangeLayouts(items, { operation: 'left', reference: 'canvas', ids: ['lock'] }), items);
  assert.throws(() => arrangeLayouts(items, { operation: 'unknown' }), /不支持/);
});

test('水平和垂直等距保留首尾，锁定项把分布分为独立区段', () => {
  const horizontal = [rect('c', 50, 10), rect('a', 0, 10), rect('b', 12, 10, 20, 10)];
  const result = arrangeLayouts(horizontal, { operation: 'distribute-x' });
  assert.deepEqual(result.map(item => item.id), ['c', 'a', 'b']);
  assert.equal(result[2].layout.x, 20);
  assert.strictEqual(result[0], horizontal[0]); assert.strictEqual(result[1], horizontal[1]);
  close(result[2].layout.x - result[1].layout.x - result[1].layout.w, result[0].layout.x - result[2].layout.x - result[2].layout.w);
  const vertical = [rect('a', 10, 0), rect('b', 10, 12, 10, 20), rect('c', 10, 50)];
  assert.equal(arrangeLayouts(vertical, { operation: 'distribute-y' })[1].layout.y, 20);
  const anchored = [rect('a', 0, 10), rect('b', 20, 10), rect('c', 50, 10, 10, 10, { locked: true }), rect('d', 65, 10), rect('e', 90, 10)];
  const distributed = arrangeLayouts(anchored, { operation: 'distribute-x' });
  assert.deepEqual(distributed.map(item => item.layout.x), [0, 25, 50, 70, 90]);
  assert.strictEqual(distributed[2], anchored[2]);
  const impossible = [rect('a', 10, 10), rect('b', 10, 10, 80, 10), rect('c', 20, 10)];
  assert.strictEqual(arrangeLayouts(impossible, { operation: 'distribute-x' }), impossible);
});

test('同宽同高按首个选中项设置，必要时内移保持画布内，重复操作保持引用', () => {
  const items = [rect('far', 90, 85), rect('reference', 0, 0, 40, 30), rect('lock', 70, 70, 20, 20, { locked: true })];
  const ids = ['reference', 'far', 'lock'];
  const wide = arrangeLayouts(items, { operation: 'same-width', ids });
  assert.deepEqual(wide[0].layout, { x: 60, y: 85, w: 40, h: 10 });
  assert.strictEqual(wide[2], items[2]);
  const tall = arrangeLayouts(wide, { operation: 'same-height', ids });
  assert.deepEqual(tall[0].layout, { x: 60, y: 70, w: 40, h: 30 });
  assert.strictEqual(tall[2], items[2]);
  assert.strictEqual(arrangeLayouts(tall, { operation: 'same-height', ids }), tall);
  assert.deepEqual(items[0].layout, { x: 90, y: 85, w: 10, h: 10 });
});
