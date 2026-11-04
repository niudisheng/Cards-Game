import { describe, expect, it } from 'vitest';

import type { CardId, Lane, Row } from '@/core/types';
import { castCard, deployCard, spawnEnemyNow, stepBattle } from '@/sim/battle';
import { createBattleState, type BattleState } from '@/sim/state';

function fresh(seed = 7): BattleState {
  return createBattleState({ seed });
}

function setMana(state: BattleState, mana: number): void {
  state.economy.mana = mana;
}

function handUid(state: BattleState, card: CardId): string {
  const instance = state.economy.hand.find((item) => item.card === card);
  if (!instance) throw new Error(`手牌中没有 ${card}`);
  return instance.uid;
}

function addToHand(state: BattleState, card: CardId): string {
  const uid = `test-${card}`;
  state.economy.hand.push({ uid, card });
  return uid;
}

function idle(state: BattleState, seconds: number, step = 0.05): void {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i += 1) stepBattle(state, step);
}

function clearWaves(state: BattleState): void {
  state.spawnQueue = [];
  state.spawnCursor = 0;
}

function deploy(
  state: BattleState,
  card: CardId,
  lane: Lane,
  row: Row,
): void {
  const result = deployCard(state, handUid(state, card), lane, row);
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
}

describe('部署', () => {
  it('扣魔力、占格、进弃牌堆并记录', () => {
    const state = fresh();
    const uid = handUid(state, 'shield');
    setMana(state, 6);

    const result = deployCard(state, uid, 0, 0);
    expect(result.ok).toBe(true);
    expect(state.units).toHaveLength(1);
    expect(state.units[0]?.card).toBe('shield');
    expect(state.units[0]?.maxHp).toBe(120);
    expect(state.economy.mana).toBe(3);
    expect(state.economy.hand.some((item) => item.uid === uid)).toBe(false);
    expect(state.economy.discardPile).toContain('shield');
    expect(state.stats.cardsPlayed).toBe(1);
    expect(state.stats.unitsDeployed).toBe(1);
  });

  it('同一格不能放第二个单位', () => {
    const state = fresh();
    setMana(state, 10);
    deploy(state, 'shield', 0, 0);

    const result = deployCard(state, handUid(state, 'scout'), 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('已有单位');
    expect(state.units).toHaveLength(1);
  });

  it('费用不足时拒绝且不扣牌', () => {
    const state = fresh();
    setMana(state, 1);
    const uid = handUid(state, 'archer');

    const result = deployCard(state, uid, 1, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('魔力不足');
    expect(state.economy.hand.some((item) => item.uid === uid)).toBe(true);
    expect(state.units).toHaveLength(0);
  });
});

describe('战斗', () => {
  it('敌人被前排单位阻挡并造成伤害', () => {
    const state = fresh();
    clearWaves(state);
    deploy(state, 'shield', 0, 0);
    const shield = state.units[0];
    if (!shield) throw new Error('缺少盾卫');
    const enemy = spawnEnemyNow(state, 0, 'grunt');

    idle(state, 5);

    expect(enemy.progress).toBeLessThanOrEqual(0.2);
    expect(shield.hp).toBeLessThan(120);
    expect(state.barriers[0]).toBe(true);
  });

  it('弓手在射程内自动攻击并击杀小兵', () => {
    const state = fresh();
    clearWaves(state);
    deploy(state, 'archer', 0, 2);
    setMana(state, 10);
    const enemy = spawnEnemyNow(state, 0, 'grunt', 1.2);

    idle(state, 6);

    expect(state.enemies).not.toContain(enemy);
    expect(state.stats.kills).toBe(1);
  });

  it('火球命中目标格同列前后 1 格', () => {
    const state = fresh();
    clearWaves(state);
    const near = spawnEnemyNow(state, 0, 'grunt', 0.2);
    const mid = spawnEnemyNow(state, 0, 'grunt', 0.8);
    const far = spawnEnemyNow(state, 0, 'grunt', 2.5);
    setMana(state, 10);

    const result = castCard(state, handUid(state, 'fireball'), {
      lane: 0,
      row: 0,
    });

    expect(result.ok).toBe(true);
    expect(near.hp).toBe(0);
    expect(mid.hp).toBe(0);
    expect(far.hp).toBe(60);
    expect(state.stats.spellsCast).toBe(1);
  });

  it('冰霜新星让全场敌人减速', () => {
    const state = fresh();
    clearWaves(state);
    const left = spawnEnemyNow(state, 0, 'grunt', 0);
    const right = spawnEnemyNow(state, 1, 'grunt', 0);
    setMana(state, 10);
    const uid = addToHand(state, 'frostNova');

    const result = castCard(state, uid);
    expect(result.ok).toBe(true);
    expect(left.slowFactor).toBeCloseTo(0.6);
    expect(right.slowRemaining).toBe(3);

    idle(state, 2);
    expect(left.progress).toBeLessThan(0.12 * 2);
  });

  it('跳路者在进入中格时换路一次', () => {
    const state = fresh();
    clearWaves(state);
    const jumper = spawnEnemyNow(state, 0, 'jumper', 0.99);

    idle(state, 0.2);

    expect(jumper.lane).toBe(1);
    expect(jumper.jumped).toBe(true);
  });

  it('自爆傀儡死亡时炸到同列前方敌人', () => {
    const state = fresh();
    clearWaves(state);
    setMana(state, 10);
    const bomberUid = addToHand(state, 'bomber');
    const deployed = deployCard(state, bomberUid, 0, 1);
    expect(deployed.ok).toBe(true);
    const bomber = state.units[0];
    if (!bomber) throw new Error('缺少傀儡');
    const front = spawnEnemyNow(state, 0, 'grunt', 0.95);
    const behind = spawnEnemyNow(state, 0, 'grunt', 2.7);

    bomber.hp = 1;
    idle(state, 1);

    expect(state.units).toHaveLength(0);
    expect(front.hp).toBeLessThan(60);
    expect(behind.hp).toBe(60);
  });

  it('Boss 蓄力后命中前方三格并进入冷却', () => {
    const state = fresh();
    clearWaves(state);
    deploy(state, 'shield', 0, 2);
    const shield = state.units[0];
    if (!shield) throw new Error('缺少盾卫');
    const boss = spawnEnemyNow(state, 0, 'boss', 0);

    idle(state, 10.4);

    expect(shield.hp).toBe(60);
    expect(boss.skillCooldown).toBeGreaterThan(7);

    idle(state, 2);
    expect(shield.hp).toBe(60);
  });
});

describe('屏障与胜负', () => {
  it('每路屏障只挡一次漏怪', () => {
    const state = fresh();
    clearWaves(state);
    spawnEnemyNow(state, 0, 'grunt');

    idle(state, 30);

    expect(state.barriers[0]).toBe(false);
    expect(state.stats.leaks[0]).toBe(1);
    expect(state.enemies).toHaveLength(0);
    expect(state.result).toBeNull();

    spawnEnemyNow(state, 0, 'grunt');
    idle(state, 30);

    expect(state.result).toBe('defeat');
    expect(state.resultReason).toContain('左路');
    expect(state.stats.leaks[0]).toBe(2);
  });

  it('Boss 死亡且清场后胜利', () => {
    const state = fresh();
    clearWaves(state);
    deploy(state, 'archer', 0, 2);
    const boss = spawnEnemyNow(state, 0, 'boss', 1.4);
    boss.hp = 1;

    idle(state, 2);

    expect(state.enemies).toHaveLength(0);
    expect(state.bossDefeated).toBe(true);
    expect(state.result).toBe('victory');
  });

  it('临时召唤到期后空出格子', () => {
    const state = fresh();
    clearWaves(state);
    setMana(state, 10);
    const uid = addToHand(state, 'reinforce');

    const result = castCard(state, uid, { lane: 1, row: 1 });
    expect(result.ok).toBe(true);
    expect(state.units[0]?.temporary).toBe(true);

    idle(state, 20.2);

    expect(state.units).toHaveLength(0);
  });
});

describe('法术', () => {
  it('魔力涌动：扣费后回 2 魔力并抽 1 张', () => {
    const state = fresh();
    setMana(state, 2);
    state.economy.hand.pop();
    const uid = addToHand(state, 'surge');
    const handBefore = state.economy.hand.length;

    const result = castCard(state, uid);
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    expect(state.economy.mana).toBe(3);
    expect(state.economy.hand).toHaveLength(handBefore);
    expect(state.economy.drawPile.length).toBe(7);
    expect(state.stats.spellsCast).toBe(1);
  });
});

describe('战斗反馈', () => {
  it('攻击会记录攻击反馈与伤害飘字', () => {
    const state = fresh();
    setMana(state, 10);
    deploy(state, 'archer', 0, 2);
    spawnEnemyNow(state, 0, 'grunt', 0.5);

    stepBattle(state, 0.05);

    expect(state.units[0]?.attackFlash).toBeGreaterThan(0);
    expect(state.floaters.some((f) => f.text === '-12' && f.tone === 'enemyDamage')).toBe(true);
  });

  it('单位受击会出现红色伤害飘字', () => {
    const state = fresh();
    setMana(state, 10);
    deploy(state, 'shield', 0, 0);
    const grunt = spawnEnemyNow(state, 0, 'grunt', 0.04);

    stepBattle(state, 0.05);

    expect(grunt.progress).toBeLessThanOrEqual(0.05);
    expect(state.floaters.some((f) => f.tone === 'unitDamage')).toBe(true);
  });
});
