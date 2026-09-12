const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 100) / 100;
export function changeLayout(start, dx, dy, handle = 'move', grid = 0) {
  const snap = value => grid ? Math.round(value / grid) * grid : value;
  let { x, y, w, h } = start;
  if (handle === 'move') { x = clamp(round(snap(x + dx)), 0, 100 - w); y = clamp(round(snap(y + dy)), 0, 100 - h); }
  else {
    if (handle.includes('e')) w = clamp(round(snap(w + dx)), 10, 100 - x);
    if (handle.includes('s')) h = clamp(round(snap(h + dy)), 10, 100 - y);
    if (handle.includes('w')) { x = clamp(round(snap(x + dx)), 0, start.x + w - 10); w = start.x + w - x; }
    if (handle.includes('n')) { y = clamp(round(snap(y + dy)), 0, start.y + h - 10); h = start.y + h - y; }
  }
  return { x, y, w, h };
}
export const layoutStyle = layout => ({ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.w}%`, height: `${layout.h}%` });

const EPSILON = 1e-8;
const sameLayout = (a, b) => ['x', 'y', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) < EPSILON);
const validLayout = value => [value.x, value.y, value.w, value.h].every(Number.isFinite) && value.x >= -EPSILON && value.y >= -EPSILON && value.w >= 10 - EPSILON && value.h >= 10 - EPSILON && value.x + value.w <= 100 + EPSILON && value.y + value.h <= 100 + EPSILON;

// Layouts and deltas use percentages; the attraction radius and hysteresis use CSS pixels.
export function snapLayout(start, dx, dy, { handle = 'move', grid = 0, id, items = [], excludedIds = [], width, height, threshold = 6, previousGuides = [] } = {}) {
  let layout = changeLayout(start, dx, dy, handle, grid);
  const tolerance = Number.isFinite(threshold) ? Math.max(0, threshold) : 6;
  if (tolerance === 0) return { layout, guides: [] };
  const raw = changeLayout(start, dx, dy, handle);
  const excluded = new Set([id, ...excludedIds]);
  const references = [{ id: null, kind: 'canvas', layout: { x: 0, y: 0, w: 100, h: 100 } }, ...items.filter(item => !excluded.has(item.id) && item.visible !== false).map(item => ({ ...item, kind: 'component' }))];
  const matches = [];
  for (const axis of ['x', 'y']) {
    const horizontal = axis === 'x', size = horizontal ? 'w' : 'h', pixels = horizontal ? width : height;
    const near = horizontal ? 'w' : 'n', far = horizontal ? 'e' : 's';
    if (!Number.isFinite(pixels) || pixels <= 0 || (handle !== 'move' && !handle.includes(near) && !handle.includes(far))) continue;
    const ownAnchors = handle === 'move' ? [0, .5, 1] : [handle.includes(near) ? 0 : 1];
    const candidates = [];
    for (const reference of references) for (const factor of [0, .5, 1]) for (const ownFactor of ownAnchors) {
      const position = reference.layout[axis] + reference.layout[size] * factor;
      const distance = Math.abs(position - raw[axis] - raw[size] * ownFactor) * pixels / 100;
      if (distance > tolerance + 1 + EPSILON) continue;
      const next = { ...layout };
      if (handle === 'move') next[axis] = position - next[size] * ownFactor;
      else if (handle.includes(near)) { next[axis] = position; next[size] = start[axis] + start[size] - position; }
      else next[size] = position - start[axis];
      if (!validLayout(next)) continue;
      if (handle === 'move') next[axis] = clamp(next[axis], 0, 100 - next[size]);
      else if (handle.includes(near)) {
        // A decimal anchor can subtract to 9.999999999999996; keep the opposite edge fixed.
        next[size] = Math.max(10, next[size]);
        next[axis] = start[axis] + start[size] - next[size];
      } else next[size] = clamp(next[size], 10, 100 - start[axis]);
      candidates.push({ axis, position, distance, layout: next, reference, ownFactor });
    }
    candidates.sort((a, b) => a.distance - b.distance || Number(a.reference.kind === 'component') - Number(b.reference.kind === 'component') || a.position - b.position || String(a.reference.id).localeCompare(String(b.reference.id), 'en') || a.ownFactor - b.ownFactor);
    const nearest = candidates.find(candidate => candidate.distance <= tolerance + EPSILON);
    const previous = candidates.find(candidate => previousGuides.some(guide => guide.axis === axis && guide.kind === candidate.reference.kind && guide.sourceId === candidate.reference.id && Math.abs(guide.position - candidate.position) < EPSILON));
    const chosen = previous && (!nearest || previous.distance <= nearest.distance + 1 + EPSILON) ? previous : nearest;
    if (chosen) { layout = chosen.layout; matches.push(chosen); }
  }
  const guides = matches.map(({ axis, position, reference }) => {
    const other = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'h' : 'w';
    return { axis, position, from: Math.min(layout[other], reference.layout[other]), to: Math.max(layout[other] + layout[size], reference.layout[other] + reference.layout[size]), kind: reference.kind, sourceId: reference.id };
  });
  return { layout, guides };
}

export function arrangeLayouts(items, { operation, ids = items.map(item => item.id), reference = 'selection' } = {}) {
  const selected = [...new Set(ids)].map(id => items.find(item => item.id === id)).filter(item => item && item.visible !== false);
  if (!selected.length) return items;
  const updates = new Map();
  if (['distribute-x', 'distribute-y'].includes(operation)) {
    const axis = operation === 'distribute-x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
    const sorted = [...selected].sort((a, b) => a.layout[axis] - b.layout[axis] || String(a.id).localeCompare(String(b.id), 'en'));
    const anchors = sorted.map((item, index) => index === 0 || index === sorted.length - 1 || item.locked ? index : -1).filter(index => index >= 0);
    for (let i = 1; i < anchors.length; i++) {
      const first = anchors[i - 1], last = anchors[i];
      if (last - first < 2) continue;
      const segment = sorted.slice(first, last + 1);
      const total = segment.reduce((sum, item) => sum + item.layout[size], 0);
      const gap = (segment.at(-1).layout[axis] + segment.at(-1).layout[size] - segment[0].layout[axis] - total) / (segment.length - 1);
      let position = segment[0].layout[axis] + segment[0].layout[size] + gap;
      const proposed = segment.slice(1, -1).map(item => { const next = { ...item.layout, [axis]: position }; position += item.layout[size] + gap; return [item.id, next]; });
      // Fixed anchors can make an overlapping segment impossible to distribute inside the canvas.
      if (proposed.every(([, next]) => validLayout(next))) proposed.forEach(([id, next]) => updates.set(id, next));
    }
  } else if (['same-width', 'same-height'].includes(operation)) {
    const size = operation === 'same-width' ? 'w' : 'h', axis = size === 'w' ? 'x' : 'y', length = selected[0].layout[size];
    for (const item of selected) if (!item.locked) updates.set(item.id, { ...item.layout, [size]: length, [axis]: clamp(item.layout[axis], 0, 100 - length) });
  } else {
    const choices = { left: ['x', 'w', 0], 'center-x': ['x', 'w', .5], right: ['x', 'w', 1], top: ['y', 'h', 0], 'center-y': ['y', 'h', .5], bottom: ['y', 'h', 1] };
    if (!Object.hasOwn(choices, operation)) throw new Error('不支持的排列操作');
    const [axis, size, factor] = choices[operation];
    const low = reference === 'canvas' ? 0 : Math.min(...selected.map(item => item.layout[axis]));
    const high = reference === 'canvas' ? 100 : Math.max(...selected.map(item => item.layout[axis] + item.layout[size]));
    const position = low + (high - low) * factor;
    for (const item of selected) if (!item.locked) updates.set(item.id, { ...item.layout, [axis]: clamp(position - item.layout[size] * factor, 0, 100 - item.layout[size]) });
  }
  let changed = false;
  const result = items.map(item => {
    const next = updates.get(item.id);
    if (!next || sameLayout(item.layout, next)) return item;
    changed = true; return { ...item, layout: next };
  });
  return changed ? result : items;
}

export function editHistory(state, action) {
  if (action.type === 'reset') return { past: [], present: action.config, future: [] };
  if (action.type === 'undo') return state.past.length ? { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future] } : state;
  if (action.type === 'redo') return state.future.length ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state;
  const next = typeof action.config === 'function' ? action.config(state.present) : action.config;
  return next === state.present ? state : { past: [...state.past.slice(-49), state.present], present: next, future: [] };
}
