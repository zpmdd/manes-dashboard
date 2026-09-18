// 仅编辑面板使用的字段分析与组件建议，不进入大屏运行时依赖。
import { DATA_FIELDS, DATA_SIZE_LIMIT, getMappedData, loadSourcePayload, normalizeDataFields, parseCsv, readDataPath, strictDataNumber, validateDataPath, validateRows } from './dataSources.js';
import { buildProfessionalChart, PROFESSIONAL_TYPES } from './professionalCharts.js';

export function profileDataFields(rows) {
  const paths = new Set(), unsupported = new Set();
  const collect = (value, prefix = '', depth = 0) => {
    if (depth > 12 || !value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, cell] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (key.includes('.')) { paths.add(path); unsupported.add(path); continue; }
      if (cell && typeof cell === 'object' && !Array.isArray(cell) && Object.keys(cell).length) collect(cell, path, depth + 1);
      else paths.add(path);
    }
  };
  rows.forEach(row => collect(row));
  const observed = new Map([...paths].map(path => [path, []]));
  const gather = (value, prefix = '', depth = 0) => {
    if (depth > 12 || !value || typeof value !== 'object') return;
    // 数组的索引和 length 也可能由另一行的对象字段发现。
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!key || key.includes('.')) continue;
      const path = prefix ? `${prefix}.${key}` : key, cell = value[key];
      observed.get(path)?.push(cell);
      gather(cell, path, depth + 1);
    }
  };
  rows.forEach(row => { observed.get('')?.push(row); gather(row); });
  return [...paths].map(path => {
    let selectable = !unsupported.has(path);
    try { validateDataPath(path); } catch { selectable = false; }
    const cells = selectable ? observed.get(path) : [];
    const values = cells.filter(value => value !== undefined && value !== null && value !== '');
    const numericCount = values.filter(value => strictDataNumber(value) !== null).length;
    const identifier = /(?:id|code|编号|编码)$/i.test(path) || values.some(value => typeof value === 'string' && /^0\d+$/.test(value.trim()));
    const time = value => typeof value === 'string' && /^(?:\d{4}-\d{2}-\d{2}(?:[T ][\d:.+Z-]+)?|(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)$/.test(value);
    const type = !selectable ? 'unsupported' : !values.length ? 'empty' : values.every(time) ? 'time' : numericCount === values.length && !identifier ? values.every(value => typeof value === 'number') ? 'number' : 'numeric-string' : values.every(value => typeof value === 'boolean') ? 'boolean' : values.every(value => typeof value === 'string' || typeof value === 'number') ? numericCount && !identifier ? 'mixed' : 'string' : 'mixed';
    const examples = [...new Set(values.map(value => typeof value === 'object' ? JSON.stringify(value) : String(value)))].slice(0, 3).map(value => value.slice(0, 80));
    return { path, type, examples, sample: examples[0] || '', missingCount: rows.length - values.length, numericCount, rowCount: rows.length, selectable };
  });
}

export function analyzeDataContent(content, type = 'json', preferredPath) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > DATA_SIZE_LIMIT) throw new Error('数据内容必须是 1 MB 以内的文字');
  let document;
  if (type === 'csv') document = parseCsv(content);
  else { try { document = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('数据不是有效 JSON'); } }
  const candidates = [];
  const visit = (node, path = '', depth = 0) => {
    if (depth > 12 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.every(row => row && typeof row === 'object' && !Array.isArray(row))) candidates.push({ path, rowCount: node.length });
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      try { validateDataPath(next); } catch { continue; }
      visit(value, next, depth + 1);
    }
  };
  visit(document);
  if (!candidates.length && document && typeof document === 'object' && !Array.isArray(document)) candidates.push({ path: '', rowCount: 1 });
  const rowsPath = type === 'csv' ? '' : preferredPath !== undefined ? validateDataPath(preferredPath) : candidates.length === 1 ? candidates[0].path : null;
  if (rowsPath === null) {
    if (!candidates.length) throw new Error('没有找到对象组成的数据列表');
    return { rows: null, rowsPath: null, candidates, fields: [] };
  }
  const selected = readDataPath(document, rowsPath);
  const rows = validateRows(Array.isArray(selected) ? selected : selected && typeof selected === 'object' ? [selected] : null);
  return { rows, rowsPath, candidates, fields: profileDataFields(rows) };
}

const FIELD_ALIASES = {
  name: ['name', 'label', 'category', 'title', 'region', '名称', '分类', '区域', '项目', '指标'],
  value: ['value', 'amount', 'count', 'total', 'quantity', '数值', '数量', '总量', '销售额', '访问量'],
  time: ['time', 'date', 'datetime', 'timestamp', '时间', '日期', '时点'],
  status: ['status', 'state', '状态'], target: ['target', 'goal', 'quota', '目标', '目标值'],
  series: ['series', 'group', 'type', '系列', '分组', '类型'], code: ['code', 'adcode', 'regioncode', '区域编码', '行政区编码'],
  x: ['x', 'longitude', 'lng', '横轴', '经度'], y: ['y', 'latitude', 'lat', '纵轴', '纬度'],
  value2: ['value2', 'secondary', 'secondaryvalue', '第二数值', '对比值'],
};

