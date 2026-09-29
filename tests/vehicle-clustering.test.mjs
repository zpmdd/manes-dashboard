import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import raw from '../src/projects/daoyan-vehicles.json' with { type: 'json' };
import { analyzeVehicles, dbscan, haversineKm, parseGpsTime, clusterOptions, EARTH_RADIUS_KM } from '../src/vehicleClustering.js';
import { runBatch } from '../scripts/cluster-vehicles.mjs';
import { loadDataSource } from '../src/dataSources.js';
import { vehicleDataResult, linkedVehicles } from '../src/vehicles.js';
import { normalizeConfig, defaultConfigForProject } from '../src/dashboardConfig.js';
import daoyan from '../src/projects/daoyan.js';

test('原始五车快照：1–4 成簇，5 为噪声，球面中心与覆盖距离可核验', () => {
  const before = JSON.stringify(raw), result = analyzeVehicles(raw), window = result.windows[0];
  assert.equal(result.rejected.length, 0); assert.equal(result.windows.length, 1);
  assert.deepEqual(window.rows.map(row => row.CLUSTER_LABEL), [0, 0, 0, 0, -1]);
  assert.deepEqual(window.rows.map(row => row.POINT_ROLE), ['core', 'core', 'core', 'core', 'noise']);
  assert.equal(window.clusters[0].vehicleCount, 4);
  assert(Math.abs(window.clusters[0].center[0] - 116.52285725) < 1e-8);
  assert(Math.abs(window.clusters[0].center[1] - 39.862753) < 1e-8);
  assert(window.clusters[0].radiusKm > .027 && window.clusters[0].radiusKm < .028);
  assert.equal(window.windowStart, '2026-09-12T16:00:00.000Z');
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(analyzeVehicles([...raw].reverse()).windows[0].rows.map(row => row.CLUSTER_LABEL), [0, 0, 0, 0, -1]);
});

test('闭区间邻域、自身计数、噪声改边界、非核心不能继续扩张、链式簇', () => {
  const degree = 1 / EARTH_RADIUS_KM * 180 / Math.PI;
  const points = [0, .9, 1.1, 1.2, 2.1, 3].map(x => [x * degree, 30]);
  const { assignments } = dbscan(points, { epsKm: .8, minSamples: 4 });
  assert.deepEqual(assignments.map(x => x.role), ['border', 'core', 'border', 'core', 'border', 'noise']);
  const exact = [[10, 20], [10.01, 20]];
  assert.deepEqual(dbscan(exact, { epsKm: haversineKm(...exact), minSamples: 2 }).assignments.map(p => p.label), [0, 0]);
  assert.deepEqual(dbscan([[10, 20]], { minSamples: 1 }).assignments, [{ label: 0, role: 'core' }]);
  assert.equal(dbscan([[10, 20]], { minSamples: 2 }).assignments[0].label, -1);
  const chain = dbscan([0, .8, 1.6, 2.4].map(x => [x * degree, 1]), { minSamples: 2 });
  assert.equal(chain.clusterCount, 1);
});

test('先分时间窗，以采集时间而非入库时间；同车同窗只计一次', () => {
  const samples = [raw[0], { ...raw[0], GPS_DATE: '2026/9/13 00:01' }, raw[1], { ...raw[2], GPS_DATE: '2026/9/13 00:05' }];
  const result = analyzeVehicles(samples);
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].rows.length, 2);
  assert.equal(result.windows[0].quality.collapsedRows, 1);
  assert.equal(result.windows[0].rows[0].GPS_DATE, '2026/9/13 00:01');
  assert(result.windows.every(w => w.metrics.clusterCount === 0));
  const conflicts = analyzeVehicles([raw[0], { ...raw[0], GEO_LON: 118 }, raw[1], raw[2]]).windows[0];
  assert.equal(conflicts.quality.conflictVehicles, 1); assert.equal(conflicts.metrics.clusterCount, 0);
  const samePlate = analyzeVehicles([raw[0], { ...raw[0], PALTE_COLOR: '2' }, raw[1]]).windows[0];
  assert.equal(samePlate.rows.length, 3); assert.equal(samePlate.metrics.clusterCount, 1);
  const display = vehicleDataResult({ rows: samePlate.rows, status: 'ready' });
  assert.equal(display.status, 'ready'); assert.equal(new Set(display.rows.map(row => row.code)).size, 3);
  assert.equal(linkedVehicles('cluster:0', display.rows).length, 3);
  assert.equal(linkedVehicles(display.rows[1].code, display.rows)[0].PALTE_COLOR, '2');
});

test('算法参数通过现有画布配置保存，旧画布保持兼容，非法参数不能落库', () => {
  const config = defaultConfigForProject(daoyan);
  assert.equal(normalizeConfig(config).map.clustering, undefined);
  config.map.clustering = { epsKm: .1, minSamples: 5, windowMinutes: 1, coordinateSystem: 'unknown' };
  assert.deepEqual(normalizeConfig(config).map.clustering, config.map.clustering);
  config.map.clustering.minSamples = 0; assert.throws(() => normalizeConfig(config));
  config.map.clustering = null; assert.throws(() => normalizeConfig(config));
});

test('批处理结果携带原参数，大屏复算一致；禁止混用不同参数的结果', () => {
  const first = analyzeVehicles(raw, { epsKm: .01, windowMinutes: 1, minSamples: 3 });
  const second = analyzeVehicles(first.windows[0].rows);
  assert.deepEqual(second.options, first.options);
  assert.deepEqual(second.windows[0].rows, first.windows[0].rows);
  assert.deepEqual(second.windows[0].clusters, first.windows[0].clusters);
  assert.throws(() => analyzeVehicles([raw[0], ...first.windows[0].rows]), /混合/);
  const changed = structuredClone(first.windows[0].rows); changed[0].CLUSTER_OPTIONS = { ...changed[0].CLUSTER_OPTIONS, epsKm: 1 };
  assert.throws(() => analyzeVehicles(changed), /参数必须一致/);
  assert.throws(() => analyzeVehicles(first.windows[0].rows, { ...first.options, windowMinutes: 5 }), /无法恢复历史点/);
});

