/** 全局玩法数值。改这里必须同步 docs/GDD.md 第十一章。 */
export const TUNING = {
  mana: {
    max: 10,
    start: 5,
    regenPerSecond: 0.6,
  },
  hand: {
    max: 4,
    drawIntervalSeconds: 3.5,
  },
  board: {
    lanes: 2,
    rows: 3,
    /** 逻辑上入口到核心的距离（格）。 */
    laneLength: 3,
  },
  barrier: {
    perLane: 1,
    /** 屏障触发时对 Boss 的伤害。 */
    bossDamage: 100,
    bossStunSeconds: 5,
  },
  /** 无头模拟与调试用：单局允许的最长逻辑时长，防止死循环。 */
  maxBattleSeconds: 600,
} as const;

export type Tuning = typeof TUNING;
