import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { DEFAULT_THEME, THEMES, getTheme, themeVariables } from '../src/themes.js';
import { DEFAULT_CONFIG, MODULE_TYPES, createModule, normalizeConfig, loadConfig, saveConfig } from '../src/dashboardConfig.js';
import { parseTemplateFile, serializeTemplate } from '../src/templateLibrary.js';
import { getWidgetData, normalizeWidgetData, PROFESSIONAL_TYPES } from '../src/widgetData.js';
import { buildProfessionalChart, CHART_PALETTES } from '../src/professionalCharts.js';

const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const regionIndex = JSON.parse(readFileSync(new URL('../public/data/index.json', import.meta.url)));
let server, DashboardWidget, renderProfessionalSVG;
before(async () => {
  server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ DashboardWidget } = await server.ssrLoadModule('/src/DashboardWidget.jsx'));
  ({ renderProfessionalSVG } = await server.ssrLoadModule('/src/ProfessionalChart.jsx'));
});
after(async () => { await server?.close(); });

test('8 themes preserve the default, reject invalid imports and round-trip without changing data or layout', () => {
  assert.equal(THEMES.length, 8); assert.equal(new Set(THEMES.map(theme => theme.id)).size, 8);
  assert.equal(DEFAULT_CONFIG.theme, 'champagne'); assert.equal(getTheme('missing'), DEFAULT_THEME);
  const old = structuredClone(DEFAULT_CONFIG); delete old.theme;
  assert.deepEqual(normalizeConfig(old), DEFAULT_CONFIG);
  for (const invalid of [null, undefined, {}, '<script>', 'unknown', 0]) assert.throws(() => normalizeConfig({ ...old, theme: invalid }), /配色/);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    for (const theme of THEMES) {
      const config = { ...structuredClone(DEFAULT_CONFIG), theme: theme.id };
      assert.deepEqual(parseTemplateFile(serializeTemplate(config)), config);
      saveConfig(config); assert.deepEqual(loadConfig(), config);
      assert.deepEqual(config.modules, DEFAULT_CONFIG.modules);
      assert.deepEqual(config.map, DEFAULT_CONFIG.map);
      for (const value of Object.values(themeVariables(theme))) assert.match(value, /^#[0-9a-f]{6}$/i);
    }
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('alternative text and controls contrast against panels, map names against both map surfaces', () => {
  for (const theme of THEMES.slice(1)) {
    for (const foreground of [theme.text, theme.muted, theme.accent]) for (const background of [theme.bg, theme.panel]) assert(contrast(foreground, background) >= 4.5, `${theme.id}: ${foreground} on ${background}`);
    for (const surface of [theme.map.land, theme.map.focused, theme.map.active]) assert(contrast(theme.map.label, surface) >= 4.5, `${theme.id}: map label`);
    assert(contrast(theme.text, theme.map.context) >= 4.5, `${theme.id}: surrounding labels`);
    for (const color of theme.colors) assert(contrast(color, theme.panel) >= 3, `${theme.id}: chart series ${color}`);
  }
});

test('all 8 themes render all basic widgets and real ECharts types at normal and compact sizes', () => {
  for (const theme of THEMES) for (const { id } of MODULE_TYPES) {
    const config = createModule(id), data = normalizeWidgetData(getWidgetData(config.source, '100000', regionIndex));
    if (PROFESSIONAL_TYPES.includes(id)) {
      config.chartOptions.labels = true;
      const result = buildProfessionalChart(config, data, {}, theme);
      assert.deepEqual(result.option.color, theme.colors);
      for (const size of [{ width: 480, height: 280 }, { width: 220, height: 145 }]) {
        const svg = renderProfessionalSVG(config, data, size, theme);
        assert.match(svg, /<svg /, `${theme.id}/${id}`); assert.match(svg, /<text\b/);
        assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
      }
      const fixed = buildProfessionalChart({ ...config, chartOptions: { ...config.chartOptions, palette: 'ocean' } }, data, {}, theme);
      assert.deepEqual(fixed.option.color, CHART_PALETTES.ocean);
    } else {
      const html = renderToStaticMarkup(createElement(DashboardWidget, { config, data, theme }));
      assert.match(html, /dashboard-widget/); assert.doesNotMatch(html, /NaN|Infinity|undefined/);
      if (['donut', 'pie'].includes(id)) assert(html.includes((id === 'pie' ? theme.colors : theme.donut)[0]), `${theme.id}: ${id} follows theme`);
    }
  }
});
