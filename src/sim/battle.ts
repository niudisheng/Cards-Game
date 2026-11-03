import { laneName } from '@/core/grid';
import type { Lane, Row } from '@/core/types';
import { getCard } from '@/data/cards';
import { getEnemy } from '@/data/enemies';
import type { CardDef, UnitStats } from '@/data/schema';
import { TUNING } from '@/data/tuning';
import { phaseAt } from '@/data/waves';
import {
  addMana,
  canAfford,
  commitCardPlay,
  drawCards,
  findHandCard,
  tickEconomy,
} from './economy';
import { createEffect, createEnemy, createUnit, type Enemy, type Unit } from './entities';
import type { BattleState } from './state';

export type ActionResult = { ok: true } | { ok: false; reason: string };

export interface SpellTarget {
  lane: Lane;
  row: Row;
}

/** 卡牌需要的目标类型（单位卡直接选格子部署）。 */
export function cardTargetMode(card: CardDef): 'unit' | 'cell' | 'enemy' | 'global' {
  if (card.kind === 'unit') return 'unit';
  return card.target;
}

export function cellUnit(state: BattleState, lane: Lane, row: Row): Unit | undefined {
  return state.units.find((unit) => unit.lane === lane && unit.row === row && unit.hp > 0);
}

function playBlockedReason(state: BattleState): string | null {
  if (state.result) return '本局已经结束';
  if (state.paused) return '暂停中不能出牌';
  return null;
}

function recordPlay(state: BattleState): void {
  state.stats.cardsPlayed += 1;
  state.stats.playTimestamps.push(state.elapsed);
}

// ---------------------------------------------------------------------------
// 玩家操作
// ---------------------------------------------------------------------------

export function canDeployCard(
  state: BattleState,
  uid: string,
  lane: Lane,
  row: Row,
): ActionResult {
  const blocked = playBlockedReason(state);
  if (blocked) return { ok: false, reason: blocked };

  const instance = findHandCard(state.economy, uid);
  if (!instance) return { ok: false, reason: '这张牌已不在手上' };
  const card = getCard(instance.card);
  if (card.kind !== 'unit') return { ok: false, reason: '这张牌不是单位' };
  if (!canAfford(state.economy, card.cost)) return { ok: false, reason: '魔力不足' };
  if (cellUnit(state, lane, row)) return { ok: false, reason: '该格已有单位' };
  return { ok: true };
}

export function deployCard(
  state: BattleState,
  uid: string,
  lane: Lane,
  row: Row,
): ActionResult {
  const check = canDeployCard(state, uid, lane, row);
  if (!check.ok) return check;

  const played = commitCardPlay(state.economy, uid);
  if (!played) return { ok: false, reason: '出牌失败' };

  const unit = createUnit(state, played, lane, row);
  state.units.push(unit);
  state.stats.unitsDeployed += 1;
  recordPlay(state);
  createEffect(state, {
    kind: 'spawn',
    lane,
    row,
    ttl: 0.45,
    maxTtl: 0.45,
    color: getCard(played).accent,
  });
  return { ok: true };
}

export function canCastCard(
  state: BattleState,
  uid: string,
  target?: SpellTarget,
): ActionResult {
  const blocked = playBlockedReason(state);
  if (blocked) return { ok: false, reason: blocked };

  const instance = findHandCard(state.economy, uid);
  if (!instance) return { ok: false, reason: '这张牌已不在手上' };
  const card = getCard(instance.card);
  if (card.kind !== 'spell') return { ok: false, reason: '这张牌不是法术' };
  if (!canAfford(state.economy, card.cost)) return { ok: false, reason: '魔力不足' };

  if (card.target === 'cell') {
    if (!target) return { ok: false, reason: '请选择一个格子' };
    if (card.effect.kind === 'summon' && cellUnit(state, target.lane, target.row)) {
      return { ok: false, reason: '召唤需要空格' };
    }
  }
  if (card.target === 'enemy' && !target) {
    return { ok: false, reason: '请选择一个敌人' };
  }
  return { ok: true };
}

