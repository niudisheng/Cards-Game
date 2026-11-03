import { describe, expect, it } from 'vitest';

import { getCard } from '@/data/cards';
import { TUNING } from '@/data/tuning';
import {
  addMana,
  canAfford,
  commitCardPlay,
  createEconomy,
  drawCards,
  regenerateMana,
  tickEconomy,
} from '@/sim/economy';

describe('createEconomy', () => {
  it('初始固定手牌 4 张、抽牌堆 8 张、魔力 5', () => {
    const econ = createEconomy(42);
    expect(econ.hand.map((instance) => instance.card)).toEqual([
      'shield',
      'archer',
      'scout',
      'fireball',
    ]);
    expect(econ.drawPile).toHaveLength(8);
    expect(econ.discardPile).toHaveLength(0);
    expect(econ.mana).toBe(TUNING.mana.start);
    expect(econ.hand).toHaveLength(TUNING.hand.max);
  });

  it('同一 seed 的抽牌顺序可复现', () => {
    expect(createEconomy(7).drawPile).toEqual(createEconomy(7).drawPile);
  });
});

describe('魔力恢复', () => {
  it('按 0.6/s 累积，满魔后返回溢出量', () => {
    const econ = createEconomy(1);
    econ.mana = TUNING.mana.max - 0.3;
    expect(regenerateMana(econ, 1)).toBeCloseTo(0.3, 6);
    expect(econ.mana).toBe(TUNING.mana.max);
  });

  it('addMana 不会超过上限，并返回实际获得量', () => {
    const econ = createEconomy(1);
    econ.mana = 9;
    expect(addMana(econ, 2)).toBeCloseTo(1, 6);
    expect(econ.mana).toBe(TUNING.mana.max);
  });
});

describe('自然抽牌', () => {
  it('3.5 秒抽一张，之前不抽', () => {
    const econ = createEconomy(3);
    // 手牌已满时计时冻结，先打出一张腾出位置
    expect(commitCardPlay(econ, econ.hand[2]!.uid)).toBe('scout');

    expect(tickEconomy(econ, 3.4).drawn).toHaveLength(0);
    expect(econ.hand).toHaveLength(3);

    const result = tickEconomy(econ, 0.1);
    expect(result.drawn).toHaveLength(1);
    expect(econ.hand).toHaveLength(4);
  });

  it('满手时抽牌计时冻结，出牌后从原进度继续', () => {
    const econ = createEconomy(5);
    econ.mana = 0;
    tickEconomy(econ, 10);
    expect(econ.drawTimer).toBe(0);
    expect(econ.hand).toHaveLength(4);

    commitCardPlay(econ, econ.hand[0]!.uid);
    tickEconomy(econ, 1.2);
    expect(econ.hand).toHaveLength(3);
    expect(econ.drawTimer).toBeCloseTo(1.2, 6);
  });

  it('手牌满时强制抽牌会爆牌进入弃牌堆', () => {
    const econ = createEconomy(9);
    const top = econ.drawPile[0]!;
    const outcomes = drawCards(econ, 1);
    expect(outcomes).toEqual([{ card: top, burned: true }]);
    expect(econ.discardPile).toEqual([top]);
    expect(econ.hand).toHaveLength(4);
  });

  it('抽牌堆空时把弃牌堆洗回，并累计洗牌次数', () => {
    const econ = createEconomy(11);
    econ.hand.pop();
    econ.drawPile = [];
    econ.discardPile = ['fireball', 'surge'];

    const outcomes = drawCards(econ, 1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.burned).toBe(false);
    expect(econ.shuffleCount).toBe(1);
    expect(econ.hand).toHaveLength(4);
    expect(econ.drawPile.length + econ.discardPile.length).toBe(1);
  });
});

describe('出牌', () => {
  it('commitCardPlay 扣费并把卡移入弃牌堆', () => {
    const econ = createEconomy(1);
    const shield = econ.hand.find((instance) => instance.card === 'shield')!;
    expect(commitCardPlay(econ, shield.uid)).toBe('shield');
    expect(econ.mana).toBe(TUNING.mana.start - getCard('shield').cost);
    expect(econ.hand.some((instance) => instance.uid === shield.uid)).toBe(false);
    expect(econ.discardPile).toEqual(['shield']);
  });

  it('费用不足或 uid 不存在时返回 null 且不扣费', () => {
    const econ = createEconomy(1);
    econ.mana = 0;
    expect(commitCardPlay(econ, econ.hand[0]!.uid)).toBeNull();
    expect(econ.mana).toBe(0);
    expect(commitCardPlay(econ, 'missing')).toBeNull();
    expect(canAfford(econ, 1)).toBe(false);
  });
});
