import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  DATA_SIZE_LIMIT, createDataSourceController, getMappedData, loadDataSource,
  normalizeDataFields, normalizeDataSource, parseCsv, parseSourceContent,
  readDataPath, strictDataNumber, validateDataPath, validateSourceUrl,
} from '../src/dataSources.js';
import { analyzeDataContent, inspectDataSource, profileDataFields, suggestDataFields, suggestDataWidgets } from '../src/dataInference.js';

const source = (patch = {}) => ({ id: 'ds_test', name: '运行数据', type: 'json', content: '[{"name":"华东","value":12}]', url: '', rowsPath: '', refreshSeconds: 0, ...patch });
const binding = { sourceId: 'ds_test', fields: { name: 'label', value: 'metrics.total', target: 'metrics.target', time: 'at', status: 'state', code: 'code', series: 'group' } };

test('source normalization restricts templates, safe field paths and credentials', () => {
  assert.equal(normalizeDataSource(source({ refreshSeconds: 1 })).refreshSeconds, 15);
  assert.equal(normalizeDataSource(source({ type: 'http', url: '/api/metrics', content: 'unused' })).content, '');
  assert.deepEqual(normalizeDataFields({ name: '设备.名称', value: 'data.0.total', status: '' }), { name: '设备.名称', value: 'data.0.total', status: '' });
  for (const id of ['demo', '__proto__', 'ds_', 'ds_a.b']) assert.throws(() => normalizeDataSource(source({ id })), /标识/);
  for (const interval of [-1, 1.5, '30', 86401]) assert.throws(() => normalizeDataSource(source({ refreshSeconds: interval })), /间隔/);
  assert.throws(() => normalizeDataSource(source({ content: '中'.repeat(DATA_SIZE_LIMIT / 3 + 1) })), /1 MB/);
  for (const path of ['__proto__.x', 'a.constructor.x', 'prototype', 'a[0]', 'a..b', 'a()', 'x;alert(1)', '.a']) assert.throws(() => validateDataPath(path), /路径/);
  for (const fields of [null, [], { bad: 'value' }, { value: 2 }, { name: 'constructor' }]) assert.throws(() => normalizeDataFields(fields));
  assert.equal(readDataPath(Object.create({ value: 12 }), 'value'), undefined);
  assert.equal(validateSourceUrl('/api/metrics?adcode={adcode}', '110000', 'https://example.com/page'), 'https://example.com/api/metrics?adcode=110000');
  assert.equal(validateSourceUrl('https://api.example.com/metrics?name=区域'), 'https://api.example.com/metrics?name=%E5%8C%BA%E5%9F%9F');
  for (const url of ['file:///tmp/data', 'javascript:alert(1)', '//other.example/data', 'https://user:pass@example.com/data', '/api?access_token=secret', '/api?API-Key=secret', '/api?X-API-Key=secret', '/api?X-Amz-Credential=secret', '/api?authorization=secret', '/api?session_id=secret', '/api#key', '/api?x={other}', '/api\\secret']) assert.throws(() => validateSourceUrl(url));
});

test('CSV preserves quoted commas/newlines/escaped quotes and empty rows, rejects malformed data', () => {
  const rows = parseCsv('\uFEFFname,value,comment\r\n"华东,中心",12,"他说""在线"""\r\n"华\n北",3,正常\r\n,,\r\n');
  assert.deepEqual(rows, [{ name: '华东,中心', value: '12', comment: '他说"在线"' }, { name: '华\n北', value: '3', comment: '正常' }, { name: '', value: '', comment: '' }]);
  assert.deepEqual(parseCsv('name\n""\n'), [{ name: '' }]);
  for (const text of ['', 'name,name\nA,B', 'name,value\nA', 'name,value\n"A,1', 'name,value\nA"B,1', 'name,value\n"A"x,1', '__proto__,value\nA,1', ',\nA,1']) assert.throws(() => parseCsv(text));
  assert.throws(() => parseCsv(`name,value\n${'A,1\n'.repeat(5001)}`), /5000/);
  assert.throws(() => parseCsv(Array.from({ length: 41 }, (_, i) => `field${i}`).join(',')), /40/);
});

