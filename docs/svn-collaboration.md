# 道研与通用大屏的 Git / SVN 双人协作

Git `main` 是正式主线，SVN `http://112.6.25.174:8081/svn/dbscan` 是同事的协作入口。两者维护同一工程；默认启动和构建仍为通用版，道研通过 `--mode daoyan` 选择。不存在需要长期互相合并的两条产品分支。

## 两人的日常工作

同事在 SVN 中更新、开发、验收并提交，提交说明写清功能和影响。新检出包含源码、Vite 入口、依赖锁文件、地图/字体资源、构建脚本、测试与文档：

```sh
svn update
npm ci
npm run dev:daoyan
npm run verify
svn status
svn commit -m "feat(daoyan): 描述本次业务修改"
```

维护者在 Git 中开发；同步只在干净的短期整合分支运行。`sync:pull` 不替你提交审阅后的结果，也不向远端推送。

```sh
git switch main
git pull --ff-only
git switch -c integrate/daoyan-日期
npm run sync:status
npm run sync:pull
git diff --cached
# 如有冲突，逐项合并，使用 git add 标记解决。
npm run verify
git commit -m "merge: 整合 SVN 道研改动并验证双版本"
git switch main
git merge --ff-only integrate/daoyan-日期
git push origin main
npm run sync:push
npm run sync:status
```

只有 Git 自己有新功能时，也先验收并发布 `main`，再执行 `sync:push`。如果同步报告 SVN 有新版本，先 `sync:pull` 合并新版本、提交并发布 Git，再重试 `sync:push`。从 `sync:pull` 到回写成功之间，其他人的新增 SVN 提交仍会被检测，不能用旧快照覆盖。

`sync:pull` 没有新内容时不会创建合并；此时不要执行空提交。放弃有冲突的导入时，先 `git merge --abort`，确认恢复到导入前的干净提交，再运行 `npm run sync:cancel`。命令本身不重置或删除开发者改动。

## 同步如何保护数据

- `.svn-sync.json` 明确 SVN URL、UUID、Git 正式分支、验收命令和同步范围。只同步纳入 Git 的文件，源码、测试、资源和文档属于范围；依赖目录、产物、缓存、`.env` 与版本控制内部文件不进入同步。
- SVN 中出现范围外文件、符号链接或外部仓库引用时停止，等待人工确认，不自动删除。
- 基线与运行锁保存在 Git 公共目录的 `svn-sync-dbscan/` 下，多个 worktree 共用一个同步入口；该目录不上传到 Git/SVN。
- SVN 的每批增量先形成 `refs/svn/dbscan` 导入提交，再由 Git 三方合并。同处修改出现标准 Git 冲突；新增、删除、重命名和二进制文件遵循 Git 合并规则。
- 回写要求当前 Git 提交已经发布到配置指定的 `origin/main`，并重新运行 `verify`。SVN 提交同时修改仓库根目录属性 `dashboard:git-commit`，使准备期间发生的其他 SVN 提交导致事务过期失败。不会自动降低权限或抢锁。
- 提交成功后按文件内容和可执行位逐项核对，成功才推进共同基线。SVN 提交说明含完整 Git SHA 和起始 SVN 版本。
- 提交回执丢失时保留 `publishing` 状态；在同一干净 Git 提交运行 `sync:push`，按日志回执找到原提交并核对，不重复提交。若另一人抢先提交导致回写被拒绝，使用 `sync:pull` 整合新版本。

当前版本每次拉取或回写使用独立临时 SVN 检出；每次检出均会传输离线地图和文档资源，首次回写还需上传整套资源；后续回写只提交增量文件。同步工作不会改动日常 SVN 工作副本。

桥接维护环境需要 Git、Python 3、SVN 客户端；`test:sync` 的本地仓库测试还需要 `svnadmin`。macOS 的 Homebrew Subversion 和常见 Linux Subversion 包可提供这些工具。GitHub Actions 显式安装 Subversion。

## 通用版与道研版的边界

- `src/projects/base.js`：通用版；保留 MANES 品牌、通用编辑器、图表、主题、字体及演示数据。
- `src/projects/daoyan.js`：道研默认画布、车辆数据和业务入口。
- `src/projects/daoyan-restrictions.json`：共同维护的道研默认限行规则，不放在共享算法里。
- `src/restrictions.js`、`restrictionStore.js`：不含项目快照的算法和校验。
- 公共 `App`、地图、编辑器、字段清洗修改后必须验证两版。`build:all` 和产物检查保证通用版不带道研车辆/限行默认数据。

当前区域编辑器支持一个多边形及一个每日时段，支持跨午夜；至少三个有效顶点，不接受空坐标、退化边界或自交多边形。坐标系需与 GPS 来源一致，未声明时不猜测转换。

## 浏览器配置如何交给同事

页面保存后，限行规则位于画布 JSON 的 `map.restrictions`，包含 `projectId: "daoyan"`。在「页面设置 → 编辑主题、布局与数据源 → 模板库」导出当前画布，同事在道研版模板库导入、检查并保存，即可同时取得布局、数据源和限行配置。通用版拒绝导入道研画布。

需要成为所有新用户的默认规则时，将审阅后的 `map.restrictions` 数组更新到 `src/projects/daoyan-restrictions.json`，验收后纳入 Git/SVN。默认规则更新不会覆盖已有浏览器画布。当前没有多人实时配置服务。

旧 `manes.dashboard.daoyan.restrictions.20261020` 记录只在画布尚未包含新字段时读取；显式保存后优先读取画布中的规则。旧字节不删除，损坏的旧记录也不写回。配置同步包含完整数据源内容，提交前仅保留你们希望共同维护的数据，不将临时真实业务数据混入示例。

## 限行结果的口径

- 当前时间窗：显示范围内/外、GPS 时段、车型/货种、联合规则判定；缺少必要信息时显示「信息不足」。
- 完整已载入批次：至少三个不同时刻连续命中，相邻记录间隔不超过五分钟才形成连续事件。同车同刻重复点不增加确认点数，冲突坐标被隔离，同号牌不同号牌颜色独立。
- Excel 分别导出当前窗判定、规则和完整批次的连续事件。事件末点仅是最后观测到的命中点，不等同于真实驶离时间。

## 首次整合与恢复

首次从不完整 SVN 建立共同版本需要人工核对历史：本次以 SVN r1→r3、Git HEAD `99c0e87` 和原工作目录未提交的导航/侧轴改动为输入。原工作目录保留，整合位于独立 `work/dashboard-svn-sync`。

只在人工整合、验收和 Git 提交完成后执行一次：

```sh
npm run sync:bootstrap -- --revision 3
# 发布当前提交到 origin/main 后：
npm run sync:push
```

后续禁止重新 bootstrap 覆盖已有基线。机器迁移时保留 `svn-sync-dbscan/state.json`，同时确保其中 Git 提交存在；或者依据 SVN 根属性和提交说明找到共同提交，经逐文件核对后再恢复状态。不要凭文件日期猜共同版本，不强制推送，不清空个人浏览器存储。
