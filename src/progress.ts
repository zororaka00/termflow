import type { TaskProgressBarOptions } from './types.js';

const DEFAULT_WIDTH = 10;

export function formatProgress(
  current: number,
  total: number,
  options: TaskProgressBarOptions | undefined = undefined,
): string {
  const width = options?.width ?? DEFAULT_WIDTH;
  const complete = options?.complete ?? '#';
  const remaining = options?.remaining ?? '-';
  const completed = total === 0 ? width : Math.round((current / total) * width);
  const filled = Math.max(0, Math.min(width, completed));
  return `[${complete.repeat(filled)}${remaining.repeat(width - filled)}] ${current}/${total}`;
}
