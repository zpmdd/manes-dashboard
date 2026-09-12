import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'vite';
import * as echarts from 'echarts/core';
import { buildProfessionalChart, CHART_PALETTES, PROFESSIONAL_TYPES } from '../src/professionalCharts.js';
import { getWidgetData, normalizeWidgetData } from '../src/widgetData.js';

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
let server, renderProfessionalSVG;
before(async () => {
  server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ renderProfessionalSVG } = await server.ssrLoadModule('/src/ProfessionalChart.jsx'));
});
after(async () => { await server?.close(); });

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
  assert.deepEqual(scatter.series[0].data[0].value, [0, 25]);
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
