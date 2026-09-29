import { Dialog } from './MapPanels';
import { useState } from 'react';
import { clusterOptions, DEFAULT_CLUSTER_OPTIONS, optionsForRows } from './vehicleClustering';
import { DashboardWidget } from './DashboardWidget';
import { CLUSTER_LABEL_LIMIT } from './vehicles';
import './vehicle-analysis.css';

export const windowLabel = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function VehicleAnalysis({ children, analysis, window, selectedWindow, onWindow, stage, onStage, onDetails, onSettings, onFocus }) {
  const ready = analysis.status === 'ready';
  const selectCluster = (event, label) => { event.currentTarget.closest('details').open = false; onFocus(`cluster:${label}`); };
  return <section className="vehicle-analysis" aria-label="车辆聚集分析">
    <div className="analysis-navigation">{children}<div className="analysis-stage-switch" role="group" aria-label="算法前后对比">
      <button aria-pressed={stage === 'raw'} onClick={() => onStage('raw')}>1 · 窗内点位</button>
      <button aria-pressed={stage === 'clusters'} onClick={() => onStage('clusters')} disabled={!ready}>2 · 聚类结果</button>
    </div><button className="analysis-details-link" onClick={onSettings}>算法设置</button><button className="analysis-details-link" onClick={onDetails} disabled={!ready}>数据与算法 ↗</button></div>
    <div className="analysis-summary">
      {ready && window && <label className="analysis-window">时间窗<select aria-label="分析时间窗" value={selectedWindow || window.windowStart} onChange={e => onWindow(e.target.value)}>{analysis.result.windows.map(w => <option key={w.windowStart} value={w.windowStart}>{windowLabel(w.windowStart).replace(/:\d{2}$/, '')} 起</option>)}</select></label>}
      {analysis.status === 'loading' && <p role="status">正在处理车辆点位…</p>}
      {analysis.status === 'error' && <p role="alert">{analysis.error}</p>}
      {ready && !window && <p role="status">没有可用 GPS 点位 · 隔离 {analysis.result.rejected.length} 条</p>}
      {ready && window && stage === 'raw' && <p className="analysis-caption">{window.quality.usableVehicles} 辆有效车辆 · 同车同窗取最新点位</p>}
      {ready && window && stage === 'clusters' && <>
        <dl className="analysis-metrics"><div><dt>聚集簇</dt><dd>{window.metrics.clusterCount}</dd></div><div><dt>聚集车辆</dt><dd>{window.metrics.clusteredVehicles}</dd></div><div><dt>孤立车辆</dt><dd>{window.metrics.noiseVehicles}</dd></div></dl>
        {window.clusters.length > 0 && <details className="analysis-cluster-menu" onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false; }}><summary>簇列表</summary><div className="analysis-cluster-popover"><div className="analysis-clusters">{window.clusters.slice(0, 20).map(cluster => <button key={cluster.id} onClick={event => selectCluster(event, cluster.label)} aria-label={`定位聚集簇 ${cluster.label + 1}，${cluster.vehicleCount} 辆`}><span>聚集簇 {cluster.label + 1}</span><strong>{cluster.vehicleCount} 辆</strong><small>覆盖 {(cluster.radiusKm * 1000).toFixed(1)} m</small></button>)}{window.clusters.length > 20 && <button onClick={onDetails}>查看全部 {window.clusters.length} 个簇</button>}</div><p>{analysis.result.options.epsKm} km / 至少 {analysis.result.options.minSamples} 辆 / {analysis.result.options.windowMinutes} 分钟窗</p><p>{analysis.result.options.coordinateSystem === 'unknown' ? '坐标系待确认 · 按原坐标试算' : analysis.result.options.coordinateSystem}</p></div></details>}
        {window.noiseKeys.length > 0 && <button className="analysis-noise-link" onClick={() => onFocus('cluster:-1')}>定位孤立车辆 · {window.noiseKeys.length}</button>}
      </>}
      {ready && (analysis.result.rejected.length > 0 || window?.quality.conflictVehicles > 0) && <button className="analysis-quality-link" onClick={onDetails}>数据隔离 · {analysis.result.rejected.length} 条无效 / {window?.quality.conflictVehicles || 0} 辆冲突</button>}
      {ready && stage === 'clusters' && window?.clusters.length > CLUSTER_LABEL_LIMIT && <span>地图保留全部簇点，优先标注 {CLUSTER_LABEL_LIMIT} 簇</span>}
    </div>
  </section>;
}

