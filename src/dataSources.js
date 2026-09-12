export const DATA_SOURCE_LIMIT = 40;
export const DATA_SIZE_LIMIT = 1024 * 1024;
export const DATA_ROW_LIMIT = 5000;
export const DATA_COLUMN_LIMIT = 40;
export const DATA_FIELDS = ['name', 'value', 'time', 'status', 'target', 'series', 'code', 'x', 'y', 'value2'];
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const SECRET_QUERY = /(?:authorization|token|apikey|secret|password|passwd|credential|cookie|signature)|^(?:auth|key|pwd|session|sessionid|sig|bearer|jwt)$/i;

function boundedText(value, label, limit, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  if (value.length > limit) throw new Error(`${label}不能超过 ${limit} 个字符`);
  return value;
}

export function validateDataPath(path = '') {
  if (typeof path !== 'string' || path.length > 160) throw new Error('字段路径必须是 160 字符以内的文字');
  if (!path) return '';
  const segments = path.split('.');
  if (segments.length > 12 || segments.some(key => !/^[\p{L}\p{N}_-]+$/u.test(key) || FORBIDDEN.has(key))) {
    throw new Error('字段路径仅支持点号分隔的名称，不允许特殊属性');
  }
  return path;
}

export function readDataPath(row, path) {
  validateDataPath(path);
  if (!path) return row;
  return path.split('.').reduce((value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, row);
}

export function normalizeDataFields(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('字段映射格式无效');
  return Object.fromEntries(Object.entries(fields).map(([key, path]) => {
    if (!DATA_FIELDS.includes(key)) throw new Error(`不支持的映射字段：${key}`);
    if (typeof path !== 'string') throw new Error('映射字段必须是文字路径');
    return [key, validateDataPath(path)];
  }));
}

export function validateSourceUrl(value, code = '100000', baseUrl = globalThis.location?.href || 'http://localhost/') {
  const input = boundedText(value, '接口地址', 2048).trim();
  if (!input) throw new Error('请填写接口地址');
  if (/^[\s\\]/.test(input) || input.startsWith('//') || input.includes('\\') || /[\u0000-\u001f]/.test(input)) throw new Error('接口地址格式无效');
  if (input.includes('{') && input.replaceAll('{adcode}', '').includes('{')) throw new Error('接口地址仅支持 {adcode} 区域参数');
  let url;
  try { url = new URL(input.replaceAll('{adcode}', encodeURIComponent(String(code))), baseUrl); }
  catch { throw new Error('接口地址格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口仅支持 HTTP、HTTPS 或同源相对路径');
  if (url.username || url.password) throw new Error('接口地址不能包含账号或密码，请使用同源服务端代理');
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY.test(key.replace(/[^a-z0-9]/gi, ''))) throw new Error('请勿在地址参数中保存凭据，请使用同源服务端代理');
  }
  if (url.hash) throw new Error('接口地址不能包含片段标记');
  return url.href;
}

export function normalizeDataSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('数据源格式无效');
  const id = boundedText(input.id, '数据源标识', 80);
  if (!/^ds_[a-zA-Z0-9_-]+$/.test(id)) throw new Error('数据源标识必须以 ds_ 开头');
  const name = boundedText(input.name, '数据源名称', 40).trim();
  if (!name) throw new Error('请填写数据源名称');
  const type = input.type;
  if (!['json', 'csv', 'http'].includes(type)) throw new Error('不支持的数据源类型');
  const content = type === 'http' ? '' : boundedText(input.content, '数据内容', DATA_SIZE_LIMIT);
  if (new TextEncoder().encode(content).byteLength > DATA_SIZE_LIMIT) throw new Error('数据内容不能超过 1 MB');
  const url = type === 'http' ? boundedText(input.url, '接口地址', 2048).trim() : '';
  if (type === 'http') validateSourceUrl(url);
  const rowsPath = type === 'csv' ? '' : validateDataPath(boundedText(input.rowsPath, '数据列表路径', 160).trim());
  const refreshSeconds = input.refreshSeconds ?? 0;
  if (!Number.isInteger(refreshSeconds) || refreshSeconds < 0 || refreshSeconds > 86400) throw new Error('刷新间隔需为 0–86400 的整数秒');
  return { id, name, type, content, url, rowsPath, refreshSeconds: refreshSeconds === 0 ? 0 : Math.max(15, refreshSeconds) };
}

