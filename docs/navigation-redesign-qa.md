# 道研导航与侧边时间轴验收

日期：2026-09-29。开发前检查点：`99c0e87`。本次改版尚未另行提交或推送。

## 最终设计

顶部保留五项导航，新增聚集分析独立页；算法参数归入页面设置抽屉，继续使用原画布编辑器。车辆点位、聚集热区、聚集标签、聚集光柱分别控制，导航不改变图层或时间窗。

用户追加的 Codex 截图取代原横向时间条方案。侧轴宽 44px，五个真实窗口约 165px 高；刻度视觉宽 10–28px，选中刻度平滑移位，邻近刻度伸长。默认没有上下箭头或播放图标，播放/暂停放入悬停、键盘聚焦展开的时间卡片。保留竖向拖动吸附、方向键、Home/End、末窗停止与减少动态效果。

参考：[Codrops Navigation Indicators](https://tympanus.net/Development/NavigationIndicators/) 的侧边导航变化、[Motion Primitives Dock](https://github.com/ibelick/motion-primitives/blob/main/app/docs/dock/page.mdx) 的邻近放大思路。未复制第三方组件或增加依赖，也不声称取得了 Codex 的内部实现。

## 自动检查

最终 `npm run verify` 退出码 0：132 个 Node 测试、真实 React/R3F 地图检查、base/daoyan 构建、4 个 Sites 测试及双项目产物隔离检查全部通过。`python3 tests/test_vehicle_excel.py` 和 `git diff --check` 通过。

新增行为回归覆盖：独立图层组合及焦点路径，纵向拖动预览/吸附/取消，方向键与边界，浮卡鼠标跨入及键盘访问，播放/暂停/末窗/重算停止，减少动态效果，设置草稿及参数校验。修复 HTTP 刷新或失败仍保留旧算法结果时的热区残留，检查 loading/error 输入地图的车辆及热力均清空。

构建仍有现有的 500kB 分包体积提示，未作为本轮改版扩大打包范围。

## 用户 Chrome 实测

| 项目 | 验收结果 |
| --- | --- |
| 时间轴 | 真实竖向拖动 09:10 → 09:40；Home、Down 切换；对应簇数正确。浮卡播放、暂停可点击，离开后默认控件收起。 |
| 分窗数据 | 09:00 为 5 辆/2 簇，09:10 为 2 辆/1 簇；09:40 为 920 辆有效、27 辆聚集、4 簇、2.93%、893 辆非聚集。 |
| 独立图层 | 热区关、标签开、光柱开时 4 个簇点与四组各 4 个光柱实例；标签关、车辆开后簇点为 0，光柱仍保留；往返聚集分析后开关保持。 |
| 设置 | 改最少车辆数后取消，重开仍为 2；保存 1000 后零簇，标签/光柱清空；随后恢复 1km / 2 辆 / 10 分钟。半径 0 被原生校验拒绝。 |
| 编辑入口 | 页面设置进入现有画布编辑器，原工具栏、图层和模块保留；取消返回。 |
| 簇定位 | 分析表“地图定位聚集簇 1”返回数据监测，下钻 `#110114` 昌平区并高亮 12 辆；中国面包屑恢复全国。 |
| 导出 | 界面导出产生 `daoyan-dbscan (1).json`，实际读取核对 10000 条输入、5 窗和原算法参数。浏览器下载事件等待超时，但本地完成文件独立验证成功。 |
| 响应式 | 2560、1440、1120 及 390px 宽度核对。1120 左图五窗均可见；390 分析页保留侧栏，表格在自身容器内滚动。手机宽度是 Chrome 模拟，未称真实手机设备验收。 |
| 减少动态效果 | Chrome 模拟系统减少动态效果后，刻度 transition 为 0s、animation 为 none；完成后清除模拟。 |
| 全屏 | 关闭焦点模拟、前置测试页后核对真实 Chrome 窗口：地址栏隐藏，页面获得焦点；2560×1440 屏幕内网页 2560×1384，顶部仅保留浏览器调试提示。退出后恢复普通窗口。 |
| base 回归 | 原四项导航、监测热力预设、演示节点开关、六个业务图表及设置大屏编辑入口正常；不出现道研分析导航与侧轴。 |
| 控制台 | 两个专用测试页均未记录 error。 |

所有测试参数、视口与动效模拟已恢复；保留道研预览，关闭本任务基线测试页。数据仍为模拟批次，验收范围为本地代码与当前 Chrome，不包含线上发布或生产数据确认。

## 证据

- [监测页实际效果](../../output/navigation-redesign/actual-monitor-side.png)
- [聚集分析实际效果](../../output/navigation-redesign/actual-analysis-side.png)
- [侧轴展开状态](../../output/navigation-redesign/actual-timeline-preview.png)
- [1440px 监测页](../../output/navigation-redesign/actual-monitor-1440.png)
- [390px 分析页](../../output/navigation-redesign/actual-analysis-mobile.png)
- [真实窗口全屏](../../output/navigation-redesign/actual-fullscreen-native.png)
- [完整验证日志](../../output/navigation-redesign/final-verify.log)
- [精简侧轴回归日志](../../output/navigation-redesign/check-map-quiet-timeline.log)

## A 版光柱与时间轴对比度复验

用户选择 A「细线柔光」：采用较矮的金色细柱、透明外晕、小圆顶和柔和落地点，仅外晕/落地点缓慢呼吸。保持四组实例化绘制，聚集位置、点击定位与选中状态沿用原数据；页面隐藏、无簇、减少动态效果或卸载时停止动画。base 演示光柱保持原材质和尺寸。

默认香槟主题的地图侧轴改为深棕色刻度与时间数字；深色聚集分析页及浮卡保留浅色文字。Chrome 实测地图选中刻度/时间为 `rgb(33, 28, 25)`，未改变控件尺寸和交互。

本轮 `npm run verify` 退出码 0：132 个 Node 测试、真实 React/R3F 检查、base/daoyan 两版构建、4 个 Sites 测试和产物隔离全部通过。新增光柱检查覆盖四组实例/40 簇、坐标/点击/选中、八主题材质复用、base 原样保留，以及动画停启与清理。`git diff --check` 通过。

Chrome 已核对全国道路底图、昌平区下钻和俯视效果；点击北京光柱定位到昌平区的 12 辆聚集簇。09:10 实际光柱实例数为四组各 1 个，恢复 09:40 后为四组各 4 个；分析页 Home/End 与地图时间同步。控制台无 error。最终恢复全国、09:40、数据监测、车辆点位/光柱开启、热区/标签关闭，临时视口模拟已清除。

- [A 版与深色侧轴实际效果](../../output/beacon-visibility/a-national-roadmap.png)
- [区县道路底图](../../output/beacon-visibility/a-district-roadmap.png)
- [俯视效果](../../output/beacon-visibility/a-topview-roadmap.png)
- [本轮完整验证日志](../../output/beacon-visibility/verify.log)

### 时间读数再次增强

将侧轴时间由 10px 常规字重调整为 16px / 600 Manrope 等宽数字，当前刻度由 2px 加粗为 3px，保留 44px 轨道与 28px 选中线长度。按用户随后指定，将数字和全部刻度统一为图标/按钮同款主题强调色；当前香槟主题实测为 `#eee2b9`，保持 16px / 600 字号字重。Home/End 切窗与浮卡显示正常，无控制台 error。`npm run check`、`npm run build:daoyan` 和 `git diff --check` 均通过。本轮仅为局部 CSS 修订，未重复全部算法测试。

- [时间读数局部实拍](../../output/beacon-visibility/timeline-readability.png)
- [整页实拍](../../output/beacon-visibility/timeline-readability-full.png)

### 全量时间窗自适应

移除时间轴滚动容器及自动滚动副作用。少量窗口保持约 169px，自然高度超过可用高度时自动压缩间距；全部窗口始终保留。地图侧栏避开标题、图层和页脚，分析页侧栏按视口高度调整；刻度点击区随间距缩小，浮卡按实际轨道比例定位。

Chrome 当前 1 分钟配置实测 50 个时间窗：常规地图轨道约 836px、1440×900 视口约 545px、390×844 窄屏地图约 163px，三者均有 50 个可见刻度，时间轴 `scrollHeight` 等于 `clientHeight`。窄屏分析页轨道约 559px，同样全部可见。已验证首窗、中间 09:25、拖动至末窗 09:49，缩放后映射正确。截图中的页面纵向滚动属于窄屏整页布局，时间轴内部不滚动；验收后已清除视口模拟，保留用户的 1 分钟参数。

真实 React 回归新增 240 个窗口的完整渲染、首中末选择、单窗及空窗；播放、暂停、稀疏时间、拖动取消及加载清理继续通过。`npm run verify` 退出码 0，含 132 个 Node 测试、地图/交互检查、两版构建、4 个 Sites 测试和产物隔离。`git diff --check` 通过。

- [50 窗监测页](../../output/navigation-redesign/dense-timeline-monitor.png)
- [窄屏监测页](../../output/navigation-redesign/dense-timeline-monitor-mobile.png)
- [窄屏分析页](../../output/navigation-redesign/dense-timeline-analysis-mobile.png)
- [240 窗回归日志](../../output/navigation-redesign/check-map-dense-timeline.log)
- [本轮完整验证日志](../../output/navigation-redesign/verify-dense-timeline.log)
