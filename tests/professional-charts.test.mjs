import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as echarts from 'echarts/core';
import { buildProfessionalChart, CHART_PALETTES, PROFESSIONAL_TYPES } from '../src/professionalCharts.js';
import { getWidgetData, normalizeWidgetData } from '../src/widgetData.js';
import { FONTS } from '../src/fonts.js';

const config = (type, extra = {}) => ({ type, title: '实际业务数据', rowCount: 5, target: 100, unit: '台', chartOptions: {}, ...extra });
const build = (type, rows, extra) => buildProfessionalChart(config(type, extra), { rows });
const trendRows = ['09:00', '10:00', '11:00'].flatMap((time, i) => ['东区', '西区'].map((series, j) => ({ name: time, time, series, value: i * 10 + j + 1 })));
const radarRows = ['覆盖', '效率', '响应'].flatMap((name, i) => ['本期', '上期'].map((series, j) => ({ name, series, value: 40 + i * 20 + j, target: i === 2 ? 150 : 100 })));
const fixtures = {
  multiLine: trendRows,
  stacked: trendRows,
  combo: [{ name: '第一', value: 240, value2: 92.5 }, { name: '第二', value: 180, value2: 96 }],
  radar: radarRows,
  scatter: [{ name: '节点甲', x: 0, y: 25, series: '东区' }, { name: '节点乙', x: 12, y: 0, value: 36, series: '西区' }],
  heatmap: [{ x: 0, y: 0, value: 4 }, { x: 1, y: 0, value: 8 }, { x: 0, y: 1, value: -3 }],
  funnel: [{ name: '申请', value: 400 }, { name: '审核', value: 250 }, { name: '办结', value: 110 }],
  treemap: [{ name: '采集器', series: '东区', value: 130 }, { name: '网关', series: '东区', value: 50 }, { name: '终端', series: '西区', value: 70 }],
};
let server, renderProfessionalSVG, updateProfessionalChart, ProfessionalChart;
before(async () => {
  server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ renderProfessionalSVG, updateProfessionalChart, default: ProfessionalChart } = await server.ssrLoadModule('/src/ProfessionalChart.jsx'));
});
after(async () => { await server?.close(); });

test('两套中文字体覆盖全部专业图表的真实 SVG 文本', () => {
  for (const font of FONTS) for (const type of PROFESSIONAL_TYPES) {
    const settings = config(type, { chartOptions: { labels: true } });
    const data = normalizeWidgetData({ rows: fixtures[type] });
    const svg = renderProfessionalSVG(settings, data, { width: 480, height: 280, fontFamily: font.family });
    const texts = [...svg.matchAll(/<text\b[^>]*>/g)].map(match => match[0]);
    assert(texts.length, `${font.id}/${type}: text is rendered`);
    assert(texts.every(text => text.includes(font.face)), `${font.id}/${type}: every chart label uses the selected font`);
  }
});

test('all eight professional types draw real ECharts SVG at normal and compact card sizes', () => {
  for (const type of PROFESSIONAL_TYPES) {
    for (const size of [{ width: 480, height: 280 }, { width: 220, height: 145 }]) {
      const svg = renderProfessionalSVG(config(type, { chartOptions: { labels: true } }), normalizeWidgetData({ rows: fixtures[type] }), size);
      assert.match(svg, new RegExp(`<svg width="${size.width}" height="${size.height}"`), type);
      assert.match(svg, /<(?:path|polygon|circle)\b/, type);
      assert.match(svg, /<text\b/, type);
      assert.doesNotMatch(svg, /NaN|Infinity|undefined/, type);
    }
  }
});

