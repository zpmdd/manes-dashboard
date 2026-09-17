import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, CaretRight, Check, GlobeHemisphereEast, RoadHorizon, X } from '@phosphor-icons/react';
import { NATIONAL } from './geo';
import { VEHICLE_FIELDS, VEHICLES } from './vehicles';

export function IconButton({ label, children, active, className = '', ...props }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} aria-label={label} aria-pressed={active} title={label} {...props}>{children}</button>;
}

export function Dialog({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(), opener = useRef(document.activeElement);
  useEffect(() => {
    const element = ref.current, previous = opener.current;
    if (!element.open) element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={title} className={`dialog ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="dialog-heading"><div><small>{subtitle}</small><h2>{title}</h2></div><IconButton label="关闭" onClick={onClose}><X size={20}/></IconButton></div>{children}</dialog>;
}

export function RegionPicker({ index, onNavigate, onClose, code }) {
  const [search, setSearch] = useState('');
  const results = Object.entries(index).filter(([id, r]) => search ? r.name.includes(search.trim()) || id.includes(search.trim()) : r.parent === code && id !== code).slice(0, 80);
  return <Dialog title="选择区域" subtitle="REGION" onClose={onClose} wide>
    <label className="search-label">区域名称或行政区划代码<input autoFocus placeholder="搜索省、市、区县，如：湖北、武汉" value={search} onChange={e => setSearch(e.target.value)}/></label>
    <div className="region-actions"><button onClick={() => onNavigate(NATIONAL)}><GlobeHemisphereEast/>全国概览</button><button onClick={() => onNavigate('420381')}><RoadHorizon/>丹江口 · 道路样区<ArrowUpRight/></button></div>
    <div className="region-grid">{results.map(([id, r]) => <button key={id} onClick={() => onNavigate(id)}><span>{r.name}<small>{index[r.parent]?.name || '全国'} · {id}</small></span><CaretRight size={14}/></button>)}</div>
    {!results.length && <p className="empty">{search ? '没有找到这个区域，请尝试简称或行政区划代码。' : '已到当前数据的最细层级，可搜索或返回全国选择其他区域。'}</p>}
    {search && results.length === 80 && <p className="fineprint">显示前 80 个匹配结果，请输入更完整的名称。</p>}
  </Dialog>;
}

export function LayerPanel({ layers, setLayers, quality, setQuality, detail, onClose }) {
  const rows = [['vehicles', '车辆信息', '5 辆车 · GPS 时间 2026/9/13 00:00'], ['roadmap', '离线道路底图', '本地地图图片 · 最大 10 级，放大后细节有限'], ['roads', '道路网络', detail ? '高速、国道及主要干线' : '全国主要道路 · 概化数据'], ['beacons', '监测光柱', '演示节点，暂未关联业务数据'], ['arcs', '区域连线', '示意关联，不表示车辆轨迹'], ['heat', '态势热力', '演示数据的空间分布'], ['labels', '区域名称', '全国显示各省名称，下钻显示区域与道路标签']];
  return <Dialog title="调整地图图层" subtitle="MAP LAYERS" onClose={onClose}>
    <div className="switch-list">{rows.map(([key, label, hint]) => <label key={key}><span>{label}<small>{hint}</small></span><input type="checkbox" checked={Boolean(layers[key])} onChange={e => setLayers(s => ({ ...s, [key]: e.target.checked }))}/><span className="switch-track" aria-hidden="true"/></label>)}</div>
    {detail && <div className="road-filters">{[['highway', '高速公路'], ['nationalRoad', '国道 / 干线']].map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={e => setLayers(s => ({ ...s, [key]: e.target.checked }))}/>{label}</label>)}</div>}
    {layers.roadmap && <p className="fineprint">底图内的地名与道路属于图片内容，不随“区域名称”或“道路网络”开关隐藏。</p>}
    <div className="quality-heading">渲染质量<span>可随时切换</span></div><div className="segmented">{[['high', '质感优先'], ['balanced', '流畅优先']].map(([v, label]) => <button key={v} className={quality === v ? 'active' : ''} onClick={() => setQuality(v)}>{label}{quality === v && <Check/>}</button>)}</div>
    <p className="fineprint">流畅模式降低像素密度并关闭地面反射。地图静止时停止连续绘制。</p>
  </Dialog>;
}

export function VehiclePanel({ vehicle, onSelect, onFocus, onClose }) {
  return <Dialog title={`车辆 ${vehicle.VEHICLENO}`} subtitle="VEHICLE · 定位快照" onClose={onClose} wide>
    <div className="vehicle-tabs" aria-label="选择车辆">{VEHICLES.map(item => <button key={item.VEHICLENO} aria-pressed={vehicle === item} onClick={() => onSelect(item)}>车辆 {item.VEHICLENO}</button>)}</div>
    <dl className="vehicle-details">{VEHICLE_FIELDS.map(([key, label]) => <div key={key} className={key.endsWith('_CODE') ? 'vehicle-code' : ''}><dt>{label}</dt><dd>{vehicle[key] ?? '未提供'}</dd></div>)}</dl>
    <button className="vehicle-focus" onClick={() => onFocus(vehicle)}>定位此车<ArrowUpRight size={14}/></button>
    <p className="fineprint">按提供的经纬度展示。号牌颜色、报警、状态和加密标识保留原始编码；坐标系尚未确认。</p>
  </Dialog>;
}

export function VehicleCallout({ vehicle, onClose, onDetails }) {
  return <div className="vehicle-callout" data-vehicle={VEHICLES.indexOf(vehicle)}>
    <svg className="vehicle-callout-leader" aria-hidden="true"><path/><circle r="3"/></svg>
    <section className="vehicle-tooltip vehicle-callout-card" aria-label={`选中车辆 ${vehicle.VEHICLENO} 信息`} onPointerDown={event => event.stopPropagation()}>
      <header><strong>车辆 {vehicle.VEHICLENO}</strong><span>{vehicle.GPS_SPEED > 0 ? '行驶' : '静止'}</span><button onClick={onClose} aria-label="取消车辆选择">×</button></header>
      <dl><div><dt>GPS 速度</dt><dd>{vehicle.GPS_SPEED}</dd></div><div><dt>行车定位速度</dt><dd>{vehicle.RECORD_SPEED}</dd></div><div><dt>经度</dt><dd>{vehicle.GEO_LON.toFixed(6)}</dd></div><div><dt>纬度</dt><dd>{vehicle.GEO_LAT.toFixed(6)}</dd></div></dl>
      <time>GPS · {vehicle.GPS_DATE}</time><button className="vehicle-callout-details" onClick={() => onDetails(vehicle)}>完整车辆信息<ArrowUpRight size={13}/></button>
    </section>
  </div>;
}

export function VehicleTooltip({ value: { vehicles, rect }, detailed, ...events }) {
  const item = vehicles[0], group = vehicles.length > 1;
  const left = Math.max(12, Math.min(rect.right + 12, window.innerWidth - 272));
  const top = Math.max(12, Math.min(rect.top - 12, window.innerHeight - 230));
  return createPortal(<div id="vehicle-hover-details" className="vehicle-tooltip" role="tooltip" style={{ left, top }} {...events}>
    <strong>{group ? `此处 ${vehicles.length} 辆车` : `车辆 ${item.VEHICLENO}`}</strong>
    <span className="vehicle-tooltip-status">{group ? `行驶 ${vehicles.filter(row => row.GPS_SPEED > 0).length} · 静止 ${vehicles.filter(row => row.GPS_SPEED === 0).length}` : item.GPS_SPEED > 0 ? '行驶' : '静止'}</span>
    {group ? <p>{vehicles.map(row => `车辆 ${row.VEHICLENO}`).join('、')}</p> : <dl><div><dt>GPS 速度</dt><dd>{item.GPS_SPEED}</dd></div><div><dt>行车定位速度</dt><dd>{item.RECORD_SPEED}</dd></div><div><dt>经纬度</dt><dd>{item.GEO_LON.toFixed(6)}, {item.GEO_LAT.toFixed(6)}</dd></div></dl>}
    <time>GPS · {item.GPS_DATE}</time><small>{detailed ? '点击选中车辆' : '点击放大查看车辆'}</small>
  </div>, document.body);
}
