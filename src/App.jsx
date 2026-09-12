import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, ArrowsOut, Atom, CaretDown, CaretRight, ChartLineUp, Check, CircleNotch, Compass, Database, GlobeHemisphereEast, Info, Lightning, MapTrifold, Minus, Plus, RoadHorizon, Stack, WifiHigh, X } from '@phosphor-icons/react';
import '@fontsource/michroma/latin-400.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import { MapScene } from './MapScene';
import { demoMetrics, lineage, NATIONAL, polygons, shortName } from './geo';

const DEFAULT_LAYERS = { roads: true, beacons: true, arcs: true, heat: false, labels: true, highway: true, nationalRoad: true };
const fetchJson = async (path, signal) => {
  const response = await fetch(path, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`本地地图文件读取失败（${response.status}）`);
  const data = await response.json();
  if (path.includes('/regions/') && (data.type !== 'FeatureCollection' || !data.features?.length)) throw new Error('地图文件没有可用的区域');
  return data;
};

function IconButton({ label, children, active, className = '', ...props }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

function Gauge({ value, increase }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current, size = 220;
    canvas.width = canvas.height = size * 2;
    const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
    const start = Math.PI * .86, sweep = Math.PI * 1.7;
    for (let i = 0; i < 68; i++) {
      const a = start + sweep * i / 67;
      ctx.strokeStyle = i < value / 100 * 68 ? 'rgba(246,240,207,.42)' : 'rgba(255,255,255,.16)';
      ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(110 + Math.cos(a) * 82, 110 + Math.sin(a) * 82); ctx.lineTo(110 + Math.cos(a) * 84, 110 + Math.sin(a) * 84); ctx.stroke();
    }
    ctx.beginPath(); ctx.lineWidth = 25; ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.arc(110, 110, 71, start, start + sweep); ctx.stroke();
    const gradient = ctx.createLinearGradient(40, 22, 148, 152);
    gradient.addColorStop(0, '#e0ddc1'); gradient.addColorStop(.42, 'rgba(209,205,177,.50)'); gradient.addColorStop(.82, 'rgba(188,184,160,.12)'); gradient.addColorStop(1, 'rgba(188,184,160,0)');
    ctx.strokeStyle = gradient; ctx.shadowColor = '#eee8c9'; ctx.shadowBlur = 12;
    for (let i = 0; i < 100; i++) {
      ctx.globalAlpha = Math.min(1, i / 20); ctx.beginPath();
      ctx.arc(110, 110, 71, start + sweep * value / 100 * i / 100, start + sweep * value / 100 * (i + 1) / 100); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0; const a = start + sweep * value / 100;
    ctx.beginPath(); ctx.fillStyle = '#fffceb'; ctx.arc(110 + Math.cos(a) * 88, 110 + Math.sin(a) * 88, 2.5, 0, Math.PI * 2); ctx.fill();
  }, [value]);
  return <div className="gauge" role="img" aria-label={`运行效率 ${value}%，较上一周期增加 ${increase}`}><canvas ref={ref}/><div className="gauge-number">+{increase}</div></div>;
}

