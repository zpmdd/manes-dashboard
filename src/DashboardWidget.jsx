import { Component, lazy, memo, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { chartDomain, donutRows, formatWidgetNumber as number, formatAxisNumber, getWidgetData, normalizeWidgetData, PROFESSIONAL_TYPES, progressValues, sortTableRows, statusTone, visibleRowCount } from './widgetData.js';
import { DATA_FIELDS } from './dataSources.js';
import { DEFAULT_THEME } from './themes.js';
import './widgets.css';

const COLUMN_KEYS = new Set(DATA_FIELDS);
const ProfessionalChart = lazy(() => import('./ProfessionalChart.jsx'));

class ChartErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <div className="widget-empty" role="alert"><span>图表暂时无法显示</span><p className="widget-error-reason">请检查网络连接后重新加载页面。</p><button onClick={() => location.reload()}>重新加载页面</button></div>;
    return this.props.children;
  }
}

function EmptyState({ message = '暂无数据', detail, onRefresh }) {
  return <div className="widget-empty" role="status"><span>{message}</span>{detail && <p className="widget-error-reason">{detail}</p>}{onRefresh && <button onClick={onRefresh}>重新加载</button>}</div>;
}

function Metric({ data, unit, precision }) {
  const value = number(data.value, precision);
  return <div className="widget-metric">
    <div className="widget-value" style={{ '--metric-length': value.length }}><strong title={value}>{value}</strong><span>{unit}</span></div>
    {data.scope && <div className="widget-metric-scope">{data.scope}</div>}
    {data.onlineCount !== null && data.offlineCount !== null && <dl className="widget-metric-details"><div><dt>在线设备</dt><dd>{number(data.onlineCount, precision)}</dd></div><div><dt>离线设备</dt><dd>{number(data.offlineCount, precision)}</dd></div></dl>}
  </div>;
}

function Gauge({ data, unit, title, target, precision }) {
  const id = useId(), progress = progressValues(data.value, target);
  return <div className="widget-gauge">
    <svg viewBox="0 0 220 186" role="img" aria-label={`${title} ${number(data.value, precision)}${unit}，量程 ${number(progress.target, precision)}${unit}`}>
      <defs><linearGradient id={id} x1="0" x2="1" y1="0" y2="1"><stop stopColor="var(--chart-accent, #fff2cd)"/><stop offset="1" stopColor="var(--chart-secondary, #bfbca6)" stopOpacity=".35"/></linearGradient></defs>
      {Array.from({ length: 37 }, (_, i) => {
        const angle = (135 + i * 7.5) * Math.PI / 180;
        return <line key={i} x1={110 + Math.cos(angle) * 89} y1={99 + Math.sin(angle) * 89} x2={110 + Math.cos(angle) * 93} y2={99 + Math.sin(angle) * 93} stroke="currentColor" opacity={i / 36 <= progress.fill / 100 ? .58 : .18} strokeWidth=".8"/>;
      })}
      <circle cx="110" cy="99" r="72" fill="none" stroke="var(--chart-track, #eee7d816)" strokeWidth="17" pathLength="100" strokeDasharray="75 100" transform="rotate(135 110 99)"/>
      <circle className="widget-gauge-arc" cx="110" cy="99" r="72" fill="none" stroke={`url(#${id})`} strokeWidth="17" pathLength="100" strokeDasharray={`${progress.fill * .75} 100`} transform="rotate(135 110 99)"/>
      <text x="110" y="104" textAnchor="middle" className="widget-gauge-number" style={{ fontSize: number(data.value, precision).length > 7 ? 19 : undefined }}>{number(data.value, precision)}<tspan className="widget-gauge-unit">{unit}</tspan></text>
      <text x="110" y="124" textAnchor="middle" className="widget-gauge-label">{data.scope?.slice(0, 16)}</text>
      <text x="41" y="176" className="widget-gauge-label">0</text><text x="179" y="176" textAnchor="end" className="widget-gauge-label">{number(progress.target, precision)}</text>
    </svg>
  </div>;
}

