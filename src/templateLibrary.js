import { CONFIG_FILE_LIMIT, DEFAULT_CONFIG, MODULE_TYPES, SOURCES, createModule, normalizeConfig, configForProject, defaultConfigForProject, legacyProject, projectStorageKey } from './dashboardConfig.js';

import baseProject from './projects/base.js';

export const TEMPLATE_STORAGE_KEY = 'manes.dashboard.base.templates.v1';
export const LEGACY_TEMPLATE_STORAGE_KEY = 'nexus.dashboard.templates.v1';
export const TEMPLATE_LIMIT = 10;

function templateName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[<>\u0000-\u001f\u007f]/.test(value)) throw new Error('模板名称需为 1–40 个纯文字字符');
  return value.trim();
}

function templateRecords(saved) {
  if (saved.length > (CONFIG_FILE_LIMIT + 1024) * TEMPLATE_LIMIT) throw new Error('模板库超过大小限制');
  const parsed = JSON.parse(saved);
  if (parsed?.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > TEMPLATE_LIMIT) throw new Error('模板库格式不正确');
  const ids = new Set();
  return parsed.items.map(item => {
    if (!item || typeof item.id !== 'string' || !/^template-[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('模板记录格式不正确');
    ids.add(item.id);
    return { id: item.id, name: templateName(item.name), createdAt: item.createdAt, config: item.config };
  });
}

export function readTemplates(storage, project = baseProject) {
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(projectStorageKey(project, 'templates.v1'));
    const items = saved == null ? readLegacyTemplates(storage).filter(item => legacyProject(item.config) === project.id) : templateRecords(saved);
    return items.map(item => ({ ...item, config: configForProject(item.config, project) }));
  } catch (issue) { throw new Error(`模板库无法读取：${issue.message || '浏览器存储不可用'}`); }
}

function writeTemplates(items, storage, project) {
  try { (storage ?? globalThis.localStorage).setItem(projectStorageKey(project, 'templates.v1'), JSON.stringify({ version: 1, items })); }
  catch { throw new Error('模板未保存：浏览器存储不可用或空间不足'); }
  return items;
}

export function saveTemplate(name, config, storage, project = baseProject) {
  const next = { name: templateName(name), config: configForProject(config, project) };
  const items = readTemplates(storage, project);
  if (items.length >= TEMPLATE_LIMIT) throw new Error(`最多保存 ${TEMPLATE_LIMIT} 个模板，请先删除不需要的模板`);
  const id = `template-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  return writeTemplates([{ id, ...next, createdAt: new Date().toISOString() }, ...items], storage, project);
}

export function deleteTemplate(id, storage, project = baseProject) {
  const items = readTemplates(storage, project);
  if (!items.some(item => item.id === id)) throw new Error('模板已不存在，请重新打开模板库');
  return writeTemplates(items.filter(item => item.id !== id), storage, project);
}

export function parseTemplateFile(content, project = baseProject) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > CONFIG_FILE_LIMIT) throw new Error(`配置文件不能超过 ${Math.round(CONFIG_FILE_LIMIT / 1024)} KB`);
  try { return configForProject(JSON.parse(content), project); }
  catch (issue) { throw new Error(issue instanceof SyntaxError ? '文件不是有效的 JSON 配置' : issue.message); }
}

export function serializeTemplate(config, project = baseProject) {
  const normalized = configForProject(config, project), content = JSON.stringify(normalized, null, 2);
  return new TextEncoder().encode(content).length <= CONFIG_FILE_LIMIT ? content : JSON.stringify(normalized);
}

export function getBuiltinTemplates(project = baseProject) {
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
  const professional = structuredClone(baseline);
  professional.title = '业务洞察中心';
  professional.map.layout = { x: 33, y: 0, w: 34, h: 60 };
  const professionalLayouts = [{ x: 0, y: 0, w: 32, h: 29 }, { x: 0, y: 31, w: 32, h: 29 }, { x: 68, y: 0, w: 32, h: 29 }, { x: 68, y: 31, w: 32, h: 29 }, { x: 0, y: 62, w: 49.5, h: 38 }, { x: 50.5, y: 62, w: 49.5, h: 38 }];
  professional.modules = ['multiLine', 'stacked', 'combo', 'radar', 'heatmap', 'treemap'].map((type, i) => ({ ...createModule(type), id: `insight-${type}`, title: { multiLine: '分区域流量趋势', stacked: '分时流量构成', combo: '设备接入与在线率', radar: '运行能力对比', heatmap: '区域活跃时段', treemap: '设备类型构成' }[type], layout: professionalLayouts[i] }));
  const templates = [
    { id: 'builtin-monitor', name: '运行总览', description: '侧栏指标 · 中心地图 · 底部业务', config: baseline },
    { id: 'builtin-sides', name: '双侧监测', description: '双侧指标 · 地图居中 · 通栏事件', config: normalizeConfig(sides) },
    { id: 'builtin-analysis', name: '数据分析', description: '区域地图 · 趋势对比 · 分布明细', config: normalizeConfig(analysis) },
    { id: 'builtin-professional', name: '业务洞察', description: '多系列趋势 · 双轴指标 · 时段热力', config: normalizeConfig(professional) },
  ];
  const result = templates.map(item => ({ ...item, config: configForProject({ ...item.config, projectId: project.id }, project) }));
  if (project.preset) result.unshift({ id: 'builtin-project', name: `${project.name}默认画布`, description: '恢复本项目初始布局和数据绑定', config: defaultConfigForProject(project) });
  return result;
}

export function readLegacyTemplates(storage = globalThis.localStorage) {
  const saved = (storage ?? globalThis.localStorage).getItem(LEGACY_TEMPLATE_STORAGE_KEY);
  if (saved == null) return [];
  return templateRecords(saved).map(item => { normalizeConfig(item.config); return item; });
}
