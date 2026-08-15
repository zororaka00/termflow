const DEFAULT_WIDTH = 10;

export function formatProgress(current: number, total: number, width = DEFAULT_WIDTH): string {
  const completed = total === 0 ? width : Math.round((current / total) * width);
  const filled = Math.max(0, Math.min(width, completed));
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${current}/${total}`;
}