export function VehicleAnalysisDetails({ analysis: { result }, window, onClose, onFocus }) {
  const exportResult = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'daoyan-dbscan.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Dialog title="数据与算法" subtitle="DBSCAN · 车辆空间聚集" onClose={onClose} wide>
    <div className="analysis-detail">
      <p>按 GPS 采集时间分窗，同一车牌及颜色在每窗保留最新有效点位。邻域计数包含自身，距离不大于 {result.options.epsKm} km 且达到 {result.options.minSamples} 辆时为核心点。</p>
      <p>时间窗 {result.options.windowMinutes} 分钟（左闭右开，北京时间显示）。{result.options.coordinateSystem === 'unknown' ? '坐标系尚未确认；按原坐标试算，未根据 ENCRYPT 做转换。' : `坐标系按批次声明为 ${result.options.coordinateSystem}，未作转换。`}孤立点是本参数下的非聚集车辆，不代表异常车辆。</p>
      <p>输入 {result.inputRows} 条 · {result.windows.length} 个非空时间窗 · 无效记录 {result.rejected.length} 条。通过顶部「算法设置」调整并保存参数。地图与左侧统计均为全国输入批次的所选时间窗，下钻仅改变视野。</p>
      {window && <><p>当前窗 {windowLabel(window.windowStart)} 至 {windowLabel(window.windowEnd)} · 合并历史/重复记录 {window.quality.collapsedRows} 条 · 位置冲突隔离 {window.quality.conflictVehicles} 辆</p>
      <div className="analysis-table-scroll"><table><thead><tr><th>簇</th><th>车辆数</th><th>中心（经度 / 纬度）</th><th>覆盖半径</th><th>定位</th></tr></thead><tbody>{window.clusters.slice(0, 100).map(cluster => <tr key={cluster.id}><td>{cluster.label + 1}</td><td>{cluster.vehicleCount}</td><td>{cluster.center.map(n => n.toFixed(6)).join(' / ')}</td><td>{(cluster.radiusKm * 1000).toFixed(1)} m</td><td><button onClick={() => onFocus(`cluster:${cluster.label}`)}>定位簇 {cluster.label + 1}</button></td></tr>)}</tbody></table></div>
      {window.clusters.length > 100 && <p>明细展示前 100 簇，导出包含完整结果。</p>}
      <div className="analysis-table-scroll"><table><thead><tr><th>号牌 / 颜色</th><th>采集时间</th><th>簇标签</th><th>点类型</th></tr></thead><tbody>{window.rows.slice(0, 100).map(row => <tr key={row.VEHICLE_KEY}><td>{row.VEHICLENO} / {row.PALTE_COLOR}</td><td>{row.GPS_DATE}</td><td>{row.CLUSTER_LABEL}</td><td>{{ core: '核心点', border: '边界点', noise: '孤立点' }[row.POINT_ROLE]}</td></tr>)}</tbody></table></div>{window.rows.length > 100 && <p>展示前 100 辆，导出包含完整结果。</p>}</>}
      {result.rejected.length > 0 && <ul>{result.rejected.slice(0, 20).map((issue, i) => <li key={i}>{issue.sourceRow}：{issue.reason}</li>)}</ul>}
      {window?.conflicts.length > 0 && <ul>{window.conflicts.slice(0, 20).map(issue => <li key={issue.vehicleKey}>{issue.sourceRow}：{issue.reason}</li>)}</ul>}
      <p>覆盖半径为簇内车辆到球面中心的最大距离；链式聚集可能超过邻域半径。单个时间窗不能证明持续停留、频繁聚集或风险等级。</p>
      <button className="text-button" onClick={exportResult}>导出完整算法结果</button>
    </div>
  </Dialog>;
}

