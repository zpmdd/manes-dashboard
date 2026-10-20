import { Dialog } from './MapPanels';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CaretRight, Fire, Layout, MapPin, Polygon, Sparkle, Tag, UploadSimple } from '@phosphor-icons/react';
import { clusterOptions, DEFAULT_CLUSTER_OPTIONS, optionsForRows } from './vehicleClustering';
import { DashboardWidget } from './DashboardWidget';
import { CLUSTER_LABEL_LIMIT } from './vehicles';
import './vehicle-analysis.css';

export const windowLabel = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

const shortTime = value => new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' });
const dateLabel = value => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
const analysisMessage = analysis => analysis.status === 'error' ? analysis.error || '聚集计算失败' : analysis.status === 'ready' ? '没有可用 GPS 记录' : '正在重新计算…';
const exportAnalysis = result => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'daoyan-dbscan.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function VehicleTimeline({ analysis, window, onWindow }) {
  const windows = analysis.result?.windows || [], ready = analysis.status === 'ready';
  const selected = Math.max(0, windows.findIndex(item => item.windowStart === window?.windowStart));
  const [preview, setPreview] = useState(null), [playing, setPlaying] = useState(false), [hovered, setHovered] = useState(null);
  const dragging = useRef(false), dragValue = useRef(0), ignoreClick = useRef(false), changeWindow = useRef(onWindow), track = useRef(null);
  changeWindow.current = onWindow;
  const last = windows.length - 1;
  const shownIndex = Math.min(last, Math.max(0, Math.round(preview ?? selected))), shown = windows[shownIndex];
  const inspectedIndex = playing ? shownIndex : hovered ?? shownIndex, inspected = windows[inspectedIndex];
  useEffect(() => { setPreview(null); setHovered(null); dragging.current = false; if (!ready) setPlaying(false); }, [analysis.result, ready]);
  useEffect(() => {
    if (!playing || !ready || selected >= last) { if (playing) setPlaying(false); return; }
    const timer = setTimeout(() => changeWindow.current(windows[selected + 1].windowStart), 2000);
    return () => clearTimeout(timer);
  }, [playing, ready, selected, last, windows]);
  const choose = index => { setPlaying(false); setPreview(null); if (windows[index]) onWindow(windows[index].windowStart); };
  const pointerValue = event => { const rect = track.current.getBoundingClientRect(); return Math.max(0, Math.min(last, (event.clientY - rect.top) / Math.max(1, rect.height) * last)); };
  const begin = event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true; ignoreClick.current = false; setPlaying(false);
    dragValue.current = pointerValue(event); setPreview(dragValue.current); setHovered(Math.round(dragValue.current));
  };
  const move = event => { const value = pointerValue(event); setHovered(Math.round(value)); if (dragging.current) { dragValue.current = value; setPreview(value); } };
  const release = event => { if (!dragging.current) return; dragging.current = false; ignoreClick.current = true; choose(Math.round(dragValue.current)); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const cancel = () => { dragging.current = false; setPreview(null); setHovered(null); };
  if (!ready || !shown) return <div className="vehicle-timeline timeline-empty" role={analysis.status === 'error' ? 'alert' : 'status'} title={analysisMessage(analysis)} aria-label={analysisMessage(analysis)}>{analysis.status === 'error' ? '计算失败' : ready ? '暂无时间窗' : '计算中…'}</div>;
  return <section className="vehicle-timeline" aria-label="分析时间窗" style={{ '--timeline-natural-height': Math.max(169, last * 28 + 57) + 'px', '--time-intervals': Math.max(1, last) }} onPointerLeave={event => { if (!event.currentTarget.contains(event.relatedTarget) && !dragging.current) setHovered(null); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setHovered(null); if (dragging.current) cancel(); } }}>
    <div className="timeline-body">
      <div ref={track} className={'timeline-track' + (preview !== null ? ' is-dragging' : '')} style={{ '--time-position': (last ? (preview ?? selected) / last * 100 : 0) + '%' }} onPointerDown={begin} onPointerMove={move} onPointerUp={release} onPointerCancel={cancel}>
        <div className="timeline-rail" aria-hidden="true"><i/></div>
        <input type="range" aria-label="切换分析时间窗" aria-orientation="vertical" aria-valuetext={windowLabel(shown.windowStart) + ' 至 ' + shortTime(shown.windowEnd)} min="0" max={Math.max(0, last)} step="any" value={preview ?? selected} disabled={!last} onFocus={() => setHovered(selected)} onKeyDown={event => {
          const next = { ArrowLeft: selected - 1, ArrowUp: selected - 1, ArrowRight: selected + 1, ArrowDown: selected + 1, Home: 0, End: last, PageUp: selected - 5, PageDown: selected + 5 }[event.key];
          if (next !== undefined) { event.preventDefault(); const index = Math.max(0, Math.min(last, next)); setHovered(index); choose(index); }
        }} onChange={event => { const value = Number(event.target.value); if (dragging.current) { dragValue.current = value; setPreview(value); } else choose(Math.round(value)); }}/>
        <div className="timeline-ticks">{windows.map((item, index) => { const distance = Math.abs(index - inspectedIndex); return <button key={item.windowStart} aria-pressed={index === shownIndex} aria-label={'切换至 ' + windowLabel(item.windowStart)} onFocus={() => setHovered(index)} onClick={event => { if (ignoreClick.current && event.detail > 0) { ignoreClick.current = false; return; } choose(index); }} style={{ top: (last ? index / last * 100 : 0) + '%', '--tick-width': (index === shownIndex ? 28 : distance === 0 ? 24 : distance === 1 ? 20 : distance === 2 ? 15 : 10) + 'px' }}><i aria-hidden="true"/></button>; })}</div>
      </div>
      {(hovered !== null || playing) && inspected && <div className="timeline-preview" role="group" aria-label="时间窗预览" style={{ top: `calc(14px + (100% - 28px) * ${last ? inspectedIndex / last : 0})` }}><small>{dateLabel(inspected.windowStart)}</small><strong>{shortTime(inspected.windowStart)}–{shortTime(inspected.windowEnd)}</strong><span>{inspected.quality?.usableVehicles ?? '—'} 辆 · {inspected.metrics?.clusterCount ?? '—'} 簇</span><button className="timeline-play" aria-label={playing ? '暂停分窗播放' : '播放分窗变化'} aria-pressed={playing} disabled={windows.length < 2} onClick={() => { if (playing) { setPlaying(false); setHovered(shownIndex); } else { if (selected === last) onWindow(windows[0].windowStart); setPlaying(true); } }}>{playing ? '暂停播放' : '播放时间窗'}</button></div>}
    </div>
    <time key={shown.windowStart} className="timeline-window" title={windowLabel(shown.windowStart) + ' 至 ' + shortTime(shown.windowEnd)}>{shortTime(shown.windowStart)}</time>
  </section>;
}

