const COMBINING_MARK = /\p{Mark}/u;

/** Return a conservative terminal-cell width without splitting Unicode code points. */
export function visibleWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0x200d ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      COMBINING_MARK.test(character)
    ) {
      continue;
    }
    width += isWide(codePoint) ? 2 : 1;
  }
  return width;
}

/** Truncate a safe display string to a maximum visible width. */
export function truncateVisible(value: string, maximumWidth: number | undefined): string {
  if (maximumWidth === undefined || visibleWidth(value) <= maximumWidth) {
    return value;
  }
  if (maximumWidth <= 0) {
    return '';
  }

  const marker = '…';
  const contentWidth = maximumWidth - visibleWidth(marker);
  if (contentWidth <= 0) {
    return marker;
  }

  let result = '';
  let width = 0;
  for (const character of value) {
    const characterWidth = visibleWidth(character);
    if (width + characterWidth > contentWidth) {
      break;
    }
    result += character;
    width += characterWidth;
  }
  return `${result}${marker}`;
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
