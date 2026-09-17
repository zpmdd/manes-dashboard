import { Component, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, ArrowLeft, ArrowRight, ArrowUpRight, ArrowsOut, CaretDown, CaretRight, CircleNotch, Compass, Info, Lightning, MapTrifold, Minus, Plus, Stack, WifiHigh } from '@phosphor-icons/react';
import '@fontsource/michroma/latin-400.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import { Dialog, IconButton, LayerPanel, RegionPicker, VehiclePanel } from './MapPanels';
import { VEHICLES } from './vehicles';
import { DashboardWidget } from './DashboardWidget';
import { createModule, DEFAULT_CHART_OPTIONS, normalizeConfig } from './dashboardConfig';
import { CanvasItem, EditorToolbar, useDashboardEditor } from './DashboardEditor';
import { useDataSources } from './useDataSources';
import { getMappedData } from './dataSources';
import { lineage, NATIONAL, polygons, shortName } from './geo';

const loadMapScene = () => import('./MapScene').then(module => ({ default: module.MapScene }));
const MapScene = lazy(loadMapScene);

const ComponentLibrary = lazy(() => import('./EditorPanels').then(module => ({ default: module.ComponentLibrary })));
const ComponentInspector = lazy(() => import('./EditorPanels').then(module => ({ default: module.ComponentInspector })));
const TemplatePanel = lazy(() => import('./EditorPanels').then(module => ({ default: module.TemplatePanel })));
const DataSourcePanel = lazy(() => import('./DataSourcePanel').then(module => ({ default: module.DataSourcePanel })));
const ConfigPanel = lazy(() => import('./ConfigPanel').then(module => ({ default: module.ConfigPanel })));

const DEFAULT_LAYERS = { vehicles: true, roadmap: false, roads: true, beacons: false, arcs: false, heat: false, labels: true, highway: true, nationalRoad: true };
const fetchJson = async (path, signal) => {
  const response = await fetch(path, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`本地地图文件读取失败（${response.status}）`);
  const data = await response.json();
  if (path.includes('/regions/') && (data.type !== 'FeatureCollection' || !data.features?.length)) throw new Error('地图文件没有可用的区域');
  return data;
};