function TrendChart({ rows, unit, title, type, precision }) {
  const label = row => type === 'column' ? row.name || row.time : row.time || row.name;
  const id = useId(), [active, setActive] = useState(null), { min, max } = chartDomain(rows);
  const scale = Math.max(Math.abs(min), Math.abs(max));
  const y = value => 126 - (value / scale - min / scale) / (max / scale - min / scale) * 96;
  const isColumn = type === 'column', step = 278 / Math.max(1, isColumn ? rows.length : rows.length - 1);
  const points = rows.map((row, i) => [30 + step * (i + (isColumn ? .5 : 0)), y(row.value)]);
  const path = points.map(([x, pointY], i) => `${i ? 'L' : 'M'}${x},${pointY}`).join(' '), selected = rows[active];
  const description = selected ? `${label(selected)} · ${number(selected.value, precision)} ${unit}` : `${label(rows[0])} — ${label(rows.at(-1))}`;
  return <figure className={`widget-line-chart widget-chart-${type}`}>
    <figcaption><span>{unit}</span><span title={description}>{description}</span></figcaption>
    <svg viewBox="0 0 320 153" role="group" aria-label={`${title}，单位 ${unit}`}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--chart-accent, #f1e5bc)" stopOpacity={isColumn ? .94 : .5}/><stop offset="1" stopColor="var(--chart-secondary, #b7a89a)" stopOpacity={isColumn ? .32 : .03}/></linearGradient></defs>
      {[0, .5, 1].map(tick => <g key={tick} className="widget-chart-grid"><line x1="30" x2="308" y1={126 - tick * 96} y2={126 - tick * 96}/><text x="24" y={129 - tick * 96} textAnchor="end">{formatAxisNumber(min * (1 - tick) + max * tick)}</text></g>)}
      {min < 0 && <line className="widget-zero-line" x1="30" x2="308" y1={y(0)} y2={y(0)}/>}
      {type === 'area' && <path d={`${path} L${points.at(-1)[0]},${y(0)} L${points[0][0]},${y(0)} Z`} fill={`url(#${id})`}/>}
      {!isColumn && <path className="widget-trend-line" d={path} fill="none" stroke="var(--chart-accent, #f0e8c6)" strokeWidth="2" strokeLinejoin="round"/>}
      {points.map(([x, pointY], i) => {
        const content = `${label(rows[i])} · ${number(rows[i].value, precision)} ${unit}`;
        const interaction = { tabIndex: 0, role: 'img', 'aria-label': content, onFocus: () => setActive(i), onBlur: () => setActive(null), onPointerEnter: () => setActive(i), onPointerLeave: () => setActive(null) };
        return <g key={`${label(rows[i])}-${i}`}>
          {(i % Math.max(1, Math.ceil(rows.length / 5)) === 0 || i === rows.length - 1) && <text className="widget-chart-label" x={x} y="148" textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{label(rows[i]).slice(0, 10)}</text>}
          {isColumn ? <rect className="widget-chart-point widget-column" x={x - step * .31} y={Math.min(y(0), pointY)} width={step * .62} height={Math.max(.7, Math.abs(y(0) - pointY))} rx="2" fill={`url(#${id})`} opacity={active === null || active === i ? 1 : .6} {...interaction}><title>{content}</title></rect> : <>
            <circle cx={x} cy={pointY} r={active === i ? 4 : 2.3} fill="var(--chart-accent, #f7edcc)" stroke="var(--chart-border, #655d63)" strokeWidth="1"/>
            <circle className="widget-chart-point" cx={x} cy={pointY} r="10" fill="transparent" {...interaction}><title>{content}</title></circle>
          </>}
        </g>;
      })}
    </svg>
  </figure>;
}

function BarChart({ rows, unit, rowCount, onNavigate, precision, selectedCodes }) {
  const shown = rows.slice(0, rowCount), max = Math.max(...rows.map(row => Math.abs(row.value))) || 1;
  return <ol className="widget-ranking">{shown.map((row, i) => {
    const selected = selectedCodes?.includes(row.code);
    const content = <><span className="widget-rank-number">{String(i + 1).padStart(2, '0')}</span><span className="widget-rank-content"><span className="widget-rank-caption"><span title={row.name}>{row.name}</span><strong>{number(row.value, precision)}<small>{unit}</small></strong></span><span className={`widget-bar-track ${row.value < 0 ? 'is-negative' : ''}`}><span style={{ width: `${Math.abs(row.value) / max * 100}%` }}/></span></span>{row.code && onNavigate && <span className="widget-rank-arrow" aria-hidden="true">{selected ? '✓' : '›'}</span>}</>;
    return <li key={`${row.code || row.name}-${i}`}>{row.code && onNavigate ? <button onClick={() => onNavigate(row.code)} aria-pressed={selected} aria-label={`${row.name}，${number(row.value, precision)} ${unit}，查看区域`}>{content}</button> : <div>{content}</div>}</li>;
  })}</ol>;
}

