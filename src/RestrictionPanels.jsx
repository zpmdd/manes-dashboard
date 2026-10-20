import { useRef } from 'react';
import { ArrowCounterClockwise, ArrowUpRight, Check, DownloadSimple, MapPin, PencilSimple, ShieldWarning, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { Dialog } from './MapPanels';

const coordinate = value => Number(value).toFixed(6);

export function RestrictionSummary({ restriction, membership, trajectory, onDetails, onFocus, onSettings, onImport, onExport, busy = '' }) {
  const inside = membership.filter(item => item.inside);
  const input = useRef(null);
  return <section className="restriction-summary widget-surface-glass" aria-label={`${restriction.name}限行判定`}>
    <header><span><ShieldWarning size={16}/>限行区域</span><b>按 GPS 时间判定</b></header>
    <strong>{restriction.name}</strong>
    <p>{restriction.schedule} · {restriction.targets}</p>
    <div><span>范围内 <b>{inside.length}</b> 辆</span><span>范围外 <b>{membership.length - inside.length}</b> 辆</span></div>
    <p>当前窗命中 {membership.filter(item => item.matched).length} 辆 · 信息不足 {membership.filter(item => item.status === '信息不足').length} 辆</p>
    <p>本批次连续命中 {trajectory ? `${trajectory.events.length} 段` : '计算中…'}</p>
    <div className="restriction-data-actions"><button disabled={Boolean(busy)} onClick={() => input.current?.click()}><UploadSimple size={14}/>{busy === 'import' ? '导入中…' : '导入数据'}</button><button disabled={Boolean(busy) || !membership.length} onClick={onExport}><DownloadSimple size={14}/>{busy === 'export' ? '导出中…' : '导出 Excel'}</button></div>
    <input ref={input} type="file" accept=".json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onImport(file); }}/>
    <footer><button onClick={onFocus}><MapPin size={14}/>定位范围</button><button onClick={onSettings}><PencilSimple size={14}/>设置区域</button><button onClick={onDetails}>坐标与规则<ArrowUpRight size={13}/></button></footer>
  </section>;
}

export function RestrictionEditor({ draft, drawing, onChange, onBegin, onUndo, onFinish, onSave, onCancel }) {
  const update = event => onChange({ ...draft, [event.target.name]: event.target.value });
  const updatePoint = (index, axis, value) => {
    const boundary = draft.boundary.map((point, pointIndex) => pointIndex === index ? point.map((coordinate, coordinateIndex) => coordinateIndex === axis ? value : coordinate) : point);
    onChange({ ...draft, boundary });
  };
  return <aside className={`restriction-editor widget-surface-glass${drawing ? ' is-drawing-mode' : ''}`} aria-label="限行区域设置">
    <header><div><PencilSimple size={16}/><span>限行区域设置</span></div><button aria-label="关闭限行区域设置" onClick={onCancel}><X/></button></header>
    <label>区域名称<input name="name" value={draft.name} onChange={update}/></label>
    <div className="restriction-editor-times"><label>开始时间<input type="time" name="start" value={draft.start} onChange={update}/></label><label>结束时间<input type="time" name="end" value={draft.end} onChange={update}/></label></div>
    <label>受限车型<input name="vehicleTypes" value={draft.vehicleTypes} onChange={update} placeholder="危化品运输车、重型货车"/></label>
    <label>受限货种<input name="cargoTypes" value={draft.cargoTypes} onChange={update} placeholder="危险货物、易燃液体"/></label>
    <section className={drawing ? 'is-drawing' : ''}>
      <div><strong>{drawing ? '正在绘制边界' : '边界多边形'}</strong><span>{draft.boundary.length} 个顶点</span></div>
      <p>{drawing ? '在地图上依次点击顶点，系统按真实经纬度记录并实时闭合预览。' : '可保留当前边界，或点击重绘后在地图上逐点设置。'}</p>
      {draft.boundary.length > 0 && <div className="restriction-point-list" aria-label="限行边界顶点坐标">
        {draft.boundary.map(([lon, lat], index) => <div className="restriction-point-row" key={index}>
          <span>P{index + 1}</span>
          <label>经度<input aria-label={`P${index + 1} 经度`} type="number" step="0.000001" value={lon} onChange={event => updatePoint(index, 0, event.target.value)}/></label>
          <label>纬度<input aria-label={`P${index + 1} 纬度`} type="number" step="0.000001" value={lat} onChange={event => updatePoint(index, 1, event.target.value)}/></label>
        </div>)}
      </div>}
      <div className="restriction-draw-actions">
        {!drawing ? <button onClick={onBegin}><ArrowCounterClockwise/>重绘范围</button> : <><button disabled={!draft.boundary.length} onClick={onUndo}><Trash/>撤销顶点</button><button disabled={draft.boundary.length < 3} onClick={onFinish}><Check/>完成绘制</button></>}
      </div>
    </section>
    <footer><button onClick={onCancel}>取消</button><button className="is-primary" disabled={drawing || draft.boundary.length < 3} onClick={onSave}><Check/>保存设置</button></footer>
  </aside>;
}

export function RestrictionDetails({ restriction, membership, trajectory, onFocus, onClose }) {
  return <Dialog title="限行区域详情" subtitle="RESTRICTION AREA" onClose={onClose} wide>
    <div className="restriction-details">
      <section className="restriction-rule-card"><h3>{restriction.name}</h3><dl>
        <div><dt>限行类型</dt><dd>{restriction.type}</dd></div><div><dt>数据类型</dt><dd>{restriction.dataType}</dd></div>
        <div><dt>限行时段</dt><dd>{restriction.schedule}</dd></div><div><dt>限行对象</dt><dd>{restriction.targets}</dd></div>
        <div><dt>坐标系</dt><dd>{restriction.coordinateSystem}</dd></div>
      </dl><p>区域限行使用边界多边形顶点坐标，按车辆 GPS 判断空间、时段和车型/货种。连续事件使用完整已载入批次，至少 3 个不同时刻的命中点，相邻间隔不超过 5 分钟；观测末点不等于实际驶离时间。</p><button className="restriction-focus" onClick={onFocus}><MapPin size={15}/>在地图中定位限行范围</button></section>
      <section><h3>车辆坐标 <small>{membership.filter(item => item.inside).length} 辆范围内 · {membership.filter(item => !item.inside).length} 辆范围外</small></h3><div className="restriction-table-scroll"><table><thead><tr><th>车辆</th><th>经度</th><th>纬度</th><th>空间</th><th>规则判定</th></tr></thead><tbody>{membership.map(({ vehicle, inside, status }) => <tr key={vehicle.VEHICLE_KEY || vehicle.VEHICLENO}><td>车辆 {vehicle.VEHICLENO}</td><td>{coordinate(vehicle.GEO_LON)}</td><td>{coordinate(vehicle.GEO_LAT)}</td><td><span className={inside ? 'is-inside' : 'is-outside'}>{inside ? '范围内' : '范围外'}</span></td><td>{status}</td></tr>)}</tbody></table></div></section>
      <section><h3>本批次连续命中 <small>{trajectory?.events.length ?? 0} 段</small></h3><p>无连续轨迹时不生成事件；同车同一时刻的重复点只算一次。无效或冲突记录 {trajectory?.rejected.length ?? 0} 条。</p>{trajectory?.events.length > 0 && <div className="restriction-table-scroll"><table><thead><tr><th>车辆</th><th>开始</th><th>最后命中点</th><th>点数</th></tr></thead><tbody>{trajectory.events.map((event, index) => <tr key={index}><td>{event.vehicleNo}</td><td>{new Date(event.entryTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td><td>{new Date(event.exitTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td><td>{event.pointCount}</td></tr>)}</tbody></table></div>}</section>
      <section className="restriction-boundary"><h3>限行范围坐标 <small>边界多边形顶点序列</small></h3><ol>{restriction.boundary.map(([lon, lat], index) => <li key={`${lon}-${lat}`}><span>P{index + 1}</span><code>{coordinate(lon)}, {coordinate(lat)}</code></li>)}</ol></section>
    </div>
  </Dialog>;
}
