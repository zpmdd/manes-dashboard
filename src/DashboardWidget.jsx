import { memo, useId, useMemo, useState } from 'react';
import { donutRows, getWidgetData, sortTableRows, visibleRowCount } from './widgetData.js';
import './widgets.css';

const number = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const PALETTE = ['#f1e8c5', '#cbc8b0', '#afaeb0', '#938a97', '#726d7c', '#d2bda1', '#bfa7a8', '#b3bec1', '#9aab9c', '#848978'];
const COLUMN_KEYS = new Set(['name', 'value', 'status', 'time']);

function Metric({ data, source, unit }) {
  return <div className="widget-metric">
    <div className="widget-value"><strong>{number(data.value)}</strong><span>{unit}</span></div>
    <div className="widget-metric-scope"><i aria-hidden="true"/>{data.scope}</div>
    {source === 'devices' ? <dl className="widget-metric-details"><div><dt>在线设备</dt><dd>{number(data.onlineCount)}</dd></div><div><dt>离线设备</dt><dd>{number(data.offlineCount)}</dd></div></dl> : <div className="widget-metric-note">{source === 'online' ? '在线设备 / 接入设备' : '最近一小时接入量'}</div>}
  </div>;
}

function Gauge({ data, unit, title }) {
  const id = useId(), value = Math.max(0, Math.min(100, data.value));
  return <div className="widget-gauge">
    <svg viewBox="0 0 220 186" role="img" aria-label={`${title} ${number(value)}${unit}`}>
      <defs><linearGradient id={id} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#fff2cd"/><stop offset="1" stopColor="#bfbca6" stopOpacity=".35"/></linearGradient></defs>
      {Array.from({ length: 37 }, (_, i) => {
        const a = (135 + i * 7.5) * Math.PI / 180;
        return <line key={i} x1={110 + Math.cos(a) * 89} y1={99 + Math.sin(a) * 89} x2={110 + Math.cos(a) * 93} y2={99 + Math.sin(a) * 93} stroke="currentColor" opacity={i / 36 <= value / 100 ? .58 : .18} strokeWidth=".8"/>;
      })}
      <circle cx="110" cy="99" r="72" fill="none" stroke="#eee7d816" strokeWidth="17" pathLength="100" strokeDasharray="75 100" transform="rotate(135 110 99)"/>
      <circle className="widget-gauge-arc" cx="110" cy="99" r="72" fill="none" stroke={`url(#${id})`} strokeWidth="17" pathLength="100" strokeDasharray={`${value * .75} 100`} transform="rotate(135 110 99)"/>
      <text x="110" y="104" textAnchor="middle" className="widget-gauge-number">{number(value)}<tspan className="widget-gauge-unit">{unit}</tspan></text>
      <text x="110" y="124" textAnchor="middle" className="widget-gauge-label">{data.scope}</text>
      <text x="41" y="176" className="widget-gauge-label">0</text><text x="179" y="176" textAnchor="end" className="widget-gauge-label">100</text>
    </svg>
  </div>;
}

