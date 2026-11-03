import type { CardId } from '@/core/types';
import { getCard } from '@/data/cards';
import type { CardDef } from '@/data/schema';
import type { BattleState } from '@/sim/state';

export interface HandView {
  render(state: BattleState, selectedUid?: string | null): void;
}

export interface HandOptions {
  /** 长按卡牌查看详情。 */
  onInspect(cardId: CardId): void;
  /** 点击卡牌：单位进入部署选择，法术进入瞄准或直接结算。 */
  onPlay(uid: string): void;
}

export interface CardSheet {
  open(cardId: CardId): void;
  close(): void;
  isOpen(): boolean;
}

function mustGet<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少 DOM 节点：${selector}`);
  return node;
}

/** 手牌 DOM。只有手牌内容、可支付状态或选中项变化时才重建，避免每帧抖动。 */
export function mountHand(root: HTMLElement, options: HandOptions): HandView {
  let signature = '';

  return {
    render(state: BattleState, selectedUid?: string | null): void {
      const next = state.economy.hand
        .map((instance) => {
          const affordable = state.economy.mana >= getCard(instance.card).cost;
          const selected = instance.uid === selectedUid ? 1 : 0;
          return `${instance.uid}:${affordable ? 1 : 0}:${selected}`;
        })
        .join(',') + `|${selectedUid ?? ''}`;

      if (next === signature) return;
      signature = next;

      const fragment = document.createDocumentFragment();
      for (const instance of state.economy.hand) {
        const card = getCard(instance.card);
        const affordable = state.economy.mana >= card.cost;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = [
          'card',
          card.kind === 'spell' ? 'is-spell' : '',
          affordable ? '' : 'is-unaffordable',
          instance.uid === selectedUid ? 'is-selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        button.style.setProperty('--card-accent', card.accent);
        button.setAttribute(
          'aria-label',
          `${card.name}，${card.cost} 费，${card.role}。点击出牌，长按查看详情`,
        );
        button.setAttribute('aria-pressed', String(instance.uid === selectedUid));

        // 长按看详情，单击出牌；两者用 420ms 定时器区分。
        let pressTimer = 0;
        let longPressed = false;
        const cancelPress = (): void => {
          if (pressTimer) window.clearTimeout(pressTimer);
          pressTimer = 0;
        };
        button.addEventListener('pointerdown', () => {
          longPressed = false;
          cancelPress();
          pressTimer = window.setTimeout(() => {
            longPressed = true;
            options.onInspect(card.id);
          }, 420);
        });
        button.addEventListener('pointerup', cancelPress);
        button.addEventListener('pointerleave', cancelPress);
        button.addEventListener('pointercancel', cancelPress);
        button.addEventListener('click', () => {
          if (longPressed) {
            longPressed = false;
            return;
          }
          options.onPlay(instance.uid);
        });

        const cost = document.createElement('span');
        cost.className = 'card__cost';
        cost.textContent = String(card.cost);

        const kind = document.createElement('span');
        kind.className = 'card__kind';
        kind.textContent = card.kind === 'unit' ? '单位' : '法术';

        const emoji = document.createElement('span');
        emoji.className = 'card__emoji';
        emoji.textContent = card.emoji;

        const name = document.createElement('span');
        name.className = 'card__name';
        name.textContent = card.name;

        const role = document.createElement('span');
        role.className = 'card__role';
        role.textContent = card.role;

        button.append(cost, kind, emoji, name, role);
        fragment.append(button);
      }

      root.replaceChildren(fragment);
    },
  };
}

const TARGET_LABEL = {
  cell: '任意格',
  enemy: '单个敌人',
  global: '全场',
} as const;

function describeStats(card: CardDef): Array<[string, string]> {
  if (card.kind === 'unit') {
    const stats = card.stats;
    const rows: Array<[string, string]> = [
      ['生命', String(stats.maxHp)],
      ['攻击', stats.attack > 0 ? String(stats.attack) : '—'],
      ['攻速', stats.attackInterval > 0 ? `${stats.attackInterval}s` : '—'],
      ['射程', stats.range > 0 ? `${stats.range} 格` : '—'],
    ];
    if (card.slowOnHit) {
      rows.push([
        '命中减速',
        `${Math.round((1 - card.slowOnHit.factor) * 100)}% / ${card.slowOnHit.duration}s`,
      ]);
    }
    if (card.aura) {
      rows.push(['光环', `攻速 +${Math.round(card.aura.attackSpeedBonus * 100)}%`]);
    }
    if (card.onDeath) {
      rows.push(['死亡爆炸', `${card.onDeath.damage} 伤害`]);
    }
    if (stats.lifespan) {
      rows.push(['持续', `${stats.lifespan}s`]);
    }
    return rows;
  }

  const effect = card.effect;
  switch (effect.kind) {
    case 'areaDamage':
      return [
        ['目标', TARGET_LABEL[card.target]],
        ['伤害', String(effect.damage)],
        ['范围', `同列前后 ${effect.rows} 格`],
      ];
    case 'slowAll':
      return [
        ['目标', TARGET_LABEL[card.target]],
        ['减速', `${Math.round((1 - effect.factor) * 100)}%`],
        ['持续', `${effect.duration}s`],
      ];
    case 'summon':
      return [
        ['目标', TARGET_LABEL[card.target]],
        ['生命 / 攻击', `${effect.stats.maxHp} / ${effect.stats.attack}`],
        ['持续', `${effect.duration}s`],
        ['占格', '是'],
      ];
    case 'manaAndDraw':
      return [
        ['目标', TARGET_LABEL[card.target]],
        ['魔力', `+${effect.mana}`],
        ['抽牌', `+${effect.cards}`],
      ];
  }
}

export function mountCardSheet(): CardSheet {
  const sheet = mustGet<HTMLElement>('#sheet');
  const emoji = mustGet<HTMLElement>('#sheet-emoji');
  const title = mustGet<HTMLElement>('#sheet-title');
  const meta = mustGet<HTMLElement>('#sheet-meta');
  const desc = mustGet<HTMLElement>('#sheet-desc');
  const stats = mustGet<HTMLElement>('#sheet-stats');
  const panel = mustGet<HTMLElement>('.sheet__panel');
  let lastFocused: HTMLElement | null = null;

  const close = (): void => {
    if (sheet.hidden) return;
    sheet.hidden = true;
    lastFocused?.focus();
    lastFocused = null;
  };

  const open = (cardId: CardId): void => {
    const card = getCard(cardId);
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    emoji.textContent = card.emoji;
    title.textContent = card.name;
    meta.textContent = `${card.cost} 费 · ${card.kind === 'unit' ? '单位' : '法术'} · ${card.role}`;
    desc.textContent = card.description;

    const fragment = document.createDocumentFragment();
    for (const [label, value] of describeStats(card)) {
      const row = document.createElement('div');
      row.className = 'sheet__stat';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      row.append(dt, dd);
      fragment.append(row);
    }
    stats.replaceChildren(fragment);

    sheet.hidden = false;
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
  };

  sheet.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-close="sheet"]')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.hidden) close();
  });

  return { open, close, isOpen: () => !sheet.hidden };
}
