import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, FunnelChart, HeatmapChart, LineChart, RadarChart, ScatterChart, TreemapChart } from 'echarts/charts';
import { AriaComponent, DataZoomInsideComponent, GridComponent, LegendComponent, RadarComponent, TooltipComponent, VisualMapContinuousComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { buildProfessionalChart } from './professionalCharts.js';
import './professional-charts.css';

echarts.use([BarChart, FunnelChart, HeatmapChart, LineChart, RadarChart, ScatterChart, TreemapChart, AriaComponent, DataZoomInsideComponent, GridComponent, LegendComponent, RadarComponent, TooltipComponent, VisualMapContinuousComponent, LabelLayout, CanvasRenderer, SVGRenderer]);

export function renderProfessionalSVG(config, data, size = { width: 480, height: 280 }) {
  const result = buildProfessionalChart(config, data, { ...size, reducedMotion: true });
  if (!result.option) return '';
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, ...size });
  try { chart.setOption(result.option); return chart.renderToSVGString(); }
  finally { chart.dispose(); }
}

export default function ProfessionalChart({ config, data, onNavigate }) {
  const host = useRef(null), chart = useRef(null), lastType = useRef(null), latestNavigate = useRef(onNavigate);
  const [size, setSize] = useState({ width: 0, height: 0 }), [runtimeError, setRuntimeError] = useState(''), [attempt, setAttempt] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  latestNavigate.current = onNavigate;
  const settings = config.chartOptions || {};
  const result = useMemo(() => {
    try { return buildProfessionalChart(config, data, { ...size, reducedMotion }); }
    catch (error) { return { option: null, count: 0, description: error.message || '数据格式不适用于当前图表', error: true }; }
  }, [config.type, config.title, config.unit, config.rowCount, config.target, settings.legend, settings.labels, settings.zoom, settings.smooth, settings.palette, settings.secondaryUnit, settings.primaryName, settings.secondaryName, settings.xName, settings.yName, data, size.width, size.height, reducedMotion]);
  const hasOption = Boolean(result.option), hasSize = size.width > 0 && size.height > 0, renderer = result.count > 1000 ? 'canvas' : 'svg';
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)'), sync = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    let frame = 0, previousWidth = -1, previousHeight = -1;
    const measure = () => {
      frame = 0;
      const width = element.clientWidth, height = element.clientHeight;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width; previousHeight = height;
      if (width > 0 && height > 0) chart.current?.resize({ width, height, animation: { duration: 0 } });
      setSize({ width, height });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element); schedule();
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  useLayoutEffect(() => {
    if (!hasOption || !hasSize || !host.current) return;
    let instance;
    try {
      instance = echarts.init(host.current, null, { renderer, width: size.width, height: size.height });
      instance.on('click', event => { const code = event.data?.code; if (code) latestNavigate.current?.(String(code)); });
      chart.current = instance; lastType.current = null; setRuntimeError('');
    } catch (error) { setRuntimeError(error.message || '图表初始化失败'); }
    return () => { if (chart.current === instance) chart.current = null; instance?.dispose(); };
  }, [renderer, hasOption, hasSize, attempt]);
  useLayoutEffect(() => {
    if (!chart.current || !result.option) return;
    try {
      chart.current.setOption(result.option, { notMerge: lastType.current !== config.type, replaceMerge: ['series', 'dataZoom'], lazyUpdate: true });
      lastType.current = config.type; setRuntimeError('');
    } catch (error) { setRuntimeError(error.message || '图表绘制失败'); }
  }, [result.option, renderer, hasSize, attempt, config.type]);
  const unavailable = !result.option || runtimeError;
  return <div className="professional-chart-shell" data-chart-renderer={renderer}>
    <div ref={host} className="professional-chart-stage" hidden={Boolean(unavailable)} role="img" tabIndex="0" aria-label={result.description}/>
    {unavailable && <div className="widget-empty professional-chart-empty" role={result.error || runtimeError ? 'alert' : 'status'}><span>{runtimeError ? '图表暂不可用' : result.error ? '请完善图表数据' : result.description}</span>{(result.error || runtimeError) && <p className="widget-error-reason">{runtimeError || result.description}</p>}{runtimeError && <button onClick={() => { setRuntimeError(''); setAttempt(value => value + 1); }}>重新绘制</button>}</div>}
    {settings.zoom === true && !unavailable && ['multiLine', 'stacked', 'combo', 'scatter', 'heatmap'].includes(config.type) && <span className="professional-chart-zoom-hint">Ctrl + 滚轮缩放</span>}
  </div>;
}