function DonutChart({ rows, unit, rowCount, title, onNavigate, precision, theme, pie = false }) {
  const id = useId(), segments = donutRows(rows, rowCount), total = segments.reduce((sum, row) => sum + row.value, 0);
  // ponytail: 最多四分类且每侧不超过两项时使用外引读数；密集分类保留完整图例。
  const colors = pie ? theme.colors : theme.donut;
  let offset = 0;
  if (pie && rows.some(row => row.value < 0)) return <EmptyState message="饼图需使用非负数值"/>;
  if (!Number.isFinite(total)) return <EmptyState message="分布合计超出有效数字范围"/>;
  if (!total) return <EmptyState message="暂无正值分布数据"/>;
  const slices = segments.map(row => {
    const start = offset, share = row.value / total * 100; offset += share;
    const angle = segments.length === 1 ? 0 : ((start + share / 2) / 100 * 2 - .5) * Math.PI;
    return { start, share, end: offset, dx: Math.cos(angle), dy: Math.sin(angle) };
  });
  const leftCount = slices.filter(slice => slice.dx < 0).length;
  const callouts = pie && leftCount <= 2 && slices.length - leftCount <= 2;
  if (callouts) for (const side of [-1, 1]) {
    const labels = slices.filter(slice => (slice.dx < 0 ? -1 : 1) === side).sort((a, b) => a.dy - b.dy);
    labels.forEach((slice, i) => { slice.labelY = labels.length === 1 ? Math.max(50, Math.min(142, 100 + slice.dy * 96)) : 46 + i / (labels.length - 1) * 106; });
  }
  return <div className={`widget-donut-layout${pie ? ' widget-pie-layout' : ''}${callouts ? ' widget-pie-callouts' : ''}`}><svg viewBox={callouts ? '0 0 320 210' : '0 0 170 170'} role={pie ? 'group' : 'img'} aria-label={`${title}，总计 ${number(total, precision)} ${unit}，${segments.map(row => `${row.name} ${number(row.value, precision)}`).join('，')}`}>
    {!pie && <circle cx="85" cy="85" r="62" fill="none" stroke="var(--chart-track, #eee7d816)" strokeWidth="18"/>}
    {segments.map((row, i) => {
      const { share, start, end, dx, dy, labelY } = slices[i];
      if (pie) {
        const cx = callouts ? 160 : 85, cy = callouts ? 100 : 80, radius = callouts ? 84 : 71, split = segments.length === 1 ? 0 : callouts ? 4 : 1.5;
        const angle = percent => (percent / 100 * 2 - .5) * Math.PI;
        const point = percent => [cx + Math.cos(angle(percent)) * radius, cy + Math.sin(angle(percent)) * radius];
        const shape = segments.length === 1 ? { cx, cy, r: radius } : { d: `M${cx},${cy} L${point(start)} A${radius},${radius} 0 ${share > 50 ? 1 : 0},1 ${point(end)} Z` };
        const Shape = segments.length === 1 ? 'circle' : 'path', color = colors[i % colors.length], gradient = `${id}-${i}`;
        const content = `${row.name}：${number(row.value, precision)} ${unit}（${number(share, precision)}%）`, interactive = Boolean(row.code && onNavigate);
        const side = dx < 0 ? -1 : 1, labelX = side < 0 ? 8 : 312;
        const valueLabel = number(row.value, precision).length > 6 ? formatAxisNumber(row.value) : number(row.value, precision);
        return <g key={`${row.name}-${i}`} className="widget-pie-slice" role={interactive ? 'button' : 'img'} tabIndex={interactive ? 0 : undefined} aria-label={content} onClick={interactive ? () => onNavigate(row.code) : undefined} onKeyDown={interactive ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate(row.code); } } : undefined}>
          <title>{content}</title>
          <defs><linearGradient id={gradient} x1="0" y1="0" x2=".3" y2="1"><stop stopColor={`color-mix(in srgb, ${color} 82%, white)`}/><stop offset=".48" stopColor={color}/><stop offset="1" stopColor={`color-mix(in srgb, ${color} 74%, ${theme.panel})`}/></linearGradient></defs>
          <g className="widget-pie-body" transform={`translate(${dx * split} ${dy * split})`}>
            <Shape {...shape} className="widget-pie-depth" transform="translate(0 7)" fill={`color-mix(in srgb, ${color} 42%, ${theme.panel})`}/>
            <Shape {...shape} className="widget-pie-face" fill={`url(#${gradient})`}/>
          </g>
          {callouts && <g className="widget-pie-label" textAnchor={side < 0 ? 'start' : 'end'}>
            <polyline className="widget-pie-leader" points={`${cx + dx * (radius + split)},${cy + dy * (radius + split)} ${cx + dx * (radius + split + 12)},${cy + dy * (radius + split + 12)} ${cx + side * 96},${labelY + 6} ${labelX},${labelY + 6}`} stroke={color}/>
            <text x={labelX} y={labelY - 27} className="widget-pie-name">{row.name.length > 5 ? `${row.name.slice(0, 4)}…` : row.name}</text>
            <text x={labelX} y={labelY - 5} className="widget-pie-value" style={valueLabel.length > 3 ? { fontSize: 14 } : undefined}>{valueLabel}<tspan className="widget-pie-unit"> {unit}</tspan></text>
            <text x={labelX} y={labelY + 25} className="widget-pie-share">{number(share, precision)}%</text>
          </g>}
        </g>;
      }
      return <circle key={`${row.name}-${i}`} cx="85" cy="85" r="62" fill="none" stroke={theme.donut[i % theme.donut.length]} strokeWidth="18" pathLength="100" strokeDasharray={`${Math.max(.05, share - .65)} ${100 - Math.max(.05, share - .65)}`} strokeDashoffset={-start} transform="rotate(-90 85 85)"><title>{`${row.name}：${number(row.value, precision)} ${unit}（${number(share, precision)}%）`}</title></circle>;
    })}
    {!pie && <><text x="85" y="86" textAnchor="middle" className="widget-donut-total" style={{ fontSize: number(total, precision).length > 7 ? 14 : undefined }}>{number(total, precision)}</text><text x="85" y="105" textAnchor="middle" className="widget-gauge-label">合计{unit && ` / ${unit}`}</text></>}
  </svg>{!callouts && <ul className="widget-donut-legend">{segments.map((row, i) => <li key={`${row.name}-${i}`}><i style={{ background: colors[i % colors.length] }} aria-hidden="true"/>{row.code && onNavigate ? <button onClick={() => onNavigate(row.code)} title={row.name}>{row.name}</button> : <span title={row.name}>{row.name}</span>}{pie && <small>{number(row.value, precision)} {unit}</small>}<strong title={`${number(row.value, precision)} ${unit}`}>{number(row.value / total * 100, precision)}%</strong></li>)}</ul>}</div>;
}

