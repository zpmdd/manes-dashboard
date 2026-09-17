# MANES「构域」品牌验收 · 2026-09-17

- 用户选择③「构域 / SPATIAL CORE」，本轮仅大屏项目，影片工程未修改。
- 以选定图形精修三平面 SVG：透明母版、深色底座和单色版。逐一对照原稿轮廓、中央 M 负形与色值；SVG 无内嵌位图、渐变、脚本及外部依赖。
- 展示页与编辑画布切换到矢量标志；SVG favicon、32 px PNG favicon、180 px Apple 图标及旧路径 256 px PNG 均为构域。项目 README、品牌说明、设计说明与 AGENTS 品牌约定同步更新。
- 在只包含本次品牌改动的独立工作副本验证：Node.js 24.15.0，`npm test` 103/103 通过，附带的 Three.js / React 地图检查通过；`npm run check` 验证 3238 条层级、364 张地图和 1,151,634 个环顶点；`npm run build` 与 `npm run test:sites` 4/4 通过。
- Chrome 实测生产构建：1920×1080、3840×2160、编辑画布和 390×844 窄屏；页面 SVG 解码正常，三种图标资源均 HTTP 200，浏览器运行错误为 0。窄屏沿用原有隐藏品牌行的布局，favicon 已更新。检查使用独立浏览器上下文，没有写入用户画布或模板。
- 小尺寸对照覆盖 16 / 24 / 32 / 40 / 64 px。未修改界面材质、字体、三维场景或配置迁移行为；工作目录中既有地图、标签和瓦片改动单独保留，不混入本次提交。

当前证据：[原稿与矢量对照](../evidence/manes-spatial-vector-check.png)、[展示页](../evidence/manes-spatial-overview.jpg)、[4K](../evidence/manes-spatial-4k.jpg)、[编辑器](../evidence/manes-spatial-editor.jpg)、[窄屏](../evidence/manes-spatial-mobile.jpg)。

## 历史验收 · 2026-09-12

- 更新页面 M 标志、MANES 字标、浏览器标题、favicon、页面描述、模板导出文件名与项目介绍。
- 旧 v1 / v2 配置和导入模板中的旧默认品牌自动显示为 MANES；既有存储键保持不变。验证了自定义名称、业务标题和输入校验，读取不会覆盖原存储。
- Node.js 24.15.0：103 项业务检查、真实 Three.js / React 隔离检查、4 项 Sites 检查、地图资源检查及生产构建全部通过。
- 浏览器从原已保存的业务洞察画布加载新版本，MANES 标志与标题生效，6 个图表和地图正常。拍摄中的临时模板、数据配置和布局已撤销，画布恢复到原已保存版本。
- 已对照原参考的烟灰玻璃、暖白 / 香槟视觉；本次未修改三维材质、光影、几何与渲染质量。

页面证据：`../evidence/manes-brand-overview.jpg`、`../evidence/manes-brand-editor.jpg`。
