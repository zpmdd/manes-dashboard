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
  const numericBinding = { fields: { name: 'name', value: 'value', value2: 'value2' } };
  for (const value2 of [undefined, null, '', 0, '0', '1,234', '12%']) {
    const data = { rows: [{ name: 'A', value: 0, value2 }] }, shown = [{ key: 'name' }, { key: 'value2' }];
    const secondary = () => getMappedData(data, numericBinding, { type: 'table', columns: shown });
    if (['1,234', '12%'].includes(value2)) assert.throws(secondary, /第二数值/);
    else assert.equal(secondary().rows[0].value2, value2 === 0 || value2 === '0' ? 0 : null);
    assert.doesNotThrow(() => getMappedData(data, numericBinding, { type: 'table', columns: [{ key: 'name' }, { key: 'value' }] }));
    for (const type of ['metric', 'bar']) assert.equal(getMappedData(data, numericBinding, { type, columns: shown }).value, 0, 'unused secondary columns do not constrain other component types');
    if (value2 !== 0 && value2 !== '0') assert.throws(() => getMappedData(data, numericBinding, { type: 'combo' }), /第二数值/);
    else assert.equal(getMappedData(data, numericBinding, { type: 'combo' }).rows[0].value2, 0);
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
  const a = source({ id: 'ds_a', type: 'http', url: '/a?adcode={adcode}' }), b = source({ id: 'ds_b', type: 'http', url: '/b?adcode={adcode}' });
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
  controller.reconcile([{ ...a, name: ' 运行数据 ' }], '100000');
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
  controller.reconcile([{ ...a, url: '/a-updated?adcode={adcode}' }, b], '100000');
  assert.equal(pending.length, 6); assert.equal(pending.at(-1).id, 'ds_a');
  assert.deepEqual(updates.at(-1).ds_a.rows, []);
  assert.deepEqual(updates.at(-1).ds_b.rows, snapshotB.rows);
  controller.reconcile([{ ...a, url: '/a-updated?adcode={adcode}' }, b], '110000');
  assert.equal(pending[5].signal.aborted, true);
  assert.deepEqual(pending.slice(-2).map(item => item.code), ['110000', '110000']);
  assert.deepEqual(updates.at(-1).ds_a.rows, []); assert.deepEqual(updates.at(-1).ds_b.rows, []);
  pending[5].resolve([{ value: 999 }]); await Promise.resolve();
  assert.deepEqual(updates.at(-1).ds_a.rows, []);
  controller.dispose();
  assert.ok(pending.slice(-2).every(item => item.signal.aborted));
});

test('region changes reuse real JSON, CSV and fixed HTTP results while source configuration changes still reload', async () => {
  const calls = [], loads = [], requests = [], updates = [];
  const controller = createDataSourceController({ onChange: result => updates.push(result), loader: (item, code, options) => {
    calls.push([item.id, code]);
    const loading = loadDataSource(item, code, { ...options, fetcher: async url => { requests.push(url); return new Response('{"value":7,"data":[{"value":9}]}'); } });
    loads.push(loading); return loading;
  } });
  let sources = [source({ id: 'ds_json', content: '[{"value":0}]' }), source({ id: 'ds_csv', type: 'csv', content: 'name,value\n区域,2' }), source({ id: 'ds_fixed', type: 'http', url: '/fixed' })];
  try {
    controller.reconcile(sources, '100000'); await Promise.all(loads);
    const original = updates.at(-1), count = updates.length;
    assert.deepEqual(sources.map(item => original[item.id].rows[0].value), [0, '2', 7]);
    controller.reconcile(sources, '110000'); controller.reconcile(sources, '120000');
    assert.equal(calls.length, 3); assert.equal(requests.length, 1); assert.equal(updates.length, count);
    for (const item of sources) {
      assert.strictEqual(updates.at(-1)[item.id], original[item.id]);
      assert.strictEqual(updates.at(-1)[item.id].rows, original[item.id].rows);
    }
    sources = sources.map(item => item.id === 'ds_json' ? { ...item, content: '[{"value":3}]' } : item);
    controller.reconcile(sources, '120000'); await Promise.all(loads);
    assert.equal(calls.length, 4); assert.equal(updates.at(-1).ds_json.rows[0].value, 3);
    assert.strictEqual(updates.at(-1).ds_csv, original.ds_csv); assert.strictEqual(updates.at(-1).ds_fixed, original.ds_fixed);
    sources = sources.map(item => item.id === 'ds_fixed' ? { ...item, url: '/fixed-updated' } : item);
    controller.reconcile(sources, '120000'); await Promise.all(loads);
    assert.equal(requests.length, 2); assert.equal(new URL(requests.at(-1)).pathname, '/fixed-updated');
    sources = sources.map(item => item.id === 'ds_fixed' ? { ...item, rowsPath: 'data' } : item);
    controller.reconcile(sources, '120000'); await Promise.all(loads);
    assert.equal(requests.length, 3); assert.deepEqual(updates.at(-1).ds_fixed.rows, [{ value: 9 }]);
    assert.deepEqual(calls.slice(3), [['ds_json', '120000'], ['ds_fixed', '120000'], ['ds_fixed', '120000']]);
  } finally { controller.dispose(); }
});

