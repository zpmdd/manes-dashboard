const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 100) / 100;
export function changeLayout(start, dx, dy, handle = 'move', grid = 0) {
  const snap = value => grid ? Math.round(value / grid) * grid : value;
  let { x, y, w, h } = start;
  if (handle === 'move') { x = clamp(snap(x + dx), 0, 100 - w); y = clamp(snap(y + dy), 0, 100 - h); }
  else {
    if (handle.includes('e')) w = clamp(snap(w + dx), 10, 100 - x);
    if (handle.includes('s')) h = clamp(snap(h + dy), 10, 100 - y);
    if (handle.includes('w')) { x = clamp(snap(x + dx), 0, start.x + w - 10); w = start.x + w - x; }
    if (handle.includes('n')) { y = clamp(snap(y + dy), 0, start.y + h - 10); h = start.y + h - y; }
  }
  w = round(w); h = round(h);
  return { x: round(clamp(x, 0, 100 - w)), y: round(clamp(y, 0, 100 - h)), w, h };
}
export const layoutStyle = layout => ({ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.w}%`, height: `${layout.h}%` });
export function editHistory(state, action) {
  if (action.type === 'reset') return { past: [], present: action.config, future: [] };
  if (action.type === 'undo') return state.past.length ? { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future] } : state;
  if (action.type === 'redo') return state.future.length ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state;
  const next = typeof action.config === 'function' ? action.config(state.present) : action.config;
  return next === state.present ? state : { past: [...state.past.slice(-49), state.present], present: next, future: [] };
}
