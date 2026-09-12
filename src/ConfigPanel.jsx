import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, Check, DownloadSimple, SlidersHorizontal, UploadSimple, X } from '@phosphor-icons/react';
import { CONFIG_FILE_LIMIT, DEFAULT_CONFIG, MODULE_TYPES, SOURCES, normalizeConfig } from './dashboardConfig';
import './config.css';

function TextField({ label, value, onChange, maxLength, optional = false, readOnly = false }) {
  return <label className="config-field"><span>{label}</span><input value={value} maxLength={maxLength} required={!optional} readOnly={readOnly} onChange={event => onChange(event.target.value)}/></label>;
}

function Switch({ label, checked, onChange }) {
  return <label className="config-switch"><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/><i aria-hidden="true"/></label>;
}

export function ConfigPanel({ config, onApply, onClose }) {
  const [draft, setDraft] = useState(() => normalizeConfig(config));
  const [selected, setSelected] = useState('global');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false);
  const dialog = useRef(), fileInput = useRef(), opener = useRef(document.activeElement);
  const module = draft.modules.find(item => item.id === selected);

  useEffect(() => {
    const element = dialog.current, previous = opener.current;
    if (!element.open) element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);

  const update = patch => { setDraft(current => ({ ...current, ...patch })); setError(''); setNotice(''); };
  const updateModule = patch => { setDraft(current => ({ ...current, modules: current.modules.map(item => item.id === selected ? { ...item, ...patch } : item) })); setError(''); setNotice(''); };
  const changeSource = (source, type = module.type) => updateModule({ source, type, unit: SOURCES[source].unit, columns: SOURCES[source].columns.map(column => ({ ...column })) });
  const changeType = type => {
    const compatible = MODULE_TYPES.find(item => item.id === type).sources;
    if (!compatible.includes(module.source)) changeSource(compatible[0], type);
    else updateModule({ type, ...(type === 'gauge' ? { unit: '%' } : {}) });
  };
  const toggleColumn = (column, checked) => {
    if (!checked && module.columns.length === 1) { setError('表格至少保留一列'); return; }
    updateModule({ columns: checked ? [...module.columns, { ...column }] : module.columns.filter(item => item.key !== column.key) });
  };
  const restore = () => {
    setDraft(normalizeConfig(DEFAULT_CONFIG)); setError(''); setNotice('已恢复默认草稿，保存后生效');
  };
  const importFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 JSON 配置文件');
      if (file.size > CONFIG_FILE_LIMIT) throw new Error('配置文件不能超过 64 KB');
      const parsed = normalizeConfig(JSON.parse(await file.text()));
      setDraft(parsed); setError(''); setNotice('已导入配置草稿，保存后生效');
    } catch (issue) { setError(issue instanceof SyntaxError ? '文件不是有效的 JSON 配置' : issue.message); setNotice(''); }
  };
  const exportFile = () => {
    try {
      const next = normalizeConfig(draft);
      const url = URL.createObjectURL(new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'nexus-dashboard-config.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(''); setNotice('已导出当前草稿');
    } catch (issue) { setError(issue.message); }
  };
  const apply = async event => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const result = await onApply(normalizeConfig(draft));
      if (result !== false) onClose();
      else setError('配置未保存，请检查浏览器存储后重试');
    } catch (issue) { setError(issue.message || '配置未保存，请重试'); }
    finally { setSaving(false); }
  };

  return <dialog ref={dialog} className="config-dialog" aria-labelledby="config-title" aria-describedby="config-note" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={apply}>
      <header className="config-heading"><div><span className="config-kicker"><SlidersHorizontal size={14}/> DISPLAY SETTINGS</span><h2 id="config-title">大屏配置</h2><p id="config-note">保存到当前浏览器，下次打开自动应用。</p></div><button type="button" className="config-close" aria-label="关闭配置" onClick={onClose} disabled={saving}><X size={20}/></button></header>
      <div className="config-body">
        <nav className="config-nav" aria-label="配置范围"><button type="button" className={selected === 'global' ? 'selected' : ''} aria-current={selected === 'global' ? 'page' : undefined} onClick={() => setSelected('global')}><SlidersHorizontal size={16}/><span>全局设置<small>标题、导航与时钟</small></span></button>{draft.modules.map((item, index) => <button type="button" key={item.id} className={selected === item.id ? 'selected' : ''} aria-current={selected === item.id ? 'page' : undefined} onClick={() => setSelected(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span>{item.title || '未命名模块'}<small>{MODULE_TYPES.find(type => type.id === item.type).label} · {item.visible ? '显示中' : '已隐藏'}</small></span></button>)}</nav>
        <section className="config-editor" aria-label={module ? `${module.title}配置` : '全局设置'}>
          {module ? <>
            <div className="config-section-title"><h3>模块内容</h3><Switch label="显示模块" checked={module.visible} onChange={visible => updateModule({ visible })}/></div>
            <div className="config-grid"><TextField label="模块标题" value={module.title} maxLength={20} onChange={title => updateModule({ title })}/><TextField label="副标题（选填）" value={module.subtitle} maxLength={40} optional onChange={subtitle => updateModule({ subtitle })}/><label className="config-field"><span>展示类型</span><select value={module.type} onChange={event => changeType(event.target.value)}>{MODULE_TYPES.map(type => <option value={type.id} key={type.id}>{type.label}</option>)}</select></label><label className="config-field"><span>数据源</span><select value={module.source} onChange={event => changeSource(event.target.value)}>{MODULE_TYPES.find(type => type.id === module.type).sources.map(source => <option value={source} key={source}>{SOURCES[source].label}</option>)}</select></label><TextField label={module.type === 'gauge' ? '单位（百分比）' : '单位文字（选填）'} value={module.unit} maxLength={8} optional readOnly={module.type === 'gauge'} onChange={unit => updateModule({ unit })}/><label className="config-field"><span>显示条数</span><select value={module.rowCount} disabled={['metric', 'gauge'].includes(module.type)} onChange={event => updateModule({ rowCount: Number(event.target.value) })}>{[3, 4, 5, 6, 7, 8].map(count => <option value={count} key={count}>{count} 条</option>)}</select></label></div>
            {module.type === 'table' && <fieldset className="config-columns"><legend>表格列与名称</legend>{SOURCES[module.source].columns.map(column => {
              const current = module.columns.find(item => item.key === column.key);
              return <div className="config-column" key={column.key}><label><input type="checkbox" checked={Boolean(current)} onChange={event => toggleColumn(column, event.target.checked)}/><span>{column.label}</span></label><input aria-label={`${column.label}列名称`} value={current?.label ?? column.label} disabled={!current} required={Boolean(current)} maxLength={12} onChange={event => updateModule({ columns: module.columns.map(item => item.key === column.key ? { ...item, label: event.target.value } : item) })}/></div>;
            })}</fieldset>}
            <div className="config-preview"><span>配置概览</span><strong>{module.title || '未命名模块'}</strong>{module.subtitle && <p>{module.subtitle}</p>}<div>{MODULE_TYPES.find(type => type.id === module.type).label}<i/>{SOURCES[module.source].label}<i/>{module.visible ? '显示' : '隐藏'}{!['metric', 'gauge'].includes(module.type) && <><i/>{module.rowCount} 条</>}</div>{module.type === 'table' && <small>{module.columns.map(column => column.label).join('　 /　 ')}</small>}</div>
          </> : <>
            <div className="config-section-title"><h3>全局设置</h3></div><div className="config-grid"><TextField label="品牌名称" value={draft.brand} maxLength={16} onChange={brand => update({ brand })}/><TextField label="大屏标题" value={draft.title} maxLength={36} onChange={title => update({ title })}/><TextField label="地图标题" value={draft.mapTitle} maxLength={24} onChange={mapTitle => update({ mapTitle })}/><div className="config-clock-field"><Switch label="显示日期与时间" checked={draft.showClock} onChange={showClock => update({ showClock })}/></div></div><h3 className="config-subheading">导航名称</h3><div className="config-grid">{draft.navLabels.map((label, index) => <TextField key={index} label={`导航 ${index + 1}`} value={label} maxLength={8} onChange={value => update({ navLabels: draft.navLabels.map((current, i) => i === index ? value : current) })}/>)}</div><div className="config-preview"><span>配置概览</span><strong>{draft.title || '未命名大屏'}</strong><p>{draft.brand} · {draft.mapTitle}</p><div>{draft.modules.filter(item => item.visible).length} 个模块显示<i/>{draft.showClock ? '时钟已开启' : '时钟已关闭'}</div></div>
          </>}
        </section>
      </div>
      <div className="config-feedback" aria-live="polite">{error ? <p role="alert">{error}</p> : notice ? <p className="config-notice">{notice}</p> : <p className="config-note">修改保存后生效，取消将丢弃本次草稿。</p>}</div>
      <footer className="config-footer"><div className="config-file-actions"><button type="button" onClick={restore} disabled={saving}><ArrowCounterClockwise size={15}/>恢复默认</button><button type="button" onClick={() => fileInput.current.click()} disabled={saving}><UploadSimple size={15}/>导入</button><button type="button" onClick={exportFile} disabled={saving}><DownloadSimple size={15}/>导出</button><input ref={fileInput} className="config-file-input" type="file" accept=".json,application/json" aria-label="导入大屏配置文件" onChange={importFile} tabIndex={-1}/></div><div className="config-save-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="config-apply" disabled={saving}><Check size={16}/>{saving ? '正在保存' : '保存并应用'}</button></div></footer>
    </form>
  </dialog>;
}
