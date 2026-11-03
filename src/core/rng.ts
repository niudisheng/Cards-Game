/**
 * 可复现随机数（mulberry32）。
 * 逻辑层所有随机都必须走这里，便于回放与平衡模拟。
 */
export interface Rng {
  readonly seed: number;
  /** [0, 1) */
  next(): number;
  /** [0, maxExclusive) 的整数 */
  int(maxExclusive: number): number;
  /** 原地洗牌并返回同一数组 */
  shuffle<T>(items: T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed,
    next,
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = items[i] as T;
        const b = items[j] as T;
        items[i] = b;
        items[j] = a;
      }
      return items;
    },
  };
}