export function VehicleLayerControls({ layers, setLayers, restrictions = false }) {
  const controls = [['vehicles', '车辆点位', MapPin], ['heat', '聚集热区', Fire], ['clusters', '聚集标签', Tag], ['beacons', '聚集光柱', Sparkle], ...(restrictions ? [['restrictions', '限行区域', Polygon]] : [])];
  return <div className="vehicle-layer-controls" role="group" aria-label="车辆地图图层">{controls.map(([key, title, Icon]) => <button key={key} aria-label={title} title={title} aria-pressed={Boolean(layers[key])} onClick={() => setLayers(previous => ({ ...previous, [key]: !previous[key] }))}><Icon size={18}/><span>{title}</span></button>)}</div>;
}

export function VehicleAnalysisPage({ analysis, window, onWindow, onFocus, onDetails, locations, selectedCluster }) {
  const ready = analysis.status === 'ready', result = ready ? analysis.result : null;
  const total = ready && window ? window.quality.usableVehicles : null, count = ready && window ? window.metrics.clusteredVehicles : null;
  const clusters = ready ? [...(window?.clusters || [])].sort((a, b) => b.vehicleCount - a.vehicleCount || a.label - b.label) : [];
  return <section className="vehicle-analysis-page" aria-label="聚集分析页面" aria-busy={!ready && analysis.status !== 'error'}>
    <header className="analysis-page-heading"><div><h2>聚集分析</h2><p>全国数据 · 按 GPS 时间窗独立计算</p></div><button disabled={!result} onClick={() => exportAnalysis(result)}><UploadSimple size={18}/>导出结果</button></header>
    <div className="analysis-page-layout"><aside className="analysis-page-timeline"><VehicleTimeline analysis={analysis} window={window} onWindow={onWindow}/></aside><div className="analysis-page-content">
    <dl key={window?.windowStart} className="analysis-kpis analysis-glass widget-surface-glass">{[['有效车辆', total, '辆'], ['聚集车辆', count, '辆'], ['聚集簇', ready && window ? clusters.length : null, '个'], ['聚集占比', total === null ? null : total ? (count / total * 100).toFixed(2) : '0.00', '%']].map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{value === null ? '—' : typeof value === 'number' ? value.toLocaleString() : value}<small>{unit}</small></dd></div>)}</dl>
    <div className="analysis-page-grid">
      <div className="analysis-page-main"><div className="analysis-page-trend"><VehicleAnalysisCard item={{ id: 'analysis-trend', title: '分窗聚集变化', type: 'column', vehicleView: 'trend' }} analysis={analysis} window={window} onWindow={onWindow}/></div>
        <section className="analysis-cluster-table analysis-glass widget-surface-glass"><header><h3>聚集簇明细</h3><span>{ready && window ? `${clusters.length} 个簇 · 按车辆数排序` : '等待计算'}</span></header>
          {ready && window ? clusters.length ? <><div className="analysis-table-scroll"><table><thead><tr><th>聚集簇</th><th>车辆数</th><th>成员参考位置</th><th>覆盖半径</th><th>操作</th></tr></thead><tbody>{clusters.slice(0, 100).map(cluster => <tr key={cluster.id} className={selectedCluster === `cluster:${cluster.label}` ? 'is-selected' : ''}><td>聚集簇 {cluster.label + 1}</td><td>{cluster.vehicleCount}</td><td title={cluster.center.map(value => value.toFixed(6)).join(', ')}>{locations?.[`vehicle:${cluster.memberKeys[0]}`] || cluster.center.map(value => value.toFixed(3)).join(', ')}</td><td>{(cluster.radiusKm * 1000).toFixed(0)} m</td><td><button aria-label={`地图定位聚集簇 ${cluster.label + 1}`} onClick={() => onFocus(`cluster:${cluster.label}`)}>地图定位<ArrowUpRight size={14}/></button></td></tr>)}</tbody></table></div>{clusters.length > 100 && <p>展示前 100 簇，导出包含全部结果。</p>}{clusters.length > CLUSTER_LABEL_LIMIT && <p>地图展示全部簇点，优先标注 {CLUSTER_LABEL_LIMIT} 簇。</p>}</> : <div className="monitor-empty"><strong>当前窗无聚集</strong><p>{total} 辆车未达到当前聚集条件。</p></div> : <div className="monitor-empty">{analysisMessage(analysis)}</div>}
        </section>
      </div>
      <aside className="analysis-page-aside"><section className="analysis-noise analysis-glass widget-surface-glass"><h3>非聚集车辆</h3><strong>{ready && window ? window.metrics.noiseVehicles.toLocaleString() : '—'}<small>辆</small></strong><p>未达到当前参数的聚集条件</p><button disabled={!ready || !window?.metrics.noiseVehicles} onClick={() => onFocus('cluster:-1')}>地图查看<ArrowRight size={15}/></button></section>
        <section className="analysis-computation analysis-glass widget-surface-glass"><h3>本次计算</h3><dl>{[['邻域半径', result ? `${result.options.epsKm} km` : '—'], ['最少车辆数', result ? `${result.options.minSamples} 辆` : '—'], ['时间窗', result ? `${result.options.windowMinutes} 分钟` : '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="analysis-parameter-note">参数在页面设置中调整</p><h3>数据质量</h3><QualityRows result={result} window={ready ? window : null}/><button disabled={!result} onClick={onDetails}>查看计算明细<ArrowRight size={15}/></button></section>
      </aside>
    </div><p className="analysis-scope-note">下钻仅改变地图视野，统计口径保持全国当前时间窗；各窗独立聚类，不代表同一事件持续。</p>
    </div></div>
  </section>;
}

function QualityRows({ result, window, includeInput = false }) {
  return <dl className="analysis-quality-rows">{[...(includeInput ? [['原始记录（整批）', result?.inputRows, '条']] : []), ['无效记录（整批）', result?.rejected.length, '条'], ['位置冲突（本窗）', window?.quality.conflictVehicles, '辆'], ...(!includeInput ? [['合并记录（本窗）', window?.quality.collapsedRows, '条']] : [])].map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{value === undefined ? '—' : value.toLocaleString()}<small>{unit}</small></dd></div>)}</dl>;
}

export function VehicleAnalysisDetails({ analysis: { result }, window, onClose, onFocus }) {
  return <Dialog title="数据与算法" subtitle="DBSCAN · 车辆空间聚集" onClose={onClose} wide>
    <div className="analysis-detail">
      <p>按 GPS 采集时间分窗，同一车牌及颜色在每窗保留最新有效点位。邻域计数包含自身，距离不大于 {result.options.epsKm} km 且达到 {result.options.minSamples} 辆时为核心点。</p>
      <p>时间窗 {result.options.windowMinutes} 分钟（左闭右开，北京时间显示）。{result.options.coordinateSystem === 'unknown' ? '坐标系尚未确认；按原坐标试算，未根据 ENCRYPT 做转换。' : `坐标系按批次声明为 ${result.options.coordinateSystem}，未作转换。`}孤立点是本参数下的非聚集车辆，不代表异常车辆。</p>
      <p>输入 {result.inputRows} 条 · {result.windows.length} 个非空时间窗 · 无效记录 {result.rejected.length} 条。通过「页面设置 → 聚集算法」调整并保存参数。地图与左侧统计均为全国输入批次的所选时间窗，下钻仅改变视野。</p>
      {window && <><p>当前窗 {windowLabel(window.windowStart)} 至 {windowLabel(window.windowEnd)} · 合并历史/重复记录 {window.quality.collapsedRows} 条 · 位置冲突隔离 {window.quality.conflictVehicles} 辆</p>
      <div className="analysis-table-scroll"><table><thead><tr><th>簇</th><th>车辆数</th><th>中心（经度 / 纬度）</th><th>覆盖半径</th><th>定位</th></tr></thead><tbody>{window.clusters.slice(0, 100).map(cluster => <tr key={cluster.id}><td>{cluster.label + 1}</td><td>{cluster.vehicleCount}</td><td>{cluster.center.map(n => n.toFixed(6)).join(' / ')}</td><td>{(cluster.radiusKm * 1000).toFixed(1)} m</td><td><button onClick={() => onFocus(`cluster:${cluster.label}`)}>定位簇 {cluster.label + 1}</button></td></tr>)}</tbody></table></div>
      {window.clusters.length > 100 && <p>明细展示前 100 簇，导出包含完整结果。</p>}
      <div className="analysis-table-scroll"><table><thead><tr><th>号牌 / 颜色</th><th>采集时间</th><th>簇标签</th><th>点类型</th></tr></thead><tbody>{window.rows.slice(0, 100).map(row => <tr key={row.VEHICLE_KEY}><td>{row.VEHICLENO} / {row.PALTE_COLOR}</td><td>{row.GPS_DATE}</td><td>{row.CLUSTER_LABEL}</td><td>{{ core: '核心点', border: '边界点', noise: '孤立点' }[row.POINT_ROLE]}</td></tr>)}</tbody></table></div>{window.rows.length > 100 && <p>展示前 100 辆，导出包含完整结果。</p>}</>}
      {result.rejected.length > 0 && <ul>{result.rejected.slice(0, 20).map((issue, i) => <li key={i}>{issue.sourceRow}：{issue.reason}</li>)}</ul>}
      {window?.conflicts.length > 0 && <ul>{window.conflicts.slice(0, 20).map(issue => <li key={issue.vehicleKey}>{issue.sourceRow}：{issue.reason}</li>)}</ul>}
      <p>覆盖半径为簇内车辆到球面中心的最大距离；链式聚集可能超过邻域半径。单个时间窗不能证明持续停留、频繁聚集或风险等级。</p>
      <button className="text-button" onClick={() => exportAnalysis(result)}>导出完整算法结果</button>
    </div>
  </Dialog>;
}

export function VehiclePageSettings({ options, rows, onApply, onClose, onEdit }) {
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_CLUSTER_OPTIONS, ...options }));
  const [error, setError] = useState('');
  const apply = event => {
    event.preventDefault();
    try { const next = clusterOptions(draft); optionsForRows(rows || [], next); onApply(next); }
    catch (issue) { setError(issue.message); }
  };
  return <Dialog title="页面设置" subtitle="当前大屏" onClose={onClose}>
    <form className="vehicle-page-settings analysis-settings" onSubmit={apply}>
      <section><h3>聚集算法 <small>DBSCAN</small></h3><p>按采集时间分窗，对完整数据批次计算</p></section>
      {[
        ['epsKm', '邻域半径', 'km', .001, 200, .001, '用于判断相邻车辆的距离；簇覆盖范围可能更大。'],
        ['minSamples', '最少车辆数', '辆', 1, 100000, 1, '邻域计数包含车辆自身。'],
        ['windowMinutes', '时间窗', '分钟', 1, 1440, 1, '同车每窗保留最新有效点位，不等同持续停留。'],
      ].map(([key, label, unit, min, max, step, help]) => <label key={key}><span>{label}</span><span className="settings-number"><input aria-label={label} type="number" required min={min} max={max} step={step} value={draft[key]} onChange={event => { setError(''); setDraft({ ...draft, [key]: event.target.value === '' ? '' : Number(event.target.value) }); }}/><span>{unit}</span></span><small>{help}</small></label>)}
      <div className="settings-coordinate"><p>坐标系：{draft.coordinateSystem === 'unknown' ? '待确认，按原坐标试算' : draft.coordinateSystem}</p><button type="button" onClick={() => { setError(''); setDraft({ ...DEFAULT_CLUSTER_OPTIONS, coordinateSystem: draft.coordinateSystem }); }}>恢复默认参数</button></div>
      {rows?.some(row => row.CLUSTER_OPTIONS) && <p>当前是已去重结果，时间窗变更需要接入原始 Excel 批次。</p>}
      {error && <p role="alert">{error}</p>}
      <section className="settings-editor-entry"><h3>外观与数据</h3><button type="button" onClick={onEdit}><Layout size={22}/><span>编辑主题、布局与数据源<small>进入现有画布编辑器</small></span><CaretRight size={18}/></button></section>
      <footer><p>保存后重新计算聚集结果</p><button type="button" onClick={onClose}>取消</button><button className="settings-save" type="submit">保存并计算</button></footer>
    </form>
  </Dialog>;
}

