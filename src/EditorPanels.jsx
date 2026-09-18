import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, DownloadSimple, LockKey, Plus, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { CONFIG_FILE_LIMIT, DEFAULT_CHART_OPTIONS, MODULE_TYPES, SOURCES, normalizeConfig, configForProject, defaultConfigForProject, readLegacyConfig, legacyProject } from './dashboardConfig.js';
import { TEMPLATE_LIMIT, deleteTemplate, getBuiltinTemplates, parseTemplateFile, readTemplates, readLegacyTemplates, saveTemplate, serializeTemplate } from './templateLibrary.js';
import { NAME_GROUP_TYPES, getMappedData } from './dataSources.js';
import { profileDataFields, suggestDataFields } from './dataInference.js';
import { PROFESSIONAL_TYPES as professionalTypes, SERIES_TYPES, ZOOM_TYPES } from './widgetData.js';
import { buildProfessionalChart } from './professionalCharts.js';
import './editor-panels.css';

const groupTypes = [
  { title: '指标与状态', types: ['metric', 'gauge', 'progress', 'status'] },
  { title: '趋势与对比', types: ['line', 'multiLine', 'area', 'stackedArea', 'bar', 'column', 'groupedColumn', 'stacked', 'combo'] },
  { title: '占比与构成', types: ['pie', 'donut', 'rose', 'percentStacked', 'funnel', 'treemap'] },
  { title: '统计与关系', types: ['histogram', 'boxplot', 'waterfall', 'scatter', 'radar', 'heatmap'] },
  { title: '表格与内容', types: ['table', 'text', 'clock', 'map'] },
];
const fieldNames = { name: '名称', value: '数值', time: '时间', status: '状态', target: '目标', series: '系列', code: '区域编码', x: 'X 维度', y: 'Y 维度', value2: '辅助数值' };