test('JSON supports root rows, nested list paths and singleton metrics with bounded shape', () => {
  assert.deepEqual(parseSourceContent('{"data":{"rows":[{"value":2}]}}', 'json', 'data.rows'), [{ value: 2 }]);
  assert.deepEqual(parseSourceContent('{"value":0}'), [{ value: 0 }]);
  assert.deepEqual(parseSourceContent('[]'), []);
  assert.throws(() => parseSourceContent('{"data":[]}', 'json', 'missing.rows'), /路径/);
  for (const text of ['null', '7', '[null]', '[[]]', '[{"__proto__":{"x":1}}]', '[{"nested":{"constructor":7}}]', '{']) assert.throws(() => parseSourceContent(text));
  assert.throws(() => parseSourceContent(JSON.stringify(Array.from({ length: 5001 }, () => ({ value: 1 })))), /5000/);
  assert.throws(() => parseSourceContent(JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ [`col${i}`]: 1 })))), /40/);
});

test('mapping accepts finite decimal numbers, aggregates and never turns missing values into zero', () => {
  for (const [input, expected] of [[0, 0], ['0', 0], [' -1.25 ', -1.25], ['.2', .2], ['1e3', 1000], ['1.', 1]]) assert.equal(strictDataNumber(input), expected);
  for (const input of [null, undefined, '', ' ', false, true, [], {}, NaN, Infinity, 'Infinity', '0x10', '1,000', '1px']) assert.equal(strictDataNumber(input), null);
  const result = { rows: [
    { label: '华东', metrics: { total: '12', target: '20' }, at: '09:00', state: '在线', code: '031000', group: '设备' },
    { label: '华北', metrics: { total: 8, target: 16 }, at: '10:00', state: '在线', code: '011000', group: '设备' },
  ] };
  const mapped = getMappedData(result, binding, { type: 'metric', aggregate: 'sum', unit: '台' });
  assert.equal(mapped.value, 20); assert.equal(mapped.unit, '台');
  assert.deepEqual(mapped.rows[0], { name: '华东', value: 12, target: 20, time: '09:00', status: '在线', code: '031000', series: '设备', x: null, y: null, value2: null });
  assert.equal(getMappedData(result, binding, { type: 'metric', aggregate: 'average' }).value, 10);
  assert.equal(getMappedData(result, binding, { type: 'metric', aggregate: 'first' }).value, 12);
  assert.equal(getMappedData({ rows: [] }, binding, { type: 'metric' }).value, null);
  for (const value of [null, '', false, 'bad']) assert.throws(() => getMappedData({ rows: [{ label: '华东', metrics: { total: value } }] }, binding, { type: 'line' }), /第 1 行.*有效数字/);
  for (const type of ['text', 'clock', 'status']) assert.equal(getMappedData({ rows: [{ label: '系统', state: '运行中' }] }, binding, { type }).rows[0].value, null);
  assert.throws(() => getMappedData(result, binding, { aggregate: 'median' }), /聚合/);
  assert.throws(() => getMappedData({ rows: [{ value: Number.MAX_VALUE }, { value: Number.MAX_VALUE }] }, { fields: { value: 'value' } }, { type: 'metric' }), /数字范围/);
  assert.equal(getMappedData({ rows: [{ value: Number.MAX_VALUE }, { value: Number.MAX_VALUE }] }, { fields: { value: 'value' } }, { type: 'metric', aggregate: 'average' }).value, Number.MAX_VALUE);
});