test('real SVG axes retain half-step decimals, signed ranges and compact extreme-value labels', () => {
  const cases = [
    { values: [0.001, 0.0015, 0.002], ticks: ['0', '0.0005', '0.001', '0.0015', '0.002'] },
    { values: [-0.003, -0.001, 0.003, 0.005], ticks: ['-0.004', '-0.002', '0', '0.002', '0.004', '0.006'] },
    { values: [2e-6, 4e-6, 6e-6, 8e-6], ticks: ['0', '2E-6', '4E-6', '6E-6', '8E-6'] },
    { values: [2e12, 4e12, 6e12, 8e12], ticks: ['0', '2E12', '4E12', '6E12', '8E12'] },
  ];
  for (const { values, ticks } of cases) {
    const rows = values.map((value, i) => ({ time: `T${i}`, series: '实测', value }));
    const svg = renderProfessionalSVG(config('multiLine', { chartOptions: { legend: false } }), { rows });
    const labels = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).filter(value => /^-?\d/.test(value));
    assert.deepEqual(labels, ticks);
    assert.equal(new Set(labels).size, labels.length, 'Distinct ticks must not be rounded into identical labels');
    assert.doesNotMatch(svg, /NaN|Infinity/);
  }
});

test('category windows retain every selected series and preserve gaps and input ranking', () => {
  const latest = build('multiLine', trendRows, { rowCount: 2 });
  assert.deepEqual(latest.option.xAxis.data, ['10:00', '11:00']);
  assert.deepEqual(latest.option.series.map(series => series.data.map(point => point.value)), [[11, 21], [12, 22]]);
  assert.equal(latest.count, 4);
  assert.doesNotMatch(latest.description, /09:00/);
  const first = build('stacked', trendRows, { rowCount: 2 });
  assert.deepEqual(first.option.xAxis.data, ['09:00', '10:00']);
  assert.deepEqual(first.option.series[1].data.map(point => point.value), [2, 12]);
  const sparse = build('multiLine', trendRows.filter(row => !(row.time === '10:00' && row.series === '西区')), { rowCount: 2 });
  assert.equal(sparse.option.series[1].data[0], null);
  assert.equal(sparse.count, 3);
  assert.equal(sparse.option.series[1].connectNulls, false);
  assert.throws(() => build('multiLine', [...trendRows, trendRows[0]]), /重复/);
  assert.throws(() => build('stacked', [{ name: '区域', value: 1 }]), /series/);
});

test('isolated points remain visible in long sparse series without joining gaps or adding continuous-series markers', () => {
  const continuous = Array.from({ length: 30 }, (_, i) => ({ time: `T${i}`, series: '连续', value: i + 30 }));
  const positions = [0, 13, 29];
  const rows = [...continuous, ...positions.map(i => ({ time: `T${i}`, series: '孤立', value: 80 }))];
  const size = { width: 220, height: 145 };
  const result = buildProfessionalChart(config('multiLine', { rowCount: 30, chartOptions: { legend: false } }), { rows }, { ...size, reducedMotion: true });
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, ...size });
  try {
    chart.setOption(result.option);
    const continuousData = chart.getModel().getSeriesByIndex(0).getData();
    const isolatedData = chart.getModel().getSeriesByIndex(1).getData();
    assert.equal(continuousData.getItemGraphicEl(13), undefined, 'The complete long series retains its uncluttered line');
    for (const position of positions) {
      const symbol = isolatedData.getItemGraphicEl(position);
      assert.ok(symbol, `Isolated point ${position} has a real graphic even on the compact card`);
      const bounds = symbol.getBoundingRect();
      assert.ok(bounds.width > 0 && bounds.height > 0);
      assert.equal(isolatedData.get('y', position), 80);
    }
    assert.equal(chart.getOption().series[1].data[12], null);
    assert.equal(chart.getOption().series[1].data[14], null);
    const svg = chart.renderToSVGString();
    const isolatedPath = svg.match(/<path d="([^"]+)"[^>]*stroke="#aebcb4"[^>]*>/)?.[1];
    assert.ok(isolatedPath);
    assert.equal((isolatedPath.match(/M/g) || []).length, 3);
    assert.doesNotMatch(isolatedPath, /[LCQ]/, 'No line is drawn across the missing categories');
    assert.doesNotMatch(svg, /NaN|Infinity/);
  } finally { chart.dispose(); }
});

