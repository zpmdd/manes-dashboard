// Run against the local Vite server. The browser context is isolated from saved user data.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/manes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = fileURLToPath(new URL('./evidence/artistic/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(), errors = [], failed = [], fonts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${process.env.PREVIEW_ORIGIN || 'http://127.0.0.1:5173'}/docs/typography-2026-09-17/`);
  await page.waitForFunction(() => document.getElementById('dashboard-preview').dataset.font === 'mi');
  await page.evaluate(() => document.fonts.ready);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const presets = await page.evaluate(() => [...document.querySelectorAll('.choice')].map(el => ({ id: el.dataset.id, font: el.style.getPropertyValue('--title-font') })));
  assert.equal(presets.length, 6);
  const postScript = ['MiSans-Medium', 'SmileySans', 'ZCOOLQingKeHuangYou', 'ZCOOLXiaoWei', 'LXGWWenKaiGBLite', 'ZCOOLKuaiLe'];
  for (const [i, preset] of presets.entries()) {
    await page.locator(`[data-preview=${preset.id}]`).click();
    await page.waitForFunction(id => document.getElementById('dashboard-preview').dataset.font === id, preset.id);
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-id=${preset.id}] h3` });
    const result = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert(result.fonts.length > 0);
    assert(result.fonts.every(font => font.isCustomFont && font.postScriptName.includes(postScript[i])), `${preset.id}: title uses a fallback font: ${JSON.stringify(result.fonts)}`);
    fonts.push({ id: preset.id, fonts: result.fonts });
    const preview = page.frameLocator('#dashboard-preview');
    await preview.locator('canvas').waitFor();
    for (const scope of ['headings', 'all']) {
      await page.locator('#scope').selectOption(scope);
      await page.waitForFunction(scope => document.getElementById('dashboard-preview').dataset.scope === scope && !document.getElementById('preview-status').textContent.includes('正在'), scope);
      for (const selector of ['.screen-title h1', '.widget-heading h2']) {
        assert((await preview.locator(selector).first().evaluate(el => getComputedStyle(el).fontFamily)).includes(preset.font), `${preset.id}/${scope}: heading did not change`);
      }
      const bodyFamily = await preview.locator('html').evaluate(el => getComputedStyle(el).fontFamily);
      assert(bodyFamily.includes(scope === 'all' ? preset.font : 'SampleMi'));
      const chineseFamily = await page.locator(`[data-id=${preset.id}] .map-text`).evaluate(el => getComputedStyle(el).fontFamily);
      assert(chineseFamily.includes(scope === 'all' ? preset.font : 'SampleMi'));
      await page.locator('#dashboard-preview').screenshot({ path: `${output}/${preset.id}-${scope}-dashboard.png` });
    }
  }
  await page.locator('#original').click();
  await page.waitForFunction(() => document.getElementById('dashboard-preview').dataset.font === 'original');
  assert.equal(await page.frameLocator('#dashboard-preview').locator('#typography-preview-style').textContent(), '');
  await page.locator('#dashboard-preview').screenshot({ path: `${output}/original-dashboard.png` });
  await page.locator('#original').click();
  await page.waitForFunction(() => document.getElementById('dashboard-preview').dataset.font === 'kuaile');
  assert(await page.locator('input[value=mi]').isChecked());
  assert(await page.locator('input[value=mi]').isDisabled());
  for (const id of ['smiley', 'huangyou']) await page.locator(`input[value=${id}]`).check();
  assert.match(await page.locator('#selection').textContent(), /MiSans.*得意黑.*黄油体/);
  await page.locator('#copy-selection').click();
  await page.waitForFunction(() => document.getElementById('copy-status').textContent.includes('已复制'));
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clipboard, /MiSans.*得意黑.*黄油体/);
  assert(!clipboard.includes('小薇'));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('dashboard-preview').dataset.font === 'mi');
  for (const id of ['mi', 'smiley', 'huangyou']) assert(await page.locator(`input[value=${id}]`).isChecked(), `Shortlist must survive a reload: ${id}`);
  assert(!(await page.locator('input[value=xiaowei]').isChecked()));
  for (const id of ['smiley', 'huangyou']) await page.locator(`input[value=${id}]`).uncheck();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.choices').screenshot({ path: `${output}/font-samples.png` });
  // A compact title-only overview makes the actual glyph differences easy to compare.
  await page.addStyleTag({ content: '.sample-nav,.sample-metric,.sample-table,.map-text,.choice-actions{display:none!important}.choice-note{min-height:0}.choice{padding:22px 25px}.sample h3{margin:4px 0 17px}.choice-head{margin-bottom:20px}' });
  await page.locator('.choices').screenshot({ path: `${output}/title-comparison.png` });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('dashboard-preview').dataset.font === 'mi');
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const scope of ['headings', 'all']) {
      await page.locator('#scope').selectOption(scope);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.choice,.sample h3,.sample-nav,.sample-metric,.sample-table,.map-text,.config,.controls')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className));
      assert.deepEqual(clipped, [], `Clipped text at ${width}px/${scope}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px/${scope}`);
    }
  }
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage })), stored, 'Font selection must not change app storage');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  await writeFile(`${output}/font-check.json`, JSON.stringify({ fonts, scopes: ['headings', 'all'], widths: [1440, 768, 390, 320], multiSelect: true, copySelection: true, reloadRestoresSelection: true, storageUnchanged: true, errors, failed }, null, 2));
  console.log('PASS: MiSans + 5 original artistic fonts; 12 dashboard previews; multi-select, copy, reload, original comparison; 4 viewport widths × 2 scopes; no app storage changes or page/HTTP errors.');
} finally { await browser.close(); }
