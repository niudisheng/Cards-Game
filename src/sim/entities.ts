import type { CardId, EnemyId, Lane, Row } from '@/core/types';
import type { DeathEffect, UnitStats } from '@/data/schema';
import { getCard } from '@/data/cards';
import { getEnemy } from '@/data/enemies';
import type { BattleState } from './state';

/** 单位实例：部署后不再移动，占一个格子。 */
export interface Unit {
  id: string;
  card: CardId;
  lane: Lane;
  row: Row;
  hp: number;
  maxHp: number;
  attack: number;
  /** 基础攻击间隔（秒），实际间隔会被旗手光环缩短。 */
  attackInterval: number;
  attackCooldown: number;
  range: number;
  /** 剩余存活时间（秒）；null = 永久。 */
  lifespan: number | null;
  temporary: boolean;
  stunRemaining: number;
  /** 攻击/受击的短暂表现计时，仅供渲染层使用。 */
  attackFlash: number;
  hitFlash: number;
  slowOnHit?: { factor: number; duration: number };
  auraBonus?: number;
  onDeath?: DeathEffect;
}

/** 敌人实例：progress 为沿本路推进的距离，单位是"格"，0 = 第一排上沿，3 = 核心。 */
export interface Enemy {
  id: string;
  enemy: EnemyId;
  lane: Lane;
  progress: number;
  hp: number;
  maxHp: number;
  speed: number;
  attack: number;
  attackInterval: number;
  attackCooldown: number;
  range: number;
  slowFactor: number;
  slowRemaining: number;
  stunRemaining: number;
  attackFlash: number;
  hitFlash: number;
  jumped: boolean;
  skillCooldown: number;
  windupRemaining: number;
  boss: boolean;
  bossSkill?: {
    interval: number;
    windup: number;
    damage: number;
    rows: number;
    stun: number;
  };
}

export type EffectKind = 'burst' | 'nova' | 'barrier' | 'spawn';

export type FloaterTone = 'enemyDamage' | 'unitDamage' | 'status' | 'notice';

/** 飘字：伤害数字、减速/眩晕、漏怪等瞬时战斗反馈。 */
export interface Floater {
  id: string;
  lane: Lane;
  /** 单位/核心位置：行号。 */
  row?: Row;
  /** 敌人位置：以格为单位的推进距离。 */
  progress?: number;
  text: string;
  tone: FloaterTone;
  ttl: number;
  maxTtl: number;
}

/** 纯表现效果，sim 只负责倒计时，渲染层决定怎么画。 */
export interface Effect {
  id: string;
  kind: EffectKind;
  lane?: Lane;
  row?: Row;
  progress?: number;
  ttl: number;
  maxTtl: number;
  color: string;
}

export function nextId(state: BattleState, prefix: 'u' | 'e' | 'fx' | 'f'): string {
  state.nextId += 1;
  return `${prefix}${state.nextId}`;
}

export function createUnit(
  state: BattleState,
  card: CardId,
  lane: Lane,
  row: Row,
  options: { stats?: UnitStats; lifespan?: number | null; temporary?: boolean } = {},
): Unit {
  const def = getCard(card);
  const stats = options.stats ?? (def.kind === 'unit' ? def.stats : null);
  if (!stats) throw new Error(`${card} 不是单位卡`);

  return {
    id: nextId(state, 'u'),
    card,
    lane,
    row,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    attackInterval: stats.attackInterval,
    attackCooldown: 0,
    range: stats.range,
    lifespan: options.lifespan ?? stats.lifespan ?? null,
    temporary: options.temporary ?? false,
    stunRemaining: 0,
    attackFlash: 0,
    hitFlash: 0,
    slowOnHit: def.kind === 'unit' ? def.slowOnHit : undefined,
    auraBonus: def.kind === 'unit' ? def.aura?.attackSpeedBonus : undefined,
    onDeath: def.kind === 'unit' ? def.onDeath : undefined,
  };
}

export function createEnemy(
  state: BattleState,
  enemyId: EnemyId,
  lane: Lane,
  progress = 0.15,
): Enemy {
  const def = getEnemy(enemyId);
  return {
    id: nextId(state, 'e'),
    enemy: enemyId,
    lane,
    progress,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed,
    attack: def.attack,
    attackInterval: def.attackInterval,
    attackCooldown: 0,
    range: def.range,
    slowFactor: 1,
    slowRemaining: 0,
    stunRemaining: 0,
    attackFlash: 0,
    hitFlash: 0,
    jumped: false,
    skillCooldown: def.bossSkill?.interval ?? 0,
    windupRemaining: 0,
    boss: def.traits?.includes('boss') ?? false,
    bossSkill: def.bossSkill,
  };
}

export function createEffect(
  state: BattleState,
  effect: Omit<Effect, 'id' | 'ttl'> & { ttl?: number },
): Effect {
  const ttl = effect.ttl ?? 0.6;
  const instance: Effect = { ...effect, id: nextId(state, 'fx'), ttl };
  state.effects.push(instance);
  return instance;
}
