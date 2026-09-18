import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME } from '../src/themes.js';
import { demoMetrics } from '../src/geo.js';
import { DATA_FIELDS, getMappedData } from '../src/dataSources.js';
import { chartDomain, donutRows, finiteNumber, formatWidgetNumber, formatAxisNumber, getWidgetData, normalizeWidgetData, progressValues, sortTableRows, statusTone, visibleRowCount } from '../src/widgetData.js';

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

test('reused number formats match locale formatting at precision, sign and notation boundaries', () => {
  const values = [0, -0, -12.5678, '1234.5678', '-0', 1e12 - 1, 1e12, -1e12 + 1, -1e12, Number.MAX_VALUE, null, undefined, '', false, 'invalid', Infinity];
  const precisions = [[undefined, 1], [0, 0], [1, 1], [2, 2], [3, 3], [-4, 0], [8, 3], [2.9, 2], ['2', 2], ['invalid', 1], [null, 1], [NaN, 1], [Infinity, 1], [false, 1], [{}, 1]];
  for (const value of values) for (const [precision, digits] of precisions) {
    const numeric = finiteNumber(value);
    const expected = numeric === null ? '—' : numeric.toLocaleString('zh-CN', { maximumFractionDigits: digits, notation: Math.abs(numeric) >= 1e12 ? 'scientific' : 'standard' });
    assert.equal(formatWidgetNumber(value, precision), expected);
  }
});

test('tiny nonzero values remain visible and axis labels preserve useful small-number precision', () => {
  for (const [value, precision, expected] of [[0.002, 1, '2E-3'], [-0.002, 1, '-2E-3'], [0.0005, 2, '5E-4'], [0.002, 3, '0.002'], [Number.MIN_VALUE, 1, '5E-324'], [0, 1, '0'], [-0, 1, '-0']]) assert.equal(formatWidgetNumber(value, precision), expected);
  assert.deepEqual([0, -0, 0.0005, 0.001, -0.003, 2e-6, 2e12].map(formatAxisNumber), ['0', '0', '0.0005', '0.001', '-0.003', '2E-6', '2E12']);
});