function LineChart({ rows, unit, title }) {
  const id = useId(), [active, setActive] = useState(null);
  const max = Math.max(5, Math.ceil(Math.max(...rows.map(row => row.value)) / 5) * 5);
  const points = rows.map((row, i) => [30 + i * 278 / Math.max(1, rows.length - 1), 126 - row.value / max * 96]);
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  return <figure className="widget-line-chart">
    <figcaption><span>{unit}</span><span>{active === null ? `${rows[0].time} — ${rows.at(-1).time}` : `${rows[active].time} · ${number(rows[active].value)} ${unit}`}</span></figcaption>
    <svg viewBox="0 0 320 153" role="group" aria-label={`${title}，单位 ${unit}`}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#f1e5bc" stopOpacity=".25"/><stop offset="1" stopColor="#f1e5bc" stopOpacity="0"/></linearGradient></defs>
      {[0, .5, 1].map(tick => <g key={tick} className="widget-chart-grid"><line x1="30" x2="308" y1={126 - tick * 96} y2={126 - tick * 96}/><text x="22" y={129 - tick * 96} textAnchor="end">{number(max * tick)}</text></g>)}
      <path d={`${path} L308,126 L30,126 Z`} fill={`url(#${id})`}/>
      <path className="widget-trend-line" d={path} fill="none" stroke="#f0e8c6" strokeWidth="2" strokeLinejoin="round"/>
      {points.map(([x, y], i) => <g key={rows[i].time}>
        {(i % 2 === 0 || i === rows.length - 1) && <text className="widget-chart-label" x={x} y="148" textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{rows[i].time}</text>}
        <circle cx={x} cy={y} r={active === i ? 4 : 2.3} fill="#f7edcc" stroke="#655d63" strokeWidth="1"/>
        <circle className="widget-chart-point" cx={x} cy={y} r="10" fill="transparent" tabIndex="0" role="img" aria-label={`${rows[i].time}，${number(rows[i].value)} ${unit}`} aria-describedby={active === i ? `${id}-tooltip` : undefined} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}><title>{`${rows[i].time} · ${number(rows[i].value)} ${unit}`}</title></circle>
      </g>)}
    </svg>
    {active !== null && <span id={`${id}-tooltip`} className="widget-sr-only" role="tooltip">{rows[active].time}，{number(rows[active].value)} {unit}</span>}
  </figure>;
}

function BarChart({ rows, unit, rowCount, onNavigate }) {
  const shown = rows.slice(0, rowCount), max = Math.max(1, ...rows.map(row => row.value));
  return <ol className="widget-ranking">{shown.map((row, i) => {
    const content = <><span className="widget-rank-number">{String(i + 1).padStart(2, '0')}</span><span className="widget-rank-content"><span className="widget-rank-caption"><span title={row.name}>{row.name}</span><strong>{number(row.value)}<small>{unit}</small></strong></span><span className="widget-bar-track"><span style={{ width: `${row.value / max * 100}%` }}/></span></span>{row.code && <span className="widget-rank-arrow" aria-hidden="true">›</span>}</>;
    return <li key={row.code || row.name}>{row.code && onNavigate ? <button onClick={() => onNavigate(row.code)} aria-label={`${row.name}，${number(row.value)} ${unit}，查看区域`}>{content}</button> : <div>{content}</div>}</li>;
  })}</ol>;
}

function DonutChart({ rows, unit, rowCount, title, onNavigate }) {
  const segments = donutRows(rows, rowCount), total = segments.reduce((sum, row) => sum + row.value, 0);
  let offset = 0;
  if (!total) return <div className="widget-empty" role="status">暂无可展示的区域分布</div>;
  return <div className="widget-donut-layout"><svg viewBox="0 0 170 170" role="img" aria-label={`${title}，总计 ${number(total)} ${unit}，${segments.map(row => `${row.name} ${number(row.value)}`).join('，')}`}>
    <circle cx="85" cy="85" r="62" fill="none" stroke="#eee7d816" strokeWidth="18"/>
    {segments.map((row, i) => {
      const share = row.value / total * 100, start = offset; offset += share;
      return <circle key={row.name} cx="85" cy="85" r="62" fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="18" pathLength="100" strokeDasharray={`${Math.max(.05, share - .65)} ${100 - Math.max(.05, share - .65)}`} strokeDashoffset={-start} transform="rotate(-90 85 85)"><title>{row.name}：{number(row.value)} {unit}（{number(share)}%）</title></circle>;
    })}
    <text x="85" y="86" textAnchor="middle" className="widget-donut-total">{number(total)}</text><text x="85" y="105" textAnchor="middle" className="widget-gauge-label">合计 / {unit}</text>
  </svg><ul className="widget-donut-legend">{segments.map((row, i) => <li key={row.name}><i style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden="true"/>{row.code && onNavigate ? <button onClick={() => onNavigate(row.code)} title={row.name}>{row.name}</button> : <span title={row.name}>{row.name}</span>}<strong title={`${number(row.value)} ${unit}`}>{number(row.value / total * 100)}%</strong></li>)}</ul></div>;
}

