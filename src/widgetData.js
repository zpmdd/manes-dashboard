import { demoMetrics, shortName } from './geo.js';

export const PROFESSIONAL_TYPES = ['multiLine', 'stacked', 'combo', 'radar', 'scatter', 'heatmap', 'funnel', 'treemap'];
export const SNAPSHOT_TIME = '09-12 09:00';
const UNITS = { devices: '台', online: '%', flow: 'GB', trend: 'GB', regions: '台', events: '条', seriesTrend: 'GB', comparison: '台', dimensions: '分', scatter: '台', heat: '次', funnel: '条', tree: '台' };
const TREND_FACTORS = [.52, .61, .57, .73, .69, .84, .92, 1];
const EVENT_NAMES = ['采集链路延迟', '设备心跳超时', '数据上报恢复', '节点连接恢复', '网络延迟偏高', '设备连接恢复', '采集周期异常', '节点心跳恢复'];

// 固定演示快照：子区域份额只用于当前视图，按最大余数法保持合计与总设备数一致。
function regionRows(code, index, total) {
  const children = Object.entries(index).filter(([id, region]) => id !== code && region.parent === code);
  const weight = children.reduce((sum, [id]) => sum + demoMetrics(id).devices, 0);
  const rows = children.map(([id, region]) => {
    const exact = total * demoMetrics(id).devices / weight;
    return { code: id, name: shortName(region.name), value: Math.floor(exact), remainder: exact % 1, status: '已接入', time: SNAPSHOT_TIME };
  });
  const remaining = total - rows.reduce((sum, row) => sum + row.value, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.code.localeCompare(b.code)).slice(0, remaining).forEach(row => { row.value += 1; });
  return rows.sort((a, b) => b.value - a.value || a.code.localeCompare(b.code)).map(({ remainder, ...row }) => row);
}

export function getWidgetData(source, code, index) {
  const empty = { rows: [], value: null, unit: UNITS[source] || '', emptyMessage: index ? '暂无可用数据' : '正在读取区域数据' };
  if (!index?.[code] || !Object.hasOwn(UNITS, source)) return empty;
  const metrics = demoMetrics(code), scope = shortName(index[code].name === '中国' ? '全国' : index[code].name);
  const seed = Number(code), onlineCount = Math.round(metrics.devices * Number(metrics.online) / 100);
  const row = { name: scope, value: Number(metrics[source]), status: '已统计', time: SNAPSHOT_TIME };
  const groups = ['东区', '南区', '西区'];
  let professionalRows;
  if (source === 'seriesTrend') professionalRows = TREND_FACTORS.flatMap((factor, i) => groups.map((series, j) => ({ name: `${String(i + 2).padStart(2, '0')}:00`, time: `${String(i + 2).padStart(2, '0')}:00`, series, value: Number((metrics.flow * factor * (.22 + j * .11) * (1 + (i + j) % 3 * .04)).toFixed(1)) })));
  if (source === 'comparison') professionalRows = ['东区', '南区', '西区', '北区', '中心'].map((name, i) => ({ name, value: Math.round(metrics.devices * (.08 + i * .02)), value2: 94 + (seed + i * 7) % 59 / 10 }));
  if (source === 'dimensions') professionalRows = ['接入覆盖', '在线稳定', '传输效率', '响应速度', '处理及时'].flatMap((name, i) => ['本期', '上期'].map((series, j) => ({ name, series, value: 65 + (seed + i * 13 + j * 7) % 34, target: 100 })));
  if (source === 'scatter') professionalRows = Array.from({ length: 30 }, (_, i) => ({ name: `节点 ${String(i + 1).padStart(2, '0')}`, series: groups[i % 3], x: 18 + (seed + i * 17) % 78, y: 14 + (seed + i * 11) % 62, value: 30 + (seed + i * 31) % 140 }));
  if (source === 'heat') professionalRows = groups.flatMap((y, j) => Array.from({ length: 8 }, (_, i) => ({ x: `${String(i + 2).padStart(2, '0')}:00`, y, value: 20 + (seed + i * 17 + j * 29) % 80 })));
  if (source === 'funnel') professionalRows = ['采集事件', '有效事件', '已分派', '已处理', '已归档'].map((name, i) => ({ name, value: Math.round(1200 * [1, .85, .72, .6, .49][i]) }));
  if (source === 'tree') professionalRows = ['采集器', '网关', '传感器', '控制器', '终端', '监测点', '交换机', '接入点'].map((name, i) => ({ name, series: groups[i % 3], value: Math.round(metrics.devices * (.03 + (i + seed) % 7 * .015)) }));
  if (professionalRows) return { ...empty, rows: professionalRows, value: professionalRows.reduce((sum, entry) => sum + entry.value, 0), scope };
  if (source === 'regions') {
    return { ...empty, rows: regionRows(code, index, metrics.devices), value: metrics.devices, scope, emptyMessage: '当前区域暂无下级区域' };
  }
  if (source === 'trend') {
    const rows = TREND_FACTORS.map((factor, i) => {
      const time = `${String(i + 2).padStart(2, '0')}:00`;
      return { name: time, time, value: Number((metrics.flow * factor).toFixed(1)), status: '已统计' };
    });
    return { ...empty, rows, value: rows.at(-1).value, scope };
  }
  if (source === 'events') {
    const rows = EVENT_NAMES.map((name, i) => ({ name, value: 1, status: name.includes('恢复') ? '已恢复' : (i + seed) % 3 === 0 ? '待处理' : '已处理', time: `08:${String(59 - i * 6 - seed % 5).padStart(2, '0')}` }));
    return { ...empty, rows, value: rows.length, scope };
  }
  return { ...empty, rows: [row], value: row.value, scope, onlineCount, offlineCount: metrics.devices - onlineCount };
}

