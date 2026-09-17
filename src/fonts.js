export const SYSTEM_FONT = 'Manrope, "PingFang SC", "Microsoft YaHei", sans-serif';
export const FONTS = [
  { id: 'misans', name: 'MiSans', face: 'MiSans', family: 'Manrope, MiSans, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'wenkai', name: '霞鹜文楷', face: 'LXGW WenKai GB Lite', family: 'Manrope, "LXGW WenKai GB Lite", "PingFang SC", "Microsoft YaHei", sans-serif' },
];
export const DEFAULT_FONT = FONTS[0];
export const getFont = id => FONTS.find(font => font.id === id) || DEFAULT_FONT;