test('fixed HTTP keeps in-flight loads, stale errors and polling deadlines across regions, then refreshes with the latest code', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls = [], loads = [], pending = [], updates = [];
  const controller = createDataSourceController({ onChange: result => updates.push(result), loader: (item, code, options) => {
    calls.push(code);
    const loading = loadDataSource(item, code, { ...options, fetcher: (url, { signal }) => new Promise((resolve, reject) => pending.push({ url, signal, resolve, reject })) });
    loads.push(loading); return loading;
  } });
  const fixed = source({ id: 'ds_fixed', type: 'http', url: '/fixed', refreshSeconds: 15 });
  try {
    controller.reconcile([fixed], '100000');
    const inFlight = updates.at(-1).ds_fixed;
    t.mock.timers.tick(10000); controller.reconcile([fixed], '110000');
    assert.equal(pending.length, 1); assert.equal(pending[0].signal.aborted, false);
    assert.strictEqual(updates.at(-1).ds_fixed, inFlight);
    pending[0].resolve(new Response('[{"value":0}]')); await loads[0]; await Promise.resolve();
    const ready = updates.at(-1).ds_fixed;
    t.mock.timers.tick(4999); assert.equal(pending.length, 1);
    t.mock.timers.tick(1); assert.equal(pending.length, 2); assert.equal(calls[1], '110000');
    controller.reconcile([fixed], '120000'); assert.equal(pending[1].signal.aborted, false);
    pending[1].reject(new TypeError('Failed to fetch')); await assert.rejects(loads[1], /网络/); await Promise.resolve();
    const failed = updates.at(-1).ds_fixed;
    assert.equal(failed.status, 'error'); assert.equal(failed.stale, true);
    assert.strictEqual(failed.rows, ready.rows); assert.equal(failed.updatedAt, ready.updatedAt);
    const beforeChange = updates.length;
    controller.reconcile([fixed], '130000');
    assert.strictEqual(updates.at(-1).ds_fixed, failed); assert.equal(updates.length, beforeChange); assert.equal(pending.length, 2);
    const manual = controller.refresh('ds_fixed'); assert.equal(calls[2], '130000');
    pending[2].resolve(new Response('[{"value":5}]')); await manual;
    assert.equal(updates.at(-1).ds_fixed.rows[0].value, 5);
    controller.reconcile([fixed], '140000'); t.mock.timers.tick(15000);
    assert.equal(pending.length, 4); assert.equal(calls[3], '140000', 'the original polling closure uses the latest effective code');
    pending[3].resolve(new Response('[{"value":6}]')); await loads[3]; await Promise.resolve();
    assert.equal(updates.at(-1).ds_fixed.rows[0].value, 6);
    assert.ok(pending.every(request => new URL(request.url).pathname === '/fixed'));
  } finally { controller.dispose(); }
});