test('日期、输入、参数边界和损坏数据隔离', () => {
  assert.equal(parseGpsTime('2026/9/13 00:00'), parseGpsTime('2026-09-12T16:00:00Z'));
  for (const value of ['2026-02-30 10:00', '2026-13-01 00:00', '2026-01-01 24:00', '2026-01-01 00:00:60', '2026-01-01T00:00:00+14:01', 46277, 'yesterday']) assert.throws(() => parseGpsTime(value));
  for (const options of [{ epsKm: 0 }, { epsKm: NaN }, { minSamples: 1.5 }, { windowMinutes: 0 }, { coordinateSystem: 'guess' }, { eps: 1 }]) assert.throws(() => clusterOptions(options));
  const result = analyzeVehicles([...raw, null, { ...raw[0], GEO_LAT: 100 }, { ...raw[0], GPS_DATE: '' }, { ...raw[0], GEO_LON: 0, GEO_LAT: 0 }, { ...raw[0], COORDINATE_SYSTEM: 'GCJ02' }]);
  assert.equal(result.rejected.length, 5); assert.equal(result.windows[0].rows.length, 5);
  assert.deepEqual(analyzeVehicles([]).windows, []);
  assert.throws(() => dbscan([[1, 1], [1.001, 1]], {}, 1), /预算/);
});

// 独立穷举邻域与核心连通分量，验证网格没有漏邻居；不复制实现的扩张队列。
function oracle(points, eps, min) {
  const neighbors = points.map(a => points.flatMap((b, j) => haversineKm(a, b) <= eps ? [j] : []));
  const core = neighbors.map(list => list.length >= min), components = points.map((_, i) => i);
  const root = i => components[i] === i ? i : root(components[i]);
  neighbors.forEach((list, i) => { if (core[i]) for (const j of list) if (core[j]) components[root(j)] = root(i); });
  const groups = new Map();
  points.forEach((_, i) => { if (core[i]) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); } });
  const ordered = [...groups.values()].sort((a, b) => a[0] - b[0]);
  return points.map((_, i) => { const label = ordered.findIndex(group => group.some(j => neighbors[i].includes(j))); return { label, role: core[i] ? 'core' : label < 0 ? 'noise' : 'border' }; });
}

test('网格与穷举参考一致，含日期线、极区、重复点和随机簇', () => {
  let seed = 7;
  const random = () => ((seed = Math.imul(1664525, seed) + 1013904223 >>> 0) / 2 ** 32);
  const scenarios = [Array.from({ length: 80 }, () => [116 + random() * .07, 40 + random() * .07]), [[179.999, 10], [-179.999, 10], [180, 10], [0, 30]], [[0, 89.999], [120, 89.999], [-120, 89.999], [20, 88]], Array(300).fill([116, 40])];
  for (const points of scenarios) for (const epsKm of [.02, .3, 1, 10]) for (const minSamples of [1, 3, 6]) assert.deepEqual(dbscan(points, { epsKm, minSamples }).assignments, oracle(points, epsKm, minSamples));
});

test('批处理可处理乱序、逐窗输出、重跑幂等；失败不覆盖已完成指针', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cluster-test-'));
  try {
    const input = join(dir, 'rows.ndjson'), output = join(dir, 'results');
    const samples = [{ ...raw[0], GPS_DATE: '2026/9/13 01:00' }, ...raw, { ...raw[0], GEO_LAT: null }];
    await writeFile(input, samples.map(row => JSON.stringify(row)).join('\n'));
    const result = await runBatch({ input, output, raw: true });
    const reloaded = await loadDataSource({ id: 'ds_raw', name: '原始批次', type: 'batch', url: 'http://localhost/observations.json' }, '', { fetcher: async url => new Response(await readFile(join(result.directory, new URL(url).pathname.slice(1)), 'utf8')) });
    assert.deepEqual(reloaded.map(({ SOURCE_ROW, ...row }) => row), samples);
    assert.deepEqual(analyzeVehicles(reloaded).windows.map(w => w.metrics), analyzeVehicles(samples).windows.map(w => w.metrics));
    assert.equal(analyzeVehicles(reloaded, { windowMinutes: 120 }).windows.length, 1, '新窗必须从完整原始批次去重重算');
    assert.equal(result.windowCount, 2); assert.equal(result.rejectedRows, 1);
    assert.equal(result.inputRows, 7);
    const windows = (await readFile(join(result.directory, 'windows.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(windows[0].metrics.clusterCount, 1); assert.equal(windows[1].metrics.clusterCount, 0);
    assert.equal((await runBatch({ input, output, raw: true })).runId, result.runId);
    const pointer = await readFile(join(output, 'current.json'), 'utf8');
    await writeFile(input, 'not-json'); await assert.rejects(runBatch({ input, output }), /JSON/);
    assert.equal(await readFile(join(output, 'current.json'), 'utf8'), pointer);
    const csv = join(dir, 'quoted.csv');
    await writeFile(csv, 'VEHICLENO,PALTE_COLOR,GEO_LON,GEO_LAT,GPS_SPEED,GPS_DATE\n"车,\n甲",1,116,40,0,2026/9/13 00:00\n');
    assert.equal((await runBatch({ input: csv, output })).inputRows, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