test('text-only event tables do not require value, while numeric charts and value columns remain strict', () => {
  const result = { rows: [{ name: '设备上线', time: '09:00', status: '已恢复' }] };
  const eventBinding = { fields: { name: 'name', time: 'time', status: 'status', value: 'value' } };
  const columns = ['time', 'name', 'status'].map(key => ({ key, label: key }));
  const mapped = getMappedData(result, eventBinding, { type: 'table', columns });
  assert.equal(mapped.value, null);
  assert.equal(mapped.rows[0].value, null);
  assert.deepEqual(Object.fromEntries(columns.map(({ key }) => [key, mapped.rows[0][key]])), result.rows[0]);
  for (const value of [undefined, null, '', '无效数字']) {
    const invalid = { rows: [{ ...result.rows[0], value }] };
    assert.equal(getMappedData(invalid, eventBinding, { type: 'table', columns }).rows[0].value, null);
    assert.throws(() => getMappedData(invalid, eventBinding, { type: 'table', columns: [...columns, { key: 'value', label: '数值' }] }), /第 1 行.*有效数字/);
    for (const type of ['metric', 'line', 'bar', 'gauge']) assert.throws(() => getMappedData(invalid, eventBinding, { type, columns }), /第 1 行.*有效数字/);
  }
});

test('HTTP loader uses real GET responses, region substitution, failures, timeout and cancellation', async () => {
  let requestInfo;
  const server = createServer((request, response) => {
    requestInfo = { method: request.method, url: request.url, headers: request.headers };
    if (request.url.startsWith('/error')) { response.writeHead(503); response.end('unavailable'); return; }
    if (request.url.startsWith('/csv')) { response.writeHead(200, { 'content-type': 'text/csv' }); response.end('name,value\n华东,12'); return; }
    if (request.url.startsWith('/slow')) return;
    response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"data":[{"name":"华东","value":12}]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const remote = patch => source({ type: 'http', url: '/metrics?adcode={adcode}', rowsPath: 'data', ...patch });
  try {
    let fetchOptions;
    const rows = await loadDataSource(remote(), '110000', { baseUrl, fetcher: (url, options) => { fetchOptions = options; return fetch(url, options); } });
    assert.deepEqual(rows, [{ name: '华东', value: 12 }]);
    assert.equal(requestInfo.method, 'GET'); assert.equal(requestInfo.url, '/metrics?adcode=110000');
    assert.equal(fetchOptions.credentials, 'same-origin'); assert.equal(requestInfo.headers.authorization, undefined);
    assert.deepEqual(await loadDataSource(remote({ url: '/csv', rowsPath: '' }), '100000', { baseUrl }), [{ name: '华东', value: '12' }]);
    await assert.rejects(loadDataSource(remote({ url: '/error' }), '100000', { baseUrl }), /HTTP 503/);
    await assert.rejects(loadDataSource(remote({ url: '/slow' }), '100000', { baseUrl, timeoutMs: 30 }), /超时/);
    const controller = new AbortController();
    const pending = loadDataSource(remote({ url: '/slow' }), '100000', { baseUrl, signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
    let fetched = false;
    await assert.rejects(loadDataSource(remote({ url: '/metrics?token=secret' }), '100000', { fetcher: () => { fetched = true; } }), /凭据/);
    assert.equal(fetched, false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('HTTP loader bounds streamed bytes and declared response size, surfaces invalid JSON and network errors', async () => {
  const remote = source({ type: 'http', url: '/metrics' });
  const oversized = new Uint8Array(DATA_SIZE_LIMIT + 1); let cancelled = false;
  await assert.rejects(loadDataSource(remote, '100000', { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(oversized); }, cancel() { cancelled = true; } })) }), /1 MB/);
  assert.equal(cancelled, true);
  await assert.rejects(loadDataSource(remote, '100000', { fetcher: async () => new Response('[]', { headers: { 'content-length': DATA_SIZE_LIMIT + 1 } }) }), /1 MB/);
  await assert.rejects(loadDataSource(remote, '100000', { fetcher: async () => new Response('not json') }), /有效 JSON/);
  await assert.rejects(loadDataSource(remote, '100000', { fetcher: async () => { throw new TypeError('Failed to fetch'); } }), /网络/);
});

test('request controller isolates old regions and disposed loads, retains previous rows on failure', async () => {
  const pending = [], updates = []; let timestamp = 0;
  const controller = createDataSourceController({ onChange: value => updates.push(value), now: () => ++timestamp, loader: (item, code, { signal }) => new Promise((resolve, reject) => pending.push({ code, signal, resolve, reject })) });
  const first = controller.refresh(source(), '100000');
  const second = controller.refresh(source(), '110000');
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve([{ name: '北京', value: 12 }]); await second;
  assert.equal(updates.at(-1).ds_test.status, 'ready'); assert.equal(updates.at(-1).ds_test.updatedAt, 1);
  pending[0].resolve([{ name: '全国旧数据', value: 99 }]); await first;
  assert.equal(updates.at(-1).ds_test.rows[0].name, '北京');
  const third = controller.refresh(source(), '110000');
  pending[2].reject(new Error('HTTP 503')); await third;
  assert.deepEqual(updates.at(-1).ds_test, { rows: [{ name: '北京', value: 12 }], updatedAt: 1, status: 'error', stale: true, error: 'HTTP 503' });
  const fourth = controller.refresh(source(), '120000');
  controller.cancel(); pending[3].resolve([{ value: 2 }]); const count = updates.length; await fourth;
  assert.equal(updates.length, count);
  const fifth = controller.refresh(source(), '120000'); controller.dispose(); pending[4].resolve([{ value: 3 }]); const beforeDispose = updates.length; await fifth;
  assert.equal(updates.length, beforeDispose); assert.equal(pending[4].signal.aborted, true);
  await controller.refresh(source(), '130000'); assert.equal(pending.length, 5);
});

test('source reconciliation preserves unchanged requests and snapshots when another source changes', async () => {
  const pending = [], updates = [];
  const controller = createDataSourceController({ onChange: value => updates.push(value), loader: (item, code, { signal }) => new Promise((resolve, reject) => pending.push({ id: item.id, code, signal, resolve, reject })) });
  const a = source({ id: 'ds_a' }), b = source({ id: 'ds_b' });
  controller.reconcile([a], '100000');
  controller.reconcile([a, b], '100000');
  assert.deepEqual(pending.map(item => item.id), ['ds_a', 'ds_b']);
  assert.equal(pending[0].signal.aborted, false, 'adding B must not abort A');
  pending[0].resolve([{ value: 12 }]); await Promise.resolve();
  const snapshotA = updates.at(-1).ds_a;
  controller.reconcile([a], '100000');
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(updates.at(-1).ds_a, snapshotA);
  assert.equal(updates.at(-1).ds_b, undefined);
  pending[1].resolve([{ value: 99 }]); await Promise.resolve();
  assert.equal(updates.at(-1).ds_b, undefined, 'removed B cannot publish late data');
  controller.reconcile([source({ id: 'ds_a', name: ' 运行数据 ' })], '100000');
  assert.equal(pending.length, 2, 'equivalent normalized source must not reload');
  controller.reconcile([a, b], '100000');
  pending[2].resolve([{ value: 8 }]); await Promise.resolve();
  const snapshotB = updates.at(-1).ds_b;
  const retry = controller.refresh('ds_a'); pending[3].reject(new Error('暂时离线')); await retry;
  assert.equal(updates.at(-1).ds_a.stale, true);
  assert.deepEqual(updates.at(-1).ds_a.rows, [{ value: 12 }]);
  controller.reconcile([a], '100000');
  assert.equal(pending.length, 4); assert.deepEqual(updates.at(-1).ds_a.rows, [{ value: 12 }]);
  controller.reconcile([a, b], '100000');
  pending[4].resolve([{ value: 8 }]); await Promise.resolve();
  controller.reconcile([{ ...a, content: '[{"value":15}]' }, b], '100000');
  assert.equal(pending.length, 6); assert.equal(pending.at(-1).id, 'ds_a');
  assert.deepEqual(updates.at(-1).ds_a.rows, []);
  assert.deepEqual(updates.at(-1).ds_b.rows, snapshotB.rows);
  controller.reconcile([{ ...a, content: '[{"value":15}]' }, b], '110000');
  assert.equal(pending[5].signal.aborted, true);
  assert.deepEqual(pending.slice(-2).map(item => item.code), ['110000', '110000']);
  assert.deepEqual(updates.at(-1).ds_a.rows, []); assert.deepEqual(updates.at(-1).ds_b.rows, []);
  pending[5].resolve([{ value: 999 }]); await Promise.resolve();
  assert.deepEqual(updates.at(-1).ds_a.rows, []);
  controller.dispose();
  assert.ok(pending.slice(-2).every(item => item.signal.aborted));
});

test('reconciliation preserves polling deadlines, visibility pauses and resumes without duplicate timers', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls = [], updates = [];
  const controller = createDataSourceController({ onChange: value => updates.push(value), loader: async (item, code) => { calls.push([item.id, code]); return [{ value: calls.length }]; } });
  const a = source({ id: 'ds_a', type: 'http', url: '/a', refreshSeconds: 1 }), b = source({ id: 'ds_b', type: 'http', url: '/b', refreshSeconds: 0 });
  controller.reconcile([a], '100000'); await Promise.resolve();
  t.mock.timers.tick(10000);
  controller.reconcile([a, b], '100000'); await Promise.resolve();
  assert.equal(calls.filter(([id]) => id === 'ds_a').length, 1);
  t.mock.timers.tick(5000); await Promise.resolve();
  assert.equal(calls.filter(([id]) => id === 'ds_a').length, 2, 'A must retain its original 15 second polling deadline');
  controller.reconcile([a], '100000');
  const beforePause = calls.length; controller.setActive(false);
  t.mock.timers.tick(60000); await Promise.resolve();
  await controller.refresh('ds_a');
  assert.equal(calls.length, beforePause, 'hidden sources do not poll or manually refresh');
  controller.setActive(true); await Promise.resolve();
  assert.equal(calls.length, beforePause + 1);
  controller.setActive(true); controller.reconcile([a], '100000');
  t.mock.timers.tick(15000); await Promise.resolve();
  assert.equal(calls.length, beforePause + 2, 'resume and no-op reconciliation must not duplicate timers');
  controller.dispose(); const beforeDispose = calls.length;
  t.mock.timers.tick(60000); await Promise.resolve();
  assert.equal(calls.length, beforeDispose);
});

test('data analysis finds a unique nested row path and keeps ambiguous paths explicit', () => {
  const content = JSON.stringify({ code: 200, data: { records: [{ device: { name: '中心' }, amount: '12', date: '2026-09-12', code: '001100' }] } });
  const analysis = analyzeDataContent(content);
  assert.equal(analysis.rowsPath, 'data.records');
  assert.equal(analysis.rows.length, 1);
  assert.deepEqual(analysis.fields.map(field => [field.path, field.type]), [['device.name', 'string'], ['amount', 'numeric-string'], ['date', 'time'], ['code', 'string']]);
  assert.equal(analysis.fields.find(field => field.path === 'amount').numericCount, 1);
  const ambiguous = JSON.stringify({ rows: [{ value: 1 }], history: [{ value: 2 }] });
  assert.equal(analyzeDataContent(ambiguous).rows, null);
  assert.deepEqual(analyzeDataContent(ambiguous).candidates, [{ path: 'rows', rowCount: 1 }, { path: 'history', rowCount: 1 }]);
  assert.deepEqual(analyzeDataContent(ambiguous, 'json', 'history').rows, [{ value: 2 }]);
  assert.deepEqual(analyzeDataContent('{"value":12}').rows, [{ value: 12 }]);
  assert.equal(analyzeDataContent('name,value\n中心,12', 'csv').rowsPath, '');
  assert.throws(() => analyzeDataContent('[]', 'json', '__proto__'), /路径/);
  assert.throws(() => analyzeDataContent('[1,2]'), /数据列表/);
  assert.throws(() => analyzeDataContent(JSON.stringify({ rows: Array.from({ length: 5001 }, () => ({ value: 1 })) })), /5000/);
  assert.throws(() => analyzeDataContent('中'.repeat(DATA_SIZE_LIMIT)), /1 MB/);
});

test('field profiles preserve nulls, identifiers and mixed types; suggestions preserve explicit mappings', () => {
  const rows = [
    { label: '华东', total: '12', time: '09:00', cityCode: 310000, missing: null, mixed: 1, flag: true },
    { label: '华北', total: '', time: '10:00', cityCode: 110000, missing: null, mixed: '坏值', flag: false },
  ];
  const fields = profileDataFields(rows);
  assert.equal(fields.find(field => field.path === 'total').missingCount, 1);
  assert.equal(fields.find(field => field.path === 'total').numericCount, 1);
  assert.equal(fields.find(field => field.path === 'cityCode').type, 'string');
  assert.equal(fields.find(field => field.path === 'mixed').type, 'mixed');
  assert.equal(fields.find(field => field.path === 'flag').type, 'boolean');
  assert.equal(fields.find(field => field.path === 'missing').type, 'empty');
  const suggested = suggestDataFields(fields);
  assert.equal(suggested.fields.name, 'label'); assert.equal(suggested.fields.value, 'total'); assert.equal(suggested.fields.time, 'time');
  const explicit = suggestDataFields(fields, { value: 'metrics.manual', name: 'label' });
  assert.equal(explicit.fields.value, 'metrics.manual'); assert.equal(explicit.fields.name, 'label');
  assert.ok(explicit.unresolved.includes('value'));
  const unresolved = suggestDataFields(profileDataFields([{ revenue: 1, expense: 2, region: '华东' }]));
  assert.equal(unresolved.fields.value, undefined); assert.ok(unresolved.ambiguous.includes('value'));
  assert.equal(suggestDataFields(profileDataFields([{ name: '首选', label: '次选', value: 1 }])).fields.name, 'name');
  const dotted = analyzeDataContent('region.name,value\n华东,12', 'csv').fields;
  assert.equal(dotted.find(field => field.path === 'region.name').selectable, false, 'literal dots cannot be read as nested paths');
  assert.equal(dotted.find(field => field.path === 'region.name').type, 'unsupported');
});

test('recommendations use valid mappings and avoid numeric charts for empty or ambiguous values', () => {
  const numeric = analyzeDataContent('[{"name":"A","value":12},{"name":"B","value":8}]');
  assert.ok(suggestDataWidgets(numeric).some(item => item.type === 'metric'));
  assert.ok(suggestDataWidgets(numeric).some(item => item.type === 'bar'));
  assert.ok(suggestDataWidgets(numeric).some(item => item.type === 'donut'));
  const events = analyzeDataContent('[{"name":"设备上线","time":"09:00","status":"正常"}]');
  assert.ok(suggestDataWidgets(events).some(item => item.type === 'table'));
  assert.ok(suggestDataWidgets(events).some(item => item.type === 'status'));
  assert.ok(!suggestDataWidgets(events).some(item => item.type === 'metric'));
  const missing = analyzeDataContent('[{"name":"A","value":12},{"name":"B","value":null}]');
  assert.ok(!suggestDataWidgets(missing).some(item => ['metric', 'bar', 'line'].includes(item.type)));
  assert.deepEqual(suggestDataWidgets(analyzeDataContent('[]')), []);
  for (const recommendation of suggestDataWidgets(numeric)) assert.doesNotThrow(() => getMappedData(numeric, { fields: recommendation.fields }, recommendation));
});

test('basic chart suggestions do not join multiple series or repeat time and ranking categories', () => {
  const analyze = rows => analyzeDataContent(JSON.stringify(rows));
  const types = rows => suggestDataWidgets(analyze(rows)).map(item => item.type);
  const timed = [
    { time: '09:00', series: '华东', value: 0 }, { time: '10:00', series: '华东', value: 180 }, { time: '11:00', series: '华东', value: 210 },
    { time: '09:00', series: '华北', value: 130 }, { time: '11:00', series: '华北', value: 195 },
  ];
  assert.ok(!types(timed).includes('line'));
  assert.ok(types(timed).includes('table')); assert.ok(types(timed).includes('multiLine'));
  assert.ok(types(timed.slice(0, 3)).includes('line'), 'single-series unique times still suggest a line, including zero values');
  assert.ok(!types([timed[0], { ...timed[0], time: ' 09:00 ' }]).includes('line'));
  assert.ok(!types([timed[0], { ...timed[4], time: '12:00' }]).includes('line'), 'distinct times cannot make two series one line');
  assert.ok(!types([{ time: '', value: 1 }, { time: '09:00', value: 2 }]).includes('line'));
  const ranked = [{ name: '设备', series: '华东', value: 10 }, { name: ' 设备 ', series: '华北', value: 12 }];
  assert.ok(!types(ranked).includes('bar')); assert.ok(types(ranked).includes('table')); assert.ok(types(ranked).includes('stacked'));
  assert.ok(types([{ ...ranked[0], name: '设备 A' }, { ...ranked[1], name: '设备 B' }]).includes('bar'));
  assert.ok(types([{ name: 'A', value: 0 }, { name: 'B', value: 12 }]).includes('bar'));
  for (const [rows, type] of [[timed, 'line'], [ranked, 'bar']]) {
    assert.doesNotThrow(() => getMappedData(analyze(rows), { fields: { name: 'name', time: 'time', series: 'series', value: 'value' } }, { type }), 'manual basic chart mapping remains unchanged');
  }
});

test('professional recommendations exclude duplicate coordinates and incomplete radar series', () => {
  const types = rows => suggestDataWidgets(analyzeDataContent(JSON.stringify(rows))).map(item => item.type);
  const timed = [{ time: '09:00', series: '当前', value: 2 }, { time: '10:00', series: '当前', value: 3 }];
  assert.ok(types(timed).includes('multiLine')); assert.ok(types(timed).includes('stacked'));
  assert.ok(!types([...timed, timed[0]]).includes('multiLine'));
  assert.ok(!types([...timed, timed[0]]).includes('stacked'));
  assert.ok(!types([{ name: 'A', value: 1, value2: 2 }, { name: ' A ', value: 2, value2: 3 }]).includes('combo'));
  assert.ok(!types([{ x: 0, y: 'A', value: 1 }, { x: '0', y: 'A', value: 2 }]).includes('heatmap'));
  const radar = ['A', 'B', 'C'].flatMap(name => [{ name, series: '当前', value: 1 }, { name, series: '对比', value: 2 }]);
  assert.ok(types(radar).includes('radar'));
  assert.ok(!types(radar.slice(1)).includes('radar'));
  assert.ok(!types([{ name: 'A', value: 1 }, { name: 'A', value: 2 }, { name: 'B', value: 2 }]).includes('radar'));
});

test('source inspection uses one GET for path discovery and does not change runtime row-path semantics', async () => {
  let calls = 0;
  const content = '{"data":{"records":[{"name":"华东","value":12}]}}';
  const remote = source({ type: 'http', url: '/metrics', rowsPath: '' });
  const fetcher = async () => { calls += 1; return new Response(content); };
  const analysis = await inspectDataSource(remote, '110000', { fetcher, preferredPath: undefined });
  assert.equal(calls, 1); assert.equal(analysis.rowsPath, 'data.records');
  assert.equal(analysis.content, content); assert.ok(analysis.elapsedMs >= 0);
  assert.deepEqual(analyzeDataContent(analysis.content, analysis.contentType, 'data.records').rows, analysis.rows);
  assert.equal(calls, 1, 'changing a discovered row path does not require another request');
  assert.equal(remote.rowsPath, '', 'inspection cannot mutate the saved source');
  assert.deepEqual(await loadDataSource(remote, '110000', { fetcher }), [{ data: { records: [{ name: '华东', value: 12 }] } }]);
});

test('inspection preserves saved root metrics and only an explicit inference changes the row path', async () => {
  const content = '{"value":100,"details":[{"name":"A","value":1},{"name":"B","value":2}]}';
  const metricBinding = { fields: { value: 'value' } };
  for (const type of ['json', 'http']) {
    let calls = 0;
    const saved = source({ type, content, url: type === 'http' ? '/metrics' : '', rowsPath: '' });
    const fetcher = async () => { calls += 1; return new Response(content); };
    const root = await inspectDataSource(saved, '100000', { fetcher });
    assert.equal(root.rowsPath, '');
    assert.equal(getMappedData(root, metricBinding, { type: 'metric' }).value, 100);
    assert.equal(calls, type === 'http' ? 1 : 0, 'default inspection makes at most one GET');
    const inferred = await inspectDataSource(saved, '100000', { fetcher, preferredPath: undefined });
    assert.equal(inferred.rowsPath, 'details');
    assert.equal(getMappedData(inferred, metricBinding, { type: 'metric' }).value, 3);
    assert.equal(calls, type === 'http' ? 2 : 0, 'explicit inference makes only one additional GET');
    assert.equal(saved.rowsPath, '', 'inspection does not mutate saved configuration');
    const returned = analyzeDataContent(inferred.content, inferred.contentType, '');
    assert.equal(getMappedData(returned, metricBinding, { type: 'metric' }).value, 100);
  }
  const rootArray = await inspectDataSource(source({ content: '[{"value":10},{"value":20}]' }));
  assert.equal(rootArray.rowsPath, ''); assert.equal(rootArray.rows.length, 2);
  const nested = await inspectDataSource(source({ content, rowsPath: 'details' }));
  assert.equal(nested.rowsPath, 'details'); assert.equal(nested.rows.length, 2);
});

test('professional charts enforce their coordinate and secondary-value contracts without changing legacy charts', () => {
  const fields = Object.fromEntries(['name', 'time', 'series', 'value', 'value2', 'x', 'y', 'target'].map(key => [key, key]));
  const mapped = (row, type) => getMappedData({ rows: [row] }, { fields }, { type });
  assert.deepEqual([mapped({ x: '1.5', y: 0 }, 'scatter').rows[0].x, mapped({ x: '1.5', y: 0 }, 'scatter').rows[0].y], [1.5, 0]);
  assert.equal(mapped({ x: 1, y: 2 }, 'scatter').rows[0].value, null);
  for (const row of [{ x: null, y: 2 }, { x: '', y: 2 }, { x: '坏值', y: 2 }, { x: 1, y: 2, value: -1 }, { x: 1, y: 2, value: '坏值' }]) assert.throws(() => mapped(row, 'scatter'));
  assert.equal(mapped({ x: '华东', y: 0, value: 3 }, 'heatmap').rows[0].x, '华东');
  assert.equal(mapped({ x: '华东', y: 0, value: 3 }, 'heatmap').rows[0].y, 0);
  assert.throws(() => mapped({ x: '华东', y: '', value: 3 }, 'heatmap'), /类别/);
  assert.throws(() => mapped({ x: '华东', y: 0, value: null }, 'heatmap'), /有效数字/);
  assert.equal(mapped({ name: '09:00', value: 2, value2: '3' }, 'combo').rows[0].value2, 3);
  assert.throws(() => mapped({ name: '09:00', value: 2 }, 'combo'), /第二数值/);
  for (const type of ['multiLine', 'stacked']) {
    assert.doesNotThrow(() => mapped({ name: '华东', series: '设备', value: 0 }, type));
    assert.throws(() => mapped({ name: '华东', value: 3 }, type), /系列/);
    assert.throws(() => mapped({ series: '设备', value: 3 }, type), /名称或时间/);
    assert.equal(mapped({ time: '09:00', series: '设备', value: 3 }, type).rows[0].name, '', 'a generated name must not hide the time category');
  }
  assert.doesNotThrow(() => mapped({ name: '覆盖率', value: 3 }, 'radar'));
  assert.throws(() => mapped({ name: '覆盖率', value: 3, target: 0 }, 'radar'), /大于 0/);
  for (const type of ['radar', 'funnel', 'treemap']) {
    assert.throws(() => mapped({ name: '阶段', value: -1 }, type), /非负/);
    assert.throws(() => mapped({ value: 3 }, type), /名称/);
  }
  assert.doesNotThrow(() => mapped({ value: -3, value2: 'unused', x: 'unused' }, 'line'));
});
