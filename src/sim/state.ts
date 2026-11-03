import type { Lane, Phase } from '@/core/types';
import type { SpawnEvent } from '@/data/schema';
import { buildSpawnQueue } from '@/data/waves';
import { createEconomy, type EconomyState } from './economy';
import type { Effect, Enemy, Unit } from './entities';

export type BattleResult = 'victory' | 'defeat';

export interface BattleStats {
  cardsPlayed: number;
  unitsDeployed: number;
  /** 魔力满溢的累计量，用于平衡模拟。 */
  manaOverflow: number;
  /** 出牌时间点（秒），用于统计平均出牌间隔。 */
  playTimestamps: number[];
  kills: number;
  spellsCast: number;
  /** 每路漏怪次数（触发屏障也算一次）。 */
  leaks: Record<Lane, number>;
}

export interface BattleState {
  /** 本局随机种子，便于复现与调试。 */
  seed: number;
  phase: Phase;
  /** 局内逻辑时间（秒），暂停时不增长。 */
  elapsed: number;
  paused: boolean;
  economy: EconomyState;
  /** true = 该路屏障完好。 */
  barriers: Record<Lane, boolean>;
  units: Unit[];
  enemies: Enemy[];
  spawnQueue: SpawnEvent[];
  spawnCursor: number;
  nextId: number;
  effects: Effect[];
  result: BattleResult | null;
  resultReason: string;
  bossSpawned: boolean;
  bossDefeated: boolean;
  stats: BattleStats;
}

export interface CreateBattleOptions {
  seed?: number;
}

export function createBattleState(options: CreateBattleOptions = {}): BattleState {
  const seed = options.seed ?? (Date.now() >>> 0);
  return {
    seed,
    phase: 'preparation',
    elapsed: 0,
    paused: false,
    economy: createEconomy(seed),
    barriers: { 0: true, 1: true },
    units: [],
    enemies: [],
    spawnQueue: buildSpawnQueue(),
    spawnCursor: 0,
    nextId: 0,
    effects: [],
    result: null,
    resultReason: '',
    bossSpawned: false,
    bossDefeated: false,
    stats: {
      cardsPlayed: 0,
      unitsDeployed: 0,
      manaOverflow: 0,
      playTimestamps: [],
      kills: 0,
      spellsCast: 0,
      leaks: { 0: 0, 1: 0 },
    },
  };
}

export function isBarrierIntact(state: BattleState, lane: Lane): boolean {
  return state.barriers[lane];
}

export function totalBarriersLeft(state: BattleState): number {
  return (state.barriers[0] ? 1 : 0) + (state.barriers[1] ? 1 : 0);
}