function MiniChart({ type }) {
  return <svg className="ep-mini-chart" viewBox="0 0 100 48" fill="none" aria-hidden="true">
    {type === 'metric' ? <><path d="M9 10h25" opacity=".45"/><text x="8" y="36" fill="currentColor" stroke="none" fontSize="26">8,640</text><path d="m79 29 5-5 5 5m-5-5v11"/></> :
    type === 'pie' ? <><path d="M48 24V5a19 19 0 1 0 19 19Z" fill="currentColor" opacity=".8"/><path d="M53 20V2a18 18 0 0 1 18 18Z" fill="currentColor" opacity=".35"/></> :
    type === 'rose' ? <><path d="M50 25V4a21 21 0 0 1 21 21Z" fill="currentColor"/><path d="M50 25h17a17 17 0 0 1-17 17Z" fill="currentColor" opacity=".65"/><path d="M50 25v12a12 12 0 0 1-12-12Z" fill="currentColor" opacity=".4"/><path d="M50 25H34a16 16 0 0 1 16-16Z" fill="currentColor" opacity=".25"/></> :
    type === 'groupedColumn' ? <>{[0,1,2,3].map(i => <g key={i}><rect x={10+i*22} y={18-i*3} width="7" height={23+i*3} fill="currentColor"/><rect x={19+i*22} y={27-i*4} width="7" height={14+i*4} fill="currentColor" opacity=".4"/></g>)}</> :
    type === 'stackedArea' ? <><path d="M8 36 29 27 50 32 71 17 92 22V42H8Z" fill="currentColor" opacity=".7"/><path d="M8 36V22l21-9 21 5 21-13 21 7v10L71 17 50 32 29 27Z" fill="currentColor" opacity=".25"/></> :
    type === 'percentStacked' ? <>{[10,19,14,23,16].map((height,i) => <g key={i}><rect x={10+i*18} y="6" width="11" height="36" fill="currentColor" opacity=".3"/><rect x={10+i*18} y={42-height} width="11" height={height} fill="currentColor"/></g>)}</> :
    type === 'histogram' ? <>{[8,20,32,38,29,18,7].map((height,i) => <rect key={i} x={8+i*12} y={43-height} width="11" height={height} fill="currentColor" opacity={.4+i*.06}/>)}</> :
    type === 'boxplot' ? <>{[0,1,2].map(i => <g key={i}><path d={`M${22+i*28} 5v37m-7-37h14m-14 37h14`}/><rect x={14+i*28} y={14+i*2} width="16" height="16" fill="currentColor" fillOpacity=".25"/><path d={`M${14+i*28} ${22+i*2}h16`}/></g>)}</> :
    type === 'waterfall' ? <><path d="M9 40h82" opacity=".2"/>{[[9,27,13],[27,12,15],[45,12,9],[63,21,10],[81,9,31]].map(([x,y,h],i) => <rect key={i} x={x} y={y} width="11" height={h} fill="currentColor" opacity={i===2||i===3?.35:.8}/>)}</> :
    ['gauge', 'donut'].includes(type) ? <><circle cx="50" cy="25" r="17" strokeWidth="5" opacity=".18"/><path d={type === 'gauge' ? 'M33 25a17 17 0 1 1 28 13' : 'M50 8a17 17 0 1 1-16 23'} strokeWidth="5"/><text x="50" y="29" textAnchor="middle" fontSize="10" stroke="none" fill="currentColor">86%</text></> :
    ['line', 'area'].includes(type) ? <><path d="M8 38h84M8 9v29" opacity=".2"/>{type === 'area' && <path d="M9 34 24 27 40 30 56 15 72 20 90 8v30H9Z" fill="currentColor" stroke="none" opacity=".17"/>}<path d="m9 34 15-7 16 3 16-15 16 5L90 8" strokeWidth="2"/></> :
    type === 'multiLine' ? <><path d="m9 35 16-14 17 5 17-17 15 10 17-12" strokeWidth="2"/><path d="m9 20 16 10 17-15 17 9 15-9 17 11" opacity=".4" strokeWidth="2"/></> :
    ['stacked', 'combo'].includes(type) ? <>{[18, 28, 24, 32, 21].map((height, i) => <g key={i}><rect x={12+i*17} y={41-height} width="10" height={height} fill="currentColor" opacity=".4"/>{type === 'stacked' && <rect x={12+i*17} y={41-height} width="10" height={height/2} fill="currentColor"/>}</g>)}{type === 'combo' && <path d="m12 24 17 5 17-14 17 6 17-14" strokeWidth="2"/>}</> :
    type === 'radar' ? <><path d="m50 3 25 17-9 27H34L25 20Z" opacity=".25"/><path d="m50 12 19 12-9 16-21-4-7-15Z" fill="currentColor" fillOpacity=".2"/><path d="m50 18 12 5-3 21-18-6-13-18Z" opacity=".5"/></> :
    type === 'scatter' ? <>{[[19,31,3],[31,24,4],[46,32,3],[59,14,6],[72,23,4],[82,9,3]].map(([x,y,r],i) => <circle key={i} cx={x} cy={y} r={r} fill="currentColor" opacity={.3+i*.1}/>)}</> :
    type === 'heatmap' ? <>{Array.from({length:18},(_,i) => <rect key={i} x={9+i%6*14} y={6+Math.floor(i/6)*13} width="12" height="11" rx="1" fill="currentColor" opacity={.18+(i*7%11)*.075}/>)}</> :
    type === 'funnel' ? <>{[0,1,2].map(i => <path key={i} d={`M${12+i*11} ${5+i*14}h${76-i*22}l-9 11H${21+i*11}Z`} fill="currentColor" opacity={1-i*.25}/>)}</> :
    type === 'treemap' ? <><rect x="8" y="5" width="47" height="38" fill="currentColor" opacity=".6"/><rect x="58" y="5" width="33" height="21" fill="currentColor" opacity=".35"/><rect x="58" y="29" width="17" height="14" fill="currentColor" opacity=".8"/><rect x="78" y="29" width="13" height="14" fill="currentColor" opacity=".45"/></> :
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
  const [query, setQuery] = useState('');
  const label = type => type === 'map' ? '三维地图' : MODULE_TYPES.find(item => item.id === type)?.label ?? type;
  const groups = groupTypes.map(group => ({ ...group, types: group.types.filter(type => `${label(type)} ${type}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter(group => group.types.length);
  return <section className="ep-library" aria-label="组件库">
    <div className="ep-panel-heading"><h2>组件库</h2><span>{MODULE_TYPES.length + 1} 种组件</span></div>
    <input className="ep-search" type="search" aria-label="搜索组件" placeholder="搜索图表或组件" value={query} onChange={event => setQuery(event.target.value)}/>
    {groups.map(group => <section className="ep-library-group" key={group.title}><h3>{group.title}</h3><div className="ep-library-grid">{group.types.map(type => <button type="button" className="ep-component-card" key={type} onClick={() => onAdd(type)} aria-label={`添加${label(type)}`}><MiniChart type={type}/><span>{label(type)}<Plus size={12}/></span></button>)}</div></section>)}
    {!groups.length && <p className="ep-muted">没有匹配的组件</p>}
  </section>;
}

function Field({ label, value, onChange, maxLength = 40, placeholder = '', list }) {
  return <label className="ep-field"><span>{label}</span><input value={value ?? ''} onChange={event => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} list={list}/></label>;
}

function NumberField({ label, value, onChange, min = 0, max = 100, step = .1 }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const number = Number(text);
    if (!text.trim() || !Number.isFinite(number)) { setText(String(value)); return; }
    if (number === value && number >= min && number <= max) { setText(String(value)); return; }
    const decimals = String(step).split('.')[1]?.length ?? 0;
    const factor = 10 ** decimals;
    const next = Math.min(max, Math.max(min, Math.round(number * factor) / factor));
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

function AlignmentControls({ count, onAlign, canvas, onCanvasChange }) {
  const [reference, setReference] = useState('selection');
  return <section className="ep-property-section"><h3>对齐与排列</h3>{count > 1 && <Select label="对齐参照" value={reference} onChange={setReference}><option value="selection">所选组件边界</option><option value="canvas">整个画布</option></Select>}<div className="ep-align-grid">{[['left','左对齐'],['center-x','水平居中'],['right','右对齐'],['top','顶对齐'],['center-y','垂直居中'],['bottom','底对齐'],['distribute-x','水平等距'],['distribute-y','垂直等距'],['same-width','同宽'],['same-height','同高']].map(([operation,label],i) => <button type="button" key={operation} disabled={i >= 6 && count < (i < 8 ? 3 : 2)} onClick={() => onAlign(operation, count > 1 ? reference : 'canvas')}>{label}</button>)}</div>{count > 1 && <p className="ep-muted">锁定组件保持原位；同宽、同高采用最先选中的组件尺寸。</p>}{canvas && <div className="ep-field-grid"><NumberField label="网格步长 %" value={canvas.grid} min={.5} max={5} step={.5} onChange={grid => onCanvasChange({ ...canvas, grid })}/><NumberField label="磁吸距离 px" value={canvas.threshold} min={2} max={16} step={1} onChange={threshold => onCanvasChange({ ...canvas, threshold })}/></div>}<p className="ep-muted">Shift / ⌘ / Ctrl 多选 · Alt 临时关闭吸附</p></section>;
}

function DataMapping({ item, result, onChange }) {
  const listId = useId(), fields = useMemo(() => profileDataFields(result?.rows ?? []), [result?.rows]);
  const suggestion = useMemo(() => suggestDataFields(fields), [fields]);
  const binding = item.binding;
  const { mapped, error } = useMemo(() => {
    try {
      const mapped = getMappedData({ rows: result?.rows }, binding, item);
      if (professionalTypes.includes(item.type)) buildProfessionalChart(item, mapped);
      return { mapped };
    } catch (issue) { return { error: issue.message }; }
  }, [result?.rows, binding, item.type, item.aggregate, item.unit, item.columns, item.rowCount, item.target]);
  const preview = mapped?.rows?.slice(0, 3) ?? [];
  const relevant = item.type === 'histogram' ? ['value'] : item.type === 'boxplot' ? ['name', 'value'] : item.type === 'waterfall' ? ['name', 'time', 'value', 'code'] : ['pie', 'rose'].includes(item.type) ? ['name', 'value', 'code'] : item.type === 'scatter' ? ['x', 'y', 'name', 'series', 'value'] : item.type === 'heatmap' ? ['x', 'y', 'value'] : item.type === 'combo' ? ['name', 'time', 'value', 'value2'] : item.type === 'radar' ? ['name', 'value', 'series', 'target'] : SERIES_TYPES.includes(item.type) ? ['name', 'time', 'value', 'series'] : Object.keys(fieldNames).filter(key => !['x','y','value2'].includes(key) || item.type === 'table');
  return <details className="ep-mapping" open><summary>字段映射</summary><div className="ep-mapping-tools"><span>{fields.length ? `识别到 ${fields.length} 个字段` : '读取数据后可选择字段'}</span><button type="button" disabled={!fields.length} onClick={() => onChange({ binding: { ...binding, fields: { ...binding.fields, ...suggestion.fields } } })}>自动匹配</button></div><datalist id={listId}>{fields.filter(field => field.selectable).map(field => <option key={field.path} value={field.path}>{field.type}</option>)}</datalist><div className="ep-field-grid">{relevant.map(key => <Field key={key} label={fieldNames[key]} value={binding.fields[key]} maxLength={160} placeholder={key} list={listId} onChange={value => onChange({ binding: { ...binding, fields: { ...binding.fields, [key]: value } } })}/>)}</div>{error ? <p className="ep-error" role="alert">{error}</p> : preview.length ? <div className="ep-data-preview"><strong>映射结果 · 前 {preview.length} 行</strong><table><thead><tr>{relevant.filter(key => binding.fields[key]).map(key => <th key={key}>{fieldNames[key]}</th>)}</tr></thead><tbody>{preview.map((row,i) => <tr key={i}>{relevant.filter(key => binding.fields[key]).map(key => <td key={key}>{row[key] == null || row[key] === '' ? '—' : String(row[key])}</td>)}</tr>)}</tbody></table></div> : <p className="ep-muted">{result?.status === 'loading' ? '正在读取数据…' : result?.error || '暂无记录'}</p>}</details>;
}

function ChartControls({ item, onChange }) {
  const value = item.chartOptions, change = patch => onChange({ chartOptions: { ...value, ...patch } });
  const cartesian = ZOOM_TYPES.includes(item.type);
  return <section className="ep-property-section"><h3>图表设置</h3>
    <Select label="配色" value={value.palette} onChange={palette => change({ palette })}><option value="champagne">跟随大屏配色</option><option value="ocean">固定 · 海洋蓝绿</option><option value="forest">固定 · 森林青金</option></Select>
    <div className="ep-field-grid">
      {!['treemap', 'histogram', 'waterfall'].includes(item.type) && <Toggle label={item.type === 'heatmap' ? '显示色标' : '显示图例'} value={value.legend} onChange={legend => change({ legend })}/>}
      <Toggle label="数值标签" value={value.labels} onChange={labels => change({ labels })}/>
      {['multiLine', 'stackedArea', 'combo'].includes(item.type) && <Toggle label="平滑曲线" value={value.smooth} onChange={smooth => change({ smooth })}/>}
      {cartesian && <Toggle label="区间缩放" value={value.zoom} onChange={zoom => change({ zoom })}/>}
    </div>
    {item.type === 'combo' && <><div className="ep-field-grid"><Field label="主系列名称" value={value.primaryName} maxLength={20} onChange={primaryName => change({ primaryName })}/><Field label="副系列名称" value={value.secondaryName} maxLength={20} onChange={secondaryName => change({ secondaryName })}/></div><Field label="副轴单位" value={value.secondaryUnit} maxLength={8} onChange={secondaryUnit => change({ secondaryUnit })}/></>}
    {['histogram', 'boxplot', 'waterfall', 'percentStacked'].includes(item.type) && <p className="ep-muted">{{ histogram: '读取全部样本等宽分箱，纵轴为频数；前闭后开，最后一箱包含最大值。', boxplot: '按名称分组原始样本，自动计算四分位数、1.5 倍四分位距须线及离群值。', waterfall: '每行数值表示增减量，按输入顺序累计，末尾自动添加累计柱。', percentStacked: '使用非负原始数值，按每个类别的总量计算占比；提示保留原值。' }[item.type]}</p>}
    {cartesian && <div className="ep-field-grid"><Field label="X 轴名称" value={value.xName} maxLength={20} onChange={xName => change({ xName })}/>{['scatter', 'heatmap'].includes(item.type) && <Field label="Y 轴名称" value={value.yName} maxLength={20} onChange={yName => change({ yName })}/>}</div>}
  </section>;
}

export function ComponentInspector({ item, isMap = false, vehicleEnabled = false, dataSources = [], sourceResult, selectedCount = 1, onAlign, canvas, onCanvasChange, onChange, onDuplicate, onDelete, onArrange }) {
  if (!item) return <section className="ep-inspector ep-empty"><div className="ep-empty-shape" aria-hidden="true"/><h2>选择画布组件</h2><p>点击组件后，可编辑内容、位置与数据绑定。</p></section>;
  const alignment = <AlignmentControls count={selectedCount} onAlign={onAlign} canvas={canvas} onCanvasChange={onCanvasChange}/>;
  if (selectedCount > 1) return <section className="ep-inspector" aria-label="多选组件属性"><div className="ep-panel-heading"><h2>已选 {selectedCount} 个组件</h2></div>{alignment}<div className="ep-inspector-actions"><button onClick={onDuplicate}><Copy size={14}/>批量复制</button><button className="ep-delete" onClick={onDelete}><Trash size={14}/>删除未锁定组件</button></div></section>;
  const layout = item.layout;
  const binding = item.binding ?? { sourceId: 'demo', fields: {} };
  const custom = binding.sourceId !== 'demo';
  const rowCountLabel = { multiLine: '显示横轴点数', stacked: '显示类别数', combo: '显示类别数', radar: '显示指标数', scatter: '显示点数', heatmap: '每轴显示类别数', groupedColumn: '显示类别数', stackedArea: '显示横轴点数', percentStacked: '显示类别数', histogram: '分箱数量', boxplot: '显示分组数', waterfall: '显示变动项数' }[item.type] || '显示条数';
  const boundSource = dataSources.find(entry => entry.id === binding.sourceId);
  const source = SOURCES[item.source];
  const availableColumns = custom ? Object.entries(fieldNames).map(([key, label]) => ({ key, label })) : source?.columns ?? [];
  const changeSource = (id, type = item.type) => onChange({ type, source: id, unit: SOURCES[id].unit, columns: structuredClone(SOURCES[id].columns) });
  const changeType = type => {
    const { groupBy, ...ungrouped } = binding;
    const nextBinding = groupBy && !NAME_GROUP_TYPES.includes(type) ? { binding: ungrouped } : {};
    if (['text', 'clock'].includes(type)) { onChange({ type, source: 'devices', columns: structuredClone(SOURCES.devices.columns), binding: { ...ungrouped, sourceId: 'demo' } }); return; }
    const sources = MODULE_TYPES.find(entry => entry.id === type)?.sources ?? [];
    const nextSource = sources.includes(item.source) ? item.source : sources[0] ?? item.source;
    if (custom) onChange({ type, source: nextSource, ...nextBinding });
    else if (SOURCES[nextSource]) changeSource(nextSource, type);
    else onChange({ type });
  };
  const changeBinding = sourceId => onChange({ binding: { ...(sourceId === 'demo' ? { fields: binding.fields } : binding), sourceId }, ...(sourceId === 'demo' ? { columns: structuredClone(source.columns), unit: source.unit } : !custom ? { unit: '', chartOptions: { ...DEFAULT_CHART_OPTIONS } } : {}) });
  return <section className="ep-inspector" aria-label="组件属性">
    <div className="ep-panel-heading"><h2>{isMap ? '三维地图' : '组件属性'}</h2><span>{isMap ? 'MAP' : MODULE_TYPES.find(type => type.id === item.type)?.label}</span></div>
    <div className="ep-state-controls"><Toggle label="显示" value={item.visible} onChange={visible => onChange({ visible })}/><Toggle label="锁定" value={item.locked} onChange={locked => onChange({ locked })}/></div>
    <section className="ep-property-section"><h3>位置与大小 <span>%</span></h3><div className="ep-field-grid"><NumberField label="X 位置" value={layout.x} max={100 - layout.w} onChange={x => onChange({ layout: { ...layout, x } })}/><NumberField label="Y 位置" value={layout.y} max={100 - layout.h} onChange={y => onChange({ layout: { ...layout, y } })}/><NumberField label="宽度" value={layout.w} min={10} max={100 - layout.x} onChange={w => onChange({ layout: { ...layout, w } })}/><NumberField label="高度" value={layout.h} min={10} max={100 - layout.y} onChange={h => onChange({ layout: { ...layout, h } })}/></div>{item.locked && <p className="ep-muted"><LockKey size={12}/> 画布拖动已锁定，仍可输入精确尺寸。</p>}{!isMap && <div className="ep-layer-actions"><button type="button" onClick={() => onArrange('front')}><ArrowUp size={13}/>置于顶层</button><button type="button" onClick={() => onArrange('back')}><ArrowDown size={13}/>置于底层</button></div>}</section>
    {alignment}
    {isMap && vehicleEnabled && <section className="ep-property-section"><h3>车辆地图数据</h3><Select label="车辆数据源" value={item.vehicleSourceId || ''} onChange={vehicleSourceId => onChange({ vehicleSourceId })}><option value="">不接入车辆</option>{dataSources.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</Select><p className="ep-muted">地图与绑定该数据源的图表共享车辆记录。字段使用 VEHICLENO、GEO_LON、GEO_LAT、GPS_SPEED。</p></section>}
    {!isMap && <>
      <section className="ep-property-section"><h3>内容与样式</h3><Field label="标题" value={item.title} maxLength={20} onChange={title => onChange({ title })}/><Field label="副标题" value={item.subtitle} onChange={subtitle => onChange({ subtitle })}/><div className="ep-field-grid"><Select label="组件类型" value={item.type} onChange={changeType}>{MODULE_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</Select><Select label="面板材质" value={item.surface} onChange={surface => onChange({ surface })}><option value="glass">烟灰玻璃</option><option value="soft">轻透玻璃</option><option value="solid">深色面板</option></Select></div>{item.type === 'text' ? <label className="ep-field"><span>文本内容</span><textarea value={item.text} maxLength={1000} rows={5} onChange={event => onChange({ text: event.target.value })}/></label> : item.type !== 'clock' && <div className="ep-field-grid"><Field label="数值单位" value={item.unit} maxLength={8} onChange={unit => onChange({ unit })}/>{!professionalTypes.includes(item.type) && <Select label="最多小数位" value={item.precision ?? 1} onChange={value => onChange({ precision: Number(value) })}>{[0, 1, 2, 3].map(value => <option value={value} key={value}>{value} 位</option>)}</Select>}{!['metric', 'gauge'].includes(item.type) && <NumberField label={rowCountLabel} value={item.rowCount} min={item.type === 'radar' ? 3 : 1} max={100} step={1} onChange={rowCount => onChange({ rowCount: Math.round(rowCount) })}/>}</div>}{['gauge', 'progress', 'radar'].includes(item.type) && <NumberField label="目标值" value={item.target} min={.1} max={1e12} step={.001} onChange={target => onChange({ target })}/>}</section>
      {professionalTypes.includes(item.type) && <ChartControls item={item} onChange={onChange}/>}
      {!['text', 'clock'].includes(item.type) && <section className="ep-property-section"><h3>数据绑定</h3><Select label="接入数据源" value={binding.sourceId} onChange={changeBinding}><option value="demo">内置示例数据</option>{custom && !boundSource && <option value={binding.sourceId}>数据源已移除</option>}{dataSources.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</Select>{custom ? <>{!boundSource && <p className="ep-error">请选择可用数据源，恢复此组件的数据连接。</p>}<div className="ep-field-grid">{['metric', 'gauge'].includes(item.type) && <Select label="数值汇总" value={item.aggregate} onChange={aggregate => onChange({ aggregate })}><option value="sum">求和</option><option value="average">平均值</option><option value="first">第一条</option></Select>}<div className="ep-bound-source"><span>来源</span><strong>{{ http: 'HTTP 接口', json: '静态 JSON', csv: 'CSV 表格' }[boundSource?.type] ?? '未连接'}</strong></div></div>{NAME_GROUP_TYPES.includes(item.type) && <Toggle label="按名称合并并求和" value={binding.groupBy === 'name'} onChange={enabled => { const { groupBy, ...rest } = binding; onChange({ binding: enabled ? { ...rest, groupBy: 'name' } : rest }); }}/>}<DataMapping item={item} result={sourceResult} onChange={onChange}/></> : <Select label="示例内容" value={item.source} onChange={id => changeSource(id)}>{(MODULE_TYPES.find(type => type.id === item.type)?.sources ?? []).map(id => <option key={id} value={id}>{SOURCES[id].label}</option>)}</Select>}</section>}
      {item.type === 'table' && <section className="ep-property-section"><h3>表格列</h3><div className="ep-columns">{availableColumns.map(column => {
        const current = item.columns.find(entry => entry.key === column.key);
        return <div className="ep-column" key={column.key}><label><input type="checkbox" checked={Boolean(current)} disabled={Boolean(current) && item.columns.length === 1} onChange={event => onChange({ columns: event.target.checked ? [...item.columns, { ...column }] : item.columns.filter(entry => entry.key !== column.key) })}/><span>{column.label}</span></label><input aria-label={`${column.label}列标题`} maxLength={12} value={current?.label ?? column.label} disabled={!current} onChange={event => onChange({ columns: item.columns.map(entry => entry.key === column.key ? { ...entry, label: event.target.value } : entry) })}/></div>;
      })}</div></section>}
    </>}
    <div className="ep-inspector-actions">{!isMap && <button type="button" onClick={onDuplicate}><Copy size={14}/>复制组件</button>}<button type="button" className="ep-delete" disabled={item.locked} onClick={onDelete}><Trash size={14}/>{isMap ? '隐藏地图' : '删除组件'}</button></div>
  </section>;
}

function TemplateThumbnail({ config }) {
  return <div className="ep-template-thumbnail" aria-hidden="true">{config.map.visible && <div className="ep-template-map" style={{ left: `${config.map.layout.x}%`, top: `${config.map.layout.y}%`, width: `${config.map.layout.w}%`, height: `${config.map.layout.h}%` }}><MiniChart type="map"/></div>}{config.modules.filter(item => item.visible).map(item => <div key={item.id} className={`ep-template-module ep-template-module-${item.surface}`} style={{ left: `${item.layout.x}%`, top: `${item.layout.y}%`, width: `${item.layout.w}%`, height: `${item.layout.h}%` }}><MiniChart type={item.type}/></div>)}</div>;
}

export function TemplatePanel({ project = { id: 'base', name: '基线版', showBrand: true, vehicles: false }, config, onLoad, onClose }) {
  const [templates, setTemplates] = useState([]), [name, setName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const dialog = useRef(null), fileInput = useRef(null), opener = useRef(document.activeElement), importVersion = useRef(0);
  const [builtins] = useState(() => getBuiltinTemplates(project));
  const [legacyCanvas, setLegacyCanvas] = useState(null), [legacyTemplates, setLegacyTemplates] = useState([]);
  useEffect(() => {
    const element = dialog.current, previous = opener.current;
    if (!element.open) element.showModal();
    try { setTemplates(readTemplates(undefined, project));
      const old = readLegacyConfig();
      if (old && (!legacyProject(old) || legacyProject(old) === project.id)) setLegacyCanvas(old);
      setLegacyTemplates(readLegacyTemplates().filter(item => !legacyProject(item.config))); } catch (issue) { setError(issue.message); }
    return () => { importVersion.current++; element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const run = action => { setError(''); setNotice(''); try { action(); } catch (issue) { setError(issue.message); } };
  const load = next => { importVersion.current++; run(() => { if (onLoad(configForProject(next, project)) === false) throw new Error('模板未载入，请检查画布配置'); onClose(); }); };
  const save = event => { event.preventDefault(); run(() => { setTemplates(saveTemplate(name, config, undefined, project)); setName(''); setNotice('当前画布已存为模板'); }); };
  const download = () => run(() => {
    const content = serializeTemplate(config, project);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `manes-${project.id}-template.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('已导出当前画布配置');
  });
  const importFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const version = ++importVersion.current;
    setError(''); setNotice('');
    try {
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 JSON 配置文件');
      if (file.size > CONFIG_FILE_LIMIT) throw new Error(`配置文件不能超过 ${Math.round(CONFIG_FILE_LIMIT / 1024)} KB`);
      const content = await file.text();
      if (dialog.current?.open && importVersion.current === version) load(parseTemplateFile(content, project));
    } catch (issue) { if (dialog.current?.open && importVersion.current === version) setError(issue.message); }
  };
  return <dialog ref={dialog} className="ep-template-dialog" aria-labelledby="ep-template-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="ep-template-heading"><div><span className="ep-kicker">TEMPLATE LIBRARY</span><h2 id="ep-template-title">{project.name} · 模板库</h2></div><button type="button" className="ep-icon-button" aria-label="关闭模板库" onClick={onClose}><X size={20}/></button></header>
    <div className="ep-template-body"><div className="ep-template-section-heading"><h3>项目预设</h3><button type="button" onClick={() => load(defaultConfigForProject(project))}>恢复项目默认画布</button></div>{(legacyCanvas || legacyTemplates.length > 0) && <section className="ep-template-section-heading"><div><h3>旧版配置恢复</h3><p>载入当前项目后，保存才写入新的独立存储；旧记录继续保留。</p>{legacyCanvas && <button type="button" onClick={() => load(legacyCanvas)}>载入旧版画布到{project.name}</button>}{legacyTemplates.map((item, i) => <button key={i} type="button" onClick={() => load(item.config)}>载入旧模板：{item.name}</button>)}</div></section>}<div className="ep-template-section-heading"><h3>内置布局</h3><span>载入后可继续编辑与撤销</span></div><div className="ep-template-grid">{builtins.map(template => <button type="button" className="ep-template-card" key={template.id} onClick={() => load(template.config)}><TemplateThumbnail config={template.config}/><strong>{template.name}</strong><span>{template.description}</span></button>)}</div>
      <div className="ep-template-section-heading"><h3>我的模板 <span>{templates.length} / {TEMPLATE_LIMIT}</span></h3></div><form className="ep-template-save" onSubmit={save}><label className="ep-sr-only" htmlFor="ep-template-name">模板名称</label><input id="ep-template-name" placeholder="为当前画布命名" value={name} maxLength={40} required onChange={event => setName(event.target.value)}/><button type="submit" className="ep-primary" disabled={templates.length >= TEMPLATE_LIMIT}><Plus size={15}/>保存为模板</button></form>
      {templates.length ? <div className="ep-template-grid ep-user-templates">{templates.map(template => <article className="ep-user-template" key={template.id}><button type="button" className="ep-template-card" onClick={() => load(template.config)}><TemplateThumbnail config={template.config}/><strong>{template.name}</strong><span>{new Date(template.createdAt).toLocaleDateString('zh-CN')} · {template.config.modules.length} 个组件</span></button><button type="button" className="ep-template-remove" aria-label={`删除模板 ${template.name}`} onClick={() => run(() => { setTemplates(deleteTemplate(template.id, undefined, project)); setNotice('模板已删除，当前画布保持不变'); })}><Trash size={14}/></button></article>)}</div> : <p className="ep-template-empty">保存常用布局，下次直接接入新数据。</p>}
    </div><footer className="ep-template-footer"><p>模板包含已配置的静态数据与接口地址，请勿放入密钥。</p><div className="ep-template-file-actions"><button type="button" onClick={() => fileInput.current.click()}><UploadSimple size={15}/>导入 JSON</button><button type="button" onClick={download}><DownloadSimple size={15}/>导出当前画布</button></div><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importFile}/>{error && <p className="ep-error" role="alert">{error}</p>}{notice && <p className="ep-notice" role="status">{notice}</p>}</footer>
  </dialog>;
}
