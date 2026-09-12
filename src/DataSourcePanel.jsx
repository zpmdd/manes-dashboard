import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, Check, Database, Plus, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { DATA_SIZE_LIMIT, DATA_SOURCE_LIMIT, getMappedData, normalizeDataSource, parseSourceContent, readDataPath } from './dataSources.js';
import { analyzeDataContent, inspectDataSource, suggestDataFields, suggestDataWidgets } from './dataInference.js';
import { MODULE_TYPES } from './dashboardConfig.js';
import './data-sources.css';

const EXAMPLE = '[\n  { "name": "华东中心", "value": 862, "target": 1000, "status": "在线", "time": "09:00", "code": "310000" },\n  { "name": "华北中心", "value": 715, "target": 1000, "status": "在线", "time": "10:00", "code": "110000" }\n]';
const TYPES = { json: 'JSON 数据', csv: 'CSV 表格', http: 'HTTP 接口' };
const FIELD_TYPES = { number: '数值', 'numeric-string': '数值文字', time: '时间', string: '文字', boolean: '布尔', mixed: '混合', empty: '空值', unsupported: '需调整名称' };
const FIELD_LABELS = { name: '名称 / 分类', value: '主数值', value2: '第二数值', time: '时间', series: '系列', x: 'X 坐标 / 类别', y: 'Y 坐标 / 类别', status: '状态', target: '目标值', code: '区域编码' };
const FIELD_PAGE_SIZE = 100;

