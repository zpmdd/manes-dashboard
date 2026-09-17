// Source colors are adapted for translucent panels and illuminated 3D surfaces.
export const DEFAULT_THEME = {
  id: 'champagne', name: '烟灰香槟', description: '当前原始配色', source: '项目默认', url: '',
  bg: '#6f6f75', panel: '#302b32', text: '#f3efe5', muted: '#e0d8ca', accent: '#eee2b9', secondary: '#aebcb4',
  colors: ['#eee2b9', '#aebcb4', '#c6a9a5', '#9aa7b9', '#b7afc5', '#c6bf9f', '#8faca6', '#b49b87'],
  donut: ['#f1e8c5', '#cbc8b0', '#afaeb0', '#938a97', '#726d7c', '#d2bda1', '#bfa7a8', '#b3bec1', '#9aab9c', '#848978'],
  map: { ground: '#57565f', land: '#aaa6a0', focused: '#b6a077', context: '#464449', edge: '#8f8578', contextEdge: '#bfb6a7', side: '#6b6667', active: '#e0d3a8', activeSide: '#ac9771', label: '#3c3331', light: '#fff1d4', sky: '#fffaea', ambient: '#55515a', glow: '#ffe0b0', glow2: '#f8e1c4', environment: '#fff7e7' },
};

function mix(a, b, amount) {
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
}

const presets = [
  { id: 'nord', name: '北境冰蓝', description: '冷灰 · 冰蓝 · 极光', source: 'Nord', url: 'https://www.nordtheme.com/docs/colors-and-palettes/', bg: '#2e3440', panel: '#3b4252', text: '#eceff4', muted: '#d8dee9', accent: '#88c0d0', secondary: '#a3be8c', colors: ['#88c0d0', '#a3be8c', '#ebcb8b', '#b48ead', '#81a1c1', '#d08770', '#8fbcbb', '#bf8f98'] },
  { id: 'ocean', name: '深海青碧', description: '深蓝灰 · 青碧 · 雾白', source: 'Color Hunt', url: 'https://colorhunt.co/palette/222831393e4600adb5eeeeee', bg: '#222831', panel: '#29343d', text: '#eeeeee', muted: '#c0d3d9', accent: '#66d9df', secondary: '#aac9ee', colors: ['#66d9df', '#aac9ee', '#e9d397', '#cab7ed', '#9ad6bc', '#eaaea6', '#bacad4', '#cfbed2'] },
  { id: 'forest', name: '森林琥珀', description: '墨绿 · 琥珀 · 鼠尾草', source: 'Happy Hues · 10', url: 'https://www.happyhues.co/palettes/10', bg: '#004643', panel: '#123b38', text: '#fffffe', muted: '#abd1c6', accent: '#f9bc60', secondary: '#abd1c6', colors: ['#f9bc60', '#abd1c6', '#e8b5b5', '#9eced8', '#d3c99c', '#bcb1df', '#99d5ad', '#e2c7a7'] },
  { id: 'iris', name: '午夜鸢尾', description: '炭黑 · 鸢尾紫 · 薄荷', source: 'Happy Hues · 4', url: 'https://www.happyhues.co/palettes/4', bg: '#16161a', panel: '#242629', text: '#fffffe', muted: '#b7c1d0', accent: '#b59aff', secondary: '#79dcb4', colors: ['#b59aff', '#79dcb4', '#e7c685', '#8dcde1', '#e2a7c7', '#c7cddd', '#e8b497', '#a6bedf'] },
  { id: 'rose', name: '靛蓝玫瑰', description: '靛蓝 · 玫瑰粉 · 长春花', source: 'Happy Hues · 12', url: 'https://www.happyhues.co/palettes/12', bg: '#232946', panel: '#2c3352', text: '#fffffe', muted: '#b8c1ec', accent: '#eebbc3', secondary: '#b8c1ec', colors: ['#eebbc3', '#b8c1ec', '#a5d7cd', '#e5d79e', '#c6abe6', '#96cde0', '#d8c4b2', '#e2a5aa'] },
  { id: 'sand', name: '岩棕砂金', description: '岩灰 · 暖棕 · 亚麻', source: 'Color Hunt', url: 'https://colorhunt.co/palette/2c36393f4e4fa27b5cdcd7c9', bg: '#2c3639', panel: '#303d3e', text: '#f3eee4', muted: '#dcd7c9', accent: '#d4ac87', secondary: '#b3c9b9', colors: ['#d4ac87', '#b3c9b9', '#dcd7c9', '#a8bfd0', '#c9b1c8', '#d6c48f', '#8fc8c5', '#d6ada5'] },
  { id: 'coral', name: '暮夜珊瑚', description: '夜蓝 · 珊瑚 · 灰玫瑰', source: 'Color Hunt', url: 'https://colorhunt.co/palette/2b2e4ae8454590374953354a', bg: '#2b2e4a', panel: '#35304a', text: '#fff1ee', muted: '#d7c9d8', accent: '#ffaaa3', secondary: '#b9bce8', colors: ['#ffaaa3', '#b9bce8', '#e8cf9e', '#9bd3cc', '#d9a7c4', '#a5c8e2', '#d9c7be', '#bccd9d'] },
];

export const THEMES = [DEFAULT_THEME, ...presets.map(theme => ({ ...theme, donut: theme.colors,
  map: { ground: mix(theme.bg, theme.panel, .4), land: mix(theme.muted, theme.secondary, .25), focused: mix(theme.accent, theme.muted, .3), context: mix(theme.bg, theme.muted, .2), edge: mix(theme.bg, theme.muted, .35), contextEdge: theme.muted, side: mix(theme.bg, theme.secondary, .25), active: mix(theme.accent, '#ffffff', .25), activeSide: mix(theme.bg, theme.accent, .5), label: theme.bg, light: '#f5f7ff', sky: '#f5f7ff', ambient: theme.panel, glow: theme.accent, glow2: theme.secondary, environment: '#f5f7ff' },
}))];

export const getTheme = id => THEMES.find(theme => theme.id === id) || DEFAULT_THEME;
export const themeVariables = theme => ({ ...Object.fromEntries(['bg', 'panel', 'text', 'muted', 'accent', 'secondary'].map(key => [`--theme-${key}`, theme[key]])), '--theme-map-label': theme.map.label, '--theme-map-halo': theme.muted });