export function castCard(
  state: BattleState,
  uid: string,
  target?: SpellTarget,
): ActionResult {
  const check = canCastCard(state, uid, target);
  if (!check.ok) return check;

  const instance = findHandCard(state.economy, uid);
  if (!instance) return { ok: false, reason: '这张牌已不在手上' };
  const card = getCard(instance.card);
  if (card.kind !== 'spell') return { ok: false, reason: '这张牌不是法术' };

  const played = commitCardPlay(state.economy, uid);
  if (!played) return { ok: false, reason: '出牌失败' };

  const effect = card.effect;
  if (effect.kind === 'areaDamage' && target) {
    const hit = state.enemies.filter(
      (enemy) =>
        enemy.lane === target.lane && Math.abs(enemyCell(enemy) - target.row) <= effect.rows,
    );
    for (const enemy of hit) damageEnemy(state, enemy, effect.damage);
    createEffect(state, {
      kind: 'burst',
      lane: target.lane,
      row: target.row,
      ttl: 0.5,
      maxTtl: 0.5,
      color: card.accent,
    });
  } else if (effect.kind === 'slowAll') {
    for (const enemy of state.enemies) {
      enemy.slowFactor = Math.min(enemy.slowFactor, effect.factor);
      enemy.slowRemaining = Math.max(enemy.slowRemaining, effect.duration);
    }
    createEffect(state, { kind: 'nova', ttl: 0.6, maxTtl: 0.6, color: card.accent });
  } else if (effect.kind === 'summon' && target) {
    const stats: UnitStats = effect.stats;
    const unit = createUnit(state, 'reinforce', target.lane, target.row, {
      stats,
      lifespan: effect.duration,
      temporary: true,
    });
    state.units.push(unit);
    state.stats.unitsDeployed += 1;
    createEffect(state, {
      kind: 'spawn',
      lane: target.lane,
      row: target.row,
      ttl: 0.45,
      maxTtl: 0.45,
      color: card.accent,
    });
  } else if (effect.kind === 'manaAndDraw') {
    addMana(state.economy, effect.mana);
    drawCards(state.economy, effect.cards);
    createEffect(state, { kind: 'nova', ttl: 0.35, maxTtl: 0.35, color: card.accent });
  }

  state.stats.spellsCast += 1;
  recordPlay(state);
  return { ok: true };
}

