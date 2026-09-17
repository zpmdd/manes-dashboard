# 中文字体候选与整屏对比

2026-09-17 第二轮：用户确认保留 MiSans，另找艺术风格、设计感更强的中文字体，供多选后内置到系统，通过配置切换。

入口：项目本地 Vite 服务的 `/docs/typography-2026-09-17/`。第二轮仅提供候选；随后用户选定 05，正式接入情况见下文。

| 编号 | 字体 | 风格与建议 | 原生字重 |
| --- | --- | --- | --- |
| ① | MiSans | 已确认保留；整屏基线和艺术标题的正文搭配 | Regular 400 / Medium 500 |
| ② | 得意黑 Smiley Sans | 窄身斜切、手绘细节；科技与交通标题 | 400，自带倾斜轮廓 |
| ③ | 站酷庆科黄油体 | 圆角、几何切口；仪表与未来感 | 400 |
| ④ | 站酷小薇体 | 有笔画对比的展示宋体；精致展陈风格 | 400 |
| ⑤ | 霞鹜文楷 GB Lite | 手写、人文；文旅及亲和的专题风格 | Medium 500 |
| ⑥ | 站酷快乐体 | 不规则手绘块面；创意、活动和品牌主题 | 400 |

风格建议为本次样本的设计判断。预览使用真实字体文件，没有用倾斜、描边或伪粗体模拟字形。艺术字体原生字重不同，因此保持相同字号，按各自真实字重比较。

## 如何选择

- MiSans 已勾选并锁定保留；其他五套可多选。勾选只加入候选，不会自动切换当前预览。
- 每套“预览整屏”按钮可独立查看效果，无须先加入候选。
- “搭配方式”支持艺术标题搭配 MiSans 正文，以及整屏中文试用。前者覆盖主标题、卡片标题和地图区域标题，后者也覆盖正文及 HTML 地图标签。英文与常规数字继续使用 Manrope，指标大数字保留 Michroma。
- “对比当前系统字体”移除临时样式，恢复原始画布。
- “复制已选名单”生成可直接发给助手的选择说明。候选 ID 保存在本页 URL 的 `#keep=` 中，刷新可保留；未知 ID 被忽略。预览与多选均不写入应用 localStorage。

iframe 读取当前浏览器、当前域名的画布。不同浏览器或域名不会共享画布；样本卡片的数值与文案仅用于排版对比。字体就绪后触发尺寸更新，让地图重新测量标签。

## 正式接入边界

已按用户选择内置 MiSans 和 05 霞鹜文楷 GB Lite。点击主屏右上齿轮 → 全局设置 → 中文字体 → 应用设置 → 保存画布；MiSans 为新画布及旧配置的默认值。正式配置字段为 `font: "misans" | "wenkai"`，非法值拒绝导入。字体复用编辑草稿、撤销/重做、模板和画布存储，不改变布局或数据绑定。

本地原版资源和许可位于 `public/fonts/`，只按需加载选中的字族。文楷沿用用户选择的 Medium 500 样本；不裁字、不合成粗体。加载完成后一起更新 DOM/SVG 与 ECharts 字体，并触发地图标签重新测量；加载失败保留当前字体并提示。未加入新的应用依赖。

当前 iframe 的专业 Canvas 图表仍沿用应用配置，预览页不冒充正式的系统切换验收。现有英文和数字字体保留；这次无需添加应用依赖。

## 原版来源与许可

