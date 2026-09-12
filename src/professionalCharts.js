import { finiteNumber, formatAxisNumber, formatWidgetNumber, PROFESSIONAL_TYPES, visibleRowCount } from './widgetData.js';

export { PROFESSIONAL_TYPES } from './widgetData.js';
export const CHART_PALETTES = {
  champagne: ['#eee2b9', '#aebcb4', '#c6a9a5', '#9aa7b9', '#b7afc5', '#c6bf9f', '#8faca6', '#b49b87'],
  ocean: ['#b5d0d2', '#95b4c7', '#ddd1b3', '#aeb7ce', '#c5b5ca', '#92b9b4', '#c7d0cc', '#a5aabf'],
  forest: ['#c4d0b3', '#99b8a5', '#e0d2ae', '#adbdae', '#c8bc9f', '#8caeae', '#bcc49d', '#b8acb9'],
};
const ink = '#eee7d8', fillInk = '#342e38', muted = '#cfc6b3', line = '#e7decb24';
const valueAxis = (name, font) => ({ type: 'value', name, nameTextStyle: { color: muted, fontSize: Math.max(10, font - 1) }, axisLabel: { color: muted, fontSize: font, formatter: formatAxisNumber }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: line, type: 'dashed' } } });
const unique = values => [...new Set(values)];
const label = value => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const rowName = (row, index) => label(row.name) || label(row.time) || `第 ${index + 1} 项`;
const rowCategory = (row, index, preferTime = false) => {
  const result = preferTime ? label(row.time) || label(row.name) : label(row.name) || label(row.time);
  if (!result) throw new Error(`第 ${index + 1} 行缺少名称或时间类别`);
  return result;
};
function numeric(row, key, index, nonnegative = false) {
  const value = finiteNumber(row[key]);
  if (value === null || (nonnegative && value < 0)) throw new Error(`第 ${index + 1} 行的 ${key} 需为${nonnegative ? '非负' : '有效'}数字`);
  return value;
}
function requiredLabel(row, key, index) {
  const value = label(row[key]);
  if (!value) throw new Error(`第 ${index + 1} 行缺少 ${key} 类别`);
  return value;
}
function groupedRows(rows, count, latest = false, seriesOptional = false) {
  const categories = unique(rows.map((row, i) => rowCategory(row, i, latest)));
  const selected = latest ? categories.slice(-count) : categories.slice(0, count), groups = new Map();
  rows.forEach((row, i) => {
    const category = rowCategory(row, i, latest), series = seriesOptional ? label(row.series) || '当前' : requiredLabel(row, 'series', i);
    const value = numeric(row, 'value', i);
    if (!groups.has(series)) groups.set(series, new Map());
    const group = groups.get(series);
    if (group.has(category)) throw new Error(`系列“${series}”的“${category}”存在重复数据，请先汇总`);
    group.set(category, { ...row, value });
  });
  return { categories: selected, groups: [...groups].filter(([, values]) => selected.some(category => values.has(category))) };
}

