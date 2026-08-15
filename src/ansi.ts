import type { AnsiMode } from './types.js';

export const CLEAR_LINE = '\r\u001B[2K';

export function shouldUseTtyRenderer(
  ansi: AnsiMode,
  stream: { isTTY?: boolean },
): boolean {
  if (ansi === 'always') {
    return true;
  }
  if (ansi === 'never') {
    return false;
  }

  return (
    stream.isTTY === true &&
    process.env.CI === undefined &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== 'dumb'
  );
}
