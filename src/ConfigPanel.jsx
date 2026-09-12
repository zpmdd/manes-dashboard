import { useEffect, useRef, useState } from 'react';
import { X, SlidersHorizontal } from '@phosphor-icons/react';
import './config.css';

export function ConfigPanel({ config, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({ brand: config.brand, title: config.title, mapTitle: config.mapTitle, navLabels: [...config.navLabels], showClock: config.showClock }));
  const dialog = useRef(), opener = useRef(document.activeElement);
  useEffect(() => { const element = dialog.current, previous = opener.current; if (!element.open) element.showModal(); return () => { element.close(); if (previous?.isConnected) previous.focus(); }; }, []);
  const field = (key, label, maxLength) => <label className="config-field"><span>{label}</span><input value={draft[key]} required maxLength={maxLength} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/></label>;
  return <dialog ref={dialog} className="config-dialog global-config-dialog" aria-labelledby="global-config-title" onCancel={e => { e.preventDefault(); onClose(); }}><form onSubmit={e => { e.preventDefault(); if (onApply(draft) !== false) onClose(); }}>
    <header className="config-heading"><div><span className="config-kicker"><SlidersHorizontal size={13}/>SCREEN SETTINGS</span><h2 id="global-config-title">全局设置</h2></div><button type="button" className="config-close" onClick={onClose} aria-label="关闭全局设置"><X/></button></header>
    <div className="config-editor"><div className="config-grid">{field('brand', '品牌名称', 16)}{field('title', '大屏标题', 36)}{field('mapTitle', '地图标题', 24)}<label className="config-switch"><span>显示时钟</span><input type="checkbox" checked={draft.showClock} onChange={e => setDraft({ ...draft, showClock: e.target.checked })}/><i/></label></div><h3 className="config-subheading">导航名称</h3><div className="config-grid">{draft.navLabels.map((label, index) => <label key={index} className="config-field"><span>导航 {index + 1}</span><input required maxLength={8} value={label} onChange={e => setDraft({ ...draft, navLabels: draft.navLabels.map((value, i) => i === index ? e.target.value : value) })}/></label>)}</div></div>
    <footer className="config-footer"><span className="config-note">应用到当前编辑草稿</span><div className="config-save-actions"><button type="button" onClick={onClose}>取消</button><button className="config-apply" type="submit">应用设置</button></div></footer>
  </form></dialog>;
}