function DataTable({ rows, columns, unit, rowCount, title, onNavigate, precision }) {
  const [direction, setDirection] = useState(null);
  const visibleColumns = columns?.filter(column => COLUMN_KEYS.has(column.key)).slice(0, COLUMN_KEYS.size) || [];
  const canSort = visibleColumns.some(column => column.key === 'value');
  const sorted = useMemo(() => sortTableRows(rows, canSort ? direction : null), [rows, direction, canSort]).slice(0, rowCount);
  if (!visibleColumns.length) return <EmptyState message="请选择表格列"/>;
  return <div className="widget-table-wrap" tabIndex="0" role="region" aria-label={`${title}，可滚动表格`}><table className="widget-table"><caption className="widget-sr-only">{title}{unit && `，数值单位 ${unit}`}</caption><thead><tr>{visibleColumns.map(column => <th key={column.key} className={`widget-cell-${column.key}`} scope="col" aria-sort={column.key === 'value' ? direction || 'none' : undefined}>{column.key === 'value' ? <button onClick={() => setDirection(current => current === 'descending' ? 'ascending' : 'descending')}>{column.label}{unit && <small>/{unit}</small>}<span aria-hidden="true">{direction === 'ascending' ? '↑' : '↓'}</span><span className="widget-sr-only">按数值{direction === 'descending' ? '升序' : '降序'}排列</span></button> : column.label}</th>)}</tr></thead><tbody>{sorted.map((row, i) => <tr key={`${row.code || row.name}-${i}`}>{visibleColumns.map((column, columnIndex) => {
    const value = ['value', 'target', 'value2'].includes(column.key) ? number(row[column.key], precision) : row[column.key] === null || row[column.key] === undefined || row[column.key] === '' ? '—' : String(row[column.key]);
    return <td key={column.key} className={`widget-cell-${column.key}`} title={value}>{columnIndex === 0 && row.code && onNavigate ? <button className="widget-table-link" aria-label={`${row.name}，查看区域`} onClick={() => onNavigate(row.code)}>{value}</button> : column.key === 'status' ? <span className={`widget-status is-${statusTone(value)}`}>{value}</span> : value}</td>;
  })}</tr>)}</tbody></table></div>;
}

