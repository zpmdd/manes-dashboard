import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise, Check, Copy, Database, Eye, FloppyDisk, GridFour, SlidersHorizontal, SquaresFour, X } from '@phosphor-icons/react';
import { createModule, loadConfig, saveConfig } from './dashboardConfig.js';
import { changeLayout, editHistory, layoutStyle } from './layout.js';
import './editor.css';

export function useDashboardEditor(notify) {
  const [saved, setSaved] = useState(loadConfig);
  const [history, dispatch] = useReducer(editHistory, { past: [], present: saved, future: [] });
  const [editing, setEditing] = useState(false), [preview, setPreview] = useState(false), [selected, select] = useState(null);
  const config = editing ? history.present : saved;
  const change = useCallback(next => dispatch({ type: 'change', config: next }), []);
  const patch = useCallback((id, values) => change(current => id === 'map' ? { ...current, map: { ...current.map, ...values } } : { ...current, modules: current.modules.map(item => item.id === id ? { ...item, ...values } : item) }), [change]);
  const start = () => { dispatch({ type: 'reset', config: saved }); setEditing(true); setPreview(false); select(null); };
  const finish = () => {
    try { const next = saveConfig(history.present); setSaved(next); dispatch({ type: 'reset', config: next }); setEditing(false); setPreview(false); notify('画布已保存'); }
    catch (error) { notify(error.message); }
  };
  const cancel = () => {
    if (history.present !== saved && !window.confirm('放弃本次未保存的画布修改？')) return;
    setEditing(false); setPreview(false); select(null);
  };
  const add = type => {
    if (type === 'map') { patch('map', { visible: true }); select('map'); return; }
    try { const item = createModule(type, config.modules); change({ ...config, modules: [...config.modules, item] }); select(item.id); }
    catch (error) { notify(error.message); }
  };
  const duplicate = () => {
    const item = config.modules.find(entry => entry.id === selected); if (!item) return;
    try { const newItem = createModule(item.type, config.modules); change({ ...config, modules: [...config.modules, { ...structuredClone(item), id: newItem.id, layout: changeLayout(item.layout, 2, 2) }] }); select(newItem.id); }
    catch (error) { notify(error.message); }
  };
  const remove = () => { if (selected === 'map') patch('map', { visible: false }); else change({ ...config, modules: config.modules.filter(item => item.id !== selected) }); select(null); };
  const arrange = where => change(current => { const item = current.modules.find(entry => entry.id === selected); const others = current.modules.filter(entry => entry.id !== selected); return item ? { ...current, modules: where === 'front' ? [...others, item] : [item, ...others] } : current; });
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
      if (event.key === 'Escape') { select(null); return; }
      const item = selected === 'map' ? config.map : config.modules.find(entry => entry.id === selected);
      if (!item || item.locked) return;
      if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); remove(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const step = event.shiftKey ? 5 : config.canvas.grid;
        patch(selected, { layout: changeLayout(item.layout, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) });
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [editing, preview, selected, config, patch, undo, redo]);
  return { config, editing, preview, selected, select, start, finish, cancel, add, patch, change, duplicate, remove, arrange, undo, redo, setPreview, canUndo: Boolean(history.past.length), canRedo: Boolean(history.future.length), dirty: history.present !== saved };
}

export function EditorToolbar({ editor, onDialog }) {
  return <div className="editor-toolbar" role="toolbar" aria-label="画布编辑工具">
    <div className="editor-title"><SquaresFour size={22}/><strong>画布编辑器</strong><span>{editor.dirty ? '未保存' : '已保存'}</span></div>
    <div className="editor-tool-group"><button onClick={editor.undo} disabled={!editor.canUndo} aria-label="撤销"><ArrowCounterClockwise/></button><button onClick={editor.redo} disabled={!editor.canRedo} aria-label="重做"><ArrowClockwise/></button><label><input type="checkbox" checked={editor.config.canvas.snap} onChange={e => editor.change({ ...editor.config, canvas: { ...editor.config.canvas, snap: e.target.checked } })}/><GridFour/>网格吸附</label></div>
    <div className="editor-tool-group"><button onClick={() => onDialog('templates')}><Copy/><span>模板库</span></button><button onClick={() => onDialog('sources')}><Database/><span>数据源</span></button><button onClick={() => onDialog('config')}><SlidersHorizontal/><span>全局设置</span></button></div>
    <div className="editor-tool-group editor-save-group"><button onClick={() => editor.setPreview(value => !value)} aria-pressed={editor.preview}><Eye/><span>{editor.preview ? '返回编辑' : '预览'}</span></button><button onClick={editor.cancel}><X/><span>取消</span></button><button className="editor-primary" onClick={editor.finish}><FloppyDisk/><span>保存画布</span></button></div>
  </div>;
}

export function CanvasItem({ id, title, item, editor, children, isMap = false, onLayoutPreview }) {
  const element = useRef(null), drag = useRef(null), frame = useRef(0);
  const editing = editor.editing && !editor.preview, selected = editor.selected === id;
  const paint = layout => {
    if (!element.current) return;
    Object.assign(element.current.style, layoutStyle(layout));
    if (isMap) onLayoutPreview?.();
  };
  const end = (cancelled = false) => {
    const state = drag.current; if (!state) return;
    cancelAnimationFrame(frame.current); drag.current = null;
    if (state.capture.hasPointerCapture?.(state.pointerId)) state.capture.releasePointerCapture(state.pointerId);
    paint(cancelled ? item.layout : state.next);
    if (!cancelled && JSON.stringify(state.next) !== JSON.stringify(item.layout)) editor.patch(id, { layout: state.next });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const begin = (event, handle) => {
    if (event.button !== 0) return;
    event.stopPropagation(); editor.select(id); if (item.locked) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, bounds: element.current.parentElement.getBoundingClientRect(), start: item.layout, next: item.layout, handle, capture: event.currentTarget, pointerId: event.pointerId };
  };
  const move = event => {
    const state = drag.current; if (!state) return;
    state.next = changeLayout(state.start, (event.clientX - state.x) / state.bounds.width * 100, (event.clientY - state.y) / state.bounds.height * 100, state.handle, editor.config.canvas.snap ? editor.config.canvas.grid : 0);
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => paint(state.next));
  };
  const handlers = handle => ({
    onPointerDown: e => begin(e, handle), onPointerMove: move, onPointerUp: () => end(), onPointerCancel: () => end(true), onLostPointerCapture: () => end(true),
    onKeyDown: event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); end(true); } },
  });
  if (!item.visible && !editing) return null;
  return <div ref={element} className={`canvas-item ${isMap ? 'canvas-item-map' : ''} ${editing ? 'is-editable' : ''} ${selected && editing ? 'is-selected' : ''} ${!item.visible ? 'is-hidden-item' : ''}`} style={layoutStyle(item.layout)} data-canvas-id={id} onPointerDown={editing ? event => { event.stopPropagation(); editor.select(id); } : undefined}>
    {children}
    {editing && <><button className="canvas-drag-handle" aria-label={`移动${title}`} {...handlers('move')} onFocus={() => editor.select(id)}>{item.locked ? '已锁定 · ' : ''}{!item.visible ? '已隐藏 · ' : ''}{title}</button>{selected && !item.locked && ['nw','n','ne','e','se','s','sw','w'].map(handle => <button key={handle} className={`canvas-resize canvas-resize-${handle}`} aria-label={`缩放${title} ${handle}`} {...handlers(handle)}/>)}</>}
  </div>;
}