test('large cards scale readable type while treemap keeps the selected palette brightness', () => {
  const compact = buildProfessionalChart(config('multiLine'), { rows: trendRows }, { width: 220, height: 145 }).option;
  const wide = buildProfessionalChart(config('multiLine'), { rows: trendRows }, { width: 749, height: 195 }).option;
  const large = buildProfessionalChart(config('multiLine'), { rows: trendRows }, { width: 1779, height: 408 }).option;
  assert.equal(compact.xAxis.axisLabel.fontSize, 11);
  assert.ok(wide.xAxis.axisLabel.fontSize > compact.xAxis.axisLabel.fontSize);
  assert.ok(large.xAxis.axisLabel.fontSize >= 14 && large.xAxis.axisLabel.fontSize <= 18);
  assert.ok(large.legend.itemGap > compact.legend.itemGap);
  const svg = renderProfessionalSVG(config('treemap'), { rows: fixtures.treemap }, { width: 1186, height: 272 });
  assert.match(svg, /fill="rgb\(238,226,185\)"/);
  assert.match(svg, /font-size:1[4-8]px/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('dual axes, radar bounds and optional scatter sizes retain distinct field semantics', () => {
  const combo = build('combo', fixtures.combo, { rowCount: 1, chartOptions: { secondaryUnit: '%', primaryName: '接入量', secondaryName: '在线率' } }).option;
  assert.deepEqual(combo.xAxis.data, ['第一']);
  assert.deepEqual(combo.series.map(series => [series.name, series.yAxisIndex, series.data[0].value]), [['接入量', 0, 240], ['在线率', 1, 92.5]]);
  assert.equal(combo.yAxis[1].name, '%');
  assert.throws(() => build('combo', [{ name: '甲', value: 1 }]), /value2/);
  const radar = build('radar', radarRows).option;
  assert.deepEqual(radar.radar.indicator.map(item => item.max), [100, 100, 150]);
  assert.throws(() => build('radar', radarRows.slice(1)), /缺少指标/);
  assert.throws(() => build('radar', radarRows, { rowCount: 2 }), /至少需要 3/);
  assert.equal(build('radar', radarRows.filter(row => row.series === '本期').map(({ target, series, ...row }) => row), { target: undefined }).option.radar.indicator[0].max, 100);
  const scatter = build('scatter', fixtures.scatter).option;
  assert.deepEqual(scatter.series[0].data[0].value, [0, 25, null]);
  assert.equal(scatter.series[0].data[0].symbolSize, 10);
  assert.equal(scatter.series[1].data[0].symbolSize, 28);
  assert.throws(() => build('scatter', [{ x: '', y: 0 }]), /x/);
  assert.throws(() => build('scatter', [{ x: 2, y: 0, value: -3 }]), /非负/);
});

test('heatmap limits categories without fabricating cells and counts actual dense elements', () => {
  const result = build('heatmap', fixtures.heatmap, { rowCount: 2 });
  assert.deepEqual(result.option.xAxis.data, ['0', '1']);
  assert.deepEqual(result.option.yAxis.data, ['0', '1']);
  assert.equal(result.option.series[0].data.length, 3);
  assert.equal(result.option.series[0].data[2].value[2], -3);
  assert.equal(build('heatmap', fixtures.heatmap, { rowCount: 1 }).count, 1);
  assert.throws(() => build('heatmap', [...fixtures.heatmap, fixtures.heatmap[0]]), /重复/);
  const dense = Array.from({ length: 1200 }, (_, i) => ({ x: i % 40, y: Math.floor(i / 40), value: i }));
  assert.equal(build('heatmap', dense, { rowCount: 40 }).count, 1200);
  assert.equal(build('heatmap', dense, { rowCount: 10 }).count, 100);
});

test('real scatter sizes and heatmap colors retain fractional ranges, zero points and sparse cells', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 480, height: 280 });
  const render = (type, values) => {
    const rows = values.map((value, i) => ({ name: `点${i}`, x: i, y: i % 2, value }));
    const result = buildProfessionalChart(config(type, { chartOptions: { labels: true } }), { rows }, { reducedMotion: true });
    chart.setOption(result.option, { notMerge: true });
    const data = chart.getModel().getSeriesByIndex(0).getData();
    assert.equal(data.count(), values.length, 'Zero points remain present and absent cells are not fabricated');
    assert.doesNotMatch(chart.renderToSVGString(), /NaN|Infinity|undefined/);
    return { option: result.option, data };
  };
  try {
    for (const scale of [0.008, 8]) {
      const { option, data } = render('scatter', [null, 0, scale / 4, scale]);
      assert.deepEqual(option.series[0].data.map(point => point.symbolSize), [10, 5, 14, 28]);
      const widths = [0, 1, 2, 3].map(i => data.getItemGraphicEl(i).getBoundingRect().width);
      assert.ok(widths[3] > widths[2] && widths[2] > widths[0] && widths[0] > widths[1] && widths[1] > 0, 'Actual symbols distinguish fractional magnitudes while keeping zero readable');
      assert.deepEqual(option.series[0].data.map(point => point.value), [[0, 0, null], [1, 1, 0], [2, 0, scale / 4], [3, 1, scale]]);
    }
    assert.deepEqual(render('scatter', [0, 0]).option.series[0].data.map(point => point.symbolSize), [5, 5]);
    let positiveColors;
    for (const scale of [0.008, 8]) {
      const { option, data } = render('heatmap', [0, scale / 4, scale]);
      assert.deepEqual([option.visualMap.min, option.visualMap.max], [0, scale]);
      const colors = [0, 1, 2].map(i => data.getItemGraphicEl(i).style.fill);
      assert.equal(new Set(colors).size, 3, 'Actual cell colors distinguish zero, quarter and maximum values');
      assert.deepEqual([0, 1, 2].map(i => data.getItemGraphicEl(i).getTextContent().style.fill), ['#eee7d8', '#342e38', '#342e38']);
      if (positiveColors) assert.deepEqual(colors, positiveColors, 'Unit changes preserve relative cell colors');
      positiveColors = colors;
      assert.deepEqual(option.series[0].data.map(point => point.value[2]), [0, scale / 4, scale]);
    }
    for (const [values, range] of [[[0, 0], [0, 1]], [[-0.008, -0.002, 0], [-0.008, 0]], [[-8, -2], [-8, 0]], [[-0.003, 0, 0.005], [-0.003, 0.005]]]) {
      const { option, data } = render('heatmap', values);
      assert.deepEqual([option.visualMap.min, option.visualMap.max], range);
      assert.deepEqual(option.series[0].data.map(point => point.value[2]), values);
      assert.equal(new Set(values.map((_, i) => data.getItemGraphicEl(i).style.fill)).size, new Set(values).size);
    }
  } finally { chart.dispose(); }
});

