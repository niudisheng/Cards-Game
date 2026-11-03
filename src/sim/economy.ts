import { createRng } from '@/core/rng';
import type { CardId } from '@/core/types';
import { getCard } from '@/data/cards';
import { buildDeckCards, splitInitialHand } from '@/data/deck';
import { TUNING } from '@/data/tuning';

export interface CardInstance {
  uid: string;
  card: CardId;
}

export interface EconomyState {
  mana: number;
  hand: CardInstance[];
  drawPile: CardId[];
  discardPile: CardId[];
  /** 自然抽牌计时（秒）；手牌满时冻结。 */
  drawTimer: number;
  nextUid: number;
  /** 洗牌使用的种子；与 shuffleCount 一起保证可复现。 */
  shuffleSeed: number;
  shuffleCount: number;
}

export interface EconomyTickResult {
  /** 因魔力已满而浪费的恢复量。 */
  manaOverflow: number;
  drawn: CardId[];
}

export interface DrawOutcome {
  card: CardId;
  /** 手牌已满时抽到的牌直接进弃牌堆（爆牌）。 */
  burned: boolean;
}

function makeInstance(economy: EconomyState, card: CardId): CardInstance {
  const uid = `c${economy.nextUid}`;
  economy.nextUid += 1;
  return { uid, card };
}

/** 创建初始经济状态：固定手牌 4 张、初始魔力 5、其余 8 张洗入抽牌堆。 */
export function createEconomy(seed = 1, deck: readonly CardId[] = buildDeckCards()): EconomyState {
  const { hand, rest } = splitInitialHand(deck);
  const state: EconomyState = {
    mana: TUNING.mana.start,
    hand: [],
    drawPile: [],
    discardPile: [],
    drawTimer: 0,
    nextUid: 1,
    shuffleSeed: seed >>> 0,
    shuffleCount: 0,
  };
  for (const card of hand) state.hand.push(makeInstance(state, card));
  state.drawPile = createRng(seed).shuffle(rest);
  return state;
}

/** 魔力恢复；满魔部分计入 overflow，供模拟统计"魔力满溢时间"。 */
export function regenerateMana(economy: EconomyState, dt: number): number {
  if (dt <= 0) return 0;
  const before = economy.mana;
  economy.mana = Math.min(TUNING.mana.max, before + TUNING.mana.regenPerSecond * dt);
  const overflow = TUNING.mana.regenPerSecond * dt - (economy.mana - before);
  return Math.max(0, overflow);
}

/** 抽牌堆空时把弃牌堆洗回；随机源由种子 + 洗牌次数推导，保证可复现。 */
function reshuffleDiscard(economy: EconomyState): void {
  if (economy.discardPile.length === 0) return;
  economy.shuffleCount += 1;
  const seed = (economy.shuffleSeed + Math.imul(economy.shuffleCount, 0x9e3779b1)) >>> 0;
  economy.drawPile = createRng(seed).shuffle(economy.discardPile);
  economy.discardPile = [];
}

function takeFromPiles(economy: EconomyState): CardId | null {
  if (economy.drawPile.length === 0) reshuffleDiscard(economy);
  return economy.drawPile.shift() ?? null;
}

/**
 * 抽牌：手牌满时抽到的牌直接进弃牌堆（爆牌），用于"魔力涌动"这类强制抽牌。
 * 自然抽牌不会调用到爆牌分支（满手时计时冻结）。
 */
export function drawCards(economy: EconomyState, count: number): DrawOutcome[] {
  const outcomes: DrawOutcome[] = [];
  for (let i = 0; i < count; i += 1) {
    const card = takeFromPiles(economy);
    if (!card) break;
    if (economy.hand.length >= TUNING.hand.max) {
      economy.discardPile.push(card);
      outcomes.push({ card, burned: true });
    } else {
      economy.hand.push(makeInstance(economy, card));
      outcomes.push({ card, burned: false });
    }
  }
  return outcomes;
}

/** 经济推进：魔力恢复 → 自然抽牌。手牌满时抽牌计时冻结。 */
export function tickEconomy(economy: EconomyState, dt: number): EconomyTickResult {
  const manaOverflow = regenerateMana(economy, dt);
  const drawn: CardId[] = [];

  if (economy.hand.length < TUNING.hand.max) {
    economy.drawTimer += dt;
    while (
      economy.drawTimer >= TUNING.hand.drawIntervalSeconds &&
      economy.hand.length < TUNING.hand.max
    ) {
      economy.drawTimer -= TUNING.hand.drawIntervalSeconds;
      for (const outcome of drawCards(economy, 1)) {
        if (!outcome.burned) drawn.push(outcome.card);
      }
    }
  }

  return { manaOverflow, drawn };
}

/** 获得魔力（如魔力涌动），返回实际获得量。 */
export function addMana(economy: EconomyState, amount: number): number {
  const before = economy.mana;
  economy.mana = Math.min(TUNING.mana.max, before + amount);
  return economy.mana - before;
}

export function canAfford(economy: EconomyState, cost: number): boolean {
  return economy.mana >= cost;
}

export function findHandCard(economy: EconomyState, uid: string): CardInstance | undefined {
  return economy.hand.find((instance) => instance.uid === uid);
}

export function canPlayCard(economy: EconomyState, uid: string): boolean {
  const instance = findHandCard(economy, uid);
  if (!instance) return false;
  return canAfford(economy, getCard(instance.card).cost);
}

/** 扣除费用并把卡移入弃牌堆；成功后返回卡牌 id。 */
export function commitCardPlay(economy: EconomyState, uid: string): CardId | null {
  const index = economy.hand.findIndex((instance) => instance.uid === uid);
  if (index < 0) return null;
  const instance = economy.hand[index] as CardInstance;
  const card = getCard(instance.card);
  if (economy.mana < card.cost) return null;
  economy.mana -= card.cost;
  economy.hand.splice(index, 1);
  economy.discardPile.push(instance.card);
  return instance.card;
}

/** 手牌总费用，供调试/模拟使用。 */
export function handCost(economy: EconomyState): number {
  return economy.hand.reduce((sum, instance) => sum + getCard(instance.card).cost, 0);
}