export function VehicleAlgorithmSettings({ options, rows, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_CLUSTER_OPTIONS, ...options }));
  const [error, setError] = useState('');
  const apply = event => {
    event.preventDefault();
    try { const next = clusterOptions(draft); optionsForRows(rows || [], next); onApply(next); }
    catch (issue) { setError(issue.message); }
  };
  return <Dialog title="算法设置" subtitle="DBSCAN · 对完整输入批次重新计算" onClose={onClose}>
    <form className="analysis-settings" onSubmit={apply}>
      {[
        ['epsKm', '邻域半径（km）', .001, 200, .001, '判断相邻车辆的距离；链式连接后的簇覆盖范围可能更大。'],
        ['minSamples', '最少车辆数（含自身）', 1, 100000, 1, '邻域内至少多少辆车才形成核心点，默认 3 辆。'],
        ['windowMinutes', '时间窗（分钟）', 1, 1440, 1, '按 GPS 时间分窗，每车每窗取最新点；不等同持续停留时间。'],
      ].map(([key, label, min, max, step, help]) => <label key={key}><span>{label}</span><input type="number" required min={min} max={max} step={step} value={draft[key]} onChange={event => { setError(''); setDraft({ ...draft, [key]: event.target.value === '' ? '' : Number(event.target.value) }); }}/><small>{help}</small></label>)}
      <p>默认半径 1 km、3 辆来自算法文档，5 分钟为试运行设置。当前坐标系：{draft.coordinateSystem === 'unknown' ? '待确认，按原坐标试算' : draft.coordinateSystem}。</p>
      {rows?.some(row => row.CLUSTER_OPTIONS) && <p>当前是已去重结果，时间窗变更需要接入原始 Excel 批次。</p>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={() => setDraft({ ...DEFAULT_CLUSTER_OPTIONS, coordinateSystem: draft.coordinateSystem })}>恢复默认值</button><button type="button" onClick={onClose}>取消</button><button className="text-button" type="submit">应用并保存</button></footer>
    </form>
  </Dialog>;
}

const shortTime = value => new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' });