export function validateRows(rows) {
  if (!Array.isArray(rows)) throw new Error('数据路径没有指向数据列表或对象');
  if (rows.length > DATA_ROW_LIMIT) throw new Error(`数据不能超过 ${DATA_ROW_LIMIT} 行`);
  const allKeys = new Set();
  function visit(value, depth = 0) {
    if (depth > 12) throw new Error('数据嵌套不能超过 12 层');
    if (!value || typeof value !== 'object') return;
    const keys = Object.keys(value);
    if (!Array.isArray(value) && keys.length > DATA_COLUMN_LIMIT) throw new Error(`每行数据不能超过 ${DATA_COLUMN_LIMIT} 列`);
    for (const key of keys) {
      if (FORBIDDEN.has(key)) throw new Error('数据不能包含特殊属性名');
      visit(value[key], depth + 1);
    }
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('每行数据必须是对象');
    Object.keys(row).forEach(key => allKeys.add(key));
    if (allKeys.size > DATA_COLUMN_LIMIT) throw new Error(`数据不能超过 ${DATA_COLUMN_LIMIT} 列`);
    visit(row);
  }
  return rows;
}

export function parseCsv(content) {
  if (new TextEncoder().encode(content).byteLength > DATA_SIZE_LIMIT) throw new Error('数据内容不能超过 1 MB');
  const text = content.replace(/^\uFEFF/, '');
  const records = []; let record = [], value = '', quoted = false, closedQuote = false, rowQuoted = false;
  const pushCell = () => { record.push(value); value = ''; closedQuote = false; if (record.length > DATA_COLUMN_LIMIT) throw new Error(`CSV 不能超过 ${DATA_COLUMN_LIMIT} 列`); };
  const pushRow = () => { pushCell(); if (record.length > 1 || record[0] !== '' || rowQuoted) records.push(record); record = []; rowQuoted = false; if (records.length > DATA_ROW_LIMIT + 1) throw new Error(`数据不能超过 ${DATA_ROW_LIMIT} 行`); };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else value += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') { pushRow(); if (char === '\r' && text[i + 1] === '\n') i += 1; }
    else if (char === '"' && value === '' && !closedQuote) { quoted = true; rowQuoted = true; }
    else if (closedQuote || char === '"') throw new Error('CSV 引号格式无效');
    else value += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (value || record.length || closedQuote) pushRow();
  if (!records.length) throw new Error('CSV 缺少表头');
  const headers = records.shift().map(header => header.trim());
  if (headers.some(header => !header || FORBIDDEN.has(header)) || new Set(headers).size !== headers.length) throw new Error('CSV 表头不能为空、重复或使用特殊属性名');
  return validateRows(records.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`CSV 第 ${i + 2} 行的列数与表头不一致`);
    return Object.fromEntries(headers.map((header, col) => [header, cells[col]]));
  }));
}

export function parseSourceContent(content, type = 'json', rowsPath = '') {
  if (new TextEncoder().encode(content).byteLength > DATA_SIZE_LIMIT) throw new Error('数据内容不能超过 1 MB');
  if (type === 'csv') return parseCsv(content);
  let data;
  try { data = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error('数据不是有效 JSON'); }
  const selected = readDataPath(data, rowsPath);
  return validateRows(Array.isArray(selected) ? selected : selected && typeof selected === 'object' ? [selected] : null);
}

export function strictDataNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !NUMBER.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

