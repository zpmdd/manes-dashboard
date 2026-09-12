import { CONFIG_FILE_LIMIT, DEFAULT_CONFIG, MODULE_TYPES, SOURCES, normalizeConfig } from './dashboardConfig.js';

export const TEMPLATE_STORAGE_KEY = 'nexus.dashboard.templates.v1';
export const TEMPLATE_LIMIT = 10;

function templateName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[<>\u0000-\u001f\u007f]/.test(value)) throw new Error('模板名称需为 1–40 个纯文字字符');
  return value.trim();
}

export function readTemplates(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(TEMPLATE_STORAGE_KEY);
    if (!saved) return [];
    if (saved.length > (CONFIG_FILE_LIMIT + 1024) * TEMPLATE_LIMIT) throw new Error('模板库超过大小限制');
    const parsed = JSON.parse(saved);
    if (parsed?.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > TEMPLATE_LIMIT) throw new Error('模板库格式不正确');
    const ids = new Set();
    return parsed.items.map(item => {
      if (!item || typeof item.id !== 'string' || !/^template-[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('模板记录格式不正确');
      ids.add(item.id);
      return { id: item.id, name: templateName(item.name), createdAt: item.createdAt, config: normalizeConfig(item.config) };
    });
  } catch (issue) { throw new Error(`模板库无法读取：${issue.message || '浏览器存储不可用'}`); }
}

function writeTemplates(items, storage) {
  try { (storage ?? globalThis.localStorage).setItem(TEMPLATE_STORAGE_KEY, JSON.stringify({ version: 1, items })); }
  catch { throw new Error('模板未保存：浏览器存储不可用或空间不足'); }
  return items;
}

export function saveTemplate(name, config, storage) {
  const next = { name: templateName(name), config: normalizeConfig(config) };
  const items = readTemplates(storage);
  if (items.length >= TEMPLATE_LIMIT) throw new Error(`最多保存 ${TEMPLATE_LIMIT} 个模板，请先删除不需要的模板`);
  const id = `template-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  return writeTemplates([{ id, ...next, createdAt: new Date().toISOString() }, ...items], storage);
}

export function deleteTemplate(id, storage) {
  const items = readTemplates(storage);
  if (!items.some(item => item.id === id)) throw new Error('模板已不存在，请重新打开模板库');
  return writeTemplates(items.filter(item => item.id !== id), storage);
}

export function parseTemplateFile(content) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > CONFIG_FILE_LIMIT) throw new Error(`配置文件不能超过 ${Math.round(CONFIG_FILE_LIMIT / 1024)} KB`);
  try { return normalizeConfig(JSON.parse(content)); }
  catch (issue) { throw new Error(issue instanceof SyntaxError ? '文件不是有效的 JSON 配置' : issue.message); }
}

export function serializeTemplate(config) {
  const normalized = normalizeConfig(config), content = JSON.stringify(normalized, null, 2);
  return new TextEncoder().encode(content).length <= CONFIG_FILE_LIMIT ? content : JSON.stringify(normalized);
}

export function getBuiltinTemplates() {
  const baseline = normalizeConfig(DEFAULT_CONFIG);
  const sides = structuredClone(baseline);
  sides.map.layout = { x: 23, y: 0, w: 54, h: 74 };
  const sideLayouts = [{ x: 0, y: 0, w: 22, h: 36 }, { x: 0, y: 38, w: 22, h: 36 }, { x: 78, y: 0, w: 22, h: 36 }, { x: 78, y: 38, w: 22, h: 36 }, { x: 0, y: 76, w: 100, h: 24 }];
  sides.modules.forEach((item, index) => { item.layout = sideLayouts[index]; });

  const analysis = structuredClone(baseline);
  analysis.title = '区域数据分析中心';
  analysis.map.layout = { x: 0, y: 0, w: 43, h: 64 };
  const analysisLayouts = [{ x: 44, y: 0, w: 27, h: 24 }, { x: 72, y: 0, w: 28, h: 24 }, { x: 44, y: 26, w: 56, h: 38 }, { x: 0, y: 66, w: 43, h: 34 }, { x: 44, y: 66, w: 56, h: 34 }];
  analysis.modules.forEach((item, index) => { item.layout = analysisLayouts[index]; });
  const ranking = analysis.modules[3];
  const type = MODULE_TYPES.find(item => item.id === 'column');
  if (type) {
    const source = type.sources.includes(ranking.source) ? ranking.source : type.sources[0];
    Object.assign(ranking, { type: 'column', source, unit: SOURCES[source].unit, columns: structuredClone(SOURCES[source].columns) });
  }
  return [
    { id: 'builtin-monitor', name: '运行总览', description: '侧栏指标 · 中心地图 · 底部业务', config: baseline },
    { id: 'builtin-sides', name: '双侧监测', description: '双侧指标 · 地图居中 · 通栏事件', config: normalizeConfig(sides) },
    { id: 'builtin-analysis', name: '数据分析', description: '区域地图 · 趋势对比 · 分布明细', config: normalizeConfig(analysis) },
  ];
}