test('scatter tooltips expose the optional size value with its unit without fabricating missing values', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 480, height: 280 });
  try {
    const rows = [{ name: '缺少大小', x: 0, y: 12 }, { name: '有效零值', x: 1, y: 18, value: 0 }, { name: '小数大小', x: 2, y: 25, value: 0.002 }];
    const result = build('scatter', rows, { unit: '台', chartOptions: { xName: '负载', yName: '时延' } });
    chart.setOption(result.option, { notMerge: true });
    const series = chart.getModel().getSeriesByIndex(0);
    for (const [i, row] of rows.entries()) {
      const fields = series.formatTooltip(i).blocks.filter(block => block.markerType === 'subItem').map(({ name, value }) => [name, value]);
      assert.deepEqual(fields, [['负载', row.x], ['时延', row.y], ['数值 / 台', row.value ?? null]]);
    }
    assert.match(result.description, /有效零值，负载 1，时延 18，数值 0 台/);
    assert.match(result.description, /小数大小，负载 2，时延 25，数值 2E-3 台/);
    const plain = build('scatter', rows.slice(0, 1), { unit: '' });
    chart.setOption(plain.option, { notMerge: true });
    assert.deepEqual(chart.getModel().getSeriesByIndex(0).formatTooltip(0).blocks.filter(block => block.markerType === 'subItem').map(({ name, value }) => [name, value]), [['X', 0], ['Y', 12]]);
    assert.deepEqual(plain.option.series[0].data[0].value, [0, 12]);
    assert.doesNotMatch(plain.description, /数值/);
    assert.doesNotMatch(chart.renderToSVGString(), /NaN|Infinity|undefined/);
  } finally { chart.dispose(); }
});