export function suggestDataFields(fields, currentFields = {}) {
  const result = { ...normalizeDataFields(currentFields) }, ambiguous = [];
  const available = fields.filter(field => field.selectable !== false && field.type !== 'empty' && field.type !== 'unsupported');
  const assigned = new Set(Object.values(result).filter(Boolean));
  for (const key of DATA_FIELDS) {
    if (Object.hasOwn(result, key)) continue;
    const exact = available.filter(field => field.path.toLowerCase() === key.toLowerCase());
    const matches = exact.length ? exact : available.filter(field => FIELD_ALIASES[key].includes(field.path.split('.').at(-1).replace(/[_ -]/g, '').toLowerCase()));
    if (matches.length === 1) { result[key] = matches[0].path; assigned.add(matches[0].path); }
    else if (matches.length > 1) ambiguous.push(key);
  }
  for (const [key, types] of [['value', ['number', 'numeric-string']], ['time', ['time']], ['name', ['string']]]) {
    if (Object.hasOwn(result, key) || ambiguous.includes(key)) continue;
    const matches = available.filter(field => types.includes(field.type) && !assigned.has(field.path));
    if (matches.length === 1) { result[key] = matches[0].path; assigned.add(matches[0].path); }
    else if (matches.length > 1) ambiguous.push(key);
  }
  return { fields: result, unresolved: DATA_FIELDS.filter(key => !result[key] || !available.some(field => field.path === result[key])), ambiguous };
}

export function suggestDataWidgets(analysis, currentFields = {}) {
  if (!analysis.rows?.length) return [];
  const fields = suggestDataFields(analysis.fields, currentFields).fields;
  const columns = ['name', 'time', 'value', 'status', 'series', 'target', 'x', 'y', 'value2'].filter(key => fields[key]).slice(0, 6).map(key => ({ key, label: { name: '名称', time: '时间', value: '数值', status: '状态', series: '系列', target: '目标', x: 'X', y: 'Y', value2: '第二数值' }[key] }));
  const definitions = [
    ['table', '查看数据明细', columns.length > 0], ['metric', '汇总数值', fields.value],
    ['line', '时间与数值趋势', fields.time && fields.value], ['bar', '分类数值对比', fields.name && fields.value],
    ['pie', '分类占比', fields.name && fields.value], ['donut', '正值占比分布', fields.name && fields.value], ['rose', '径向占比对比', fields.name && fields.value], ['status', '名称与状态', fields.name && fields.status],
    ['progress', '实际值与目标', fields.value && fields.target], ['multiLine', '按系列比较趋势', (fields.time || fields.name) && fields.series && fields.value],
    ['stacked', '分类与系列构成', (fields.name || fields.time) && fields.series && fields.value], ['combo', '双数值趋势', (fields.name || fields.time) && fields.value && fields.value2],
    ['groupedColumn', '并列比较各系列', (fields.name || fields.time) && fields.series && fields.value],
    ['stackedArea', '各系列趋势构成', (fields.time || fields.name) && fields.series && fields.value],
    ['percentStacked', '类别内的系列占比', (fields.name || fields.time) && fields.series && fields.value],
    ['histogram', '原始样本频数分布', fields.value], ['boxplot', '分组样本四分位分布', fields.name && fields.value],
    ['waterfall', '增减量累计', fields.name && fields.value && analysis.rows.some(row => strictDataNumber(readDataPath(row, fields.value)) < 0)],
    ['scatter', '两个数值坐标', fields.x && fields.y], ['heatmap', '两维类别与数值', fields.x && fields.y && fields.value],
    ['radar', '多指标数值对比', fields.name && fields.value && analysis.rows.length >= 3],
    ['funnel', '阶段数值分布', fields.name && fields.value], ['treemap', '分类数值面积', fields.name && fields.value],
  ];
  return definitions.flatMap(([type, reason, usable]) => {
    if (!usable) return [];
    try {
      const data = getMappedData(analysis, { fields }, { type, columns, aggregate: 'sum' });
      if (type === 'line' || type === 'bar') {
        const seriesCount = new Set(data.rows.map(row => row.series.trim())).size;
        const categories = data.rows.map(row => (type === 'line' ? row.time : row.name).trim());
        const repeated = new Set(categories).size !== categories.length;
        if (type === 'line' && (seriesCount > 1 || repeated || categories.some(value => !value))) return [];
        if (type === 'bar' && seriesCount > 1 && repeated) return [];
      }
      if (['pie', 'donut', 'rose'].includes(type) && data.rows.some(row => row.value <= 0)) return [];
      if (PROFESSIONAL_TYPES.includes(type)) {
        const chart = buildProfessionalChart({ type, title: reason }, data);
        if (chart.error || !chart.option) return [];
      }
      return [{ type, reason, fields: { ...fields }, columns, aggregate: 'sum' }];
    } catch { return []; }
  });
}

export async function inspectDataSource(source, code, options = {}) {
  const started = Date.now(), payload = await loadSourcePayload(source, code, options);
  const preferredPath = Object.hasOwn(options, 'preferredPath') ? options.preferredPath : payload.source.rowsPath;
  return { ...analyzeDataContent(payload.content, payload.type, preferredPath), elapsedMs: Date.now() - started, content: payload.content, contentType: payload.type };
}
