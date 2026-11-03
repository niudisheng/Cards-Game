/** Canvas 使用的颜色令牌，与 CSS 变量保持同一套色板。 */
export const PALETTE = {
  bgTop: '#0b101a',
  bgBottom: '#060910',
  text: '#e8edf7',
  muted: '#8b97ad',
  faint: 'rgba(232, 237, 247, 0.28)',
  laneFill: 'rgba(255, 255, 255, 0.022)',
  laneStroke: 'rgba(255, 255, 255, 0.06)',
  cellFill: 'rgba(255, 255, 255, 0.018)',
  cellStroke: 'rgba(255, 255, 255, 0.07)',
  left: '#5b8def',
  right: '#ff6b9a',
  ok: '#4fd1c5',
  danger: '#ff6b6b',
} as const;

export const FONT_STACK =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}