/** 供调试面板/测试直接放一个敌人。 */
export function spawnEnemyNow(
  state: BattleState,
  lane: Lane,
  enemyId: Enemy['enemy'],
  progress = 0.15,
): Enemy {
  const enemy = createEnemy(state, enemyId, lane, progress);
  state.enemies.push(enemy);
  if (enemy.boss) state.bossSpawned = true;
  return enemy;
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

export function stepBattle(state: BattleState, dt: number): void {
  if (state.result || state.paused || dt <= 0) return;

  state.elapsed += dt;
  state.phase = phaseAt(state.elapsed);

  spawnDueEnemies(state);

  const economy = tickEconomy(state.economy, dt);
  state.stats.manaOverflow += economy.manaOverflow;

  updateEffects(state, dt);
  updateEnemies(state, dt);
  if (state.result) return;
  updateUnits(state, dt);
  checkVictory(state);
}

function spawnDueEnemies(state: BattleState): void {
  while (state.spawnCursor < state.spawnQueue.length) {
    const event = state.spawnQueue[state.spawnCursor];
    if (!event || event.at > state.elapsed + 1e-9) break;
    state.spawnCursor += 1;
    const enemy = createEnemy(state, event.enemy, event.lane);
    state.enemies.push(enemy);
    if (enemy.boss) state.bossSpawned = true;
    createEffect(state, {
      kind: 'spawn',
      lane: event.lane,
      ttl: 0.5,
      maxTtl: 0.5,
      color: getEnemy(enemy.enemy).color,
    });
  }
}

function updateEffects(state: BattleState, dt: number): void {
  for (const effect of state.effects) effect.ttl -= dt;
  state.effects = state.effects.filter((effect) => effect.ttl > 0);
}

function updateEnemies(state: BattleState, dt: number): void {
  for (const enemy of [...state.enemies]) {
    if (!state.enemies.includes(enemy)) continue;
    if (state.result) return;

    if (enemy.slowRemaining > 0) {
      enemy.slowRemaining = Math.max(0, enemy.slowRemaining - dt);
      if (enemy.slowRemaining === 0) enemy.slowFactor = 1;
    }

    if (enemy.stunRemaining > 0) {
      enemy.stunRemaining = Math.max(0, enemy.stunRemaining - dt);
      continue;
    }

    if (enemy.bossSkill) {
      if (enemy.windupRemaining > 0) {
        enemy.windupRemaining = Math.max(0, enemy.windupRemaining - dt);
        if (enemy.windupRemaining === 0) castBossSkill(state, enemy);
        continue;
      }
      enemy.skillCooldown = Math.max(0, enemy.skillCooldown - dt);
      if (enemy.skillCooldown === 0) {
        enemy.windupRemaining = enemy.bossSkill.windup;
        createEffect(state, {
          kind: 'burst',
          lane: enemy.lane,
          ttl: enemy.bossSkill.windup,
          maxTtl: enemy.bossSkill.windup,
          color: '#ff5f6d',
        });
        continue;
      }
    }

    if (
      !enemy.jumped &&
      enemy.progress >= 1 &&
      getEnemy(enemy.enemy).traits?.includes('jumper')
    ) {
      const other = (enemy.lane === 0 ? 1 : 0) as Lane;
      enemy.lane = other;
      enemy.jumped = true;
      createEffect(state, {
        kind: 'burst',
        lane: other,
        row: 1,
        ttl: 0.6,
        maxTtl: 0.6,
        color: getEnemy(enemy.enemy).color,
      });
    }

    const blocker = findBlocker(state, enemy);
    const standoff = enemy.range >= 2 ? 0.45 : 0.05;
    if (blocker) {
      const stop = Math.max(0.03, blocker.row - standoff);
      if (enemy.progress >= stop) {
        enemy.attackCooldown -= dt;
        if (enemy.attackCooldown <= 0) {
          damageUnit(state, blocker, enemy.attack);
          enemy.attackCooldown = enemy.attackInterval;
        }
        continue;
      }
    }

    const slow = enemy.slowRemaining > 0 ? enemy.slowFactor : 1;
    enemy.progress += enemy.speed * slow * dt;
    if (enemy.progress >= TUNING.board.rows) {
      breach(state, enemy);
      if (state.result) return;
    }
  }
}

function findBlocker(state: BattleState, enemy: Enemy): Unit | null {
  let best: Unit | null = null;
  for (const unit of state.units) {
    if (unit.lane !== enemy.lane || unit.hp <= 0) continue;
    if (unit.row + 0.95 < enemy.progress) continue;
    if (!best || unit.row < best.row) best = unit;
  }
  return best;
}

function updateUnits(state: BattleState, dt: number): void {
  for (const unit of [...state.units]) {
    if (!state.units.includes(unit)) continue;

    if (unit.lifespan !== null) {
      unit.lifespan -= dt;
      if (unit.lifespan <= 0) {
        removeUnit(state, unit, false);
        continue;
      }
    }

    if (unit.stunRemaining > 0) {
      unit.stunRemaining = Math.max(0, unit.stunRemaining - dt);
      continue;
    }

    if (unit.attack <= 0 || unit.attackInterval <= 0) continue;

    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    if (unit.attackCooldown > 0) continue;

    const target = findUnitTarget(state, unit);
    if (!target) continue;

    damageEnemy(state, target, unit.attack);
    unit.attackCooldown = effectiveAttackInterval(state, unit);
    if (unit.slowOnHit && target.hp > 0) {
      target.slowFactor = Math.min(target.slowFactor, unit.slowOnHit.factor);
      target.slowRemaining = Math.max(target.slowRemaining, unit.slowOnHit.duration);
    }
  }
}

function findUnitTarget(state: BattleState, unit: Unit): Enemy | null {
  let best: Enemy | null = null;
  for (const enemy of state.enemies) {
    if (enemy.lane !== unit.lane || enemy.hp <= 0) continue;
    if (enemy.progress < unit.row - unit.range) continue;
    if (enemy.progress > unit.row + 1) continue;
    if (!best || enemy.progress > best.progress) best = enemy;
  }
  return best;
}

function effectiveAttackInterval(state: BattleState, unit: Unit): number {
  const hasAura = state.units.some(
    (other) => other.hp > 0 && (other.auraBonus ?? 0) > 0 && Math.abs(other.lane - unit.lane) <= 1,
  );
  if (!hasAura) return unit.attackInterval;
  return unit.attackInterval / 1.15;
}

// ---------------------------------------------------------------------------
// 伤害、死亡与漏怪
// ---------------------------------------------------------------------------

export function enemyCell(enemy: Enemy): number {
  return Math.max(0, Math.min(TUNING.board.rows - 1, Math.floor(enemy.progress)));
}

function damageEnemy(state: BattleState, enemy: Enemy, amount: number): void {
  if (enemy.hp <= 0 || amount <= 0) return;
  enemy.hp -= amount;
  if (enemy.hp <= 0) killEnemy(state, enemy);
}

function killEnemy(state: BattleState, enemy: Enemy): void {
  const index = state.enemies.indexOf(enemy);
  if (index < 0) return;
  state.enemies.splice(index, 1);
  state.stats.kills += 1;
  if (enemy.boss) state.bossDefeated = true;
  createEffect(state, {
    kind: 'burst',
    lane: enemy.lane,
    row: enemyCell(enemy) as Row,
    ttl: 0.45,
    maxTtl: 0.45,
    color: getEnemy(enemy.enemy).color,
  });
}

function damageUnit(state: BattleState, unit: Unit, amount: number): void {
  if (unit.hp <= 0 || amount <= 0) return;
  unit.hp -= amount;
  if (unit.hp <= 0) removeUnit(state, unit, true);
}

function removeUnit(state: BattleState, unit: Unit, died: boolean): void {
  const index = state.units.indexOf(unit);
  if (index < 0) return;
  state.units.splice(index, 1);

  if (died && unit.onDeath?.kind === 'explode') {
    const blast = state.enemies.filter(
      (enemy) =>
        enemy.lane === unit.lane &&
        enemy.progress >= unit.row - unit.onDeath!.rows &&
        enemy.progress <= unit.row + 1,
    );
    for (const enemy of blast) damageEnemy(state, enemy, unit.onDeath.damage);
    createEffect(state, {
      kind: 'burst',
      lane: unit.lane,
      row: unit.row,
      ttl: 0.5,
      maxTtl: 0.5,
      color: '#ef6f6c',
    });
  }

  createEffect(state, {
    kind: 'burst',
    lane: unit.lane,
    row: unit.row,
    ttl: 0.3,
    maxTtl: 0.3,
    color: died ? '#ef6f6c' : '#7fb7ff',
  });
}

function castBossSkill(state: BattleState, boss: Enemy): void {
  const skill = boss.bossSkill;
  if (!skill) return;
  for (const unit of [...state.units]) {
    if (unit.lane !== boss.lane) continue;
    // Boss 朝核心推进，"前方 3 格"是行号更大的格子。
    if (unit.row < boss.progress - 1) continue;
    if (unit.row > boss.progress + skill.rows) continue;
    unit.stunRemaining = Math.max(unit.stunRemaining, skill.stun);
    damageUnit(state, unit, skill.damage);
  }
  boss.skillCooldown = skill.interval;
  createEffect(state, {
    kind: 'nova',
    lane: boss.lane,
    ttl: 0.7,
    maxTtl: 0.7,
    color: '#ff5f6d',
  });
}

function breach(state: BattleState, enemy: Enemy): void {
  const lane = enemy.lane;
  enemy.progress = TUNING.board.rows;
  state.stats.leaks[lane] += 1;

  if (!state.barriers[lane]) {
    state.result = 'defeat';
    state.phase = 'defeat';
    state.resultReason = `${laneName(lane)}失守`;
    createEffect(state, { kind: 'nova', lane, ttl: 1, maxTtl: 1, color: '#ff5f6d' });
    return;
  }

  state.barriers[lane] = false;
  createEffect(state, {
    kind: 'barrier',
    lane,
    ttl: 1,
    maxTtl: 1,
    color: '#8fd3ff',
  });

  // Boss 不吃清场：受 100 伤害、击退回入口并眩晕 5 秒。
  for (const other of [...state.enemies]) {
    if (other.lane !== lane || !other.boss) continue;
    damageEnemy(state, other, TUNING.barrier.bossDamage);
    if (other.hp > 0) {
      other.progress = 0.15;
      other.windupRemaining = 0;
      other.stunRemaining = TUNING.barrier.bossStunSeconds;
      other.skillCooldown = other.bossSkill?.interval ?? 0;
    }
  }

  // 该路非 Boss 敌人全部清场。
  state.enemies = state.enemies.filter((other) => other.lane !== lane || other.boss);
}

function checkVictory(state: BattleState): void {
  if (state.result || !state.bossDefeated) return;
  if (state.spawnCursor < state.spawnQueue.length) return;
  if (state.enemies.some((enemy) => enemy.hp > 0)) return;

  state.result = 'victory';
  state.phase = 'victory';
  state.resultReason = 'Boss 已被击败，两路核心守住';
  createEffect(state, { kind: 'nova', ttl: 1, maxTtl: 1, color: '#ffd166' });
}