function DataTable({ rows, columns, unit, rowCount, title, onNavigate }) {
  const [direction, setDirection] = useState(null);
  const sorted = sortTableRows(rows, direction).slice(0, rowCount);
  const visibleColumns = columns?.filter(column => COLUMN_KEYS.has(column.key)).slice(0, 4) || [];
  if (!visibleColumns.length) return <div className="widget-empty" role="status">请选择要展示的表格列</div>;
  return <div className="widget-table-wrap"><table className="widget-table"><caption className="widget-sr-only">{title}{unit && `，数值单位 ${unit}`}</caption><thead><tr>{visibleColumns.map(column => <th key={column.key} className={`widget-cell-${column.key}`} scope="col" aria-sort={column.key === 'value' ? direction || 'none' : undefined}>{column.key === 'value' ? <button onClick={() => setDirection(current => current === 'descending' ? 'ascending' : 'descending')}>{column.label}{unit && <small>/{unit}</small>}<span aria-hidden="true">{direction === 'ascending' ? '↑' : '↓'}</span><span className="widget-sr-only">按数值{direction === 'descending' ? '升序' : '降序'}排列</span></button> : column.label}</th>)}</tr></thead><tbody>{sorted.map((row, i) => <tr key={row.code || `${row.name}-${row.time}-${i}`}>{visibleColumns.map((column, columnIndex) => {
    const value = column.key === 'value' ? number(row.value) : String(row[column.key] ?? '—');
    return <td key={column.key} className={`widget-cell-${column.key}`} title={value}>{columnIndex === 0 && row.code && onNavigate ? <button className="widget-table-link" aria-label={`${row.name}，查看区域`} onClick={() => onNavigate(row.code)}>{value}</button> : column.key === 'status' ? <span className={`widget-status ${value === '待处理' ? 'is-pending' : ''}`}>{value}</span> : value}</td>;
  })}</tr>)}</tbody></table></div>;
}

export const DashboardWidget = memo(function DashboardWidget({ config, code, index, onNavigate }) {
  const data = useMemo(() => getWidgetData(config.source, code, index), [config.source, code, index]);
  const headingId = useId(), unit = config.unit ?? data.unit, rowCount = visibleRowCount(config.rowCount);
  if (config.visible === false) return null;
  let body;
  if (!data.rows.length) body = <div className="widget-empty" role="status">{data.emptyMessage}</div>;
  else if (config.type === 'metric') body = <Metric data={data} source={config.source} unit={unit}/>;
  else if (config.type === 'gauge' && config.source === 'online') body = <Gauge data={data} unit={unit} title={config.title}/>;
  else if (config.type === 'line' && config.source === 'trend') body = <LineChart key={`${code}-${rowCount}`} rows={data.rows.slice(-rowCount)} unit={unit} title={config.title}/>;
  else if (config.type === 'bar' && config.source === 'regions') body = <BarChart rows={data.rows} unit={unit} rowCount={rowCount} onNavigate={onNavigate}/>;
  else if (config.type === 'donut' && config.source === 'regions') body = <DonutChart rows={data.rows} unit={unit} rowCount={rowCount} title={config.title} onNavigate={onNavigate}/>;
  else if (config.type === 'table') body = <DataTable key={config.source} rows={data.rows} columns={config.columns} unit={unit} rowCount={rowCount} title={config.title} onNavigate={onNavigate}/>;
  else body = <div className="widget-empty" role="status">请选择适用的展示类型</div>;
  return <section className={`dashboard-widget widget-type-${config.type}`} aria-labelledby={headingId} data-widget-id={config.id} style={{ '--widget-rows': rowCount }}>
    <header className="widget-heading"><div><h2 id={headingId} title={config.title}>{config.title}</h2>{config.subtitle && <p title={config.subtitle}>{config.subtitle}</p>}</div><span className="widget-heading-mark" aria-hidden="true"/></header>
    <div className="widget-body">{body}</div>
  </section>;
});
