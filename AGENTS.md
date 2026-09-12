# Prototype Instructions

## 本原型的已确认视觉要求

用户要求高质量复刻 `../1 - 1.mov` 及配套 JPEG 的整体 UI。重点是烟灰色毛玻璃的半透明质感、共享三维背景、组件前后层级、边缘高光、投影与透视。左栏不能用不透明渐变冒充磨砂玻璃。仅把中央建筑换为可交互的中国行政区地图；保留参考的组件比例、视觉密度、暖白色字体和香槟色灯光。默认不自动旋转地图。每轮必须把参考与实际截图放在一起核对，不以配色近似代替材质与层级验收。

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## 2026-09-12 精细化方向

基线完成后，保留烟灰玻璃、暖白/香槟三维质感和离线地图能力；去掉营销标题、空泛介绍与主屏上的问题说明，采用常用监测大屏的指标、趋势、排行和事件表。各业务区使用可复用模块，支持文字、显示类型、数据源及表格列配置，并在当前浏览器持久化。性能优化优先隔离更新与复用，不以默认降画质、删反射、减几何精度换取性能。

## 2026-09-12 可复用编辑器

在既定玻璃与香槟风格上迭代自由画布，允许添加、修改、拖动和缩放组件；统一组件材质，保持单一三维场景。配置与模板独立于数据，通过 JSON、CSV、HTTP GET 和字段映射复用于不同项目。不能把本地模板或演示接口宣称为服务端配置中心、生产监控或已完成商业部署。

## 2026-09-12 商业能力迭代

在保留当前材质与共享三维场景的基础上，参考成熟可视化产品的实际编辑交互：组件边缘和中心磁吸、可见辅助线、多选对齐与等距、同宽同高、精确尺寸。专业图表采用按需加载的 ECharts，字段映射和数据预览共用实际数据，空值不得补成虚假零值。降低重复请求、重复布局和无效绘制，避免靠默认降画质换性能。