// The same plain options drive browser rendering and real ECharts SVG regression checks.
export function buildProfessionalChart(config, data, size = {}) {
  if (!PROFESSIONAL_TYPES.includes(config.type)) throw new Error('不支持的专业图表');
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return { option: null, count: 0, renderCount: 0, description: '暂无数据' };
  if (rows.length > 5000) throw new Error('专业图表最多支持 5000 行数据');
  if (rows.some(row => !row || typeof row !== 'object')) throw new Error('每行数据需为字段对象');
  const settings = config.chartOptions || {}, count = visibleRowCount(config.rowCount);
  const colors = CHART_PALETTES[settings.palette] || CHART_PALETTES.champagne;
  const legend = settings.legend !== false, labels = settings.labels === true;
  const unit = config.unit ?? data.unit ?? '', width = size.width || 480, height = size.height || 260;
  const font = Math.round(Math.max(11, Math.min(18, 11 * Math.sqrt(width / 480) * Math.pow(height / 260, .25), height / 12)));
  const spacing = value => Math.round(value * font / 11), minorFont = Math.max(10, font - 1);
  const axis = name => valueAxis(name, font);
  const categoryAxis = (data, name = '') => ({ ...axis(name), type: 'category', data, axisLabel: { color: muted, fontSize: font, hideOverlap: true, overflow: 'truncate', width: spacing(64) }, splitLine: { show: false } });
  const itemLabel = { show: labels, color: ink, fontSize: font, overflow: 'truncate' };
  const option = {
    backgroundColor: 'transparent', color: colors, textStyle: { fontFamily: 'Manrope, PingFang SC, Microsoft YaHei, sans-serif', color: ink },
    animation: size.reducedMotion !== true, animationDuration: 480, animationDurationUpdate: 280,
    aria: { enabled: true, label: { description: `${config.title}，${rows.length} 条数据${unit ? `，单位 ${unit}` : ''}。` } },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, backgroundColor: '#302b32f2', borderColor: '#cdbf9b78', borderWidth: 1, textStyle: { color: ink, fontSize: Math.max(12, font) }, padding: [spacing(9), spacing(11)] },
    legend: { id: 'legend', show: legend, type: 'scroll', top: 0, left: 'center', textStyle: { color: muted, fontSize: font }, pageTextStyle: { color: muted, fontSize: minorFont }, pageIconColor: ink, pageIconInactiveColor: '#6c6570', itemWidth: spacing(13), itemHeight: spacing(7), itemGap: spacing(15) },
    grid: { left: 7, right: config.type === 'combo' ? 8 : 12, top: legend ? spacing(34) : spacing(19), bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    dataZoom: [], series: [],
  };
  let pointCount = 0, renderCount, shownRows = rows;
  if (config.type === 'multiLine' || config.type === 'stacked') {
    const grouped = groupedRows(rows, count, config.type === 'multiLine');
    shownRows = rows.filter((row, i) => grouped.categories.includes(rowCategory(row, i, config.type === 'multiLine')));
    pointCount = shownRows.length;
    renderCount = grouped.categories.length * grouped.groups.length;
    option.xAxis = categoryAxis(grouped.categories, settings.xName || ''); option.yAxis = axis(unit);
    option.tooltip.trigger = 'axis'; option.tooltip.axisPointer = { type: config.type === 'stacked' ? 'shadow' : 'line', lineStyle: { color: '#e1d1a77d' } };
    option.series = grouped.groups.map(([name, values], i) => {
      const hasIsolatedPoint = config.type === 'multiLine' && grouped.categories.some((category, position, categories) => values.has(category) && !values.has(categories[position - 1]) && !values.has(categories[position + 1]));
      return {
        id: `series-${name}`, name, type: config.type === 'stacked' ? 'bar' : 'line',
        ...(config.type === 'stacked' ? { stack: 'total', barMaxWidth: 32, itemStyle: { borderRadius: [2, 2, 0, 0] } } : { smooth: settings.smooth !== false, showSymbol: grouped.categories.length <= 24 || hasIsolatedPoint, showAllSymbol: hasIsolatedPoint ? true : 'auto', symbolSize: 5, lineStyle: { width: 2, color: colors[i % colors.length] }, connectNulls: false }),
        emphasis: { focus: 'series' }, label: { ...itemLabel, color: config.type === 'stacked' ? fillInk : ink, position: config.type === 'stacked' ? 'inside' : 'top' },
        data: grouped.categories.map(category => values.has(category) ? { value: values.get(category).value, code: values.get(category).code, name: category } : null),
      };
    });
  } else if (config.type === 'combo') {
    const categories = rows.map((row, i) => rowCategory(row, i, true));
    if (new Set(categories).size !== categories.length) throw new Error('双轴图同一类别存在多行，请先汇总为一行');
    rows.forEach((row, i) => { numeric(row, 'value', i); numeric(row, 'value2', i); });
    shownRows = rows.slice(0, count); pointCount = shownRows.length * 2;
    option.xAxis = categoryAxis(categories.slice(0, count), settings.xName || '');
    option.yAxis = [axis(unit), { ...axis(settings.secondaryUnit || ''), splitLine: { show: false } }];
    option.tooltip.trigger = 'axis';
    option.series = [
      { id: 'primary', name: settings.primaryName || '主指标', type: 'bar', yAxisIndex: 0, barMaxWidth: 28, itemStyle: { color: colors[0], opacity: .78, borderRadius: [3, 3, 0, 0] }, label: { ...itemLabel, position: 'top' }, data: shownRows.map((row, i) => ({ value: numeric(row, 'value', i), name: categories[i], code: row.code })) },
      { id: 'secondary', name: settings.secondaryName || '辅助指标', type: 'line', yAxisIndex: 1, smooth: settings.smooth !== false, symbolSize: 6, lineStyle: { width: 2 }, label: { ...itemLabel, position: 'top' }, data: shownRows.map((row, i) => ({ value: numeric(row, 'value2', i), name: categories[i], code: row.code })) },
    ];
  } else if (config.type === 'radar') {
    rows.forEach((row, i) => requiredLabel(row, 'name', i));
    const grouped = groupedRows(rows, count, false, true);
    shownRows = rows.filter(row => grouped.categories.includes(label(row.name)));
    if (grouped.categories.length < 3) throw new Error('雷达图至少需要 3 个指标，请增加数据或显示条数');
    const indicators = grouped.categories.map(name => {
      const values = grouped.groups.map(([series, entries]) => {
        if (!entries.has(name)) throw new Error(`雷达系列“${series}”缺少指标“${name}”`);
        const row = entries.get(name), target = finiteNumber(row.target ?? config.target ?? 100);
        if (row.value < 0 || target === null || target <= 0) throw new Error(`雷达指标“${name}”需非负值和正数目标上限`);
        return Math.max(row.value, target);
      });
      return { name, max: Math.max(...values), min: 0 };
    });
    pointCount = grouped.categories.length * grouped.groups.length;
    option.radar = { indicator: indicators, center: ['50%', legend ? '56%' : '51%'], radius: Math.max(22, Math.min(width * .31, (height - spacing(legend ? 50 : 25)) * .42)), splitNumber: 4, axisName: { color: muted, fontSize: font, overflow: 'truncate', width: Math.max(42, width * .2) }, axisNameGap: spacing(9), axisLine: { lineStyle: { color: line } }, splitLine: { lineStyle: { color: line } }, splitArea: { areaStyle: { color: ['#efe3bd04', '#efe3bd09'] } } };
    option.series = [{ id: 'radar', type: 'radar', symbolSize: 4, lineStyle: { width: 2 }, areaStyle: { opacity: .13 }, label: itemLabel, data: grouped.groups.map(([name, values]) => ({ name, value: grouped.categories.map(category => values.get(category).value) })) }];
  } else if (config.type === 'scatter') {
    rows.forEach((row, i) => { numeric(row, 'x', i); numeric(row, 'y', i); if (row.value !== null && row.value !== undefined && row.value !== '') numeric(row, 'value', i, true); });
    shownRows = rows.slice(0, count); pointCount = shownRows.length;
    const maxSize = Math.max(1, ...shownRows.map(row => finiteNumber(row.value) ?? 0));
    option.xAxis = { ...axis(settings.xName || 'X'), scale: true }; option.yAxis = { ...axis(settings.yName || 'Y'), scale: true };
    option.series = unique(shownRows.map(row => label(row.series) || '观测值')).map(name => ({
      id: `scatter-${name}`, name, type: 'scatter', dimensions: [{ name: 'x', displayName: settings.xName || 'X', type: 'float' }, { name: 'y', displayName: settings.yName || 'Y', type: 'float' }], encode: { x: 0, y: 1, tooltip: [0, 1] }, emphasis: { focus: 'series' }, label: { ...itemLabel, position: 'top', formatter: '{b}' },
      itemStyle: { opacity: .78, borderColor: '#fff4d478', borderWidth: 1 },
      data: shownRows.flatMap((row, i) => (label(row.series) || '观测值') === name ? [{ name: rowName(row, i), value: [numeric(row, 'x', i), numeric(row, 'y', i)], code: row.code, symbolSize: finiteNumber(row.value) === null ? 10 : Math.max(5, Math.sqrt(row.value / maxSize) * 28) }] : []),
    }));
  } else if (config.type === 'heatmap') {
    const xs = unique(rows.map((row, i) => requiredLabel(row, 'x', i))).slice(0, count), ys = unique(rows.map((row, i) => requiredLabel(row, 'y', i))).slice(0, count), cells = new Set();
    rows.forEach((row, i) => {
      numeric(row, 'value', i);
      const key = JSON.stringify([label(row.x), label(row.y)]);
      if (cells.has(key)) throw new Error(`热力坐标“${label(row.x)} / ${label(row.y)}”存在重复数据，请先汇总`);
      cells.add(key);
    });
    shownRows = rows.filter(row => xs.includes(label(row.x)) && ys.includes(label(row.y))); pointCount = shownRows.length;
    const values = shownRows.map(row => finiteNumber(row.value)), min = Math.min(0, ...values), max = Math.max(1, ...values);
    option.legend.show = false; option.grid.top = 12; option.grid.bottom = spacing(40);
    option.xAxis = categoryAxis(xs, settings.xName || ''); option.yAxis = { ...categoryAxis(ys, settings.yName || ''), axisLabel: { color: muted, fontSize: font, overflow: 'truncate', width: spacing(68) } };
    option.visualMap = { show: legend, min, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: Math.min(spacing(120), width * .35), itemWidth: spacing(8), text: ['高', '低'], textStyle: { color: muted, fontSize: minorFont }, inRange: { color: ['#4b454f', colors[3], colors[1], colors[0]] } };
    if (!legend) option.grid.bottom = 8;
    option.series = [{ id: 'heatmap', type: 'heatmap', dimensions: ['横向类别', '纵向类别', unit ? `数值 / ${unit}` : '数值'], encode: { x: 0, y: 1, value: 2, tooltip: [2] }, label: { ...itemLabel, color: '#faf3df' }, itemStyle: { borderColor: '#423b4666', borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: '#f1e4b5', borderWidth: 1 } }, data: shownRows.map(row => ({ value: [xs.indexOf(label(row.x)), ys.indexOf(label(row.y)), finiteNumber(row.value)], name: `${label(row.x)} / ${label(row.y)}`, label: { color: (finiteNumber(row.value) - min) / (max - min) < .2 ? ink : fillInk }, code: row.code })) }];
  } else if (config.type === 'funnel') {
    rows.forEach((row, i) => { requiredLabel(row, 'name', i); numeric(row, 'value', i, true); });
    shownRows = rows.slice(0, count); pointCount = shownRows.length;
    const max = Math.max(...shownRows.map(row => finiteNumber(row.value)));
    if (max === 0) return { option: null, count: 0, renderCount: 0, description: '各阶段当前均为 0' };
    option.series = [{ id: 'funnel', type: 'funnel', left: labels ? '5%' : '12%', right: labels ? '24%' : '12%', top: legend ? spacing(32) : 8, bottom: 7, min: 0, max, minSize: '0%', maxSize: '100%', sort: 'none', gap: 4, label: { show: true, position: labels ? 'right' : 'inside', color: labels ? ink : fillInk, fontSize: font, formatter: labels ? '{b}: {c}' : '{b}' }, labelLine: { length: 8, lineStyle: { color: muted } }, itemStyle: { borderColor: '#efe4c638', borderWidth: 1, opacity: .86 }, emphasis: { label: { fontWeight: 'bold' } }, data: shownRows.map((row, i) => ({ name: label(row.name), value: numeric(row, 'value', i), code: row.code })) }];
  } else if (config.type === 'treemap') {
    rows.forEach((row, i) => { requiredLabel(row, 'name', i); numeric(row, 'value', i, true); });
    shownRows = rows.slice(0, count); pointCount = shownRows.length;
    if (!shownRows.some(row => finiteNumber(row.value) > 0)) return { option: null, count: 0, renderCount: 0, description: '各项目当前均为 0' };
    const groups = new Map();
    shownRows.forEach((row, i) => {
      const group = label(row.series);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ id: `leaf-${i}`, name: label(row.name), value: finiteNumber(row.value), code: row.code });
    });
    const tree = [...groups].flatMap(([name, children], i) => name ? [{ id: `group-${i}`, name, children }] : children);
    option.legend.show = false;
    option.series = [{ id: 'treemap', type: 'treemap', top: 4, bottom: 5, left: 3, right: 3, roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, color: fillInk, fontSize: font, overflow: 'truncate', formatter: labels ? '{b}\n{c}' : '{b}' }, upperLabel: { show: true, height: spacing(23), color: ink, fontSize: font }, itemStyle: { borderColor: '#4e4651', borderWidth: 2, gapWidth: 3 }, levels: [{ itemStyle: { borderWidth: 0, gapWidth: 5 } }, { colorAlpha: [.76, .94], itemStyle: { borderWidth: 3, gapWidth: 3 } }, { itemStyle: { borderWidth: 2, gapWidth: 2 } }], data: tree }];
  }
  if (settings.zoom === true && ['multiLine', 'stacked', 'combo', 'scatter', 'heatmap'].includes(config.type)) option.dataZoom = [{ id: 'inside', type: 'inside', filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, preventDefaultMouseMove: false }];
  const sample = shownRows.slice(0, 5).map((row, i) => {
    if (config.type === 'scatter') return `${rowName(row, i)}，${settings.xName || 'X'} ${formatWidgetNumber(row.x)}，${settings.yName || 'Y'} ${formatWidgetNumber(row.y)}`;
    if (config.type === 'heatmap') return `${label(row.x)} / ${label(row.y)} ${formatWidgetNumber(row.value)}`;
    if (config.type === 'combo') return `${rowCategory(row, i, true)}，${settings.primaryName || '主指标'} ${formatWidgetNumber(row.value)}，${settings.secondaryName || '辅助指标'} ${formatWidgetNumber(row.value2)}`;
    return `${label(row.series) ? `${label(row.series)} · ` : ''}${rowName(row, i)} ${formatWidgetNumber(row.value)}`;
  }).join('；');
  const description = `${config.title}，${pointCount} 个数据点${unit ? `，单位 ${unit}` : ''}。${sample}`;
  option.aria.label.description = description;
  return { option, count: pointCount, renderCount: renderCount ?? pointCount, description };
}
