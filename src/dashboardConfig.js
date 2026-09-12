export const STORAGE_KEY = 'nexus.dashboard.config.v1';
export const CONFIG_FILE_LIMIT = 64 * 1024;

export const SOURCES = {
  devices: { label: '设备接入', unit: '台', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '接入设备' }, { key: 'status', label: '状态' }] },
  online: { label: '设备在线率', unit: '%', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '在线率' }, { key: 'status', label: '状态' }] },
  flow: { label: '数据流量', unit: 'GB', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '数据流量' }] },
  trend: { label: '流量时序', unit: 'GB', columns: [{ key: 'time', label: '时点' }, { key: 'value', label: '数据流量' }] },
  regions: { label: '区域设备分布', unit: '台', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '接入设备' }, { key: 'status', label: '状态' }] },
  events: { label: '运行事件', unit: '条', columns: [{ key: 'time', label: '发生时间' }, { key: 'name', label: '事件内容' }, { key: 'status', label: '处理状态' }] },
};

export const MODULE_TYPES = [
  { id: 'metric', label: '指标卡', sources: ['devices', 'online', 'flow'] },
  { id: 'gauge', label: '仪表盘', sources: ['online'] },
  { id: 'line', label: '折线图', sources: ['trend'] },
  { id: 'bar', label: '条形图', sources: ['regions'] },
  { id: 'donut', label: '环形图', sources: ['regions'] },
  { id: 'table', label: '数据表格', sources: Object.keys(SOURCES) },
];

export const DEFAULT_CONFIG = {
  version: 1,
  brand: 'NEXUS',
  title: '全域运行监测中心',
  mapTitle: '区域运行态势',
  navLabels: ['运行总览', '数据监测', '交通网络', '区域管理'],
  showClock: true,
  modules: [
    { id: 'devices', title: '设备接入总量', subtitle: '区域设备接入', type: 'metric', source: 'devices', visible: true, unit: '台', rowCount: 5, columns: SOURCES.devices.columns },
    { id: 'online', title: '设备在线率', subtitle: '区域设备运行状态', type: 'gauge', source: 'online', visible: true, unit: '%', rowCount: 5, columns: SOURCES.online.columns },
    { id: 'trend', title: '数据流量趋势', subtitle: '分时流量监测', type: 'line', source: 'trend', visible: true, unit: 'GB', rowCount: 8, columns: SOURCES.trend.columns },
    { id: 'ranking', title: '区域接入排名', subtitle: '区域设备分布', type: 'bar', source: 'regions', visible: true, unit: '台', rowCount: 5, columns: SOURCES.regions.columns },
    { id: 'events', title: '运行事件', subtitle: '最新监测记录', type: 'table', source: 'events', visible: true, unit: '条', rowCount: 5, columns: SOURCES.events.columns },
  ],
};

const configKeys = ['version', 'brand', 'title', 'mapTitle', 'navLabels', 'showClock', 'modules'];
const moduleKeys = ['id', 'title', 'subtitle', 'type', 'source', 'visible', 'unit', 'rowCount', 'columns'];
const moduleIds = DEFAULT_CONFIG.modules.map(module => module.id);

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}格式不正确`);
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`${label}包含未知字段或缺少必要字段`);
}

function text(value, max, label, optional = false) {
  if (typeof value !== 'string') throw new Error(`${label}必须为文字`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) throw new Error(`${label}${optional ? '最多' : '需填写 1–'}${max} 个字`);
  if (/[<>\u0000-\u001f\u007f]/.test(result) || /(?:javascript\s*:|data\s*:\s*text\/html)/i.test(result)) throw new Error(`${label}仅支持纯文字`);
  return result;
}

export function normalizeConfig(raw) {
  object(raw, configKeys, '配置');
  if (raw.version !== 1) throw new Error('不支持此配置版本');
  if (typeof raw.showClock !== 'boolean') throw new Error('时钟开关格式不正确');
  if (!Array.isArray(raw.navLabels) || raw.navLabels.length !== 4) throw new Error('需配置四个导航名称');
  if (!Array.isArray(raw.modules) || raw.modules.length !== moduleIds.length) throw new Error('需保留全部五个模块，可通过开关隐藏');
  const seen = new Set();
  const modules = raw.modules.map(module => {
    object(module, moduleKeys, '模块');
    if (!moduleIds.includes(module.id) || seen.has(module.id)) throw new Error('模块标识不正确或重复');
    seen.add(module.id);
    const type = MODULE_TYPES.find(item => item.id === module.type);
    if (!type || !type.sources.includes(module.source)) throw new Error('图表类型与数据源不兼容');
    if (typeof module.visible !== 'boolean') throw new Error('模块显示开关格式不正确');
    if (!Number.isInteger(module.rowCount) || module.rowCount < 3 || module.rowCount > 8) throw new Error('显示条数需为 3–8 的整数');
    const available = SOURCES[module.source].columns;
    if (!Array.isArray(module.columns) || !module.columns.length || module.columns.length > available.length) throw new Error('需选择至少一个有效表格列');
    const usedColumns = new Set();
    const columns = module.columns.map(column => {
      object(column, ['key', 'label'], '表格列');
      if (!available.some(item => item.key === column.key) || usedColumns.has(column.key)) throw new Error('表格列字段不正确或重复');
      usedColumns.add(column.key);
      return { key: column.key, label: text(column.label, 12, '列名称') };
    });
    const unit = text(module.unit, 8, '单位', true);
    if (module.type === 'gauge' && unit !== '%') throw new Error('在线率仪表盘单位需为 %');
    return { id: module.id, title: text(module.title, 20, '模块标题'), subtitle: text(module.subtitle, 40, '模块副标题', true), type: module.type, source: module.source, visible: module.visible, unit, rowCount: module.rowCount, columns };
  });
  return {
    version: 1,
    brand: text(raw.brand, 16, '品牌名称'),
    title: text(raw.title, 36, '大屏标题'),
    mapTitle: text(raw.mapTitle, 24, '地图标题'),
    navLabels: raw.navLabels.map(label => text(label, 8, '导航名称')),
    showClock: raw.showClock,
    modules: moduleIds.map(id => modules.find(module => module.id === id)),
  };
}

export function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.length <= CONFIG_FILE_LIMIT) return normalizeConfig(JSON.parse(saved));
  } catch { /* Unavailable storage or invalid saved data falls back without overwriting it. */ }
  return normalizeConfig(DEFAULT_CONFIG);
}

export function saveConfig(config) {
  const next = normalizeConfig(config);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { throw new Error('配置未保存：当前浏览器存储不可用或空间不足'); }
  return next;
}
