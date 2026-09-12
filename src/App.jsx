import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, ArrowLeft, ArrowRight, ArrowUpRight, ArrowsOut, Atom, CaretDown, CaretRight, CircleNotch, Compass, Info, Lightning, MapTrifold, Minus, Plus, Stack, WifiHigh } from '@phosphor-icons/react';
import '@fontsource/michroma/latin-400.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import { MapScene } from './MapScene';
import { Dialog, IconButton, LayerPanel, RegionPicker } from './MapPanels';
import { DashboardWidget } from './DashboardWidget';
import { ConfigPanel } from './ConfigPanel';
import { loadConfig, saveConfig } from './dashboardConfig';
import { lineage, NATIONAL, polygons, shortName } from './geo';

const DEFAULT_LAYERS = { roads: true, beacons: true, arcs: true, heat: false, labels: true, highway: true, nationalRoad: true };
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

export function App() {
  const [config, setConfig] = useState(loadConfig);
  const [index, setIndex] = useState(null);
  const [code, setCode] = useState(/^#\d{6}$/.test(location.hash) ? location.hash.slice(1) : NATIONAL);
  const [loaded, setLoaded] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [dialog, setDialog] = useState(null), [layers, setLayers] = useState(DEFAULT_LAYERS), [quality, setQuality] = useState('high'), [mode, setMode] = useState('overview');
  const [hover, setHover] = useState(''), [command, setCommand] = useState({ type: 'reset', sequence: 0 }), [telemetry, setTelemetry] = useState({}), [toast, setToast] = useState('');
  const main = useRef(), telemetryRef = useRef({});
  const captureTelemetry = useCallback(sample => {
    telemetryRef.current = sample;
    if (sample.error) setTelemetry(sample);
  }, []);
  const showInfo = () => { setTelemetry(telemetryRef.current); setDialog('info'); };
  const scope = index?.[loaded?.code || code], path = index ? lineage(loaded?.code || code, index) : [];
  const sendCommand = useCallback(type => setCommand(s => ({ type, sequence: s.sequence + 1 })), []);
  useEffect(() => {
    const abort = new AbortController();
    fetchJson('/data/index.json', abort.signal).then(setIndex).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    if (!index) return;
    const abort = new AbortController(), entry = index[code];
    setLoading(true); setError('');
    if (!entry) { setError('没有找到这个区域，请返回全国概览。'); setLoading(false); return; }
    const regionFile = entry.hasChildren || code === NATIONAL ? code : entry.parent;
    const roadFile = code === NATIONAL ? '/data/roads-overview.json' : code === '420381' ? '/data/roads-420381.json' : `/data/roads/${code}.json`;
    Promise.all([fetchJson(`/data/regions/${regionFile}.json`, abort.signal), fetchJson(roadFile, abort.signal)]).then(([data, roads]) => {
      if (!entry.hasChildren && code !== NATIONAL) data = { ...data, features: data.features.filter(f => String(f.properties.adcode) === code) };
      if (!data.features.length) throw new Error('当前离线包缺少这个区域的边界');
      setLoaded({ code, data, roads }); setLoading(false); setHover(''); sendCommand('reset');
    }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => abort.abort();
  }, [index, code, retry, sendCommand]);
  useEffect(() => { const change = () => setCode(/^#\d{6}$/.test(location.hash) ? location.hash.slice(1) : NATIONAL); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { document.title = `${config.brand} · ${config.title}`; }, [config.brand, config.title]);
  const applyConfig = next => {
    try { const saved = saveConfig(next); setConfig(saved); setToast('大屏配置已保存'); return true; }
    catch (e) { setToast(e.message || '配置保存失败，请检查浏览器存储权限'); return false; }
  };
  const navigate = useCallback(next => { setCode(String(next)); location.hash = String(next); setDialog(null); }, []);
  const pickFeature = useCallback(feature => { const next = String(feature.properties.adcode); if (next === code) setToast('已到当前数据的最细层级'); else if (index?.[next]) navigate(next); }, [navigate, code, index]);
  const setView = next => {
    setMode(next);
    if (next === 'overview') setLayers(DEFAULT_LAYERS);
    if (next === 'monitor') setLayers(s => ({ ...s, heat: true, beacons: true, arcs: false }));
    if (next === 'traffic') setLayers(s => ({ ...s, roads: true, heat: false, arcs: false, beacons: false }));
    if (next === 'regions') { setLayers(s => ({ ...s, heat: false, beacons: false, arcs: false })); setDialog('regions'); }
  };
  const fullScreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await main.current.requestFullscreen(); } catch { setToast('当前浏览器暂不支持页面全屏，可使用窗口全屏。'); } };

  return <main className="dashboard" ref={main}>
    <div className={`world-backdrop ${loading ? 'is-loading' : ''}`} onContextMenu={e => e.preventDefault()}>{loaded && <MapScene data={loaded.data} roadData={loaded.roads} code={loaded.code} layers={layers} selected={null} onSelect={pickFeature} onHover={setHover} command={command} quality={quality} onTelemetry={captureTelemetry}/>}</div>
    <aside className="sidebar" aria-label="运行概览">
      <div className="brand"><Atom weight="fill"/><span>{config.brand}</span><span className="brand-status">DEMO</span></div>
      <div className="sidebar-widgets">{config.modules.slice(0, 3).filter(item => item.visible).map(item => <DashboardWidget key={item.id} config={item} code={loaded?.code || NATIONAL} index={index} onNavigate={navigate}/>)}</div>
    </aside>
    <header className="topbar">
      <div className="screen-title"><h1 title={config.title}>{config.title}</h1><span>DEMO · 演示数据</span></div>
      <div className="header-tools">{config.showClock && <DashboardClock/>}<IconButton label="全屏显示" onClick={fullScreen}><ArrowsOut/></IconButton><button className="configure-button" onClick={() => setDialog('config')}><SlidersHorizontal/><span>大屏配置</span></button></div>
      <nav aria-label="视图切换">{['overview', 'monitor', 'traffic', 'regions'].map((id, i) => <button key={id} className={mode === id ? 'selected' : ''} aria-pressed={mode === id} onClick={() => setView(id)}>{config.navLabels[i]}</button>)}</nav>
      <div className="top-actions"><IconButton label="地图图层" onClick={() => setDialog('layers')}><Stack/></IconButton><IconButton label="恢复默认视角" onClick={() => sendCommand('reset')}><Compass/></IconButton><IconButton label="数据与性能说明" onClick={showInfo}><Info/></IconButton></div>
    </header>
    <section className="map-panel" aria-label="交互式三维行政区地图" aria-busy={loading}>
      <div className="map-heading"><div className="atlas-wordmark">CN<span>ATLAS</span></div><div className="map-section-title">{config.mapTitle}</div><div className="location-strip"><div className="breadcrumb">{path.map((p, i) => <span key={p.code}>{i > 0 && <CaretRight size={11}/>}<button onClick={() => navigate(p.code)}>{shortName(p.name)}</button></span>)}</div><button className="scope-select" onClick={() => setDialog('regions')}>{scope?.name === '中国' ? '全国运行总览' : scope?.name || '全国运行总览'}<CaretDown size={13}/></button></div></div>

      <div className="map-side-controls"><IconButton label="切换监测光柱" active={layers.beacons} onClick={() => setLayers(s => ({ ...s, beacons: !s.beacons }))}><Lightning weight="fill"/></IconButton><IconButton label="切换区域连线" active={layers.arcs} onClick={() => setLayers(s => ({ ...s, arcs: !s.arcs }))}><WifiHigh weight="bold"/></IconButton></div>
      <div className="map-interaction"><IconButton label="放大地图" onClick={() => sendCommand('zoomIn')}><Plus/></IconButton><IconButton label="缩小地图" onClick={() => sendCommand('zoomOut')}><Minus/></IconButton><span/><IconButton label="旋转地图十五度" onClick={() => sendCommand('rotate')}><Compass/></IconButton><IconButton label="俯视地图" onClick={() => sendCommand('top')}><MapTrifold/></IconButton></div>
      {loaded?.code === NATIONAL && <SouthSea data={loaded.data}/>}
      {path.length > 1 && <button className="back-region" onClick={() => navigate(path[path.length - 2].code)}><ArrowLeft/>返回{shortName(path[path.length - 2].name)}</button>}
      {hover && <div className="hover-caption" role="status">{hover}<span>点击查看区域</span><ArrowUpRight/></div>}
      {loading && <div className="loading-state" role="status"><CircleNotch className="spinner" size={24}/><span>正在展开地图</span></div>}
      {error && <div className="load-error" role="alert"><strong>{error}</strong><div><button onClick={() => setRetry(n => n + 1)}>重试</button><button onClick={() => navigate(NATIONAL)}>返回全国</button></div></div>}
      <div className="map-widgets">{config.modules.slice(3).filter(item => item.visible).map(item => <DashboardWidget key={item.id} config={item} code={loaded?.code || NATIONAL} index={index} onNavigate={navigate}/>)}</div>
      <div className="map-bottom"><div className="map-legend">{layers.roads && <span><i className="legend-line"/>道路网络</span>}{layers.beacons && <span><i className="legend-dot"/>监测节点</span>}{layers.heat && <span>态势热力</span>}</div><button onClick={showInfo}>{loaded?.code === '420381' ? '© OpenStreetMap contributors' : 'DataV.GeoAtlas · Natural Earth'}<Info size={11}/></button></div>
    </section>
    {dialog === 'regions' && index && <RegionPicker index={index} code={loaded?.code || NATIONAL} onNavigate={navigate} onClose={() => setDialog(null)}/>}
    {dialog === 'layers' && <LayerPanel layers={layers} setLayers={setLayers} quality={quality} setQuality={setQuality} detail={loaded?.code === '420381'} onClose={() => setDialog(null)}/>}
    {dialog === 'config' && <ConfigPanel config={config} onApply={applyConfig} onClose={() => setDialog(null)}/>}
    {dialog === 'info' && <Dialog title="数据与性能" subtitle="DATA & RENDERING" onClose={() => setDialog(null)} wide><div className="info-columns"><section><h3>数据来源</h3><p>行政区边界复用 Daoyan 本地 GeoJSON，原始来源为 DataV.GeoAtlas。全国省界来自同源公开数据。</p><p>全国道路为 Natural Earth 1:10m 概化干线，不能据此判断完整高速、国道覆盖。丹江口样区使用已有 OSM 道路数据，保留 G70、G59、G209 等编号。</p><p>监控指标、趋势、排行、告警、光柱、连线及热力均为固定演示数据，尚未对接业务接口。边界源未声明坐标系，尚未完成与 WGS84 道路的精确坐标验收。</p><div className="source-links"><a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noreferrer">DataV.GeoAtlas<ArrowUpRight/></a><a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/" target="_blank" rel="noreferrer">Natural Earth<ArrowUpRight/></a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL<ArrowUpRight/></a></div></section><section><h3>渲染状态</h3><dl className="render-stats"><div><dt>渲染方式</dt><dd>按需绘制</dd></div><div><dt>当前质量</dt><dd>{quality === 'high' ? '质感优先' : '流畅优先'}</dd></div><div><dt>像素比</dt><dd>{telemetry.dpr || '—'}</dd></div><div><dt>每帧绘制调用</dt><dd>{telemetry.calls ?? '—'}</dd></div><div><dt>每帧提交三角面</dt><dd>{telemetry.triangles?.toLocaleString() ?? '—'}</dd></div><div><dt>已分配几何体</dt><dd>{telemetry.geometries ?? '—'}</dd></div><div><dt>绘制帧计数</dt><dd data-testid="render-frame">{telemetry.frames ?? '—'}</dd></div><div><dt>相机 / 缩放</dt><dd data-testid="camera-state">{telemetry.camera || '—'} / {telemetry.zoom || '—'}</dd></div></dl><p className="fineprint">读数为打开面板或刷新时的快照，包含反射等渲染通道；帧计数不变表示地图停止绘制。此处不代替目标设备帧率验收。</p><button className="text-button" onClick={() => setTelemetry(telemetryRef.current)}>刷新渲染读数<ArrowRight/></button><button className="text-button" onClick={() => setDialog('layers')}>调整渲染质量<ArrowRight/></button></section></div></Dialog>}
    {(toast || telemetry.error) && <div className="toast" role="status">{toast || telemetry.error}</div>}
  </main>;
}
