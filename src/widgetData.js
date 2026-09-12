import { demoMetrics, shortName } from './geo.js';

export const SNAPSHOT_TIME = '09-12 09:00';
const UNITS = { devices: '台', online: '%', flow: 'GB', trend: 'GB', regions: '台', events: '条' };
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
  return Number.isFinite(count) ? Math.max(1, Math.min(10, Math.floor(count))) : 5;
}

export function donutRows(rows, count = 5) {
  const sorted = rows.filter(row => Number.isFinite(row.value) && row.value > 0).slice().sort((a, b) => b.value - a.value);
  const limit = visibleRowCount(count);
  if (sorted.length <= limit) return sorted;
  return [...sorted.slice(0, limit - 1), { name: '其他区域', value: sorted.slice(limit - 1).reduce((sum, row) => sum + row.value, 0) }];
}

export function sortTableRows(rows, direction) {
  return direction ? rows.slice().sort((a, b) => direction === 'ascending' ? a.value - b.value : b.value - a.value) : rows;
}
