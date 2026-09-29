import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, stat, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { clusterOptions, normalizeObservation, createWindowAccumulator, ALGORITHM_VERSION } from '../src/vehicleClustering.js';
import { parseCsv, DATA_ROW_LIMIT, DATA_SIZE_LIMIT, BATCH_ROW_LIMIT } from '../src/dataSources.js';

export async function* readRows(file, { python = process.env.DAOYAN_PYTHON || 'python3', sheet } = {}) {
  const extension = extname(file).toLowerCase();
  if (extension === '.json') {
    if ((await stat(file)).size > 50 * 1024 * 1024) throw new Error('大 JSON 请转为 NDJSON 或 Excel，避免整文件驻留内存');
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error('JSON 输入需为记录数组');
    yield* data; return;
  }
  if (!['.xlsx', '.ndjson', '.jsonl', '.csv'].includes(extension)) throw new Error('支持 .xlsx、.csv、.json、.ndjson；旧 .xls 请另存为 .xlsx');
  let child, done, stderr = '';
  if (extension === '.xlsx') {
    child = spawn(python, [fileURLToPath(new URL('./read-vehicle-excel.py', import.meta.url)), file, ...(sheet ? ['--sheet', sheet] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    done = new Promise(resolveDone => { child.on('error', error => resolveDone(error)); child.on('close', code => resolveDone(code ? new Error(stderr || `Excel 读取器退出 ${code}`) : null)); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  }
  const input = child ? child.stdout : createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header, pending = '', quotes = 0, lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (extension !== '.csv') {
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > DATA_SIZE_LIMIT) throw new Error(`第 ${lineNumber} 行超过 1 MB`);
        try { yield JSON.parse(line.replace(/^\uFEFF/, '')); }
        catch (error) { throw new Error(`第 ${lineNumber} 行 JSON 无效：${error.message}`); }
      } else {
        pending += (pending ? '\n' : '') + line;
        quotes += [...line].filter(c => c === '"').length;
        if (Buffer.byteLength(pending) > DATA_SIZE_LIMIT) throw new Error(`CSV 第 ${lineNumber} 行过长或引号未闭合`);
        if (quotes % 2) continue;
        if (pending.trim()) {
          if (!header) { parseCsv(pending); header = pending; }
          else yield* parseCsv(`${header}\n${pending}`);
        }
        pending = ''; quotes = 0;
      }
    }
    if (pending || (extension === '.csv' && !header)) throw new Error('CSV 缺少表头或引号未闭合');
    if (done) { const error = await done; if (error) throw error; }
  } finally { lines.close(); input.destroy(); if (child && child.exitCode === null) child.kill(); }
}

export async function runBatch({ input, output, options: rawOptions = {}, python, sheet, raw = false }) {
  const options = clusterOptions(rawOptions), started = performance.now();
  const sourceHash = createHash('sha256');
  for await (const chunk of createReadStream(input)) sourceHash.update(chunk);
  const sha256 = sourceHash.digest('hex');
  const runId = createHash('sha256').update(JSON.stringify({ sha256, options, sheet, raw, version: ALGORITHM_VERSION })).digest('hex').slice(0, 20);
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(resolve(output), '.processing-')), scratch = await mkdtemp(join(tmpdir(), 'daoyan-cluster-'));
  const db = new DatabaseSync(join(scratch, 'input.sqlite'));
  let rejectFile, windowFile;
  try {
    db.exec('PRAGMA journal_mode=OFF; PRAGMA temp_store=FILE; CREATE TABLE observations (window INTEGER NOT NULL, point TEXT NOT NULL); BEGIN');
    const insert = db.prepare('INSERT INTO observations VALUES (?, ?)');
    rejectFile = await open(join(staging, 'rejected.ndjson'), 'w');
    let inputRows = 0, rejectedRows = 0;
    const pages = [];
    let page = [], pageBytes = 2;
    const flushPage = async () => {
      if (!page.length) return;
      const file = `observations-${pages.length + 1}.json`;
      await writeFile(join(staging, file), `[${page.join(',')}]`);
      pages.push({ file, rowCount: page.length }); page = []; pageBytes = 2;
    };
    for await (const row of readRows(input, { python, sheet })) {
      inputRows++;
      if (raw) {
        if (inputRows > BATCH_ROW_LIMIT) throw new Error('浏览器原始批次最多 100,000 条，更大数据请使用离线分窗结果');
        if (!row || typeof row !== 'object' || Array.isArray(row) || Object.hasOwn(row, 'CLUSTER_OPTIONS')) throw new Error('原始批次只接收原始记录对象，不能导出已去重结果');
        const bytes = JSON.stringify({ ...row, SOURCE_ROW: row?.SOURCE_ROW ?? inputRows }), size = Buffer.byteLength(bytes) + 1;
        if (size + 2 > DATA_SIZE_LIMIT) throw new Error('单条原始记录超过 1 MB');
        if (page.length >= 1000 || pageBytes + size > DATA_SIZE_LIMIT) await flushPage();
        if (pages.length >= 100) throw new Error('原始批次超过 100 个分片');
        page.push(bytes); pageBytes += size;
      }
      let point;
      try {
        point = normalizeObservation(row, options, row?.SOURCE_ROW ?? inputRows);
      } catch (error) {
        rejectedRows++;
        await rejectFile.write(`${JSON.stringify({ sourceRow: row?.SOURCE_ROW ?? inputRows, reason: error.message })}\n`);
      }
      // 存储故障必须终止整批，不能被当作单行数据错误后发布残缺结果。
      if (point) insert.run(point.windowStart, JSON.stringify(point));
      if (inputRows % 10000 === 0) db.exec('COMMIT; BEGIN');
    }
    db.exec('COMMIT; CREATE INDEX windows ON observations(window)');
    if (!inputRows || inputRows === rejectedRows) throw new Error('没有可用 GPS 记录，批次未发布；请检查表头、时间及坐标');
    if (raw) {
      await flushPage();
      await writeFile(join(staging, 'observations.json'), JSON.stringify({ schemaVersion: 1, kind: 'vehicle-observations', runId, rowCount: inputRows, pages }) + '\n');
    }
    windowFile = await open(join(staging, 'windows.ndjson'), 'w');
    let accumulator, active, latest, windowCount = 0, totalClusters = 0;
    const flush = async () => {
      if (!accumulator) return;
      const result = accumulator.finish();
      const document = { schemaVersion: 1, algorithmVersion: ALGORITHM_VERSION, runId, options, ...result };
      const filename = `window-${active}.json`, bytes = JSON.stringify(document);
      await writeFile(join(staging, filename), bytes + '\n');
      await windowFile.write(JSON.stringify({ windowStart: result.windowStart, windowEnd: result.windowEnd, file: filename, quality: result.quality, metrics: result.metrics }) + '\n');
      windowCount++; totalClusters += result.metrics.clusterCount;
      latest = { ...document, bytes: Buffer.byteLength(JSON.stringify({ rows: result.rows })) };
    };
    for (const record of db.prepare('SELECT window, point FROM observations ORDER BY window').iterate()) {
      if (active !== record.window) { await flush(); active = record.window; accumulator = createWindowAccumulator(active, options); }
      accumulator.add(JSON.parse(record.point));
    }
    await flush();
    const dashboardCompatible = latest.rows.length <= DATA_ROW_LIMIT && latest.bytes <= DATA_SIZE_LIMIT;
    const manifest = { schemaVersion: 1, algorithmVersion: ALGORITHM_VERSION, runId, source: { name: basename(input), sha256, sheet: sheet || 'auto' }, options,
      inputRows, rejectedRows, windowCount, totalClusters, latestWindow: latest.windowStart, dashboardCompatible,
      coordinateAssessment: options.coordinateSystem === 'unknown' ? '坐标系待确认，按输入原坐标试算，ENCRYPT 不用于推断坐标系' : `按输入声明 ${options.coordinateSystem} 计算，未作坐标转换`,
      elapsedMs: Math.round(performance.now() - started), generatedAt: new Date().toISOString() };
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const { bytes: _bytes, ...latestDocument } = latest;
    await writeFile(join(staging, 'latest.json'), JSON.stringify(latestDocument) + '\n');
    if (dashboardCompatible) await writeFile(join(staging, 'dashboard.json'), JSON.stringify({ rows: latest.rows }) + '\n');
    await rejectFile.close(); rejectFile = null; await windowFile.close(); windowFile = null;
    const destination = join(resolve(output), `run-${runId}`);
    try { await rename(staging, destination); }
    catch (error) { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; await rm(staging, { recursive: true }); }
    const pointer = join(resolve(output), `.current-${process.pid}.json`);
    await writeFile(pointer, JSON.stringify({ runId, path: `run-${runId}/manifest.json` }) + '\n');
    await rename(pointer, join(resolve(output), 'current.json'));
    return { ...manifest, directory: destination };
  } catch (error) {
    await writeFile(join(staging, 'failed.json'), JSON.stringify({ message: error.message, runId }) + '\n');
    throw new Error(`${error.message}；诊断保留于 ${staging}`);
  } finally {
    await rejectFile?.close(); await windowFile?.close(); db.close(); await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, options: { type: 'string' }, python: { type: 'string' }, sheet: { type: 'string' }, raw: { type: 'boolean' } } });
    if (!values.input || !values.output) throw new Error('用法：node scripts/cluster-vehicles.mjs --input demo.xlsx --output output/dbscan [--options options.json] [--python python3] [--sheet Sheet2]');
    const options = values.options ? JSON.parse(await readFile(values.options, 'utf8')) : {};
    console.log(JSON.stringify(await runBatch({ ...values, options }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
