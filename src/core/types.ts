/** 左路 = 0，右路 = 1；同时作为战场列索引。 */
export type Lane = 0 | 1;

export const LANES: readonly Lane[] = [0, 1];

/** 0 = 前排（靠近入口），2 = 后排（靠近核心）。 */
export type Row = 0 | 1 | 2;

export const ROWS: readonly Row[] = [0, 1, 2];

export interface Cell {
  lane: Lane;
  row: Row;
}

export type CardId =
  | 'shield'
  | 'archer'
  | 'scout'
  | 'frostMage'
  | 'banner'
  | 'bomber'
  | 'fireball'
  | 'frostNova'
  | 'reinforce'
  | 'surge';

export type EnemyId = 'grunt' | 'runner' | 'bulwark' | 'archer' | 'jumper' | 'boss';

/** 一局游戏所处的阶段。暂停是独立布尔值，不占用阶段。 */
export type Phase = 'preparation' | 'wave' | 'intermission' | 'victory' | 'defeat';

export type Difficulty = 'normal';