export function DataSourcePanel({ sources = [], onChange, onClose, code = '100000', onCreateComponent }) {
  const [draft, setDraft] = useState(() => structuredClone(sources));
  const [selected, setSelected] = useState(sources[0]?.id || '');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null), [testing, setTesting] = useState(false), [saving, setSaving] = useState(false);
  const [widgetType, setWidgetType] = useState('table');
  const [fieldOverrides, setFieldOverrides] = useState({});
  const [fieldQuery, setFieldQuery] = useState(''), [fieldPage, setFieldPage] = useState(0);
  const dialog = useRef(), upload = useRef(), request = useRef(), opener = useRef(document.activeElement);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const source = draft.find(item => item.id === selected);
  const sourceRegion = source?.type === 'http' && source.url.includes('{adcode}') ? code : null;
  const fieldsByPath = useMemo(() => new Map((preview?.fields || []).map(field => [field.path, field])), [preview?.fields]);
  const filteredFields = useMemo(() => {
    const fields = preview?.fields || [], query = fields.length > FIELD_PAGE_SIZE ? fieldQuery.trim().toLowerCase() : '';
    return query ? fields.filter(field => field.path.toLowerCase().includes(query)) : fields;
  }, [preview?.fields, fieldQuery]);
  const fieldPageCount = Math.max(1, Math.ceil(filteredFields.length / FIELD_PAGE_SIZE));
  const currentFieldPage = Math.min(fieldPage, fieldPageCount - 1);
  const pageFields = useMemo(() => filteredFields.slice(currentFieldPage * FIELD_PAGE_SIZE, (currentFieldPage + 1) * FIELD_PAGE_SIZE), [filteredFields, currentFieldPage]);
  const selectablePageFields = useMemo(() => pageFields.filter(field => field.selectable), [pageFields]);
  const selectedFields = useMemo(() => preview ? suggestDataFields(preview.fields, fieldOverrides).fields : {}, [preview, fieldOverrides]);
  const recommendations = useMemo(() => preview ? suggestDataWidgets(preview, fieldOverrides) : [], [preview, fieldOverrides]);
  const recommendation = recommendations.find(item => item.type === widgetType) || recommendations[0];
  const mappedPreview = useMemo(() => {
    if (!recommendation) return null;
    try { return getMappedData(preview, { fields: recommendation.fields }, recommendation); }
    catch (issue) { return { error: issue.message || '字段映射无法读取，请重新识别数据' }; }
  }, [preview, recommendation]);
  useEffect(() => {
    const element = dialog.current, previous = opener.current;
    element.showModal();
    return () => { request.current?.abort(); element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const resetFields = () => { setFieldOverrides({}); setFieldQuery(''); setFieldPage(0); };
  const resetFeedback = (clearFields = true) => { request.current?.abort(); request.current = null; setTesting(false); setPreview(null); if (clearFields) resetFields(); setError(''); setNotice(''); };
  useEffect(() => { resetFeedback(false); }, [sourceRegion]);
  const update = patch => { resetFeedback(['content', 'url', 'type', 'rowsPath'].some(key => Object.hasOwn(patch, key))); setDraft(current => current.map(item => item.id === selected ? { ...item, ...patch } : item)); };
  const choose = id => { if (id === selected) return; resetFeedback(); setSelected(id); };
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
  const changeType = type => update({ type, content: type === 'csv' ? 'name,value,target,status,time,code\n华东中心,862,1000,在线,09:00,310000\n华北中心,715,1000,在线,10:00,110000' : type === 'json' ? EXAMPLE : '', url: type === 'http' ? '/data/examples/monitoring.json?adcode={adcode}' : '', rowsPath: '', refreshSeconds: 0 });
  const importData = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const target = selected;
    try {
      const type = file.name.toLowerCase().endsWith('.csv') ? 'csv' : file.name.toLowerCase().endsWith('.json') ? 'json' : null;
      if (!type) throw new Error('请选择 .json 或 .csv 数据文件');
      if (file.size > DATA_SIZE_LIMIT) throw new Error('数据文件不能超过 1 MB');
      const content = await file.text();
      if (!dialog.current?.open || selectedRef.current !== target) return;
      const analysis = analyzeDataContent(content, type);
      resetFeedback();
      setDraft(current => current.map(item => item.id === target ? { ...item, type, content, url: '', rowsPath: analysis.rowsPath || '', refreshSeconds: 0 } : item));
      setPreview({ ...analysis, content, contentType: type });
      setNotice(analysis.rows ? `已载入 ${file.name}，识别 ${analysis.rows.length} 行、${analysis.fields.length} 个字段。` : '发现多组数据，请选择要使用的数据列表。');
    } catch (issue) { setError(issue.message); }
  };
  const testSource = async (auto = false) => {
    resetFeedback(false);
    const controller = new AbortController(); request.current = controller; setTesting(true);
    try {
      const inferPath = auto || (source.rowsPath === '' && !sources.some(item => item.id === source.id));
      const analysis = await inspectDataSource(normalizeDataSource(source), code, { signal: controller.signal, ...(inferPath ? { preferredPath: undefined } : {}) });
      if (request.current !== controller || controller.signal.aborted) return;
      setPreview(analysis);
      if (analysis.rowsPath !== source.rowsPath) resetFields();
      if (analysis.rowsPath !== null) setDraft(current => current.map(item => item.id === selected ? { ...item, rowsPath: analysis.rowsPath } : item));
      setNotice(analysis.rows ? `读取成功，共 ${analysis.rows.length} 行 · ${analysis.fields.length} 个字段 · ${analysis.elapsedMs} ms。` : '发现多组数据，请选择要使用的数据列表。');
    } catch (issue) { if (request.current === controller && !controller.signal.aborted) setError(issue.message); }
    finally { if (request.current === controller) { request.current = null; setTesting(false); } }
  };
  const selectRows = path => {
    try {
      const analysis = analyzeDataContent(preview.content, preview.contentType, path);
      setPreview({ ...preview, ...analysis });
      if (path !== preview.rowsPath) resetFields();
      setDraft(current => current.map(item => item.id === selected ? { ...item, rowsPath: path } : item));
      setError(''); setNotice(`已选择 ${path || '根数组'}，共 ${analysis.rows.length} 行。`);
    } catch (issue) { setError(issue.message); }
  };
  const normalizedDraft = () => {
    if (preview?.rows === null) throw new Error('请先选择要使用的数据列表');
    return draft.map(item => {
      const normalized = normalizeDataSource(item);
      if (normalized.type !== 'http') parseSourceContent(normalized.content, normalized.type, normalized.rowsPath);
      return normalized;
    });
  };
  const save = async event => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const next = normalizedDraft();
      const result = await onChange(next);
      if (result !== false) onClose();
      else setError('数据源未保存，请检查后重试');
    } catch (issue) { setError(issue.message || '数据源未保存'); }
    finally { setSaving(false); }
  };
  const createComponent = async () => {
    if (!recommendation || !onCreateComponent || mappedPreview?.error) return;
    setSaving(true); setError('');
    try {
      const result = await onCreateComponent({ sources: normalizedDraft(), sourceId: selected, ...recommendation });
      if (result !== false) onClose(); else setError('组件未添加，请检查后重试');
    } catch (issue) { setError(issue.message || '组件未添加'); }
    finally { setSaving(false); }
  };
  const previewKeys = preview?.fields.filter(field => field.selectable).slice(0, 6).map(field => field.path) || [];
  const cellText = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const fieldSelector = key => {
    const selectedPath = selectedFields[key] || '', selectedField = fieldsByPath.get(selectedPath);
    return <label className="ds-field" key={key}><span>{FIELD_LABELS[key]}</span><select aria-label={FIELD_LABELS[key]} value={selectedPath} onChange={event => setFieldOverrides(current => ({ ...current, [key]: event.target.value }))}><option value="">不使用</option>{selectedPath && !selectablePageFields.some(field => field.path === selectedPath) && <option value={selectedPath}>{selectedPath}{selectedField ? selectedField.selectable ? ` · ${FIELD_TYPES[selectedField.type]}（已选）` : '（当前字段不可选）' : '（当前数据不存在）'}</option>}{selectablePageFields.map(field => <option key={field.path} value={field.path}>{field.path} · {FIELD_TYPES[field.type]}</option>)}</select></label>;
  };

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
              <p className="ds-help">每个源最多 1 MB、5,000 行、40 个顶层字段（CSV 为列）。数值字段需为有效数字；空值不会当作 0。</p>
            </>}
            <div className="ds-test-row"><button type="button" className="ds-test" onClick={() => testSource()} disabled={testing}><ArrowsClockwise size={15} className={testing ? 'ds-spinning' : ''}/>{testing ? '正在读取…' : source.type === 'http' ? '测试并识别字段' : '识别数据'}</button>{source.type !== 'csv' && <button type="button" className="ds-infer-again" onClick={() => testSource(true)} disabled={testing}>重新识别路径</button>}<a href="/data/examples/monitoring.json" download="monitoring.json">下载监测示例</a><a href="/data/examples/professional.json" download="professional.json">下载专业图表示例</a></div>
            {preview !== null && <>
              {preview.candidates.length > 1 && <label className="ds-field ds-wide"><span>选择数据列表</span><select value={preview.rowsPath ?? '__unselected__'} onChange={event => selectRows(event.target.value)}><option value="__unselected__" disabled>发现多组数据，请选择</option>{preview.candidates.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.path || '根数组'} · {candidate.rowCount} 行</option>)}</select></label>}
              {preview.rows && <><div className="ds-preview"><div className="ds-preview-title">数据预览 <span>共 {preview.rows.length} 行 · 预览 {Math.min(5, preview.rows.length)} 行 / {previewKeys.length} 列</span></div>{preview.rows.length ? <div className="ds-table-scroll"><table><thead><tr>{previewKeys.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 5).map((row, i) => <tr key={i}>{previewKeys.map(key => <td key={key} title={cellText(readDataPath(row, key))}>{cellText(readDataPath(row, key))}</td>)}</tr>)}</tbody></table></div> : <p>数据源返回空列表。</p>}</div>
                {preview.fields.length > FIELD_PAGE_SIZE && <div className="ds-field-browser"><label className="ds-field"><span>搜索字段</span><input type="search" aria-label="搜索字段" value={fieldQuery} maxLength={160} placeholder="输入字段路径" onChange={event => { setFieldQuery(event.target.value); setFieldPage(0); }}/></label><div className="ds-field-pagination"><span aria-live="polite">匹配 {filteredFields.length} / 共 {preview.fields.length} 个字段 · 第 {currentFieldPage + 1} / {fieldPageCount} 页</span><button type="button" aria-label="上一页字段" disabled={currentFieldPage === 0} onClick={() => setFieldPage(currentFieldPage - 1)}>上一页</button><button type="button" aria-label="下一页字段" disabled={currentFieldPage + 1 >= fieldPageCount} onClick={() => setFieldPage(currentFieldPage + 1)}>下一页</button></div><small>每页 {FIELD_PAGE_SIZE} 个候选字段，已选字段始终保留。</small></div>}
                <div className="ds-field-profiles" aria-label="识别到的数据字段">{pageFields.map(field => <div key={field.path}><strong title={field.path}>{field.path}</strong><span>{FIELD_TYPES[field.type]}</span><small title={field.examples.join(' / ')}>{field.sample || '—'}</small>{field.missingCount > 0 && <em>{field.missingCount} 个空值</em>}</div>)}</div>
                {preview.fields.length > FIELD_PAGE_SIZE && filteredFields.length === 0 && <p className="ds-help">没有匹配字段；清除搜索可查看全部字段。</p>}
                {onCreateComponent && preview.rows.length > 0 && <section className="ds-field-selection" aria-label="图表字段选择"><h3>图表字段</h3><div className="ds-grid">{['name', 'value', 'value2'].map(fieldSelector)}</div><details><summary>更多字段</summary><div className="ds-grid">{['time', 'series', 'x', 'y', 'status', 'target', 'code'].map(fieldSelector)}</div></details><p className="ds-help">选择“不使用”后，该字段将保持为空。</p></section>}
                {onCreateComponent && recommendations.length > 0 && <section className="ds-create-widget"><h3>从这些数据创建组件</h3><div className="ds-widget-choices">{recommendations.map(item => <button type="button" key={item.type} aria-pressed={recommendation?.type === item.type} onClick={() => setWidgetType(item.type)}><strong>{MODULE_TYPES.find(type => type.id === item.type)?.label || item.type}</strong><small>{item.reason}</small></button>)}</div>{recommendation && <><p className="ds-help">建议映射：{Object.entries(recommendation.fields).filter(([, path]) => path).map(([key, path]) => `${key} ← ${path}`).join('；')}。添加后可在组件属性调整。</p>{mappedPreview.error ? <p role="alert">{mappedPreview.error}</p> : <><div className="ds-mapped-summary">映射结果：{mappedPreview.rows.length} 行{mappedPreview.value !== null && ` · 汇总 ${mappedPreview.value.toLocaleString('zh-CN')}`}</div><details className="ds-preview ds-mapped-preview"><summary>查看适配后数据</summary><div className="ds-table-scroll"><table><thead><tr>{recommendation.columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{mappedPreview.rows.slice(0, 5).map((row, i) => <tr key={i}>{recommendation.columns.map(column => <td key={column.key}>{cellText(row[column.key])}</td>)}</tr>)}</tbody></table></div></details></>}<button type="button" className="ds-test" disabled={saving || Boolean(mappedPreview.error)} onClick={createComponent}><Plus size={15}/>添加{MODULE_TYPES.find(type => type.id === recommendation.type)?.label || recommendation.type}</button></>}</section>}
                {onCreateComponent && preview.rows.length > 0 && !recommendations.length && <p className="ds-help">当前字段暂无适配组件，请调整字段或检查数据。</p>}
              </>}
            </>}
          </> : <div className="ds-empty"><Database size={34} weight="light"/><h3>连接你的业务数据</h3><p>同一个数据源可复用于指标、图表和表格。</p><button type="button" className="ds-test" onClick={add}><Plus size={15}/>添加数据源</button></div>}
        </section>
      </div>
      <div className="ds-feedback" aria-live="polite">{error ? <p role="alert">{error}</p> : notice ? <p>{notice}</p> : <p className="ds-muted">修改应用到编辑草稿，保存画布后在大屏生效。</p>}</div>
      <footer className="ds-footer"><span>{draft.length}/{DATA_SOURCE_LIMIT} 个数据源</span><div><button type="button" onClick={onClose} disabled={saving}>取消</button><button className="ds-save" type="submit" disabled={saving}><Check size={15}/>{saving ? '正在保存' : '保存数据源'}</button></div></footer>
    </form>
  </dialog>;
}
