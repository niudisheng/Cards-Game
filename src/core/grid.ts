import type { Cell, Lane, Row } from './types';

export function isValidLane(value: number): value is Lane {
  return value === 0 || value === 1;
}

export function isValidRow(value: number): value is Row {
  return value === 0 || value === 1 || value === 2;
}

export function isValidCell(cell: Cell): boolean {
  return isValidLane(cell.lane) && isValidRow(cell.row);
}

export function cellKey(cell: Cell): string {
  return `${cell.lane}:${cell.row}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.lane === b.lane && a.row === b.row;
}

export function laneName(lane: Lane): string {
  return lane === 0 ? '左路' : '右路';
}
