import type { EnemyDef } from './schema';

/** 6 种敌人。数值见 docs/GDD.md 7.1。 */
export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'grunt',
    name: '小兵',
    hp: 60,
    speed: 0.12,
    attack: 10,
    attackInterval: 1.0,
    range: 1,
    emoji: '👹',
    color: '#c96b6b',
  },
  {
    id: 'runner',
    name: '疾行者',
    hp: 35,
    speed: 0.25,
    attack: 6,
    attackInterval: 0.8,
    range: 1,
    emoji: '🐺',
    color: '#e0a458',
  },
  {
    id: 'bulwark',
    name: '盾兵',
    hp: 180,
    speed: 0.08,
    attack: 15,
    attackInterval: 1.5,
    range: 1,
    emoji: '🧟',
    color: '#7f8fa6',
  },
  {
    id: 'archer',
    name: '射手',
    hp: 50,
    speed: 0.1,
    attack: 8,
    attackInterval: 1.2,
    range: 2,
    emoji: '🎯',
    color: '#a58bd6',
  },
  {
    id: 'jumper',
    name: '跳路者',
    hp: 70,
    speed: 0.15,
    attack: 12,
    attackInterval: 1.0,
    range: 1,
    emoji: '🕷️',
    color: '#79c0a8',
    traits: ['jumper'],
  },
  {
    id: 'boss',
    name: 'Boss 巨像',
    hp: 800,
    speed: 0.06,
    attack: 30,
    attackInterval: 2.0,
    range: 1,
    emoji: '🗿',
    color: '#b06bff',
    traits: ['boss'],
    bossSkill: { interval: 8, windup: 2, damage: 60, rows: 3, stun: 1 },
  },
];

export const ENEMY_BY_ID: ReadonlyMap<string, EnemyDef> = new Map(
  ENEMIES.map((enemy) => [enemy.id, enemy]),
);

export function getEnemy(id: string): EnemyDef {
  const enemy = ENEMY_BY_ID.get(id);
  if (!enemy) throw new Error(`未知敌人：${id}`);
  return enemy;
}