export function VehicleAnalysisCard({ item, analysis, window, onWindow, onFocus, onDetails, locations, selectedCluster, monitoring = false }) {
  const ready = analysis.status === 'ready', windows = analysis.result?.windows || [];
  const selected = windows.indexOf(window), start = Math.max(0, Math.min(selected - 19, windows.length - 40));
  const visible = windows.slice(start, start + 40), maxCount = Math.max(1, ...visible.map(w => monitoring ? w.quality.usableVehicles : w.metrics.clusteredVehicles));
  const total = window?.quality.usableVehicles || 0, count = window?.metrics.clusteredVehicles || 0;
  const share = total ? count / total * 100 : 0;
  const clusters = [...(window?.clusters || [])].sort((a, b) => b.vehicleCount - a.vehicleCount || a.label - b.label);
  const subtitle = window ? `全国 · ${shortTime(window.windowStart)}–${shortTime(window.windowEnd)}` : '全国输入批次';
  let content;
  if (ready && monitoring && item.vehicleView === 'clusters') content = <div className="monitor-quality"><QualityRows result={analysis.result} window={window} includeInput/><button onClick={onDetails}>查看隔离明细<ArrowRight size={14}/></button></div>;
  else if (!ready || !window) content = <div className="monitor-empty" role={analysis.status === 'error' ? 'alert' : 'status'}>{analysis.status === 'error' ? analysis.error : !ready ? '正在重新计算…' : '没有可用 GPS 记录'}</div>;
  else if (monitoring && item.vehicleView === 'overview') content = <div className="monitor-overview monitor-effective"><div className="monitor-share"><strong>{total.toLocaleString()}<small>辆</small></strong><span>{subtitle}</span></div><footer><span>每车每窗保留最新有效点位</span><button onClick={() => onFocus('vehicle:all')}>查看车辆<ArrowRight size={14}/></button></footer></div>;

  else if (item.vehicleView === 'overview') content = <div className="monitor-overview">
    <div className="monitor-share"><strong>{share.toFixed(2)}<small>%</small></strong><span>窗内聚集车辆占比</span></div>
    <div className="monitor-share-track" role="img" aria-label={`聚集 ${count} 辆，占 ${share.toFixed(2)}%；非聚集 ${total - count} 辆`}><i style={{ width: `${share}%` }}/></div>
    <div className="monitor-composition"><button onClick={() => onFocus('vehicle:all')}><span>有效车辆</span><b>{total.toLocaleString()}</b></button><button disabled={!count} onClick={onDetails}><span>聚集车辆</span><b>{count}</b></button><button disabled={total === count} onClick={() => onFocus('cluster:-1')}><span>非聚集</span><b>{total - count}</b></button></div>
    <p title="占比分母为本窗去重且排除位置冲突后的有效车辆">{window.metrics.clusterCount} 个簇 · 去重及冲突隔离后</p>
  </div>;
  else if (item.vehicleView === 'trend') content = <div className="monitor-trend"><div className="monitor-trend-caption"><span>{monitoring ? '有效车辆' : '聚集车辆'} / 辆</span><span>{windows.length} 个有数据窗</span></div><div className="monitor-columns" role="group" aria-label={monitoring ? '分窗有效车辆数，点击切换时间窗' : '分窗聚集车辆数，点击切换时间窗'}>{visible.map(w => { const value = monitoring ? w.quality.usableVehicles : w.metrics.clusteredVehicles; return <button key={w.windowStart} aria-pressed={w === window} aria-label={windowLabel(w.windowStart) + '，' + value + ' 辆' + (monitoring ? '' : '，' + w.metrics.clusterCount + ' 个簇')} title={windowLabel(w.windowStart) + ' · ' + value + ' 辆'} onClick={() => onWindow(w.windowStart)}><span className="monitor-column-area"><i style={{ height: value / maxCount * 72 + '%' }}><b>{value}</b></i></span><small>{shortTime(w.windowStart)}</small></button>; })}</div><p>{visible.length < windows.length ? '展示所选时间附近 ' + visible.length + ' 窗；时间轨道可选择全部窗口。' : windows.length === 1 ? '仅一个有数据窗，暂不能判断变化。' : '点击柱形切换 · 缺失窗口不补零'}{!monitoring && <><br/>各窗独立聚类，不代表同一聚集事件持续。</>}</p></div>;
  else content = clusters.length ? <div className="monitor-ranking"><div className="monitor-trend-caption"><span>按车辆数排序 · 点击定位</span><button onClick={onDetails}>全部 {clusters.length} 簇 ↗</button></div><ol>{clusters.slice(0, Math.min(20, item.rowCount)).map((cluster, i) => <li key={cluster.id}><button aria-pressed={selectedCluster === `cluster:${cluster.label}`} onClick={() => onFocus(`cluster:${cluster.label}`)} aria-label={`定位聚集簇 ${cluster.label + 1}，${cluster.vehicleCount} 辆`}><span className="monitor-rank">{String(i + 1).padStart(2, '0')}</span><span className="monitor-cluster-info"><span>聚集簇 {cluster.label + 1}<b>{cluster.vehicleCount} <small>辆</small></b></span><small title={`成员参考位置：${locations?.[`vehicle:${cluster.memberKeys[0]}`] || cluster.center.join(', ')}；覆盖半径 ${(cluster.radiusKm * 1000).toFixed(0)} m`}>{locations?.[`vehicle:${cluster.memberKeys[0]}`] || cluster.center.map(v => v.toFixed(3)).join(', ')} · 半径 {(cluster.radiusKm * 1000).toFixed(0)} m</small><span className="monitor-rank-track"><i style={{ width: `${cluster.vehicleCount / clusters[0].vehicleCount * 100}%` }}/></span></span></button></li>)}</ol></div> : <div className="monitor-empty"><strong>当前窗无聚集</strong><p>{total} 辆车均未达到当前聚集条件。</p><button onClick={() => onFocus('vehicle:all')}>查看全部车辆 ↗</button></div>;
  return <DashboardWidget config={{ ...item, title: monitoring ? ({ overview: '窗内有效车辆', trend: '分窗车辆数', clusters: '数据质量' }[item.vehicleView] || item.title) : item.title, surface: 'glass', subtitle: monitoring && item.vehicleView === 'overview' ? '' : subtitle }} data={{ rows: [] }}>{content}</DashboardWidget>;
}
