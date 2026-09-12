import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, DownloadSimple, LockKey, Plus, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { CONFIG_FILE_LIMIT, MODULE_TYPES, SOURCES, normalizeConfig } from './dashboardConfig.js';
import { TEMPLATE_LIMIT, deleteTemplate, getBuiltinTemplates, parseTemplateFile, readTemplates, saveTemplate, serializeTemplate } from './templateLibrary.js';
import './editor-panels.css';

const groupTypes = [
  { title: '指标与状态', types: ['metric', 'gauge', 'progress', 'status'] },
  { title: '趋势与分布', types: ['line', 'area', 'column', 'bar', 'donut'] },
  { title: '表格与内容', types: ['table', 'text', 'clock', 'map'] },
];
const fieldNames = { name: '名称', value: '数值', time: '时间', status: '状态', target: '目标', series: '系列', code: '区域编码' };

function MiniChart({ type }) {
  return <svg className="ep-mini-chart" viewBox="0 0 100 48" fill="none" aria-hidden="true">
    {type === 'metric' ? <><path d="M9 10h25" opacity=".45"/><text x="8" y="36" fill="currentColor" stroke="none" fontSize="26">8,640</text><path d="m79 29 5-5 5 5m-5-5v11"/></> :
    ['gauge', 'donut'].includes(type) ? <><circle cx="50" cy="25" r="17" strokeWidth="5" opacity=".18"/><path d={type === 'gauge' ? 'M33 25a17 17 0 1 1 28 13' : 'M50 8a17 17 0 1 1-16 23'} strokeWidth="5"/><text x="50" y="29" textAnchor="middle" fontSize="10" stroke="none" fill="currentColor">86%</text></> :
    ['line', 'area'].includes(type) ? <><path d="M8 38h84M8 9v29" opacity=".2"/>{type === 'area' && <path d="M9 34 24 27 40 30 56 15 72 20 90 8v30H9Z" fill="currentColor" stroke="none" opacity=".17"/>}<path d="m9 34 15-7 16 3 16-15 16 5L90 8" strokeWidth="2"/></> :
    type === 'column' ? <>{[18, 29, 22, 35, 28].map((height, index) => <rect key={index} x={12 + index * 17} y={41 - height} width="10" height={height} fill="currentColor" stroke="none" opacity={.4 + index * .12}/>)}</> :
    ['bar', 'progress'].includes(type) ? <>{[75, 57, 38].map((width, index) => <g key={index}><path d={`M12 ${12 + index * 13}h76`} opacity=".14" strokeWidth="6"/><path d={`M12 ${12 + index * 13}h${width}`} strokeWidth="6" opacity={1 - index * .2}/></g>)}</> :
    type === 'table' ? <><rect x="8" y="6" width="84" height="36" rx="3" opacity=".4"/><path d="M8 17h84M8 29h84M38 6v36M69 6v36" opacity=".45"/><path d="M14 11h16m14 0h18m13 0h11"/></> :
    type === 'status' ? <>{[0, 1, 2].map(index => <g key={index}><circle cx="16" cy={11 + index * 13} r="3" fill="currentColor" stroke="none" opacity={1 - index * .25}/><path d={`M28 ${11 + index * 13}h${51 - index * 8}`} opacity=".55"/></g>)}</> :
    type === 'text' ? <><path d="M13 11h73M13 24h73M13 37h44" strokeWidth="3" opacity=".65"/></> :
    type === 'clock' ? <><text x="50" y="29" textAnchor="middle" fontSize="23" fill="currentColor" stroke="none">14:36</text><path d="M25 39h50" opacity=".35"/></> :
    <><path d="m16 19 12-5 7-9 10 6 6-4 9 8 16-1 10 11-9 5-11 2-8 10-8-5-8 4-9-11-11-2Z" fill="currentColor" fillOpacity=".13"/><path d="m28 18 23 8 22-6M51 26l-7 12" opacity=".45"/><circle cx="51" cy="26" r="2" fill="currentColor"/></>}
  </svg>;
}