export function getMappedData(sourceResult, binding, config = {}) {
  const fields = normalizeDataFields(binding?.fields);
  const textTable = config.type === 'table' && Array.isArray(config.columns) && !config.columns.some(column => column.key === 'value');
  const numeric = !['text', 'clock', 'status', 'scatter'].includes(config.type) && !textTable;
  const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
  const category = value => (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value));
  const provided = value => value !== undefined && value !== null && value !== '';
  const rows = (sourceResult?.rows || []).map((row, i) => {
    const mapped = Object.fromEntries(DATA_FIELDS.map(key => [key, fields[key] ? readDataPath(row, fields[key]) : undefined]));
    const value = strictDataNumber(mapped.value);
    if (numeric && value === null) throw new Error(`第 ${i + 1} 行的数值字段“${fields.value || '未设置'}”缺失或不是有效数字`);
    const target = strictDataNumber(mapped.target);
    if (mapped.target !== undefined && mapped.target !== null && mapped.target !== '' && target === null) throw new Error(`第 ${i + 1} 行的目标字段不是有效数字`);
    const value2 = strictDataNumber(mapped.value2);
    let x = category(mapped.x) ? mapped.x : null, y = category(mapped.y) ? mapped.y : null;
    if (config.type === 'scatter') {
      x = strictDataNumber(mapped.x); y = strictDataNumber(mapped.y);
      if (x === null || y === null) throw new Error(`第 ${i + 1} 行的 X、Y 字段必须是有效数字`);
      if (provided(mapped.value) && (value === null || value < 0)) throw new Error(`第 ${i + 1} 行的点大小必须是非负数字或留空`);
    }
    if (config.type === 'heatmap' && (x === null || y === null)) throw new Error(`第 ${i + 1} 行的 X、Y 类别不能为空`);
    if (config.type === 'combo' && value2 === null) throw new Error(`第 ${i + 1} 行的第二数值字段必须是有效数字`);
    if (['multiLine', 'stacked', 'combo'].includes(config.type) && !category(mapped.time) && !category(mapped.name)) throw new Error(`第 ${i + 1} 行需要名称或时间字段`);
    if (['multiLine', 'stacked'].includes(config.type) && !category(mapped.series)) throw new Error(`第 ${i + 1} 行需要系列字段`);
    if (['radar', 'funnel', 'treemap'].includes(config.type) && (!category(mapped.name) || value < 0)) throw new Error(`第 ${i + 1} 行需要名称和非负数值`);
    if (config.type === 'radar' && target !== null && target <= 0) throw new Error(`第 ${i + 1} 行的雷达目标值必须大于 0`);
    const name = scalar(mapped.name) || (['multiLine', 'stacked', 'combo'].includes(config.type) ? '' : `第 ${i + 1} 项`);
    return { name, value, time: scalar(mapped.time), status: scalar(mapped.status), target, series: scalar(mapped.series), code: scalar(mapped.code), x, y, value2 };
  });
  const values = rows.map(row => row.value).filter(value => value !== null);
  const aggregate = config.aggregate || 'sum';
  if (!['sum', 'average', 'first'].includes(aggregate)) throw new Error('不支持的聚合方式');
  const value = !values.length ? null : aggregate === 'first' ? values[0] : aggregate === 'average' ? values.reduce((sum, item) => sum + item / values.length, 0) : values.reduce((sum, item) => sum + item, 0);
  if (value !== null && !Number.isFinite(value)) throw new Error('汇总结果超过有效数字范围');
  return { rows, value, unit: config.unit || '', scope: config.scope || '自定义数据' };
}