function Progress({ rows, unit, target, precision }) {
  return <ul className="widget-progress-list">{rows.map((row, i) => {
    const progress = progressValues(row.value, row.target ?? target);
    return <li key={`${row.name}-${i}`}><div className="widget-progress-caption"><span title={row.name}>{row.name}</span><strong>{number(progress.percent, precision)}<small>%</small></strong></div><div className="widget-progress-track" role="progressbar" aria-label={row.name} aria-valuemin="0" aria-valuemax={progress.target} aria-valuenow={Math.max(0, Math.min(progress.target, progress.value))} aria-valuetext={`${number(progress.value, precision)} / ${number(progress.target, precision)} ${unit}`}><span style={{ width: `${progress.fill}%` }}/></div><div className="widget-progress-detail"><span>{number(progress.value, precision)} {unit}</span><span>目标 {number(progress.target, precision)} {unit}</span></div></li>;
  })}</ul>;
}

function StatusGrid({ rows, unit, precision, onNavigate }) {
  return <ul className="widget-status-grid">{rows.map((row, i) => {
    const tone = statusTone(row.status), text = <><span className="widget-status-name"><i aria-hidden="true"/>{row.name}</span><strong>{row.status || '未知状态'}</strong>{row.value !== null && <small>{number(row.value, precision)} {unit}</small>}</>;
    return <li key={`${row.code || row.name}-${i}`} className={`is-${tone}`}>{row.code && onNavigate ? <button onClick={() => onNavigate(row.code)} aria-label={`${row.name}，${row.status || '未知状态'}，查看区域`}>{text}</button> : <div>{text}</div>}</li>;
  })}</ul>;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer;
    const sync = () => {
      clearInterval(timer);
      if (!document.hidden) { setNow(new Date()); timer = setInterval(() => setNow(new Date()), 1000); }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' });
  return <div className="widget-clock"><time dateTime={now.toISOString()}><strong>{now.toLocaleTimeString('zh-CN', { hour12: false })}</strong><span>{date}</span></time><div className="widget-clock-rule" aria-hidden="true"><i/></div></div>;
}

export const DashboardWidget = memo(function DashboardWidget({ config, code, index, onNavigate, data: externalData, dataState, onRefresh, theme = DEFAULT_THEME, fontFamily, selectedCodes }) {
  const hasExternalData = externalData !== undefined || Boolean(dataState);
  const data = useMemo(() => {
    if (config.type === 'text' || config.type === 'clock') return normalizeWidgetData(null);
    const result = normalizeWidgetData(hasExternalData ? externalData : getWidgetData(config.source, code, index));
    if (result.value === null && result.rows.length === 1) result.value = result.rows[0].value;
    return result;
  }, [externalData, hasExternalData, config.type, hasExternalData ? null : config.source, hasExternalData ? null : code, hasExternalData ? null : index]);
  const headingId = useId(), unit = config.unit ?? data.unit, rowCount = visibleRowCount(config.rowCount), precision = config.precision ?? 1;
  const numericRows = useMemo(() => data.rows.filter(row => row.value !== null), [data]);
  if (config.visible === false) return null;
  const independent = config.type === 'text' || config.type === 'clock';
  const professional = PROFESSIONAL_TYPES.includes(config.type);
  const hasData = ['metric', 'gauge'].includes(config.type) ? data.value !== null : (professional || ['table', 'status'].includes(config.type) ? data.rows : numericRows).length > 0;
  const hasError = dataState?.status === 'error' || dataState?.status === 'stale';
  const errorMessage = typeof dataState?.error === 'string' ? dataState.error : dataState?.error?.message;
  const loading = dataState?.status === 'loading';
  let body;
  if (config.type === 'text') body = config.text ? <div className="widget-text" tabIndex="0">{config.text}</div> : <EmptyState message="暂无公告"/>;
  else if (config.type === 'clock') body = <Clock/>;
  else if (!hasData) body = <EmptyState message={hasError ? '数据暂不可用' : loading ? '正在加载' : data.emptyMessage || '暂无数据'} detail={hasError ? errorMessage : undefined} onRefresh={hasError ? onRefresh : undefined}/>;
  else if (professional) body = <ChartErrorBoundary key={config.type}><Suspense fallback={<EmptyState message="正在加载图表"/>}><ProfessionalChart theme={theme} fontFamily={fontFamily} config={config} data={data} onNavigate={onNavigate}/></Suspense></ChartErrorBoundary>;
  else if (config.type === 'metric') body = <Metric data={data} unit={unit} precision={precision}/>;
  else if (config.type === 'gauge') body = <Gauge data={data} unit={unit} title={config.title} target={config.target} precision={precision}/>;
  else if (['line', 'area', 'column'].includes(config.type)) body = <TrendChart rows={config.type === 'column' ? numericRows.slice(0, rowCount) : numericRows.slice(-rowCount)} unit={unit} title={config.title} type={config.type} precision={precision}/>;
  else if (config.type === 'bar') body = <BarChart rows={numericRows} unit={unit} rowCount={rowCount} onNavigate={onNavigate} precision={precision} selectedCodes={selectedCodes}/>;
  else if (['donut', 'pie'].includes(config.type)) body = <DonutChart pie={config.type === 'pie'} theme={theme} rows={numericRows} unit={unit} rowCount={rowCount} title={config.title} onNavigate={onNavigate} precision={precision}/>;
  else if (config.type === 'table') body = <DataTable rows={data.rows} columns={config.columns} unit={unit} rowCount={rowCount} title={config.title} onNavigate={onNavigate} precision={precision}/>;
  else if (config.type === 'progress') body = <Progress rows={numericRows.slice(0, rowCount)} unit={unit} target={config.target} precision={precision}/>;
  else if (config.type === 'status') body = <StatusGrid rows={data.rows.slice(0, rowCount)} unit={unit} precision={precision} onNavigate={onNavigate}/>;
  else body = <EmptyState message="组件类型暂不可用"/>;
  const stateText = hasError ? hasData ? '更新延迟' : '未连接' : loading ? '更新中' : null;
  return <section className={`dashboard-widget widget-type-${config.type} widget-surface-${['glass', 'soft', 'solid'].includes(config.surface) ? config.surface : 'glass'}`} aria-labelledby={headingId} data-widget-id={config.id} style={{ '--widget-rows': rowCount }}>
    <header className="widget-heading"><div><h2 id={headingId} title={config.title}>{config.title}</h2>{config.subtitle && <p title={config.subtitle}>{config.subtitle}</p>}</div>{stateText && !independent && (onRefresh && hasError ? <button className={`widget-data-state ${hasError ? 'is-error' : ''}`} title="重新加载数据" onClick={onRefresh}>{stateText}</button> : <span className="widget-data-state" role="status">{stateText}</span>)}</header>
    {hasError && hasData && !independent && <p className="widget-stale-note" role="status" title={errorMessage}>{errorMessage || '数据更新失败'} · 保留上次数据</p>}
    <div className="widget-body" aria-busy={loading && !independent}>{body}</div>
  </section>;
});
