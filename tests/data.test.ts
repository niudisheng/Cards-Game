import { describe, expect, it } from 'vitest';

import { CARDS, getCard } from '@/data/cards';
import { buildDeckCards, INITIAL_HAND, splitInitialHand } from '@/data/deck';
import { ENEMIES, getEnemy } from '@/data/enemies';
import {
  buildSpawnQueue,
  nextWaveAt,
  phaseAt,
  previewWaveAt,
  WAVES,
  waveAt,
} from '@/data/waves';

describe('卡牌数据', () => {
  it('10 种卡、共 12 张，费用曲线与 GDD 一致', () => {
    expect(CARDS).toHaveLength(10);
    expect(buildDeckCards()).toHaveLength(12);

    const costs = buildDeckCards().map((id) => getCard(id).cost);
    expect(costs.filter((cost) => cost === 1)).toHaveLength(2);
    expect(costs.filter((cost) => cost === 2)).toHaveLength(7);
    expect(costs.filter((cost) => cost === 3)).toHaveLength(3);
  });

  it('每张卡都有描述、角色与配色', () => {
    for (const card of CARDS) {
      expect(card.description.length).toBeGreaterThan(0);
      expect(card.role.length).toBeGreaterThan(0);
      expect(card.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('初始手牌存在于卡组中，余下 8 张进抽牌堆', () => {
    const { hand, rest } = splitInitialHand(buildDeckCards());
    expect(hand).toEqual([...INITIAL_HAND]);
    expect(rest).toHaveLength(8);
  });
});

describe('敌人数据', () => {
  it('6 种敌人，Boss 拥有蓄力技能', () => {
    expect(ENEMIES).toHaveLength(6);
    const boss = getEnemy('boss');
    expect(boss.traits).toContain('boss');
    expect(boss.bossSkill).toMatchObject({ interval: 8, windup: 2, damage: 60, stun: 1 });
  });

  it('跳路者带有 jumper 特性', () => {
    expect(getEnemy('jumper').traits).toContain('jumper');
  });
});

describe('波次时间轴', () => {
  it('四波按时间递增且互不重叠', () => {
    expect(WAVES).toHaveLength(4);
    for (let i = 1; i < WAVES.length; i += 1) {
      const prev = WAVES[i - 1]!;
      const current = WAVES[i]!;
      expect(current.startAt).toBeGreaterThan(prev.startAt);
      expect(prev.endAt).not.toBeNull();
      expect(prev.endAt!).toBeLessThanOrEqual(current.startAt);
    }
  });

  it('刷怪队列稳定有序，数量与数据表一致', () => {
    const queue = buildSpawnQueue();
    expect(queue).toHaveLength(20);
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i]!.at).toBeGreaterThanOrEqual(queue[i - 1]!.at);
    }
    for (const event of queue) {
      const wave = WAVES.find((item) => item.id === event.waveId)!;
      expect(event.at).toBeGreaterThanOrEqual(wave.startAt);
      if (wave.endAt !== null) expect(event.at).toBeLessThan(wave.endAt);
    }
    expect(queue.filter((event) => event.enemy === 'boss')).toHaveLength(1);
  });

  it('阶段切换与预告窗口正确', () => {
    expect(phaseAt(0)).toBe('preparation');
    expect(phaseAt(9.99)).toBe('preparation');
    expect(phaseAt(10)).toBe('wave');
    expect(phaseAt(40)).toBe('intermission');
    expect(phaseAt(55)).toBe('wave');
    expect(phaseAt(150)).toBe('intermission');
    expect(phaseAt(165)).toBe('wave');

    expect(waveAt(30)?.id).toBe('wave-1');
    expect(waveAt(50)).toBeNull();
    expect(nextWaveAt(0)?.id).toBe('wave-1');
    expect(nextWaveAt(10)?.id).toBe('wave-2');
    expect(nextWaveAt(200)).toBeNull();

    expect(previewWaveAt(4)).toBeNull();
    expect(previewWaveAt(5)?.id).toBe('wave-1');
    // Boss 预告窗口提前 15 秒
    expect(previewWaveAt(149)).toBeNull();
    expect(previewWaveAt(150)?.id).toBe('wave-boss');
  });
});