test('funnel respects source stage order and treemap retains hierarchy and zero states', () => {
  const stages = [{ name: '第一', value: 20 }, { name: '第二', value: 80 }, { name: '第三', value: 10 }];
  const funnel = build('funnel', stages, { rowCount: 2 }).option.series[0];
  assert.equal(funnel.sort, 'none');
  assert.deepEqual(funnel.data.map(item => item.name), ['第一', '第二']);
  const tree = build('treemap', fixtures.treemap).option.series[0];
  assert.deepEqual(tree.data.map(group => [group.name, group.children.reduce((sum, leaf) => sum + leaf.value, 0)]), [['东区', 180], ['西区', 70]]);
  assert.equal(tree.nodeClick, false);
  for (const type of ['funnel', 'treemap']) {
    assert.equal(build(type, [{ name: '尚未发生', value: 0 }]).option, null);
    assert.throws(() => build(type, [{ name: '异常', value: -1 }]), /非负/);
  }
});

test('bounded configuration selects palettes, safe text tooltips, zoom and motion without raw option injection', () => {
  for (const palette of ['champagne', 'ocean', 'forest']) {
    const result = build('multiLine', trendRows, { chartOptions: { palette, legend: false, labels: true, smooth: false, zoom: true } });
    assert.deepEqual(result.option.color, CHART_PALETTES[palette]);
    assert.equal(result.option.legend.show, false);
    assert.equal(result.option.series[0].label.show, true);
    assert.equal(result.option.series[0].smooth, false);
    assert.equal(result.option.tooltip.renderMode, 'richText');
    assert.equal(result.option.dataZoom[0].zoomOnMouseWheel, 'ctrl');
  }
  assert.equal(buildProfessionalChart(config('combo'), { rows: fixtures.combo }, { reducedMotion: true }).option.animation, false);
  const hostile = '<script>alert(1)</script>';
  const svg = renderProfessionalSVG(config('funnel'), { rows: [{ name: hostile, value: 2 }] });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  for (const type of PROFESSIONAL_TYPES) assert.equal(build(type, []).option, null);
  assert.throws(() => build('combo', [{ name: '甲', value: Infinity, value2: 1 }]), /有效数字/);
  assert.throws(() => build('scatter', Array.from({ length: 5001 }, () => ({ x: 0, y: 0 }))), /5000/);
});

test('real ECharts instance resizes, updates series and releases its renderer', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 480, height: 280 });
  try {
    chart.setOption(buildProfessionalChart(config('multiLine'), { rows: trendRows }, { reducedMotion: true }).option);
    chart.resize({ width: 310, height: 195, animation: { duration: 0 } });
    assert.match(chart.renderToSVGString(), /<svg width="310" height="195"/);
    chart.setOption(buildProfessionalChart(config('multiLine'), { rows: trendRows.filter(row => row.series === '东区') }, { reducedMotion: true }).option, { replaceMerge: ['series'] });
    assert.equal(chart.getOption().series.length, 1);
    assert.doesNotMatch(chart.renderToSVGString(), /西区/);
  } finally { chart.dispose(); }
  assert.equal(chart.isDisposed(), true);
});

