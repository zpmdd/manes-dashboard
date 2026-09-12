import assert from 'node:assert/strict';
import test from 'node:test';
import { demoMetrics } from '../src/geo.js';
import { DATA_FIELDS, getMappedData } from '../src/dataSources.js';
import { chartDomain, donutRows, finiteNumber, formatWidgetNumber, getWidgetData, normalizeWidgetData, progressValues, sortTableRows, statusTone, visibleRowCount } from '../src/widgetData.js';

test('fixed widget snapshots preserve totals, numeric order, partition semantics and empty states', () => {
  const index = { '100000': { name: '中国' }, '110000': { name: '北京市', parent: '100000' }, '120000': { name: '天津市', parent: '100000' }, '130000': { name: '河北省', parent: '100000' }, '130100': { name: '石家庄市', parent: '130000' } };
  const regions = getWidgetData('regions', '100000', index);
  assert.deepEqual(regions, getWidgetData('regions', '100000', index));
  assert.equal(regions.rows.reduce((sum, row) => sum + row.value, 0), demoMetrics('100000').devices);
  assert.ok(regions.rows.every((row, i) => Number.isInteger(row.value) && (!i || row.value <= regions.rows[i - 1].value)));
  assert.deepEqual(new Set(regions.rows.map(row => row.code)), new Set(['110000', '120000', '130000']));
  const partition = donutRows(regions.rows, 2);
  assert.equal(partition.length, 2);
  assert.equal(partition.at(-1).name, '其他');
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
  assert.equal(visibleRowCount(100), 100);
  assert.equal(visibleRowCount(101), 100);
  assert.equal(visibleRowCount(-1), 1);
});

test('external numeric data preserves missing values, numeric sorting, negative domains and target limits', () => {
  for (const value of [null, undefined, '', '  ', false, true, [], {}, Number.NaN, Infinity, 'not a number']) {
    assert.equal(finiteNumber(value), null);
    assert.equal(formatWidgetNumber(value), '—');
  }
  assert.equal(finiteNumber('12.5'), 12.5);
  assert.equal(formatWidgetNumber(1234.567, 2), '1,234.57');
  const input = { rows: [{ name: '十', value: '10' }, { name: '空', value: '' }, { name: '二', value: 2 }, { name: '无效', value: 'x' }], value: '12', onlineCount: 0 };
  const normalized = normalizeWidgetData(input);
  assert.equal(normalized.value, 12);
  assert.equal(normalized.onlineCount, 0);
  assert.equal(normalized.offlineCount, null);
  assert.deepEqual(sortTableRows(normalized.rows, 'ascending').map(row => row.name), ['二', '十', '空', '无效']);
  assert.deepEqual(sortTableRows(normalized.rows, 'descending').map(row => row.name), ['十', '二', '空', '无效']);
  assert.equal(input.rows[0].value, '10');
  assert.equal(normalizeWidgetData(null).rows.length, 0);
  assert.deepEqual(chartDomain([{ value: -8 }, { value: 12 }, { value: null }]), { min: -10, max: 15 });
  assert.deepEqual(chartDomain([{ value: 0 }]), { min: 0, max: 1 });
  assert.ok(Number.isFinite(chartDomain([{ value: Number.MAX_VALUE }]).max));
  assert.equal(chartDomain([{ value: Number.MIN_VALUE }]).max, Number.MIN_VALUE);
  assert.deepEqual(progressValues(120, 100), { value: 120, target: 100, percent: 120, fill: 100 });
  assert.equal(progressValues(-5, 100).fill, 0);
  assert.equal(progressValues(5, 0).target, 100);
  assert.equal(progressValues('', 100).percent, null);
  assert.equal(statusTone('已恢复'), 'normal');
  assert.equal(statusTone('待处理'), 'pending');
  assert.equal(statusTone('离线'), 'alert');
  assert.equal(statusTone('unknown'), 'neutral');
});

test('all twelve components render real supplied data and failed connections never fall back to snapshots', async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([import('vite'), import('react'), import('react-dom/server')]);
  const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { DashboardWidget } = await server.ssrLoadModule('/src/DashboardWidget.jsx');
    const config = { id: 'external-test', title: '测试组件', source: 'devices', type: 'metric', rowCount: 8, unit: '台', target: 100, text: '<script>alert(1)</script>\n第二行', columns: [{ key: 'name', label: '项目' }, { key: 'value', label: '数值' }, { key: 'status', label: '状态' }] };
    const data = { rows: [{ name: '实际项目甲', value: 12, status: '正常', time: '09:00' }, { name: '实际项目乙', value: 30, status: '待处理', time: '10:00' }], value: 42, scope: '实际范围' };
    const render = (type, props = {}) => renderToStaticMarkup(createElement(DashboardWidget, { config: { ...config, type }, code: '100000', index: { '100000': { name: '中国' } }, data, dataState: { status: 'ready' }, ...props }));
    for (const type of ['metric', 'gauge', 'line', 'area', 'bar', 'column', 'donut', 'table', 'progress', 'status', 'text', 'clock']) {
      const html = render(type);
      assert.match(html, new RegExp(`widget-type-${type}`));
      assert.doesNotMatch(html, /暂无数据|组件类型暂不可用|NaN|Infinity|undefined/);
    }
    assert.match(render('metric'), />42<\/strong>/);
    assert.match(render('text'), /&lt;script&gt;alert\(1\)&lt;\/script&gt;\n第二行/);
    assert.doesNotMatch(render('text'), /<script>/);
    assert.match(render('table'), /aria-sort="none"/);
    assert.match(render('progress'), /aria-valuemax="100"/);
    assert.match(render('metric', { data: null, dataState: { status: 'error' } }), /数据暂不可用/);
    assert.match(render('metric', { data: undefined, dataState: { status: 'error' } }), /数据暂不可用/);
    assert.match(render('metric', { data, dataState: { status: 'error', stale: true } }), /更新延迟/);
    assert.match(render('metric', { data, dataState: { status: 'error', stale: true } }), />42<\/strong>/);
    assert.match(render('line', { data: { rows: [] } }), /暂无数据/);
    assert.doesNotMatch(render('area', { data: { rows: [{ name: '负', value: -Number.MAX_VALUE }, { name: '正', value: Number.MAX_VALUE }] } }), /NaN|Infinity/);
    const hundred = Array.from({ length: 100 }, (_, i) => ({ name: `项目${i}`, value: i }));
    assert.equal((render('table', { data: { rows: hundred }, config: { ...config, type: 'table', rowCount: 3 } }).match(/<tr>/g) || []).length, 4);
    const columns = [...config.columns, { key: 'time', label: '时间' }, { key: 'target', label: '目标' }, { key: 'series', label: '系列' }, { key: 'code', label: '区域编码' }];
    const mapped = getMappedData({ rows: [{ name: '华东', value: '12', time: '09:00', status: '在线', target: 20, series: '设备', code: '031000' }] }, { fields: Object.fromEntries(DATA_FIELDS.map(key => [key, key])) }, { ...config, type: 'table', columns });
    const fullTable = render('table', { data: mapped, config: { ...config, type: 'table', columns } });
    assert.equal((fullTable.match(/<th\b/g) || []).length, 7, 'All seven selectable mapped fields must render');
    assert.match(fullTable, /<td class="widget-cell-code" title="031000">031000<\/td>/, 'Region code keeps its leading zero and remains visible as the seventh column');
    const codeTable = render('table', { data: mapped, config: { ...config, type: 'table', columns: [{ key: 'code', label: '区域编码' }] } });
    assert.match(codeTable, />031000<\/td>/, 'A code-only table is a valid table');
  } finally { await server.close(); }
});
