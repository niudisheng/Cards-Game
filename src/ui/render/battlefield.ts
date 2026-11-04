import { laneName } from '@/core/grid';
import { LANES, ROWS, type CardId, type Lane, type Row } from '@/core/types';
import { getCard } from '@/data/cards';
import { getEnemy } from '@/data/enemies';
import type { Effect, Enemy, Floater, FloaterTone, Unit } from '@/sim/entities';
import type { BattleState } from '@/sim/state';
import { roundedRect, type CanvasSurface } from './canvas';
import { PALETTE, font } from './theme';

const PAD = 10;
const LANE_GAP = 10;
const HEADER_H = 20;
const GATE_H = 46;
const GATE_GAP = 18;
const CORE_H = 52;
const CORE_GAP = 10;
const ROW_GAP = 8;

const ROW_LABEL: Record<Row, string> = {
  0: '前排 · 先接敌',
  1: '中排',
  2: '后排 · 护核心',
};

const ROW_LABEL_SHORT: Record<Row, string> = {
  0: '前排',
  1: '中排',
  2: '后排',
};

const LANE_ACCENT: Record<Lane, string> = {
  0: PALETTE.left,
  1: PALETTE.right,
};

export interface LaneLayout {
  lane: Lane;
  x: number;
  width: number;
  centerX: number;
  gateTop: number;
  gateBottom: number;
  rowsTop: number;
  rowsBottom: number;
  rowHeight: number;
  rowStep: number;
  coreTop: number;
  /** 每一排的上沿 y。 */
  rowY: readonly number[];
}

export interface BattleLayout {
  width: number;
  height: number;
  lanes: readonly [LaneLayout, LaneLayout];
}

export interface BattlefieldView {
  /** 当前选中的手牌；用于高亮合法目标格。 */
  selectedCardId?: CardId;
}

