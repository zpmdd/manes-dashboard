import { cloneElement } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Car } from '@phosphor-icons/react';
import { Dialog } from './MapPanels';
import { VEHICLE_FIELDS, linkedVehicles } from './vehicles';

export function VehiclePanel({ vehicles, vehicle, onSelect, onFocus, onClose }) {
  return <Dialog title={`车辆 ${vehicle.VEHICLENO}`} subtitle="VEHICLE · 定位快照" onClose={onClose} wide>
    <div className="vehicle-tabs" aria-label="选择车辆">{vehicles.map(item => <button key={item.VEHICLENO} aria-pressed={vehicle === item} onClick={() => onSelect(item)}>车辆 {item.VEHICLENO}</button>)}</div>
    <dl className="vehicle-details">{VEHICLE_FIELDS.map(([key, label]) => <div key={key} className={key.endsWith('_CODE') ? 'vehicle-code' : ''}><dt>{label}</dt><dd>{vehicle[key] ?? '未提供'}</dd></div>)}</dl>
    <button className="vehicle-focus" onClick={() => onFocus(vehicle)}>定位此车<ArrowUpRight size={14}/></button>
    <p className="fineprint">按提供的经纬度展示。号牌颜色、报警、状态和加密标识保留原始编码；坐标系尚未确认。</p>
  </Dialog>;
}

export function VehicleCallout({ vehicle, index, onClose, onDetails }) {
  return <div className="vehicle-callout" data-vehicle={index}>
    <svg className="vehicle-callout-leader" aria-hidden="true"><path/><circle r="3"/></svg>
    <section className="vehicle-tooltip vehicle-callout-card" aria-label={`选中车辆 ${vehicle.VEHICLENO} 信息`} onPointerDown={event => event.stopPropagation()}>
      <header><strong>车辆 {vehicle.VEHICLENO}</strong><span>{vehicle.GPS_SPEED > 0 ? '行驶' : '静止'}</span><button onClick={onClose} aria-label="取消车辆选择">×</button></header>
      <dl><div><dt>GPS 速度</dt><dd>{vehicle.GPS_SPEED}</dd></div><div><dt>行车定位速度</dt><dd>{vehicle.RECORD_SPEED}</dd></div><div><dt>经度</dt><dd>{vehicle.GEO_LON.toFixed(6)}</dd></div><div><dt>纬度</dt><dd>{vehicle.GEO_LAT.toFixed(6)}</dd></div></dl>
      <time>GPS · {vehicle.GPS_DATE}</time><button className="vehicle-callout-details" onClick={() => onDetails(vehicle)}>完整车辆信息<ArrowUpRight size={13}/></button>
    </section>
  </div>;
}

export function VehicleTooltip({ value: { vehicles, rect }, detailed, ...events }) {
  const item = vehicles[0], group = vehicles.length > 1;
  const left = Math.max(12, Math.min(rect.right + 12, window.innerWidth - 272));
  const top = Math.max(12, Math.min(rect.top - 12, window.innerHeight - 230));
  return createPortal(<div id="vehicle-hover-details" className="vehicle-tooltip" role="tooltip" style={{ left, top }} {...events}>
    <strong>{group ? `此处 ${vehicles.length} 辆车` : `车辆 ${item.VEHICLENO}`}</strong>
    <span className="vehicle-tooltip-status">{group ? `行驶 ${vehicles.filter(row => row.GPS_SPEED > 0).length} · 静止 ${vehicles.filter(row => row.GPS_SPEED === 0).length}` : item.GPS_SPEED > 0 ? '行驶' : '静止'}</span>
    {group ? <p>{vehicles.map(row => `车辆 ${row.VEHICLENO}`).join('、')}</p> : <dl><div><dt>GPS 速度</dt><dd>{item.GPS_SPEED}</dd></div><div><dt>行车定位速度</dt><dd>{item.RECORD_SPEED}</dd></div><div><dt>经纬度</dt><dd>{item.GEO_LON.toFixed(6)}, {item.GEO_LAT.toFixed(6)}</dd></div></dl>}
    <time>GPS · {item.GPS_DATE}</time><small>{detailed ? '点击选中车辆' : '点击放大查看车辆'}</small>
  </div>, document.body);
}

export function VehicleToolbar({ vehicles, result, layer, loaded, loading, visible }) {
  const dates = [...new Set(vehicles.map(item => item.GPS_DATE).filter(Boolean))];
  return <div className="vehicle-toolbar"><button onClick={() => layer.focusVehicles()} disabled={!loaded || loading || !vehicles.length}>定位车辆 · {vehicles.length}</button>{layer.vehicleDetailed && visible && layer.vehicle && <button onClick={() => layer.showVehicleDetails(layer.vehicle)}>车辆详情</button>}{layer.vehicleHighlight !== 'vehicle:all' && <button onClick={layer.clearVehicleSelection}>取消高亮 · {linkedVehicles(layer.vehicleHighlight, vehicles)?.length || 0} 辆</button>}<span>{result.status === 'error' ? result.error : result.status === 'loading' ? '正在加载车辆数据' : dates.length === 1 ? `GPS · ${dates[0]}` : dates.length ? 'GPS · 各车时间见详情' : '暂无车辆数据'}</span>{result.stale && <span>保留上次数据</span>}<span className="vehicle-mode" aria-live="polite">{layer.vehicleDetailed ? '车辆视图' : '点位概览 · 点击放大'}</span></div>;
}

export function VehicleWidget({ children, item, state, data, onNavigate }) {
  return <div className="vehicle-widget">{item.type === 'metric' ? cloneElement(children, { metricVisual: <div className="vehicle-metric-visual" aria-hidden="true"><Car weight="duotone"/></div> }) : children}{item.type === 'metric' && state.status === 'ready' && data.rows.length > 0 && <button className="vehicle-metric-link" onClick={() => onNavigate('vehicle:all')} aria-label={`显示全部车辆 · ${data.value} 辆`}>显示全部车辆<ArrowUpRight size={14}/></button>}</div>;
}
