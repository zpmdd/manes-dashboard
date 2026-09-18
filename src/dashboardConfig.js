import { NAME_GROUP_TYPES, DATA_FIELDS, normalizeDataSource, validateDataPath, parseSourceContent } from './dataSources.js';
import { DEFAULT_THEME, THEMES } from './themes.js';
import { DEFAULT_FONT, FONTS } from './fonts.js';
import baseProject from './projects/base.js';
import { SERIES_TYPES } from './widgetData.js';

export const STORAGE_KEY = 'manes.dashboard.base.config.v2';
export const LEGACY_STORAGE_KEYS = ['nexus.dashboard.config.v2', 'nexus.dashboard.config.v1'];
export const projectStorageKey = (project, type = 'config.v2') => {
  if (!['base', 'daoyan'].includes(project.id)) throw new Error('未知项目');
  return `manes.dashboard.${project.id}.${type}`;
};
export const CONFIG_FILE_LIMIT = 2 * 1024 * 1024;

export const SOURCES = {
  devices: { label: '设备接入', unit: '台', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '接入设备' }, { key: 'status', label: '状态' }] },
  online: { label: '设备在线率', unit: '%', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '在线率' }, { key: 'status', label: '状态' }] },
  flow: { label: '数据流量', unit: 'GB', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '数据流量' }] },
  trend: { label: '流量时序', unit: 'GB', columns: [{ key: 'time', label: '时点' }, { key: 'value', label: '数据流量' }] },
  regions: { label: '区域设备分布', unit: '台', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '接入设备' }, { key: 'status', label: '状态' }] },
  events: { label: '运行事件', unit: '条', columns: [{ key: 'time', label: '发生时间' }, { key: 'name', label: '事件内容' }, { key: 'status', label: '处理状态' }] },
  seriesTrend: { label: '多区域流量', unit: 'GB', columns: [{ key: 'time', label: '时间' }, { key: 'series', label: '区域' }, { key: 'value', label: '流量' }] },
  comparison: { label: '接入量与在线率', unit: '台', columns: [{ key: 'name', label: '区域' }, { key: 'value', label: '设备数' }, { key: 'value2', label: '在线率' }] },
  dimensions: { label: '运行能力评估', unit: '分', columns: [{ key: 'name', label: '维度' }, { key: 'series', label: '对象' }, { key: 'value', label: '评分' }, { key: 'target', label: '上限' }] },
  scatter: { label: '负载与时延', unit: '台', columns: [{ key: 'name', label: '节点' }, { key: 'x', label: '负载' }, { key: 'y', label: '时延' }, { key: 'value', label: '设备数' }] },
  heat: { label: '时段活跃度', unit: '次', columns: [{ key: 'x', label: '时段' }, { key: 'y', label: '区域' }, { key: 'value', label: '活跃度' }] },
  funnel: { label: '事件处理流程', unit: '条', columns: [{ key: 'name', label: '阶段' }, { key: 'value', label: '事件数' }] },
  tree: { label: '设备类型分布', unit: '台', columns: [{ key: 'name', label: '类型' }, { key: 'series', label: '分组' }, { key: 'value', label: '设备数' }] },
  samples: { label: '分班次响应耗时', unit: 'ms', columns: [{ key: 'name', label: '班次' }, { key: 'value', label: '响应耗时' }] },
  changes: { label: '收支增减', unit: '万元', columns: [{ key: 'name', label: '项目' }, { key: 'value', label: '变动金额' }] },
};

