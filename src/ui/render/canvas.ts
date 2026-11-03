/**
 * Canvas 装配：负责 DPR 缩放与 CSS 尺寸同步。
 * 所有绘制坐标使用 CSS 像素，由 setTransform 统一放大。
 */
export class CanvasSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  cssWidth = 0;
  cssHeight = 0;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** 同步 CSS 尺寸与像素尺寸；尺寸变化返回 true。 */
  syncSize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    const changed =
      pixelWidth !== this.canvas.width ||
      pixelHeight !== this.canvas.height ||
      dpr !== this.dpr;

    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.dpr = dpr;

    if (changed) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    return changed;
  }

  /** 每帧开始：重置变换、清屏。 */
  beginFrame(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}