export function visibleRowCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(1, Math.min(100, Math.floor(count))) : 5;
}

export function donutRows(rows, count = 5) {
  const sorted = rows.filter(row => Number.isFinite(row.value) && row.value > 0).slice().sort((a, b) => b.value - a.value);
  const limit = visibleRowCount(count);
  if (sorted.length <= limit) return sorted;
  return [...sorted.slice(0, limit - 1), { name: '其他', value: sorted.slice(limit - 1).reduce((sum, row) => sum + row.value, 0) }];
}

export function sortTableRows(rows, direction) {
  if (!direction) return rows;
  return rows.slice().sort((a, b) => {
    const left = finiteNumber(a.value), right = finiteNumber(b.value);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return direction === 'ascending' ? left - right : right - left;
  });
}

export function finiteNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

const NUMBER_FORMATTERS = [];
export function formatWidgetNumber(value, precision = 1) {
  const numeric = finiteNumber(value);
  if (numeric === null) return '—';
  const digits = Math.max(0, Math.min(3, Math.floor(finiteNumber(precision) ?? 1)));
  const magnitude = Math.abs(numeric);
  const scientific = magnitude >= 1e12 || (magnitude > 0 && magnitude < 0.5 * 10 ** -digits), index = digits + (scientific ? 4 : 0);
  const formatter = NUMBER_FORMATTERS[index] ||= new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits, notation: scientific ? 'scientific' : 'standard' });
  return formatter.format(numeric);
}

const AXIS_NUMBER_FORMATTERS = [];
export function formatAxisNumber(value) {
  const numeric = finiteNumber(value);
  if (numeric === null) return '—';
  if (numeric === 0) return '0';
  const magnitude = Math.abs(numeric), scientific = magnitude < 1e-4 || magnitude >= 1e12, index = scientific ? 1 : 0;
  const formatter = AXIS_NUMBER_FORMATTERS[index] ||= new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 12, notation: scientific ? 'scientific' : 'standard' });
  return formatter.format(numeric);
}

// Every renderer receives the same shape; missing values remain missing instead of becoming zero.
export function normalizeWidgetData(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const rows = (Array.isArray(data.rows) ? data.rows : []).filter(row => row && typeof row === 'object').map(row => ({
    ...row, name: String(row.name ?? ''), time: String(row.time ?? ''), status: String(row.status ?? ''), value: finiteNumber(row.value), target: finiteNumber(row.target),
  }));
  return {
    ...data, rows, value: finiteNumber(data.value), unit: typeof data.unit === 'string' ? data.unit : '',
    scope: typeof data.scope === 'string' ? data.scope : '', onlineCount: finiteNumber(data.onlineCount), offlineCount: finiteNumber(data.offlineCount),
  };
}

export function chartDomain(rows) {
  const values = rows.map(row => finiteNumber(row.value)).filter(value => value !== null);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) return { min: 0, max: 1 };
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Math.abs(min), Math.abs(max))));
  const step = magnitude / 2;
  if (!step) return { min, max };
  return { min: Math.max(-Number.MAX_VALUE, Math.floor(min / step) * step), max: Math.min(Number.MAX_VALUE, Math.ceil(max / step) * step) };
}

export function progressValues(value, target = 100) {
  const current = finiteNumber(value), suppliedTarget = finiteNumber(target), goal = suppliedTarget !== null && suppliedTarget > 0 ? suppliedTarget : 100;
  return { value: current, target: goal, percent: current === null ? null : current / goal * 100, fill: current === null ? 0 : Math.max(0, Math.min(100, current / goal * 100)) };
}

export function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (/离线|故障|异常|失败|告警|超时|offline|error|critical|failed/.test(value)) return 'alert';
  if (/待处理|延迟|维护|预警|pending|warning|maintenance/.test(value)) return 'pending';
  return /在线|正常|恢复|处理|接入|统计|运行|完成|online|healthy|ready|success|ok/.test(value) ? 'normal' : 'neutral';
}