export function ComponentLibrary({ onAdd }) {
  return <section className="ep-library" aria-label="组件库">
    <div className="ep-panel-heading"><h2>组件库</h2><span>13 种组件</span></div>
    {groupTypes.map(group => <section className="ep-library-group" key={group.title}><h3>{group.title}</h3><div className="ep-library-grid">{group.types.map(type => <button type="button" className="ep-component-card" key={type} onClick={() => onAdd(type)} aria-label={`添加${type === 'map' ? '三维地图' : MODULE_TYPES.find(item => item.id === type)?.label ?? type}`}><MiniChart type={type}/><span>{type === 'map' ? '三维地图' : MODULE_TYPES.find(item => item.id === type)?.label ?? type}<Plus size={12}/></span></button>)}</div></section>)}
    <p className="ep-muted">点击添加到画布，拖动边框调整位置与大小。</p>
  </section>;
}

function Field({ label, value, onChange, maxLength = 40, placeholder = '' }) {
  return <label className="ep-field"><span>{label}</span><input value={value ?? ''} onChange={event => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder}/></label>;
}

function NumberField({ label, value, onChange, min = 0, max = 100, step = .1 }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const number = Number(text);
    if (!text.trim() || !Number.isFinite(number)) { setText(String(value)); return; }
    const next = Math.min(max, Math.max(min, Math.round(number * 10) / 10));
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return <label className="ep-field"><span>{label}</span><input type="number" value={text} min={min} max={max} step={step} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') setText(String(value)); }}/></label>;
}

function Select({ label, value, onChange, children }) {
  return <label className="ep-field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{children}</select></label>;
}

function Toggle({ label, value, onChange }) {
  return <label className="ep-toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)}/></label>;
}

