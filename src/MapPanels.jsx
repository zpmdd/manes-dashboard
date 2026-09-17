import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CaretRight, Check, GlobeHemisphereEast, RoadHorizon, X } from '@phosphor-icons/react';
import { NATIONAL } from './geo';

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

export function LayerPanel({ layers, setLayers, quality, setQuality, detail, onClose, extraLayers = [], heatHint = '演示数据的空间分布' }) {
  const rows = [...extraLayers, ['roadmap', '离线道路底图', '本地地图图片 · 最大 10 级，放大后细节有限'], ['roads', '道路网络', detail ? '高速、国道及主要干线' : '全国主要道路 · 概化数据'], ['beacons', '监测光柱', '演示节点，暂未关联业务数据'], ['arcs', '区域连线', '示意关联，不表示车辆轨迹'], ['heat', '态势热力', heatHint], ['labels', '区域名称', '全国显示各省名称，下钻显示区域与道路标签']];
  return <Dialog title="调整地图图层" subtitle="MAP LAYERS" onClose={onClose}>
    <div className="switch-list">{rows.map(([key, label, hint]) => <label key={key}><span>{label}<small>{hint}</small></span><input type="checkbox" checked={Boolean(layers[key])} onChange={e => setLayers(s => ({ ...s, [key]: e.target.checked }))}/><span className="switch-track" aria-hidden="true"/></label>)}</div>
    {detail && <div className="road-filters">{[['highway', '高速公路'], ['nationalRoad', '国道 / 干线']].map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={e => setLayers(s => ({ ...s, [key]: e.target.checked }))}/>{label}</label>)}</div>}
    {layers.roadmap && <p className="fineprint">底图内的地名与道路属于图片内容，不随“区域名称”或“道路网络”开关隐藏。</p>}
    <div className="quality-heading">渲染质量<span>可随时切换</span></div><div className="segmented">{[['high', '质感优先'], ['balanced', '流畅优先']].map(([v, label]) => <button key={v} className={quality === v ? 'active' : ''} onClick={() => setQuality(v)}>{label}{quality === v && <Check/>}</button>)}</div>
    <p className="fineprint">流畅模式降低像素密度并关闭地面反射。地图静止时停止连续绘制。</p>
  </Dialog>;
}
