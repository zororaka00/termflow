export function formatElapsed(elapsedMs: number): string {
  return `${(Math.max(0, elapsedMs) / 1_000).toFixed(1)}s`;
}
