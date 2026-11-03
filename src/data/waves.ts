import type { Phase } from '@/core/types';
import type { SpawnEvent, WaveDef } from './schema';

/**
 * 波次时间轴（相对开局秒数）。数值见 docs/GDD.md 7.2。
 * 准备阶段 0—10s 不在本表内，由第一波 startAt 推导。
 */
export const WAVES: readonly WaveDef[] = [
  {
    id: 'wave-1',
    index: 1,
    name: '第 1 波',
    startAt: 10,
    endAt: 40,
    previewLead: 5,
    spawns: [
      { at: 10, lane: 0, enemy: 'grunt', count: 2, interval: 3 },
      { at: 10, lane: 1, enemy: 'runner', count: 2, interval: 4 },
    ],
  },
  {
    id: 'wave-2',
    index: 2,
    name: '第 2 波',
    startAt: 55,
    endAt: 95,
    previewLead: 5,
    spawns: [
      { at: 55, lane: 0, enemy: 'bulwark', count: 1, interval: 0 },
      { at: 58, lane: 0, enemy: 'grunt', count: 2, interval: 3 },
      { at: 55, lane: 1, enemy: 'archer', count: 2, interval: 3 },
      { at: 61, lane: 1, enemy: 'grunt', count: 1, interval: 0 },
    ],
  },
  {
    id: 'wave-3',
    index: 3,
    name: '第 3 波',
    startAt: 110,
    endAt: 150,
    previewLead: 5,
    spawns: [
      { at: 110, lane: 0, enemy: 'jumper', count: 1, interval: 0 },
      { at: 113, lane: 0, enemy: 'runner', count: 2, interval: 3 },
      { at: 110, lane: 1, enemy: 'bulwark', count: 1, interval: 0 },
      { at: 113, lane: 1, enemy: 'archer', count: 2, interval: 3 },
    ],
  },
  {
    id: 'wave-boss',
    index: 4,
    name: 'Boss 波',
    startAt: 165,
    endAt: null,
    previewLead: 15,
    spawns: [
      { at: 165, lane: 0, enemy: 'boss', count: 1, interval: 0 },
      { at: 165, lane: 1, enemy: 'grunt', count: 3, interval: 3 },
    ],
  },
];

export const FIRST_WAVE_START = WAVES[0]?.startAt ?? 10;

/** 把波次表展开成按时间排序的单次刷怪事件。 */
export function buildSpawnQueue(waves: readonly WaveDef[] = WAVES): SpawnEvent[] {
  const queue: SpawnEvent[] = [];
  for (const wave of waves) {
    for (const group of wave.spawns) {
      for (let i = 0; i < group.count; i += 1) {
        queue.push({
          at: group.at + i * group.interval,
          lane: group.lane,
          enemy: group.enemy,
          waveId: wave.id,
        });
      }
    }
  }
  // Array.prototype.sort 自 ES2019 起稳定：同一秒内保持数据表书写顺序。
  return queue.sort((a, b) => a.at - b.at);
}

/** 当前时间点所处的波次；不在波次内返回 null。 */
export function waveAt(elapsed: number, waves: readonly WaveDef[] = WAVES): WaveDef | null {
  for (const wave of waves) {
    const started = elapsed >= wave.startAt;
    const notEnded = wave.endAt === null || elapsed < wave.endAt;
    if (started && notEnded) return wave;
  }
  return null;
}

/** 下一波（严格晚于当前时间的最近一波）。 */
export function nextWaveAt(elapsed: number, waves: readonly WaveDef[] = WAVES): WaveDef | null {
  for (const wave of waves) {
    if (wave.startAt > elapsed) return wave;
  }
  return null;
}

/** 若已进入预告窗口，返回即将到来的波次。 */
export function previewWaveAt(elapsed: number, waves: readonly WaveDef[] = WAVES): WaveDef | null {
  for (const wave of waves) {
    if (elapsed >= wave.startAt - wave.previewLead && elapsed < wave.startAt) return wave;
  }
  return null;
}

/**
 * 由时间推导阶段。胜负由 sim 判定后覆盖，不由时间推导。
 * 最后一波（Boss）endAt 为 null，战斗阶段会一直保持到清场。
 */
export function phaseAt(elapsed: number, waves: readonly WaveDef[] = WAVES): Phase {
  if (elapsed < FIRST_WAVE_START) return 'preparation';
  if (waveAt(elapsed, waves)) return 'wave';
  return 'intermission';
}