test('resize consumes one lazy update while initialization and data-only changes keep their deferred render', () => {
  const size = { width: 480, height: 280 };
  const rows = trendRows.filter(row => !(row.time === '10:00' && row.series === '西区'));
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, ...size });
  let updates = 0;
  chart.on('updated', () => { updates += 1; });
  // SSR does not run a browser animation loop; advance the real registered ECharts frame listener.
  const frame = () => chart.getZr().animation.trigger('frame', 16);
  try {
    const initial = buildProfessionalChart(config('multiLine'), { rows }, size);
    updateProfessionalChart(chart, initial.option, size, true);
    assert.equal(updates, 0, 'Initialization at the known size must not force a resize');
    frame();
    assert.equal(updates, 1);
    const resized = { width: 481, height: 280 };
    updateProfessionalChart(chart, buildProfessionalChart(config('multiLine'), { rows }, resized).option, resized);
    assert.equal(updates, 2, 'Resize and pending options share one completed update');
    frame();
    assert.equal(updates, 2, 'The next frame must not repeat the completed resize update');
    assert.match(chart.renderToSVGString(), /<svg width="481" height="280"/);
    assert.equal(chart.getOption().series[1].data[1], null, 'The missing category remains a gap');
    const changedRows = rows.map(row => ({ ...row, value: row.value + 7 }));
    updateProfessionalChart(chart, buildProfessionalChart(config('multiLine'), { rows: changedRows }, resized).option, resized);
    assert.equal(updates, 2, 'Repeated dimensions with changed data retain lazy rendering');
    assert.equal(chart.getOption().animation, true);
    assert.equal(chart.getOption().animationDurationUpdate, 280);
    frame();
    assert.equal(updates, 3);
    assert.equal(chart.getOption().series[0].data[0].value, rows[0].value + 7);
    updateProfessionalChart(chart, null, resized);
    updateProfessionalChart(chart, initial.option, { width: 0, height: 0 });
    frame();
    assert.equal(updates, 3, 'Unavailable data and zero-size hosts do not update the instance');
  } finally { chart.dispose(); }
  assert.doesNotThrow(() => updateProfessionalChart(chart, build('multiLine', rows).option, size));
  const rebuilt = echarts.init(null, null, { renderer: 'svg', ssr: true, ...size });
  let rebuiltUpdates = 0;
  rebuilt.on('updated', () => { rebuiltUpdates += 1; });
  try {
    updateProfessionalChart(rebuilt, build('multiLine', rows).option, size, true);
    assert.equal(rebuiltUpdates, 0, 'A replacement renderer follows the first-initialization path');
    rebuilt.getZr().animation.trigger('frame', 16);
    assert.equal(rebuiltUpdates, 1);
    assert.equal(rebuilt.getOption().series[1].data[1], null);
  } finally { rebuilt.dispose(); }
});

