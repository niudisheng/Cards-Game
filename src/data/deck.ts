import type { CardId } from '@/core/types';
import { CARDS } from './cards';

/** 初始手牌固定 4 张：盾卫、弓手、斥候、火球。 */
export const INITIAL_HAND: readonly CardId[] = ['shield', 'archer', 'scout', 'fireball'];

/** 展开卡组定义得到 12 张牌。 */
export function buildDeckCards(): CardId[] {
  const cards: CardId[] = [];
  for (const card of CARDS) {
    for (let i = 0; i < card.copies; i += 1) cards.push(card.id);
  }
  return cards;
}

/**
 * 从牌堆中扣除固定初始手牌，其余进入抽牌堆（洗牌由 economy 负责）。
 * 初始手牌必须真实存在于卡组，避免"凭空空投"。
 */
export function splitInitialHand(deck: readonly CardId[]): {
  hand: CardId[];
  rest: CardId[];
} {
  const rest = [...deck];
  const hand: CardId[] = [];
  for (const id of INITIAL_HAND) {
    const index = rest.indexOf(id);
    if (index < 0) throw new Error(`初始手牌 ${id} 不在卡组中`);
    rest.splice(index, 1);
    hand.push(id);
  }
  return { hand, rest };
}