function SouthSea({ data }) {
  const paths = useMemo(() => data.features.flatMap(f => polygons(f.geometry)).filter(poly => poly[0].every(p => p[0] > 105 && p[0] < 124 && p[1] < 24)).map(poly => poly.map(ring => ring.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - 105) * 4},${(24 - p[1]) * 4}`).join('') + 'Z').join('')), [data]);
  return <div className="south-sea"><svg viewBox="0 0 76 90" aria-label="南海诸岛附图">{paths.map((d, i) => <path key={i} d={d} fill="rgba(234,228,207,.32)" stroke="rgba(244,238,217,.7)" strokeWidth=".55" fillRule="evenodd"/>)}</svg><span>南海诸岛</span></div>;
}

function DashboardClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(new Date()); };
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return <time className="dashboard-clock" dateTime={now.toISOString()}><strong>{now.toLocaleTimeString('zh-CN', { hour12: false })}</strong><span>{now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span></time>;
}

class MapErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="map-error" role="alert"><strong>三维地图暂时无法显示</strong><p>请检查网络连接及浏览器硬件加速，或重新加载页面。</p><button onClick={() => location.reload()}>重新加载</button><small>{this.state.error.message}</small></div>;
    return this.props.children;
  }
}

class PanelErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (!this.state.error) return this.props.children;
    const content = <div className="editor-layer-list" role="alert"><h3>{this.props.title}暂时无法显示</h3><p>你可以先保存画布，再检查网络连接并重新加载页面。</p><button onClick={() => location.reload()}>重新加载页面</button></div>;
    return this.props.onClose ? <Dialog title={this.props.title} onClose={this.props.onClose}>{content}</Dialog> : content;
  }
}

const BoundWidget = memo(function BoundWidget({ item, result, refresh, code, index, onNavigate }) {
  const external = item.binding.sourceId !== 'demo' && !['text', 'clock'].includes(item.type);
  const mapped = useMemo(() => {
    if (!external) return null;
    try { return { data: getMappedData({ rows: result?.rows }, item.binding, item) }; }
    catch (error) { return { data: { rows: [] }, error: error.message }; }
  }, [external, result?.rows, item.binding, item.aggregate, item.type, item.unit, item.columns]);
  const state = mapped?.error ? { status: 'error', error: mapped.error } : result || { status: 'loading' };
  const reload = useCallback(() => refresh(item.binding.sourceId), [refresh, item.binding.sourceId]);
  return <DashboardWidget config={item} code={code} index={index} onNavigate={onNavigate} data={mapped?.data} dataState={external ? state : undefined} onRefresh={external ? reload : undefined}/>;
});

export function App() {
  const [toast, setToast] = useState('');
  const editor = useDashboardEditor(setToast), config = editor.config;
  const editing = editor.editing && !editor.preview;
  const [sidePanel, setSidePanel] = useState('library');
  const [viewport, setViewport] = useState(null);
  const [sceneSize, setSceneSize] = useState(null);
  const [index, setIndex] = useState(null);
  const [code, setCode] = useState(/^#\d{6}$/.test(location.hash) ? location.hash.slice(1) : NATIONAL);
  const [loaded, setLoaded] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const activeCode = config.map.visible && loaded ? loaded.code : index?.[code] ? code : NATIONAL;
  const [dialog, setDialog] = useState(null), [layers, setLayers] = useState(DEFAULT_LAYERS), [quality, setQuality] = useState('high'), [mode, setMode] = useState('overview');
  const [hover, setHover] = useState(''), [command, setCommand] = useState({ type: 'reset', sequence: 0 }), [telemetry, setTelemetry] = useState({});
  const [vehicle, setVehicle] = useState(VEHICLES[0]);
  const main = useRef(), stage = useRef(), mapLabels = useRef(), measureRef = useRef(null), telemetryRef = useRef({});
  const previewMapLayout = useCallback(() => measureRef.current?.(), []);
  const usedSources = useMemo(() => config.dataSources.filter(source => config.modules.some(item => (item.visible || editing) && !['text', 'clock'].includes(item.type) && item.binding.sourceId === source.id)), [config.dataSources, config.modules, editing]);
  const { results, refresh } = useDataSources(usedSources, activeCode);
  const selection = editor.selected === 'map' ? config.map : config.modules.find(item => item.id === editor.selected);
  const customCount = config.modules.filter(item => item.visible && !['text', 'clock'].includes(item.type) && item.binding.sourceId !== 'demo').length;
  const demoCount = config.modules.filter(item => item.visible && !['text', 'clock'].includes(item.type) && item.binding.sourceId === 'demo').length;
  const dataLabel = customCount ? demoCount ? '混合数据 · 含示例' : '自定义数据' : 'DEMO · 演示数据';
  useLayoutEffect(() => {
    const node = main.current;
    const measure = () => {
      const bounds = node.getBoundingClientRect(), scene = node.querySelector('.world-backdrop').getBoundingClientRect(), map = node.querySelector('[data-canvas-id=map]')?.getBoundingClientRect();
      setSceneSize(previous => previous?.width === scene.width && previous?.height === scene.height ? previous : { width: scene.width, height: scene.height });
      node.style.setProperty('--u', `${Math.max(.45, Math.min(bounds.width / 1120, bounds.height / 718))}px`);
      if (map && scene.width && scene.height) { const next = { x: (map.x - scene.x) / scene.width, y: (map.y - scene.y) / scene.height, width: map.width / scene.width, height: map.height / scene.height }; setViewport(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); }
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure); observer.observe(node); if (stage.current) observer.observe(stage.current); measure();
    return () => { observer.disconnect(); if (measureRef.current === measure) measureRef.current = null; };
  }, [config.map.layout, config.map.visible, editing]);
  const captureTelemetry = useCallback(sample => {
    telemetryRef.current = sample;
    if (sample.error) setTelemetry(sample);
  }, []);
  const showInfo = () => { setTelemetry(telemetryRef.current); setDialog('info'); };
  const scope = index?.[activeCode], path = index ? lineage(activeCode, index) : [];
  const sendCommand = useCallback((type, vehicle) => setCommand(s => ({ type, vehicle, sequence: s.sequence + 1 })), []);
  const pickVehicle = useCallback(item => { setVehicle(item); setDialog('vehicle'); }, []);
  const focusVehicles = item => { setLayers(s => ({ ...s, vehicles: true })); setDialog(null); sendCommand('vehicles', item); };
  useEffect(() => { if (config.map.visible) void loadMapScene().catch(() => {}); }, [config.map.visible]);
  useEffect(() => {
    const abort = new AbortController();
    fetchJson('/data/index.json', abort.signal).then(setIndex).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    if (!config.map.visible) { setLoaded(null); setLoading(false); setError(''); setHover(''); return; }
    if (!index) return;
    const abort = new AbortController(), entry = index[code];
    setLoading(true); setError('');
    if (!entry) { setError('没有找到这个区域，请返回全国概览。'); setLoading(false); return; }
    const regionFile = entry.hasChildren || code === NATIONAL ? code : entry.parent;
    const contextFiles = lineage(regionFile, index).map(region => region.code).filter(id => id !== regionFile);
    const roadFile = code === NATIONAL ? '/data/roads-overview.json' : code === '420381' ? '/data/roads-420381.json' : `/data/roads/${code}.json`;
    Promise.all([fetchJson(`/data/regions/${regionFile}.json`, abort.signal), fetchJson(roadFile, abort.signal), ...contextFiles.map(id => fetchJson(`/data/regions/${id}.json`, abort.signal))]).then(([data, roads, ...context]) => {
      if (abort.signal.aborted) return;
      const collections = [...context.map((data, i) => ({ code: contextFiles[i], data })), { code: regionFile, data }];
      if (!entry.hasChildren && code !== NATIONAL) data = { ...data, features: data.features.filter(f => String(f.properties.adcode) === code) };
      if (!data.features.length) throw new Error('当前离线包缺少这个区域的边界');
      setLoaded({ code, data, roads, collections }); setLoading(false); setHover('');
    }).catch(e => { if (!abort.signal.aborted && e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => abort.abort();
  }, [index, code, retry, config.map.visible]);
  useEffect(() => { const change = () => setCode(/^#\d{6}$/.test(location.hash) ? location.hash.slice(1) : NATIONAL); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { document.title = `${config.brand} · ${config.title}`; }, [config.brand, config.title]);
  const applyConfig = patch => {
    try { editor.change(normalizeConfig({ ...config, ...patch })); return true; }
    catch (error) { setToast(error.message); return false; }
  };
  const applySources = sources => {
    const missing = config.modules.find(item => !['text', 'clock'].includes(item.type) && item.binding.sourceId !== 'demo' && !sources.some(source => source.id === item.binding.sourceId));
    if (missing) throw new Error(`数据源仍被“${missing.title}”使用，请先更改该组件的数据绑定`);
    editor.change(normalizeConfig({ ...config, dataSources: sources, modules: config.modules.map(item => ['text', 'clock'].includes(item.type) ? { ...item, binding: { ...item.binding, sourceId: 'demo' } } : item) }));
  };
  const createFromSource = ({ sources, sourceId, type, fields, columns, aggregate = 'sum', target }) => {
    const missing = config.modules.find(item => !['text', 'clock'].includes(item.type) && item.binding.sourceId !== 'demo' && !sources.some(source => source.id === item.binding.sourceId));
    if (missing) throw new Error(`数据源仍被“${missing.title}”使用，请先更改该组件的数据绑定`);
    const item = createModule(type, config.modules);
    Object.assign(item, { title: sources.find(source => source.id === sourceId)?.name.slice(0, 20) || item.title, unit: '', chartOptions: { ...DEFAULT_CHART_OPTIONS }, binding: { sourceId, fields }, aggregate, ...(columns?.length ? { columns } : {}), ...(target !== undefined ? { target } : {}) });
    const next = normalizeConfig({ ...config, dataSources: sources, modules: [...config.modules, item] });
    editor.change(next); editor.select(item.id); setSidePanel('inspector');
  };
  const navigate = useCallback(next => { setCode(String(next)); location.hash = String(next); setDialog(null); }, []);
  const navigateWidget = useCallback(next => { if (index?.[String(next)]) navigate(next); else setToast('数据中的区域编码不在当前地图范围内'); }, [index, navigate]);
  const pickFeature = useCallback(feature => { const next = String(feature.properties.adcode); if (next === code) setToast('已到当前数据的最细层级'); else if (index?.[next]) navigate(next); }, [navigate, code, index]);
  const setView = next => {
    setMode(next);
    if (next === 'overview') setLayers(DEFAULT_LAYERS);
    if (next === 'monitor') setLayers(s => ({ ...s, heat: true, beacons: false, arcs: false }));
    if (next === 'traffic') setLayers(s => ({ ...s, roads: true, heat: false, arcs: false, beacons: false }));
    if (next === 'regions') { setLayers(s => ({ ...s, heat: false, beacons: false, arcs: false })); setDialog('regions'); }
  };
  const fullScreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await main.current.requestFullscreen(); } catch { setToast('当前浏览器暂不支持页面全屏，可使用窗口全屏。'); } };

  return <div className={`editor-shell ${editing ? 'is-editing' : ''} ${editor.editing ? 'has-toolbar' : ''}`}>
    {editor.editing && <EditorToolbar editor={editor} onDialog={setDialog}/>}
    {editing && <div className="editor-mobile-tabs"><button onClick={() => setSidePanel('library')} aria-pressed={sidePanel === 'library'}>组件库</button><button onClick={() => setSidePanel('inspector')} aria-pressed={sidePanel === 'inspector'}>组件属性</button></div>}
    {editing && <aside className={`editor-library-pane ${sidePanel === 'library' ? 'is-open' : ''}`}><PanelErrorBoundary title="组件库"><Suspense fallback={<p role="status">正在加载组件库…</p>}><ComponentLibrary onAdd={type => { editor.add(type); setSidePanel('inspector'); }}/></Suspense></PanelErrorBoundary><section className="editor-layer-list" aria-label="图层列表"><h3>画布图层</h3>{[{ ...config.map, id: 'map', title: config.mapTitle }, ...config.modules].map(item => <button key={item.id} onClick={event => { editor.select(item.id, { toggle: event.shiftKey || event.metaKey || event.ctrlKey }); setSidePanel('inspector'); }} aria-pressed={editor.selectedIds.includes(item.id)}><span>{item.title || '未命名组件'}</span><small>{item.locked ? '锁定' : !item.visible ? '隐藏' : ''}</small></button>)}</section></aside>}
    <div className="dashboard-viewport"><main className="dashboard free-dashboard" ref={main}>
    <div className={`world-backdrop ${loading && !loaded ? 'is-loading' : ''}`} onContextMenu={e => e.preventDefault()}><div ref={mapLabels} className="map-labels" style={viewport ? { clipPath: `inset(${100 * (viewport.y + viewport.height * .12)}% ${100 * (1 - viewport.x - viewport.width * .98)}% ${100 * (1 - viewport.y - viewport.height * .98)}% ${100 * (viewport.x + viewport.width * .02)}%)` } : undefined}/>{loaded && config.map.visible && <MapErrorBoundary><Suspense fallback={<div className="map-error" role="status">正在加载三维地图…</div>}><MapScene data={loaded.data} collections={loaded.collections} roadData={loaded.roads} labelPortal={mapLabels} code={loaded.code} layers={layers} selected={null} onSelect={pickFeature} onHover={setHover} onVehicleSelect={pickVehicle} command={command} quality={quality} onTelemetry={captureTelemetry} viewport={viewport || undefined} sceneSize={sceneSize}/></Suspense></MapErrorBoundary>}</div>
    <div className="brand canvas-brand"><img src="/brand/manes-icon.svg" width="48" height="48" alt="" decoding="async"/><span>{config.brand}</span></div>
    <header className="topbar">
      <div className="screen-title"><h1 title={config.title}>{config.title}</h1><span>{dataLabel}</span></div>
      <div className="header-tools">{config.showClock && <DashboardClock/>}<IconButton label="全屏显示" onClick={fullScreen}><ArrowsOut/></IconButton><button className="configure-button" onClick={editor.start} disabled={editor.editing}><SlidersHorizontal/><span>编辑大屏</span></button></div>
      <nav aria-label="视图切换">{['overview', 'monitor', 'traffic', 'regions'].map((id, i) => <button key={id} className={mode === id ? 'selected' : ''} aria-pressed={mode === id} onClick={() => setView(id)}>{config.navLabels[i]}</button>)}</nav>
      <div className="top-actions"><IconButton label="地图图层" onClick={() => setDialog('layers')}><Stack/></IconButton><IconButton label="恢复默认视角" onClick={() => sendCommand('reset')}><Compass/></IconButton><IconButton label="数据与性能说明" onClick={showInfo}><Info/></IconButton></div>
    </header>
    <div ref={stage} className={`canvas-stage ${editing && config.canvas.snap ? 'show-grid' : ''}`} onPointerDown={editing ? () => editor.select(null) : undefined}>
    {(config.map.visible || editing) && <CanvasItem id="map" title={config.mapTitle} item={config.map} editor={editor} isMap onLayoutPreview={previewMapLayout}><section className="map-panel" aria-label="交互式三维行政区地图" aria-busy={loading}>
      <div className="map-heading"><div className="atlas-wordmark">CN<span>ATLAS</span></div><div className="map-section-title">{config.mapTitle}</div><div className="location-strip"><div className="breadcrumb">{path.map((p, i) => <span key={p.code}>{i > 0 && <CaretRight size={11}/>}<button onClick={() => navigate(p.code)}>{shortName(p.name)}</button></span>)}</div><button className="scope-select" onClick={() => setDialog('regions')}>{scope?.name === '中国' ? '全国运行总览' : scope?.name || '全国运行总览'}<CaretDown size={13}/></button></div></div>

      <div className="vehicle-toolbar"><button onClick={() => focusVehicles()} disabled={!loaded || loading}>定位车辆 · {VEHICLES.length}</button><button onClick={() => pickVehicle(vehicle)}>车辆详情</button><span>GPS · 2026/9/13 00:00</span></div>

      <div className="map-side-controls"><IconButton label="切换监测光柱" title={`监测光柱：已${layers.beacons ? '开启' : '关闭'}（演示）`} active={layers.beacons} onClick={() => setLayers(s => ({ ...s, beacons: !s.beacons }))}><Lightning weight={layers.beacons ? 'fill' : 'regular'}/></IconButton><IconButton label="切换区域连线" active={layers.arcs} onClick={() => setLayers(s => ({ ...s, arcs: !s.arcs }))}><WifiHigh weight="bold"/></IconButton></div>
      <div className="map-interaction"><IconButton label="放大地图" onClick={() => sendCommand('zoomIn')}><Plus/></IconButton><IconButton label="缩小地图" onClick={() => sendCommand('zoomOut')}><Minus/></IconButton><span/><IconButton label="旋转地图十五度" onClick={() => sendCommand('rotate')}><Compass/></IconButton><IconButton label="俯视地图" onClick={() => sendCommand('top')}><MapTrifold/></IconButton></div>
      {loaded?.code === NATIONAL && <SouthSea data={loaded.data}/>}
      {path.length > 1 && <button className="back-region" onClick={() => navigate(path[path.length - 2].code)}><ArrowLeft/>返回{shortName(path[path.length - 2].name)}</button>}
      {hover && <div className="hover-caption" role="status">{hover}<span>点击查看区域</span><ArrowUpRight/></div>}
      {loading && <div className={`loading-state${loaded ? ' is-focusing' : ''}`} role="status"><CircleNotch className="spinner" size={24}/><span>正在展开地图</span></div>}
      {error && <div className="load-error" role="alert"><strong>{error}</strong><div><button onClick={() => setRetry(n => n + 1)}>重试</button><button onClick={() => navigate(NATIONAL)}>返回全国</button></div></div>}
      <div className="map-bottom"><div className="map-legend">{layers.roadmap && <span>离线道路底图</span>}{layers.roads && <span><i className="legend-line"/>道路网络</span>}{layers.beacons && <span><i className="legend-dot"/>监测节点</span>}{layers.heat && <span>态势热力</span>}</div><button onClick={showInfo}>{layers.roadmap ? '本地道路瓦片 · 1–10 级' : loaded?.code === '420381' ? '© OpenStreetMap contributors' : 'DataV.GeoAtlas · Natural Earth'}<Info size={11}/></button></div>
    </section></CanvasItem>}
    {config.modules.map(item => <CanvasItem key={item.id} id={item.id} title={item.title || '未命名组件'} item={item} editor={editor} onLayoutPreview={previewMapLayout}><BoundWidget item={editing && !item.visible ? { ...item, visible: true } : item} result={results[item.binding.sourceId]} refresh={refresh} code={activeCode} index={index} onNavigate={navigateWidget}/></CanvasItem>)}
    {editing && <div className="canvas-guides" aria-hidden="true">{editor.guides.map(guide => <i key={guide.axis} className={`canvas-guide guide-${guide.axis}`} style={guide.axis === 'x' ? { left: `${guide.position}%`, top: `${guide.from}%`, height: `${guide.to - guide.from}%` } : { top: `${guide.position}%`, left: `${guide.from}%`, width: `${guide.to - guide.from}%` }}/>)}</div>}
    </div>
    {dialog === 'regions' && index && <RegionPicker index={index} code={activeCode} onNavigate={navigate} onClose={() => setDialog(null)}/>}
    {dialog === 'layers' && <LayerPanel layers={layers} setLayers={setLayers} quality={quality} setQuality={setQuality} detail={loaded?.code === '420381'} onClose={() => setDialog(null)}/>}
    {dialog === 'vehicle' && <VehiclePanel vehicle={vehicle} onSelect={setVehicle} onFocus={focusVehicles} onClose={() => setDialog(null)}/>}
    {dialog === 'templates' && <PanelErrorBoundary title="模板库" onClose={() => setDialog(null)}><Suspense fallback={<div className="toast" role="status">正在加载模板库…</div>}><TemplatePanel config={config} onLoad={next => editor.change(next)} onClose={() => setDialog(null)}/></Suspense></PanelErrorBoundary>}
    {dialog === 'sources' && <PanelErrorBoundary title="数据源管理" onClose={() => setDialog(null)}><Suspense fallback={<div className="toast" role="status">正在加载数据源管理…</div>}><DataSourcePanel sources={config.dataSources} code={activeCode} onChange={applySources} onCreateComponent={createFromSource} onClose={() => setDialog(null)}/></Suspense></PanelErrorBoundary>}
    {dialog === 'config' && <PanelErrorBoundary title="全局设置" onClose={() => setDialog(null)}><Suspense fallback={<div className="toast" role="status">正在加载全局设置…</div>}><ConfigPanel config={config} onApply={applyConfig} onClose={() => setDialog(null)}/></Suspense></PanelErrorBoundary>}
    {dialog === 'info' && <Dialog title="数据与性能" subtitle="DATA & RENDERING" onClose={() => setDialog(null)} wide><div className="info-columns"><section><h3>数据来源</h3><p>行政区边界复用 Daoyan 本地 GeoJSON，原始来源为 DataV.GeoAtlas。全国省界来自同源公开数据。</p><p>离线道路底图来自本地离线地图包，共 13,822 张图片，最高 10 级；包含道路与地名，放大到更细区域时沿用现有图片。</p><p>全国道路为 Natural Earth 1:10m 概化干线，不能据此判断完整高速、国道覆盖。丹江口样区使用已有 OSM 道路数据，保留 G70、G59、G209 等编号。</p><p>业务组件按配置使用示例、静态 JSON/CSV 或 HTTP 接口数据；自定义数据失败时显示错误或延迟状态。地图光柱、连线和热力仍为演示内容。边界源未声明坐标系，尚未完成与 WGS84 道路的精确坐标验收。</p><div className="source-links"><a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noreferrer">DataV.GeoAtlas<ArrowUpRight/></a><a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/" target="_blank" rel="noreferrer">Natural Earth<ArrowUpRight/></a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL<ArrowUpRight/></a></div></section><section><h3>渲染状态</h3><dl className="render-stats"><div><dt>渲染方式</dt><dd>按需绘制</dd></div><div><dt>当前质量</dt><dd>{quality === 'high' ? '质感优先' : '流畅优先'}</dd></div><div><dt>像素比</dt><dd>{telemetry.dpr || '—'}</dd></div><div><dt>每帧绘制调用</dt><dd>{telemetry.calls ?? '—'}</dd></div><div><dt>每帧提交三角面</dt><dd>{telemetry.triangles?.toLocaleString() ?? '—'}</dd></div><div><dt>已分配几何体</dt><dd>{telemetry.geometries ?? '—'}</dd></div><div><dt>绘制帧计数</dt><dd data-testid="render-frame">{telemetry.frames ?? '—'}</dd></div><div><dt>相机 / 缩放</dt><dd data-testid="camera-state">{telemetry.camera || '—'} / {telemetry.zoom || '—'}</dd></div></dl><p className="fineprint">读数为打开面板或刷新时的快照，包含反射等渲染通道；帧计数不变表示地图停止绘制。此处不代替目标设备帧率验收。</p><button className="text-button" onClick={() => setTelemetry(telemetryRef.current)}>刷新渲染读数<ArrowRight/></button><button className="text-button" onClick={() => setDialog('layers')}>调整渲染质量<ArrowRight/></button></section></div></Dialog>}
    {(toast || telemetry.error) && <div className="toast" role="status">{toast || telemetry.error}</div>}
  </main></div>
    {editing && <aside className={`editor-inspector-pane ${sidePanel === 'inspector' ? 'is-open' : ''}`}><PanelErrorBoundary title="组件属性"><Suspense fallback={<p role="status">正在加载组件属性…</p>}><ComponentInspector item={selection} isMap={editor.selected === 'map'} dataSources={config.dataSources} sourceResult={results[selection?.binding?.sourceId]} selectedCount={editor.selectedIds.length} onAlign={editor.align} canvas={config.canvas} onCanvasChange={canvas => editor.change({ ...config, canvas })} onChange={values => editor.patch(editor.selected, values)} onDuplicate={editor.duplicate} onDelete={editor.remove} onArrange={editor.arrange}/></Suspense></PanelErrorBoundary></aside>}
  </div>;
}
