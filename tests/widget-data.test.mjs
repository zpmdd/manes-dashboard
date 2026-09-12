import assert from 'node:assert/strict';
import test from 'node:test';
import { demoMetrics } from '../src/geo.js';
import { donutRows, getWidgetData, sortTableRows, visibleRowCount } from '../src/widgetData.js';

test('fixed widget snapshots preserve totals, numeric order, partition semantics and empty states', () => {
  const index = { '100000': { name: '中国' }, '110000': { name: '北京市', parent: '100000' }, '120000': { name: '天津市', parent: '100000' }, '130000': { name: '河北省', parent: '100000' }, '130100': { name: '石家庄市', parent: '130000' } };
  const regions = getWidgetData('regions', '100000', index);
  assert.deepEqual(regions, getWidgetData('regions', '100000', index));
  assert.equal(regions.rows.reduce((sum, row) => sum + row.value, 0), demoMetrics('100000').devices);
  assert.ok(regions.rows.every((row, i) => Number.isInteger(row.value) && (!i || row.value <= regions.rows[i - 1].value)));
  assert.deepEqual(new Set(regions.rows.map(row => row.code)), new Set(['110000', '120000', '130000']));
  const partition = donutRows(regions.rows, 2);
  assert.equal(partition.length, 2);
  assert.equal(partition.at(-1).name, '其他区域');
  assert.equal(partition.reduce((sum, row) => sum + row.value, 0), regions.value);
  assert.equal(donutRows(regions.rows, 1).length, 1);
  assert.equal(getWidgetData('regions', '110000', index).rows.length, 0);
  assert.equal(getWidgetData('devices', 'unknown', index).value, null);
  assert.equal(getWidgetData('invalid', '100000', index).rows.length, 0);
  assert.equal(getWidgetData('devices', '100000', null).rows.length, 0);
  const devices = getWidgetData('devices', '100000', index);
  assert.equal(devices.onlineCount + devices.offlineCount, devices.value);
  const trend = getWidgetData('trend', '100000', index);
  assert.equal(trend.rows.at(-1).value, demoMetrics('100000').flow);
  assert.ok(trend.rows.every((row, i) => !i || row.time > trend.rows[i - 1].time));
  assert.notDeepEqual(trend.rows, getWidgetData('trend', '130000', index).rows);
  for (const code of Object.keys(index)) {
    const restored = getWidgetData('events', code, index).rows.filter(row => row.name.includes('恢复'));
    assert.ok(restored.length > 0 && restored.every(row => row.status === '已恢复'));
  }
  assert.deepEqual(sortTableRows([{ value: 10 }, { value: 2 }, { value: 100 }], 'ascending').map(row => row.value), [2, 10, 100]);
  assert.equal(visibleRowCount(Number.NaN), 5);
  assert.equal(visibleRowCount(100), 10);
  assert.equal(visibleRowCount(-1), 1);
});