export function ComponentInspector({ item, isMap = false, dataSources = [], onChange, onDuplicate, onDelete, onArrange }) {
  if (!item) return <section className="ep-inspector ep-empty"><div className="ep-empty-shape" aria-hidden="true"/><h2>选择画布组件</h2><p>点击组件后，可编辑内容、位置与数据绑定。</p></section>;
  const layout = item.layout;
  const binding = item.binding ?? { sourceId: 'demo', fields: {} };
  const custom = binding.sourceId !== 'demo';
  const boundSource = dataSources.find(entry => entry.id === binding.sourceId);
  const source = SOURCES[item.source];
  const availableColumns = custom ? Object.entries(fieldNames).map(([key, label]) => ({ key, label })) : source?.columns ?? [];
  const changeSource = (id, type = item.type) => onChange({ type, source: id, unit: SOURCES[id].unit, columns: structuredClone(SOURCES[id].columns) });
  const changeType = type => {
    if (['text', 'clock'].includes(type)) { onChange({ type, source: 'devices', columns: structuredClone(SOURCES.devices.columns), binding: { ...binding, sourceId: 'demo' } }); return; }
    const sources = MODULE_TYPES.find(entry => entry.id === type)?.sources ?? [];
    const nextSource = sources.includes(item.source) ? item.source : sources[0] ?? item.source;
    if (SOURCES[nextSource]) changeSource(nextSource, type);
    else onChange({ type });
  };
  const changeBinding = sourceId => onChange({ binding: { ...binding, sourceId }, ...(sourceId === 'demo' ? { columns: structuredClone(source.columns), unit: source.unit } : {}) });
  return <section className="ep-inspector" aria-label="组件属性">
    <div className="ep-panel-heading"><h2>{isMap ? '三维地图' : '组件属性'}</h2><span>{isMap ? 'MAP' : MODULE_TYPES.find(type => type.id === item.type)?.label}</span></div>
    <div className="ep-state-controls"><Toggle label="显示" value={item.visible} onChange={visible => onChange({ visible })}/><Toggle label="锁定" value={item.locked} onChange={locked => onChange({ locked })}/></div>
    <section className="ep-property-section"><h3>位置与大小 <span>%</span></h3><div className="ep-field-grid"><NumberField label="X 位置" value={layout.x} max={100 - layout.w} onChange={x => onChange({ layout: { ...layout, x } })}/><NumberField label="Y 位置" value={layout.y} max={100 - layout.h} onChange={y => onChange({ layout: { ...layout, y } })}/><NumberField label="宽度" value={layout.w} min={10} max={100 - layout.x} onChange={w => onChange({ layout: { ...layout, w } })}/><NumberField label="高度" value={layout.h} min={10} max={100 - layout.y} onChange={h => onChange({ layout: { ...layout, h } })}/></div>{item.locked && <p className="ep-muted"><LockKey size={12}/> 画布拖动已锁定，仍可输入精确尺寸。</p>}{!isMap && <div className="ep-layer-actions"><button type="button" onClick={() => onArrange('front')}><ArrowUp size={13}/>置于顶层</button><button type="button" onClick={() => onArrange('back')}><ArrowDown size={13}/>置于底层</button></div>}</section>
    {!isMap && <>
      <section className="ep-property-section"><h3>内容与样式</h3><Field label="标题" value={item.title} maxLength={20} onChange={title => onChange({ title })}/><Field label="副标题" value={item.subtitle} onChange={subtitle => onChange({ subtitle })}/><div className="ep-field-grid"><Select label="组件类型" value={item.type} onChange={changeType}>{MODULE_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</Select><Select label="面板材质" value={item.surface} onChange={surface => onChange({ surface })}><option value="glass">烟灰玻璃</option><option value="soft">轻透玻璃</option><option value="solid">深色面板</option></Select></div>{item.type === 'text' ? <label className="ep-field"><span>文本内容</span><textarea value={item.text} maxLength={1000} rows={5} onChange={event => onChange({ text: event.target.value })}/></label> : item.type !== 'clock' && <div className="ep-field-grid"><Field label="数值单位" value={item.unit} maxLength={8} onChange={unit => onChange({ unit })}/><NumberField label="显示条数" value={item.rowCount} min={1} max={100} step={1} onChange={rowCount => onChange({ rowCount: Math.round(rowCount) })}/></div>}{['gauge', 'progress'].includes(item.type) && <NumberField label="目标值" value={item.target} min={.1} max={1e12} onChange={target => onChange({ target })}/>}</section>
      {!['text', 'clock'].includes(item.type) && <section className="ep-property-section"><h3>数据绑定</h3><Select label="接入数据源" value={binding.sourceId} onChange={changeBinding}><option value="demo">内置示例数据</option>{custom && !boundSource && <option value={binding.sourceId}>数据源已移除</option>}{dataSources.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</Select>{custom ? <>{!boundSource && <p className="ep-error">请选择可用数据源，恢复此组件的数据连接。</p>}<div className="ep-field-grid"><Select label="数值汇总" value={item.aggregate} onChange={aggregate => onChange({ aggregate })}><option value="sum">求和</option><option value="average">平均值</option><option value="first">第一条</option></Select><div className="ep-bound-source"><span>来源</span><strong>{{ http: 'HTTP 接口', json: '静态 JSON', csv: 'CSV 表格' }[boundSource?.type] ?? '未连接'}</strong></div></div><details className="ep-mapping" open><summary>字段映射</summary><p className="ep-muted">填写数据字段路径，例如 device.name。</p><div className="ep-field-grid">{Object.entries(fieldNames).map(([key, label]) => <Field key={key} label={label} value={binding.fields[key]} maxLength={160} placeholder={key} onChange={value => onChange({ binding: { ...binding, fields: { ...binding.fields, [key]: value } } })}/>)}</div></details></> : <Select label="示例内容" value={item.source} onChange={id => changeSource(id)}>{(MODULE_TYPES.find(type => type.id === item.type)?.sources ?? []).map(id => <option key={id} value={id}>{SOURCES[id].label}</option>)}</Select>}</section>}
      {item.type === 'table' && <section className="ep-property-section"><h3>表格列</h3><div className="ep-columns">{availableColumns.map(column => {
        const current = item.columns.find(entry => entry.key === column.key);
        return <div className="ep-column" key={column.key}><label><input type="checkbox" checked={Boolean(current)} disabled={Boolean(current) && item.columns.length === 1} onChange={event => onChange({ columns: event.target.checked ? [...item.columns, { ...column }] : item.columns.filter(entry => entry.key !== column.key) })}/><span>{column.label}</span></label><input aria-label={`${column.label}列标题`} maxLength={12} value={current?.label ?? column.label} disabled={!current} onChange={event => onChange({ columns: item.columns.map(entry => entry.key === column.key ? { ...entry, label: event.target.value } : entry) })}/></div>;
      })}</div></section>}
    </>}
    <div className="ep-inspector-actions">{!isMap && <button type="button" onClick={onDuplicate}><Copy size={14}/>复制组件</button>}<button type="button" className="ep-delete" onClick={onDelete}><Trash size={14}/>{isMap ? '隐藏地图' : '删除组件'}</button></div>
  </section>;
}

function TemplateThumbnail({ config }) {
  return <div className="ep-template-thumbnail" aria-hidden="true">{config.map.visible && <div className="ep-template-map" style={{ left: `${config.map.layout.x}%`, top: `${config.map.layout.y}%`, width: `${config.map.layout.w}%`, height: `${config.map.layout.h}%` }}><MiniChart type="map"/></div>}{config.modules.filter(item => item.visible).map(item => <div key={item.id} className={`ep-template-module ep-template-module-${item.surface}`} style={{ left: `${item.layout.x}%`, top: `${item.layout.y}%`, width: `${item.layout.w}%`, height: `${item.layout.h}%` }}><MiniChart type={item.type}/></div>)}</div>;
}

export function TemplatePanel({ config, onLoad, onClose }) {
  const [templates, setTemplates] = useState([]), [name, setName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const dialog = useRef(null), fileInput = useRef(null), opener = useRef(document.activeElement);
  const [builtins] = useState(getBuiltinTemplates);
  useEffect(() => {
    const element = dialog.current, previous = opener.current;
    if (!element.open) element.showModal();
    try { setTemplates(readTemplates()); } catch (issue) { setError(issue.message); }
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const run = action => { setError(''); setNotice(''); try { action(); } catch (issue) { setError(issue.message); } };
  const load = next => run(() => { if (onLoad(normalizeConfig(next)) === false) throw new Error('模板未载入，请检查画布配置'); onClose(); });
  const save = event => { event.preventDefault(); run(() => { setTemplates(saveTemplate(name, config)); setName(''); setNotice('当前画布已存为模板'); }); };
  const download = () => run(() => {
    const content = serializeTemplate(config);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'nexus-dashboard-template.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('已导出当前画布配置');
  });
  const importFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setError(''); setNotice('');
    try {
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 JSON 配置文件');
      if (file.size > CONFIG_FILE_LIMIT) throw new Error(`配置文件不能超过 ${Math.round(CONFIG_FILE_LIMIT / 1024)} KB`);
      const next = parseTemplateFile(await file.text());
      if (dialog.current?.open) load(next);
    } catch (issue) { setError(issue.message); }
  };
  return <dialog ref={dialog} className="ep-template-dialog" aria-labelledby="ep-template-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="ep-template-heading"><div><span className="ep-kicker">TEMPLATE LIBRARY</span><h2 id="ep-template-title">模板库</h2></div><button type="button" className="ep-icon-button" aria-label="关闭模板库" onClick={onClose}><X size={20}/></button></header>
    <div className="ep-template-body"><div className="ep-template-section-heading"><h3>内置布局</h3><span>载入后可继续编辑与撤销</span></div><div className="ep-template-grid">{builtins.map(template => <button type="button" className="ep-template-card" key={template.id} onClick={() => load(template.config)}><TemplateThumbnail config={template.config}/><strong>{template.name}</strong><span>{template.description}</span></button>)}</div>
      <div className="ep-template-section-heading"><h3>我的模板 <span>{templates.length} / {TEMPLATE_LIMIT}</span></h3></div><form className="ep-template-save" onSubmit={save}><label className="ep-sr-only" htmlFor="ep-template-name">模板名称</label><input id="ep-template-name" placeholder="为当前画布命名" value={name} maxLength={40} required onChange={event => setName(event.target.value)}/><button type="submit" className="ep-primary" disabled={templates.length >= TEMPLATE_LIMIT}><Plus size={15}/>保存为模板</button></form>
      {templates.length ? <div className="ep-template-grid ep-user-templates">{templates.map(template => <article className="ep-user-template" key={template.id}><button type="button" className="ep-template-card" onClick={() => load(template.config)}><TemplateThumbnail config={template.config}/><strong>{template.name}</strong><span>{new Date(template.createdAt).toLocaleDateString('zh-CN')} · {template.config.modules.length} 个组件</span></button><button type="button" className="ep-template-remove" aria-label={`删除模板 ${template.name}`} onClick={() => run(() => { setTemplates(deleteTemplate(template.id)); setNotice('模板已删除，当前画布保持不变'); })}><Trash size={14}/></button></article>)}</div> : <p className="ep-template-empty">保存常用布局，下次直接接入新数据。</p>}
    </div><footer className="ep-template-footer"><p>模板包含已配置的静态数据与接口地址，请勿放入密钥。</p><div className="ep-template-file-actions"><button type="button" onClick={() => fileInput.current.click()}><UploadSimple size={15}/>导入 JSON</button><button type="button" onClick={download}><DownloadSimple size={15}/>导出当前画布</button></div><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importFile}/>{error && <p className="ep-error" role="alert">{error}</p>}{notice && <p className="ep-notice" role="status">{notice}</p>}</footer>
  </dialog>;
}
