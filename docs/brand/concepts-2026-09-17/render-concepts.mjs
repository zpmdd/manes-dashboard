// Typeset the generated symbols without modifying their source pixels.
// Run with the bundled Node runtime; PLAYWRIGHT_MODULE may point to another installation.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/manes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const routes = [
  { id: 'phase', n: '01', name: '折相', english: 'PHASE', detail: '折面结构 · 中央负形 · 精密秩序', file: '01-phase-mark.png' },
  { id: 'signal', n: '02', name: '光栅', english: 'SIGNAL', detail: '三重通道 · 参数曲线 · 信号节律', file: '02-signal-mark.png' },
  { id: 'space', n: '03', name: '构域', english: 'SPATIAL CORE', detail: '等轴空间 · 层次关系 · 数据成形', file: '03-space-mark.png' },
];
const bounds = JSON.parse(await readFile(path.join(dir, 'image-bounds.json'), 'utf8'));
for (const r of routes) assert((await stat(path.join(dir, r.file))).size > 0, `${r.file} is empty`);

function mark(route, size) {
  const { width, height, box } = bounds[route.file];
  const [x0, y0, x1, y1] = box;
  const scale = size / Math.max(x1 - x0, y1 - y0);
  const left = (size - (x1 - x0) * scale) / 2 - x0 * scale;
  const top = (size - (y1 - y0) * scale) / 2 - y0 * scale;
  return `<span class="mark" style="width:${size}px;height:${size}px"><img src="${route.file}" alt="${route.name}标志" style="width:${width * scale}px;height:${height * scale}px;left:${left}px;top:${top}px"></span>`;
}

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Manes工作室 · Logo 概念排版</title>
<style>
@font-face{font-family:Michroma;src:url('../../../node_modules/@fontsource/michroma/files/michroma-latin-400-normal.woff2')}
@font-face{font-family:Manrope;src:url('../../../node_modules/@fontsource/manrope/files/manrope-latin-500-normal.woff2');font-weight:500}
*{box-sizing:border-box}body{margin:0;background:#101012;color:#eee8d1;font-family:Manrope,'PingFang SC',sans-serif}
.artboard{width:1440px;height:960px;overflow:hidden;position:relative;background:#18181c;padding:64px 80px 0;margin-bottom:24px}
header{display:flex;align-items:center;justify-content:space-between;color:#a7a3a0;font-size:13px;letter-spacing:2px}
.brand-label{letter-spacing:1.5px}.route-label{display:flex;align-items:center;gap:22px}.route-label b{font-size:19px;font-weight:500;color:#eee8d1}.route-label em{font-style:normal;font-size:11px;color:#a79b83;letter-spacing:2px}
.hero{height:536px;display:flex;align-items:center;justify-content:center;gap:70px;padding-bottom:4px}
.mark{display:inline-block;position:relative;overflow:hidden;flex:none;vertical-align:middle}.mark img{position:absolute;display:block;max-width:none}
.wordmark{font:400 82px/1.15 Michroma,sans-serif;letter-spacing:4px;color:#eee8d1;white-space:nowrap}
.signature{font-size:18px;letter-spacing:10px;color:#bbb3a4;margin-top:27px;padding-left:4px}
.sample-grid{border-top:1px solid #eee8d122;padding-top:35px;display:grid;grid-template-columns:1fr 1.08fr 1.12fr;gap:48px}
.sample-label{font-size:11px;font-weight:500;letter-spacing:2px;color:#9e9890;margin:0 0 22px}
.sizes{display:flex;gap:32px;height:109px;align-items:center}.size-item{text-align:center;display:flex;align-items:center;flex-direction:column;gap:14px}.size-item small{font-size:10px;letter-spacing:1px;color:#928c83}
.compact{height:104px;display:flex;align-items:center;gap:18px}.compact .wordmark{font-size:22px;letter-spacing:1.8px}.compact .signature{font-size:10px;letter-spacing:4px;margin-top:10px;padding-left:1px}
.light{height:104px;display:flex;align-items:center;gap:16px;padding:0 24px;background:#eeeae1;border-radius:12px}.app-icon{width:62px;height:62px;border-radius:13px;background:#18181c;display:flex;align-items:center;justify-content:center;flex:none}.light .wordmark{font-size:19px;letter-spacing:1.3px;color:#29272c}.light .signature{color:#756e62;font-size:10px;letter-spacing:3px;margin-top:9px}
footer{position:absolute;bottom:45px;left:80px;right:80px;display:flex;align-items:center;justify-content:space-between;color:#928c83;font-size:11px;letter-spacing:2px}.swatches{display:flex;gap:7px}.swatches i{width:23px;height:6px;background:#eee8d1}.swatches i:nth-child(2){background:#c8b693}.swatches i:nth-child(3){background:#867b6a}
</style><body>${routes.map(r => `<section class="artboard" id="${r.id}">
<header><span class="brand-label">Manes工作室 / 品牌提案</span><span class="route-label"><em>${r.n}</em><b>${r.name}</b><em>${r.english}</em></span></header>
<div class="hero">${mark(r, 252)}<div><div class="wordmark">MANES</div><div class="signature">Manes工作室</div></div></div>
<div class="sample-grid">
<section><h2 class="sample-label">小尺寸辨识</h2><div class="sizes">${[64, 40, 24].map(size => `<div class="size-item">${mark(r, size)}<small>${size} PX</small></div>`).join('')}</div></section>
<section><h2 class="sample-label">界面组合</h2><div class="compact">${mark(r, 40)}<div><div class="wordmark">MANES</div><div class="signature">Manes工作室</div></div></div></section>
<section><h2 class="sample-label">浅底应用</h2><div class="light"><div class="app-icon">${mark(r, 40)}</div><div><div class="wordmark">MANES</div><div class="signature">Manes工作室</div></div></div></section>
</div><footer><span>${r.detail}</span><span class="swatches" aria-label="暖白、香槟、灰褐"><i></i><i></i><i></i></span></footer>
</section>`).join('')}</body></html>`;
await writeFile(path.join(dir, 'artboards.html'), html);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(dir, 'artboards.html')).href);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode())); });
  assert.equal(await page.locator('.artboard').count(), 3);
  assert.deepEqual(errors, []);
  for (const r of routes) {
    const board = page.locator(`#${r.id}`);
    const issues = await board.evaluate(el => {
      const outer = el.getBoundingClientRect();
      return [...el.querySelectorAll('.hero, .wordmark, .signature, .sample-grid, footer')].filter(child => {
        const b = child.getBoundingClientRect();
        return b.left < outer.left || b.right > outer.right || b.top < outer.top || b.bottom > outer.bottom;
      }).map(child => child.className);
    });
    assert.deepEqual(issues, [], `${r.id}: content exceeds artboard`);
    await board.screenshot({ path: path.join(dir, `${r.n}-${r.id}-presentation.png`) });
  }
  console.log('PASS: three 2880 × 1920 logo presentations; all images decoded, fonts loaded, no clipped content.');
} finally { await browser.close(); }
