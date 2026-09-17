// Run against local dev servers, or set BASE_URL / DAOYAN_URL to the two built previews.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = path.join(root, 'docs/evidence/projects'); mkdirSync(evidence, { recursive: true });
const legacy = JSON.parse(readFileSync(path.join(root, 'docs/daoyan-vehicles.canvas.json'), 'utf8'));
const rawVehicles = JSON.parse(readFileSync(path.join(root, 'src/projects/daoyan-vehicles.json'), 'utf8'));
const report = [];
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--use-angle=metal'] });
const settle = async page => {
  await page.waitForFunction(() => document.querySelector('.map-region-label') && !document.querySelector('.loading-state'));
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(850);
  assert.deepEqual(await page.evaluate(() => [...document.fonts].filter(font => font.status === 'error').map(font => font.family)), [], '本地字体完整加载');
};
const screenshot = async (page, name) => {
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 10000 });
  // The offline atlas is debounced after camera motion; capture the completed detail layer.
  if ((await page.locator('.map-legend').innerText()).includes('离线道路底图')) {
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(2500);
  }
  return page.screenshot({ path: path.join(evidence, `${name}.png`) });
};
const editor = page => page.getByRole('button', { name: '设置大屏', exact: true }).click();
const save = page => page.getByRole('button', { name: '保存画布', exact: true }).click();
async function region(page, code) {
  await page.locator('.scope-select').click();
  await page.getByPlaceholder('搜索省、市、区县，如：湖北、武汉').fill(code);
  await page.locator('.region-grid button').filter({ hasText: code }).click();
  await page.waitForURL(`**/#${code}`); await settle(page);
}
try {
  for (const project of ['base', 'daoyan']) {
    const url = project === 'base' ? process.env.BASE_URL || 'http://127.0.0.1:5183/' : process.env.DAOYAN_URL || 'http://127.0.0.1:5185/';
    assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Browser checks use isolated local previews');
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage(), errors = [], requests = [], failedResources = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) failedResources.push([response.status(), response.url()]); });
    await page.goto(url); await settle(page);
    assert.equal(await page.locator('html').getAttribute('data-project'), project);
    assert.equal(await page.locator('.screen-brand').count(), project === 'base' ? 1 : 0);
    assert.equal(await page.locator('.vehicle-marker').count(), project === 'base' ? 0 : 5);
    assert.equal(await page.locator('.dashboard-widget').count(), project === 'base' ? 5 : 3);
    const layouts = await page.locator('.canvas-item').evaluateAll(items => items.map(item => [item.dataset.canvasId, item.style.cssText]));
    await screenshot(page, `${project}-overview`);
    if (project === 'base') assert(!requests.some(url => url.includes('/projects/daoyan')));
    await page.getByRole('button', { name: '地图图层', exact: true }).click();
    assert.equal(await page.locator('.switch-list label').filter({ hasText: '车辆信息' }).count(), project === 'daoyan' ? 1 : 0);
    await page.locator('.switch-list label').filter({ hasText: '离线道路底图' }).locator('input').check();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.map-legend')?.textContent.includes('离线道路底图')); await page.waitForTimeout(1400);
    await screenshot(page, `${project}-roadmap`);
    await region(page, '420381'); await screenshot(page, `${project}-district`);
    if (project === 'daoyan') {
      await page.locator('.widget-ranking button').filter({ hasText: '车辆 3' }).click();
      await page.waitForURL('**/#110105'); await settle(page);
      await page.locator('.vehicle-callout-card').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.vehicle-marker').count(), 5);
      assert((await page.locator('.vehicle-callout-card').innerText()).includes('车辆 3'));
      await screenshot(page, 'daoyan-vehicle-focus');
      await page.getByRole('button', { name: '完整车辆信息', exact: true }).click();
      assert.equal(await page.locator('.vehicle-details>div').count(), 15);
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    }
    const foreignKey = `manes.dashboard.${project === 'base' ? 'daoyan' : 'base'}.config.v2`;
    await page.evaluate(key => localStorage.setItem(key, '{"keep":"foreign"}'), foreignKey);
    await editor(page);
    await page.getByRole('button', { name: '全局设置', exact: true }).click();
    await page.getByLabel('大屏标题', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('品牌名称', { exact: true }).count(), project === 'base' ? 1 : 0);
    await page.getByLabel('大屏标题', { exact: true }).fill(`${project}保存回归`);
    await page.getByLabel('中文字体').selectOption('wenkai');
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('button', { name: '切换配色', exact: true }).click();
    await page.getByRole('radio', { name: '深海青碧', exact: true }).check();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await save(page); await settle(page); await page.reload(); await settle(page);
    const saved = await page.evaluate(id => JSON.parse(localStorage.getItem(`manes.dashboard.${id}.config.v2`)), project);
    assert.equal(saved.title, `${project}保存回归`); assert.equal(saved.font, 'wenkai'); assert.equal(saved.theme, 'ocean');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), foreignKey), '{"keep":"foreign"}');
    assert.deepEqual(await page.locator('.canvas-item').evaluateAll(items => items.map(item => [item.dataset.canvasId, item.style.cssText])), layouts);
    await screenshot(page, `${project}-saved-theme-font`);
    await editor(page); await page.getByRole('button', { name: '模板库', exact: true }).click();
    await page.getByRole('button', { name: '恢复项目默认画布', exact: true }).click();
    await save(page); await settle(page);
    assert.equal(await page.locator('h1').innerText(), legacy.title);
    assert.equal(await page.locator('.dashboard-widget').count(), project === 'base' ? 5 : 3);
    if (project === 'daoyan') {
      await editor(page); await page.getByRole('button', { name: '数据源', exact: true }).click();
      const changed = [...rawVehicles.slice(0, 2), { ...rawVehicles[2], VEHICLENO: 'NEW', GPS_SPEED: 22.5 }];
      await page.getByLabel('JSON 内容', { exact: true }).fill(JSON.stringify(changed));
      await page.getByRole('button', { name: '保存数据源', exact: true }).click(); await save(page); await settle(page);
      assert.equal(await page.locator('.vehicle-marker').count(), 3);
      assert.equal((await page.locator('.widget-value strong').innerText()).trim(), '3');
      assert.equal((await page.locator('.widget-ranking button').filter({ hasText: '车辆 NEW' }).locator('strong').innerText()).trim(), '23', '保留旧卡片的零位小数显示设置');
      assert((await page.locator('.widget-donut-legend').innerText()).includes('67%'));
      await page.locator('.widget-ranking button').filter({ hasText: '车辆 NEW' }).click();
      await page.locator('.vehicle-callout-card').waitFor();
      assert((await page.locator('.vehicle-callout-card').innerText()).includes('22.5'), '车辆详情保留原始速度');
      await screenshot(page, 'daoyan-updated-data');
    }
    await page.setViewportSize({ width: 1120, height: 718 }); await settle(page); await screenshot(page, `${project}-compact`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResources, []);
    report.push({ project, url, errors, failedResources, passed: ['默认布局与品牌', '全国与区县及离线底图', '配色字体保存重载', '本地字体及资源加载', '存储隔离', '恢复项目默认', '紧凑窗口', ...(project === 'daoyan' ? ['单车区县定位与15字段详情', '修改一份数据同步地图与三卡'] : ['无道研数据请求'])] });
    console.log(`PASS browser: ${project}`);
    await context.close();
  }
  // Load the actual pre-migration export in a fresh browser; verify copy-on-save and old-key retention.
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(value => { if (!localStorage.getItem('nexus.dashboard.config.v2')) localStorage.setItem('nexus.dashboard.config.v2', value); }, JSON.stringify(legacy));
  const page = await context.newPage(); await page.goto(process.env.DAOYAN_URL || 'http://127.0.0.1:5185/'); await settle(page);
  assert.equal(await page.locator('.dashboard-widget').count(), 3); await editor(page); await save(page); await settle(page);
  const state = await page.evaluate(() => ({ old: localStorage.getItem('nexus.dashboard.config.v2'), saved: JSON.parse(localStorage.getItem('manes.dashboard.daoyan.config.v2')) }));
  assert.equal(state.old, JSON.stringify(legacy)); assert.equal(state.saved.dataSources.length, 1);
  assert.deepEqual(state.saved.modules.map(item => item.layout), legacy.modules.map(item => item.layout));
  await screenshot(page, 'daoyan-migrated'); report.push({ migration: '旧三卡完整保留，显式保存新键，旧字节不变' });
  await context.close();
  if (process.env.REFERENCE_URL) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.addInitScript(value => localStorage.setItem('nexus.dashboard.config.v2', value), JSON.stringify(legacy));
    const page = await context.newPage(); await page.goto(process.env.REFERENCE_URL); await settle(page); await screenshot(page, 'before-overview'); await context.close();
  }
  writeFileSync(path.join(evidence, 'browser-checks.json'), JSON.stringify({ time: new Date().toISOString(), report }, null, 2) + '\n');
} finally { await browser.close(); }
