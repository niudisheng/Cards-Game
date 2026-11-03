import '@/styles/base.css';
import '@/styles/layout.css';
import '@/styles/hand.css';

import type { CardId, Lane, Row } from '@/core/types';
import { getCard } from '@/data/cards';
import { canAfford, findHandCard } from '@/sim/economy';
import { castCard, deployCard, stepBattle } from '@/sim/battle';
import { createBattleState, type BattleState } from '@/sim/state';
import { mountCardSheet, mountHand } from '@/ui/dom/hand';
import { mountHelp } from '@/ui/dom/help';
import { mountHud } from '@/ui/dom/hud';
import { cellAt, computeLayout, drawBattlefield } from '@/ui/render/battlefield';
import { CanvasSurface } from '@/ui/render/canvas';

const DEFAULT_SEED = 0x2a17c0de;
const FIXED_STEP = 1 / 60;

function mustGet<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少 DOM 节点：${selector}`);
  return node;
}

function randomSeed(): number {
  return (Math.random() * 0x1_0000_0000) >>> 0;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const canvasEl = mustGet<HTMLCanvasElement>('#battlefield');
const handRoot = mustGet<HTMLElement>('#hand');
const debugPanel = mustGet<HTMLElement>('#debug');
const debugBody = mustGet<HTMLElement>('#debug-body');
const debugButton = mustGet<HTMLButtonElement>('#btn-debug');
const debugClose = mustGet<HTMLButtonElement>('#btn-debug-close');
const restartButton = mustGet<HTMLButtonElement>('#btn-restart');
const pauseButton = mustGet<HTMLButtonElement>('#btn-pause');
const resumeButton = mustGet<HTMLButtonElement>('#btn-resume');
const pauseVeil = mustGet<HTMLElement>('#pause-veil');
const selectHint = mustGet<HTMLElement>('#select-hint');
const selectHintText = mustGet<HTMLElement>('#select-hint-text');
const selectCancel = mustGet<HTMLButtonElement>('#select-cancel');
const toast = mustGet<HTMLElement>('#toast');
const resultEl = mustGet<HTMLElement>('#result');
const resultTitle = mustGet<HTMLElement>('#result-title');
const resultReason = mustGet<HTMLElement>('#result-reason');
const resultStats = mustGet<HTMLElement>('#result-stats');
const againButton = mustGet<HTMLButtonElement>('#btn-again');
const resultPanel = resultEl.querySelector<HTMLElement>('.result');

const surface = new CanvasSurface(canvasEl);
const sheet = mountCardSheet();
const hud = mountHud();
const hand = mountHand(handRoot, {
  onInspect: (cardId) => sheet.open(cardId),
  onPlay: (uid) => onCardPlay(uid),
});
const help = mountHelp();

let state: BattleState = createBattleState({ seed: DEFAULT_SEED });
let selected: { uid: string; cardId: CardId } | null = null;
let accumulator = 0;
let lastTime = performance.now();
let resultShown = false;
let toastTimer = 0;

// ---------------------------------------------------------------------------
// 选择与出牌
// ---------------------------------------------------------------------------

function clearSelection(): void {
  if (!selected) return;
  selected = null;
  updateSelectionUi();
}

function updateSelectionUi(): void {
  if (!selected) {
    selectHint.hidden = true;
    return;
  }
  const card = getCard(selected.cardId);
  selectHint.hidden = false;
  selectHintText.textContent =
    card.kind === 'unit'
      ? `已选「${card.name}」· 点击一条路上的空格部署`
      : `已选「${card.name}」· 点击要释放的格子`;
}

function onCardPlay(uid: string): void {
  if (state.result) return;
  if (state.paused) {
    showToast('暂停中不能出牌');
    return;
  }

  const instance = findHandCard(state.economy, uid);
  if (!instance) return;
  const card = getCard(instance.card);

  if (selected?.uid === uid) {
    clearSelection();
    return;
  }

  if (!canAfford(state.economy, card.cost)) {
    showToast(`魔力不足：「${card.name}」需要 ${card.cost} 点`);
    return;
  }

  if (card.kind === 'spell' && card.target === 'global') {
    const result = castCard(state, uid);
    if (!result.ok) showToast(result.reason);
    clearSelection();
    return;
  }

  selected = { uid, cardId: card.id };
  updateSelectionUi();
}

function onCell(cell: { lane: Lane; row: Row }): void {
  if (!selected) return;
  if (state.result) {
    clearSelection();
    return;
  }
  if (state.paused) {
    showToast('暂停中不能出牌');
    return;
  }

  const card = getCard(selected.cardId);
  const result =
    card.kind === 'unit'
      ? deployCard(state, selected.uid, cell.lane, cell.row)
      : castCard(state, selected.uid, cell);

  if (!result.ok) {
    showToast(result.reason);
    return;
  }

  clearSelection();
  draw();
}

canvasEl.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const layout = computeLayout(surface.cssWidth, surface.cssHeight);
  if (!layout) return;
  const rect = canvasEl.getBoundingClientRect();
  const cell = cellAt(layout, event.clientX - rect.left, event.clientY - rect.top);
  if (!cell) {
    clearSelection();
    return;
  }
  onCell(cell);
});

// ---------------------------------------------------------------------------
// 暂停 / 重开 / 结算
// ---------------------------------------------------------------------------

function setPaused(paused: boolean): void {
  if (state.result) return;
  state.paused = paused;
  pauseVeil.hidden = !paused;
  pauseButton.textContent = paused ? '继续' : '暂停';
  pauseButton.setAttribute('aria-pressed', String(paused));
  if (paused) clearSelection();
  draw();
}

function restart(seed = randomSeed()): void {
  state = createBattleState({ seed });
  accumulator = 0;
  lastTime = performance.now();
  resultShown = false;
  resultEl.hidden = true;
  pauseVeil.hidden = true;
  pauseButton.textContent = '暂停';
  pauseButton.setAttribute('aria-pressed', 'false');
  selected = null;
  updateSelectionUi();
  draw();
  showToast(`已重开 · 种子 0x${seed.toString(16).padStart(8, '0')}`);
}

function showResult(): void {
  if (!state.result || resultShown) return;
  resultShown = true;
  clearSelection();

  const victory = state.result === 'victory';
  resultPanel?.classList.toggle('result--defeat', !victory);
  resultTitle.textContent = victory ? '胜利' : '失败';
  resultTitle.dataset.result = state.result;
  resultReason.textContent = state.resultReason;

  const leaks = state.stats.leaks[0] + state.stats.leaks[1];
  const rows: Array<[string, string]> = [
    ['用时', formatClock(state.elapsed)],
    ['击杀', String(state.stats.kills)],
    ['漏怪', String(leaks)],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const cell = document.createElement('div');
    cell.className = 'result__stat';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    cell.append(dt, dd);
    fragment.append(cell);
  }
  resultStats.replaceChildren(fragment);
  resultEl.hidden = false;
  againButton.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// 渲染循环
// ---------------------------------------------------------------------------

function draw(): void {
  surface.syncSize();
  drawBattlefield(surface, state, { selectedCardId: selected?.cardId });
  hud.render(state);
  hand.render(state, selected?.uid);
  if (!debugPanel.hidden) renderDebug();
}

function tick(now: number): void {
  const delta = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

  if (!state.paused && !state.result && !help.isOpen() && !sheet.isOpen()) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 8) {
      stepBattle(state, FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
      if (state.result) break;
    }
  }

  if (state.result) showResult();
  draw();
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// HUD 交互
// ---------------------------------------------------------------------------

pauseButton.addEventListener('click', () => setPaused(!state.paused));
resumeButton.addEventListener('click', () => setPaused(false));
restartButton.addEventListener('click', () => restart());
againButton.addEventListener('click', () => restart());
selectCancel.addEventListener('click', () => {
  clearSelection();
  draw();
});

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function renderDebug(): void {
  const seedHex = `0x${state.seed.toString(16).padStart(8, '0')}`;
  const handText =
    state.economy.hand.map((instance) => getCard(instance.card).name).join(' / ') || '—';
  const drawText =
    state.economy.drawPile.map((cardId) => getCard(cardId).name).join(' / ') || '—';
  const discordText =
    state.economy.discardPile.map((cardId) => getCard(cardId).name).join(' / ') || '—';
  const barriers = `${state.barriers[0] ? '左完好' : '左已破'} · ${state.barriers[1] ? '右完好' : '右已破'}`;
  const boss = state.enemies.find((enemy) => enemy.boss);

  debugBody.textContent = [
    `seed        ${seedHex}`,
    `phase       ${state.phase} · ${state.paused ? 'paused' : 'running'}${state.result ? ` · ${state.result}` : ''}`,
    `elapsed     ${state.elapsed.toFixed(1)}s`,
    `mana        ${state.economy.mana.toFixed(1)} / 10`,
    `hand        ${handText}`,
    `drawPile    ${drawText}`,
    `discardPile ${discordText}`,
    `barriers    ${barriers}`,
    `enemies     ${state.enemies.length} · spawn ${state.spawnCursor}/${state.spawnQueue.length}`,
    `units       ${state.units.length} · kills ${state.stats.kills} · leaks ${state.stats.leaks[0]}+${state.stats.leaks[1]}`,
    boss ? `boss        ${boss.hp.toFixed(0)}/${boss.maxHp} · p=${boss.progress.toFixed(2)}` : 'boss        —',
    `selected    ${selected ? getCard(selected.cardId).name : '—'}`,
    `canvas      ${surface.cssWidth.toFixed(0)}×${surface.cssHeight.toFixed(0)} css @${surface.dpr}x`,
    '',
    `loop        1/60 固定步长 · step ${(1000 / 60).toFixed(1)}ms`,
  ].join('\n');
}

function setDebug(open: boolean): void {
  debugPanel.hidden = !open;
  debugButton.setAttribute('aria-pressed', String(open));
  if (open) renderDebug();
}

debugButton.addEventListener('click', () => setDebug(debugPanel.hidden));
debugClose.addEventListener('click', () => setDebug(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!debugPanel.hidden) setDebug(false);
    else if (!resultEl.hidden) return;
    else clearSelection();
  }
  if (event.key === ' ' && resultEl.hidden) {
    event.preventDefault();
    setPaused(!state.paused);
  }
});

window.addEventListener('resize', () => draw());
window.addEventListener('orientationchange', () => draw());
void document.fonts?.ready.then(() => draw());

hand.render(state, null);
hud.render(state);
draw();
help.maybeOpenOnFirstVisit();
requestAnimationFrame(tick);