export const MODULE_TYPES = [
  { id: 'metric', label: '指标卡', sources: ['devices', 'online', 'flow'] },
  { id: 'gauge', label: '仪表盘', sources: ['online'] },
  { id: 'line', label: '折线图', sources: ['trend'] },
  { id: 'bar', label: '条形图', sources: ['regions'] },
  { id: 'donut', label: '环形图', sources: ['regions', 'tree'] },
  { id: 'pie', label: '饼图', sources: ['regions', 'tree'] },
  { id: 'table', label: '数据表格', sources: Object.keys(SOURCES) },
  { id: 'area', label: '面积图', sources: ['trend'] },
  { id: 'column', label: '柱状图', sources: ['regions', 'trend'] },
  { id: 'progress', label: '目标进度', sources: ['online', 'devices'] },
  { id: 'status', label: '状态矩阵', sources: ['events', 'devices'] },
  { id: 'text', label: '文本公告', sources: ['devices'] },
  { id: 'clock', label: '数字时钟', sources: ['devices'] },
  { id: 'multiLine', label: '多系列折线', sources: ['seriesTrend'] },
  { id: 'stacked', label: '堆叠柱状图', sources: ['seriesTrend'] },
  { id: 'combo', label: '双轴组合图', sources: ['comparison'] },
  { id: 'radar', label: '雷达图', sources: ['dimensions'] },
  { id: 'scatter', label: '散点气泡图', sources: ['scatter'] },
  { id: 'heatmap', label: '矩阵热力图', sources: ['heat'] },
  { id: 'funnel', label: '漏斗图', sources: ['funnel'] },
  { id: 'treemap', label: '矩形树图', sources: ['tree'] },
  { id: 'rose', label: '玫瑰图', sources: ['tree', 'regions'] },
  { id: 'groupedColumn', label: '分组柱状图', sources: ['seriesTrend'] },
  { id: 'stackedArea', label: '堆叠面积图', sources: ['seriesTrend'] },
  { id: 'percentStacked', label: '百分比堆叠图', sources: ['seriesTrend'] },
  { id: 'histogram', label: '直方图', sources: ['samples'] },
  { id: 'boxplot', label: '箱线图', sources: ['samples'] },
  { id: 'waterfall', label: '瀑布图', sources: ['changes'] },
];

const LEGACY_CONFIG = {
  version: 1,
  brand: 'MANES',
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
const moduleIds = LEGACY_CONFIG.modules.map(module => module.id);

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

function brand(value) {
  const result = text(value, 16, '品牌名称');
  return /^nexus$/i.test(result) ? 'MANES' : result;
}

function normalizeLegacy(raw) {
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
    brand: brand(raw.brand),
    title: text(raw.title, 36, '大屏标题'),
    mapTitle: text(raw.mapTitle, 24, '地图标题'),
    navLabels: raw.navLabels.map(label => text(label, 8, '导航名称')),
    showClock: raw.showClock,
    modules: moduleIds.map(id => modules.find(module => module.id === id)),
  };
}

const DEFAULT_LAYOUTS = [
  { x: 0, y: 0, w: 19, h: 32 }, { x: 0, y: 34, w: 19, h: 32 },
  { x: 0, y: 68, w: 19, h: 32 }, { x: 20, y: 75, w: 39.5, h: 25 }, { x: 60.5, y: 75, w: 39.5, h: 25 },
];
export const DEFAULT_CHART_OPTIONS = { legend: true, labels: false, zoom: false, smooth: true, palette: 'champagne', secondaryUnit: '', primaryName: '主指标', secondaryName: '辅助指标', xName: '', yName: '' };
const defaultFields = () => Object.fromEntries(DATA_FIELDS.map(key => [key, key]));
function upgrade(config) {
  return { ...config, version: 2, projectId: 'base', theme: DEFAULT_THEME.id, font: DEFAULT_FONT.id, canvas: { snap: true, grid: 1, magnet: true, threshold: 6 },
    map: { layout: { x: 20, y: 0, w: 80, h: 74 }, visible: true, locked: false, vehicleSourceId: '' }, dataSources: [],
    modules: config.modules.map((item, i) => ({ ...item, layout: { ...DEFAULT_LAYOUTS[i] }, locked: false,
      surface: i === 2 ? 'solid' : 'glass', binding: { sourceId: 'demo', fields: defaultFields() }, aggregate: 'sum', text: '', target: 100, precision: 1, chartOptions: { ...DEFAULT_CHART_OPTIONS } })),
  };
}
export const DEFAULT_CONFIG = upgrade(LEGACY_CONFIG);

