# 地图数据来源

整理日期：2026-09-12。原始数据的行政区时效不等于整理日期。

## 行政区

复用 `/Users/manes/Work/Java/Daoyan/src/main/resources/ChinaGeoJson`。
原仓库 README 指向 [DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector)；全国省级集合来自[同源公开文件](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)。

源文件未声明坐标系与几何精度，原始数据授权应向上游核实，不能将第三方仓库代码许可证等同于原始边界数据授权。保留源经纬度、属性、内环和多岛，不做未经确认的坐标转换。

## 全国概化道路

[Natural Earth 1:10m Roads](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/)（5.0.0 源文件），按全国边界裁切 Major Highway 并为下钻区域预切片。3197 个相交道路要素。数据为概化路线，无可靠的完整 G 编号覆盖承诺。

Natural Earth 数据为 [Public Domain](https://www.naturalearthdata.com/about/terms-of-use/)。本包保留来源标识。

## 丹江口道路

来源：`/Users/manes/Work/Java/危货/www-front-ui/src/views/danjiangkou/transportTwin/assets/roads.json`。
采集方法依据原项目 `docs/transport-twin/geo-sources.md` 与 `tools/transport-twin/build_geo_assets.py`。

- 通过 Overpass API 从 OpenStreetMap 提取，bbox：南侧纬度 32.22、西侧经度 110.77、北侧纬度 33.00、东侧经度 111.61（即 32.22–33.00°N、110.77–111.61°E）。
- 筛选 `highway=motorway|trunk|primary`，保留名称和 ref；按名称、分类、ref 分组，断段以 MultiLineString 存储。
- 原项目使用约 0.00025° 容差简化，保留 6 位经纬度；源为 WGS84、经度在前。快照标记 `2026-09-07T23:07:56Z`。
- 当前复制已有本地快照并沿区域边界裁切，未重新查询全国 OSM，未搬入原项目的地形、建筑和业务接口。
- 编号包括 G70、G59、G209、G241、G316，以及 S77、S57 等；S 开头高速仍按 `motorway` 分类。

署名：**© OpenStreetMap contributors**。使用与衍生数据遵循 [OpenStreetMap 的 ODbL 说明](https://www.openstreetmap.org/copyright)。本包的该衍生道路数据按 ODbL 提供；保留本文件及来源署名。

## 业务数据

所有指标、光柱高度、热力强度和区域连线均是固定演示数据，不表示实际交通、事故或实时监控状态。

所有源文件 SHA256 记录在同目录 `provenance.json`，用于核对本次数据版本。
