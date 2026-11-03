import { LANES, type Lane, type Phase } from '@/core/types';
import { laneName } from '@/core/grid';
import { getEnemy } from '@/data/enemies';
import { TUNING } from '@/data/tuning';
import { nextWaveAt, previewWaveAt, waveAt } from '@/data/waves';
import type { WaveDef } from '@/data/schema';
import type { BattleState } from '@/sim/state';

const PHASE_LABEL: Record<Phase, string> = {
  preparation: '准备阶段',
  wave: '战斗阶段',
  intermission: '波间休整',
  victory: '胜利',
  defeat: '失败',
};

export interface HudView {
  render(state: BattleState): void;
}

function mustGet<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少 DOM 节点：${selector}`);
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatMana(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function composition(wave: WaveDef): { lane: Lane; text: string }[] {
  const rows: { lane: Lane; text: string }[] = [];
  for (const lane of LANES) {
    const groups = wave.spawns.filter((spawn) => spawn.lane === lane);
    if (groups.length === 0) continue;
    const parts = groups.map((group) => {
      const enemy = getEnemy(group.enemy);
      const count = group.count > 1 ? ` ×${group.count}` : '';
      return `${enemy.emoji}${enemy.name}${count}`;
    });
    rows.push({ lane, text: parts.join(' ') });
  }
  return rows;
}

export function mountHud(): HudView {
  const phaseChip = mustGet<HTMLElement>('#phase-chip');
  const clock = mustGet<HTMLElement>('#clock');
  const preview = mustGet<HTMLElement>('#preview');
  const barriers = mustGet<HTMLElement>('#barriers');
  const manaValue = mustGet<HTMLElement>('#mana-value');
  const manaFill = mustGet<HTMLElement>('#mana-fill');
  const manaTrack = mustGet<HTMLElement>('.mana__track');
  const pileInfo = mustGet<HTMLElement>('#pile-info');
  const boss = mustGet<HTMLElement>('#boss');
  const bossFill = mustGet<HTMLElement>('#boss-fill');
  const bossHp = mustGet<HTMLElement>('#boss-hp');

  const barrierEls = LANES.map((lane) => {
    const wrap = el('div', 'barrier');
    wrap.dataset.lane = String(lane);
    const dot = el('i', 'barrier__dot');
    const label = el('span', 'barrier__label', `${laneName(lane)}屏障`);
    const state = el('span', 'barrier__state', '完好');
    wrap.append(dot, label, state);
    barriers.append(wrap);
    return { lane, wrap, state };
  });

  return {
    render(state: BattleState): void {
      const paused = state.paused && !state.result;
      const phase = state.phase;
      phaseChip.textContent = paused ? '已暂停' : PHASE_LABEL[phase];
      phaseChip.dataset.phase = paused ? 'paused' : phase;

      const currentWave = waveAt(state.elapsed);
      const upcoming = nextWaveAt(state.elapsed);
      const upcomingIsSoon = previewWaveAt(state.elapsed) !== null;

      if (phase === 'wave') {
        clock.textContent =
          currentWave && currentWave.endAt !== null
            ? formatClock(currentWave.endAt - state.elapsed)
            : formatClock(state.elapsed);
      } else if (upcoming) {
        clock.textContent = formatClock(upcoming.startAt - state.elapsed);
      } else {
        clock.textContent = formatClock(state.elapsed);
      }

      renderPreview(preview, currentWave, upcoming, upcomingIsSoon, state.elapsed);

      const ratio = Math.min(1, state.economy.mana / TUNING.mana.max);
      manaFill.style.width = `${(ratio * 100).toFixed(2)}%`;
      manaValue.textContent = `${formatMana(state.economy.mana)} / ${TUNING.mana.max}`;
      manaTrack.setAttribute('aria-valuenow', state.economy.mana.toFixed(1));

      pileInfo.textContent = `抽牌堆 ${state.economy.drawPile.length} · 弃牌堆 ${state.economy.discardPile.length} · 手牌 ${state.economy.hand.length}`;

      for (const barrier of barrierEls) {
        const intact = state.barriers[barrier.lane];
        barrier.wrap.classList.toggle('is-broken', !intact);
        barrier.state.textContent = intact ? '完好' : '已破';
      }

      const bossEnemy = state.enemies.find((enemy) => enemy.boss);
      boss.hidden = !bossEnemy;
      if (bossEnemy) {
        const hpRatio = Math.max(0, bossEnemy.hp / bossEnemy.maxHp);
        bossFill.style.width = `${(hpRatio * 100).toFixed(1)}%`;
        bossHp.textContent = `${Math.ceil(bossEnemy.hp)} / ${bossEnemy.maxHp}`;
        boss.classList.toggle('is-winding', bossEnemy.windupRemaining > 0);
      }
    },
  };
}

function renderPreview(
  target: HTMLElement,
  currentWave: WaveDef | null,
  upcoming: WaveDef | null,
  upcomingIsSoon: boolean,
  elapsed: number,
): void {
  const wave = currentWave ?? upcoming;
  if (!wave) {
    target.replaceChildren(el('span', 'preview__label', '本局波次已全部结束'));
    return;
  }

  const label = currentWave ? '当前' : upcomingIsSoon ? '即将来袭' : '下一波';
  const countdown = currentWave
    ? wave.endAt !== null
      ? `${formatClock(wave.endAt - elapsed)} 后结束`
      : '清场后结束'
    : `${formatClock(wave.startAt - elapsed)} 后开始`;

  const nodes: HTMLElement[] = [
    el('span', 'preview__label', label),
    el('strong', undefined, wave.name),
    el('span', 'preview__sep', '·'),
    el('span', 'preview__time', countdown),
  ];

  const lanes = composition(wave);
  if (lanes.length > 0) {
    nodes.push(el('span', 'preview__sep', '·'));
    for (const lane of lanes) {
      const span = el('span', 'preview__lane');
      span.dataset.lane = String(lane.lane);
      span.textContent = `${laneName(lane.lane)}↓ ${lane.text}`;
      nodes.push(span);
    }
  }

  if (currentWave && wave.index === 4) {
    nodes.push(el('span', 'preview__boss', 'Boss 蓄力 2s · 前方 3 格'));
  }

  target.classList.toggle('is-urgent', upcomingIsSoon && !currentWave);
  target.replaceChildren(...nodes);
}