export function createModule(typeId, existing = []) {
  const type = MODULE_TYPES.find(item => item.id === typeId);
  if (!type) throw new Error('不支持的组件类型');
  if (existing.length >= 40) throw new Error('每个画布最多添加 40 个组件');
  const source = type.sources[0];
  const offset = existing.length % 7 * 3;
  return { id: `w_${crypto.randomUUID()}`, title: type.label, subtitle: '', type: type.id, source,
    unit: SOURCES[source].unit, visible: true, locked: false, rowCount: typeId === 'scatter' ? 30 : [...SERIES_TYPES, 'heatmap', 'treemap', 'rose', 'histogram'].includes(typeId) ? 8 : 5, columns: SOURCES[source].columns.map(column => ({ ...column })),
    layout: { x: 24 + offset, y: 12 + offset, w: 28, h: 32 }, surface: 'glass',
    binding: { sourceId: 'demo', fields: defaultFields() }, aggregate: 'sum', text: typeId === 'text' ? '请输入公告内容' : '', target: 100, precision: 1, chartOptions: { ...DEFAULT_CHART_OPTIONS, ...(typeId === 'combo' ? { primaryName: '设备数', secondaryName: '在线率', secondaryUnit: '%' } : typeId === 'scatter' ? { xName: '负载 (%)', yName: '时延 (ms)' } : {}) } };
}

