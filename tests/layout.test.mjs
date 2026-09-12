import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/dashboardConfig.js';
import { changeLayout, editHistory, layoutStyle } from '../src/layout.js';

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