/** 把 #rrggbb 转成带透明度的 rgba，便于给两种路线色统一调透明度。 */
function alpha(hex: string, value: number): string {
  const raw = hex.replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${value})`;
}

export function computeLayout(width: number, height: number): BattleLayout | null {
  if (width < 80 || height < 160) return null;

  const laneWidth = (width - PAD * 2 - LANE_GAP) / 2;
  const gateTop = PAD + HEADER_H;
  const rowsTop = gateTop + GATE_H + GATE_GAP;
  const coreTop = height - PAD - CORE_H;
  const rowsBottom = coreTop - CORE_GAP;
  const rowHeight = Math.max(20, (rowsBottom - rowsTop - ROW_GAP * 2) / 3);
  const rowStep = rowHeight + ROW_GAP;

  const lane = (index: Lane): LaneLayout => ({
    lane: index,
    x: PAD + index * (laneWidth + LANE_GAP),
    width: laneWidth,
    centerX: PAD + index * (laneWidth + LANE_GAP) + laneWidth / 2,
    gateTop,
    gateBottom: gateTop + GATE_H,
    rowsTop,
    rowsBottom,
    rowHeight,
    rowStep,
    coreTop,
    rowY: ROWS.map((row) => rowsTop + row * rowStep),
  });

  return { width, height, lanes: [lane(0), lane(1)] };
}

/** 命中测试：画布坐标 → 部署格。 */
export function cellAt(layout: BattleLayout, x: number, y: number): { lane: Lane; row: Row } | null {
  for (const lane of layout.lanes) {
    if (x < lane.x || x > lane.x + lane.width) continue;
    for (const row of ROWS) {
      const top = lane.rowY[row] ?? 0;
      if (y >= top && y <= top + lane.rowHeight) return { lane: lane.lane, row };
    }
  }
  return null;
}

/** 敌人 progress → 画布 y。0 是第一排上沿，3 是核心上沿。 */
export function enemyY(lane: LaneLayout, progress: number): number {
  return lane.rowsTop + progress * lane.rowStep;
}

export function drawBattlefield(
  surface: CanvasSurface,
  state: BattleState,
  view: BattlefieldView = {},
): void {
  const layout = computeLayout(surface.cssWidth, surface.cssHeight);
  if (!layout) return;

  surface.beginFrame();
  drawBackdrop(surface);

  const selected = view.selectedCardId ? getCard(view.selectedCardId) : null;

  for (const lane of layout.lanes) {
    const accent = LANE_ACCENT[lane.lane];
    const intact = state.barriers[lane.lane];

    drawLaneShell(surface, lane, accent);
    drawLaneHeader(surface, lane, accent);
    drawGate(surface, lane, accent);
    drawRoute(surface, lane, accent);

    for (const row of ROWS) {
      const y = lane.rowY[row] ?? 0;
      const occupied = state.units.find(
        (unit) => unit.lane === lane.lane && unit.row === row && unit.hp > 0,
      );
      const highlight = cellHighlight(selected, occupied);
      const action = selected ? (selected.kind === 'unit' ? 'deploy' : 'cast') : null;
      const enemyInside = state.enemies.some(
        (enemy) =>
          enemy.lane === lane.lane && enemy.progress >= row && enemy.progress < row + 1,
      );
      drawSlot(surface, lane, y, row, accent, highlight, action, Boolean(occupied) || enemyInside);
      if (row < ROWS.length - 1) {
        drawChevron(surface, lane.centerX, y + lane.rowHeight + ROW_GAP / 2, 3.4, accent, 0.35);
      }
    }
    drawChevron(surface, lane.centerX, lane.gateBottom + GATE_GAP / 2, 3.4, accent, 0.45);

    for (const unit of state.units) {
      if (unit.lane !== lane.lane || unit.hp <= 0) continue;
      const y = lane.rowY[unit.row] ?? 0;
      drawUnit(surface, lane, y, unit);
    }

    drawCore(surface, lane, accent, intact);
  }

  for (const enemy of state.enemies) {
    const lane = layout.lanes[enemy.lane];
    if (lane) drawEnemy(surface, lane, enemy, state.elapsed);
  }

  drawUnitLinks(surface, layout, state);
  drawEnemyCombatLinks(surface, layout, state);

  for (const effect of state.effects) {
    drawEffect(surface, layout, effect);
  }

  drawFloaters(surface, layout, state.floaters);
}

/** 选中的牌能否放在这里：'ok' 高亮，'blocked' 变暗，null 不处理。 */
function cellHighlight(
  selected: ReturnType<typeof getCard> | null,
  occupied: Unit | undefined,
): 'ok' | 'blocked' | null {
  if (!selected) return null;
  if (selected.kind === 'unit') {
    return occupied ? 'blocked' : 'ok';
  }
  if (selected.target === 'cell') {
    if (selected.effect.kind === 'summon') return occupied ? 'blocked' : 'ok';
    return 'ok';
  }
  return null;
}

function drawBackdrop(surface: CanvasSurface): void {
  const { ctx, cssWidth: w, cssHeight: h } = surface;
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, PALETTE.bgTop);
  base.addColorStop(1, PALETTE.bgBottom);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w, h) * 0.55);
  glow.addColorStop(0, 'rgba(124, 92, 255, 0.13)');
  glow.addColorStop(1, 'rgba(124, 92, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h * 0.6);

  // 两个入口上方的危险氛围，强调"敌人从上方来"。
  for (const lane of LANES) {
    const x = PAD + lane * ((w - PAD * 2 - LANE_GAP) / 2 + LANE_GAP);
    const laneWidth = (w - PAD * 2 - LANE_GAP) / 2;
    const danger = ctx.createRadialGradient(
      x + laneWidth / 2,
      PAD + 10,
      0,
      x + laneWidth / 2,
      PAD + 10,
      laneWidth * 0.8,
    );
    danger.addColorStop(0, 'rgba(255, 107, 107, 0.16)');
    danger.addColorStop(1, 'rgba(255, 107, 107, 0)');
    ctx.fillStyle = danger;
    ctx.fillRect(x, PAD, laneWidth, GATE_H + HEADER_H + 20);
  }
}

/** 每条路线的整列底色，让"两路"在视觉上成为两条独立通道。 */
function drawLaneShell(surface: CanvasSurface, lane: LaneLayout, accent: string): void {
  const { ctx, cssHeight: h } = surface;
  const top = PAD - 2;
  const bottom = h - PAD + 2;
  ctx.save();
  roundedRect(ctx, lane.x - 3, top, lane.width + 6, bottom - top, 14);
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, alpha(accent, 0.09));
  fill.addColorStop(0.45, alpha(accent, 0.03));
  fill.addColorStop(1, alpha(accent, 0.06));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = alpha(accent, 0.14);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawLaneHeader(surface: CanvasSurface, lane: LaneLayout, accent: string): void {
  const { ctx } = surface;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(700, 12);
  ctx.fillStyle = accent;
  ctx.fillText(laneName(lane.lane), lane.x + 1, PAD + 9);

  ctx.textAlign = 'right';
  ctx.font = font(500, 8.5);
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText('3 格防线', lane.x + lane.width - 1, PAD + 9);
  ctx.restore();
}

/** 敌军入口：整块画面上最明确的"敌人从这里出现"信号。 */
function drawGate(surface: CanvasSurface, lane: LaneLayout, accent: string): void {
  const { ctx } = surface;
  const { x, width, gateTop: y, centerX: cx } = lane;
  const height = GATE_H;
  ctx.save();

  roundedRect(ctx, x, y, width, height, 12);
  const fill = ctx.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, 'rgba(255, 107, 107, 0.22)');
  fill.addColorStop(1, 'rgba(255, 107, 107, 0.035)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 107, 107, 0.42)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 入口顶部的警示条
  roundedRect(ctx, cx - 16, y - 1, 32, 3, 2);
  ctx.fillStyle = 'rgba(255, 107, 107, 0.65)';
  ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(700, 9);
  ctx.fillStyle = 'rgba(255, 176, 176, 0.95)';
  ctx.fillText('敌军入口', x + 10, y + 12);

  ctx.textAlign = 'right';
  ctx.font = font(600, 8.5);
  ctx.fillStyle = 'rgba(255, 176, 176, 0.55)';
  ctx.fillText('↓', x + width - 10, y + 12);

  // 三枚向下的箭头
  for (let i = -1; i <= 1; i += 1) {
    drawChevron(surface, cx + i * 13, y + 24, 4, '#ff6b6b', i === 0 ? 0.9 : 0.5);
  }

  ctx.textAlign = 'center';
  ctx.font = font(600, 9.5);
  ctx.fillStyle = 'rgba(255, 196, 196, 0.92)';
  ctx.fillText('敌人从这里进入', cx, y + 36);

  // 入口与路线色之间加一条分隔，避免两路混在一起
  ctx.strokeStyle = alpha(accent, 0.14);
  ctx.beginPath();
  ctx.moveTo(x + 8, y + height - 3);
  ctx.lineTo(x + width - 8, y + height - 3);
  ctx.stroke();
  ctx.restore();
}

function drawRoute(surface: CanvasSurface, lane: LaneLayout, accent: string): void {
  const { ctx } = surface;
  ctx.save();
  ctx.setLineDash([2, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = alpha(accent, 0.3);
  ctx.beginPath();
  ctx.moveTo(lane.centerX, lane.gateBottom + 4);
  ctx.lineTo(lane.centerX, lane.coreTop - 2);
  ctx.stroke();
  ctx.restore();
}

function drawSlot(
  surface: CanvasSurface,
  lane: LaneLayout,
  y: number,
  row: Row,
  accent: string,
  highlight: 'ok' | 'blocked' | null,
  action: 'deploy' | 'cast' | null,
  busy = false,
): void {
  const { ctx } = surface;
  const { x, width, rowHeight } = lane;
  const cx = x + width / 2;
  const cy = y + Math.max(24, rowHeight * 0.58);
  ctx.save();

  roundedRect(ctx, x, y, width, rowHeight, 10);
  ctx.fillStyle =
    highlight === 'ok' ? 'rgba(255, 209, 102, 0.09)' : alpha(accent, 0.055);
  ctx.fill();
  ctx.setLineDash(highlight === 'ok' ? [7, 4] : [5, 4]);
  ctx.strokeStyle =
    highlight === 'ok'
      ? 'rgba(255, 209, 102, 0.8)'
      : highlight === 'blocked'
        ? 'rgba(255, 255, 255, 0.1)'
        : alpha(accent, 0.32);
  ctx.lineWidth = highlight === 'ok' ? 1.6 : 1;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = font(500, 9);
  ctx.fillStyle = 'rgba(232, 237, 247, 0.42)';
  ctx.fillText(rowHeight < 62 ? ROW_LABEL_SHORT[row] : ROW_LABEL[row], x + 9, y + 8);

  if (busy) {
    ctx.restore();
    return;
  }

  if (highlight === 'ok') {
    // 合法目标：中心直接写动作，比一个 + 更明确。
    const casting = action === 'cast';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(700, 10);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.95)';
    ctx.fillText(casting ? '点这里' : '放这里', cx, cy);
    ctx.font = font(500, 8);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.55)';
    ctx.fillText(casting ? '点击释放' : '点击部署', cx, cy + 13);
  } else if (highlight === 'blocked') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(600, 9);
    ctx.fillStyle = 'rgba(232, 237, 247, 0.22)';
    ctx.fillText('已占用', cx, cy);
  } else {
    // 空位中心的 "+"，明确这里是可以放单位的槽位
    const plus = rowHeight >= 54 ? 6 : 4.5;
    ctx.strokeStyle = alpha(accent, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - plus, cy);
    ctx.lineTo(cx + plus, cy);
    ctx.moveTo(cx, cy - plus);
    ctx.lineTo(cx, cy + plus);
    ctx.stroke();

    ctx.strokeStyle = alpha(accent, 0.16);
    ctx.beginPath();
    ctx.arc(cx, cy, plus + 6, 0, Math.PI * 2);
    ctx.stroke();

    if (rowHeight >= 60) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = font(500, 8.5);
      ctx.fillStyle = 'rgba(232, 237, 247, 0.3)';
      ctx.fillText('可部署', cx, y + rowHeight - 8);
    }
  }

  ctx.restore();
}

function enemyPixelX(lane: LaneLayout, enemy: Enemy): number {
  const seed = Number.parseInt(enemy.id.replace('e', ''), 10) || 0;
  return lane.centerX + ((seed % 3) - 1) * 7;
}

function findRenderTarget(state: BattleState, unit: Unit): Enemy | null {
  let best: Enemy | null = null;
  for (const enemy of state.enemies) {
    if (enemy.lane !== unit.lane || enemy.hp <= 0) continue;
    if (enemy.progress < unit.row - unit.range) continue;
    if (enemy.progress > unit.row + 1) continue;
    if (!best || enemy.progress > best.progress) best = enemy;
  }
  return best;
}

function findRenderBlocker(state: BattleState, enemy: Enemy): Unit | null {
  let best: Unit | null = null;
  for (const unit of state.units) {
    if (unit.lane !== enemy.lane || unit.hp <= 0) continue;
    if (unit.row + 0.95 < enemy.progress) continue;
    if (!best || unit.row < best.row) best = unit;
  }
  return best;
}

function drawArrow(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, color: string, alphaValue: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.globalAlpha = alphaValue;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const side of [-0.55, 0.55]) {
    ctx.beginPath();
    ctx.moveTo(to.x - Math.cos(angle + side) * 5, to.y - Math.sin(angle + side) * 5);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnitLinks(surface: CanvasSurface, layout: BattleLayout, state: BattleState): void {
  for (const unit of state.units) {
    const lane = layout.lanes[unit.lane];
    if (!lane) continue;
    drawUnitLink(surface, lane, lane.rowY[unit.row] ?? 0, unit, state);
  }
}

/** 我方和敌人正在交战：青色连线指向被攻击的敌人。 */
function drawUnitLink(
  surface: CanvasSurface,
  lane: LaneLayout,
  y: number,
  unit: Unit,
  state: BattleState,
): void {
  const { ctx } = surface;
  if (unit.hp <= 0 || unit.attack <= 0) return;
  const target = findRenderTarget(state, unit);
  if (!target) return;

  // 远程连线走在格子右侧，避免穿过空格中央的「+ / 可部署」。
  const linkOffset = unit.range >= 2 ? 18 : -4;
  const from = {
    x: lane.centerX + linkOffset,
    y: y + lane.rowHeight * 0.32,
  };
  const to = { x: enemyPixelX(lane, target) + linkOffset, y: enemyY(lane, target.progress) - 2 };

  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = '#8fd3ff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
  drawArrow(ctx, from, to, '#8fd3ff', 0.6);

    if (unit.attackFlash > 0) {
      const flash = unit.attackFlash / 0.22;
      const travel = Math.min(1, 1 - flash + 0.25);
      const dx = (to.x - from.x) * travel;
      const dy = (to.y - from.y) * travel;
      ctx.save();
      ctx.globalAlpha = Math.min(1, flash * 1.6);
      if (unit.range >= 2) {
        ctx.fillStyle = '#d8f1ff';
        ctx.shadowColor = '#8fd3ff';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(from.x + dx, from.y + dy, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#fff3c4';
        ctx.lineWidth = 1.8;
        for (const spread of [-0.5, 0, 0.5]) {
          ctx.beginPath();
          ctx.moveTo(to.x - 3 + spread * 4, to.y - 4);
          ctx.lineTo(to.x + 3 + spread * 5, to.y + 4);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
}

/** 敌人被阻挡并还手时，用红色连线和抓痕标出攻击对象。 */
function drawEnemyCombatLinks(surface: CanvasSurface, layout: BattleLayout, state: BattleState): void {
  const { ctx } = surface;
  for (const enemy of state.enemies) {
    const lane = layout.lanes[enemy.lane];
    if (!lane) continue;
    const blocker = findRenderBlocker(state, enemy);
    if (!blocker) continue;
    const stop = Math.max(0.03, blocker.row - (enemy.range >= 2 ? 0.45 : 0.05));
    if (enemy.progress < stop - 0.1) continue;

    const from = { x: enemyPixelX(lane, enemy) + 4, y: enemyY(lane, enemy.progress) };
    const to = {
      x: lane.centerX + 4,
      y: (lane.rowY[blocker.row] ?? 0) + lane.rowHeight / 2 - 3,
    };
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();

    const flash = Math.max(enemy.attackFlash, blocker.attackFlash);
    if (flash > 0) {
      const alphaValue = Math.min(1, (flash / 0.22) * 1.5);
      ctx.save();
      ctx.globalAlpha = alphaValue;
      ctx.strokeStyle = enemy.attackFlash > 0 ? '#ff9a9a' : '#9fdcff';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      for (const spread of [-3, 0, 3]) {
        ctx.beginPath();
        ctx.moveTo(to.x + spread - 2, to.y - 5);
        ctx.lineTo(to.x + spread + 2, to.y + 5);
        ctx.stroke();
      }
      drawSpark(ctx, (from.x + to.x) / 2, (from.y + to.y) / 2, 0.95, '#ffd166');
      ctx.restore();
    }
  }
}

function drawSpark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  alphaValue: number,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = alphaValue;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i + Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(x + cos * 2, y + sin * 2);
    ctx.lineTo(x + cos * 6, y + sin * 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloaters(
  surface: CanvasSurface,
  layout: BattleLayout,
  floaters: readonly Floater[],
): void {
  const { ctx } = surface;
  const colors: Record<FloaterTone, string> = {
    enemyDamage: '#ffd166',
    unitDamage: '#ff8f8f',
    status: '#9fdcff',
    notice: '#ffe7a3',
  };

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const floater of floaters) {
    const lane = layout.lanes[floater.lane];
    if (!lane) continue;
    const rowY = lane.rowY[floater.row ?? 0] ?? 0;
    const baseY =
      floater.progress !== undefined
        ? Math.max(enemyY(lane, floater.progress) - 4, (lane.rowY[0] ?? 0) + 20)
        : rowY + lane.rowHeight / 2 - 2;
    const progress = 1 - floater.ttl / floater.maxTtl;
    const seed = Number.parseInt(floater.id.replace('f', ''), 10) || 0;
    const sideOffset =
      floater.tone === 'unitDamage' ? 24 : floater.tone === 'enemyDamage' ? -24 : 0;
    const x = lane.centerX + sideOffset + ((seed % 3) - 1) * 5;
    const rise = floater.tone === 'enemyDamage' ? 14 : 18;
    const y = Math.max(20, baseY - rise - progress * 14);
    const big = floater.tone === 'enemyDamage' || floater.tone === 'unitDamage';

    ctx.globalAlpha = Math.min(1, floater.ttl / 0.22);
    ctx.font = font(big ? 700 : 600, big ? 11 : 9);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 10, 20, 0.88)';
    ctx.strokeText(floater.text, x, y);
    ctx.fillStyle = colors[floater.tone];
    ctx.fillText(floater.text, x, y);
  }
  ctx.restore();
}

function drawUnit(surface: CanvasSurface, lane: LaneLayout, y: number, unit: Unit): void {
  const { ctx } = surface;
  const card = getCard(unit.card);
  const cx = lane.centerX;
  const rowHeight = lane.rowHeight;
  const cy = y + rowHeight / 2;
  const accent = card.accent;
  ctx.save();

  // 已占用格：换成实底，和其他空格区分
  roundedRect(ctx, lane.x, y, lane.width, rowHeight, 10);
  ctx.fillStyle = alpha(accent, 0.11);
  ctx.fill();
  ctx.strokeStyle = alpha(accent, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 我方阵营标记：青色底座 + 右侧竖条 + 角标，和红色敌人区分。
  ctx.fillStyle = 'rgba(143, 211, 255, 0.1)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 9, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(143, 211, 255, 0.38)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(143, 211, 255, 0.65)';
  roundedRect(ctx, lane.x + lane.width - 5, y + 10, 2.5, rowHeight - 20, 1.2);
  ctx.fill();

  ctx.font = font(600, 7.5);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(143, 211, 255, 0.7)';
  ctx.fillText('我方', lane.x + lane.width - 9, y + 7);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (unit.stunRemaining > 0) {
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(400, rowHeight >= 64 ? 22 : rowHeight >= 60 ? 18 : 15);
  ctx.fillStyle = '#fff';
  ctx.fillText(card.emoji, cx, cy - 7);

  if (unit.attackFlash > 0) {
    ctx.globalAlpha = Math.min(1, (unit.attackFlash / 0.22) * 1.3);
    ctx.strokeStyle = '#ffe7a3';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (unit.hitFlash > 0) {
    ctx.globalAlpha = Math.min(1, (unit.hitFlash / 0.16) * 1.2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.font = font(600, 8.5);
  ctx.fillStyle = 'rgba(232, 237, 247, 0.75)';
  ctx.fillText(card.name, cx, cy + 12);

  // 血条
  const barWidth = Math.min(46, lane.width - 26);
  const barX = cx - barWidth / 2;
  const barY = y + rowHeight - 7;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  roundedRect(ctx, barX, barY, barWidth, 3, 1.5);
  ctx.fill();
  const ratio = Math.max(0, unit.hp / unit.maxHp);
  ctx.fillStyle = ratio > 0.55 ? '#5ad19a' : ratio > 0.25 ? '#ffd166' : '#ff6b6b';
  roundedRect(ctx, barX, barY, Math.max(2, barWidth * ratio), 3, 1.5);
  ctx.fill();

  if (unit.temporary) {
    ctx.font = font(500, 7);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(143, 211, 255, 0.8)';
    ctx.fillText('临时', lane.x + 7, y + 9);
  }

  ctx.restore();
}

function drawEnemy(
  surface: CanvasSurface,
  lane: LaneLayout,
  enemy: Enemy,
  elapsed: number,
): void {
  const { ctx } = surface;
  const def = getEnemy(enemy.enemy);
  const y = enemyY(lane, enemy.progress);
  if (y < lane.gateTop - 26 || y > lane.coreTop + 10) return;

  // 同路敌人错开一点，避免完全重叠。
  const x = enemyPixelX(lane, enemy);
  const size = enemy.boss ? 30 : lane.rowHeight < 60 ? 15 : 20;
  const ratio = Math.max(0, enemy.hp / enemy.maxHp);
  ctx.save();

  // 落影与红色敌方底座
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, size * 0.45, size * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 107, 107, 0.14)';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, size * 0.55, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 107, 107, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (enemy.attackFlash > 0) {
    ctx.globalAlpha = Math.min(1, (enemy.attackFlash / 0.22) * 1.3);
    ctx.strokeStyle = '#ff9a9a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (enemy.hitFlash > 0) {
    ctx.globalAlpha = Math.min(1, (enemy.hitFlash / 0.16) * 1.2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 2, size * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (enemy.slowRemaining > 0) {
    ctx.strokeStyle = 'rgba(143, 211, 255, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (enemy.stunRemaining > 0) {
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (enemy.windupRemaining > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 14);
    ctx.strokeStyle = `rgba(255, 95, 109, ${0.55 + pulse * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.72 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(400, size);
  ctx.fillStyle = '#fff';
  ctx.fillText(def.emoji, x, y - 2);

  // 血条
  const barWidth = enemy.boss ? 44 : 22;
  const barX = x - barWidth / 2;
  const barY = y - size * 0.72;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  roundedRect(ctx, barX, barY, barWidth, 3, 1.5);
  ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? '#ff8a8a' : ratio > 0.25 ? '#ffd166' : '#ff6b6b';
  roundedRect(ctx, barX, barY, Math.max(1.5, barWidth * ratio), 3, 1.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 0.6;
  roundedRect(ctx, barX, barY, barWidth, 3, 1.5);
  ctx.stroke();

  ctx.restore();
}

function drawEffect(surface: CanvasSurface, layout: BattleLayout, effect: Effect): void {
  const { ctx } = surface;
  const progress = 1 - effect.ttl / effect.maxTtl;
  ctx.save();

  if (effect.kind === 'nova') {
    ctx.fillStyle = alpha(effect.color, Math.max(0, 0.22 * (1 - progress)));
    if (effect.lane === undefined) {
      ctx.fillRect(0, 0, layout.width, layout.height);
    } else {
      const lane = layout.lanes[effect.lane];
      if (lane) ctx.fillRect(lane.x - 4, lane.gateTop, lane.width + 8, lane.coreTop - lane.gateTop + 10);
    }
  } else if (effect.kind === 'barrier' && effect.lane !== undefined) {
    const lane = layout.lanes[effect.lane];
    if (lane) {
      ctx.strokeStyle = alpha(effect.color, 0.9 * (1 - progress));
      ctx.lineWidth = 3;
      roundedRect(ctx, lane.x - 3, lane.gateTop - 2, lane.width + 6, lane.coreTop - lane.gateTop + 8, 14);
      ctx.stroke();
    }
  } else if (effect.lane !== undefined) {
    const lane = layout.lanes[effect.lane];
    if (!lane) {
      ctx.restore();
      return;
    }
    const cx = lane.centerX;
    const cy =
      effect.row !== undefined ? (lane.rowY[effect.row] ?? 0) + lane.rowHeight / 2 : enemyY(lane, effect.progress ?? 0);
    const radius = 8 + progress * 26;
    ctx.strokeStyle = alpha(effect.color, Math.max(0, 0.9 * (1 - progress)));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = alpha(effect.color, Math.max(0, 0.16 * (1 - progress)));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCore(
  surface: CanvasSurface,
  lane: LaneLayout,
  accent: string,
  intact: boolean,
): void {
  const { ctx } = surface;
  const { x, width, coreTop: y, centerX: cx } = lane;
  const height = CORE_H;
  const tint = intact ? accent : PALETTE.danger;

  ctx.save();
  roundedRect(ctx, x, y, width, height, 12);
  const fill = ctx.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, intact ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 107, 107, 0.12)');
  fill.addColorStop(1, 'rgba(255, 255, 255, 0.015)');
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.strokeStyle = tint;
  ctx.globalAlpha = intact ? 0.5 : 0.85;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (intact) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(700, 12);
  ctx.fillStyle = PALETTE.text;
  ctx.fillText(`◆ ${laneName(lane.lane)}核心`, cx, y + 19);

  ctx.font = font(600, 8.5);
  ctx.fillStyle = intact ? PALETTE.ok : PALETTE.danger;
  ctx.fillText(intact ? '屏障 1/1 · 漏怪时触发' : '屏障已破 · 再漏怪即失守', cx, y + 35);

  // 顶部的小盾牌状态点
  ctx.fillStyle = intact ? PALETTE.ok : PALETTE.danger;
  ctx.beginPath();
  ctx.arc(x + 12, y + 12, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawChevron(
  surface: CanvasSurface,
  cx: number,
  cy: number,
  size: number,
  color: string,
  opacity: number,
): void {
  const { ctx } = surface;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size, cy - size * 0.7);
  ctx.lineTo(cx, cy + size * 0.35);
  ctx.lineTo(cx + size, cy - size * 0.7);
  ctx.stroke();
  ctx.restore();
}
