import { Check, ArrowUpRight } from '@phosphor-icons/react';
import { Dialog } from './MapPanels';
import { THEMES, DEFAULT_THEME } from './themes';

export function ThemePanel({ theme, editing, onChange, onClose }) {
  return <Dialog title="切换配色" subtitle="COLOR PALETTES" onClose={onClose} wide>
    <p className="theme-intro">保留烟灰香槟，另选 7 套设计配色。点击即可查看整屏效果。</p>
    <fieldset className="theme-grid"><legend className="widget-sr-only">大屏配色</legend>{THEMES.map(item => <div className="theme-option" key={item.id}>
      <label className={`theme-card ${theme.id === item.id ? 'is-selected' : ''}`} style={{ '--swatch-bg': item.bg, '--swatch-text': item.text, '--swatch-accent': item.accent }}>
        <input type="radio" name="dashboard-theme" value={item.id} checked={theme.id === item.id} onChange={() => onChange(item.id)} aria-label={item.name}/>
        <span className="theme-swatches" aria-hidden="true">{[item.bg, item.panel, item.accent, item.secondary, item.text].map((color, i) => <i key={i} style={{ background: color }}/>)}</span>
        <span className="theme-card-title">{item.name}{item.id === DEFAULT_THEME.id && <small>默认</small>}{theme.id === item.id && <Check size={16} aria-label="已选"/>}</span>
        <span className="theme-description">{item.description}</span>
      </label>
      {item.url ? <a className="theme-source" href={item.url} target="_blank" rel="noreferrer">{item.source}<ArrowUpRight size={12}/></a> : <span className="theme-source">{item.source}</span>}
    </div>)}</fieldset>
    <div className="theme-footer"><p role="status">当前：{theme.name} · {editing ? '编辑草稿，保存画布后保留' : '自动保存在此浏览器'}</p><button onClick={() => onChange(DEFAULT_THEME.id)} disabled={theme.id === DEFAULT_THEME.id}>恢复默认配色</button></div>
  </Dialog>;
}