async function limitedResponseText(response) {
  if (Number(response.headers?.get('content-length')) > DATA_SIZE_LIMIT) { await response.body?.cancel(); throw new Error('接口响应不能超过 1 MB'); }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > DATA_SIZE_LIMIT) throw new Error('接口响应不能超过 1 MB');
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > DATA_SIZE_LIMIT) { await reader.cancel(); throw new Error('接口响应不能超过 1 MB'); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export async function loadSourcePayload(rawSource, code, { signal, fetcher = globalThis.fetch, timeoutMs = 10000, baseUrl } = {}) {
  const source = normalizeDataSource(rawSource);
  if (source.type !== 'http') return { content: source.content, type: source.type, source };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetcher(validateSourceUrl(source.url, code, baseUrl), { method: 'GET', credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json, text/csv' } });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`接口请求失败（HTTP ${response.status}）`); }
    const content = await limitedResponseText(response);
    const isCsv = /(?:text\/csv|application\/csv)/i.test(response.headers?.get('content-type') || '') || new URL(validateSourceUrl(source.url, code, baseUrl)).pathname.toLowerCase().endsWith('.csv');
    return { content, type: isCsv ? 'csv' : 'json', source };
  } catch (error) {
    if (timedOut) throw new Error('接口请求超时（10 秒），请检查服务状态');
    if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (error instanceof TypeError) throw new Error('无法读取接口，请检查网络、地址或跨域设置');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}

export async function loadDataSource(source, code, options) {
  const payload = await loadSourcePayload(source, code, options);
  return parseSourceContent(payload.content, payload.type, payload.source.rowsPath);
}

// 一个源由一个控制器加载，多个组件直接共享结果，旧请求无法覆盖新区域。
export function createDataSourceController({ onChange, loader = loadDataSource, now = Date.now }) {
  let disposed = false, active = false;
  const jobs = new Map(), entries = new Map();
  const results = {};
  const publish = (id, result) => { results[id] = result; if (!disposed) onChange({ ...results }); };
  const refresh = async (source, code) => {
    if (disposed) return;
    if (typeof source === 'string') {
      const entry = entries.get(source);
      if (!active || !entry) return;
      source = entry.source; code = entry.code;
    }
    jobs.get(source.id)?.abort();
    const controller = new AbortController(); jobs.set(source.id, controller);
    const previous = results[source.id];
    publish(source.id, { ...previous, rows: previous?.rows || [], status: 'loading', error: '', stale: Boolean(previous?.rows?.length) });
    try {
      const rows = await loader(source, code, { signal: controller.signal });
      if (disposed || jobs.get(source.id) !== controller || controller.signal.aborted) return;
      publish(source.id, { rows, status: 'ready', error: '', stale: false, updatedAt: now() });
    } catch (error) {
      if (disposed || jobs.get(source.id) !== controller || controller.signal.aborted || error.name === 'AbortError') return;
      publish(source.id, { rows: previous?.rows || [], updatedAt: previous?.updatedAt, status: 'error', stale: Boolean(previous?.rows?.length), error: error.message || '数据加载失败' });
    } finally { if (jobs.get(source.id) === controller) jobs.delete(source.id); }
  };
  const cancel = () => {
    for (const controller of jobs.values()) controller.abort();
    jobs.clear();
    for (const entry of entries.values()) { clearInterval(entry.timer); entry.timer = null; }
  };
  const start = entry => {
    refresh(entry.source, entry.code);
    if (entry.source.type === 'http' && entry.source.refreshSeconds > 0) entry.timer = setInterval(() => refresh(entry.source, entry.code), entry.source.refreshSeconds * 1000);
  };
  const setActive = enabled => {
    if (disposed || active === enabled) return;
    active = enabled;
    if (active) for (const entry of entries.values()) start(entry);
    else cancel();
  };
  const reconcile = (sources, code, enabled = true) => {
    if (disposed) return;
    if (!Array.isArray(sources) || sources.length > DATA_SOURCE_LIMIT) throw new Error(`最多配置 ${DATA_SOURCE_LIMIT} 个数据源`);
    const next = new Map();
    for (const input of sources) {
      const source = normalizeDataSource(input);
      if (next.has(source.id)) throw new Error('数据源标识重复');
      const region = source.type === 'http' && source.url.includes('{adcode}') ? code : null;
      next.set(source.id, { source, code, signature: JSON.stringify([region, source]), timer: null });
    }
    let removed = false;
    for (const [id, entry] of entries) {
      if (next.get(id)?.signature === entry.signature) { entry.code = code; continue; }
      clearInterval(entry.timer); jobs.get(id)?.abort(); jobs.delete(id); entries.delete(id);
      if (Object.hasOwn(results, id)) { delete results[id]; removed = true; }
    }
    if (removed) onChange({ ...results });
    const added = [];
    for (const [id, entry] of next) if (!entries.has(id)) { entries.set(id, entry); added.push(entry); }
    if (active !== enabled) setActive(enabled);
    else if (active) added.forEach(start);
  };
  return {
    refresh, reconcile, setActive, cancel,
    dispose() { disposed = true; cancel(); entries.clear(); },
  };
}