export function VehicleAnalysisCard({ item, analysis, window, onWindow, onFocus, onDetails, locations, selectedCluster }) {
  const ready = analysis.status === 'ready', windows = analysis.result?.windows || [];
  const selected = windows.indexOf(window), start = Math.max(0, Math.min(selected - 19, windows.length - 40));
  const visible = windows.slice(start, start + 40), maxCount = Math.max(1, ...visible.map(w => w.metrics.clusteredVehicles));
  const total = window?.quality.usableVehicles || 0, count = window?.metrics.clusteredVehicles || 0;
  const share = total ? count / total * 100 : 0;
  const clusters = [...(window?.clusters || [])].sort((a, b) => b.vehicleCount - a.vehicleCount || a.label - b.label);
  const subtitle = window ? `全国 · ${shortTime(window.windowStart)}–${shortTime(window.windowEnd)}` : '全国输入批次';
  let content;
  if (!ready || !window) content = <div className="monitor-empty" role={analysis.status === 'error' ? 'alert' : 'status'}>{analysis.status === 'error' ? analysis.error : !ready ? '正在重新计算…' : '没有可用 GPS 记录'}</div>;
  else if (item.vehicleView === 'overview') content = <div className="monitor-overview">
    <div className="monitor-share"><strong>{share.toFixed(2)}<small>%</small></strong><span>窗内聚集车辆占比</span></div>
    <div className="monitor-share-track" role="img" aria-label={`聚集 ${count} 辆，占 ${share.toFixed(2)}%；非聚集 ${total - count} 辆`}><i style={{ width: `${share}%` }}/></div>
    <div className="monitor-composition"><button onClick={() => onFocus('vehicle:all')}><span>有效车辆</span><b>{total.toLocaleString()}</b></button><button disabled={!count} onClick={onDetails}><span>聚集车辆</span><b>{count}</b></button><button disabled={total === count} onClick={() => onFocus('cluster:-1')}><span>非聚集</span><b>{total - count}</b></button></div>
    <p title="占比分母为本窗去重且排除位置冲突后的有效车辆">{window.metrics.clusterCount} 个簇 · 去重及冲突隔离后</p>
  </div>;
  else if (item.vehicleView === 'trend') content = <div className="monitor-trend"><div className="monitor-trend-caption"><span>聚集车辆 / 辆</span><span>{windows.length} 个有数据窗</span></div><div className="monitor-columns" role="group" aria-label="分窗聚集车辆数，点击切换时间窗">{visible.map(w => <button key={w.windowStart} aria-pressed={w === window} aria-label={`${windowLabel(w.windowStart)}，${w.metrics.clusteredVehicles} 辆，${w.metrics.clusterCount} 个簇`} title={`${windowLabel(w.windowStart)} · ${w.metrics.clusteredVehicles} 辆 / ${w.metrics.clusterCount} 个簇`} onClick={() => onWindow(w.windowStart)}><span className="monitor-column-area"><i style={{ height: `${w.metrics.clusteredVehicles / maxCount * 72}%` }}><b>{w.metrics.clusteredVehicles}</b></i></span><small>{shortTime(w.windowStart)}</small></button>)}</div><p>{visible.length < windows.length ? `展示所选时间附近 ${visible.length} 窗；全部时间可在顶部选择。` : windows.length === 1 ? '仅一个有数据窗，暂不能判断变化。' : '点击柱形切换 · 缺失窗口不补零'}<br/>各窗独立聚类，不代表同一聚集事件持续。</p></div>;
  else content = clusters.length ? <div className="monitor-ranking"><div className="monitor-trend-caption"><span>按车辆数排序 · 点击定位</span><button onClick={onDetails}>全部 {clusters.length} 簇 ↗</button></div><ol>{clusters.slice(0, Math.min(20, item.rowCount)).map((cluster, i) => <li key={cluster.id}><button aria-pressed={selectedCluster === `cluster:${cluster.label}`} onClick={() => onFocus(`cluster:${cluster.label}`)} aria-label={`定位聚集簇 ${cluster.label + 1}，${cluster.vehicleCount} 辆`}><span className="monitor-rank">{String(i + 1).padStart(2, '0')}</span><span className="monitor-cluster-info"><span>聚集簇 {cluster.label + 1}<b>{cluster.vehicleCount} <small>辆</small></b></span><small title={`成员参考位置：${locations?.[`vehicle:${cluster.memberKeys[0]}`] || cluster.center.join(', ')}；覆盖半径 ${(cluster.radiusKm * 1000).toFixed(0)} m`}>{locations?.[`vehicle:${cluster.memberKeys[0]}`] || cluster.center.map(v => v.toFixed(3)).join(', ')} · 半径 {(cluster.radiusKm * 1000).toFixed(0)} m</small><span className="monitor-rank-track"><i style={{ width: `${cluster.vehicleCount / clusters[0].vehicleCount * 100}%` }}/></span></span></button></li>)}</ol></div> : <div className="monitor-empty"><strong>当前窗无聚集</strong><p>{total} 辆车均未达到当前聚集条件。</p><button onClick={() => onFocus('vehicle:all')}>查看全部车辆 ↗</button></div>;
  return <DashboardWidget config={{ ...item, surface: 'glass', subtitle }} data={{ rows: [] }}>{content}</DashboardWidget>;
}