test('adcode HTTP still clears old snapshots, aborts superseded regions and ignores late real responses', async () => {
  const pending = [], loads = [], updates = [];
  const controller = createDataSourceController({ onChange: result => updates.push(result), loader: (item, code, options) => {
    const loading = loadDataSource(item, code, { ...options, fetcher: (url, { signal }) => new Promise(resolve => pending.push({ url, signal, resolve })) });
    loads.push(loading); return loading;
  } });
  const regional = source({ type: 'http', url: '/metrics?adcode={adcode}' });
  try {
    controller.reconcile([regional], '100000');
    pending[0].resolve(new Response('[{"value":100}]')); await loads[0]; await Promise.resolve();
    assert.equal(updates.at(-1).ds_test.rows[0].value, 100);
    controller.reconcile([regional], '110000');
    assert.deepEqual(updates.at(-1).ds_test.rows, []); assert.equal(updates.at(-1).ds_test.stale, false);
    controller.reconcile([regional], '120000');
    assert.equal(pending[1].signal.aborted, true); assert.equal(pending[2].signal.aborted, false);
    assert.deepEqual(pending.map(request => new URL(request.url).searchParams.get('adcode')), ['100000', '110000', '120000']);
    pending[2].resolve(new Response('[{"value":120}]')); await loads[2]; await Promise.resolve();
    const latest = updates.at(-1).ds_test;
    pending[1].resolve(new Response('[{"value":110}]')); await loads[1]; await Promise.resolve();
    assert.strictEqual(updates.at(-1).ds_test, latest); assert.deepEqual(latest.rows, [{ value: 120 }]);
  } finally { controller.dispose(); }
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

test('visibility resumes HTTP while reusing ready static rows and restarting changed or interrupted static loads', async () => {
  const calls = [], loads = [], pending = []; let snapshot;
  const controller = createDataSourceController({ onChange: result => { snapshot = result; }, loader: (item, code, options) => {
    calls.push(item.id);
    const load = () => loadDataSource(item, code, { ...options, fetcher: async () => new Response('[{"value":7}]') });
    const loading = item.id === 'ds_pending' ? new Promise(resolve => pending.push({ resolve, signal: options.signal })).then(load) : load();
    loads.push(loading); return loading;
  } });
  const settle = async () => { await Promise.all(loads); await Promise.resolve(); };
  const count = id => calls.filter(value => value === id).length;
  let sources = [source({ id: 'ds_json', content: '[{"value":1}]' }), source({ id: 'ds_csv', type: 'csv', content: 'name,value\n区域,2' }), source({ id: 'ds_empty', content: '[]' }), source({ id: 'ds_http', type: 'http', url: '/fixed' })];
  try {
    controller.reconcile(sources, '100000', false);
    assert.equal(calls.length, 0, 'initially hidden sources wait until visible');
    controller.setActive(true); await settle();
    const ready = snapshot;
    assert.deepEqual(ready.ds_empty.rows, []); assert.equal(ready.ds_empty.status, 'ready');
    controller.setActive(false); controller.setActive(true); await settle();
    assert.equal(count('ds_http'), 2, 'HTTP reloads on visibility resume even without polling');
    for (const id of ['ds_json', 'ds_csv', 'ds_empty']) {
      assert.equal(count(id), 1); assert.strictEqual(snapshot[id], ready[id]);
      assert.strictEqual(snapshot[id].rows, ready[id].rows);
    }
    controller.setActive(false);
    sources = sources.map(item => item.id === 'ds_json' ? { ...item, content: '[{"value":3}]' } : item);
    controller.reconcile(sources, '110000', false);
    assert.equal(snapshot.ds_json, undefined); assert.equal(count('ds_json'), 1);
    controller.setActive(true); await settle();
    assert.equal(count('ds_json'), 2); assert.equal(snapshot.ds_json.rows[0].value, 3);
    assert.strictEqual(snapshot.ds_csv, ready.ds_csv); assert.strictEqual(snapshot.ds_empty, ready.ds_empty);
    await controller.refresh('ds_json'); assert.equal(count('ds_json'), 3, 'explicit refresh remains available');
    sources = [...sources, source({ id: 'ds_pending', content: '[{"value":42}]' })];
    controller.reconcile(sources, '110000');
    const oldLoad = loads.at(-1);
    controller.setActive(false); assert.equal(pending[0].signal.aborted, true);
    controller.setActive(true); assert.equal(pending.length, 2);
    pending[0].resolve(); await oldLoad; await Promise.resolve();
    assert.equal(snapshot.ds_pending.status, 'loading'); assert.deepEqual(snapshot.ds_pending.rows, []);
    pending[1].resolve(); await settle();
    assert.equal(snapshot.ds_pending.rows[0].value, 42); assert.equal(snapshot.ds_pending.status, 'ready');
    const recovered = snapshot.ds_pending;
    controller.setActive(false); controller.setActive(true); await settle();
    assert.equal(count('ds_pending'), 2); assert.strictEqual(snapshot.ds_pending, recovered);
    assert.equal(count('ds_http'), 5);
  } finally { controller.dispose(); }
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
  for (const type of ['json', 'csv']) for (const withRevenue of [false, true]) {
    const row = { device_no: ' 001100 ', ...(withRevenue ? { revenue: 0 } : {}) };
    const content = type === 'json' ? JSON.stringify([row]) : `${Object.keys(row).join(',')}\n${Object.values(row).join(',')}`;
    const analysis = analyzeDataContent(content, type), chosen = suggestDataFields(analysis.fields).fields;
    const identifier = analysis.fields.find(field => field.path === 'device_no');
    assert.equal(identifier.type, 'string', 'surrounding spaces cannot turn a leading-zero identifier into a metric');
    assert.equal(identifier.sample, ' 001100 '); assert.equal(analysis.rows[0].device_no, ' 001100 ');
    assert.equal(chosen.name, 'device_no'); assert.equal(chosen.value, withRevenue ? 'revenue' : undefined);
    const recommendations = suggestDataWidgets(analysis);
    if (!withRevenue) assert.deepEqual(recommendations.map(item => item.type), ['table']);
    else assert.ok(recommendations.some(item => item.type === 'metric'));
    const table = recommendations.find(item => item.type === 'table'), mapped = getMappedData(analysis, { fields: table.fields }, table);
    assert.equal(mapped.rows[0].name, ' 001100 ');
    assert.equal(mapped.rows[0].value, withRevenue ? 0 : null); assert.equal(mapped.value, withRevenue ? 0 : null);
  }
});

test('field profiling preserves mixed parent samples and array properties discovered by object rows', () => {
  const summarize = rows => profileDataFields(rows).map(field => {
    assert.equal(field.rowCount, rows.length); assert.equal(field.sample, field.examples[0] || '');
    return [field.path, field.type, field.examples, field.missingCount, field.numericCount, field.selectable];
  });
  assert.deepEqual(summarize([{ metrics: { value: 0 } }, { metrics: 3 }, { metrics: null }, { metrics: {} }, { metrics: { value: 7 } }, {}, { metrics: { value: null } }]), [
    ['metrics.value', 'number', ['0', '7'], 5, 2, true],
    ['metrics', 'mixed', ['{"value":0}', '3', '{}'], 2, 1, true],
  ]);
  assert.deepEqual(summarize([{ metrics: [{ total: 0 }, 9] }, { metrics: { 0: { total: 7 }, 1: 8, length: 2 } }, { metrics: [] }, { metrics: null }]), [
    ['metrics', 'mixed', ['[{"total":0},9]', '{"0":{"total":7},"1":8,"length":2}', '[]'], 1, 0, true],
    ['metrics.0.total', 'number', ['0', '7'], 2, 2, true],
    ['metrics.1', 'number', ['9', '8'], 2, 2, true],
    ['metrics.length', 'number', ['2', '0'], 1, 3, true],
  ]);
});

test('field profiling keeps dotted keys unsupported and empty paths bound to the root row', () => {
  assert.deepEqual(profileDataFields([{ region: { name: '嵌套' } }, { 'region.name': '字面键' }, { region: { name: '仍是嵌套' } }]), [
    { path: 'region.name', type: 'unsupported', examples: [], sample: '', missingCount: 3, numericCount: 0, rowCount: 3, selectable: false },
  ]);
  const rows = [{ '': 1, marker: 'A' }, { '': null, marker: 'B' }, { marker: 'C' }];
  assert.deepEqual(profileDataFields(rows).find(field => field.path === ''), {
    path: '', type: 'mixed', examples: rows.map(row => JSON.stringify(row)), sample: JSON.stringify(rows[0]), missingCount: 0, numericCount: 0, rowCount: 3, selectable: true,
  });
  assert.deepEqual(profileDataFields([{ '': { name: '被空键包裹' }, name: '根字段A' }, { '': { name: '被包裹B' } }, { name: '根字段C' }]), [
    { path: 'name', type: 'string', examples: ['根字段A', '根字段C'], sample: '根字段A', missingCount: 1, numericCount: 0, rowCount: 3, selectable: true },
  ]);
});

test('field profiling keeps the first distinct samples in row order without probing every row for every field', () => {
  assert.deepEqual(profileDataFields([{ x: 3 }, { x: 3 }, { x: null }, { x: '2' }, {}, { x: 1 }, { x: 0 }]), [
    { path: 'x', type: 'numeric-string', examples: ['3', '2', '1'], sample: '3', missingCount: 2, numericCount: 5, rowCount: 7, selectable: true },
  ]);
  let probes = 0;
  const rows = Array.from({ length: 24 }, (_, i) => new Proxy({ [`field_${i}`]: i }, {
    getOwnPropertyDescriptor(target, key) { probes += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
  }));
  const fields = profileDataFields(rows);
  assert.equal(fields.length, rows.length);
  assert.ok(fields.every((field, i) => field.numericCount === 1 && field.missingCount === rows.length - 1 && field.sample === String(i)));
  assert.ok(probes <= rows.length * 4, `sparse fields should visit actual own properties, not every field in every row (${probes} probes)`);
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
  for (const type of ['json', 'csv']) {
    for (const value2 of ['1,234', '12%']) {
      const content = type === 'json' ? JSON.stringify([{ name: 'A', value: 0, value2 }]) : `name,value,value2\nA,0,"${value2}"`;
      const analysis = analyzeDataContent(content, type), recommendations = suggestDataWidgets(analysis);
      assert.ok(!recommendations.some(item => item.type === 'table'), 'a displayed malformed secondary value cannot silently become an empty table cell');
      for (const widget of ['metric', 'bar']) assert.ok(recommendations.some(item => item.type === widget));
      const textAndValue = suggestDataWidgets(analysis, { value2: '' }).find(item => item.type === 'table');
      assert.ok(textAndValue); assert.ok(!textAndValue.columns.some(column => column.key === 'value2'));
      assert.equal(getMappedData(analysis, { fields: textAndValue.fields }, textAndValue).value, 0);
    }
    for (const target of [0, -1, 10]) {
      const content = type === 'json' ? JSON.stringify([{ name: 'A', value: 0, target }]) : `name,value,target\nA,0,${target}`;
      const analysis = analyzeDataContent(content, type), fields = suggestDataFields(analysis.fields).fields, recommendations = suggestDataWidgets(analysis);
      assert.equal(recommendations.some(item => item.type === 'progress'), target > 0);
      const progress = () => getMappedData(analysis, { fields }, { type: 'progress' });
      if (target <= 0) assert.throws(progress, /目标值必须大于 0/);
      else { assert.equal(progress().rows[0].target, target); assert.equal(progress().value, 0); }
      for (const widget of ['metric', 'table']) {
        const item = recommendations.find(entry => entry.type === widget); assert.ok(item);
        assert.equal(getMappedData(analysis, { fields: item.fields }, item).rows[0].target, target, 'non-progress consumers keep the supplied numeric target');
      }
    }
  }
});

test('manual primary and secondary mappings resolve ambiguous numbers and preserve zero in combo recommendations', () => {
  const analysis = analyzeDataContent('[{"region":"华东","revenue":0,"cost":5},{"region":"华北","revenue":12,"cost":0}]');
  assert.ok(!suggestDataWidgets(analysis).some(item => item.type === 'combo'));
  const overrides = { value: 'revenue', value2: 'cost' };
  const fields = suggestDataFields(analysis.fields, overrides).fields;
  assert.deepEqual(fields, { ...overrides, name: 'region' });
  const combo = suggestDataWidgets(analysis, overrides).find(item => item.type === 'combo');
  assert.ok(combo, 'manual choices must immediately enable a valid dual-value chart');
  assert.deepEqual(combo.fields, fields);
  const mapped = getMappedData(analysis, { fields: combo.fields }, combo);
  assert.deepEqual(mapped.rows.map(({ name, value, value2 }) => [name, value, value2]), [['华东', 0, 5], ['华北', 12, 0]]);
  assert.equal(mapped.value, 12);
  assert.deepEqual(overrides, { value: 'revenue', value2: 'cost' }, 'suggestions do not mutate manual choices');
});

test('explicit empty mappings stay disabled through aliases, numeric fallback and widget recommendations', () => {
  for (const row of [{ region: '华东', value: 0, value2: 5 }, { region: '华东', revenue: 0 }]) {
    const analysis = analyzeDataContent(JSON.stringify([row]));
    const overrides = { value: '', value2: '' };
    const suggested = suggestDataFields(analysis.fields, overrides);
    assert.equal(suggested.fields.value, '', 'an explicit empty primary field cannot be inferred again');
    assert.equal(suggested.fields.value2, '', 'an explicit empty secondary field cannot be inferred again');
    assert.equal(suggested.fields.name, 'region');
    const recommendations = suggestDataWidgets(analysis, overrides);
    assert.ok(recommendations.some(item => item.type === 'table'));
    assert.ok(!recommendations.some(item => ['metric', 'bar', 'combo'].includes(item.type)));
    for (const item of recommendations) {
      assert.equal(item.fields.value, ''); assert.equal(item.fields.value2, '');
      assert.ok(!item.columns.some(column => ['value', 'value2'].includes(column.key)));
      assert.equal(getMappedData(analysis, { fields: item.fields }, item).rows[0].value, null);
    }
  }
  const analysis = analyzeDataContent('[{"region":"华东","value":0,"value2":5}]');
  const recommendations = suggestDataWidgets(analysis, { value2: '' });
  assert.ok(recommendations.some(item => item.type === 'metric'));
  assert.ok(!recommendations.some(item => item.type === 'combo'), 'disabling only the secondary field removes combo');
});

async function dataSourcePanelHarness(sources) {
  const [{ readFile }, { transformWithEsbuild }, dataSources, inference, config] = await Promise.all([
    import('node:fs/promises'), import('vite'), import('../src/dataSources.js'), import('../src/dataInference.js'), import('../src/dashboardConfig.js'),
  ]);
  const panelSource = await readFile(new URL('../src/DataSourcePanel.jsx', import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(panelSource.slice(panelSource.indexOf('const EXAMPLE')).replace('export function', 'function'), 'DataSourcePanel.jsx', { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'Fragment', sourcemap: false });
  const state = [], created = []; let cursor = 0, regionCode = '100000', dirty = false, effects = [];
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const useState = initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { const next = typeof value === 'function' ? value(state[index]) : value; if (!Object.is(next, state[index])) { state[index] = next; dirty = true; } }];
  };
  const useMemo = (factory, deps) => {
    const index = cursor++, previous = state[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) state[index] = { value: factory(), deps };
    return state[index].value;
  };
  const useEffect = (effect, deps) => {
    const index = cursor++, previous = state[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects.push(() => {
      previous?.cleanup?.(); state[index] = { deps, cleanup: effect() };
    });
  };
  // Run the component's actual JSX callbacks with persistent hook cells, as in editor-events.test.mjs.
  const runtime = { ...dataSources, ...inference, ...config, useState, useMemo, useEffect, useRef: initial => useState(() => ({ current: initial }))[0], document: { activeElement: null }, h: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment', ...Object.fromEntries(['ArrowsClockwise', 'Check', 'Database', 'Plus', 'Trash', 'UploadSimple', 'X'].map(name => [name, name])) };
  const Component = new Function(...Object.keys(runtime), `${code}; return DataSourcePanel;`)(...Object.values(runtime));
  const nodes = () => {
    let result, renders = 0;
    const visit = value => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') { result.push(value); value.children?.forEach(visit); }
    };
    do {
      assert.ok(renders++ < 10, 'panel effects settle without a render loop');
      cursor = 0; dirty = false; effects = []; result = [];
      visit(Component({ sources, code: regionCode, onChange() {}, onClose() {}, onCreateComponent: payload => { created.push(payload); return false; } }));
      for (const node of result) if (node.props.ref && !node.props.ref.current) node.props.ref.current = node.type === 'dialog' ? modal : { click() {} };
      effects.forEach(effect => effect());
    } while (dirty);
    return result;
  };
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, 'expected panel control is present'); return node.props; };
  return {
    created, nodes, find, modal,
    setCode: code => { regionCode = code; return nodes(); },
    dispose: () => state.forEach(cell => cell?.cleanup?.()),
    field: label => find(node => node.type === 'select' && node.props['aria-label'] === label),
    read: () => find(node => node.type === 'button' && node.props.className === 'ds-test' && node.props.onClick).onClick(),
    choose: id => find(node => node.type === 'button' && node.props.key === id).onClick(),
  };
}

test('real data-source panel selectors create the chosen combo and reset overrides only when source data changes', async () => {
  const financial = [{ region: '华东', revenue: 0, cost: 5 }, { region: '华北', revenue: 12, cost: 0 }];
  const standard = [{ region: '华南', value: 0, value2: 3 }];
  const panel = await dataSourcePanelHarness([source({ id: 'ds_a', content: JSON.stringify(financial) }), source({ id: 'ds_b', content: JSON.stringify(standard) })]);
  const change = (control, value) => control.onChange({ target: { value } });
  const setPair = (item, value, value2) => { change(item.field('主数值'), value); change(item.field('第二数值'), value2); };
  const pair = item => [item.field('主数值').value, item.field('第二数值').value];
  const hasCombo = item => item.nodes().some(node => node.type === 'button' && node.props.key === 'combo');
  await panel.read(); assert.equal(hasCombo(panel), false);
  setPair(panel, 'revenue', 'cost'); assert.equal(hasCombo(panel), true);
  panel.choose('combo');
  await panel.find(node => node.type === 'button' && node.children.some(child => child === '添加')).onClick();
  assert.equal(panel.created.length, 1);
  const payload = panel.created[0];
  assert.equal(payload.sourceId, 'ds_a'); assert.equal(payload.type, 'combo');
  assert.deepEqual(payload.fields, { value: 'revenue', value2: 'cost', name: 'region' });
  assert.deepEqual(getMappedData({ rows: financial }, { fields: payload.fields }, payload).rows.map(row => [row.value, row.value2]), [[0, 5], [12, 0]]);
  await panel.read(); assert.deepEqual(pair(panel), ['revenue', 'cost'], 're-reading unchanged data keeps manual mappings');
  setPair(panel, '', ''); await panel.read();
  assert.deepEqual(pair(panel), ['', '']); assert.equal(hasCombo(panel), false);
  panel.choose('ds_a'); assert.deepEqual(pair(panel), ['', ''], 'clicking the selected source keeps explicit empty fields');
  change(panel.find(node => node.type === 'input' && node.props.maxLength === 40), '修改名称');
  await panel.read(); assert.deepEqual(pair(panel), ['', ''], 'renaming the source does not re-enable disabled fields');
  panel.choose('ds_b'); await panel.read();
  assert.deepEqual(pair(panel), ['value', 'value2'], 'another source cannot inherit disabled fields');
  setPair(panel, 'value2', 'value'); panel.choose('ds_a'); await panel.read();
  assert.deepEqual(pair(panel), ['', ''], 'another source cannot inherit selected field names');
  setPair(panel, 'revenue', 'cost');
  change(panel.find(node => node.type === 'textarea'), JSON.stringify(standard));
  await panel.read(); assert.deepEqual(pair(panel), ['value', 'value2'], 'changing the content clears obsolete fields');

  const nested = await dataSourcePanelHarness([source({ content: JSON.stringify({ current: financial, next: standard }), rowsPath: 'current' })]);
  await nested.read(); setPair(nested, 'revenue', 'cost');
  change(nested.find(node => node.type === 'select' && node.props.value === 'current'), 'next');
  assert.deepEqual(pair(nested), ['value', 'value2'], 'choosing a different row list clears obsolete fields');
  setPair(nested, '', '');
  change(nested.find(node => node.type === 'input' && node.props.maxLength === 160), 'current');
  await nested.read(); assert.deepEqual(pair(nested), ['', '']);
  change(nested.find(node => node.type === 'input' && node.props.maxLength === 160), 'next');
  await nested.read(); assert.deepEqual(pair(nested), ['value', 'value2'], 'editing the row path also clears explicit empty fields');
});

test('real data-source panel invalidates regional HTTP previews on code changes while preserving drafts and fixed sources', async t => {
  const pending = [], panels = [];
  t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise(resolve => pending.push({ url, signal, resolve })));
  const open = async item => { const panel = await dataSourcePanelHarness([item]); panels.push(panel); panel.nodes(); assert.equal(panel.modal.open, true, 'the real mount effect opens the modal stub'); return panel; };
  const preview = panel => panel.nodes().find(node => node.props.className === 'ds-preview');
  const change = (control, value) => control.onChange({ target: { value } });
  const payload = name => new Response(JSON.stringify([{ region: name, revenue: 0, cost: 5 }]));
  try {
    const regional = await open(source({ type: 'http', url: '/metrics?adcode={adcode}' }));
    change(regional.find(node => node.type === 'input' && node.props.maxLength === 40), '保留草稿名称');
    const first = regional.read(); pending[0].resolve(payload('全国')); await first;
    change(regional.field('主数值'), 'revenue'); change(regional.field('第二数值'), 'cost');
    assert.ok(preview(regional));
    regional.setCode('110000');
    assert.equal(preview(regional), undefined); assert.equal(pending.length, 1, 'changing the effective region clears the preview without an automatic GET');
    assert.equal(regional.find(node => node.type === 'input' && node.props.maxLength === 40).value, '保留草稿名称');
    assert.equal(regional.find(node => node.type === 'input' && node.props.maxLength === 2048).value, '/metrics?adcode={adcode}');
    const second = regional.read(); pending[1].resolve(payload('北京')); await second;
    assert.equal(new URL(pending[1].url).searchParams.get('adcode'), '110000');
    assert.deepEqual([regional.field('主数值').value, regional.field('第二数值').value], ['revenue', 'cost']);
    regional.setCode('100000'); const old = regional.read();
    regional.setCode('120000'); assert.equal(pending[2].signal.aborted, true);
    pending[2].resolve(payload('迟到的全国')); await old;
    assert.equal(preview(regional), undefined, 'an aborted old-region response cannot restore a stale preview');
    assert.equal(pending.length, 3);
    const current = regional.read(); pending[3].resolve(payload('天津')); await current;
    assert.deepEqual(pending.map(request => new URL(request.url).searchParams.get('adcode')), ['100000', '110000', '100000', '120000']);
    assert.ok(regional.nodes().some(node => node.type === 'td' && node.children.includes('天津')));
    assert.ok(!regional.nodes().some(node => node.type === 'td' && node.children.includes('迟到的全国')));
    assert.deepEqual([regional.field('主数值').value, regional.field('第二数值').value], ['revenue', 'cost']);

    const fixed = await open(source({ type: 'http', url: '/fixed' })), fixedRead = fixed.read();
    fixed.setCode('110000'); assert.equal(pending[4].signal.aborted, false);
    pending[4].resolve(new Response('{"value":100,"details":[{"value":1}]}')); await fixedRead;
    const fixedPreview = preview(fixed); assert.ok(fixedPreview);
    assert.ok(fixed.nodes().some(node => node.props.className === 'ds-mapped-summary' && node.children.includes(' · 汇总 100')), 'saved root-path semantics are retained');
    fixed.setCode('120000'); assert.deepEqual(preview(fixed), fixedPreview); assert.equal(pending.length, 5);

    for (const item of [source({ content: '{"value":100,"details":[{"value":1}]}' }), source({ type: 'csv', content: 'name,value\n区域,0' })]) {
      const local = await open(item), reading = local.read();
      local.setCode('110000'); await reading;
      const localPreview = preview(local); assert.ok(localPreview, 'static inspection in flight survives a code prop change');
      assert.equal(local.field('主数值').value, 'value');
      local.setCode('120000'); assert.deepEqual(preview(local), localPreview);
    }
    assert.equal(pending.length, 5, 'fixed and static sources do not start replacement requests for code changes');
  } finally { panels.forEach(panel => { panel.dispose(); assert.equal(panel.modal.open, false, 'real effect cleanup closes the modal'); }); }
});

test('real data-source panel bounds 5000 fields while paging, searching and preserving selected mappings', async () => {
  const row = { metrics: {} }, paths = [];
  for (let group = 0; group < 5; group += 1) {
    row.metrics[`group_${group}`] = {};
    for (let bucket = 0; bucket < 25; bucket += 1) {
      const fields = {};
      for (let field = 0; field < 40; field += 1) {
        const index = paths.length, key = index === 0 ? 'name' : index === 4999 ? 'value' : `field_${field}`;
        paths.push(`metrics.group_${group}.bucket_${bucket}.${key}`); fields[key] = index === 0 ? '区域A' : index;
      }
      row.metrics[`group_${group}`][`bucket_${bucket}`] = fields;
    }
  }
  assert.equal(profileDataFields([row]).length, 5000, 'field analysis still includes every field');
  const panel = await dataSourcePanelHarness([source({ id: 'ds_large', content: JSON.stringify([row]) }), source({ id: 'ds_small', content: '[{"name":"区域B","value":7}]' })]);
  const control = label => panel.find(node => node.props['aria-label'] === label);
  const change = (item, value) => item.onChange({ target: { value } });
  const visiblePaths = nodes => nodes.filter(node => node.type === 'strong' && node.props.title?.startsWith('metrics.')).map(node => node.props.title);
  const bounded = nodes => {
    assert.ok(nodes.length <= 1800, `the panel renders a bounded field page (${nodes.length} nodes)`);
    assert.ok(nodes.filter(node => node.type === 'option').length <= 1023, 'all field selectors share the same bounded page');
    assert.ok(visiblePaths(nodes).length <= 100);
  };
  await panel.read();
  assert.equal(panel.field('主数值').value, paths.at(-1), 'an off-page numeric field still supplies the complete recommendation');
  assert.ok(panel.nodes().some(node => node.type === 'button' && node.props.key === 'metric'));
  change(panel.field('主数值'), paths[1]);
  const visited = [];
  for (let page = 0; page < 50; page += 1) {
    if (page === 1) change(panel.field('第二数值'), paths[100]);
    const nodes = panel.nodes(); bounded(nodes);
    assert.deepEqual(visiblePaths(nodes), paths.slice(page * 100, (page + 1) * 100));
    visited.push(...visiblePaths(nodes));
    assert.equal(panel.field('主数值').value, paths[1]);
    if (page > 0) assert.equal(panel.field('第二数值').value, paths[100]);
    assert.equal(control('上一页字段').disabled, page === 0);
    assert.equal(control('下一页字段').disabled, page === 49);
    if (page < 49) control('下一页字段').onClick();
  }
  assert.deepEqual(visited, paths, 'all 5000 fields remain reachable, in their original order');
  control('上一页字段').onClick(); assert.deepEqual(visiblePaths(panel.nodes()), paths.slice(4800, 4900));
  change(control('搜索字段'), '没有匹配的字段');
  const empty = panel.nodes(); bounded(empty);
  assert.deepEqual(visiblePaths(empty), []);
  assert.equal(control('搜索字段').value, '没有匹配的字段', 'the search control stays present for an empty result');
  for (const [label, selected] of [['主数值', paths[1]], ['第二数值', paths[100]]]) {
    const select = empty.find(node => node.type === 'select' && node.props['aria-label'] === label);
    assert.equal(select.props.value, selected);
    assert.ok(select.children.flat(Infinity).some(node => node?.type === 'option' && node.props.value === selected), 'an off-page selection remains a real option');
  }
  assert.ok(empty.some(node => node.type === 'button' && node.props.key === 'combo'), 'search does not change mapping or recommendations');
  change(control('搜索字段'), paths.at(-1));
  assert.deepEqual(visiblePaths(panel.nodes()), [paths.at(-1)]);
  change(control('搜索字段'), 'metrics.group_4'); control('下一页字段').onClick();
  panel.choose('ds_small'); await panel.read();
  assert.equal(panel.field('主数值').value, 'value'); assert.equal(panel.field('第二数值').value, '');
  assert.ok(!panel.nodes().some(node => ['搜索字段', '上一页字段', '下一页字段'].includes(node.props['aria-label'])));
  panel.choose('ds_large'); await panel.read();
  assert.equal(control('搜索字段').value, ''); assert.equal(control('上一页字段').disabled, true);
  assert.deepEqual(visiblePaths(panel.nodes()), paths.slice(0, 100));
  assert.equal(panel.field('主数值').value, paths.at(-1)); assert.equal(panel.field('第二数值').value, '');
  const exactly100 = Array.from({ length: 100 }, (_, i) => ({ metrics: { [`field_${i}`]: i } }));
  change(panel.find(node => node.type === 'textarea'), JSON.stringify(exactly100)); await panel.read();
  assert.equal(visiblePaths(panel.nodes()).length, 100);
  assert.ok(!panel.nodes().some(node => ['搜索字段', '上一页字段', '下一页字段'].includes(node.props['aria-label'])), '100 fields need no paging controls');
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
  for (const target of [undefined, null, '']) {
    const progress = mapped({ name: '完成量', value: 0, target }, 'progress');
    assert.equal(progress.rows[0].target, null); assert.equal(progress.value, 0, 'missing progress targets remain available for the configured fallback');
  }
  for (const type of ['radar', 'funnel', 'treemap']) {
    assert.throws(() => mapped({ name: '阶段', value: -1 }, type), /非负/);
    assert.throws(() => mapped({ value: 3 }, type), /名称/);
  }
  assert.doesNotThrow(() => mapped({ value: -3, value2: 'unused', x: 'unused' }, 'line'));
});
