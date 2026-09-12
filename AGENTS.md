# Prototype Instructions

## 本原型的已确认视觉要求

用户要求高质量复刻 `../1 - 1.mov` 及配套 JPEG 的整体 UI。重点是烟灰色毛玻璃的半透明质感、共享三维背景、组件前后层级、边缘高光、投影与透视。左栏不能用不透明渐变冒充磨砂玻璃。仅把中央建筑换为可交互的中国行政区地图；保留参考的组件比例、视觉密度、暖白色字体和香槟色灯光。默认不自动旋转地图。每轮必须把参考与实际截图放在一起核对，不以配色近似代替材质与层级验收。

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