test('all basic components render real supplied data and failed connections never fall back to snapshots', async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([import('vite'), import('react'), import('react-dom/server')]);
  const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { DashboardWidget } = await server.ssrLoadModule('/src/DashboardWidget.jsx');
    const { VehicleWidget } = await server.ssrLoadModule('/src/VehiclePanels.jsx');
    const { ComponentInspector } = await server.ssrLoadModule('/src/EditorPanels.jsx');
    const { MODULE_TYPES, DEFAULT_CONFIG, createModule } = await server.ssrLoadModule('/src/dashboardConfig.js');
    const basicTypes = ['metric', 'gauge', 'line', 'area', 'bar', 'column', 'donut', 'pie', 'table', 'progress', 'status'];
    for (const precision of [0, 2]) for (const { id: type } of [...MODULE_TYPES, { id: 'map' }]) {
      const item = { ...(type === 'map' ? DEFAULT_CONFIG.map : createModule(type)), precision };
      const html = renderToStaticMarkup(createElement(ComponentInspector, { item, isMap: type === 'map' }));
      const select = html.match(/<span>最多小数位<\/span><select>(.*?)<\/select>/)?.[1];
      if (basicTypes.includes(type)) assert.ok(select?.includes(`<option value="${precision}" selected="">`), `${type} selects precision ${precision}`);
      else assert.doesNotMatch(html, /最多小数位/, `${type} has no basic numeric precision control`);
    }
    const config = { id: 'external-test', title: '测试组件', source: 'devices', type: 'metric', rowCount: 8, unit: '台', target: 100, text: '<script>alert(1)</script>\n第二行', columns: [{ key: 'name', label: '项目' }, { key: 'value', label: '数值' }, { key: 'status', label: '状态' }] };
    const data = { rows: [{ name: '实际项目甲', value: 12, status: '正常', time: '09:00' }, { name: '实际项目乙', value: 30, status: '待处理', time: '10:00' }], value: 42, scope: '实际范围' };
    const render = (type, props = {}) => renderToStaticMarkup(createElement(DashboardWidget, { config: { ...config, type }, code: '100000', index: { '100000': { name: '中国' } }, data, dataState: { status: 'ready' }, ...props }));
    for (const type of ['metric', 'gauge', 'line', 'area', 'bar', 'column', 'donut', 'pie', 'table', 'progress', 'status', 'text', 'clock']) {
      const html = render(type);
      assert.match(html, new RegExp(`widget-type-${type}`));
      assert.doesNotMatch(html, /暂无数据|组件类型暂不可用|NaN|Infinity|undefined/);
      assert.doesNotMatch(html, /widget-heading-mark/, 'All shared widget headers omit decorative dots');
    }
    const pie = render('pie', { data: { rows: [{ name: '静止', value: 4, code: 'vehicle:stopped' }, { name: '行驶', value: 1, code: 'vehicle:moving' }] }, onNavigate() {} });
    assert.equal((pie.match(/class="widget-pie-slice" role="button" tabindex="0"/g) || []).length, 2);
    assert.match(pie, /class="widget-pie-value">4<tspan class="widget-pie-unit"> 台/); assert.match(pie, /A84,84 0 1,1/);
    assert.equal((pie.match(/class="widget-pie-leader"/g) || []).length, 2);
    assert.equal((pie.match(/class="widget-pie-depth"/g) || []).length, 2);
    assert.doesNotMatch(pie, /widget-donut-legend/);
    const singlePie = render('pie', { data: { rows: [{ name: '唯一', value: 1 }] } });
    assert.match(singlePie, /<circle cx="160" cy="100" r="84"/); assert.doesNotMatch(singlePie, /widget-donut-total/);
    assert.match(render('pie', { data: { rows: [{ name: '零', value: 0 }] } }), /暂无正值分布数据/);
    assert.match(render('pie', { data: { rows: [{ name: '负', value: -1 }] } }), /非负/);
    const densePie = render('pie', { data: { rows: Array.from({ length: 8 }, (_, i) => ({ name: `类型${i}`, value: i + 1 })) } });
    assert.doesNotMatch(densePie, /class="widget-pie-label"/); assert.equal((densePie.match(/<li>/g) || []).length, 8);
    const crowdedPie = render('pie', { data: { rows: [97, 1, 1, 1].map((value, i) => ({ name: `类型${i}`, value })) } });
    assert.doesNotMatch(crowdedPie, /class="widget-pie-leader"/); assert.equal((crowdedPie.match(/<li>/g) || []).length, 4, 'Concentrated slices retain readable legend rows');
    const vehicles = { value: 2, scope: '车辆定位快照', rows: [{ name: '车辆甲', code: 'vehicle:A', value: 0 }, { name: '车辆乙', code: 'vehicle:B', value: 10 }] };
    const selectedRanking = render('bar', { data: vehicles, selectedCodes: ['vehicle:A'], onNavigate() {} });
    assert.match(selectedRanking, /aria-pressed="true" aria-label="车辆甲/);
    assert.match(selectedRanking, /aria-pressed="false" aria-label="车辆乙/);
    assert.match(selectedRanking, /✓/);
    assert.doesNotMatch(render('bar', { data: vehicles, selectedCodes: [], onNavigate() {} }), /aria-pressed="true"|✓/, 'Clearing selection removes the check mark');
    assert.doesNotMatch(render('bar', { data: vehicles, onNavigate() {} }), /aria-pressed/, 'Unbound base rankings retain ordinary navigation semantics');
    const vehicleMetric = renderToStaticMarkup(createElement(VehicleWidget, { item: config, data: vehicles, state: { status: 'ready' }, onNavigate() {} }, createElement(DashboardWidget, { config, data: vehicles })));
    assert.match(vehicleMetric, />2<\/strong>/);
    assert.doesNotMatch(vehicleMetric, /vehicle-metric-visual|行驶|静止/, 'The sculpted total omits the vehicle visual and duplicate state counts');
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
    const ranked = [{ name: '第一名', value: 100 }, { name: '第二名', value: 80 }, { name: '第三名', value: 60 }, { name: '第四名', value: 40 }];
    const chartLabels = (type, rows = ranked) => [...render(type, { data: { rows }, config: { ...config, type, rowCount: 2 } }).matchAll(/aria-label="([^"]+) · [^"]+ 台"/g)].map(match => match[1]);
    assert.deepEqual(chartLabels('column'), ['第一名', '第二名'], 'Ranked columns show the first N supplied rows');
    assert.deepEqual(chartLabels('column', [...ranked].reverse()), ['第四名', '第三名'], 'Column charts preserve supplied ordering without sorting');
    for (const type of ['line', 'area']) assert.deepEqual(chartLabels(type), ['第三名', '第四名'], 'Time series retain the latest N supplied points');
    const columns = [...config.columns, { key: 'time', label: '时间' }, { key: 'target', label: '目标' }, { key: 'series', label: '系列' }, { key: 'code', label: '区域编码' }];
    const mapped = getMappedData({ rows: [{ name: '华东', value: '12', time: '09:00', status: '在线', target: 20, series: '设备', code: '031000' }] }, { fields: Object.fromEntries(DATA_FIELDS.map(key => [key, key])) }, { ...config, type: 'table', columns });
    const fullTable = render('table', { data: mapped, config: { ...config, type: 'table', columns } });
    assert.equal((fullTable.match(/<th\b/g) || []).length, 7, 'All seven selectable mapped fields must render');
    assert.match(fullTable, /<td class="widget-cell-code" title="031000">031000<\/td>/, 'Region code keeps its leading zero and remains visible as the seventh column');
    const codeTable = render('table', { data: mapped, config: { ...config, type: 'table', columns: [{ key: 'code', label: '区域编码' }] } });
    assert.match(codeTable, />031000<\/td>/, 'A code-only table is a valid table');
    const zeroColumns = ['x', 'y', 'value2'].map(key => ({ key, label: key }));
    const zeroTable = render('table', { data: { rows: [{ name: '零值', x: 0, y: 0, value2: 0 }] }, config: { ...config, type: 'table', columns: zeroColumns } });
    assert.equal((zeroTable.match(/<td class="widget-cell-(?:x|y|value2)" title="0">0<\/td>/g) || []).length, 3, 'Coordinates and secondary metric retain a valid numeric zero');
    const decimalTable = render('table', { data: { rows: [{ name: '精度', value2: 1234.567 }] }, config: { ...config, type: 'table', precision: 2, columns: [{ key: 'value2', label: '辅助指标' }] } });
    assert.match(decimalTable, /title="1,234.57">1,234.57<\/td>/);
    for (const [precision, value, target, shares] of [[0, '12', '100', ['33', '67']], [2, '12.35', '100.46', ['33.33', '66.67']]]) {
      const gauge = render('gauge', { data: { value: 12.345, rows: [] }, config: { ...config, type: 'gauge', precision, target: 100.456 } });
      assert.ok(gauge.includes(`aria-label="测试组件 ${value}台，量程 ${target}台"`));
      assert.ok(gauge.includes(`class="widget-gauge-label">${target}</text>`));
      const donut = render('donut', { data: { rows: [{ name: '甲', value: 1 }, { name: '乙', value: 2 }] }, config: { ...config, type: 'donut', precision } });
      for (const share of shares) {
        assert.ok(donut.includes(`（${share}%）</title>`));
        assert.ok(donut.includes(`>${share}%</strong>`));
      }
    }
    for (const [values, ticks] of [[[0.002, 0.008], ['0', '0.004', '0.008']], [[-0.003, 0.005], ['-0.003', '0.001', '0.005']], [[0.0005, 0.001], ['0', '0.0005', '0.001']], [[2e-6, 8e-6], ['0', '4E-6', '8E-6']], [[2e12, 8e12], ['0', '4E12', '8E12']]]) {
      const html = render('line', { data: { rows: values.map((value, i) => ({ name: `点${i}`, value })) } });
      const axisLabels = [...html.matchAll(/class="widget-chart-grid".*?<text[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
      assert.deepEqual(axisLabels, ticks);
      assert.doesNotMatch(html, /NaN|Infinity/);
    }
    assert.match(render('metric', { data: { value: 0.002, rows: [] } }), />2E-3<\/strong>/);
    for (const [values, widths] of [[[0.002, 0.001], ['100%', '50%']], [[-0.002, 0.001], ['100%', '50%']], [[0, 0], ['0%', '0%']], [[20, 10], ['100%', '50%']]]) {
      const html = render('bar', { data: { rows: values.map((value, i) => ({ name: `区域${i}`, value })) } });
      assert.deepEqual([...html.matchAll(/style="width:([^"]+)"/g)].map(match => match[1]), widths);
      assert.doesNotMatch(html, /NaN|Infinity/);
    }

  } finally { await server.close(); }
});

test('polling states retain normalized data references while status, replacement rows and external loading remain correct', async () => {
  const [{ readFile }, { transformWithEsbuild }, widgetData] = await Promise.all([import('node:fs/promises'), import('vite'), import('../src/widgetData.js')]);
  const source = await readFile(new URL('../src/DashboardWidget.jsx', import.meta.url), 'utf8');
  const component = source.slice(source.indexOf('export const DashboardWidget =')).replace('export const', 'const');
  const { code } = await transformWithEsbuild(component, 'DashboardWidget.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false });
  const cells = []; let cursor = 0, normalizations = 0, snapshots = 0, refreshes = 0;
  const useMemo = (build, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) cells[index] = { dependencies, value: build() };
    return cells[index].value;
  };
  // Execute the real component with persistent hook cells, as in the editor callback regressions.
  const runtime = {
    ...widgetData, DEFAULT_THEME, memo: fn => fn, useMemo, useId: () => 'stable-widget-heading',
    normalizeWidgetData: raw => { normalizations++; return normalizeWidgetData(raw); },
    getWidgetData: (...args) => { snapshots++; return getWidgetData(...args); },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    ...Object.fromEntries(['EmptyState', 'ChartErrorBoundary', 'Suspense', 'ProfessionalChart', 'Metric', 'Gauge', 'TrendChart', 'BarChart', 'DonutChart', 'DataTable', 'Progress', 'StatusGrid', 'Clock'].map(name => [name, name])),
  };
  const Component = new Function(...Object.keys(runtime), `${code}; return DashboardWidget;`)(...Object.values(runtime));
  const props = { config: { id: 'polling', type: 'multiLine', title: '轮询趋势', source: 'devices', rowCount: 5 }, code: '100000', index: { '100000': { name: '中国' } }, onRefresh: () => { refreshes++; } };
  const render = extra => {
    cursor = 0; const nodes = [];
    const visit = value => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') { nodes.push(value); value.children?.forEach(visit); }
    };
    visit(Component({ ...props, ...extra }));
    return { nodes, data: nodes.find(node => node.type === 'ProfessionalChart')?.props.data, text: JSON.stringify(nodes.map(node => node.children)) };
  };
  const initial = render({ dataState: { status: 'loading' } });
  assert.equal(initial.nodes.find(node => node.type === 'EmptyState').props.message, '正在加载');
  assert.equal(initial.data, undefined);
  assert.equal(snapshots, 0, 'The first external loading state never reads demo values');
  const data = { rows: [{ name: '09:00', series: '实际', value: '12' }] };
  const ready = render({ data, dataState: { status: 'ready' } });
  const loading = render({ data, dataState: { status: 'loading', stale: true } });
  const failed = render({ data, dataState: { status: 'error', stale: true, error: '连接中断' } });
  assert.equal(normalizations, 2, 'Only initial empty data and the first successful result are normalized');
  assert.strictEqual(loading.data, ready.data);
  assert.strictEqual(failed.data, ready.data);
  assert.strictEqual(failed.data.rows, ready.data.rows);
  const anotherRegion = render({ data, dataState: { status: 'ready' }, code: '110000', index: { '110000': { name: '北京' } } });
  assert.strictEqual(anotherRegion.data, ready.data, 'Fixed external data is independent of the displayed map region');
  assert.equal(normalizations, 2);
  assert.equal(ready.data.rows[0].value, 12);
  assert.match(loading.text, /更新中/);
  assert.equal(loading.nodes.find(node => node.props.className === 'widget-body').props['aria-busy'], true);
  assert.match(failed.text, /连接中断.*保留上次数据/);
  failed.nodes.find(node => node.props.className === 'widget-data-state is-error').props.onClick();
  assert.equal(refreshes, 1);
  const changed = render({ data: { rows: [...data.rows, { name: '10:00', series: '实际', value: 27 }] }, dataState: { status: 'ready' } });
  assert.notStrictEqual(changed.data, ready.data);
  assert.equal(changed.data.rows.length, 2);
  assert.equal(normalizations, 3);
  assert.equal(snapshots, 0);
  render({ data: undefined, dataState: undefined });
  assert.equal(snapshots, 1);
  const externalWithoutStatus = render({ data: undefined, dataState: {} });
  assert.equal(externalWithoutStatus.data, undefined, 'An external state object still blocks demo data before status is supplied');
  assert.equal(snapshots, 1);
});

test('table sorting is reused for unchanged rows and hidden sort columns restore input order', async () => {
  const [{ readFile }, { transformWithEsbuild }] = await Promise.all([import('node:fs/promises'), import('vite')]);
  const source = await readFile(new URL('../src/DashboardWidget.jsx', import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source.slice(source.indexOf('function DataTable('), source.indexOf('function Progress(')), 'DataTable.jsx', { loader: 'jsx', jsxFactory: 'h', sourcemap: false });
  let direction = null, previous, cached, sorts = 0;
  const runtime = { COLUMN_KEYS: new Set(DATA_FIELDS), number: formatWidgetNumber, statusTone, EmptyState: 'EmptyState',
    useState: () => [direction, update => { direction = update(direction); }],
    useMemo: (build, deps) => { if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { cached = build(); previous = deps; } return cached; },
    sortTableRows: (...args) => { sorts++; return sortTableRows(...args); }, h: (type, props, ...children) => ({ type, props: props || {}, children }),
  };
  const DataTable = new Function(...Object.keys(runtime), `${code}; return DataTable;`)(...Object.values(runtime));
  const rows = [{ name: '十', value: 10 }, { name: '二', value: 2 }, { name: '百', value: 100 }];
  const columns = [{ key: 'name', label: '项目' }, { key: 'value', label: '数值' }];
  const render = (patch = {}) => {
    const nodes = [], visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { nodes.push(node); node.children?.forEach(visit); } };
    visit(DataTable({ rows, columns, rowCount: 3, title: '排序表格', ...patch }));
    return { names: nodes.filter(node => node.type === 'td' && node.props.className === 'widget-cell-name').map(node => node.props.title), sort: nodes.find(node => node.type === 'button')?.props.onClick };
  };
  const initial = render(); assert.deepEqual(initial.names, ['十', '二', '百']); initial.sort();
  assert.deepEqual(render().names, ['百', '十', '二']); assert.equal(sorts, 2);
  assert.deepEqual(render({ title: '标题变化', rowCount: 2 }).names, ['百', '十']); assert.equal(sorts, 2);
  assert.deepEqual(render({ columns: [columns[0]] }).names, ['十', '二', '百']);
  assert.deepEqual(render({ rows: [...rows, { name: '千', value: 1000 }] }).names, ['千', '百', '十']);
  assert.deepEqual(rows.map(row => row.name), ['十', '二', '百']);
});

test('records sharing a region remain distinct through reordering, replacement and table sorting', async () => {
  const [{ readFile }, { transformWithEsbuild }] = await Promise.all([import('node:fs/promises'), import('vite')]);
  const source = await readFile(new URL('../src/DashboardWidget.jsx', import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source.slice(source.indexOf('function BarChart('), source.indexOf('function Clock(')), 'WidgetRows.jsx', { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Fragment', sourcemap: false });
  let direction = null;
  const runtime = { COLUMN_KEYS: new Set(DATA_FIELDS), number: formatWidgetNumber, statusTone, sortTableRows, progressValues, EmptyState: 'EmptyState', Fragment: 'Fragment',
    useState: () => [direction, update => { direction = update(direction); }], useMemo: build => build(),
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
  };
  const components = new Function(...Object.keys(runtime), `${code}; return { bar: BarChart, table: DataTable, status: StatusGrid, progress: Progress };`)(...Object.values(runtime));
  const rows = [{ name: 'A', value: 10, code: '110000', status: '在线' }, { name: 'B', value: 20, code: '110000', status: '在线' }, { name: 'C', value: 30, code: '120000', status: '在线' }];
  const columns = [{ key: 'name', label: '名称' }, { key: 'value', label: '数值' }];
  const flatten = tree => {
    const nodes = [], visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { nodes.push(node); node.children?.forEach(visit); } };
    visit(tree); return nodes;
  };
  for (const [type, Component] of Object.entries(components)) {
    direction = null;
    const render = (input, expected = input) => {
      const navigated = [];
      const data = normalizeWidgetData(getMappedData({ rows: input }, { fields: { name: 'name', value: 'value', code: 'code', status: 'status' } }, { type, columns }));
      const nodes = flatten(Component({ rows: data.rows, columns, title: type, unit: '', rowCount: 10, onNavigate: code => navigated.push(code) }));
      const items = nodes.filter(node => ['li', 'tr'].includes(node.type) && node.props.key !== undefined);
      assert.equal(items.length, expected.length, type);
      assert.equal(new Set(items.map(node => node.props.key)).size, expected.length, `${type} must not use region code as unique record identity`);
      if (type !== 'progress') {
        items.forEach((item, i) => {
          const button = flatten(item).find(node => node.type === 'button');
          assert.ok(button.props['aria-label'].startsWith(`${expected[i].name}，`));
          button.props.onClick();
        });
        assert.deepEqual(navigated, expected.map(row => row.code));
      }
      return nodes.find(node => node.type === 'button' && !node.props['aria-label'])?.props.onClick;
    };
    render(rows); render([...rows].reverse()); render(rows.slice(1));
    if (type === 'table') {
      render(rows)(); render(rows, [...rows].reverse())(); render(rows);
    }
  }
});
