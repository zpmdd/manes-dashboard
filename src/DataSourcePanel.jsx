import { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Check, Database, Plus, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { DATA_SIZE_LIMIT, DATA_SOURCE_LIMIT, loadDataSource, normalizeDataSource, parseSourceContent } from './dataSources.js';
import './data-sources.css';

const EXAMPLE = '[\n  { "name": "华东中心", "value": 862, "target": 1000, "status": "在线", "time": "09:00", "code": "310000" },\n  { "name": "华北中心", "value": 715, "target": 1000, "status": "在线", "time": "10:00", "code": "110000" }\n]';
const TYPES = { json: 'JSON 数据', csv: 'CSV 表格', http: 'HTTP 接口' };

export function DataSourcePanel({ sources = [], onChange, onClose, code = '100000' }) {
  const [draft, setDraft] = useState(() => structuredClone(sources));
  const [selected, setSelected] = useState(sources[0]?.id || '');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null), [testing, setTesting] = useState(false), [saving, setSaving] = useState(false);
  const dialog = useRef(), upload = useRef(), request = useRef(), opener = useRef(document.activeElement);
  const source = draft.find(item => item.id === selected);
  useEffect(() => {
    const element = dialog.current, previous = opener.current;
    element.showModal();
    return () => { request.current?.abort(); element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const resetFeedback = () => { request.current?.abort(); request.current = null; setTesting(false); setPreview(null); setError(''); setNotice(''); };
  const update = patch => { resetFeedback(); setDraft(current => current.map(item => item.id === selected ? { ...item, ...patch } : item)); };
  const choose = id => { resetFeedback(); setSelected(id); };
  const add = () => {
    if (draft.length >= DATA_SOURCE_LIMIT) { setError(`最多添加 ${DATA_SOURCE_LIMIT} 个数据源`); return; }
    resetFeedback();
    const item = { id: `ds_${crypto.randomUUID()}`, name: `数据源 ${draft.length + 1}`, type: 'json', content: EXAMPLE, url: '', rowsPath: '', refreshSeconds: 0 };
    setDraft(current => [...current, item]); setSelected(item.id);
  };
  const remove = () => {
    const next = draft.filter(item => item.id !== selected);
    resetFeedback(); setDraft(next); setSelected(next[0]?.id || ''); setNotice('已从草稿移除；仍被组件使用的数据源无法保存删除。');
  };
  const changeType = type => update({ type, content: type === 'csv' ? 'name,value,target,status,time,code\n华东中心,862,1000,在线,09:00,310000\n华北中心,715,1000,在线,10:00,110000' : type === 'json' ? EXAMPLE : '', url: type === 'http' ? '/data/examples/monitoring.json?adcode={adcode}' : '', rowsPath: type === 'http' ? 'rows' : '', refreshSeconds: 0 });
  const importData = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const target = selected;
    try {
      const type = file.name.toLowerCase().endsWith('.csv') ? 'csv' : file.name.toLowerCase().endsWith('.json') ? 'json' : null;
      if (!type) throw new Error('请选择 .json 或 .csv 数据文件');
      if (file.size > DATA_SIZE_LIMIT) throw new Error('数据文件不能超过 1 MB');
      const content = await file.text();
      if (!dialog.current?.open) return;
      resetFeedback();
      setDraft(current => current.map(item => item.id === target ? { ...item, type, content, url: '', rowsPath: '', refreshSeconds: 0 } : item));
      setNotice(`已载入 ${file.name}；可设置列表路径并测试数据。`);
    } catch (issue) { setError(issue.message); }
  };
  const testSource = async () => {
    resetFeedback();
    const controller = new AbortController(); request.current = controller; setTesting(true);
    try {
      const rows = await loadDataSource(normalizeDataSource(source), code, { signal: controller.signal });
      if (request.current !== controller || controller.signal.aborted) return;
      setPreview(rows); setNotice(`读取成功，共 ${rows.length} 行。预览前 5 行。`);
    } catch (issue) { if (request.current === controller && !controller.signal.aborted) setError(issue.message); }
    finally { if (request.current === controller) { request.current = null; setTesting(false); } }
  };
  const save = async event => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const next = draft.map(item => {
        const normalized = normalizeDataSource(item);
        if (normalized.type !== 'http') parseSourceContent(normalized.content, normalized.type, normalized.rowsPath);
        return normalized;
      });
      const result = await onChange(next);
      if (result !== false) onClose();
      else setError('数据源未保存，请检查后重试');
    } catch (issue) { setError(issue.message || '数据源未保存'); }
    finally { setSaving(false); }
  };
  const previewKeys = preview?.length ? Object.keys(preview[0]).slice(0, 6) : [];
  const cellText = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

  return <dialog ref={dialog} className="ds-dialog" aria-labelledby="ds-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <header className="ds-heading"><div><span><Database size={14}/> DATA CONNECTIONS</span><h2 id="ds-title">数据源管理</h2><p>集中维护数据，由组件按字段绑定。</p></div><button type="button" className="ds-close" aria-label="关闭数据源管理" onClick={onClose} disabled={saving}><X size={20}/></button></header>
      <div className="ds-body">
        <nav className="ds-nav" aria-label="数据源列表"><div className="ds-nav-title"><span>数据源 · {draft.length}</span><button type="button" aria-label="添加数据源" onClick={add} disabled={draft.length >= DATA_SOURCE_LIMIT}><Plus size={17}/></button></div>{draft.map(item => <button key={item.id} type="button" className={item.id === selected ? 'selected' : ''} aria-current={item.id === selected ? 'page' : undefined} onClick={() => choose(item.id)}><Database size={16}/><span>{item.name || '未命名数据源'}<small>{TYPES[item.type]}</small></span></button>)}{draft.length === 0 && <p className="ds-nav-empty">添加 JSON、CSV 或接口数据源</p>}</nav>
        <section className="ds-editor" aria-label="数据源设置">
          {source ? <>
            <div className="ds-section-heading"><h3>连接设置</h3><button type="button" className="ds-remove" onClick={remove}><Trash size={14}/>移除</button></div>
            <div className="ds-grid"><label className="ds-field"><span>数据源名称</span><input value={source.name} maxLength={40} required onChange={event => update({ name: event.target.value })}/></label><label className="ds-field"><span>接入方式</span><select value={source.type} onChange={event => changeType(event.target.value)}>{Object.entries(TYPES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label></div>
            {source.type === 'http' ? <>
              <label className="ds-field ds-wide"><span>GET 接口地址</span><input value={source.url} maxLength={2048} required placeholder="/api/monitoring?adcode={adcode}" spellCheck={false} onChange={event => update({ url: event.target.value })}/><small>支持 {'{adcode}'} 区域参数，当前区域 {code}。返回 JSON 或 CSV。</small></label>
              <div className="ds-grid"><label className="ds-field"><span>JSON 数据列表路径</span><input value={source.rowsPath} maxLength={160} placeholder="例如 data.rows；根数组留空" spellCheck={false} onChange={event => update({ rowsPath: event.target.value })}/></label><label className="ds-field"><span>自动刷新间隔</span><select value={source.refreshSeconds} onChange={event => update({ refreshSeconds: Number(event.target.value) })}>{[...new Set([0, 15, 30, 60, 300, 900, source.refreshSeconds])].sort((a, b) => a - b).map(seconds => <option key={seconds} value={seconds}>{seconds === 0 ? '手动刷新' : `${seconds} 秒`}</option>)}</select></label></div>
              <p className="ds-help">受保护接口请使用同源服务端代理。模板只保存连接配置，不保存 Token、Cookie 或账号密码。跨域接口需允许当前站点访问。</p>
            </> : <>
              <div className="ds-content-heading"><label htmlFor="ds-content">{source.type === 'json' ? 'JSON 内容' : 'CSV 内容（首行为表头）'}</label><button type="button" onClick={() => upload.current.click()}><UploadSimple size={14}/>导入文件</button><input className="ds-file" ref={upload} type="file" accept=".json,.csv,application/json,text/csv" onChange={importData}/></div>
              <textarea id="ds-content" value={source.content} maxLength={DATA_SIZE_LIMIT} required spellCheck={false} onChange={event => update({ content: event.target.value })}/>
              {source.type === 'json' && <label className="ds-field ds-wide"><span>数据列表路径</span><input value={source.rowsPath} maxLength={160} placeholder="例如 data.rows；根数组留空" spellCheck={false} onChange={event => update({ rowsPath: event.target.value })}/></label>}
              <p className="ds-help">每个源最多 1 MB、5,000 行、40 列。数值字段需为有效数字；空值不会当作 0。</p>
            </>}
            <div className="ds-test-row"><button type="button" className="ds-test" onClick={testSource} disabled={testing}><ArrowsClockwise size={15} className={testing ? 'ds-spinning' : ''}/>{testing ? '正在读取…' : source.type === 'http' ? '测试连接' : '测试数据'}</button><a href="/data/examples/monitoring.json" download="monitoring.json">下载示例 JSON</a></div>
            {preview !== null && <div className="ds-preview"><div className="ds-preview-title">数据预览 <span>{preview.length} 行 · 最多展示 6 列</span></div>{preview.length ? <div className="ds-table-scroll"><table><thead><tr>{previewKeys.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{preview.slice(0, 5).map((row, i) => <tr key={i}>{previewKeys.map(key => <td key={key} title={cellText(row[key])}>{cellText(row[key])}</td>)}</tr>)}</tbody></table></div> : <p>数据源返回空列表。</p>}</div>}
          </> : <div className="ds-empty"><Database size={34} weight="light"/><h3>连接你的业务数据</h3><p>同一个数据源可复用于指标、图表和表格。</p><button type="button" className="ds-test" onClick={add}><Plus size={15}/>添加数据源</button></div>}
        </section>
      </div>
      <div className="ds-feedback" aria-live="polite">{error ? <p role="alert">{error}</p> : notice ? <p>{notice}</p> : <p className="ds-muted">修改应用到编辑草稿，保存画布后在大屏生效。</p>}</div>
      <footer className="ds-footer"><span>{draft.length}/{DATA_SOURCE_LIMIT} 个数据源</span><div><button type="button" onClick={onClose} disabled={saving}>取消</button><button className="ds-save" type="submit" disabled={saving}><Check size={15}/>{saving ? '正在保存' : '保存数据源'}</button></div></footer>
    </form>
  </dialog>;
}
