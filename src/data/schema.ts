import type { CardId, EnemyId, Lane } from '@/core/types';

export type CardKind = 'unit' | 'spell';

/** 法术目标类型：格子 / 敌人 / 全场。 */
export type TargetMode = 'cell' | 'enemy' | 'global';

export interface UnitStats {
  maxHp: number;
  attack: number;
  /** 攻击间隔（秒）；0 表示不攻击。 */
  attackInterval: number;
  range: number;
  /** 临时单位存活时间（秒）；永久单位不填。 */
  lifespan?: number;
}

/** 死亡后触发的效果，目前只有自爆傀儡。 */
export interface DeathEffect {
  kind: 'explode';
  damage: number;
  /** 向前方影响的格数（不含自身）。 */
  rows: number;
}

export interface UnitDef {
  kind: 'unit';
  stats: UnitStats;
  /** 是否阻挡敌人（敌人碰到该格停下）。 */
  blocks: boolean;
  /** 命中后减速。 */
  slowOnHit?: { factor: number; duration: number };
  /** 光环：同列及相邻列单位攻速加成，不叠加。 */
  aura?: { attackSpeedBonus: number };
  onDeath?: DeathEffect;
}

export type SpellEffect =
  | { kind: 'areaDamage'; damage: number; rows: number }
  | { kind: 'slowAll'; factor: number; duration: number }
  | { kind: 'summon'; stats: UnitStats; duration: number }
  | { kind: 'manaAndDraw'; mana: number; cards: number };

export interface SpellDef {
  kind: 'spell';
  target: TargetMode;
  effect: SpellEffect;
}

interface CardBase {
  id: CardId;
  name: string;
  cost: number;
  /** 卡组中的张数。 */
  copies: number;
  /** 一句话定位，用于手牌与详情。 */
  role: string;
  description: string;
  emoji: string;
  /** 卡面强调色。 */
  accent: string;
}

export type CardDef = CardBase & (UnitDef | SpellDef);

export type EnemyTrait = 'jumper' | 'boss';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  hp: number;
  /** 格/秒。 */
  speed: number;
  attack: number;
  attackInterval: number;
  range: number;
  emoji: string;
  color: string;
  traits?: readonly EnemyTrait[];
  /** Boss 蓄力技能。 */
  bossSkill?: {
    interval: number;
    windup: number;
    damage: number;
    rows: number;
    stun: number;
  };
}

/** 一组同时段刷新的敌人。 */
export interface SpawnGroup {
  /** 相对开局秒数。 */
  at: number;
  lane: Lane;
  enemy: EnemyId;
  count: number;
  /** 同组内刷新间隔（秒）。 */
  interval: number;
}

export interface WaveDef {
  id: string;
  /** 从 1 开始；准备阶段不算波次。 */
  index: number;
  name: string;
  startAt: number;
  /** null 表示直到清场才结束（Boss 波）。 */
  endAt: number | null;
  /** 提前多少秒显示路线预告。 */
  previewLead: number;
  spawns: readonly SpawnGroup[];
}

/** 由波次表展开后的单次刷怪事件。 */
export interface SpawnEvent {
  at: number;
  lane: Lane;
  enemy: EnemyId;
  waveId: string;
}