function flag(value, label) { if (typeof value !== 'boolean') throw new Error(`${label}格式不正确`); return value; }
function range(value, min, max, label) { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}需在 ${min}–${max} 之间`); return value; }
function layout(value) {
  object(value, ['x', 'y', 'w', 'h'], '组件位置');
  const result = { x: range(value.x, 0, 90, 'X 位置'), y: range(value.y, 0, 90, 'Y 位置'), w: range(value.w, 10, 100, '宽度'), h: range(value.h, 10, 100, '高度') };
  if (result.x + result.w > 100.001 || result.y + result.h > 100.001) throw new Error('组件位置不能超出画布');
  return result;
}
function normalizeChartOptions(input) {
  const keys = Object.keys(DEFAULT_CHART_OPTIONS);
  if (input !== undefined) object(input, keys.filter(key => Object.hasOwn(input ?? {}, key)), '图表选项');
  const value = { ...DEFAULT_CHART_OPTIONS, ...input };
  if (!['champagne', 'ocean', 'forest'].includes(value.palette)) throw new Error('不支持的图表配色');
  return { legend: flag(value.legend, '图例开关'), labels: flag(value.labels, '标签开关'), zoom: flag(value.zoom, '缩放开关'), smooth: flag(value.smooth, '平滑开关'), palette: value.palette,
    secondaryUnit: text(value.secondaryUnit, 8, '副轴单位', true), primaryName: text(value.primaryName, 20, '主系列名称'), secondaryName: text(value.secondaryName, 20, '副系列名称'), xName: text(value.xName, 20, 'X 轴名称', true), yName: text(value.yName, 20, 'Y 轴名称', true) };
}
export function normalizeConfig(raw) {
  if (raw?.version === 1) return upgrade(normalizeLegacy(raw));
  object(raw, [...configKeys, 'canvas', 'map', 'dataSources', ...['theme', 'font', 'projectId'].filter(key => Object.hasOwn(raw ?? {}, key))], '配置');
  if (raw.version !== 2) throw new Error('不支持此配置版本');
  const projectId = Object.hasOwn(raw, 'projectId') ? raw.projectId : 'base';
  if (!['base', 'daoyan'].includes(projectId)) throw new Error('未知项目');
  const theme = Object.hasOwn(raw, 'theme') ? raw.theme : DEFAULT_THEME.id;
  if (!THEMES.some(item => item.id === theme)) throw new Error('不支持的大屏配色');
  const font = Object.hasOwn(raw, 'font') ? raw.font : DEFAULT_FONT.id;
  if (!FONTS.some(item => item.id === font)) throw new Error('不支持的中文字体');
  if (!Array.isArray(raw.navLabels) || raw.navLabels.length !== 4) throw new Error('需配置四个导航名称');
  const canvas = { magnet: true, threshold: 6, ...raw.canvas };
  object(raw.canvas, ['snap', 'grid', ...['magnet', 'threshold'].filter(key => Object.hasOwn(raw.canvas ?? {}, key))], '画布');
  object(raw.map, ['layout', 'visible', 'locked', ...(Object.hasOwn(raw.map ?? {}, 'vehicleSourceId') ? ['vehicleSourceId'] : [])], '地图');
  if (!Array.isArray(raw.dataSources) || raw.dataSources.length > 40) throw new Error('最多配置 40 个数据源');
  const sourceIds = new Set();
  const dataSources = raw.dataSources.map(input => {
    const source = normalizeDataSource(input);
    if (sourceIds.has(source.id)) throw new Error('数据源标识重复');
    sourceIds.add(source.id);
    if (source.type !== 'http') parseSourceContent(source.content, source.type, source.rowsPath);
    return source;
  });
  const vehicleSourceId = raw.map.vehicleSourceId ?? '';
  if (typeof vehicleSourceId !== 'string' || (vehicleSourceId && !sourceIds.has(vehicleSourceId))) throw new Error('车辆地图绑定的数据源不存在');
  if (!Array.isArray(raw.modules) || raw.modules.length > 40) throw new Error('最多配置 40 个组件');
  const seen = new Set();
  const modules = raw.modules.map(item => {
    object(item, [...moduleKeys, 'layout', 'locked', 'surface', 'binding', 'aggregate', 'text', 'target', ...['chartOptions', 'precision'].filter(key => Object.hasOwn(item, key))], '组件');
    const chartOptions = normalizeChartOptions(item.chartOptions);
    const precision = Object.hasOwn(item, 'precision') ? item.precision : 1;
    if (!Number.isInteger(precision) || precision < 0 || precision > 3) throw new Error('小数位数需为 0–3 的整数');
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || item.id === 'map' || seen.has(item.id)) throw new Error('组件标识不正确或重复');
    seen.add(item.id);
    const type = MODULE_TYPES.find(entry => entry.id === item.type);
    if (!type || !type.sources.includes(item.source)) throw new Error('图表类型与示例数据不兼容');
    object(item.binding, ['sourceId', 'fields', ...(Object.hasOwn(item.binding ?? {}, 'groupBy') ? ['groupBy'] : [])], '数据绑定');
    if (Object.hasOwn(item.binding, 'groupBy') && (item.binding.groupBy !== 'name' || !NAME_GROUP_TYPES.includes(item.type) || item.binding.sourceId === 'demo')) throw new Error('按名称合并仅适用于外部数据的条形图、柱状图、饼图、环形图和玫瑰图');
    if (item.binding.sourceId !== 'demo' && !sourceIds.has(item.binding.sourceId)) throw new Error('组件绑定的数据源不存在');
    const fields = item.binding.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !DATA_FIELDS.includes(key))) throw new Error('字段映射格式不正确');
    const normalizedFields = Object.fromEntries(Object.entries(fields).map(([key, path]) => [key, validateDataPath(path)]));
    const available = item.binding.sourceId === 'demo' ? SOURCES[item.source].columns.map(column => column.key) : DATA_FIELDS;
    if (!Array.isArray(item.columns) || !item.columns.length || item.columns.length > available.length) throw new Error('需选择至少一个有效表格列');
    const used = new Set();
    const columns = item.columns.map(column => {
      object(column, ['key', 'label'], '表格列');
      if (!available.includes(column.key) || used.has(column.key)) throw new Error('表格列字段不正确或重复');
      used.add(column.key); return { key: column.key, label: text(column.label, 12, '列名称') };
    });
    if (!Number.isInteger(item.rowCount) || item.rowCount < 1 || item.rowCount > 100) throw new Error('显示条数需为 1–100 的整数');
    if (!['glass', 'soft', 'solid'].includes(item.surface)) throw new Error('不支持的面板材质');
    if (!['sum', 'average', 'first'].includes(item.aggregate)) throw new Error('不支持的汇总方式');
    if (typeof item.text !== 'string' || item.text.length > 1000 || /[<>\u0000-\u0008\u000b-\u001f\u007f]/.test(item.text)) throw new Error('公告需为 1000 字以内的纯文字');
    return { id: item.id, title: text(item.title, 20, '组件标题'), subtitle: text(item.subtitle, 40, '副标题', true),
      type: item.type, source: item.source, visible: flag(item.visible, '显示开关'), unit: text(item.unit, 8, '单位', true), rowCount: item.rowCount, columns,
      layout: layout(item.layout), locked: flag(item.locked, '锁定开关'), surface: item.surface,
      binding: { sourceId: item.binding.sourceId, fields: normalizedFields, ...(item.binding.groupBy ? { groupBy: item.binding.groupBy } : {}) }, aggregate: item.aggregate, text: item.text, target: range(item.target, .1, 1e12, '目标值'), precision, chartOptions };
  });
  const config = { version: 2, projectId, theme, font, brand: brand(raw.brand), title: text(raw.title, 36, '大屏标题'), mapTitle: text(raw.mapTitle, 24, '地图标题'),
    navLabels: raw.navLabels.map(label => text(label, 8, '导航名称')), showClock: flag(raw.showClock, '时钟开关'),
    canvas: { snap: flag(canvas.snap, '网格开关'), grid: range(canvas.grid, .5, 5, '网格步长'), magnet: flag(canvas.magnet, '磁吸开关'), threshold: range(canvas.threshold, 2, 16, '磁吸距离') },
    map: { layout: layout(raw.map.layout), visible: flag(raw.map.visible, '地图开关'), locked: flag(raw.map.locked, '地图锁定'), vehicleSourceId }, modules, dataSources };
  if (new TextEncoder().encode(JSON.stringify(config)).byteLength > CONFIG_FILE_LIMIT) throw new Error('配置内容不能超过 2 MB');
  return config;
}

// Only known legacy signatures are assigned automatically; unknown canvases stay recoverable.
export function legacyProject(raw) {
  if (raw?.projectId) return raw.projectId;
  if (raw?.dataSources?.some(source => ['ds_8b34a2de-317b-4b63-bc0c-f991459e5fce', 'ds_596c6afe-bdd9-45b7-a209-2ab6ce05910b'].includes(source.id))) return 'daoyan';
  if (raw?.version === 1 || (raw?.dataSources?.length === 0 && raw?.modules?.every(item => item.binding?.sourceId === 'demo'))) return 'base';
  return null;
}

export function configForProject(raw, project = baseProject) {
  projectStorageKey(project);
  const owner = raw?.projectId || legacyProject(raw);
  if (owner && owner !== project.id) throw new Error(`此画布属于 ${owner === 'daoyan' ? '道研版' : '基线版'}，请在对应项目中导入`);
  const config = normalizeConfig(raw);
  config.projectId = project.id;
  if (!project.vehicles && config.map.vehicleSourceId) throw new Error('当前项目未启用车辆功能');
  // Upgrade the two former vehicle snapshots to one source, preserving the saved card layout.
  if (project.vehicles && !Object.hasOwn(raw.map ?? {}, 'vehicleSourceId')) {
    const oldSource = config.dataSources.find(source => source.id === 'ds_8b34a2de-317b-4b63-bc0c-f991459e5fce');
    if (oldSource) {
      config.map.vehicleSourceId = oldSource.id;
      for (const item of config.modules) if (item.binding.sourceId === 'ds_596c6afe-bdd9-45b7-a209-2ab6ce05910b' && NAME_GROUP_TYPES.includes(item.type)) {
        item.binding = { sourceId: oldSource.id, fields: { name: 'status', value: 'count', code: 'stateCode' }, groupBy: 'name' };
      }
      if (!config.modules.some(item => item.binding.sourceId === 'ds_596c6afe-bdd9-45b7-a209-2ab6ce05910b')) config.dataSources = config.dataSources.filter(source => source.id !== 'ds_596c6afe-bdd9-45b7-a209-2ab6ce05910b');
    }
  }
  return normalizeConfig(config);
}

export function defaultConfigForProject(project = baseProject) {
  return configForProject(project.preset || DEFAULT_CONFIG, project);
}

export function readLegacyConfig(storage = globalThis.localStorage) {
  const saved = LEGACY_STORAGE_KEYS.map(key => storage.getItem(key)).find(value => value !== null && value !== undefined);
  if (saved === undefined) return null;
  if (saved.length > CONFIG_FILE_LIMIT) throw new Error('旧画布超过大小限制');
  return JSON.parse(saved);
}

export function loadConfig(project = baseProject) {
  try {
    const saved = localStorage.getItem(projectStorageKey(project));
    if (saved !== null && saved !== undefined) {
      if (saved.length > CONFIG_FILE_LIMIT) throw new Error('画布超过大小限制');
      return configForProject(JSON.parse(saved), project);
    }
    const legacy = readLegacyConfig();
    if (legacy && legacyProject(legacy) === project.id) return configForProject(legacy, project);
  } catch { /* Preserve invalid saved bytes, including the original legacy keys. */ }
  return defaultConfigForProject(project);
}

export function saveConfig(config, project = baseProject) {
  const next = configForProject(config, project);
  try { localStorage.setItem(projectStorageKey(project), JSON.stringify(next)); }
  catch { throw new Error('配置未保存：当前浏览器存储不可用或空间不足'); }
  return next;
}