test('replacement instances restore only the selected legend and enabled zoom in one lazy update', () => {
  const size = { width: 480, height: 280 }, settings = config('multiLine', { chartOptions: { zoom: true } });
  const buildOption = (current = settings) => buildProfessionalChart(current, { rows: trendRows }, { ...size, reducedMotion: true }).option;
  let chart = echarts.init(null, null, { renderer: 'svg', ssr: true, ...size });
  const frame = () => chart.getZr().animation.trigger('frame', 16);
  try {
    updateProfessionalChart(chart, buildOption(), size, true); frame();
    chart.dispatchAction({ type: 'legendUnSelect', name: '西区' });
    chart.dispatchAction({ type: 'dataZoom', dataZoomId: 'inside', start: 20, end: 70 });
    const current = chart.getOption();
    const interaction = { selected: current.legend[0].selected, zoom: current.dataZoom.map(({ id, start, end }) => ({ id, start, end })) };
    chart.dispose();
    chart = echarts.init(null, null, { renderer: 'svg', ssr: true, ...size });
    let updates = 0;
    chart.on('updated', () => { updates += 1; });
    const option = buildOption();
    updateProfessionalChart(chart, option, size, true, interaction);
    assert.equal(updates, 0, 'Restoration remains part of the deferred first render');
    frame(); assert.equal(updates, 1);
    assert.equal(chart.getOption().legend[0].selected['西区'], false);
    assert.deepEqual(chart.getOption().dataZoom.map(({ start, end }) => [start, end]), [[20, 70]]);
    assert.equal(option.legend.selected, undefined); assert.equal(option.dataZoom[0].start, undefined, 'The built option is not mutated');
    updateProfessionalChart(chart, buildOption(), { width: 481, height: 280 });
    assert.equal(updates, 2); frame(); assert.equal(updates, 2);
    assert.equal(chart.getOption().legend[0].selected['西区'], false);
    assert.deepEqual(chart.getOption().dataZoom.map(({ start, end }) => [start, end]), [[20, 70]]);
    const noZoom = config('multiLine', { chartOptions: { zoom: false } });
    updateProfessionalChart(chart, buildOption(noZoom), size, true, interaction); frame();
    assert.deepEqual(chart.getOption().dataZoom, [], 'A restored snapshot cannot enable disabled zoom');
    assert.equal(chart.getOption().legend[0].selected['西区'], false);
    const otherType = config('stacked', { chartOptions: { zoom: true } });
    updateProfessionalChart(chart, buildOption(otherType), size, true); frame();
    assert.deepEqual(chart.getOption().legend[0].selected, {}, 'Type changes use notMerge without a previous interaction');
    assert.deepEqual(chart.getOption().dataZoom.map(({ start, end }) => [start, end]), [[0, 100]]);
    assert.ok(chart.getOption().series.every(series => series.type === 'bar'));
  } finally { chart.dispose(); }
});

test('renderer choice accounts for expanded sparse slots without changing data counts or gaps', () => {
  const sparseRows = Array.from({ length: 500 }, (_, i) => ({ time: `T${i % 100}`, series: `S${i}`, value: i + 1 }));
  for (const type of ['multiLine', 'stacked']) {
    const settings = config(type, { rowCount: 100 });
    const result = buildProfessionalChart(settings, { rows: sparseRows });
    assert.equal(result.count, 500);
    assert.equal(result.renderCount, 50000);
    assert.equal(result.option.series.length, 500);
    assert.equal(result.option.series.reduce((total, series) => total + series.data.filter(item => item !== null).length, 0), 500);
    assert.equal(result.option.series[0].data[1], null);
    assert.match(result.description, /500 个数据点/);
    const html = renderToStaticMarkup(createElement(ProfessionalChart, { config: settings, data: { rows: sparseRows } }));
    assert.match(html, /data-chart-renderer="canvas"/);
    const smaller = renderToStaticMarkup(createElement(ProfessionalChart, { config: settings, data: { rows: sparseRows.slice(0, 10) } }));
    assert.match(smaller, /data-chart-renderer="svg"/);
  }
});

test('all professional demo sources pass the exact same external-data rendering path', () => {
  const sources = { multiLine: 'seriesTrend', stacked: 'seriesTrend', combo: 'comparison', radar: 'dimensions', scatter: 'scatter', heatmap: 'heat', funnel: 'funnel', treemap: 'tree' };
  for (const [type, source] of Object.entries(sources)) {
    const data = normalizeWidgetData(getWidgetData(source, '100000', { '100000': { name: '中国' } }));
    const svg = renderProfessionalSVG(config(type), data);
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
  }
});

test('filled chart labels remain legible on light and dark data marks', () => {
  assert.equal(build('funnel', fixtures.funnel).option.series[0].label.color, '#342e38');
  assert.equal(build('funnel', fixtures.funnel, {chartOptions: {labels: true}}).option.series[0].label.color, '#eee7d8');
  assert.equal(build('stacked', fixtures.stacked, {chartOptions: {labels: true}}).option.series[0].label.color, '#342e38');
  const cells=build('heatmap', [{x:'甲',y:'一',value:0},{x:'乙',y:'一',value:100}], {chartOptions: {labels: true}}).option.series[0].data;
  assert.deepEqual(cells.map(cell=>cell.label.color), ['#eee7d8','#342e38']);
});
