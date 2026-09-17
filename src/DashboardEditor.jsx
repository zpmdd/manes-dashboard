import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise, Check, Copy, Database, Eye, FloppyDisk, GridFour, Palette, SlidersHorizontal, SquaresFour, X } from '@phosphor-icons/react';
import { createModule, loadConfig, saveConfig } from './dashboardConfig.js';
import { arrangeLayouts, changeLayout, editHistory, layoutStyle, snapLayout } from './layout.js';
import './editor.css';

export function useDashboardEditor(notify, project) {
  const [saved, setSaved] = useState(() => loadConfig(project));
  const [history, dispatch] = useReducer(editHistory, { past: [], present: saved, future: [] });
  const [editing, setEditing] = useState(false), [preview, setPreview] = useState(false), [selectedIds, setSelectedIds] = useState([]);
  const [guides, setGuides] = useState([]);
  const config = editing ? history.present : saved;
  const items = [{ ...config.map, id: 'map' }, ...config.modules];
  const selection = selectedIds.filter(id => items.some(item => item.id === id)), selected = selection.at(-1) ?? null;
  const select = useCallback((id, options = {}) => setSelectedIds(current => {
    if (!id) return [];
    if (options.toggle) return current.includes(id) ? current.filter(entry => entry !== id) : [...current, id];
    if (options.preserve && current.includes(id)) return current;
    return [id];
  }), []);
  const change = useCallback(next => dispatch({ type: 'change', config: next }), []);
  const patchMany = useCallback(updates => change(current => {
    let changed = false;
    const apply = (item, id) => {
      const values = updates[id];
      if (!values || Object.entries(values).every(([key, value]) => item[key] === value || JSON.stringify(item[key]) === JSON.stringify(value))) return item;
      changed = true; return { ...item, ...values };
    };
    const map = apply(current.map, 'map'), modules = current.modules.map(item => apply(item, item.id));
    return changed ? { ...current, map, modules } : current;
  }), [change]);
  const patch = useCallback((id, values) => patchMany({ [id]: values }), [patchMany]);
  const align = (operation, reference = selection.length > 1 ? 'selection' : 'canvas') => {
    const next = arrangeLayouts(items, { ids: selection, operation, reference });
    patchMany(Object.fromEntries(next.filter((item, i) => item !== items[i]).map(item => [item.id, { layout: item.layout }])));
  };
  const start = () => { dispatch({ type: 'reset', config: saved }); setEditing(true); setPreview(false); select(null); };
  const setTheme = theme => {
    if (config.theme === theme) return;
    if (editing) { change(current => ({ ...current, theme })); return; }
    try { const next = saveConfig({ ...saved, theme }, project); setSaved(next); dispatch({ type: 'reset', config: next }); }
    catch (error) { notify(error.message); }
  };
  const finish = () => {
    try { const next = saveConfig(history.present, project); setSaved(next); dispatch({ type: 'reset', config: next }); setEditing(false); setPreview(false); setGuides([]); notify('画布已保存'); }
    catch (error) { notify(error.message); }
  };
  const cancel = () => {
    if (history.present !== saved && !window.confirm('放弃本次未保存的画布修改？')) return;
    setEditing(false); setPreview(false); select(null); setGuides([]);
  };
  const add = type => {
    if (type === 'map') { patch('map', { visible: true }); select('map'); return; }
    try { const item = createModule(type, config.modules); change({ ...config, modules: [...config.modules, item] }); select(item.id); }
    catch (error) { notify(error.message); }
  };
  const duplicate = () => {
    const selectedItems = config.modules.filter(item => selection.includes(item.id)); if (!selectedItems.length) return;
    try {
      const modules = [...config.modules], ids = [];
      for (const item of selectedItems) { const copy = createModule(item.type, modules); modules.push({ ...structuredClone(item), id: copy.id, locked: false, layout: changeLayout(item.layout, 2, 2) }); ids.push(copy.id); }
      change({ ...config, modules }); setSelectedIds(ids);
    } catch (error) { notify(error.message); }
  };
  const remove = () => {
    const removable = items.filter(item => selection.includes(item.id) && !item.locked).map(item => item.id);
    if (!removable.length) return;
    change({ ...config, map: removable.includes('map') ? { ...config.map, visible: false } : config.map, modules: config.modules.filter(item => !removable.includes(item.id)) });
    select(null);
  };
  const arrange = where => change(current => {
    const chosen = current.modules.filter(item => selection.includes(item.id)), others = current.modules.filter(item => !selection.includes(item.id));
    const modules = where === 'front' ? [...others, ...chosen] : [...chosen, ...others];
    return modules.every((item, i) => item === current.modules[i]) ? current : { ...current, modules };
  });
  const undo = useCallback(() => dispatch({ type: 'undo' }), []), redo = useCallback(() => dispatch({ type: 'redo' }), []);
  useEffect(() => {
    if (!editing) return;
    const unload = event => { if (history.present !== saved) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, [editing, history.present, saved]);
  useEffect(() => {
    if (!editing || preview) return;
    const key = event => {
      if (document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(items.filter(item => item.visible).map(item => item.id)); return; }
      if (event.key === 'Escape') { select(null); return; }
      if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); remove(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const step = event.shiftKey ? 5 : config.canvas.grid;
        const movable = items.filter(item => selection.includes(item.id) && item.visible && !item.locked); if (!movable.length) return;
        const bounds = { x: Math.min(...movable.map(item => item.layout.x)), y: Math.min(...movable.map(item => item.layout.y)), w: 0, h: 0 };
        bounds.w = Math.max(...movable.map(item => item.layout.x + item.layout.w)) - bounds.x; bounds.h = Math.max(...movable.map(item => item.layout.y + item.layout.h)) - bounds.y;
        const next = changeLayout(bounds, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
        patchMany(Object.fromEntries(movable.map(item => [item.id, { layout: { ...item.layout, x: item.layout.x + next.x - bounds.x, y: item.layout.y + next.y - bounds.y } }])));
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [editing, preview, selectedIds, config, patchMany, undo, redo]);
  return { config, items, editing, preview, selected, selectedIds: selection, select, guides, setGuides, start, finish, cancel, add, patch, patchMany, change, setTheme, duplicate, remove, arrange, align, undo, redo, setPreview, canUndo: Boolean(history.past.length), canRedo: Boolean(history.future.length), dirty: history.present !== saved };
}

export function EditorToolbar({ editor, onDialog }) {
  return <div className="editor-toolbar" role="toolbar" aria-label="画布编辑工具">
    <div className="editor-title"><SquaresFour size={22}/><strong>画布编辑器</strong><span>{editor.dirty ? '未保存' : '已保存'}</span></div>
    <div className="editor-tool-group"><button onClick={editor.undo} disabled={!editor.canUndo} aria-label="撤销"><ArrowCounterClockwise/></button><button onClick={editor.redo} disabled={!editor.canRedo} aria-label="重做"><ArrowClockwise/></button><label><input type="checkbox" checked={editor.config.canvas.snap} onChange={e => editor.change({ ...editor.config, canvas: { ...editor.config.canvas, snap: e.target.checked } })}/><GridFour/>网格</label><label title="对齐组件边缘和中心，按住 Alt 临时关闭吸附"><input type="checkbox" checked={editor.config.canvas.magnet} onChange={e => editor.change({ ...editor.config, canvas: { ...editor.config.canvas, magnet: e.target.checked } })}/>磁吸</label></div>
    <div className="editor-tool-group"><button onClick={() => onDialog('templates')}><Copy/><span>模板库</span></button><button onClick={() => onDialog('sources')}><Database/><span>数据源</span></button><button onClick={() => onDialog('theme')}><Palette/><span>切换配色</span></button><button onClick={() => onDialog('config')}><SlidersHorizontal/><span>全局设置</span></button></div>
    <div className="editor-tool-group editor-save-group"><button onClick={() => editor.setPreview(value => !value)} aria-pressed={editor.preview}><Eye/><span>{editor.preview ? '返回编辑' : '预览'}</span></button><button onClick={editor.cancel}><X/><span>取消</span></button><button className="editor-primary" onClick={editor.finish}><FloppyDisk/><span>保存画布</span></button></div>
  </div>;
}

export function CanvasItem({ id, title, item, editor, children, isMap = false, onLayoutPreview }) {
  const element = useRef(null), drag = useRef(null), frame = useRef(0);
  const editing = editor.editing && !editor.preview, selected = editor.selectedIds.includes(id);
  const paint = (state, cancelled = false) => {
    for (const member of state.members) {
      const layout = cancelled ? member.layout : state.handle === 'move' ? { ...member.layout, x: member.layout.x + state.next.x - state.start.x, y: member.layout.y + state.next.y - state.start.y } : state.next;
      if (member.node) Object.assign(member.node.style, layoutStyle(layout));
    }
    if (state.members.some(member => member.id === 'map') || isMap) onLayoutPreview?.();
  };
  const end = (cancelled = false) => {
    const state = drag.current; if (!state) return;
    cancelAnimationFrame(frame.current); drag.current = null;
    if (state.capture.hasPointerCapture?.(state.pointerId)) state.capture.releasePointerCapture(state.pointerId);
    paint(state, cancelled); editor.setGuides([]);
    if (!cancelled && JSON.stringify(state.next) !== JSON.stringify(state.start)) editor.patchMany(Object.fromEntries(state.members.map(member => [member.id, { layout: state.handle === 'move' ? { ...member.layout, x: member.layout.x + state.next.x - state.start.x, y: member.layout.y + state.next.y - state.start.y } : state.next }])));
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); }, []);
  const begin = (event, handle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) { editor.select(id, { toggle: true }); return; }
    editor.select(id, { preserve: handle === 'move' }); if (item.locked || !item.visible) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    const parent = element.current.parentElement;
    const ids = handle === 'move' && selected ? editor.selectedIds : [id];
    const members = editor.items.filter(entry => ids.includes(entry.id) && entry.visible && !entry.locked).map(entry => ({ ...entry, node: entry.id === id ? element.current : parent.querySelector(`[data-canvas-id="${entry.id}"]`) }));
    const start = handle === 'move' ? { x: Math.min(...members.map(entry => entry.layout.x)), y: Math.min(...members.map(entry => entry.layout.y)), w: 0, h: 0 } : item.layout;
    if (handle === 'move') { start.w = Math.max(...members.map(entry => entry.layout.x + entry.layout.w)) - start.x; start.h = Math.max(...members.map(entry => entry.layout.y + entry.layout.h)) - start.y; }
    drag.current = { x: event.clientX, y: event.clientY, bounds: parent.getBoundingClientRect(), start, next: start, members, guides: [], handle, capture: event.currentTarget, pointerId: event.pointerId };
  };
  const move = event => {
    const state = drag.current; if (!state) return;
    const dx = (event.clientX - state.x) / state.bounds.width * 100, dy = (event.clientY - state.y) / state.bounds.height * 100;
    const result = snapLayout(state.start, dx, dy, { handle: state.handle, id, excludedIds: state.members.map(member => member.id), items: editor.items, width: state.bounds.width, height: state.bounds.height, grid: !event.altKey && editor.config.canvas.snap ? editor.config.canvas.grid : 0, threshold: !event.altKey && editor.config.canvas.magnet ? editor.config.canvas.threshold : 0, previousGuides: !event.altKey && editor.config.canvas.magnet ? state.guides : [] });
    state.next = result.layout; state.guides = !event.altKey && editor.config.canvas.magnet ? result.guides : [];
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => { paint(state); editor.setGuides(state.guides); });
  };
  const handlers = handle => ({
    onPointerDown: e => begin(e, handle), onPointerMove: move, onPointerUp: () => end(), onPointerCancel: () => end(true), onLostPointerCapture: () => end(true),
    onKeyDown: event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); end(true); } },
  });
  if (!item.visible && !editing) return null;
  return <div ref={element} className={`canvas-item ${isMap ? 'canvas-item-map' : ''} ${editing ? 'is-editable' : ''} ${selected && editing ? 'is-selected' : ''} ${!item.visible ? 'is-hidden-item' : ''}`} style={layoutStyle(item.layout)} data-canvas-id={id} onPointerDown={editing ? event => { event.stopPropagation(); editor.select(id, { toggle: event.shiftKey || event.metaKey || event.ctrlKey }); } : undefined}>
    {children}
    {editing && <><button className="canvas-drag-handle" aria-label={`移动${title}`} {...handlers('move')}>{item.locked ? '已锁定 · ' : ''}{!item.visible ? '已隐藏 · ' : ''}{title}</button>{selected && editor.selectedIds.length === 1 && !item.locked && ['nw','n','ne','e','se','s','sw','w'].map(handle => <button key={handle} className={`canvas-resize canvas-resize-${handle}`} aria-label={`缩放${title} ${handle}`} {...handlers(handle)}/>)}</>}
  </div>;
}