function SouthSea({ data }) {
  const paths = useMemo(() => data.features.flatMap(f => polygons(f.geometry)).filter(poly => poly[0].every(p => p[0] > 105 && p[0] < 124 && p[1] < 24)).map(poly => poly.map(ring => ring.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - 105) * 4},${(24 - p[1]) * 4}`).join('') + 'Z').join('')), [data]);
  return <div className="south-sea"><svg viewBox="0 0 76 90" aria-label="南海诸岛附图">{paths.map((d, i) => <path key={i} d={d} fill="rgba(234,228,207,.32)" stroke="rgba(244,238,217,.7)" strokeWidth=".55" fillRule="evenodd"/>)}</svg><span>南海诸岛</span></div>;
}

function Dialog({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="dialog-heading"><div><small>{subtitle}</small><h2>{title}</h2></div><IconButton label="关闭" onClick={onClose}><X size={20}/></IconButton></div>{children}</dialog>;
}

function RegionPicker({ index, onNavigate, onClose, code }) {
  const [search, setSearch] = useState('');
  const results = Object.entries(index).filter(([id, r]) => search ? r.name.includes(search.trim()) || id.includes(search.trim()) : r.parent === code && id !== code).slice(0, 80);
  return <Dialog title="选择关注的区域" subtitle="EXPLORE THE MAP" onClose={onClose} wide>
    <label className="search-label">区域名称或行政区划代码<input autoFocus placeholder="搜索省、市、区县，如：湖北、武汉" value={search} onChange={e => setSearch(e.target.value)}/></label>
    <div className="region-actions"><button onClick={() => onNavigate(NATIONAL)}><GlobeHemisphereEast/>全国概览</button><button onClick={() => onNavigate('420381')}><RoadHorizon/>丹江口 · 道路样区<ArrowUpRight/></button></div>
    <div className="region-grid">{results.map(([id, r]) => <button key={id} onClick={() => onNavigate(id)}><span>{r.name}<small>{index[r.parent]?.name || '全国'} · {id}</small></span><CaretRight size={14}/></button>)}</div>
    {!results.length && <p className="empty">{search ? '没有找到这个区域，请尝试简称或行政区划代码。' : '已到当前数据的最细层级，可搜索或返回全国选择其他区域。'}</p>}
    {search && results.length === 80 && <p className="fineprint">显示前 80 个匹配结果，请输入更完整的名称。</p>}
  </Dialog>;
}

function LayerPanel({ layers, setLayers, quality, setQuality, detail, onClose }) {
  const rows = [['roads', '道路网络', detail ? '高速、国道及主要干线' : '全国主要道路 · 概化数据'], ['beacons', '监测光柱', '区域连接节点'], ['arcs', '区域连线', '示意关联，不表示车辆轨迹'], ['heat', '态势热力', '演示数据的空间分布'], ['labels', '节点名称', '显示地理标签']];
  return <Dialog title="调整地图图层" subtitle="MAKE IT YOUR VIEW" onClose={onClose}>
    <div className="switch-list">{rows.map(([key, label, hint]) => <label key={key}><span>{label}<small>{hint}</small></span><input type="checkbox" checked={layers[key]} onChange={e => setLayers(s => ({ ...s, [key]: e.target.checked }))}/><span className="switch-track" aria-hidden="true"/></label>)}</div>
    {detail && <div className="road-filters">{[['highway', '高速公路'], ['nationalRoad', '国道 / 干线']].map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={e => setLayers(s => ({ ...s, [key]: e.target.checked }))}/>{label}</label>)}</div>}
    <div className="quality-heading">渲染质量<span>可随时切换</span></div><div className="segmented">{[['high', '质感优先'], ['balanced', '流畅优先']].map(([v, label]) => <button key={v} className={quality === v ? 'active' : ''} onClick={() => setQuality(v)}>{label}{quality === v && <Check/>}</button>)}</div>
    <p className="fineprint">流畅模式降低像素密度并关闭地面反射。地图静止时停止连续绘制。</p>
  </Dialog>;
}

export function App() {
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
  const metrics = demoMetrics(loaded?.code || NATIONAL), scope = index?.[loaded?.code || code], path = index ? lineage(loaded?.code || code, index) : [];
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
    <aside className="sidebar" aria-label="运行概览"><div className="summary-card"><div className="brand"><Atom size={33} weight="fill"/><span>Nexus 3.0</span></div><div className="status-dots"><span className="on"/><span/><span/></div><div className="device-count"><strong>{loaded?.code === NATIONAL || !loaded ? '2K' : metrics.devices}</strong><span>Ongoing<br/>Support<i className="support-signal"/></span></div></div>
      <div className="flow-card"><div className="section-eyebrow">Streamline</div><Gauge value={78} increase={metrics.flow}/></div>
      <button className="connected-card" aria-label="查看区域运行指标" onClick={() => setDialog('metrics')}><div className="connected-title">Connected<br/>communities</div><span className="round-mark"><Atom size={25} weight="thin"/></span><div className="connected-number">80<small>%</small></div><div className="connection-bar"><span style={{ width: '60%' }}/></div></button>
    </aside>
    <header className="topbar"><nav aria-label="视图切换">{[['overview', 'Home', '总览'], ['monitor', 'Smart City', '数据监测'], ['traffic', 'Transportation', '交通网络'], ['regions', 'Governance', '区域管理']].map(([id, label, title]) => <button key={id} className={mode === id ? 'selected' : ''} aria-label={title} aria-pressed={mode === id} onClick={() => setView(id)}>{label}</button>)}</nav><button className="connected-space" onClick={fullScreen}><span>Connected Public Spaces</span><ArrowsOut size={19}/></button><div className="top-actions"><IconButton label="地图图层" onClick={() => setDialog('layers')}><Stack weight="thin"/></IconButton><IconButton label="恢复默认视角" onClick={() => sendCommand('reset')}><Compass weight="thin"/></IconButton><IconButton label="数据与性能说明" onClick={showInfo}><Info weight="thin"/></IconButton></div></header>
    <section className="map-panel" aria-label="交互式三维行政区地图" aria-busy={loading}>
      <div className="map-heading"><div className="atlas-wordmark">CN<span>ATLAS</span></div><div className="location-strip"><div className="breadcrumb">{path.map((p, i) => <span key={p.code}>{i > 0 && <CaretRight size={11}/>}<button onClick={() => navigate(p.code)}>{shortName(p.name)}</button></span>)}</div><button className="scope-select" onClick={() => setDialog('regions')}>{scope?.name === '中国' ? '全国运行总览' : scope?.name || '全国运行总览'}<CaretDown size={13}/></button></div></div>
      <div className="demo-badge"><span/>DEMO <i/>演示快照</div>
      <div className="map-side-controls"><IconButton label="切换监测光柱" active={layers.beacons} onClick={() => setLayers(s => ({ ...s, beacons: !s.beacons }))}><Lightning weight="fill"/></IconButton><IconButton label="切换区域连线" active={layers.arcs} onClick={() => setLayers(s => ({ ...s, arcs: !s.arcs }))}><WifiHigh weight="bold"/></IconButton></div>
      <div className="map-interaction"><IconButton label="放大地图" onClick={() => sendCommand('zoomIn')}><Plus/></IconButton><IconButton label="缩小地图" onClick={() => sendCommand('zoomOut')}><Minus/></IconButton><span/><IconButton label="旋转地图十五度" onClick={() => sendCommand('rotate')}><Compass/></IconButton><IconButton label="俯视地图" onClick={() => sendCommand('top')}><MapTrifold/></IconButton></div>
      {loaded?.code === NATIONAL && <SouthSea data={loaded.data}/>}
      {path.length > 1 && <button className="back-region" onClick={() => navigate(path[path.length - 2].code)}><ArrowLeft/>返回{shortName(path[path.length - 2].name)}</button>}
      {hover && <div className="hover-caption" role="status">{hover}<span>点击查看区域</span><ArrowUpRight/></div>}
      {loading && <div className="loading-state" role="status"><CircleNotch className="spinner" size={24}/><span>正在展开地图</span></div>}
      {error && <div className="load-error" role="alert"><strong>{error}</strong><div><button onClick={() => setRetry(n => n + 1)}>重试</button><button onClick={() => navigate(NATIONAL)}>返回全国</button></div></div>}
      <div className="map-story"><h1>Smart Living in a<br/>Digital World</h1><button className="primary-cta" aria-label="探索区域运行态势" onClick={() => setDialog('regions')}><span><ArrowUpRight size={19}/></span><b>Explore regional connections</b></button></div>
      <div className="map-intro"><div className="intro-badge"><GlobeHemisphereEast size={25} weight="thin"/><span>All Connected</span></div><p>从全国到每一座城市，让分散的数据汇成清晰的视野。<br/>全域协同，让每一处连接可见。</p></div>
      <div className="map-bottom"><span>拖动旋转 · 右键平移 · 滚轮缩放 · 点击区域下钻</span><button onClick={showInfo}>{loaded?.code === '420381' ? '© OpenStreetMap contributors' : 'DataV.GeoAtlas · Natural Earth'}<Info size={11}/></button></div>
    </section>
    {dialog === 'regions' && index && <RegionPicker index={index} code={loaded?.code || NATIONAL} onNavigate={navigate} onClose={() => setDialog(null)}/>}
    {dialog === 'layers' && <LayerPanel layers={layers} setLayers={setLayers} quality={quality} setQuality={setQuality} detail={loaded?.code === '420381'} onClose={() => setDialog(null)}/>}
    {dialog === 'metrics' && <Dialog title={`${scope?.name || '全国'} · 运行概览`} subtitle="NETWORK AT A GLANCE" onClose={() => setDialog(null)}><div className="metric-grid"><div><Database/><strong>{metrics.devices.toLocaleString()}</strong><span>接入设备</span></div><div><WifiHigh/><strong>{metrics.online}%</strong><span>网络在线率</span></div><div><ChartLineUp/><strong>+{metrics.flow}</strong><span>运行效率变化</span></div></div><p className="fineprint">当前数字为固定演示数据；左栏 80% 为示意接入覆盖率。用于验证大屏样式与交互，尚未连接业务监控接口。</p><button className="dialog-primary" onClick={() => setDialog('regions')}>切换关注区域<ArrowRight/></button></Dialog>}
    {dialog === 'info' && <Dialog title="关于这张地图" subtitle="DATA & RENDERING" onClose={() => setDialog(null)} wide><div className="info-columns"><section><h3>数据来源</h3><p>行政区边界复用 Daoyan 本地 GeoJSON，原始来源为 DataV.GeoAtlas。全国省界来自同源公开数据。</p><p>全国道路为 Natural Earth 1:10m 概化干线，不能据此判断完整高速、国道覆盖。丹江口样区使用已有 OSM 道路数据，保留 G70、G59、G209 等编号。</p><p>监控指标、光柱、连线及热力为演示数据。边界源未声明坐标系，尚未完成与 WGS84 道路的精确坐标验收。</p><div className="source-links"><a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noreferrer">DataV.GeoAtlas<ArrowUpRight/></a><a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/" target="_blank" rel="noreferrer">Natural Earth<ArrowUpRight/></a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL<ArrowUpRight/></a></div></section><section><h3>渲染状态</h3><dl className="render-stats"><div><dt>渲染方式</dt><dd>按需绘制</dd></div><div><dt>当前质量</dt><dd>{quality === 'high' ? '质感优先' : '流畅优先'}</dd></div><div><dt>像素比</dt><dd>{telemetry.dpr || '—'}</dd></div><div><dt>每帧绘制调用</dt><dd>{telemetry.calls ?? '—'}</dd></div><div><dt>每帧提交三角面</dt><dd>{telemetry.triangles?.toLocaleString() ?? '—'}</dd></div><div><dt>已分配几何体</dt><dd>{telemetry.geometries ?? '—'}</dd></div><div><dt>绘制帧计数</dt><dd data-testid="render-frame">{telemetry.frames ?? '—'}</dd></div><div><dt>相机 / 缩放</dt><dd data-testid="camera-state">{telemetry.camera || '—'} / {telemetry.zoom || '—'}</dd></div></dl><p className="fineprint">读数为打开面板或刷新时的快照，包含反射等渲染通道；帧计数不变表示地图停止绘制。此处不代替目标设备帧率验收。</p><button className="text-button" onClick={() => setTelemetry(telemetryRef.current)}>刷新渲染读数<ArrowRight/></button><button className="text-button" onClick={() => setDialog('layers')}>调整渲染质量<ArrowRight/></button></section></div></Dialog>}
    {(toast || telemetry.error) && <div className="toast" role="status">{toast || telemetry.error}</div>}
  </main>;
}