- [MiSans 官方下载页](https://hyperos.mi.com/font/zh/download/)。第一轮已保留官方 Regular / Medium WOFF2，许可原文见 `fonts/LICENSE-MiSans.pdf`。
- [得意黑官方仓库](https://github.com/atelier-anchor/smiley-sans)，采用 [v2.0.1 发布包](https://github.com/atelier-anchor/smiley-sans/releases/tag/v2.0.1) 中的 `SmileySans-Oblique.otf.woff2`；`LICENSE-SmileySans.txt`。
- [站酷庆科黄油体官方项目](https://github.com/googlefonts/zcool-qingke-huangyou)，采用 [Google Fonts 分发文件](https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou) `ZCOOLQingKeHuangYou-Regular.ttf`；`LICENSE-ZCOOLQingKeHuangYou.txt`。
- [站酷小薇体官方项目](https://github.com/googlefonts/zcool-xiaowei)，采用 [Google Fonts 分发文件](https://github.com/google/fonts/tree/main/ofl/zcoolxiaowei) `ZCOOLXiaoWei-Regular.ttf`；`LICENSE-ZCOOLXiaoWei.txt`。
- [霞鹜文楷 GB Lite 官方仓库](https://github.com/lxgw/LxgwWenkaiGB-Lite)，采用 [v1.522 发布文件](https://github.com/lxgw/LxgwWenkaiGB-Lite/releases/tag/v1.522) `LXGWWenKaiGBLite-Medium.ttf`；`LICENSE-LXGWWenKaiGBLite.txt`。
- [站酷快乐体官方项目](https://github.com/googlefonts/zcool-kuaile)，采用 [Google Fonts 分发文件](https://github.com/google/fonts/tree/main/ofl/zcoolkuaile) `ZCOOLKuaiLe-Regular.ttf`；`LICENSE-ZCOOLKuaiLe.txt`。

新增五套字体的原文许可证均为 SIL OFL 1.1，已随文件保留。字体字节未改写、裁剪或重新编码，`Sample*` 仅为 CSS 别名。大小与 SHA-256 记录在 `fonts/manifest.json`。正式构建只包含 MiSans 与霞鹜文楷，其他候选不进入构建。

第一轮的鸿蒙 Sans、思源黑体、思源宋体原版文件、许可和截图继续保留作历史对照，第二轮页面不加载这些未选字体。原始来源：[HarmonyOS](https://developer.huawei.com/consumer/cn/design/resource-V1/)、[Source Han Sans](https://github.com/adobe-fonts/source-han-sans)、[Source Han Serif](https://github.com/adobe-fonts/source-han-serif)。

## 验证与证据

运行 `node docs/typography-2026-09-17/check.mjs`，使用已有本地服务；`PREVIEW_ORIGIN` 可指定服务地址，`PLAYWRIGHT_MODULE` 可指定已有 Playwright 安装。检查使用隔离的 Chrome，不接触用户实际浏览器数据。

检查项目：六套标题的实际 PostScript 字体名称（防止悄悄回退到 MiSans 或系统字体）；六字体 × 两搭配方式的十二组整屏预览；多选、锁定保留 MiSans、真实剪贴板复制、刷新恢复名单、原始字体对比；1440 / 768 / 390 / 320 像素 × 两搭配方式无样本溢出；应用 localStorage 不变；无页面异常与 HTTP 错误。

第二轮证据位于 `evidence/artistic/`：

- `title-comparison.png`：六套标题的紧凑对比。
- `font-samples.png`：标题、卡片、正文、表格、地名完整样本。
- `<id>-headings-dashboard.png` / `<id>-all-dashboard.png`：真实大屏两种搭配预览。
- `original-dashboard.png`：当前系统字体原始对照。
- `mobile.png`、`font-check.json`：窄屏与机器检查记录。

整屏截图使用隔离浏览器的默认演示画布，不代表用户自定义画布的正式接入验收。已人工核对紧凑对比图、得意黑与黄油体整屏，以及原始对照。

## 正式接入验证（2026-09-17）

- 113 项 Node 测试通过，含旧 v1/v2 兼容、字体非法值拒绝、带业务配置的存储/模板往返，以及两套字体 × 八类 ECharts 的真实 SVG 文本。
- `node scripts/check-map.mjs`、`npm run build`、`npm run test:sites`（4 项）通过。地图检查脚本同步补齐字体参数。
- 本地浏览器确认设置按钮仅显示齿轮，保留「设置大屏」无障碍名称与悬停提示；选择文楷并保存，刷新后仍生效。
- CDP 实际字形检查：标题、地图名称、基础 SVG 标签为 `LXGWWenKaiGBLite-Medium`；指标数字保持 `Michroma-Regular`。MiSans 标题为 `MiSans-Medium`。
- 浏览器实际多系列图的 13 个 SVG 文本在 MiSans/文楷间随配置和撤销同步切换；临时图表已撤销，原五卡画布保留。Canvas 与 SVG 共用已检验的 ECharts 配置，本轮未单独进行 Canvas 截图验收。
- 全国 34 个省级标签、西安 13 个区县标签均显示且无重叠；核对浅色道路底图与原始对照截图，布局、数字和材质保留。浏览器未见页面错误，存在既有 `THREE.Clock` 弃用提示。
- 撤销/重做已在浏览器实测。取消草稿的原生确认弹窗阻塞了该预览页自动控制，因此取消动作不记为本轮浏览器验收通过；保存/刷新在独立预览页完成。
